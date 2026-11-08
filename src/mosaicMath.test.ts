import { describe, it, expect } from "vite-plus/test";
import { lensPoint, quadrants } from "./mosaicMath";
describe("mosaic lens mapping", () => {
  it("keeps optical center and zero correction unchanged", () => {
    expect(lensPoint(0.5, 0.5, 95, 1)).toEqual([0.5, 0.5]);
    expect(lensPoint(0.1, 0.8, 95, 0)).toEqual([0.1, 0.8]);
  });
  it("keeps rays within their source quadrant and widens the view", () => {
    for (const f of [60, 95, 130])
      for (const u of [0, 0.5, 1])
        for (const v of [0, 0.5, 1])
          for (const c of lensPoint(u, v, f, 1)) {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
          }
    expect(lensPoint(1, 0.5, 130, 1)[0]).toBeGreaterThan(lensPoint(1, 0.5, 60, 1)[0]);
  });
  it("uses each quadrant exactly once", () =>
    expect(new Set(Object.values(quadrants).map((x) => x.join(","))).size).toBe(4));
});
