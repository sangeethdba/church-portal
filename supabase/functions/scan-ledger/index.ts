import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY")!;
// Gemini 2.0 Flash: the only model confirmed working on this account.
// Free tier: 15 RPM. Retry with long backoff to handle rate limits.
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const SYSTEM_PROMPT = `You are an OCR assistant for a church finance app. You are given a photo of a paper Sunday offering ledger.

Extract the following structured data and return ONLY valid JSON — no commentary, no markdown, no code fences.

The JSON shape:
{
  "serviceDate": "YYYY-MM-DD",
  "serviceName": "Sunday Service",
  "denominations": { "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 },
  "deductions": [{ "reason": "Pastor gift", "amount": 0 }],
  "checks": [{ "donorName": "John Doe", "checkNumber": "123", "amount": 100 }],
  "cashGifts": [{ "donorName": "Jane Smith", "amount": 20 }],
  "notes": ""
}

Rules:
- serviceDate: use the date written on the ledger. Default to today if unclear.
- serviceName: "Sunday Service" unless the ledger says otherwise.
- denominations: count how many of each bill. Total of all subtotals equals gross cash.
- deductions: list any deductions noted (pastor gift, etc.). If none, use empty array [].
- checks: for each check, extract donor name, check number, and amount. Amounts in dollars.
- cashGifts: for named cash envelope gifts, extract donor name and amount.
- If you cannot read a name, use "Unknown".
- All amounts are numbers (not strings).
- If no data, use empty array [] or 0.
- Return raw JSON only — no markdown code fences.`;

function cors(resp: Response): Response {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return resp;
}

// Call Gemini with retry on 429 (rate limit)
async function callGemini(cleanBase64: string): Promise<Response> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(`${GEMINI_URL}?key=${GOOGLE_AI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SYSTEM_PROMPT },
            { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    });

    if (res.status === 429 && attempt < maxRetries - 1) {
      // Rate limited — wait and retry with exponential backoff
      const delay = Math.pow(3, attempt) * 3000; // 3s, 9s, 27s — let rate limit window pass
      console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    return res;
  }
  // Shouldn't reach here, but fallback
  throw new Error("Gemini API unavailable — rate limit exceeded after retries");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  if (req.method !== "POST") {
    return cors(new Response(JSON.stringify({ success: false, error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    }));
  }

  try {
    const body = await req.json();
    const { imageBase64 } = body as { imageBase64?: string };

    if (!imageBase64) {
      return cors(new Response(JSON.stringify({ success: false, error: "Missing imageBase64" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }));
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const geminiRes = await callGemini(cleanBase64);

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText.slice(0, 200));
      const msg = geminiRes.status === 429
        ? "AI service is busy — please wait a moment and try again."
        : `Gemini API error: ${geminiRes.status}`;
      return cors(new Response(
        JSON.stringify({ success: false, error: msg }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ));
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!rawText) {
      return cors(new Response(
        JSON.stringify({ success: false, error: "No text extracted from image" }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ));
    }

    let parsed: Record<string, unknown>;
    try {
      const cleanText = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleanText);
    } catch {
      return cors(new Response(
        JSON.stringify({ success: false, error: "Failed to parse AI response", rawText }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ));
    }

    const result = {
      serviceDate: (parsed.serviceDate as string) ?? new Date().toISOString().slice(0, 10),
      serviceName: (parsed.serviceName as string) ?? "Sunday Service",
      denominations: (parsed.denominations as Record<string, number>) ?? {},
      deductions: (parsed.deductions as Array<{ reason: string; amount: number }>) ?? [],
      checks: (parsed.checks as Array<{ donorName: string; checkNumber: string; amount: number }>) ?? [],
      cashGifts: (parsed.cashGifts as Array<{ donorName: string; amount: number }>) ?? [],
      notes: (parsed.notes as string) ?? "",
    };

    return cors(new Response(JSON.stringify({ success: true, data: result }), {
      headers: { "Content-Type": "application/json" },
    }));
  } catch (err) {
    console.error("scan-ledger error:", err);
    return cors(new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    ));
  }
});
