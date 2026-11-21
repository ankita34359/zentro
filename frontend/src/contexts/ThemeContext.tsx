import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { publicConfig } from "@/config/public";
import { readPref, writePref } from "@/lib/safeStorage";

export type Theme = "light" | "dark";

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

function storedTheme(): Theme | null {
  const v = readPref(publicConfig.storage.theme);
  return v === "light" || v === "dark" ? v : null;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/** Called once before the first render so the page never paints in the wrong theme. */
export function initTheme(): Theme {
  const theme = storedTheme() ?? (systemPrefersDark() ? "dark" : "light");
  applyTheme(theme);
  return theme;
}

interface ThemeValue {
  theme: Theme;
  toggle: () => void;
}
const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => initTheme());

  // Until the person makes a choice, follow the operating system when it changes.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (storedTheme() === null) {
        const t: Theme = mq.matches ? "dark" : "light";
        applyTheme(t);
        setTheme(t);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      writePref(publicConfig.storage.theme, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useTheme must be used inside ThemeProvider");
  return v;
}
