import { describe, expect, it } from "vite-plus/test";
import { CORRECTION_SETTINGS_KEY } from "./settings";
import {
  CLARITY_SETTINGS_KEY,
  DEFAULT_CLARITY_SETTINGS,
  parseClaritySettings,
  readClaritySettings,
  saveClaritySettings,
} from "./videoClarity";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(CLARITY_SETTINGS_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("视频清晰度设置", () => {
  it("初次使用保持原画，切换模式后记住强度，包括零强度", () => {
    const storage = memoryStorage();
    expect(readClaritySettings(storage)).toEqual({ mode: "original", amount: 0.5 });
    for (const mode of ["original", "enhanced", "comparison"] as const) {
      for (const amount of [0, 0.37, 1]) {
        expect(saveClaritySettings({ mode, amount }, storage)).toBe(true);
        expect(readClaritySettings(storage)).toEqual({ mode, amount });
      }
    }
  });

  it("损坏的存储回到原画，保留其他有效字段", () => {
    for (const saved of [undefined, "{broken", "null", "[]", '"text"', "false"]) {
      expect(readClaritySettings(memoryStorage(saved))).toEqual(DEFAULT_CLARITY_SETTINGS);
    }
    expect(parseClaritySettings({ mode: "unknown", amount: 0.8 })).toEqual({
      mode: "original",
      amount: 0.8,
    });
    for (const amount of [NaN, Infinity, -Infinity, "0.8", null]) {
      expect(parseClaritySettings({ mode: "enhanced", amount })).toEqual({
        mode: "enhanced",
        amount: 0.5,
      });
    }
    expect(parseClaritySettings({ amount: 8 })).toEqual({ mode: "original", amount: 1 });
    expect(parseClaritySettings({ amount: -3 })).toEqual({ mode: "original", amount: 0 });
  });

  it("重置只清除清晰度选择，不覆盖鱼眼校正设置", () => {
    const storage = memoryStorage('{"mode":"comparison","amount":0.9}');
    const correction = '{"correct":false,"fov":95,"strength":0.7}';
    storage.setItem(CORRECTION_SETTINGS_KEY, correction);
    expect(saveClaritySettings({ ...DEFAULT_CLARITY_SETTINGS }, storage)).toBe(true);
    expect(readClaritySettings(storage)).toEqual({ mode: "original", amount: 0.5 });
    expect(storage.getItem(CORRECTION_SETTINGS_KEY)).toBe(correction);
  });

  it("存储不可用时返回原画并报告保存失败", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("Storage blocked");
      },
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    };
    expect(readClaritySettings(unavailable)).toEqual(DEFAULT_CLARITY_SETTINGS);
    expect(readClaritySettings(null)).toEqual(DEFAULT_CLARITY_SETTINGS);
    expect(saveClaritySettings({ mode: "enhanced", amount: 0.7 }, unavailable)).toBe(false);
    expect(saveClaritySettings({ mode: "enhanced", amount: 0.7 }, null)).toBe(false);
  });
});
