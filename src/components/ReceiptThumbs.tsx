import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { getReceiptUrl } from "@/lib/supabase";

/**
 * Inline receipt thumbnail strip for expense lists (member + admin views).
 * Shows the attached bill images at a glance; clicking any thumbnail opens the
 * full audit dialog for that expense. Non-image files (PDFs) and images whose
 * signed URL fails fall back to a paperclip chip.
 */
export default function ReceiptThumbs({
  paths,
  onOpen,
}: {
  paths: string[];
  onOpen: () => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(paths.map(async (p) => [p, await getReceiptUrl(p)] as const));
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [p, u] of entries) if (u) map[p] = u;
      setUrls(map);
    })();
    return () => { cancelled = true; };
  }, [paths.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (paths.length === 0) return null;
  const isImg = (p: string) => /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(p);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-stone-400">Receipts:</span>
      {paths.map((p) => {
        const url = urls[p];
        const img = isImg(p);
        return (
          <button
            key={p}
            type="button"
            onClick={onOpen}
            title={p.split("/").pop()}
            className="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-stone-200 bg-stone-50 transition hover:border-indigo-300 hover:shadow-sm"
          >
            {img && url && !failed.has(p) ? (
              <img src={url} alt="" className="h-full w-full object-cover"
                onError={() => setFailed((f) => new Set(f).add(p))} />
            ) : (
              <Paperclip className="h-4 w-4 text-stone-400 transition group-hover:text-indigo-500" />
            )}
          </button>
        );
      })}
    </div>
  );
}
