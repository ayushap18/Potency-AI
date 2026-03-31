/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── AgentX Core Palette ───────────────────────────────────────────
        // Violet primary (replaces alchemist warm tones)
        "primary":                  "#8b5cf6",
        "primary-hover":            "#a78bfa",
        "primary-dim":              "rgba(139,92,246,0.15)",
        "primary-glow":             "rgba(139,92,246,0.4)",
        "on-primary":               "#ffffff",
        "primary-container":        "#a78bfa",
        "primary-fixed":            "#c4b5fd",
        "primary-fixed-dim":        "#a78bfa",
        "on-primary-container":     "#f5f3ff",
        "on-primary-fixed":         "#ffffff",
        "on-primary-fixed-variant": "#6d28d9",
        "inverse-primary":          "#6d28d9",

        // Backgrounds & surfaces
        "background":               "#080b14",
        "on-background":            "#f1f5f9",
        "surface":                  "#080b14",
        "surface-dim":              "#060911",
        "surface-bright":           "#1e293b",
        "surface-variant":          "#1e293b",
        "surface-container-lowest": "#04060d",
        "surface-container-low":    "#0f1729",
        "surface-container":        "#111827",
        "surface-container-high":   "#1e293b",
        "surface-container-highest":"#293244",
        "surface-tint":             "#8b5cf6",
        "inverse-surface":          "#e2e8f0",
        "inverse-on-surface":       "#0f172a",

        // Text
        "on-surface":               "#f1f5f9",
        "on-surface-variant":       "#94a3b8",

        // Secondary (cyan accent)
        "secondary":                "#06b6d4",
        "secondary-container":      "rgba(6,182,212,0.12)",
        "secondary-fixed":          "#cffafe",
        "secondary-fixed-dim":      "#a5f3fc",
        "on-secondary":             "#ffffff",
        "on-secondary-container":   "#22d3ee",
        "on-secondary-fixed":       "#164e63",
        "on-secondary-fixed-variant":"#0e7490",

        // Tertiary (fuchsia)
        "tertiary":                 "#e879f9",
        "tertiary-container":       "rgba(232,121,249,0.12)",
        "tertiary-fixed":           "#fae8ff",
        "tertiary-fixed-dim":       "#f0abfc",
        "on-tertiary":              "#ffffff",
        "on-tertiary-container":    "#f5d0fe",
        "on-tertiary-fixed":        "#4a044e",
        "on-tertiary-fixed-variant":"#86198f",

        // Borders / outlines
        "outline":                  "#475569",
        "outline-variant":          "#1e293b",

        // Error
        "error":                    "#ef4444",
        "error-container":          "rgba(239,68,68,0.15)",
        "on-error":                 "#ffffff",
        "on-error-container":       "#fca5a5",
      },
      fontFamily: {
        "headline": ["Inter", "system-ui", "sans-serif"],
        "body":     ["Inter", "system-ui", "sans-serif"],
        "label":    ["Inter", "system-ui", "sans-serif"],
        "mono":     ["JetBrains Mono", "Fira Code", "SF Mono", "monospace"],
      },
      borderRadius: {
        "DEFAULT": "0.375rem",
        "sm":      "0.375rem",
        "md":      "0.625rem",
        "lg":      "1rem",
        "xl":      "1.25rem",
        "2xl":     "1.5rem",
        "full":    "9999px",
      },
    },
  },
  plugins: [],
}