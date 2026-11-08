/** Client-side U 盘选择；iPhone 仅允许少量文件，其他设备支持文件夹。 */

export const IPHONE_RECORDING_LIMIT = 1;

export type LocalRecording = {
  id: string;
  name: string;
  stamp: string;
  kind: "drive" | "sentinel";
  size: number;
  file: File;
  relativePath: string;
};

export type LocalDrive = {
  id: string;
  name: string;
  recordings: Array<{
    id: string;
    name: string;
    stamp: string;
    kind: "drive" | "sentinel";
    size: number;
  }>;
};

export const stampForName = (name: string) => {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : name;
};

/** SHA-256 when available; insecure LAN HTTP (iPhone → http://192.168.x.x) has no subtle. */
export async function hashId(value: string): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 24);
    }
  } catch {
    /* fall through to non-subtle hash */
  }
  // FNV-1a style fallback — stable enough for session-local recording ids
  let h1 = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h1 ^= value.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
  }
  const mix = `${value.length}:${h1 >>> 0}:${value.slice(0, 48)}:${value.slice(-48)}`;
  let h2 = 2166136261;
  for (let i = 0; i < mix.length; i++) {
    h2 ^= mix.charCodeAt(i);
    h2 = Math.imul(h2, 16777619);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}${value.length
    .toString(16)
    .padStart(8, "0")}`.slice(0, 24);
}

const kindFromPath = (path: string): "drive" | "sentinel" | undefined => {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)driverecord\//.test(normalized) || /(^|\/)driverecord$/.test(normalized))
    return "drive";
  if (/(^|\/)sentinel\//.test(normalized) || /(^|\/)sentinel$/.test(normalized)) return "sentinel";
  // 用户可能只选了 driverecord 目录本身
  if (normalized.includes("driverecord")) return "drive";
  if (normalized.includes("sentinel")) return "sentinel";
  return undefined;
};

const volumeNameFromPath = (path: string): string => {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) return "已选录像文件";
  const marker = parts.findIndex((p) => /^(driverecord|sentinel)$/i.test(p));
  if (marker > 0) return parts[marker - 1] || "已选文件夹";
  return parts[0] || "已选文件夹";
};

export function isLikelyMobileSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS;
}

export function isMobileBrowser(): boolean {
  return (
    isLikelyMobileSafari() ||
    (typeof navigator !== "undefined" && /Android|Mobile/i.test(navigator.userAgent))
  );
}

export function isIPhoneBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone/i.test(navigator.userAgent || "") || /^iPhone$/i.test(navigator.platform || "");
}

const iPhoneDirectoryMessage = `移动端已停用文件夹导入。请选择录像文件，每次最多 ${IPHONE_RECORDING_LIMIT} 个。`;

/** Enforce the iPhone limit before indexing, hashing, or reading file content. */
export function validateRecordingSelection(files: File[]): void {
  if (!isMobileBrowser()) return;
  if (files.length > IPHONE_RECORDING_LIMIT) {
    throw new Error(
      `移动端每次最多选择 ${IPHONE_RECORDING_LIMIT} 个文件，本次选择了 ${files.length} 个。请减少数量后重新选择。`,
    );
  }
  if (files.some((file) => file.webkitRelativePath)) {
    throw new Error(iPhoneDirectoryMessage);
  }
}

/** iOS gained real webkitdirectory folder grants in 18.4 (WebKit 271705). */
export function iosDirectoryUploadLikelySupported(): boolean {
  if (!isLikelyMobileSafari()) return true;
  const ua = navigator.userAgent || "";
  const m = ua.match(/OS (\d+)_(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 18 || (major === 18 && minor >= 4);
}

export function supportsDirectoryPicker(): boolean {
  if (typeof window === "undefined") return false;
  // iOS / iPadOS: showDirectoryPicker is missing or unreliable; force <input webkitdirectory>.
  if (isLikelyMobileSafari()) return false;
  return (
    typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === "function"
  );
}

type DirHandle = {
  name: string;
  values: () => AsyncIterable<{
    kind: string;
    name?: string;
    getFile?: () => Promise<File>;
    values?: () => AsyncIterable<unknown>;
  }>;
};

async function pickWithShowDirectoryPicker(): Promise<File[]> {
  const w = window as Window & {
    showDirectoryPicker?: () => Promise<DirHandle>;
  };
  if (typeof w.showDirectoryPicker !== "function") return [];
  try {
    const handle = await w.showDirectoryPicker();
    const files: File[] = [];
    const walk = async (dir: DirHandle | { values: DirHandle["values"] }, prefix: string) => {
      for await (const entry of dir.values()) {
        if (entry.kind === "file" && entry.getFile) {
          const file = await entry.getFile();
          const relative = prefix ? `${prefix}/${file.name}` : file.name;
          Object.defineProperty(file, "webkitRelativePath", {
            configurable: true,
            value: `${handle.name}/${relative}`,
          });
          files.push(file);
        } else if (entry.kind === "directory" && entry.values) {
          await walk(entry as DirHandle, prefix ? `${prefix}/${entry.name}` : String(entry.name));
        }
      }
    };
    await walk(handle, "");
    return files;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "NotAllowedError")
    ) {
      return [];
    }
    throw error;
  }
}

/**
 * iOS may copy a selected USB directory before returning its FileList. The page
 * can regain focus while that work is still running, and large directories can
 * take minutes. Neither focus nor elapsed time proves cancellation.
 *
 * Keep the input alive until files arrive, the picker reports change/cancel, or
 * the user explicitly cancels through AbortSignal / abortDirectoryPick. Polling
 * also handles browsers that populate FileList without dispatching change.
 */
let activeWebkitPickAbort: AbortController | null = null;

/** Cancel any in-flight webkitdirectory / file pick and remove its <input>. */
export function abortDirectoryPick(): void {
  try {
    activeWebkitPickAbort?.abort();
  } catch {
    /* ignore */
  }
  activeWebkitPickAbort = null;
}

type WaitOpts = {
  /** Fires after post-click grace when the page looks interactive again. */
  onReturn?: () => void;
  graceMs?: number;
};

function attachInputWaiter(
  input: HTMLInputElement,
  signal: AbortSignal | undefined,
  opts: WaitOpts,
  removeInputOnSettle: boolean,
): Promise<File[]> {
  abortDirectoryPick();
  const localAbort = new AbortController();
  activeWebkitPickAbort = localAbort;

  if (signal?.aborted || localAbort.signal.aborted) {
    return Promise.resolve([]);
  }

  const graceMs = opts.graceMs ?? 900;
  const openedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let returnNotified = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const readFiles = (): File[] => (input.files ? Array.from(input.files) : []);

    const cleanup = () => {
      localAbort.signal.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", onExternalAbort);
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      input.removeEventListener("input", onChange);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onReturn, true);
      window.removeEventListener("touchstart", onReturn, true);
      if (pollTimer) clearInterval(pollTimer);
      if (activeWebkitPickAbort === localAbort) activeWebkitPickAbort = null;
      if (removeInputOnSettle) {
        setTimeout(() => {
          try {
            input.value = "";
            input.remove();
          } catch {
            /* ignore */
          }
        }, 0);
      } else {
        try {
          input.value = "";
        } catch {
          /* ignore */
        }
      }
    };

    const settle = (files: File[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };

    const onAbort = () => settle([]);
    const onExternalAbort = () => {
      try {
        localAbort.abort();
      } catch {
        /* ignore */
      }
    };

    const pastGrace = () => Date.now() - openedAt >= graceMs;

    const tryRead = () => {
      if (settled) return;
      const files = readFiles();
      if (files.length) settle(files);
    };

    const onChange = () => {
      // change with 0 files = cancelled / empty grant — leave waiting immediately
      settle(readFiles());
    };

    const onCancel = () => settle([]);

    const notifyReturn = () => {
      if (returnNotified) return;
      returnNotified = true;
      try {
        opts.onReturn?.();
      } catch {
        /* ignore UI callback errors */
      }
    };

    // Return signals update progress, but cannot distinguish copying from cancellation.
    const onReturn = () => {
      if (settled || !pastGrace()) return;
      notifyReturn();
      tryRead();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") return;
      onReturn();
    };

    localAbort.signal.addEventListener("abort", onAbort);
    signal?.addEventListener("abort", onExternalAbort);
    input.addEventListener("change", onChange);
    input.addEventListener("input", onChange);
    input.addEventListener("cancel", onCancel);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onVisibility);
    // iOS: sheet dismiss + tap back into Safari may not focus/visibility-change
    window.addEventListener("pointerdown", onReturn, true);
    window.addEventListener("touchstart", onReturn, true);

    pollTimer = setInterval(tryRead, 200);
  });
}

function makeHiddenFileInput(directory: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = !isMobileBrowser();
  if (directory) {
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    // Intentionally no accept= — iOS Filters + webkitdirectory is buggy.
  } else {
    // Multi-file fallback for iOS < 18.4 or when directory grant returns empty.
    input.setAttribute("accept", ".h264,video/*,application/octet-stream,*/*");
  }
  Object.assign(input.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    opacity: "0.01",
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: "2147483647",
  });
  document.body.appendChild(input);
  return input;
}

function pickWithFileInput(
  directory: boolean,
  externalSignal?: AbortSignal,
  waitOpts?: WaitOpts,
): Promise<File[]> {
  if (externalSignal?.aborted) {
    return Promise.resolve([]);
  }

  const input = makeHiddenFileInput(directory);
  const waited = attachInputWaiter(input, externalSignal, waitOpts || {}, true);

  try {
    // Must run in the same user-gesture turn as the button click.
    input.click();
  } catch (error) {
    abortDirectoryPick();
    try {
      input.remove();
    } catch {
      /* ignore */
    }
    return Promise.reject(error);
  }

  return waited;
}

function pickWithWebkitDirectory(
  externalSignal?: AbortSignal,
  waitOpts?: WaitOpts,
): Promise<File[]> {
  return pickWithFileInput(true, externalSignal, waitOpts);
}

/** Multi-select files (no webkitdirectory) — iOS Files can pick .h264 from USB this way. */
export function pickRecordingFiles(signal?: AbortSignal, waitOpts?: WaitOpts): Promise<File[]> {
  return pickWithFileInput(false, signal, waitOpts).then((files) => {
    validateRecordingSelection(files);
    return files;
  });
}

/**
 * Attach to a React-managed <input> already in the document.
 * Call input.click() yourself in the same user-gesture turn, then await this.
 */
export function waitForInputFiles(input: HTMLInputElement, signal?: AbortSignal): Promise<File[]> {
  return attachInputWaiter(input, signal, {}, false);
}

/**
 * Open a directory picker. IMPORTANT: the webkitdirectory path must click()
 * synchronously inside the user-gesture turn — do not await before opening it.
 */
export function pickDirectoryFiles(signal?: AbortSignal, waitOpts?: WaitOpts): Promise<File[]> {
  if (signal?.aborted) return Promise.resolve([]);
  if (isMobileBrowser()) return Promise.reject(new Error(iPhoneDirectoryMessage));
  if (supportsDirectoryPicker()) {
    return pickWithShowDirectoryPicker().catch(() => pickWithWebkitDirectory(signal, waitOpts));
  }
  return pickWithWebkitDirectory(signal, waitOpts);
}

type IndexOptions = {
  signal?: AbortSignal;
  onProgress?: (processed: number, total: number) => void;
};

/** Yield a task even without crypto.subtle, so progress and cancel can update. */
function yieldForImport(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 0);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function buildDriveFromFiles(
  files: File[],
  options: IndexOptions = {},
): Promise<{
  drive: LocalDrive;
  fileMap: Map<string, File>;
}> {
  validateRecordingSelection(files);
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const recordings: LocalRecording[] = [];
  let h264Count = 0;
  onProgress?.(0, files.length);
  // Only inspect metadata here. Video reads/remuxing start when a clip is opened.
  for (let offset = 0; offset < files.length; offset += 50) {
    await yieldForImport(signal);
    signal?.throwIfAborted();
    const batch = files.slice(offset, offset + 50);
    for (const file of batch) {
      if (!/\.h264$/i.test(file.name)) continue;
      h264Count += 1;
      if (!file.size) continue;
      const relative =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const kind = kindFromPath(relative) ?? "drive";
      const id = await hashId(`local:${relative}:${file.size}:${file.lastModified}`);
      signal?.throwIfAborted();
      recordings.push({
        id,
        name: file.name,
        stamp: stampForName(file.name),
        kind,
        size: file.size,
        file,
        relativePath: relative,
      });
    }
    onProgress?.(offset + batch.length, files.length);
  }
  signal?.throwIfAborted();
  if (!recordings.length) {
    if (h264Count > 0) {
      throw new Error("找到了 .h264 文件，但大小为 0，无法播放。请确认 U 盘已正确挂载后重试。");
    }
    if (!files.length) {
      if (isMobileBrowser()) {
        throw new Error(
          `未读到任何文件。请从 U 盘选择录像文件，每次最多 ${IPHONE_RECORDING_LIMIT} 个。`,
        );
      }
      if (isLikelyMobileSafari() && !iosDirectoryUploadLikelySupported()) {
        throw new Error(
          "当前 iOS 低于 18.4，Safari 还不能用「选择文件夹」授权整个目录。请改用「多选录像文件」，在「文件」里进入 U 盘的 driverecord，多选 .h264 后打开。",
        );
      }
      throw new Error(
        "未读到任何文件。请在「文件」中打开 U 盘（常见名「NO NAME」），选择整个 U 盘或 driverecord 目录后点「打开」；若仍不行，点「多选录像文件」直接选 .h264。",
      );
    }
    if (isMobileBrowser()) {
      throw new Error(`已选择 ${files.length} 个文件，但未找到零跑录像。请选择 .h264 文件。`);
    }
    throw new Error(
      `已选择 ${files.length} 个文件，但未找到零跑录像（需要 .h264）。请选择整个 U 盘或包含 driverecord / sentinel 的文件夹。`,
    );
  }
  recordings.sort((a, b) => b.stamp.localeCompare(a.stamp));
  const name = volumeNameFromPath(recordings[0]?.relativePath || "") || "已选文件夹";
  const id = await hashId(`local-drive:${name}:${recordings.length}:${recordings[0]?.id}`);
  signal?.throwIfAborted();
  const fileMap = new Map(recordings.map((r) => [r.id, r.file]));
  return {
    drive: {
      id,
      name,
      recordings: recordings.map(({ id: rid, name: rname, stamp, kind, size }) => ({
        id: rid,
        name: rname,
        stamp,
        kind,
        size,
      })),
    },
    fileMap,
  };
}
