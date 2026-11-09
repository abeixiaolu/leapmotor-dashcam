export type ClarityMode = "original" | "enhanced" | "comparison";

export type ClaritySettings = {
  mode: ClarityMode;
  amount: number;
};

export const DEFAULT_CLARITY_SETTINGS: Readonly<ClaritySettings> = Object.freeze({
  mode: "original",
  amount: 0.5,
});

export const CLARITY_SETTINGS_KEY = "leapmotor-dashcam:clarity:v1";

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export function parseClaritySettings(value: unknown): ClaritySettings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_CLARITY_SETTINGS };
  }
  const mode = "mode" in value ? value.mode : undefined;
  const amount = "amount" in value ? value.amount : undefined;
  return {
    mode:
      mode === "original" || mode === "enhanced" || mode === "comparison"
        ? mode
        : DEFAULT_CLARITY_SETTINGS.mode,
    amount:
      typeof amount === "number" && Number.isFinite(amount)
        ? Math.max(0, Math.min(1, amount))
        : DEFAULT_CLARITY_SETTINGS.amount,
  };
}

function browserStorage(): SettingsStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readClaritySettings(storage?: SettingsStorage | null): ClaritySettings {
  try {
    const source = storage === undefined ? browserStorage() : storage;
    const saved = source?.getItem(CLARITY_SETTINGS_KEY);
    return saved ? parseClaritySettings(JSON.parse(saved)) : { ...DEFAULT_CLARITY_SETTINGS };
  } catch {
    return { ...DEFAULT_CLARITY_SETTINGS };
  }
}

export function saveClaritySettings(
  settings: ClaritySettings,
  storage?: SettingsStorage | null,
): boolean {
  try {
    const target = storage === undefined ? browserStorage() : storage;
    if (!target) return false;
    target.setItem(CLARITY_SETTINGS_KEY, JSON.stringify(parseClaritySettings(settings)));
    return true;
  } catch {
    return false;
  }
}
