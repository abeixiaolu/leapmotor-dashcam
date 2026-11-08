import { describe, expect, it } from "vite-plus/test";
import { directions } from "../library";
import { exportFilter } from "./exportLayout";

describe("export layout", () => {
  for (const primary of directions) {
    it(`makes ${primary} the large view and retains the other three`, () => {
      const filter = exportFilter("focus", primary);
      expect(filter).toContain(`scale=720:576,setsar=1[${primary}]`);
      expect(filter).toContain(`[${primary}][previews]hstack=inputs=2[out]`);
      const previews = directions.filter((d) => d !== primary);
      expect(filter).toContain(
        `${previews.map((d) => `[${d}]`).join("")}vstack=inputs=3[previews]`,
      );
      for (const d of previews) expect(filter).toContain(`scale=240:192,setsar=1[${d}]`);
    });
    it(`grid ignores selected ${primary}`, () => {
      expect(exportFilter("grid", primary)).toBe(exportFilter("grid", "front"));
    });
  }
  it("uses the actual four recording quadrants", () => {
    const filter = exportFilter("grid", "front");
    expect(filter).toContain("[sfront]crop=iw/2:ih/2:iw/2*0:ih/2*0");
    expect(filter).toContain("[srear]crop=iw/2:ih/2:iw/2*1:ih/2*0");
    expect(filter).toContain("[sleft]crop=iw/2:ih/2:iw/2*0:ih/2*1");
    expect(filter).toContain("[sright]crop=iw/2:ih/2:iw/2*1:ih/2*1");
  });
});
