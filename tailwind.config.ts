// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      colors: {
        // ── Raw autumn palette ────────────────────────────────────────
        "coffee-bean":  "#7f5539",  // burnt sienna — primary brand
        "camel":        "#a68a64",  // warm amber
        "almond-cream": "#ede0d4",  // parchment
        "dusty-olive":  "#656d4a",  // sage green
        "ebony":        "#414833",  // deep forest

        // ── Primary scale (coffee-bean / burnt sienna) ────────────────
        primary: {
          50:  "#f9f0e8",
          100: "#f0dcc8",
          200: "#e0ba97",
          300: "#cb9568",
          400: "#a56b45",
          500: "#7f5539",
          600: "#6b4730",
          700: "#573a27",
          800: "#432c1e",
          900: "#2e1e14",
          DEFAULT: "oklch(var(--primary) / <alpha-value>)",
          foreground: "oklch(var(--primary-foreground) / <alpha-value>)",
        },

        // ── Secondary scale (camel / warm amber) ──────────────────────
        secondary: {
          50:  "#f8f2e8",
          100: "#f0e4d0",
          200: "#e0c9a2",
          300: "#d0ae74",
          400: "#bf9655",
          500: "#a68a64",
          600: "#8b7252",
          700: "#705b41",
          800: "#554430",
          900: "#3a2e20",
          DEFAULT: "oklch(var(--secondary) / <alpha-value>)",
          foreground: "oklch(var(--secondary-foreground) / <alpha-value>)",
        },

        // ── Accent scale (almond-cream / parchment) ───────────────────
        accent: {
          50:  "#fefcf9",
          100: "#fdf8f2",
          200: "#fbf1e5",
          300: "#f5e6d5",
          400: "#ede0d4",
          500: "#dbc9b5",
          600: "#c4ae99",
          700: "#a6917d",
          800: "#887461",
          900: "#6a5745",
          DEFAULT: "oklch(var(--accent) / <alpha-value>)",
          foreground: "oklch(var(--accent-foreground) / <alpha-value>)",
        },

        // ── Success scale (dusty-olive / sage) ────────────────────────
        success: {
          50:  "#eef0e8",
          100: "#dde1d1",
          200: "#bbc3a3",
          300: "#99a575",
          400: "#7a8a58",
          500: "#656d4a",
          600: "#535a3e",
          700: "#414732",
          800: "#2f3426",
          900: "#1d211a",
          DEFAULT: "#656d4a",
        },

        // ── Danger scale (warm terracotta) ────────────────────────────
        danger: {
          50:  "#f9eeea",
          100: "#f3ddd6",
          200: "#e7bbac",
          300: "#db9982",
          400: "#c87558",
          500: "#b35e4c",
          600: "#8f4b3d",
          700: "#6b382e",
          800: "#47261f",
          900: "#23130f",
          DEFAULT: "#b35e4c",
        },

        // ── Neutral (warm parchment-tinted gray) ──────────────────────
        neutral: {
          50:  "#faf8f5",
          100: "#f3f0eb",
          200: "#e5e0d8",
          300: "#d4cdc2",
          400: "#b8b0a2",
          500: "#9a9283",
          600: "#7a7265",
          700: "#5e574c",
          800: "#453f38",
          900: "#2d2925",
        },

        // ── shadcn CSS-variable references ────────────────────────────
        background: "oklch(var(--background) / <alpha-value>)",
        foreground: "oklch(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "oklch(var(--card) / <alpha-value>)",
          foreground: "oklch(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "oklch(var(--popover) / <alpha-value>)",
          foreground: "oklch(var(--popover-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "oklch(var(--muted) / <alpha-value>)",
          foreground: "oklch(var(--muted-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "oklch(var(--destructive) / <alpha-value>)",
          foreground: "oklch(var(--destructive-foreground) / <alpha-value>)",
        },
        border: "oklch(var(--border) / <alpha-value>)",
        input:  "oklch(var(--input) / <alpha-value>)",
        ring:   "oklch(var(--ring) / <alpha-value>)",
        chart: {
          1: "oklch(var(--chart-1) / <alpha-value>)",
          2: "oklch(var(--chart-2) / <alpha-value>)",
          3: "oklch(var(--chart-3) / <alpha-value>)",
          4: "oklch(var(--chart-4) / <alpha-value>)",
          5: "oklch(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          DEFAULT:            "oklch(var(--sidebar) / <alpha-value>)",
          foreground:         "oklch(var(--sidebar-foreground) / <alpha-value>)",
          primary:            "oklch(var(--sidebar-primary) / <alpha-value>)",
          "primary-foreground": "oklch(var(--sidebar-primary-foreground) / <alpha-value>)",
          accent:             "oklch(var(--sidebar-accent) / <alpha-value>)",
          "accent-foreground": "oklch(var(--sidebar-accent-foreground) / <alpha-value>)",
          border:             "oklch(var(--sidebar-border) / <alpha-value>)",
          ring:               "oklch(var(--sidebar-ring) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
