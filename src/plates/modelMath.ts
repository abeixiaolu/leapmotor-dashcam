export type Point = { x: number; y: number };
export type Corners = [Point, Point, Point, Point];
export type Detection = {
  box: { x: number; y: number; width: number; height: number };
  corners: Corners;
  confidence: number;
  doubleRow: boolean;
};

export const PLATE_TOKENS = [
  "blank",
  "'",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "云",
  "京",
  "冀",
  "吉",
  "学",
  "宁",
  "川",
  "挂",
  "新",
  "晋",
  "桂",
  "民",
  "沪",
  "津",
  "浙",
  "渝",
  "港",
  "湘",
  "琼",
  "甘",
  "皖",
  "粤",
  "航",
  "苏",
  "蒙",
  "藏",
  "警",
  "豫",
  "贵",
  "赣",
  "辽",
  "鄂",
  "闽",
  "陕",
  "青",
  "鲁",
  "黑",
  "领",
  "使",
  "澳",
];

export const DETECTOR_SIZE = 640;
export const RECOGNIZER_WIDTH = 160;
export const RECOGNIZER_CLASSES = 78;
export const RECOGNIZER_HEIGHT = 48;

export function letterbox(width: number, height: number) {
  const scale = Math.min(DETECTOR_SIZE / width, DETECTOR_SIZE / height);
  const resizedWidth = Math.floor(width * scale);
  const resizedHeight = Math.floor(height * scale);
  return {
    scale,
    width: resizedWidth,
    height: resizedHeight,
    left: Math.floor((DETECTOR_SIZE - resizedWidth) / 2),
    top: Math.floor((DETECTOR_SIZE - resizedHeight) / 2),
  };
}

function overlap(a: Detection, b: Detection) {
  const left = Math.max(a.box.x, b.box.x);
  const top = Math.max(a.box.y, b.box.y);
  const right = Math.min(a.box.x + a.box.width, b.box.x + b.box.width);
  const bottom = Math.min(a.box.y + a.box.height, b.box.y + b.box.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / (a.box.width * a.box.height + b.box.width * b.box.height - intersection);
}

export function decodeDetections(data: Float32Array, width: number, height: number): Detection[] {
  const fit = letterbox(width, height);
  const detections: Detection[] = [];
  for (let offset = 0; offset < data.length; offset += 15) {
    const confidence = data[offset + 4] * Math.max(data[offset + 13], data[offset + 14]);
    if (!Number.isFinite(confidence) || confidence < 0.4) continue;
    const x = (data[offset] - data[offset + 2] / 2 - fit.left) / fit.scale;
    const y = (data[offset + 1] - data[offset + 3] / 2 - fit.top) / fit.scale;
    const right = Math.min(width, x + data[offset + 2] / fit.scale);
    const bottom = Math.min(height, y + data[offset + 3] / fit.scale);
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const point = (index: number): Point => ({
      x: (data[offset + index] - fit.left) / fit.scale,
      y: (data[offset + index + 1] - fit.top) / fit.scale,
    });
    const corners: Corners = [point(5), point(7), point(9), point(11)];
    if (right - left < 12 || bottom - top < 5) continue;
    if (!corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
    detections.push({
      box: { x: left, y: top, width: right - left, height: bottom - top },
      corners,
      confidence,
      doubleRow: data[offset + 14] > data[offset + 13],
    });
  }
  detections.sort((a, b) => b.confidence - a.confidence);
  const selected: Detection[] = [];
  for (const candidate of detections) {
    if (selected.every((previous) => overlap(previous, candidate) <= 0.5)) selected.push(candidate);
    if (selected.length === 8) break;
  }
  return selected;
}

export function decodeText(data: Float32Array) {
  let previous = -1;
  let text = "";
  let total = 0;
  let minimum = 1;
  let count = 0;
  const characterScores: number[] = [];
  for (let offset = 0; offset < data.length; offset += RECOGNIZER_CLASSES) {
    let index = 0;
    for (let i = 1; i < RECOGNIZER_CLASSES; i++) {
      if (data[offset + i] > data[offset + index]) index = i;
    }
    if (index !== 0 && index !== previous) {
      text += PLATE_TOKENS[index] ?? "?";
      total += data[offset + index];
      minimum = Math.min(minimum, data[offset + index]);
      count++;
      characterScores.push(data[offset + index]);
    }
    previous = index;
  }
  return {
    text,
    confidence: count ? total / count : 0,
    minimum: count ? minimum : 0,
    characterScores,
  };
}

export function isStandardPlate(text: string) {
  return /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{5,6}$/.test(
    text,
  );
}

export function qualifyPlate({
  text,
  characterScores,
}: Pick<ReturnType<typeof decodeText>, "text" | "characterScores">) {
  if (
    !isStandardPlate(text) ||
    characterScores.length !== text.length ||
    characterScores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)
  )
    return null;
  const serialScores = characterScores.slice(1);
  const serialMean = serialScores.reduce((sum, score) => sum + score, 0) / serialScores.length;
  if (serialMean < 0.8 || Math.min(...serialScores) < 0.45) return null;
  return {
    text,
    confidence: characterScores.reduce((sum, score) => sum + score, 0) / characterScores.length,
    provinceConfidence: characterScores[0],
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function perspective(corners: Corners) {
  const [a, b, c, d] = corners;
  const dx1 = b.x - c.x;
  const dx2 = d.x - c.x;
  const dx3 = a.x - b.x + c.x - d.x;
  const dy1 = b.y - c.y;
  const dy2 = d.y - c.y;
  const dy3 = a.y - b.y + c.y - d.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < 1e-6) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const width = Math.max(distance(a, b), distance(c, d));
  const height = Math.max(distance(a, d), distance(b, c));
  if (width < 4 || height < 4) return null;
  return {
    width,
    height,
    map(u: number, v: number): Point {
      const denominator = g * u + h * v + 1;
      return {
        x: ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / denominator,
        y: ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / denominator,
      };
    },
  };
}

export function recognitionTensor(
  image: ImageData,
  transform: NonNullable<ReturnType<typeof perspective>>,
  start = 0,
  end = 1,
) {
  const plane = RECOGNIZER_WIDTH * RECOGNIZER_HEIGHT;
  const data = new Float32Array(plane * 3);
  const ratio = transform.width / (transform.height * (end - start));
  const resizedWidth = Math.min(
    RECOGNIZER_WIDTH,
    Math.max(48, Math.ceil(RECOGNIZER_HEIGHT * ratio)),
  );
  for (let y = 0; y < RECOGNIZER_HEIGHT; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const point = transform.map(
        (x + 0.5) / resizedWidth,
        start + ((y + 0.5) / RECOGNIZER_HEIGHT) * (end - start),
      );
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const sx = Math.min(image.width - 1, Math.max(0, point.x));
      const sy = Math.min(image.height - 1, Math.max(0, point.y));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const y1 = Math.min(image.height - 1, y0 + 1);
      const dx = sx - x0;
      const dy = sy - y0;
      for (let channel = 0; channel < 3; channel++) {
        const sourceChannel = 2 - channel;
        const p00 = image.data[(y0 * image.width + x0) * 4 + sourceChannel];
        const p10 = image.data[(y0 * image.width + x1) * 4 + sourceChannel];
        const p01 = image.data[(y1 * image.width + x0) * 4 + sourceChannel];
        const p11 = image.data[(y1 * image.width + x1) * 4 + sourceChannel];
        const value = (p00 * (1 - dx) + p10 * dx) * (1 - dy) + (p01 * (1 - dx) + p11 * dx) * dy;
        data[channel * plane + y * RECOGNIZER_WIDTH + x] = (value - 127.5) / 127.5;
      }
    }
  }
  return data;
}
