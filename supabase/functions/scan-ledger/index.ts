import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const KEY = Deno.env.get("GOOGLE_AI_KEY") ?? "";
// Try current models first — gemini-2.0-flash was deprecated and may 404.
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

const PROMPT =
  'Extract this church offering ledger as JSON: {"serviceDate":"YYYY-MM-DD","serviceName":"Sunday Service","denominations":{"100":0,"50":0,"20":0,"10":0,"5":0,"2":0,"1":0},"deductions":[],"checks":[{"donorName":"","checkNumber":"","amount":0}],"cashGifts":[],"notes":""}. Amounts are numbers, no markdown.';

const cors = { "Access-Control-Allow-Origin": "*" } as Record<string, string>;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  try {
    const { imageBase64, mimeType } = await req.json() as { imageBase64?: string; mimeType?: string };
    if (!imageBase64) {
      return Response.json({ ok: false, error: "Missing image" }, { status: 400, headers: cors });
    }
    if (!KEY) {
      return Response.json(
        {
          ok: false,
          error:
            "GOOGLE_AI_KEY is not set on this project. Add it under Supabase → Edge Functions → scan-ledger → Secrets (or set VITE_GOOGLE_AI_KEY in the app env and the app will call Gemini directly).",
        },
        { status: 500, headers: cors },
      );
    }
    const clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const parts = [
      { text: PROMPT },
      { inlineData: { mimeType: mimeType || "image/jpeg", data: clean } },
    ];

    let lastStatus = 0;
    let lastBody = "";
    for (const model of MODELS) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
          }),
        },
      );
      const text = await res.text();
      if (res.ok) {
        let data: Record<string, unknown>;
        try {
          const geminiJson = JSON.parse(text);
          const raw = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim());
        } catch {
          return Response.json({ ok: false, error: "Could not parse AI response." }, {
            status: 422,
            headers: cors,
          });
        }
        return Response.json({ ok: true, data }, { headers: cors });
      }
      lastStatus = res.status;
      lastBody = text;
      // 404 = model not available on this account → try the next model.
      // Any other error (invalid key, quota, etc.) → stop immediately.
      if (res.status !== 404) break;
    }

    const msg = lastStatus === 429
      ? "Rate limited — wait 60 seconds and try again."
      : lastStatus === 404
      ? "No eligible AI model found on this account."
      : `API error ${lastStatus}: ${lastBody.slice(0, 200)}`;
    return Response.json({ ok: false, error: msg }, { status: 502, headers: cors });
  } catch (err) {
    return Response.json({ ok: false, error: `Server error: ${(err as Error).message}` }, {
      status: 500,
      headers: cors,
    });
  }
});
