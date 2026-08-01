import { supabase, isSupabaseConfigured, isAdminRole, type Profile, type AppRole } from "./supabase";

export interface AuthSessionState {
  configured: boolean;
  userId?: string;
  email?: string;
  profile?: Profile;
  isAdmin: boolean;
  isCounter: boolean;
}

export async function signInWithEmail(email: string, password: string) {
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string, fullName?: string) {
  const { error, data } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName ?? email.split("@")[0] } },
  });
  if (error) throw error;
  return data;
}

// Production URL for OAuth redirects — must match a Supabase allowed redirect URI.
const SITE_URL = "https://church-portal-one.vercel.app";

export async function signInWithGoogle(redirectTo?: string) {
  const { error, data } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${SITE_URL}/auth/callback${redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ""}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getMyProfile(): Promise<Profile | null> {
  const { data, error } = await supabase.rpc("get_my_profile");
  if (error) {
    console.warn("get_my_profile RPC failed:", error.message);
    return null;
  }
  return (data as Profile | null) ?? null;
}

export async function getCurrentSession(): Promise<AuthSessionState> {
  const configured = isSupabaseConfigured();
  if (!configured) return { configured: false, isAdmin: false, isCounter: false };
  const profile = await getMyProfile();
  const role: AppRole | null | undefined = profile?.role;
  return {
    configured: true,
    userId: profile?.id ?? undefined,
    email: profile?.email ?? undefined,
    profile: profile ?? undefined,
    isAdmin: isAdminRole(role),
    isCounter: profile?.is_counter ?? false,
  };
}
