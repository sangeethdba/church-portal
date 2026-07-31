import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showWordmark?: boolean;
  size?: number;
  /** "image" renders the real church logo from atlantalittleflock.org; "mark" renders the SVG emblem */
  variant?: "image" | "mark";
}

const LOGO_ASPECT = 306 / 200; // 306×200 lockup

export default function Logo({
  className,
  showWordmark,
  size = 36,
  variant = "image",
}: LogoProps) {
  // The real logo lockup already contains the church name — no wordmark needed.
  // The SVG emblem is a standalone mark, so it defaults to showing the wordmark.
  const withWordmark = variant === "mark" ? (showWordmark ?? true) : (showWordmark ?? false);
  if (variant === "image") {
    return (
      <div className={cn("flex items-center gap-2.5", className)}>
        <span
          className="flex items-center justify-center overflow-hidden rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-stone-200"
          style={{ height: size, width: Math.round(size * LOGO_ASPECT) }}
        >
          <img
            src="/alf-logo.png"
            alt="Atlanta Little Flock Church"
            className="h-full w-full object-contain"
            draggable={false}
          />
        </span>
        {withWordmark && (
          <span className="font-serif text-lg font-semibold leading-tight tracking-tight text-stone-900">
            Atlanta Little Flock
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="text-current">
        <defs>
          <linearGradient id="alfgrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
        </defs>
        <rect x="5" y="5" width="54" height="54" rx="16" fill="url(#alfgrad)" />
        {/* The little flock — three birds above the cross */}
        <g fill="#fdfaf6">
          <path d="M15 15 q4 -5 8 0 q-4 -2 -8 0" />
          <path d="M25 10 q4 -5 8 0 q-4 -2 -8 0" />
          <path d="M35 15 q4 -5 8 0 q-4 -2 -8 0" />
        </g>
        {/* Cross */}
        <path d="M32 26 V47 M23 34.5 H41" stroke="#fdfaf6" strokeWidth="5" strokeLinecap="round" />
      </svg>
      {withWordmark && (
        <span className="font-serif text-lg font-semibold leading-tight tracking-tight text-stone-900">
          Atlanta Little Flock
        </span>
      )}
    </div>
  );
}
