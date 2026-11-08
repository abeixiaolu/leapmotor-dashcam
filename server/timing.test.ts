import { describe, expect, it } from "vite-plus/test";
import { scanRecordingTiming } from "./timing";
function sei(stamp: number, uuid = "04020304050607080910111213141516") {
  const raw = Buffer.alloc(56);
  raw[0] = 6;
  raw[1] = 5;
  raw[2] = 52;
  Buffer.from(uuid, "hex").copy(raw, 3);
  raw.writeBigUInt64LE(BigInt(stamp), 47);
  raw[55] = 128;
  const escaped: number[] = [];
  let zeros = 0;
  for (const b of raw) {
    if (zeros >= 2 && b <= 3) {
      escaped.push(3);
      zeros = 0;
    }
    escaped.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return Buffer.from([0, 0, 0, 1, ...escaped]);
}
async function* chunks(buffer: Buffer, size = 3) {
  for (let i = 0; i < buffer.length; i += size) yield buffer.subarray(i, i + size);
}
describe("Leapmotor SEI timing", () => {
  it("reads frame timestamps across split start codes and emulation prevention", async () => {
    const base = 1794040414941;
    const result = await scanRecordingTiming(
      chunks(Buffer.concat([sei(base), sei(base + 40), sei(base + 82), sei(base + 122)])),
    );
    expect(result).toEqual({
      fpsNumerator: 4000,
      fpsDenominator: 162,
      frameCount: 4,
      duration: 0.162,
      timing: "recorded",
    });
  });
  it("ignores unrelated SEI and large video slice payloads", async () => {
    const base = 1794040414941;
    const stream = Buffer.concat([
      sei(base, "11111111111111111111111111111111"),
      sei(base),
      Buffer.from([0, 0, 1, 65]),
      Buffer.alloc(200000, 99),
      sei(base + 40),
    ]);
    expect((await scanRecordingTiming(chunks(stream, 65536)))?.frameCount).toBe(2);
  });
  it("rejects backwards time and incomplete metadata", async () => {
    expect(
      await scanRecordingTiming(chunks(Buffer.concat([sei(1794040414941), sei(1794040414901)]))),
    ).toBeUndefined();
    expect(await scanRecordingTiming(chunks(sei(1794040414941).subarray(0, 20)))).toBeUndefined();
  });
});
