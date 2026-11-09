import { isStandardPlate } from "./modelMath";
import { MAX_PLATE_CANDIDATES, MIN_PROVINCE_CONFIDENCE } from "./observations";
import type { PlateBox, PlateCandidate, ProvinceEvidence } from "./types";

export const PLATE_CACHE_TTL = 24 * 60 * 60 * 1000;
const DATABASE = "leapmotor-plate-cache";
const STORE = "results";
const KEY_PREFIX = "plate-v2:";
const MAX_RECORDS = 20;
const MAX_BYTES = 64 * 1024 * 1024;
const STORAGE_TIMEOUT = 2000;

type CachedPlateResult = {
  key: string;
  completedAt: number;
  candidates: PlateCandidate[];
};

export type PlateCacheLookup =
  | { kind: "miss" }
  | { kind: "hit"; candidates: PlateCandidate[]; completedAt: number; expiresAt: number };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isBox(value: unknown): value is PlateBox {
  return (
    isObject(value) &&
    isFiniteNumber(value.x) &&
    value.x >= 0 &&
    isFiniteNumber(value.y) &&
    value.y >= 0 &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0
  );
}

function isProvince(value: unknown): value is ProvinceEvidence {
  if (!isObject(value)) return false;
  if (value.kind === "unread" || value.kind === "conflict") return true;
  return (
    value.kind === "read" &&
    typeof value.value === "string" &&
    value.value.length === 1 &&
    isStandardPlate(`${value.value}A00000`) &&
    isFiniteNumber(value.score) &&
    value.score >= MIN_PROVINCE_CONFIDENCE &&
    value.score <= 1
  );
}

function isCandidate(value: unknown): value is PlateCandidate {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 128 &&
    typeof value.serial === "string" &&
    /^[A-HJ-NP-Z][A-HJ-NP-Z0-9]{5,6}$/.test(value.serial) &&
    isProvince(value.province) &&
    (value.direction === "front" ||
      value.direction === "rear" ||
      value.direction === "left" ||
      value.direction === "right") &&
    isFiniteNumber(value.time) &&
    value.time >= 0 &&
    isFiniteNumber(value.lastSeen) &&
    value.lastSeen >= value.time &&
    isFiniteNumber(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isFiniteNumber(value.observations) &&
    Number.isInteger(value.observations) &&
    value.observations > 0 &&
    isBox(value.box) &&
    isBox(value.lastBox) &&
    value.thumbnail instanceof Blob &&
    value.thumbnail.type === "image/png" &&
    value.thumbnail.size > 0 &&
    value.thumbnail.size <= MAX_BYTES
  );
}

const imageBytes = (candidates: PlateCandidate[]) =>
  candidates.reduce((bytes, candidate) => bytes + candidate.thumbnail.size, 0);

export function parsePlateCache(value: unknown, now: number): CachedPlateResult | null {
  if (
    !isObject(value) ||
    typeof value.key !== "string" ||
    !value.key.startsWith(KEY_PREFIX) ||
    value.key.length <= KEY_PREFIX.length ||
    !isFiniteNumber(value.completedAt) ||
    value.completedAt < 0 ||
    value.completedAt > now ||
    now - value.completedAt >= PLATE_CACHE_TTL ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > MAX_PLATE_CANDIDATES ||
    !value.candidates.every(isCandidate) ||
    imageBytes(value.candidates) > MAX_BYTES
  )
    return null;
  return { key: value.key, completedAt: value.completedAt, candidates: value.candidates };
}

function withStore<T>(
  mode: IDBTransactionMode,
  signal: AbortSignal,
  fallback: T,
  work: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    let settled = false;
    let database: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    let result = fallback;
    const finish = (value: T, abort = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
      if (abort && transaction) {
        try {
          transaction.abort();
        } catch {
          /* The transaction may have already finished. */
        }
      }
      database?.close();
      resolve(value);
    };
    const cancelled = () => finish(fallback, true);
    const timer = setTimeout(cancelled, STORAGE_TIMEOUT);
    signal.addEventListener("abort", cancelled, { once: true });
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onblocked = cancelled;
      request.onerror = cancelled;
      request.onupgradeneeded = () => {
        if (settled || signal.aborted) {
          request.transaction?.abort();
          return;
        }
        request.result.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onsuccess = () => {
        database = request.result;
        if (settled || signal.aborted) {
          database.close();
          return;
        }
        database.onversionchange = () => database?.close();
        try {
          transaction = database.transaction(STORE, mode);
          transaction.onabort = cancelled;
          transaction.onerror = cancelled;
          transaction.oncomplete = () => finish(result);
          work(transaction.objectStore(STORE), (value) => {
            result = value;
          });
        } catch {
          cancelled();
        }
      };
    } catch {
      cancelled();
    }
  });
}

export function readPlateCache(
  recordingId: string,
  signal: AbortSignal,
): Promise<PlateCacheLookup> {
  return withStore<PlateCacheLookup>("readwrite", signal, { kind: "miss" }, (store, result) => {
    const key = KEY_PREFIX + recordingId;
    const request = store.get(key);
    request.onsuccess = () => {
      const stored: unknown = request.result;
      const cached = parsePlateCache(stored, Date.now());
      if (cached?.key === key) {
        result({
          kind: "hit",
          candidates: cached.candidates,
          completedAt: cached.completedAt,
          expiresAt: cached.completedAt + PLATE_CACHE_TTL,
        });
      } else if (stored !== undefined) store.delete(key);
    };
  });
}

export function invalidatePlateCache(recordingId: string, signal: AbortSignal): Promise<void> {
  return withStore("readwrite", signal, undefined, (store) => {
    store.delete(KEY_PREFIX + recordingId);
  });
}

export function savePlateCache({
  recordingId,
  candidates,
  completedAt,
  signal,
}: {
  recordingId: string;
  candidates: PlateCandidate[];
  completedAt: number;
  signal: AbortSignal;
}): Promise<void> {
  if (imageBytes(candidates) > MAX_BYTES) return Promise.resolve();
  return withStore("readwrite", signal, undefined, (store) => {
    const key = KEY_PREFIX + recordingId;
    const existing = store.get(key);
    existing.onsuccess = () => {
      const cached = parsePlateCache(existing.result, Date.now());
      if (!cached || cached.completedAt <= completedAt) {
        store.put({ key, completedAt, candidates } satisfies CachedPlateResult);
      }
      const retained: { key: IDBValidKey; completedAt: number; bytes: number }[] = [];
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) {
          const record = parsePlateCache(row.value, Date.now());
          if (record)
            retained.push({
              key: row.primaryKey,
              completedAt: record.completedAt,
              bytes: imageBytes(record.candidates),
            });
          else row.delete();
          row.continue();
          return;
        }
        let bytes = 0;
        retained.sort((a, b) => b.completedAt - a.completedAt);
        retained.forEach((record, index) => {
          bytes += record.bytes;
          if (index >= MAX_RECORDS || bytes > MAX_BYTES) store.delete(record.key);
        });
      };
    };
  });
}
