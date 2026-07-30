import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "ok" | "fail">("loading");

  useEffect(() => {
    if (!supabase) {
      setStatus("fail");
      return;
    }
    // Supabase detects the hash/code from the URL automatically.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setStatus("ok");
        const next = searchParams.get("next") ?? "/dashboard";
        navigate(next, { replace: true });
      } else {
        setStatus("fail");
      }
    });
  }, [navigate, searchParams]);

  return (
    <div className="grid min-h-screen place-items-center bg-parchment-50 px-4 text-center">
      <div>
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-accent" />
        <p className="text-sm text-stone-600">
          {status === "loading" && "Completing sign-in…"}
          {status === "ok" && "Signed in. Redirecting…"}
          {status === "fail" && "Could not complete sign-in. Please try again."}
        </p>
      </div>
    </div>
  );
}
