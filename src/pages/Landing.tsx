import { Link } from "react-router-dom";
import {
  HandCoins, Receipt, FileText, Shield, Sparkles, ArrowRight, Banknote,
  Heart, Wallet, PieChart, CalendarDays, Users, Globe,
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
    icon: <Banknote className="h-5 w-5" />,
    title: "Sunday offerings, counted right",
    body: "Cash by denomination, individual checks per donor, dual-counter sign-off, and a printable bank deposit slip for every service.",
  },
  {
    icon: <Receipt className="h-5 w-5" />,
    title: "Member reimbursements with receipts",
    body: "Members attach each bill, explain missing receipts, and reply to clarification — the treasurer reviews and settles with bank proof.",
  },
  {
    icon: <CalendarDays className="h-5 w-5" />,
    title: "Event-tagged expenses",
    body: "Tag spend to VBS, the annual conference, Sunday snacks, youth meetings — and see each event's true cost.",
  },
  {
    icon: <PieChart className="h-5 w-5" />,
    title: "Category spend reports",
    body: "Rent, salaries, missions, travel, supplies — one chart shows where the money goes, so the church can steward it better.",
  },
  {
    icon: <FileText className="h-5 w-5" />,
    title: "Annual tax statements",
    body: "The treasurer generates IRS-friendly giving statements and shares them with each member — one click per donor.",
  },
  {
    icon: <Shield className="h-5 w-5" />,
    title: "Private by default",
    body: "Members see only their own giving and bills. Treasurers see the church. Row-level security keeps it that way.",
  },
];

const steps = [
  {
    n: "01",
    title: "Sign in with your church account",
    body: "Members and treasurers sign in with Google or email. New accounts land in the access list for approval.",
  },
  {
    n: "02",
    title: "Record offerings & expenses",
    body: "Count Sunday's offering with a second counter, log direct debits like rent and utilities, and approve member reimbursements.",
  },
  {
    n: "03",
    title: "Review and share",
    body: "Watch category charts, print deposit slips, settle reimbursements with bank proof, and issue year-end statements.",
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
      <header className={`sticky top-0 z-50 transition ${scrolled ? "border-b border-stone-200/70 glass" : ""}`}>
        <div className="container mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-stone-900">
            <Logo size={32} />
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-stone-700 md:flex">
            <a href="#features" className="hover:text-stone-900">Features</a>
            <a href="#how" className="hover:text-stone-900">How it works</a>
            <a href="https://atlantalittleflock.org" target="_blank" rel="noreferrer" className="hover:text-stone-900">
              Church website
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="outline" size="md">Sign in</Button>
            </Link>
            <Link to={configured ? "/login?provider=google" : "/login"}>
              <Button size="md" iconRight={<ArrowRight className="h-4 w-4" />}>Open the portal</Button>
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
              "radial-gradient(70% 50% at 30% 10%, rgba(79,70,229,0.10), transparent 60%), radial-gradient(50% 40% at 80% 30%, rgba(180,83,9,0.12), transparent 60%)",
          }}
        />
        <div className="container mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <div className="flex flex-col items-center text-center">
            <Badge tone="indigo" className="mb-6">
              <Sparkles className="h-3 w-3" />
              Atlanta Little Flock Church · Stewardship Portal
            </Badge>
            <h1 className="font-serif text-balance text-4xl font-semibold leading-tight text-stone-900 sm:text-6xl">
              Faithful stewardship,
              <br />
              <span className="gradient-text-serif">beautifully tracked.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-balance text-lg leading-relaxed text-stone-600">
              The secure cloud home for our church's offerings, expenses, and year-end giving
              statements — from Sunday's counting table to the annual review of where every
              dollar was stewarded.
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
              <Link to="/login">
                <Button size="lg" iconLeft={<HandCoins className="h-4 w-4" />}>
                  Sign in with Google
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline">Continue with email</Button>
              </Link>
            </div>
            <p className="mt-6 flex items-center gap-2 font-serif text-lg italic text-stone-500">
              <Heart className="h-4 w-4 text-amber-600" />
              “Fear not, little flock…” — Luke 12:32
            </p>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-stone-200/70 bg-white/60 backdrop-blur">
        <div className="container mx-auto grid max-w-6xl grid-cols-2 items-center gap-6 px-6 py-6 sm:grid-cols-4">
          {[
            { icon: <Banknote className="h-4 w-4" />, label: "Weekly deposit slips" },
            { icon: <Users className="h-4 w-4" />, label: "Dual-counter sign-off" },
            { icon: <PieChart className="h-4 w-4" />, label: "Category spend charts" },
            { icon: <Shield className="h-4 w-4" />, label: "Members see only their own" },
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
            Everything a faithful treasurer needs — nothing they don't.
          </h2>
          <p className="mt-4 text-stone-600">
            From the offering plate to the bank deposit, from a member's receipt to the yearly
            review — every flow is recorded, verifiable, and reportable.
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
            From Sunday to year-end, in three steps.
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-xl border border-stone-200 bg-white p-6">
                <div className="font-serif text-3xl font-semibold text-accent">{s.n}</div>
                <div className="mt-3 font-serif text-lg font-semibold text-stone-900">{s.title}</div>
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
          style={{ background: "linear-gradient(180deg, transparent 0%, rgba(79,70,229,0.08) 50%, transparent 100%)" }}
        />
        <div className="container mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="font-serif text-3xl font-semibold text-stone-900 sm:text-4xl">
            Ready to bring clarity to our church finances?
          </h2>
          <p className="mt-3 text-stone-600">
            Sign in with your church account and let the portal handle the faithful details.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/login">
              <Button size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>Open the portal</Button>
            </Link>
            <a href="https://atlantalittleflock.org" target="_blank" rel="noreferrer">
              <Button size="lg" variant="outline" iconLeft={<Globe className="h-4 w-4" />}>
                Visit our church website
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
            <span>© {new Date().getFullYear()} Atlanta Little Flock Church</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://atlantalittleflock.org" target="_blank" rel="noreferrer" className="hover:text-stone-700">
              atlantalittleflock.org
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
