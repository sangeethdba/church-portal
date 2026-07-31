import { useState } from "react";
import { NavLink, Outlet, useNavigate, useOutletContext } from "react-router-dom";
import {
  LayoutDashboard,
  HandCoins,
  Receipt,
  Users,
  FileText,
  BarChart3,
  Menu,
  X,
  LogOut,
  Church,
  Banknote,
  Shield,
  Wallet,
} from "lucide-react";
import Logo from "./Logo";
import { Button, Badge } from "./ui";
import { signOut } from "@/lib/auth";
import { isAdminRole, type Profile } from "@/lib/supabase";

const allItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["member", "admin"] as string[] },
  { to: "/my", label: "My giving & bills", icon: Wallet, roles: ["member", "admin"] as string[] },
  { to: "/offerings", label: "Offerings", icon: Banknote, roles: ["admin"] as string[] },
  { to: "/donations", label: "Donations", icon: HandCoins, roles: ["admin"] as string[] },
  { to: "/expenses", label: "Expenses", icon: Receipt, roles: ["member", "admin"] as string[] },
  { to: "/donors", label: "Donors", icon: Users, roles: ["member", "admin"] as string[] },
  { to: "/tax-report", label: "Tax report", icon: FileText, roles: ["admin"] as string[] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] as string[] },
];

export default function AppShell() {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const ctx = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  const isAdmin = isAdminRole(ctx.profile?.role);

  const visibleItems = allItems.filter((item) => {
    if (item.roles.includes("admin") && isAdmin) return true;
    // Counters are regular members too — they only verify/sign off, so they get
    // the member navigation, never the admin-only ledger pages.
    if (item.roles.includes("member") && !isAdmin) return true;
    return false;
  });

  const onSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-parchment-50 text-stone-900">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-stone-200 bg-white/80 px-4 py-3 backdrop-blur lg:hidden">
        <Logo size={28} />
        <button
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
          className="rounded-md p-2 text-stone-700 hover:bg-stone-100"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 -translate-x-full border-r border-stone-200 bg-white px-5 py-6 transition lg:static lg:translate-x-0 ${
            drawerOpen ? "translate-x-0" : ""
          }`}
        >
          <div className="mb-8 flex items-center justify-between">
            <Logo size={32} />
            <button
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
              className="rounded-md p-2 text-stone-500 hover:bg-stone-100 lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex flex-col gap-1">
            {visibleItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-accent-soft text-accent"
                      : "text-stone-700 hover:bg-stone-100"
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-8 rounded-xl border border-stone-200 bg-parchment-100/60 p-4">
            <div className="flex items-center gap-2 font-serif font-semibold text-stone-900">
              <Church className="h-4 w-4 text-accent" />
              {ctx.profile?.church_name ?? "Your church"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={isAdmin ? "indigo" : ctx.isCounter ? "amber" : "neutral"}>
                {isAdmin ? "Admin" : ctx.isCounter ? "Counter" : "Member"}
              </Badge>
            </div>
          </div>

          <div className="mt-6">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onSignOut}
              iconLeft={<LogOut className="h-4 w-4" />}
            >
              Sign out
            </Button>
          </div>
        </aside>

        {/* Main */}
        <main className="px-4 py-8 sm:px-8 lg:px-10">
          <Outlet context={ctx} />
        </main>
      </div>

      {drawerOpen && (
        <button
          aria-label="Close menu overlay"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-stone-900/40 backdrop-blur-sm lg:hidden"
        />
      )}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-2xl font-semibold text-stone-900 sm:text-3xl">{title}</h1>
          {badge && <Badge tone="indigo">{badge}</Badge>}
        </div>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm text-stone-600">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
