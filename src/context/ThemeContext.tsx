/**
 * ThemeContext.tsx — Global theme state for glassmorphism UI
 * 
 * Manages: light/dark mode, accent color palette, background image
 * All settings persisted to localStorage.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

// ── Accent color presets ──
export type AccentColor = 'silver' | 'rose' | 'amber' | 'emerald' | 'violet' | 'cyan';

export const ACCENT_COLORS: Record<AccentColor, { label: string; hex: string; hover: string; dim: string; glow: string }> = {
  silver:  { label: 'Silver',  hex: '#9ca3af', hover: '#d1d5db', dim: 'rgba(156,163,175,0.15)', glow: 'rgba(156,163,175,0.4)' },
  rose:    { label: 'Rose',    hex: '#f43f5e', hover: '#fb7185', dim: 'rgba(244,63,94,0.15)',    glow: 'rgba(244,63,94,0.4)'  },
  amber:   { label: 'Amber',   hex: '#f59e0b', hover: '#fbbf24', dim: 'rgba(245,158,11,0.15)',   glow: 'rgba(245,158,11,0.4)' },
  emerald: { label: 'Emerald', hex: '#10b981', hover: '#34d399', dim: 'rgba(16,185,129,0.15)',   glow: 'rgba(16,185,129,0.4)' },
  violet:  { label: 'Violet',  hex: '#8b5cf6', hover: '#a78bfa', dim: 'rgba(139,92,246,0.15)',   glow: 'rgba(139,92,246,0.4)' },
  cyan:    { label: 'Cyan',    hex: '#06b6d4', hover: '#22d3ee', dim: 'rgba(6,182,212,0.15)',    glow: 'rgba(6,182,212,0.4)'  },
};

export type ThemeMode = 'light' | 'dark';
export type BackgroundStyle = 'grid' | 'none';

interface ThemeContextValue {
  mode: ThemeMode;
  accentColor: AccentColor;
  backgroundStyle: BackgroundStyle;
  setMode: (m: ThemeMode) => void;
  setAccentColor: (c: AccentColor) => void;
  setBackgroundStyle: (b: BackgroundStyle) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── localStorage helpers ──
const LS_MODE = 'potency-theme-mode';
const LS_ACCENT = 'potency-accent-color';
const LS_BG = 'potency-bg-style';

function loadFromLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? (v as unknown as T) : fallback;
  } catch { return fallback; }
}

// ── Provider ──
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => loadFromLS(LS_MODE, 'dark'));
  const [accentColor, setAccentState] = useState<AccentColor>(() => loadFromLS(LS_ACCENT, 'silver'));
  const [backgroundStyle, setBgState] = useState<BackgroundStyle>(() => loadFromLS(LS_BG, 'grid'));

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem(LS_MODE, m);
  }, []);

  const setAccentColor = useCallback((c: AccentColor) => {
    setAccentState(c);
    localStorage.setItem(LS_ACCENT, c);
  }, []);

  const setBackgroundStyle = useCallback((b: BackgroundStyle) => {
    setBgState(b);
    localStorage.setItem(LS_BG, b);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  // ── Inject CSS custom properties ──
  useEffect(() => {
    const root = document.documentElement;
    const accent = ACCENT_COLORS[accentColor];
    const isDark = mode === 'dark';

    // Mode class
    root.classList.toggle('dark', isDark);
    root.classList.toggle('light', !isDark);

    // Accent colors
    root.style.setProperty('--accent', accent.hex);
    root.style.setProperty('--accent-hover', accent.hover);
    root.style.setProperty('--accent-dim', accent.dim);
    root.style.setProperty('--accent-glow', accent.glow);

    // Glass tokens — tuned for proper glassmorphism
    if (isDark) {
      root.style.setProperty('--bg-primary', '#0a0a0a');
      root.style.setProperty('--bg-secondary', '#111111');
      root.style.setProperty('--text-primary', '#f0f0f0');
      root.style.setProperty('--text-secondary', '#a0a0a0');
      root.style.setProperty('--text-muted', '#666666');
      root.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.05)');
      root.style.setProperty('--glass-bg-hover', 'rgba(255, 255, 255, 0.09)');
      root.style.setProperty('--glass-bg-strong', 'rgba(255, 255, 255, 0.10)');
      root.style.setProperty('--glass-bg-elevated', 'rgba(255, 255, 255, 0.07)');
      root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.08)');
      root.style.setProperty('--glass-border-hover', 'rgba(255, 255, 255, 0.16)');
      root.style.setProperty('--glass-shadow', '0 8px 32px rgba(0,0,0,0.5)');
      root.style.setProperty('--sidebar-bg', 'rgba(12, 12, 12, 0.80)');
      root.style.setProperty('--header-bg', 'rgba(12, 12, 12, 0.65)');
      root.style.setProperty('--grid-color', 'rgba(255, 255, 255, 0.06)');
      root.style.setProperty('--grid-dot', 'rgba(255, 255, 255, 0.15)');
    } else {
      root.style.setProperty('--bg-primary', '#f8f8f8');
      root.style.setProperty('--bg-secondary', '#f0f0f0');
      root.style.setProperty('--text-primary', '#1a1a1a');
      root.style.setProperty('--text-secondary', '#555555');
      root.style.setProperty('--text-muted', '#999999');
      // More translucent for proper glassmorphism in light mode
      root.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.35)');
      root.style.setProperty('--glass-bg-hover', 'rgba(255, 255, 255, 0.50)');
      root.style.setProperty('--glass-bg-strong', 'rgba(255, 255, 255, 0.55)');
      root.style.setProperty('--glass-bg-elevated', 'rgba(255, 255, 255, 0.45)');
      root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.50)');
      root.style.setProperty('--glass-border-hover', 'rgba(255, 255, 255, 0.70)');
      root.style.setProperty('--glass-shadow', '0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.5)');
      root.style.setProperty('--sidebar-bg', 'rgba(255, 255, 255, 0.50)');
      root.style.setProperty('--header-bg', 'rgba(255, 255, 255, 0.45)');
      root.style.setProperty('--grid-color', 'rgba(0, 0, 0, 0.06)');
      root.style.setProperty('--grid-dot', 'rgba(0, 0, 0, 0.15)');
    }

    root.style.setProperty('--glass-blur', '20px');
  }, [mode, accentColor]);

  return (
    <ThemeContext.Provider value={{
      mode, accentColor, backgroundStyle,
      setMode, setAccentColor, setBackgroundStyle,
      toggleMode,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
