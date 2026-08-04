import { useState, useEffect } from "react";
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
  Upload,
  Calculator,
  Search,
} from "lucide-react";
import Logo from "./Logo";
import SearchModal from "./SearchModal";
import { Button, Badge } from "./ui";
import { signOut } from "@/lib/auth";
import { isAdminRole, isPastorRole, type Profile } from "@/lib/supabase";

const allItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["member", "admin"] as string[] },
  { to: "/my", label: "My giving & bills", icon: Wallet, roles: ["member", "admin"] as string[] },
  { to: "/offerings", label: "Offerings", icon: Banknote, roles: ["admin"] as string[] },
  { to: "/donations", label: "Donations", icon: HandCoins, roles: ["admin"] as string[] },
  { to: "/expenses", label: "Expenses", icon: Receipt, roles: ["member", "admin"] as string[] },
  { to: "/donors", label: "Donors", icon: Users, roles: ["admin"] as string[] },
  { to: "/tax-report", label: "Tax report", icon: FileText, roles: ["admin"] as string[] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] as string[] },
  { to: "/import", label: "Import", icon: Upload, roles: ["admin"] as string[] },
  { to: "/annual-report", label: "Annual report", icon: FileText, roles: ["admin"] as string[] },
  { to: "/reconciliation", label: "Reconciliation", icon: Calculator, roles: ["admin"] as string[] },
];

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const ctx = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  const isAdmin = isAdminRole(ctx.profile?.role);
  // The pastor is a read-only overseer — every ledger page except Import,
  // which is a bulk-write flow with no read-only purpose.
  const isPastor = isPastorRole(ctx.profile?.role);

  const visibleItems = allItems.filter((item) => {
    if (item.roles.includes("admin") && (isAdmin || (isPastor && item.to !== "/import"))) return true;
    // Counters are regular members too — they only verify/sign off, so they get
    // the member navigation, never the admin-only ledger pages.
    if (item.roles.includes("member") && !isAdmin) return true;
    return false;
  });

  const onSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  // Global search keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-[#FEF7ED] text-[#3C2A1E]">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-[#EDE4D8] bg-[#FFFBF5]/95 px-4 py-3 backdrop-blur lg:hidden">
        <Logo size={28} />
        <div className="flex items-center gap-2">
          <button
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
            className="rounded-md p-2 text-[#78716C] hover:bg-[#FDF2E9]"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md p-2 text-[#78716C] hover:bg-[#FDF2E9]"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 -translate-x-full border-r border-[#EDE4D8] bg-[#FFFBF5] px-5 py-6 transition lg:static lg:translate-x-0 ${
            drawerOpen ? "translate-x-0" : ""
          }`}
        >
          <div className="mb-8 flex items-center justify-between">
            <Logo size={32} />
            <button
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
              className="rounded-md p-2 text-[#78716C] hover:bg-[#FDF2E9] lg:hidden"
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
                      ? "bg-[#FDF2E9] text-[#C67B5C] shadow-sm"
                      : "text-[#78716C] hover:bg-[#FDF2E9]/60 hover:text-[#C67B5C]"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-4 w-4 transition ${isActive ? "text-[#C67B5C]" : "text-[#C4A77D] group-hover:text-[#C67B5C]"}`} />
                    {label}
                    {isActive && <motion.div layoutId="active-dot" className="ml-auto h-1.5 w-1.5 rounded-full bg-[#C67B5C]" />}
                  </>
                )}
              </NavLink>
              </motion.div>
            ))}
          </nav>

          {/* Global search — desktop */}
          <button
            onClick={() => setSearchOpen(true)}
            className="mt-6 flex w-full items-center gap-2.5 rounded-lg border border-[#EDE4D8] bg-white px-3 py-2.5 text-sm text-[#78716C] transition hover:border-[#C67B5C]/40 hover:text-[#C67B5C]"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="hidden rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] font-medium text-stone-400 lg:inline">
              {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}K
            </kbd>
          </button>

          <div className="mt-4 rounded-xl border border-[#EDE4D8] bg-[#FDF2E9]/50 p-4 transition hover:border-[#C67B5C]/30">
            <div className="flex items-center gap-2 font-serif font-semibold text-stone-900">
              <Church className="h-4 w-4 text-[#C67B5C]" />
              {ctx.profile?.church_name && ctx.profile.church_name !== "Grace Community Church" ? ctx.profile.church_name : "Atlanta Little Flock Church"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={isAdmin ? "indigo" : isPastor ? "emerald" : ctx.isCounter ? "amber" : "neutral"}>
                {isAdmin ? "Admin" : isPastor ? "Pastor · View only" : ctx.isCounter ? "Counter" : "Member"}
              </Badge>
            </div>
          </div>

          <div className="mt-6">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-stone-500 hover:text-[#78716C] hover:bg-[#FDF2E9]"
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
          className="fixed inset-0 z-40 bg-[#3C2A1E]/30 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Global search modal */}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
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
          <h1 className="font-serif text-2xl font-semibold text-[#3C2A1E] sm:text-3xl">{title}</h1>
          {badge && <Badge tone="indigo">{badge}</Badge>}
        </div>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm text-[#78716C]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
