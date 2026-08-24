import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ---------- Admin theme (light / dark / system) ----------
// The only client-side preference we persist. It is a display setting, not
// sensitive data, so localStorage is appropriate here.

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "zolo-admin-theme";

interface ThemeApi {
  pref: ThemePref;
  /** The theme actually applied right now (system resolved to light/dark) */
  resolved: "light" | "dark";
  setPref: (p: ThemePref) => void;
  toggle: () => void;
}

const ThemeCtx = createContext<ThemeApi | null>(null);

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used inside <AdminThemeProvider>");
  return ctx;
}

function readStored(): ThemePref {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Track OS preference changes while on "system"
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolved: "light" | "dark" = pref === "system" ? (systemDark ? "dark" : "light") : pref;

  // Apply/remove the `.dark` class on <html> while the admin is mounted,
  // and restore it on unmount so the storefront stays light.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.toggle("dark", resolved === "dark");
    return () => {
      root.classList.toggle("dark", had);
    };
  }, [resolved]);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    window.localStorage.setItem(STORAGE_KEY, p);
  };

  const api = useMemo<ThemeApi>(
    () => ({
      pref,
      resolved,
      setPref,
      toggle: () => setPref(resolved === "dark" ? "light" : "dark"),
    }),
    [pref, resolved],
  );

  return <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>;
}
