import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export const THEME_PREFERENCE_KEY = "leapmotor-dashcam:theme:v1";
type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function readThemePreference(storage?: ThemeStorage | null): ThemePreference {
  try {
    const source = storage === undefined ? window.localStorage : storage;
    return parseThemePreference(source?.getItem(THEME_PREFERENCE_KEY));
  } catch {
    return "system";
  }
}

export function saveThemePreference(
  value: ThemePreference,
  storage?: ThemeStorage | null,
): boolean {
  try {
    const target = storage === undefined ? window.localStorage : storage;
    if (!target) return false;
    target.setItem(THEME_PREFERENCE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function useThemePreference() {
  const [preference, setPreference] = useState(readThemePreference);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const dark = resolveTheme(preference, media.matches) === "dark";
      document.documentElement.classList.toggle("dark", dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#181818" : "#ffffff");
    };
    sync();
    setSaved(saveThemePreference(preference));
    if (preference !== "system") return;
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preference]);
  return { preference, setPreference, saved };
}
