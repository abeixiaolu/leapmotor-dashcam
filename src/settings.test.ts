import { describe, expect, it } from "vite-plus/test";
import {
  CORRECTION_SETTINGS_KEY,
  DEFAULT_CORRECTION_SETTINGS,
  parseCorrectionSettings,
  readCorrectionSettings,
  saveCorrectionSettings,
} from "./settings";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(CORRECTION_SETTINGS_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("鱼眼校正设置保存", () => {
  it("新默认角度为110度且保留已有自定义角度和关闭状态", () => {
    expect(DEFAULT_CORRECTION_SETTINGS.fov).toBe(110);
    expect(readCorrectionSettings(memoryStorage()).fov).toBe(110);
    const saved = { correct: false, fov: 95, strength: 0.6 };
    expect(readCorrectionSettings(memoryStorage(JSON.stringify(saved)))).toEqual(saved);
    expect(parseCorrectionSettings({ correct: false })).toEqual({
      ...DEFAULT_CORRECTION_SETTINGS,
      correct: false,
    });
  });

  it("再次读取时保留关闭状态、角度和零强度", () => {
    const storage = memoryStorage();
    const settings = { correct: false, fov: 112, strength: 0 };
    expect(saveCorrectionSettings(settings, storage)).toBe(true);
    expect(readCorrectionSettings(storage)).toEqual(settings);
  });

  it("缺失或损坏的存储使用默认设置", () => {
    for (const saved of [undefined, "{broken", "null", "[]", '"text"']) {
      expect(readCorrectionSettings(memoryStorage(saved))).toEqual(DEFAULT_CORRECTION_SETTINGS);
    }
  });

  it("逐项验证类型，避免将字符串或非有限值传给画面校正", () => {
    expect(parseCorrectionSettings({ correct: "false", fov: Infinity, strength: NaN })).toEqual(
      DEFAULT_CORRECTION_SETTINGS,
    );
    expect(parseCorrectionSettings({ correct: false, fov: "90", strength: 0.5 })).toEqual({
      correct: false,
      fov: 110,
      strength: 0.5,
    });
  });

  it("越界值限制到滑块的有效范围，角度使用整数", () => {
    expect(parseCorrectionSettings({ fov: -50, strength: 2 })).toEqual({
      correct: true,
      fov: 60,
      strength: 1,
    });
    expect(parseCorrectionSettings({ fov: 500, strength: -1 })).toEqual({
      correct: true,
      fov: 130,
      strength: 0,
    });
    expect(parseCorrectionSettings({ fov: 95.6 }).fov).toBe(96);
  });

  it("恢复默认设置也会保存，下一次读取不会恢复旧值", () => {
    const storage = memoryStorage('{"correct":false,"fov":110,"strength":0.2}');
    saveCorrectionSettings({ ...DEFAULT_CORRECTION_SETTINGS }, storage);
    expect(readCorrectionSettings(storage)).toEqual(DEFAULT_CORRECTION_SETTINGS);
  });

  it("存储被禁用或写满时不会中断播放", () => {
    const blocked = {
      getItem: () => {
        throw new Error("Storage blocked");
      },
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    };
    expect(readCorrectionSettings(blocked)).toEqual(DEFAULT_CORRECTION_SETTINGS);
    expect(saveCorrectionSettings({ ...DEFAULT_CORRECTION_SETTINGS }, blocked)).toBe(false);
    expect(readCorrectionSettings(null)).toEqual(DEFAULT_CORRECTION_SETTINGS);
    expect(saveCorrectionSettings({ ...DEFAULT_CORRECTION_SETTINGS }, null)).toBe(false);
  });
});
