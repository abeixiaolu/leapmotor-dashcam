import type { Direction } from "@/library";

export type PlateBox = { x: number; y: number; width: number; height: number };

export type PlateHit = {
  text: string;
  confidence: number;
  provinceConfidence: number;
  box: PlateBox;
  thumbnail: Blob;
};

export type ProvinceEvidence =
  | { kind: "unread" }
  | { kind: "read"; value: string; score: number }
  | { kind: "conflict" };

export type PlateCandidate = {
  id: string;
  serial: string;
  province: ProvinceEvidence;
  confidence: number;
  box: PlateBox;
  lastBox: PlateBox;
  thumbnail: Blob;
  direction: Direction;
  time: number;
  lastSeen: number;
  observations: number;
};

export type PlateScan =
  | { kind: "idle" }
  | { kind: "checking-cache" }
  | { kind: "cached"; candidates: PlateCandidate[]; completedAt: number; expiresAt: number }
  | { kind: "loading" }
  | { kind: "scanning"; completed: number; total: number; candidates: PlateCandidate[] }
  | { kind: "complete"; candidates: PlateCandidate[] }
  | { kind: "stopped"; candidates: PlateCandidate[] }
  | { kind: "error"; message: string; candidates: PlateCandidate[] };

export type PlateWorkerRequest =
  | { kind: "initialize" }
  | { kind: "frame"; requestId: number; image: ImageBitmap };

export type PlateWorkerReply =
  | { kind: "ready" }
  | { kind: "result"; requestId: number; hits: PlateHit[] }
  | { kind: "error"; message: string };
