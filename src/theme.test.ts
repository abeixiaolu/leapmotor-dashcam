import { describe, expect, it } from "vite-plus/test";
import {
  THEME_PREFERENCE_KEY,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
} from "./theme";

describe("theme preferences", () => {
  it("defaults unknown and legacy/malformed data to system", () => {
    for (const value of [null, undefined, "system", "auto", "{broken", {}, false])
      expect(parseThemePreference(value)).toBe("system");
    expect(readThemePreference(null)).toBe("system");
  });
  it("only system mode follows the system theme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    for (const preference of ["light", "dark"] as const)
      for (const systemDark of [true, false])
        expect(resolveTheme(preference, systemDark)).toBe(preference);
  });
  it("persists each explicit preference independently of correction settings", () => {
    const values = new Map<string, string>([
      ["leapmotor-dashcam:correction:v1", '{"correct":false,"fov":95,"strength":0.5}'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(readThemePreference(storage)).toBe("system");
    for (const preference of ["light", "dark", "system"] as const) {
      expect(saveThemePreference(preference, storage)).toBe(true);
      expect(values.get(THEME_PREFERENCE_KEY)).toBe(preference);
      expect(readThemePreference(storage)).toBe(preference);
    }
    expect(values.get("leapmotor-dashcam:correction:v1")).toBe(
      '{"correct":false,"fov":95,"strength":0.5}',
    );
  });
  it("handles blocked storage without breaking theme controls", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readThemePreference(storage)).toBe("system");
    expect(saveThemePreference("dark", storage)).toBe(false);
    expect(saveThemePreference("dark", null)).toBe(false);
  });
});
