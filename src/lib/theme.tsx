/**
 * Theme system — provides light/dark/warm theme switching.
 * CSS variables are defined in globals.css via tailwind classes.
 */

'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type ThemeId = 'minimal-white' | 'notion' | 'warm-wood' | 'deep-space' | 'nord' | 'tokyo-night' | 'dracula' | 'solarized-light';

export const THEMES: { id: ThemeId; label: string; labelZh: string }[] = [
  { id: 'notion', label: 'Notion', labelZh: 'Notion' },
  { id: 'minimal-white', label: 'Minimal White', labelZh: '极简白' },
  { id: 'warm-wood', label: 'Warm Wood', labelZh: '暖木' },
  { id: 'solarized-light', label: 'Solarized Light', labelZh: '日光' },
  { id: 'deep-space', label: 'Deep Space', labelZh: '深空' },
  { id: 'nord', label: 'Nord', labelZh: '北极' },
  { id: 'tokyo-night', label: 'Tokyo Night', labelZh: '赛博夜' },
  { id: 'dracula', label: 'Dracula', labelZh: '德古拉' },
];

interface ThemeContextType {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeCtx = createContext<ThemeContextType>({ theme: 'notion' as ThemeId, setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>('notion');

  useEffect(() => {
    try {
      const s = localStorage.getItem('mind-theme');
      if (s && THEMES.some(t => t.id === s)) {
        setThemeState(s as ThemeId);
        document.documentElement.setAttribute('data-theme', s);
      }
    } catch (e) { console.error('[lib:theme]', e); }
  }, []);

  const setTheme = (t: ThemeId) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('mind-theme', t); } catch (e) { console.error('[lib:theme]', e); }
  };

  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }
