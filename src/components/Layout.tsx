import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavLink, Outlet, useNavigate, useLocation, useOutletContext } from "react-router-dom";
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
  { to: "/donors", label: "Donors", icon: Users, roles: ["admin"] as string[] },
  { to: "/tax-report", label: "Tax report", icon: FileText, roles: ["admin"] as string[] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] as string[] },
];

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
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
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-purple-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
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
          className={`fixed inset-y-0 left-0 z-50 w-72 -translate-x-full border-r border-purple-100 bg-white px-5 py-6 transition lg:static lg:translate-x-0 ${
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
            {visibleItems.map(({ to, label, icon: Icon }, idx) => (
              <motion.div
                key={to}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04, duration: 0.3 }}
              >
              <NavLink
                to={to}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-purple-100 text-purple-700 shadow-sm"
                      : "text-stone-600 hover:bg-purple-50/50 hover:text-purple-700"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-4 w-4 transition ${isActive ? "text-purple-600" : "text-stone-400 group-hover:text-purple-500"}`} />
                    {label}
                    {isActive && <motion.div layoutId="active-dot" className="ml-auto h-1.5 w-1.5 rounded-full bg-purple-500" />}
                  </>
                )}
              </NavLink>
              </motion.div>
            ))}
          </nav>

          <div className="mt-8 rounded-xl border border-purple-100 bg-purple-50/40 p-4 transition hover:border-purple-200">
            <div className="flex items-center gap-2 font-serif font-semibold text-stone-900">
              <Church className="h-4 w-4 text-purple-600" />
              {ctx.profile?.church_name && ctx.profile.church_name !== "Grace Community Church" ? ctx.profile.church_name : "Atlanta Little Flock Church"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={isAdmin ? "indigo" : ctx.isCounter ? "amber" : "neutral"}>
                {isAdmin ? "Admin" : ctx.isCounter ? "Counter" : "Member"}
              </Badge>
            </div>
          </div>

          <div className="mt-6">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-stone-500 hover:text-stone-700 hover:bg-stone-100"
              onClick={onSignOut}
              iconLeft={<LogOut className="h-4 w-4" />}
            >
              Sign out
            </Button>
          </div>
        </aside>

        {/* Main with page transitions */}
        <main className="px-4 py-8 sm:px-8 lg:px-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              <Outlet context={ctx} />
            </motion.div>
          </AnimatePresence>
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
