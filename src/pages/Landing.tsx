import { Link } from "react-router-dom";
import {
  HandCoins,
  Receipt,
  FileText,
  Shield,
  Sparkles,
  ArrowRight,
  Database,
  Cloud,
  Lock,
  Heart,
  Wallet,
  ScrollText,
} from "lucide-react";
import { Button, Badge } from "@/components/ui";
import Logo from "@/components/Logo";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

function useAuthedRedirect() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace("/dashboard");
    });
  }, []);
}

const features = [
  {
    icon: <HandCoins className="h-5 w-5" />,
    title: "Member-submitted reimbursements",
    body: "Congregants drop a receipt, add an amount, and the treasurer sees it in a single queue.",
  },
  {
    icon: <Wallet className="h-5 w-5" />,
    title: "Church-direct expense ledger",
    body: "Pastors and treasurers log rent, utilities, and outreach costs the moment they happen.",
  },
  {
    icon: <FileText className="h-5 w-5" />,
    title: "Tax-ready statements in one click",
    body: "Hand donors a clean, signed PDF of every gift in the calendar year — IRS-friendly.",
  },
  {
    icon: <Lock className="h-5 w-5" />,
    title: "Row-level security on every table",
    body: "Members see only their own giving. Treasurers see the church. Nobody sees both.",
  },
  {
    icon: <ScrollText className="h-5 w-5" />,
    title: "Auto-paid reimbursement flow",
    body: "Approve a request, mark it auto-paid, and the audit log knows who did it and when.",
  },
  {
    icon: <Heart className="h-5 w-5" />,
    title: "Donor directory that grows with you",
    body: "Family accounts, contact info, and a per-donor history without keeping a parallel spreadsheet.",
  },
];

const steps = [
  {
    n: "01",
    title: "Set up Supabase in 5 minutes",
    body: "Create a free project, paste two API keys into Freebuff — that's it. No credit card.",
  },
  {
    n: "02",
    title: "Invite treasurers and members",
    body: "Sign-ups land in your invite list. Promote treasurers to admin/treasurer with one SQL update.",
  },
  {
    n: "03",
    title: "Start tracking faithfully",
    body: "Donations, expenses, year-end statements. Everything stays in Postgres — query it however you like.",
  },
];

export default function Landing() {
  useAuthedRedirect();
  const configured = isSupabaseConfigured();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-parchment-50 text-stone-900 antialiased">
      {/* Top nav */}
      <header
        className={`sticky top-0 z-50 transition ${
          scrolled ? "border-b border-stone-200/70 glass" : ""
        }`}
      >
        <div className="container mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-stone-900">
            <Logo size={32} />
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-stone-700 md:flex">
            <a href="#features" className="hover:text-stone-900">Features</a>
            <a href="#how" className="hover:text-stone-900">How it works</a>
            <a href="#stack" className="hover:text-stone-900">Stack</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="outline" size="md">
                Sign in
              </Button>
            </Link>
            <Link to={configured ? "/login?provider=google" : "/login"}>
              <Button size="md" iconRight={<ArrowRight className="h-4 w-4" />}>
                Open the portal
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(70% 50% at 30% 10%, rgba(79,70,229,0.10), transparent 60%), radial-gradient(50% 40% at 80% 30%, rgba(245,158,11,0.10), transparent 60%)",
          }}
        />
        <div className="container mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <div className="flex flex-col items-center text-center">
            <Badge tone="indigo" className="mb-6">
              <Sparkles className="h-3 w-3" />
              For local churches · Powered by Supabase + Vercel
            </Badge>
            <h1 className="font-serif text-balance text-4xl font-semibold leading-tight text-stone-900 sm:text-6xl">
              Faithful stewardship,
              <br />
              <span className="gradient-text-serif">beautifully tracked.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-balance text-lg leading-relaxed text-stone-600">
              GraceLedger is the free, secure cloud home for your church's
              giving, expenses, and year-end giving statements. Built for the
              treasurer who wants clarity without spreadsheets.
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
              <Link to="/login">
                <Button size="lg" iconLeft={<Receipt className="h-4 w-4" />}>
                  Sign in with Google
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline">
                  Continue with email
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-stone-500">
              No credit card. Free forever for local congregations.
            </p>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section id="stack" className="border-y border-stone-200/70 bg-white/60 backdrop-blur">
        <div className="container mx-auto grid max-w-6xl grid-cols-2 items-center gap-6 px-6 py-6 sm:grid-cols-4">
          {[
            { icon: <Database className="h-4 w-4" />, label: "Postgres + RLS" },
            { icon: <Cloud className="h-4 w-4" />, label: "Vercel free tier" },
            { icon: <Shield className="h-4 w-4" />, label: "Encrypted receipts" },
            { icon: <Lock className="h-4 w-4" />, label: "1–2 super admins" },
          ].map((t) => (
            <div key={t.label} className="flex items-center justify-center gap-2 text-sm text-stone-600">
              <span className="text-accent">{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="font-serif text-3xl font-semibold text-stone-900 sm:text-4xl">
            Everything a modern treasurer needs — nothing they don't.
          </h2>
          <p className="mt-4 text-stone-600">
            Six careful flows replace the binder full of spreadsheets. Audit
            trails, role-based access, and printable PDFs are first-class citizens.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-stone-200 bg-white p-6 shadow-soft transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-lg"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent transition group-hover:bg-indigo-100">
                {f.icon}
              </div>
              <h3 className="mt-4 font-serif text-lg font-semibold text-stone-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-stone-200/70 bg-parchment-100/40">
        <div className="container mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl font-semibold text-stone-900 sm:text-4xl">
            Up and running before lunch.
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-xl border border-stone-200 bg-white p-6">
                <div className="font-serif text-3xl font-semibold text-accent">{s.n}</div>
                <div className="mt-3 font-serif text-lg font-semibold text-stone-900">
                  {s.title}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, rgba(79,70,229,0.08) 50%, transparent 100%)",
          }}
        />
        <div className="container mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="font-serif text-3xl font-semibold text-stone-900 sm:text-4xl">
            Ready to bring clarity to your church finances?
          </h2>
          <p className="mt-3 text-stone-600">
            Spin up a Supabase project, paste your keys into Freebuff, and ship.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/login">
              <Button size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
                Open the portal
              </Button>
            </Link>
            <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
              <Button size="lg" variant="outline">
                Create a free Supabase project
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200/70 bg-white/60">
        <div className="container mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-stone-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span>© {new Date().getFullYear()} GraceLedger</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://supabase.com" target="_blank" rel="noreferrer" className="hover:text-stone-700">
              Supabase
            </a>
            <a href="https://vercel.com" target="_blank" rel="noreferrer" className="hover:text-stone-700">
              Vercel
            </a>
            <a href="https://github.com/sangeethdba/church-portal" target="_blank" rel="noreferrer" className="hover:text-stone-700">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
