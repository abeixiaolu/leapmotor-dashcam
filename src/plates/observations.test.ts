import { describe, expect, it } from "vite-plus/test";
import { mergePlateHits, plateText } from "./observations";
import type { PlateCandidate, PlateHit } from "./types";

function hit(overrides: Partial<PlateHit> = {}): PlateHit {
  return {
    text: "京MD98500",
    confidence: 0.96,
    provinceConfidence: 0.7167504,
    box: { x: 470, y: 298, width: 52, height: 18 },
    thumbnail: new Blob(["original"], { type: "image/png" }),
    ...overrides,
  };
}

describe("plate sightings", () => {
  it("merges continuous serial sightings without confirming repeated weak province guesses", () => {
    let candidates: PlateCandidate[] = [];
    for (let time = 35; time <= 50; time++) {
      const reading =
        time === 35
          ? hit({ text: "桂MD98500", provinceConfidence: 0.5203624, confidence: 0.9391896 })
          : time === 50
            ? hit({ text: "粤MD98500", provinceConfidence: 0.4561074, confidence: 0.9263587 })
            : hit();
      candidates = mergePlateHits(candidates, [reading], "rear", time);
    }
    expect(candidates.map(plateText)).toEqual(["?MD98500"]);
    expect(candidates[0].province.kind).toBe("unread");
    expect(candidates[0].observations).toBe(16);
    expect(candidates[0].lastSeen).toBe(50);
  });

  it("promotes a direct province reading and keeps its supporting snapshot through weak guesses", () => {
    const initial = hit({ confidence: 0.99 });
    const confirmed = hit({ text: "浙MD98500", provinceConfidence: 0.88, confidence: 0.94 });
    const weak = hit({ text: "桂MD98500", confidence: 0.999, box: { ...initial.box, x: 472 } });
    let candidates = mergePlateHits([], [initial], "rear", 1);
    candidates = mergePlateHits(candidates, [confirmed], "rear", 2);
    candidates = mergePlateHits(candidates, [weak], "rear", 3);
    expect(candidates.map(plateText)).toEqual(["浙MD98500"]);
    expect(candidates[0].thumbnail).toBe(confirmed.thumbnail);
    expect(candidates[0].box).toEqual(confirmed.box);
    expect(candidates[0].confidence).toBe(confirmed.confidence);
    expect(candidates[0].time).toBe(2);
    expect(candidates[0].lastBox).toEqual(weak.box);
    expect(candidates[0].lastSeen).toBe(3);
  });

  it("shows uncertainty after contradictory strong readings instead of picking a majority", () => {
    let candidates = mergePlateHits(
      [],
      [hit({ text: "浙MD98500", provinceConfidence: 0.9 })],
      "rear",
      1,
    );
    candidates = mergePlateHits(candidates, [hit({ provinceConfidence: 0.91 })], "rear", 2);
    for (let time = 3; time <= 10; time++)
      candidates = mergePlateHits(
        candidates,
        [hit({ text: "浙MD98500", provinceConfidence: 0.99 })],
        "rear",
        time,
      );
    expect(candidates.map(plateText)).toEqual(["?MD98500"]);
    expect(candidates[0].province.kind).toBe("conflict");
  });

  it("tracks the newest location independently of the retained best snapshot", () => {
    const initial = hit({ confidence: 0.99, box: { x: 0, y: 0, width: 50, height: 20 } });
    let candidates = mergePlateHits([], [initial], "rear", 1);
    for (let time = 2; time <= 3; time++)
      candidates = mergePlateHits(
        candidates,
        [hit({ box: { ...initial.box, x: (time - 1) * 20 } })],
        "rear",
        time,
      );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].box.x).toBe(0);
    expect(candidates[0].lastBox.x).toBe(40);
    expect(candidates[0].thumbnail).toBe(initial.thumbnail);
    expect(candidates[0].time).toBe(1);
  });

  it("keeps separate views, distant cars, different serials and gaps above five seconds", () => {
    const initial = mergePlateHits([], [hit()], "rear", 1);
    expect(mergePlateHits(initial, [hit()], "front", 2)).toHaveLength(2);
    expect(
      mergePlateHits(initial, [hit({ box: { x: 0, y: 0, width: 52, height: 18 } })], "rear", 2),
    ).toHaveLength(2);
    expect(mergePlateHits(initial, [hit({ text: "京MD98501" })], "rear", 2)).toHaveLength(2);
    expect(mergePlateHits(initial, [hit()], "rear", 6)).toHaveLength(1);
    expect(mergePlateHits(initial, [hit()], "rear", 6.01)).toHaveLength(2);
    expect(mergePlateHits(initial, [hit()], "rear", 1)).toHaveLength(2);
    expect(mergePlateHits(initial, [hit()], "rear", 0)).toHaveLength(2);
  });

  it("does not assign competing hits to the same track or choose one by input order", () => {
    const initial = mergePlateHits([], [hit()], "rear", 1);
    const readings = [
      hit({ text: "浙MD98500", provinceConfidence: 0.9 }),
      hit({ text: "桂MD98500", provinceConfidence: 0.9 }),
    ];
    for (const order of [readings, readings.toReversed()]) {
      const candidates = mergePlateHits(initial, order, "rear", 2);
      expect(candidates).toHaveLength(3);
      expect(candidates[0].observations).toBe(1);
      expect(candidates.map(plateText).toSorted()).toEqual(["?MD98500", "桂MD98500", "浙MD98500"]);
      expect(candidates.every((candidate) => candidate.observations === 1)).toBe(true);
    }
  });

  it("does not choose arbitrarily between two spatially compatible tracks", () => {
    const initial = mergePlateHits([], [hit(), hit()], "rear", 1);
    const candidates = mergePlateHits(initial, [hit()], "rear", 2);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.observations === 1)).toBe(true);
  });
});
