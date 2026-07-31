import { useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { getMyProfile } from "@/lib/auth";
import type { Profile } from "@/lib/supabase";

export default function RequireAuth() {
  const location = useLocation();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "signed-out" }
    | { kind: "signed-in"; profile: Profile | null }
  >({ kind: "loading" });

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setState({ kind: "signed-out" });
      } else {
        const profile = await getMyProfile();
        setState({ kind: "signed-in", profile });
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setState({ kind: "signed-out" });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-parchment-50">
        <div className="text-sm text-stone-500">Loading…</div>
      </div>
    );
  }

  if (state.kind === "signed-out") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet context={state.profile} />;
}
