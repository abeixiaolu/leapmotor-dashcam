import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { invalidatePlateCache, parsePlateCache, readPlateCache, savePlateCache } from "./cache";
import { plateText } from "./observations";
import type { PlateCandidate } from "./types";

const completedAt = 1_700_000_000_000;
const candidate: PlateCandidate = {
  id: "front-1-0",
  serial: "B6H920",
  province: { kind: "read", value: "津", score: 0.95 },
  confidence: 0.95,
  box: { x: 20, y: 30, width: 100, height: 40 },
  lastBox: { x: 22, y: 30, width: 100, height: 40 },
  thumbnail: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  direction: "front",
  time: 1,
  lastSeen: 2,
  observations: 2,
};
const record = {
  key: "plate-v2:recording-a",
  completedAt,
  candidates: [candidate],
};

afterEach(() => vi.unstubAllGlobals());

describe("plate result cache validity", () => {
  it("keeps a completed result for 24 hours without extending its completion time", async () => {
    const restored = parsePlateCache(record, completedAt + 86_399_999);
    expect(restored?.completedAt).toBe(completedAt);
    expect(restored?.candidates.map(plateText)).toEqual(["津B6H920"]);
    expect(await restored?.candidates[0].thumbnail.arrayBuffer()).toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
    expect(parsePlateCache(record, completedAt + 86_400_000)).toBeNull();
    expect(parsePlateCache(record, completedAt + 86_400_001)).toBeNull();
  });

  it("preserves completed empty results as reusable records", () => {
    expect(parsePlateCache({ ...record, candidates: [] }, completedAt)).toEqual({
      key: "plate-v2:recording-a",
      completedAt,
      candidates: [],
    });
  });

  it("rejects future, incompatible and partial records", () => {
    expect(parsePlateCache(record, completedAt - 1)).toBeNull();
    expect(parsePlateCache({ ...record, key: "plate-v0:recording-a" }, completedAt)).toBeNull();
    expect(parsePlateCache({ ...record, key: "plate-v1:recording-a" }, completedAt)).toBeNull();
    expect(parsePlateCache({ key: record.key, candidates: [] }, completedAt)).toBeNull();
    expect(parsePlateCache(null, completedAt)).toBeNull();
  });

  it("rejects invalid screenshots and candidate geometry instead of restoring broken results", () => {
    for (const invalid of [
      { ...candidate, thumbnail: "blob:expired" },
      { ...candidate, thumbnail: new Blob([]) },
      { ...candidate, direction: "unknown" },
      { ...candidate, confidence: Number.NaN },
      { ...candidate, time: 3, lastSeen: 1 },
      { ...candidate, box: { ...candidate.box, width: -1 } },
      { ...candidate, lastBox: { ...candidate.lastBox, x: Number.NaN } },
      { ...candidate, serial: "B6O920" },
      { ...candidate, province: { kind: "read", value: "浙", score: 0.7 } },
      { ...candidate, province: { kind: "read", value: "?", score: 0.95 } },
      { ...candidate, province: { kind: "confirmed" } },
    ]) {
      expect(parsePlateCache({ ...record, candidates: [invalid] }, completedAt)).toBeNull();
    }
  });

  it("preserves unread and conflicting provinces without restoring a guessed first character", () => {
    const candidates: PlateCandidate[] = [
      { ...candidate, serial: "MD98500", province: { kind: "unread" } },
      { ...candidate, serial: "MD98500", province: { kind: "conflict" } },
    ];
    const restored = parsePlateCache({ ...record, candidates }, completedAt);
    expect(restored?.candidates.map(plateText)).toEqual(["?MD98500", "?MD98500"]);
    expect(restored?.candidates.map((value) => value.province.kind)).toEqual([
      "unread",
      "conflict",
    ]);
    expect(restored?.candidates[0].lastBox).toEqual(candidate.lastBox);
    expect(restored?.candidates[0].time).toBe(candidate.time);
  });

  it("bounds restored candidate counts", () => {
    expect(
      parsePlateCache({ ...record, candidates: Array(101).fill(candidate) }, completedAt),
    ).toBeNull();
  });
});

describe("unavailable plate storage", () => {
  it("falls back to a miss without rejecting when storage access is denied", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
    const signal = new AbortController().signal;
    await expect(readPlateCache("recording-a", signal)).resolves.toEqual({ kind: "miss" });
    await expect(
      savePlateCache({ recordingId: "recording-a", candidates: [candidate], completedAt, signal }),
    ).resolves.toBeUndefined();
    await expect(invalidatePlateCache("recording-a", signal)).resolves.toBeUndefined();
  });

  it("does not open storage for an already cancelled operation", async () => {
    const open = vi.fn(() => {
      throw new Error("Unexpected storage access");
    });
    vi.stubGlobal("indexedDB", { open });
    const controller = new AbortController();
    controller.abort();
    await expect(readPlateCache("recording-a", controller.signal)).resolves.toEqual({
      kind: "miss",
    });
    await expect(
      savePlateCache({
        recordingId: "recording-a",
        candidates: [],
        completedAt,
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
    await expect(invalidatePlateCache("recording-a", controller.signal)).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});
