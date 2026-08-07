import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const KEY = Deno.env.get("GOOGLE_AI_KEY")!;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  try {
    const { imageBase64 } = await req.json() as { imageBase64?: string };
    if (!imageBase64) {
      return Response.json({ ok: false, error: "Missing image" }, { status: 400 });
    }
    const clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Extract this church offering ledger as JSON: {\"serviceDate\":\"YYYY-MM-DD\",\"serviceName\":\"Sunday Service\",\"denominations\":{\"100\":0,\"50\":0,\"20\":0,\"10\":0,\"5\":0,\"2\":0,\"1\":0},\"deductions\":[],\"checks\":[{\"donorName\":\"\",\"checkNumber\":\"\",\"amount\":0}],\"cashGifts\":[],\"notes\":\"\"}. Amounts are numbers, no markdown." },
              { inlineData: { mimeType: "image/jpeg", data: clean } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
      },
    );

    const text = await res.text();

    if (!res.ok) {
      const msg = text.includes("429") || res.status === 429
        ? "Rate limited — wait 60 seconds and try again."
        : text.includes("404") || res.status === 404
        ? "Model not found on this account."
        : `API error ${res.status}: ${text.slice(0, 200)}`;
      return Response.json({ ok: false, error: msg }, {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Parse the Gemini response
    let data: Record<string, unknown>;
    try {
      const geminiJson = JSON.parse(text);
      const raw = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim());
    } catch {
      return Response.json({ ok: false, error: "Could not parse AI response." }, {
        status: 422,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    return Response.json({ ok: true, data }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return Response.json({ ok: false, error: `Server error: ${(err as Error).message}` }, {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
});
