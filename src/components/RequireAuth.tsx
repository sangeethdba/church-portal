import { useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { getMyProfile } from "@/lib/auth";
import type { Profile } from "@/lib/supabase";
import { Card, CardBody } from "@/components/ui";
import { ShieldAlert, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export default function RequireAuth() {
  const location = useLocation();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "unconfigured" }
    | { kind: "signed-out" }
    | { kind: "signed-in"; profile: Profile | null }
  >({ kind: "loading" });

  useEffect(() => {
    if (!supabase) {
      setState({ kind: "unconfigured" });
      return;
    }
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

  if (state.kind === "unconfigured") {
    return (
      <div className="grid min-h-screen place-items-center bg-parchment-50 p-6">
        <Card className="max-w-xl">
          <CardBody className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-serif text-xl font-semibold text-stone-900">
                  Connect your Supabase project to continue
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  Add <code className="rounded bg-stone-100 px-1 py-0.5">VITE_SUPABASE_URL</code>{" "}
                  and <code className="rounded bg-stone-100 px-1 py-0.5">VITE_SUPABASE_ANON_KEY</code>{" "}
                  to your Freebuff project's API Keys tab, then refresh this page.
                </p>
                <p className="mt-2 text-sm text-stone-600">
                  Until then, the public landing is still accessible below.
                </p>
                <div className="mt-4">
                  <Link to="/" className="text-sm font-medium text-accent hover:underline">
                    Back to landing →
                  </Link>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (state.kind === "signed-out") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet context={state.profile} />;
}
