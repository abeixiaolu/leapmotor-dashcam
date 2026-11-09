import type { Direction } from "@/library";
import type { PlateBox, PlateCandidate, PlateHit, ProvinceEvidence } from "./types";

export const MAX_PLATE_CANDIDATES = 100;
export const MIN_PROVINCE_CONFIDENCE = 0.8;
const MAX_OBSERVATION_GAP = 5;
const MIN_BOX_OVERLAP = 0.25;

export function plateText(candidate: Pick<PlateCandidate, "serial" | "province">) {
  const prefix = candidate.province.kind === "read" ? candidate.province.value : "?";
  return prefix + candidate.serial;
}

function overlap(a: PlateBox, b: PlateBox) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = width * height;
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

function observe(previous: PlateCandidate, hit: PlateHit, time: number): PlateCandidate {
  let province: ProvinceEvidence = previous.province;
  let replaceImage = false;
  switch (province.kind) {
    case "unread":
      if (hit.provinceConfidence >= MIN_PROVINCE_CONFIDENCE) {
        province = { kind: "read", value: hit.text[0], score: hit.provinceConfidence };
        replaceImage = true;
      } else replaceImage = hit.confidence > previous.confidence;
      break;
    case "read":
      if (hit.provinceConfidence >= MIN_PROVINCE_CONFIDENCE) {
        if (hit.text[0] !== province.value) {
          province = { kind: "conflict" };
          replaceImage = hit.confidence > previous.confidence;
        } else if (
          hit.provinceConfidence > province.score ||
          (hit.provinceConfidence === province.score && hit.confidence > previous.confidence)
        ) {
          province = { kind: "read", value: hit.text[0], score: hit.provinceConfidence };
          replaceImage = true;
        }
      }
      break;
    case "conflict":
      replaceImage = hit.confidence > previous.confidence;
      break;
  }
  return {
    ...previous,
    ...(replaceImage
      ? { confidence: hit.confidence, box: hit.box, thumbnail: hit.thumbnail, time }
      : {}),
    province,
    lastSeen: time,
    lastBox: hit.box,
    observations: previous.observations + 1,
  };
}

export function mergePlateHits(
  candidates: PlateCandidate[],
  hits: PlateHit[],
  direction: Direction,
  time: number,
) {
  const matches = hits.map((hit) =>
    candidates.flatMap((candidate, index) => {
      const gap = time - candidate.lastSeen;
      return candidate.serial === hit.text.slice(1) &&
        candidate.direction === direction &&
        gap > 0 &&
        gap <= MAX_OBSERVATION_GAP &&
        overlap(candidate.lastBox, hit.box) >= MIN_BOX_OVERLAP
        ? [index]
        : [];
    }),
  );
  const claims = new Map<number, number>();
  for (const indices of matches)
    for (const index of indices) claims.set(index, (claims.get(index) ?? 0) + 1);

  const next = [...candidates];
  for (const [hitIndex, hit] of hits.entries()) {
    const indices = matches[hitIndex];
    if (indices.length === 1 && claims.get(indices[0]) === 1) {
      const index = indices[0];
      next[index] = observe(candidates[index], hit, time);
    } else if (next.length < MAX_PLATE_CANDIDATES) {
      next.push({
        id: `${direction}-${time}-${next.length}`,
        serial: hit.text.slice(1),
        province:
          hit.provinceConfidence >= MIN_PROVINCE_CONFIDENCE
            ? { kind: "read", value: hit.text[0], score: hit.provinceConfidence }
            : { kind: "unread" },
        confidence: hit.confidence,
        box: hit.box,
        lastBox: hit.box,
        thumbnail: hit.thumbnail,
        direction,
        time,
        lastSeen: time,
        observations: 1,
      });
    }
  }
  return next;
}
