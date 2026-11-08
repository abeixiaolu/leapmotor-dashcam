export type CorrectionSettings = {
  correct: boolean;
  fov: number;
  strength: number;
};

export const DEFAULT_CORRECTION_SETTINGS: Readonly<CorrectionSettings> = Object.freeze({
  correct: true,
  fov: 95,
  strength: 1,
});

export const CORRECTION_SETTINGS_KEY = "leapmotor-dashcam:correction:v1";

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

function finiteValue(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

/** Treat browser storage as untrusted; retain valid fields and default invalid ones. */
export function parseCorrectionSettings(value: unknown): CorrectionSettings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_CORRECTION_SETTINGS };
  }
  const saved = value as Record<string, unknown>;
  return {
    correct:
      typeof saved.correct === "boolean" ? saved.correct : DEFAULT_CORRECTION_SETTINGS.correct,
    fov: Math.round(finiteValue(saved.fov, DEFAULT_CORRECTION_SETTINGS.fov, 60, 130)),
    strength: finiteValue(saved.strength, DEFAULT_CORRECTION_SETTINGS.strength, 0, 1),
  };
}

function browserStorage(): SettingsStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readCorrectionSettings(storage?: SettingsStorage | null): CorrectionSettings {
  try {
    const source = storage === undefined ? browserStorage() : storage;
    const saved = source?.getItem(CORRECTION_SETTINGS_KEY);
    return saved ? parseCorrectionSettings(JSON.parse(saved)) : { ...DEFAULT_CORRECTION_SETTINGS };
  } catch {
    return { ...DEFAULT_CORRECTION_SETTINGS };
  }
}

/** False means changes still apply in memory but could not be saved for the next visit. */
export function saveCorrectionSettings(
  settings: CorrectionSettings,
  storage?: SettingsStorage | null,
): boolean {
  try {
    const target = storage === undefined ? browserStorage() : storage;
    if (!target) return false;
    target.setItem(CORRECTION_SETTINGS_KEY, JSON.stringify(parseCorrectionSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
