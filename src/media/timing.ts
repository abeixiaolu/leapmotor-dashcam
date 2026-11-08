export type RecordedTiming = {
  fpsNumerator: number;
  fpsDenominator: number;
  frameCount: number;
  duration: number;
  timing: "recorded";
};
const UUID = new Uint8Array([4, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21, 22]);

/** Leapmotor type-5 SEI: UUID + 28 bytes metadata + LE uint64 epoch milliseconds. */
function timestampFromSei(bytes: number[]): number | undefined {
  const rbsp: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (i >= 2 && bytes[i] === 3 && bytes[i - 1] === 0 && bytes[i - 2] === 0) continue;
    rbsp.push(bytes[i]!);
  }
  const b = new Uint8Array(rbsp);
  let p = 1;
  while (p < b.length) {
    if (b[p] === 0x80 && p === b.length - 1) break;
    let type = 0;
    while (p < b.length && b[p] === 255) {
      type += 255;
      p++;
    }
    if (p >= b.length) return undefined;
    type += b[p++]!;
    let size = 0;
    while (p < b.length && b[p] === 255) {
      size += 255;
      p++;
    }
    if (p >= b.length) return undefined;
    size += b[p++]!;
    if (p + size > b.length) return undefined;
    if (type === 5 && size >= 52 && UUID.every((value, index) => b[p + index] === value)) {
      const stamp = Number(new DataView(b.buffer).getBigUint64(p + 44, true));
      if (stamp >= 946684800000 && stamp <= 4102444800000) return stamp;
    }
    p += size;
  }
  return undefined;
}

/** Scans Annex-B without accumulating frame payloads. Memory is bounded to one small SEI. */
export async function scanRecordingTiming(
  chunks: AsyncIterable<Uint8Array>,
): Promise<RecordedTiming | undefined> {
  let zeros = 0;
  let type: number | undefined;
  let sei: number[] = [];
  let oversize = false;
  let first = 0;
  let last = 0;
  let count = 0;
  let invalid = false;
  const deltas: number[] = [];
  const finish = () => {
    if (type === 6 && !oversize) {
      const stamp = timestampFromSei(sei);
      if (stamp !== undefined) {
        if (!count) first = stamp;
        else {
          const delta = stamp - last;
          if (delta <= 0 || delta > 10000) invalid = true;
          if (deltas.length < 4096) deltas.push(delta);
        }
        count++;
        last = stamp;
      }
    }
    type = undefined;
    sei = [];
    oversize = false;
  };
  const append = (value: number) => {
    if (type === undefined) type = value & 31;
    if (type === 6 && !oversize) {
      if (sei.length < 4096) sei.push(value);
      else {
        oversize = true;
        sei = [];
      }
    }
  };
  for await (const chunk of chunks) {
    for (const value of chunk) {
      if (value === 0) {
        zeros++;
        continue;
      }
      if (value === 1 && zeros >= 2) {
        finish();
        zeros = 0;
        continue;
      }
      if (type === 6 || type === undefined) {
        for (let z = 0; z < Math.min(zeros, 4097); z++) append(0);
      }
      zeros = 0;
      append(value);
    }
  }
  finish();
  if (invalid || count < 2 || !deltas.length) return undefined;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)]!;
  const milliseconds = last - first + median;
  const fps = (count * 1000) / milliseconds;
  if (fps < 5 || fps > 120) return undefined;
  return {
    fpsNumerator: count * 1000,
    fpsDenominator: milliseconds,
    frameCount: count,
    duration: milliseconds / 1000,
    timing: "recorded",
  };
}
