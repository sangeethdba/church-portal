import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY")!;

// Models to try in order — first one that returns non-404 is used
const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

const SYSTEM_PROMPT = `Extract this church offering ledger and return ONLY valid JSON — no commentary, no markdown, no code fences.

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
- deductions: list any deductions noted. If none, use empty array [].
- checks: for each check, extract donor name, check number, and amount in dollars.
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

async function tryModel(model: string, cleanBase64: string): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_AI_KEY}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
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
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, Math.pow(3, attempt) * 3000));
      continue;
    }
    return res;
  }
  throw new Error("Rate limit exhausted");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }
  if (req.method !== "POST") {
    return cors(new Response(JSON.stringify({ success: false, error: "POST only" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    }));
  }

  try {
    const body = await req.json();
    const { imageBase64 } = body as { imageBase64?: string };
    if (!imageBase64) {
      return cors(new Response(JSON.stringify({ success: false, error: "Missing imageBase64" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      }));
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    // Try each model until one works
    let geminiRes: Response | null = null;
    let lastError = "";
    for (const model of MODELS) {
      try {
        const res = await tryModel(model, cleanBase64);
        if (res.status === 404) {
          lastError = `${model}: 404`;
          continue; // model doesn't exist, try next
        }
        geminiRes = res;
        break;
      } catch (e) {
        lastError = `${model}: ${(e as Error).message}`;
        continue;
      }
    }

    if (!geminiRes) {
      return cors(new Response(
        JSON.stringify({ success: false, error: `All models failed — ${lastError}` }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ));
    }

    if (!geminiRes.ok) {
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
      parsed = JSON.parse(rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim());
    } catch {
      return cors(new Response(
        JSON.stringify({ success: false, error: "Failed to parse AI response", rawText }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ));
    }

    return cors(new Response(JSON.stringify({
      success: true,
      data: {
        serviceDate: (parsed.serviceDate as string) ?? new Date().toISOString().slice(0, 10),
        serviceName: (parsed.serviceName as string) ?? "Sunday Service",
        denominations: (parsed.denominations as Record<string, number>) ?? {},
        deductions: (parsed.deductions as Array<{ reason: string; amount: number }>) ?? [],
        checks: (parsed.checks as Array<{ donorName: string; checkNumber: string; amount: number }>) ?? [],
        cashGifts: (parsed.cashGifts as Array<{ donorName: string; amount: number }>) ?? [],
        notes: (parsed.notes as string) ?? "",
      },
    }), { headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("scan-ledger error:", err);
    return cors(new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    ));
  }
});
