import { describe, expect, it } from "vite-plus/test";
import {
  decodeDetections,
  decodeText,
  isStandardPlate,
  perspective,
  qualifyPlate,
  PLATE_TOKENS,
  RECOGNIZER_CLASSES,
} from "./modelMath";

describe("plate model decoding", () => {
  it("preserves repeated digits separated by CTC blanks", () => {
    const sequence = ["皖", "皖", "A", "blank", "1", "1", "blank", "1", "2", "3", "4"];
    const data = new Float32Array(sequence.length * RECOGNIZER_CLASSES);
    for (const [step, token] of sequence.entries())
      data[step * RECOGNIZER_CLASSES + PLATE_TOKENS.indexOf(token)] = 0.95;
    const result = decodeText(data);
    expect(result.text).toBe("皖A11234");
    expect(result.confidence).toBeCloseTo(0.95);
    expect(result.characterScores).toHaveLength(7);
    expect(result.characterScores.every((score) => Math.abs(score - 0.95) < 0.00001)).toBe(true);
    expect(decodeText(new Float32Array(RECOGNIZER_CLASSES)).text).toBe("");
  });

  it("keeps a readable serial with a weak province and rejects a weak serial", () => {
    for (const [text, provinceScore] of [
      ["桂MD98500", 0.5203624],
      ["京MD98500", 0.7167504],
      ["粤MD98500", 0.4561074],
    ] satisfies [string, number][]) {
      const result = qualifyPlate({
        text,
        characterScores: [provinceScore, ...Array(7).fill(0.99)],
      });
      expect(result?.text).toBe(text);
      expect(result?.provinceConfidence).toBe(provinceScore);
    }
    expect(
      qualifyPlate({ text: "浙MD98500", characterScores: [0.99, 0.4, ...Array(6).fill(0.99)] }),
    ).toBeNull();
    expect(qualifyPlate({ text: "浙MD98500", characterScores: Array(8).fill(0.7) })).toBeNull();
    expect(qualifyPlate({ text: "?MD98500", characterScores: Array(8).fill(0.99) })).toBeNull();
  });

  it("retains the first score in each CTC run without duplicating its evidence", () => {
    const sequence = ["京", "京", "M", "D", "9", "8", "5", "0", "blank", "0"];
    const data = new Float32Array(sequence.length * RECOGNIZER_CLASSES);
    for (const [step, token] of sequence.entries())
      data[step * RECOGNIZER_CLASSES + PLATE_TOKENS.indexOf(token)] = step === 0 ? 0.52 : 0.99;
    const result = decodeText(data);
    expect(result.text).toBe("京MD98500");
    expect(result.characterScores).toHaveLength(8);
    expect(result.characterScores[0]).toBeCloseTo(0.52);
  });

  it("rejects an unmapped winning model class instead of inventing a character", () => {
    const data = new Float32Array(RECOGNIZER_CLASSES);
    data[77] = 0.99;
    const result = decodeText(data);
    expect(result.text).toBe("?");
    expect(isStandardPlate(result.text)).toBe(false);
  });

  it("accepts ordinary and new-energy numbers without fixing ambiguous text", () => {
    expect(isStandardPlate("沪A12345")).toBe(true);
    expect(isStandardPlate("粤BD12345")).toBe(true);
    expect(isStandardPlate("沪A12O45")).toBe(false);
    expect(isStandardPlate("AB12345")).toBe(false);
    expect(isStandardPlate("沪A1234")).toBe(false);
  });

  it("removes overlapping detections and maps boxes out of letterbox padding", () => {
    const data = new Float32Array([
      160, 320, 128, 32, 0.95, 96, 304, 224, 304, 224, 336, 96, 336, 0.95, 0.05, 161, 320, 128, 32,
      0.85, 97, 304, 225, 304, 225, 336, 97, 336, 0.95, 0.05, 480, 320, 128, 32, 0.9, 416, 304, 544,
      304, 544, 336, 416, 336, 0.05, 0.95,
    ]);
    const result = decodeDetections(data, 1280, 720);
    expect(result).toHaveLength(2);
    expect(result[0].box).toEqual({ x: 192, y: 328, width: 256, height: 64 });
    expect(result[0].corners[0]).toEqual({ x: 192, y: 328 });
    expect(result[0].doubleRow).toBe(false);
    expect(result[1].doubleRow).toBe(true);
  });

  it("maps the four plate corners and rejects degenerate geometry", () => {
    const points = [
      { x: 10, y: 10 },
      { x: 110, y: 20 },
      { x: 100, y: 60 },
      { x: 20, y: 50 },
    ] satisfies Parameters<typeof perspective>[0];
    const transform = perspective(points);
    expect(transform?.map(0, 0)).toEqual(points[0]);
    expect(transform?.map(1, 0).x).toBeCloseTo(points[1].x);
    expect(transform?.map(1, 1).y).toBeCloseTo(points[2].y);
    expect(transform?.map(0, 1).x).toBeCloseTo(points[3].x);
    expect(
      perspective([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });
});
