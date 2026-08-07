import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY")!;
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

// CORS helper
function cors(resp: Response): Response {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return resp;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  // Only POST
  if (req.method !== "POST") {
    return cors(new Response(JSON.stringify({ success: false, error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    }));
  }

  // No JWT auth — the frontend gates behind admin role.
  // Deploy with: supabase functions deploy scan-ledger --no-verify-jwt

  try {
    const body = await req.json();
    const { imageBase64 } = body as { imageBase64?: string };

    if (!imageBase64) {
      return cors(new Response(JSON.stringify({ success: false, error: "Missing imageBase64" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }));
    }

    // Strip data URL prefix
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GOOGLE_AI_KEY}`, {
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

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText.slice(0, 200));
      return cors(new Response(
        JSON.stringify({ success: false, error: `Gemini API error: ${geminiRes.status}` }),
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

    // Parse Gemini's JSON response
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
