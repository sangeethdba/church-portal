import { useEffect, useState } from "react";
import {
  FileText, Image as ImageIcon, ExternalLink, Paperclip, CheckCircle2,
  Clock, XCircle, Banknote, Eye, ShieldCheck, Receipt as ReceiptIcon,
} from "lucide-react";
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, EmptyState,
} from "@/components/ui";
import { getReceiptUrl } from "@/lib/supabase";
import type { Expense } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

const statusTone = (s: string) =>
  s === "paid" || s === "auto_paid"
    ? "emerald"
    : s === "rejected"
      ? "rose"
      : s === "approved"
        ? "indigo"
        : "amber";

function isImagePath(p: string) {
  return /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(p);
}

function fileName(p: string) {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

/**
 * Full audit view of one expense — the status timeline, every submitted bill
 * receipt (from the batch line items and/or the expense), and the bank transfer
 * receipt that cleared the reimbursement. Used by members ("My bills") and
 * admins (Expenses page) so anyone can verify bills and transfer proof anytime.
 */
export default function ReceiptViewer({
  expense,
  open,
  onOpenChange,
}: {
  expense: Expense | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});

  // Collect every stored receipt path: line-item bills + expense receipts + transfer proof
  const billPaths = expense
    ? [
        ...(expense.line_items ?? []).map((li) => li.receipt_path).filter((p): p is string => !!p),
        ...(expense.receipt_paths ?? []),
      ]
    : [];
  const transferPath = expense?.transfer_receipt_path ?? null;

  useEffect(() => {
    if (!open || !expense) return;
    let cancelled = false;
    const paths = [...billPaths, ...(transferPath ? [transferPath] : [])];
    (async () => {
      const entries = await Promise.all(
        paths.map(async (p) => [p, await getReceiptUrl(p)] as const),
      );
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [p, url] of entries) if (url) map[p] = url;
      setReceiptUrls(map);
    })();
    return () => { cancelled = true; };
  }, [open, expense?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!expense) return null;

  const timeline = [
    { label: "Submitted", date: expense.submitted_at, done: true, icon: Clock },
    {
      label: expense.status === "rejected" ? "Rejected" : "Approved",
      date: expense.approved_at ?? null,
      done: expense.status === "approved" || expense.status === "paid" || expense.status === "auto_paid" || expense.status === "rejected",
      icon: expense.status === "rejected" ? XCircle : CheckCircle2,
      danger: expense.status === "rejected",
    },
    {
      label: "Cleared (reimbursed)",
      date: expense.paid_at ?? null,
      done: expense.status === "paid" || expense.status === "auto_paid",
      icon: Banknote,
    },
  ];

  const ReceiptCard = ({ path }: { path: string }) => {
    const url = receiptUrls[path];
    const img = isImagePath(path);
    return (
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="flex h-28 items-center justify-center bg-stone-50">
          {img ? (
            <img
              src={url || undefined}
              alt={fileName(path)}
              className="h-full w-full object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-stone-400">
              <FileText className="h-7 w-7" />
              <span className="px-2 text-center text-[10px] uppercase tracking-wide">PDF</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-2.5 py-2">
          <span className="truncate text-xs text-stone-600" title={fileName(path)}>
            {fileName(path)}
          </span>
          <a
            href={url ?? "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => { if (!url) e.preventDefault(); }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
          >
            <ExternalLink className="h-3 w-3" /> Open
          </a>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <ReceiptIcon className="h-5 w-5 text-indigo-600" />
            {expense.title ?? expense.description?.slice(0, 60) ?? "Expense"}
          </DialogTitle>
          <DialogDescription>
            {formatCurrency(expense.amount)} · {expense.category} · Submitted {formatDate(expense.submitted_at)}
            <span className="ml-2"><Badge tone={statusTone(expense.status)}>{expense.status.replace("_", " ")}</Badge></span>
          </DialogDescription>
        </DialogHeader>

        {/* ── Status timeline ─────────────────────────────────────────── */}
        <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-4">
          <div className="flex items-start justify-between gap-2">
            {timeline.map((step, i) => (
              <div key={step.label} className="flex flex-1 items-start gap-2">
                <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${step.done ? (step.danger ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-700") : "bg-stone-200 text-stone-400"}`}>
                  <step.icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className={`text-xs font-medium ${step.done ? "text-stone-800" : "text-stone-400"}`}>{step.label}</div>
                  <div className="text-[11px] text-stone-500">{step.date ? formatDate(step.date) : "—"}</div>
                </div>
                {i < timeline.length - 1 && <div className="mt-3 h-px flex-1 bg-stone-200" />}
              </div>
            ))}
          </div>
          {expense.status === "paid" || expense.status === "auto_paid" ? (
            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Reimbursement cleared — bank transfer receipt attached below.
            </div>
          ) : expense.status === "pending" ? (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-stone-500">
              <Clock className="h-3.5 w-3.5" />
              Waiting for the treasurer to review your bills.
            </div>
          ) : null}
        </div>

        {/* ── Submitted bills & receipts ──────────────────────────────── */}
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Paperclip className="h-4 w-4 text-stone-500" /> Submitted bills &amp; receipts
          </div>
          {billPaths.length === 0 ? (
            <EmptyState
              icon={<ImageIcon className="h-6 w-6" />}
              title="No receipts attached"
              description="This expense was recorded without an uploaded bill or receipt."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {billPaths.map((p) => <ReceiptCard key={p} path={p} />)}
            </div>
          )}
        </div>

        {/* ── Line items breakdown ────────────────────────────────────── */}
        {expense.line_items && expense.line_items.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-sm font-semibold text-stone-800">Bill breakdown</div>
            <div className="overflow-hidden rounded-lg border border-stone-200">
              {expense.line_items.map((li, i) => (
                <div key={i} className={`flex items-center justify-between px-3 py-2 text-sm ${i % 2 ? "bg-stone-50" : "bg-white"}`}>
                  <span className="min-w-0 flex-1 truncate text-stone-700">{li.description || "Bill"}</span>
                  {li.receipt_path && receiptUrls[li.receipt_path] && (
                    <a href={receiptUrls[li.receipt_path]} target="_blank" rel="noreferrer"
                      className="mr-3 inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-indigo-700 hover:underline">
                      <Eye className="h-3 w-3" /> view
                    </a>
                  )}
                  <span className="shrink-0 font-mono font-medium text-stone-900">{formatCurrency(li.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-stone-200 bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-900">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(expense.amount)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Bank transfer receipt (reimbursement proof) ─────────────── */}
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Banknote className="h-4 w-4 text-emerald-600" /> Bank transfer receipt
          </div>
          {transferPath ? (
            <ReceiptCard path={transferPath} />
          ) : (
            <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-3 py-3 text-xs text-stone-500">
              {expense.status === "paid" || expense.status === "auto_paid"
                ? "This reimbursement was cleared, but no transfer receipt was uploaded."
                : "No transfer receipt yet — the treasurer uploads this after the manual bank transfer clears the reimbursement."}
            </div>
          )}
        </div>

        {/* ── Notes ───────────────────────────────────────────────────── */}
        {expense.notes && (
          <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm text-stone-700">
            <span className="font-medium text-amber-800">Notes: </span>{expense.notes}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
