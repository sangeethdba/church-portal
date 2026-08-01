import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Church, Mail, LogIn, UserPlus, Sparkles, Banknote, Receipt, PieChart,
  ShieldCheck, FileText,
} from "lucide-react";
import Logo from "@/components/Logo";
import { Button, Card, CardBody, Input, Label, Badge, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
} from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const highlights = [
  {
    icon: <Banknote className="h-4 w-4" />,
    title: "Weekly offerings",
    body: "Cash by denomination, each check per donor, dual-counter sign-off, and a printable deposit slip.",
  },
  {
    icon: <Receipt className="h-4 w-4" />,
    title: "Member reimbursements",
    body: "Submit bills with receipts, reply to clarification, and watch your status go from pending to settled.",
  },
  {
    icon: <PieChart className="h-4 w-4" />,
    title: "Category spend reports",
    body: "See where the church spends — rent, salaries, events, missions, travel — in one clear chart.",
  },
  {
    icon: <FileText className="h-4 w-4" />,
    title: "Annual tax statements",
    body: "The treasurer generates and shares IRS-friendly giving statements for every member.",
  },
];

export default function Login() {
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // If already signed in, kick straight to dashboard
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/dashboard", { replace: true });
    });
  }, [navigate]);

  // Auto-trigger Google flow when ?provider=google
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("provider") === "google") {
      signInWithGoogle().catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Google sign-in failed");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signInWithEmail(email, password);
      navigate("/dashboard", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signUpWithEmail(email, password, name);
      setError("Check your inbox to confirm your email, then sign in.");
      setSearchParams({});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not sign up");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-parchment-50 lg:grid-cols-[1.05fr_1fr]">
      {/* ── Brand panel ────────────────────────────────────────────────── */}
      <div className="relative hidden overflow-hidden border-r border-stone-800 bg-gradient-to-br from-stone-900 via-stone-900 to-indigo-950 p-12 text-stone-100 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(60% 45% at 25% 15%, rgba(79,70,229,0.35), transparent 60%), radial-gradient(45% 40% at 85% 75%, rgba(180,83,9,0.25), transparent 60%)",
          }}
        />
        <div className="relative">
          <Logo size={40} className="[&_span]:text-stone-50" />
          <h1 className="mt-10 font-serif text-4xl font-semibold leading-tight">
            Fear not, little flock…
          </h1>
          <p className="mt-3 max-w-md text-stone-300">
            <span className="font-medium text-stone-100">We pray for you.</span> A faithful,
            transparent record of every offering given and every expense spent — stewarded with
            clarity for Atlanta Little Flock Church.
          </p>
          <p className="mt-4 text-xs uppercase tracking-widest text-stone-400">
            — Luke 12:32
          </p>
        </div>

        <div className="relative mt-12 grid gap-4">
          {highlights.map((h) => (
            <div key={h.title} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
                {h.icon}
              </div>
              <div>
                <div className="text-sm font-semibold text-stone-100">{h.title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-stone-300">{h.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="relative mt-10 flex items-center gap-2 text-xs text-stone-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Members see only their own giving. Treasurers see the church. Row-level security keeps it that way.
        </div>
      </div>

      {/* ── Auth card ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md animate-fade-up">
          <Link to="/" className="mb-6 flex items-center justify-center text-stone-900 lg:justify-start">
            <Logo size={36} />
          </Link>
          <Card>
            <CardBody className="space-y-6">
              <div>
                <Badge tone="indigo" className="mb-3">
                  <Sparkles className="h-3 w-3" />
                  Welcome back
                </Badge>
                <h1 className="font-serif text-2xl font-semibold text-stone-900">
                  Sign in to your church portal
                </h1>
                <p className="mt-1 text-sm text-stone-600">
                  Offerings, reimbursements, and reports for Atlanta Little Flock Church.
                </p>
              </div>

              <Button
                size="lg"
                variant="outline"
                className="w-full"
                onClick={handleGoogle}
                disabled={loading}
                iconLeft={
                  <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 3l5.7-5.7C33.6 6.1 29 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" />
                    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3 0 5.7 1.1 7.8 3l5.7-5.7C33.6 7.1 29 5 24 5 16.3 5 9.6 9.3 6.3 14.7z" />
                    <path fill="#4CAF50" d="M24 44c5 0 9.5-1.8 12.8-4.8l-5.9-5c-2 1.5-4.6 2.3-7 2.3-5.3 0-9.7-3.4-11.3-8L6.3 33.4C9.5 39.7 16.2 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.8l5.9 5C39 35.6 44 30.4 44 24c0-1.2-.1-2.4-.4-3.5z" />
                  </svg>
                }
              >
                Continue with Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-stone-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs uppercase tracking-wider text-stone-500">or</span>
                </div>
              </div>

              <Tabs defaultValue="signin">
                <TabsList className="w-full">
                  <TabsTrigger value="signin" className="flex-1">
                    <LogIn className="mr-2 h-3.5 w-3.5" /> Sign in
                  </TabsTrigger>
                  <TabsTrigger value="signup" className="flex-1">
                    <UserPlus className="mr-2 h-3.5 w-3.5" /> Sign up
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="signin">
                  <form className="space-y-4" onSubmit={handleEmailSignIn}>
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="treasurer@yourchurch.org"
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={8}
                        className="mt-1.5"
                      />
                    </div>
                    {error && (
                      <div className="rounded-md bg-rose-50 p-2.5 text-sm text-rose-700">{error}</div>
                    )}
                    <Button type="submit" disabled={loading} className="w-full" iconLeft={<Mail className="h-4 w-4" />}>
                      {loading ? "Signing in…" : "Sign in with email"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup">
                  <form className="space-y-4" onSubmit={handleEmailSignUp}>
                    <div>
                      <Label htmlFor="name">Your name</Label>
                      <Input
                        id="name"
                        type="text"
                        autoComplete="name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email-su">Email</Label>
                      <Input
                        id="email-su"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="password-su">Password (8+ chars)</Label>
                      <Input
                        id="password-su"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={8}
                        className="mt-1.5"
                      />
                    </div>
                    {error && (
                      <div className="rounded-md bg-amber-50 p-2.5 text-sm text-amber-700">{error}</div>
                    )}
                    <Button type="submit" disabled={loading} className="w-full" iconLeft={<Church className="h-4 w-4" />}>
                      {loading ? "Creating account…" : "Create account"}
                    </Button>
                    <p className="text-xs text-stone-500">
                      New accounts are created with the <strong>member</strong> role. Ask your
                      admin to promote you to <strong>treasurer</strong>.
                    </p>
                  </form>
                </TabsContent>
              </Tabs>
            </CardBody>
          </Card>
          <p className="mt-6 text-center text-xs text-stone-500">
            <span className="text-stone-300">v250801e</span>{" · "}
            By signing in you agree to keep all giving data confidential.{" "}
            <Link to="/" className="text-accent hover:underline">Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
