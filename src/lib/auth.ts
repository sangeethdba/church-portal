import { supabase, isSupabaseConfigured, type Profile, type AppRole } from "./supabase";

export interface AuthSessionState {
  configured: boolean;
  userId?: string;
  email?: string;
  profile?: Profile;
  isAdminOrTreasurer: boolean;
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

export async function signInWithGoogle(redirectTo?: string) {
  const siteUrl = import.meta.env.VITE_SITE_URL ?? window.location.origin;
  const { error, data } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${siteUrl}/auth/callback${redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ""}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getMyProfile(): Promise<Profile | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("Could not load profile:", error.message);
    return null;
  }
  return (data as Profile | null) ?? null;
}

export async function getCurrentSession(): Promise<AuthSessionState> {
  const configured = isSupabaseConfigured();
  if (!configured) return { configured: false, isAdminOrTreasurer: false };
  const profile = await getMyProfile();
  const role: AppRole | null | undefined = profile?.role;
  return {
    configured: true,
    userId: profile?.id ?? undefined,
    email: profile?.email ?? undefined,
    profile: profile ?? undefined,
    isAdminOrTreasurer: role === "admin" || role === "treasurer" || role === "super_admin",
  };
}
