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
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  const userEmail = session.session?.user?.email;
  if (!userId) return null;

  // Primary: lookup by auth UUID
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (data) return data as Profile;
  if (error) console.warn("Could not load profile by id:", error.message);

  // Fallback: Google re-auth can mint a new UUID. Look up by email.
  if (userEmail) {
    const { data: byEmail } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", userEmail)
      .maybeSingle();

    if (byEmail) {
      // Repair the UUID link so future lookups hit on the first query.
      if (byEmail.id !== userId) {
        await supabase
          .from("profiles")
          .update({ id: userId })
          .eq("id", byEmail.id);
        byEmail.id = userId;
      }
      return byEmail as Profile;
    }
  }

  return null;
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
