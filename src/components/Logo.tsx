import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showWordmark?: boolean;
  size?: number;
}

export default function Logo({ className, showWordmark = true, size = 36 }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden="true"
        className="text-current"
      >
        <defs>
          <linearGradient id="gllogo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="52" height="52" rx="14" fill="url(#gllogo)" />
        <path
          d="M32 14 L40 30 H36 L36 50 H28 L28 30 H24 Z"
          fill="#fdfaf6"
          strokeWidth="1.5"
          stroke="#fdfaf6"
        />
        <circle cx="32" cy="34" r="2" fill="#4f46e5" />
      </svg>
      {showWordmark && (
        <span className="font-serif text-xl font-semibold tracking-tight text-stone-900">
          GraceLedger
        </span>
      )}
    </div>
  );
}
