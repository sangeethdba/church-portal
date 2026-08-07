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
- serviceDate: use the date written on the ledger. If today's date appears and it's clearly the service date, use it. Default to today if unclear.
- serviceName: "Sunday Service" unless the ledger explicitly says otherwise.
- denominations: count how many of each bill. The total of all denomination subtotals equals the gross cash.
- deductions: list any deductions noted (pastor gift, etc.). If none, use empty array [].
- checks: for each check entry, extract donor name, check number, and amount. Amounts are in dollars.
- cashGifts: for any named cash envelope gifts (not anonymous plate cash), extract donor name and amount.
- If you cannot read a name clearly, use "Unknown" as the donorName.
- All amounts are numbers (not strings).
- If a field has no data, use empty array [] or 0 as appropriate.
- DO NOT include markdown code fences. Return raw JSON only.`;

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // Auth check — require a valid Supabase JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const body = await req.json();
    const { imageBase64 } = body as { imageBase64?: string };

    if (!imageBase64) {
      return new Response(JSON.stringify({ success: false, error: "Missing imageBase64" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Strip data URL prefix if present
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GOOGLE_AI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: cleanBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: `Gemini API error: ${geminiRes.status}` }),
        {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        },
      );
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!rawText) {
      return new Response(JSON.stringify({ success: false, error: "No text extracted from image" }), {
        status: 422,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Parse the JSON response from Gemini
    let parsed: Record<string, unknown>;
    try {
      // Strip any accidental markdown fences
      const cleanText = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleanText);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to parse AI response", rawText }),
        {
          status: 422,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        },
      );
    }

    // Normalize the response
    const result = {
      serviceDate: (parsed.serviceDate as string) ?? new Date().toISOString().slice(0, 10),
      serviceName: (parsed.serviceName as string) ?? "Sunday Service",
      denominations: (parsed.denominations as Record<string, number>) ?? {},
      deductions: (parsed.deductions as Array<{ reason: string; amount: number }>) ?? [],
      checks: (parsed.checks as Array<{ donorName: string; checkNumber: string; amount: number }>) ?? [],
      cashGifts: (parsed.cashGifts as Array<{ donorName: string; amount: number }>) ?? [],
      notes: (parsed.notes as string) ?? "",
    };

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("scan-ledger error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      },
    );
  }
});
