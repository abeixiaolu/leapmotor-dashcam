/** Client-side U 盘 / 文件夹选择（iOS Safari 走 webkitdirectory / 文件 App）。 */

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
  if (!parts.length) return "已选文件夹";
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
 * iOS Safari quirks for <input type=file> (esp. webkitdirectory):
 * - Files.app often opens as a sheet: visibility may stay "visible", no pagehide
 * - `change` / `cancel` often do NOT fire after the sheet dismisses
 * - FileList may populate late, or stay empty (pre-iOS 18.4 directory upload, USB grant fail)
 * - focus can fire immediately after input.click() — must grace-ignore
 * - requiring leftForPicker===true before empty-settle caused the「等待选择文件夹…」hang
 *
 * Strategy: poll FileList; after a post-click grace, any return signal schedules empty settle;
 * AbortSignal tears down; shorter mobile watchdog with a clear empty result (never infinite wait).
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
  /** Fires after post-click grace when the page looks interactive again (sheet dismissed). */
  onReturn?: () => void;
  watchdogMs?: number;
  emptySettleMs?: number;
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
  // iPhone: FileList may stay empty for seconds while WebKit walks a USB folder.
  // Too-short empty settle reintroduces a false「未读到文件」; too-long feels hung.
  const emptySettleMs = opts.emptySettleMs ?? (isLikelyMobileSafari() ? 12_000 : 2_200);
  const watchdogMs = opts.watchdogMs ?? (isLikelyMobileSafari() ? 90_000 : 180_000);
  const openedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let returnNotified = false;
    let emptySettleTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const readFiles = (): File[] => (input.files ? Array.from(input.files) : []);

    const cleanup = () => {
      localAbort.signal.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", onExternalAbort);
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      input.removeEventListener("input", onChange);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pointerdown", onUserReentry, true);
      window.removeEventListener("touchstart", onUserReentry, true);
      if (emptySettleTimer) clearTimeout(emptySettleTimer);
      if (watchdog) clearTimeout(watchdog);
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

    const scheduleEmptySettle = (ms: number) => {
      if (settled) return;
      if (emptySettleTimer) clearTimeout(emptySettleTimer);
      emptySettleTimer = setTimeout(() => {
        if (settled) return;
        settle(readFiles());
      }, ms);
    };

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

    // Soft return (focus/pageshow): iOS may focus-flicker while Files sheet is still open.
    // Only update UI + poll; use a long empty timer so we don't abort mid-browse.
    const onSoftReturn = () => {
      if (settled || !pastGrace()) return;
      notifyReturn();
      tryRead();
      scheduleEmptySettle(Math.max(emptySettleMs, 45_000));
    };

    // Hard return: user touched our page again → sheet is gone. Empty-settle sooner.
    // (Previous hang: we required visibility===hidden, which iPhone Files sheet never sets.)
    const onHardReturn = () => {
      if (settled || !pastGrace()) return;
      notifyReturn();
      tryRead();
      scheduleEmptySettle(emptySettleMs);
    };

    const onWindowFocus = () => onSoftReturn();
    const onPageShow = () => onSoftReturn();
    const onUserReentry = () => onHardReturn();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") return;
      onSoftReturn();
    };

    const onPageHide = () => {
      /* some builds pagehide when opening Files; pageshow/focus handle return */
    };

    localAbort.signal.addEventListener("abort", onAbort);
    signal?.addEventListener("abort", onExternalAbort);
    input.addEventListener("change", onChange);
    input.addEventListener("input", onChange);
    input.addEventListener("cancel", onCancel);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    // iOS: sheet dismiss + tap back into Safari may not focus/visibility-change
    window.addEventListener("pointerdown", onUserReentry, true);
    window.addEventListener("touchstart", onUserReentry, true);

    pollTimer = setInterval(tryRead, 200);

    watchdog = setTimeout(() => {
      if (settled) return;
      settle(readFiles());
    }, watchdogMs);
  });
}

function makeHiddenFileInput(directory: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
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
  return pickWithFileInput(false, signal, waitOpts);
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
 * synchronously inside the user-gesture turn — do not mark this `async`
 * (an async function defers the body to a microtask and iOS Safari drops the gesture).
 */
export function pickDirectoryFiles(signal?: AbortSignal, waitOpts?: WaitOpts): Promise<File[]> {
  if (signal?.aborted) return Promise.resolve([]);
  if (supportsDirectoryPicker()) {
    return pickWithShowDirectoryPicker().catch(() => pickWithWebkitDirectory(signal, waitOpts));
  }
  return pickWithWebkitDirectory(signal, waitOpts);
}

export async function buildDriveFromFiles(files: File[]): Promise<{
  drive: LocalDrive;
  fileMap: Map<string, File>;
}> {
  const recordings: LocalRecording[] = [];
  let h264Count = 0;
  for (const file of files) {
    if (!/\.h264$/i.test(file.name)) continue;
    h264Count += 1;
    if (!file.size) continue;
    const relative =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    let kind = kindFromPath(relative);
    if (!kind) {
      // 允许直接多选 .h264（无目录信息）时默认行车
      kind = "drive";
    }
    const id = await hashId(`local:${relative}:${file.size}:${file.lastModified}`);
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
  if (!recordings.length) {
    if (h264Count > 0) {
      throw new Error("找到了 .h264 文件，但大小为 0，无法播放。请确认 U 盘已正确挂载后重试。");
    }
    if (!files.length) {
      if (isLikelyMobileSafari() && !iosDirectoryUploadLikelySupported()) {
        throw new Error(
          "当前 iOS 低于 18.4，Safari 还不能用「选择文件夹」授权整个目录。请改用「多选录像文件」，在「文件」里进入 U 盘的 driverecord，多选 .h264 后打开；或把 U 盘插在电脑上用自动扫描。",
        );
      }
      throw new Error(
        "未读到任何文件。请在「文件」中打开 U 盘（常见名「NO NAME」），选择整个 U 盘或 driverecord 目录后点「打开」；若仍不行，点「多选录像文件」直接选 .h264。",
      );
    }
    throw new Error(
      `已选择 ${files.length} 个文件，但未找到零跑录像（需要 .h264）。请选择整个 U 盘或包含 driverecord / sentinel 的文件夹。`,
    );
  }
  recordings.sort((a, b) => b.stamp.localeCompare(a.stamp));
  const name = volumeNameFromPath(recordings[0]?.relativePath || "") || "已选文件夹";
  const id = await hashId(`local-drive:${name}:${recordings.length}:${recordings[0]?.id}`);
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

export async function uploadLocalRecording(
  id: string,
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  onProgress?.(0);
  const response = await new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/import/${encodeURIComponent(id)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Recording-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      resolve(
        new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: { "Content-Type": xhr.getResponseHeader("Content-Type") || "application/json" },
        }),
      );
    };
    xhr.onerror = () =>
      reject(new Error("上传录像失败，请确认手机与电脑在同一局域网，且开发服务仍在运行。"));
    xhr.onabort = () => reject(new Error("上传已取消。"));
    xhr.send(file);
  });
  if (!response.ok) {
    let message = "上传录像失败。";
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  onProgress?.(1);
}

export function describeScanFailure(status: number, serverMessage?: string): string {
  if (status === 403) {
    return (
      serverMessage ||
      "当前页面不能自动读取电脑上的 U 盘。请点「选择文件夹」，在「文件」App 中打开 U 盘并授权；或把 U 盘插在运行本服务的电脑上后重试。"
    );
  }
  if (status === 0 || status >= 500) {
    return "无法连接本地读取服务，请确认电脑上的开发服务仍在运行，且手机与电脑同一 Wi‑Fi。";
  }
  return serverMessage || "本地读取服务暂时不可用。";
}
