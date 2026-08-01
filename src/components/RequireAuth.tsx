import { useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { Shield, Clock, LogOut } from "lucide-react";
import { supabase, isAdminRole } from "@/lib/supabase";
import { getMyProfile, signOut } from "@/lib/auth";
import type { Profile } from "@/lib/supabase";

export default function RequireAuth() {
  const location = useLocation();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "signed-out" }
    | { kind: "signed-in"; profile: Profile | null }
    | { kind: "pending-approval"; profile: Profile }
  >({ kind: "loading" });

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setState({ kind: "signed-out" });
        return;
      }
      let profile = await getMyProfile();
      if (!profile) {
        setState({ kind: "signed-in", profile: null });
        return;
      }

      // Bootstrap: if this is the very first portal user (no admin exists yet),
      // promote them automatically so the church isn't locked out on day one.
      if (!profile.portal_access && !isAdminRole(profile.role)) {
        const { data: promoted } = await supabase.rpc("bootstrap_first_admin");
        if (promoted === true) {
          profile = (await getMyProfile()) ?? profile;
        }
      }

      if (!profile.portal_access && !isAdminRole(profile.role)) {
        // Logged in via Google, but not yet approved by the treasurer
        setState({ kind: "pending-approval", profile });
      } else {
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
        <div className="text-center">
          <div className="text-sm text-stone-500">Loading…</div>
          <div className="mt-1 text-[10px] text-stone-300">v250801i</div>
        </div>
      </div>
    );
  }

  if (state.kind === "signed-out") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // ── Pending approval screen ───────────────────────────────────────────
  if (state.kind === "pending-approval") {
    return (
      <div className="grid min-h-screen place-items-center bg-parchment-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-soft">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <Clock className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-serif text-2xl font-semibold text-stone-900">
            Access pending approval
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            You've signed in as <strong>{state.profile.email}</strong>, but your access hasn't
            been approved yet. Please contact your church treasurer or administrator to activate
            your portal access.
          </p>
          <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-left text-xs text-stone-500">
            <Shield className="mr-1 inline h-3.5 w-3.5" />
            Only approved members can view donations, expenses, and submit reimbursements.
          </div>
          <button
            onClick={async () => { await signOut(); window.location.href = "/"; }}
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    );
  }

  return <Outlet context={{ profile: state.profile, isCounter: state.profile?.is_counter ?? false }} />;
}
