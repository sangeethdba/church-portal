import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Users, HandCoins, Receipt, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { donationTypeLabel } from "@/lib/accounting";

type SearchResult = {
  id: string;
  type: "donor" | "donation" | "expense";
  title: string;
  subtitle: string;
  amount?: number;
  route: string;
};

export default function SearchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelected(0);
    }
  }, [open]);

  // Search across tables with debounce
  useEffect(() => {
    if (!query.trim() || !supabase) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      const q = `%${query.trim()}%`;
      const [donors, donations, expenses] = await Promise.all([
        supabase
          .from("donors")
          .select("id, first_name, last_name")
          .or(`first_name.ilike.${q},last_name.ilike.${q}`)
          .limit(5),
        supabase
          .from("donations")
          .select("id, donor_name, amount, donation_date, donation_type, payment_method")
          .or(`donor_name.ilike.${q},donation_type.ilike.${q}`)
          .order("donation_date", { ascending: false })
          .limit(5),
        supabase
          .from("expenses")
          .select("id, title, description, category, amount, status, submitted_at")
          .or(`title.ilike.${q},description.ilike.${q},category.ilike.${q}`)
          .order("submitted_at", { ascending: false })
          .limit(5),
      ]);

      const r: SearchResult[] = [];
      (donors.data ?? []).forEach((d: Record<string, unknown>) =>
        r.push({
          id: d.id as string,
          type: "donor",
          title: `${d.first_name} ${d.last_name}`,
          subtitle: "Donor",
          route: "/donors",
        }),
      );
      (donations.data ?? []).forEach((d: Record<string, unknown>) =>
        r.push({
          id: d.id as string,
          type: "donation",
          title: d.donor_name as string,
          subtitle: `${formatDate(d.donation_date as string)} · ${donationTypeLabel(d.donation_type as string)} · ${d.payment_method}`,
          amount: Number(d.amount ?? 0),
          route: "/donations",
        }),
      );
      (expenses.data ?? []).forEach((e: Record<string, unknown>) =>
        r.push({
          id: e.id as string,
          type: "expense",
          title: (e.title ?? e.description ?? "Expense") as string,
          subtitle: `${formatDate(e.submitted_at as string)} · ${e.category} · ${e.status}`,
          amount: Number(e.amount ?? 0),
          route: "/expenses",
        }),
      );

      setResults(r);
      setSelected(0);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter" && results[selected]) {
        e.preventDefault();
        navigate(results[selected].route);
        onClose();
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [results, selected, navigate, onClose],
  );

  useEffect(() => {
    if (open) window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, handleKey]);

  if (!open) return null;

  const typeIcon = (t: string) =>
    t === "donor" ? (
      <Users className="h-4 w-4" />
    ) : t === "donation" ? (
      <HandCoins className="h-4 w-4" />
    ) : (
      <Receipt className="h-4 w-4" />
    );

  const typeLabel = (t: string) =>
    t === "donor" ? "Donor" : t === "donation" ? "Donation" : "Expense";

  const byType = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg rounded-xl border border-stone-200 bg-white shadow-2xl">
        {/* Input */}
        <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
          <Search className="h-4 w-4 text-stone-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search donors, donations, expenses…"
            className="flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400"
          />
          <kbd className="hidden rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] font-medium text-stone-400 sm:inline">
            esc
          </kbd>
          <button
            onClick={onClose}
            className="rounded p-1 text-stone-400 hover:bg-stone-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-stone-400">
              Searching…
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-stone-400">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}

          {!loading &&
            !query && (
              <div className="px-4 py-8 text-center text-sm text-stone-400">
                Type to search across donors, donations, and expenses
              </div>
            )}

          {Object.entries(byType).map(([type, items]) => (
            <div key={type}>
              <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                {typeLabel(type)}s
              </div>
              {items.map((r, i) => {
                const idx = results.indexOf(r);
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      navigate(r.route);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                      idx === selected
                        ? "bg-indigo-50"
                        : "hover:bg-stone-50"
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-500">
                      {typeIcon(r.type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-stone-900">
                        {r.title}
                      </div>
                      <div className="truncate text-xs text-stone-500">
                        {r.subtitle}
                      </div>
                    </div>
                    {r.amount != null && (
                      <span className="shrink-0 font-serif text-sm font-semibold text-stone-700">
                        {formatCurrency(r.amount)}
                      </span>
                    )}
                    <ArrowRight className="h-3 w-3 shrink-0 text-stone-300" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="border-t border-stone-100 px-4 py-2 text-[10px] text-stone-400">
          <kbd className="rounded border border-stone-200 bg-stone-50 px-1 py-0.5 font-medium">
            ↑↓
          </kbd>{" "}
          navigate ·{" "}
          <kbd className="rounded border border-stone-200 bg-stone-50 px-1 py-0.5 font-medium">
            ↵
          </kbd>{" "}
          open
        </div>
      </div>
    </div>
  );
}
