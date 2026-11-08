import { describe, expect, it } from "vite-plus/test";
import { calendarCells, dateCounts, shiftMonth } from "./calendar";
describe("录像日期筛选", () => {
  it("按类型统计日期，哨兵日期不开放为行车日期", () => {
    const counts = dateCounts(
      [
        { stamp: "2026-11-07 12:00:00", kind: "drive" },
        { stamp: "2026-11-07 13:00:00", kind: "drive" },
        { stamp: "2026-11-08 10:00:00", kind: "sentinel" },
      ],
      "drive",
    );
    expect([...counts]).toEqual([["2026-11-07", 2]]);
    expect(counts.has("2026-11-08")).toBe(false);
  });
  it("按周一开始排布跨月空格且包含闰年日期", () => {
    const november = calendarCells("2026-11");
    expect(november.slice(0, 6)).toEqual(Array(6).fill(null));
    expect(november[6]).toBe("2026-11-01");
    expect(november.filter(Boolean)).toHaveLength(30);
    expect(calendarCells("2028-02")).toContain("2028-02-29");
    expect(calendarCells("2027-02")).not.toContain("2027-02-29");
  });
  it("跨年翻月正确", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
