import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useOutletContext } from "react-router-dom";
import {
  FileText, Image as ImageIcon, ExternalLink, Paperclip, CheckCircle2,
  Clock, XCircle, Banknote, Eye, ShieldCheck, Receipt as ReceiptIcon,
  MessageSquare, Send, Upload,
} from "lucide-react";
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, EmptyState, Label, Textarea,
} from "@/components/ui";
import { getReceiptUrl, buildReceiptPath, isAdminRole, normalizeLineItems, supabase } from "@/lib/supabase";
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
 * Full audit view of one expense — the status timeline, the clarification
 * thread (admin question → member reply), every submitted bill receipt (from
 * the batch line items and/or the expense), and the bank transfer receipt that
 * cleared the reimbursement. Used by members ("My bills") and admins (Expenses
 * page) so anyone can verify bills and transfer proof anytime.
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
  const ctx = useOutletContext<{ profile: { id?: string; role?: string } | null }>();
  const [data, setData] = useState<Expense | null>(expense);
  useEffect(() => {
    setData(expense);
  }, [expense]);

  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [attachIndex, setAttachIndex] = useState<number | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Collect every stored receipt path: line-item bills + expense receipts + transfer proof
  const lineItems = normalizeLineItems(data?.line_items);
  const billPaths = data
    ? [
        ...lineItems.map((li) => li.receipt_path).filter((p): p is string => !!p),
        ...(data.receipt_paths ?? []),
      ]
    : [];
  const transferPath = data?.transfer_receipt_path ?? null;

  useEffect(() => {
    if (!open || !data) return;
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
  }, [open, data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOwner = data ? data.user_id === ctx.profile?.id : false;
  const awaitingReply =
    !!data?.admin_note && !data?.member_reply && data?.status === "pending" && isOwner;
  // Owner can attach missing bills while pending; admins can attach anytime.
  const canAttach = data
    ? isAdminRole(ctx.profile?.role) || (isOwner && data.status === "pending")
    : false;

  const handleReply = async () => {
    if (!data || !replyText.trim() || !supabase) return;
    setReplying(true);
    const { error } = await supabase.rpc("reply_to_expense", {
      p_expense_id: data.id,
      p_reply: replyText.trim(),
    });
    if (!error) {
      setData({ ...data, member_reply: replyText.trim(), member_reply_at: new Date().toISOString() });
      setReplyText("");
    } else {
      console.warn("Reply failed:", error);
    }
    setReplying(false);
  };

  const handleAttach = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !data || attachIndex === null || !supabase) return;
    setAttachBusy(true);
    // Store under the expense owner's folder so the owner can always read it back.
    const path = buildReceiptPath(data.user_id ?? ctx.profile?.id, "line-items", file.name);
    const { error } = await supabase.storage.from("receipts").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (!error) {
      const { error: rpcErr } = await supabase.rpc("attach_receipt_to_expense", {
        p_expense_id: data.id,
        p_line_index: attachIndex,
        p_path: path,
      });
      if (!rpcErr) {
        setData({
          ...data,
          line_items: normalizeLineItems(data.line_items).map((li, i) =>
            i === attachIndex ? { ...li, receipt_path: path } : li,
          ),
        });
        const url = await getReceiptUrl(path);
        if (url) setReceiptUrls((m) => ({ ...m, [path]: url }));
      } else {
        console.warn("Attach receipt failed:", rpcErr);
      }
    } else {
      console.warn("Receipt upload failed:", error);
    }
    setAttachBusy(false);
    setAttachIndex(null);
  };

  if (!data) return null;

  const timeline = [
    { label: "Submitted", date: data.submitted_at, done: true, icon: Clock },
    {
      label: data.status === "rejected" ? "Rejected" : "Approved",
      date: data.approved_at ?? null,
      done: data.status === "approved" || data.status === "paid" || data.status === "auto_paid" || data.status === "rejected",
      icon: data.status === "rejected" ? XCircle : CheckCircle2,
      danger: data.status === "rejected",
    },
    {
      label: "Cleared (reimbursed)",
      date: data.paid_at ?? null,
      done: data.status === "paid" || data.status === "auto_paid",
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
            {data.title ?? data.description?.slice(0, 60) ?? "Expense"}
          </DialogTitle>
          <DialogDescription>
            {formatCurrency(data.amount)} · {data.category} · Submitted {formatDate(data.submitted_at)}
            <span className="ml-2"><Badge tone={statusTone(data.status)}>{data.status.replace("_", " ")}</Badge></span>
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
          {data.status === "paid" || data.status === "auto_paid" ? (
            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Reimbursement cleared — bank transfer receipt attached below. Approval alone is not settlement.
            </div>
          ) : data.status === "pending" && data.admin_note ? (
            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <MessageSquare className="h-3.5 w-3.5" />
              Waiting on your reply to the treasurer's clarification request.
            </div>
          ) : data.status === "pending" ? (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-stone-500">
              <Clock className="h-3.5 w-3.5" />
              Waiting for the treasurer to review your bills.
            </div>
          ) : null}
        </div>

        {/* ── Clarification thread ────────────────────────────────────── */}
        {(data.admin_note || data.member_reply) && (
          <div className="mt-4 space-y-2">
            {data.admin_note && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Clarification requested {data.admin_note_at ? `· ${formatDate(data.admin_note_at)}` : ""}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-stone-700">{data.admin_note}</p>
              </div>
            )}
            {data.member_reply && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Member reply {data.member_reply_at ? `· ${formatDate(data.member_reply_at)}` : ""}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-stone-700">{data.member_reply}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Member reply box ────────────────────────────────────────── */}
        {awaitingReply && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <Label htmlFor="reply-note" className="text-xs font-medium text-amber-800">
              Reply to the treasurer
            </Label>
            <Textarea
              id="reply-note"
              rows={3}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              className="mt-1.5"
              placeholder="Answer the question or provide the missing details…"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={handleReply} disabled={replying || !replyText.trim()} iconLeft={<Send className="h-3.5 w-3.5" />}>
                {replying ? "Sending…" : "Send reply"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Submitted bills & receipts ──────────────────────────────── */}
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Paperclip className="h-4 w-4 text-stone-500" /> Submitted bills &amp; receipts
          </div>
          {billPaths.length === 0 ? (
            <EmptyState
              icon={<ImageIcon className="h-6 w-6" />}
              title="No receipts attached"
              description={canAttach
                ? "No bill images yet — click Attach bill under each bill in the breakdown to add them now."
                : "This expense was recorded without an uploaded bill or receipt."}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {billPaths.map((p) => <ReceiptCard key={p} path={p} />)}
            </div>
          )}
        </div>

        {/* ── Line items breakdown ────────────────────────────────────── */}
        {lineItems.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-sm font-semibold text-stone-800">Bill breakdown</div>
            <div className="overflow-hidden rounded-lg border border-stone-200">
              {lineItems.map((li, i) => (
                <div key={i} className={`px-3 py-2 text-sm ${i % 2 ? "bg-stone-50" : "bg-white"}`}>
                  <div className="flex items-center justify-between">
                    <span className="min-w-0 flex-1 truncate text-stone-700">{li.description || "Bill"}</span>
                    {li.receipt_path && receiptUrls[li.receipt_path] && (
                      <a href={receiptUrls[li.receipt_path]} target="_blank" rel="noreferrer"
                        className="mr-3 inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-indigo-700 hover:underline">
                        <Eye className="h-3 w-3" /> view
                      </a>
                    )}
                    {canAttach && !li.receipt_path && (
                      <button
                        type="button"
                        onClick={() => { setAttachIndex(i); fileInputRef.current?.click(); }}
                        disabled={attachBusy}
                        className="mr-3 inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-600 transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
                      >
                        <Upload className="h-3 w-3" /> {attachBusy && attachIndex === i ? "Uploading…" : "Attach bill"}
                      </button>
                    )}
                    <span className="shrink-0 font-mono font-medium text-stone-900">{formatCurrency(li.amount)}</span>
                  </div>
                  {li.no_receipt_note && (
                    <div className="mt-1 flex items-start gap-1 text-[11px] italic text-amber-700">
                      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>No receipt — {li.no_receipt_note}</span>
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-stone-200 bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-900">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(data.amount)}</span>
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
              {data.status === "paid" || data.status === "auto_paid"
                ? "This reimbursement was cleared, but no transfer receipt was uploaded."
                : "No transfer receipt yet — the treasurer uploads this after the manual bank transfer clears the reimbursement. The expense is only completed once this receipt exists."}
            </div>
          )}
        </div>

        {/* ── Notes ───────────────────────────────────────────────────── */}
        {data.notes && (
          <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm text-stone-700">
            <span className="font-medium text-amber-800">Notes: </span>{data.notes}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={handleAttach}
        />
        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
