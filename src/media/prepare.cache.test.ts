import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  clearPreparedCacheForTests,
  peekPreparedCache,
  recordingCacheKey,
  rememberPreparedForTests,
} from "./prepare";

afterEach(() => clearPreparedCacheForTests());

describe("prepared blob cache", () => {
  it("keys files by name, size, and lastModified", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.h264", {
      type: "application/octet-stream",
      lastModified: 42,
    });
    expect(recordingCacheKey(file)).toBe("a.h264|3|42");
  });

  it("keeps the two most recently used prepared blobs", () => {
    const a = new File([new Uint8Array([1])], "a.h264", { lastModified: 1 });
    const b = new File([new Uint8Array([2])], "b.h264", { lastModified: 2 });
    const c = new File([new Uint8Array([3])], "c.h264", { lastModified: 3 });
    const blobA = new Blob([new Uint8Array([10])], { type: "video/mp4" });
    const blobB = new Blob([new Uint8Array([11])], { type: "video/mp4" });
    const blobC = new Blob([new Uint8Array([12])], { type: "video/mp4" });
    rememberPreparedForTests(a, blobA);
    rememberPreparedForTests(b, blobB);
    rememberPreparedForTests(c, blobC);
    expect(peekPreparedCache(a)).toBeUndefined();
    expect(peekPreparedCache(b)).toBe(blobB);
    expect(peekPreparedCache(c)).toBe(blobC);
  });
});
