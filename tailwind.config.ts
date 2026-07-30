import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
    },
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        serif: [
          "Playfair Display",
          "ui-serif",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
      },
      colors: {
        // Brand palette: Modern Sandstone + Indigo
        ink: {
          DEFAULT: "#1c1917",
          soft: "#57534e",
          muted: "#a8a29e",
        },
        parchment: {
          50: "#fdfaf6",
          100: "#f7f1e7",
          200: "#ece1cc",
        },
        accent: {
          DEFAULT: "#4f46e5",
          soft: "#eef2ff",
        },
        warm: {
          DEFAULT: "#f59e0b",
          soft: "#fff7ed",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(28, 25, 23, 0.04), 0 8px 24px rgba(28, 25, 23, 0.05)",
        glow: "0 0 0 4px rgba(79, 70, 229, 0.18)",
      },
      borderRadius: {
        xl: "14px",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
        shimmer: "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
