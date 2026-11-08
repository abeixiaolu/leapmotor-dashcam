import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  abortDirectoryPick,
  buildDriveFromFiles,
  IPHONE_RECORDING_LIMIT,
  isIPhoneBrowser,
  pickDirectoryFiles,
  pickRecordingFiles,
  stampForName,
} from "./localFolder";

function recording(name: string, path: string, size = 4) {
  const file = new File([new Uint8Array(size)], name, { lastModified: 1234 });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("browser recording library", () => {
  it("indexes both categories, sorts dates and retains local File references", async () => {
    const drive = recording(
      "2026-11-07_163334Z+0800_0027.h264",
      "USB/driverecord/2026-11-07_163334Z+0800_0027.h264",
    );
    const sentinel = recording("2026-11-08_120000.h264", "USB/sentinel/2026-11-08_120000.h264");
    const result = await buildDriveFromFiles([
      drive,
      sentinel,
      recording("thumbnail.jpg", "USB/thumbnail.jpg"),
    ]);
    expect(result.drive.name).toBe("USB");
    expect(result.drive.recordings.map((r) => r.kind)).toEqual(["sentinel", "drive"]);
    expect(result.fileMap.get(result.drive.recordings[1]!.id)).toBe(drive);
    expect(stampForName(drive.name)).toBe("2026-11-07 16:33:34");
    expect((await buildDriveFromFiles([drive, sentinel])).drive.id).toBe(result.drive.id);
  });
  it("rejects empty and unsupported selections", async () => {
    await expect(buildDriveFromFiles([recording("empty.h264", "empty.h264", 0)])).rejects.toThrow(
      "大小为 0",
    );
    await expect(buildDriveFromFiles([recording("note.txt", "note.txt")])).rejects.toThrow(
      "未找到零跑录像",
    );
  });
});

describe("asynchronous recording indexing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // iPhone over LAN HTTP has no crypto.subtle: awaiting the fallback hash
    // alone only yields microtasks and would still block rendering and input.
    vi.stubGlobal("crypto", {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("yields before indexing and reports progress without reading video content", async () => {
    const files = Array.from({ length: 120 }, (_, i) => recording(`${i}.h264`, ""));
    const reads = files.map((file) => vi.spyOn(file, "arrayBuffer"));
    const onProgress = vi.fn();
    const received = vi.fn();
    const pending = buildDriveFromFiles(files, { onProgress }).then(received);
    await Promise.resolve();
    expect(onProgress.mock.calls).toEqual([[0, 120]]);
    expect(received).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await pending;
    expect(onProgress.mock.calls).toEqual([
      [0, 120],
      [50, 120],
      [100, 120],
      [120, 120],
    ]);
    expect(received.mock.calls[0]![0].drive.recordings).toHaveLength(120);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a queued cancel between batches and allows a fresh import", async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const files = Array.from({ length: 120 }, (_, i) => recording(`${i}.h264`, ""));
    const pending = buildDriveFromFiles(files, {
      signal: controller.signal,
      onProgress: (processed) => {
        progress.push(processed);
        if (processed === 50) setTimeout(() => controller.abort(), 0);
      },
    });
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    await cancelled;
    expect(progress).toEqual([0, 50]);
    expect(vi.getTimerCount()).toBe(0);

    const replacement = buildDriveFromFiles([recording("new.h264", "")]);
    await vi.runAllTimersAsync();
    expect((await replacement).drive.recordings.map((file) => file.name)).toEqual(["new.h264"]);
  });

  it("cancels the initial yield without leaving timers or completing the library", async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    const pending = buildDriveFromFiles([recording("clip.h264", "")], {
      signal: controller.signal,
      onProgress,
    });
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await cancelled;
    expect(onProgress.mock.calls).toEqual([[0, 1]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards results when cancelled during an asynchronous hash", async () => {
    let finishHash!: (digest: ArrayBuffer) => void;
    const digest = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishHash = resolve;
        }),
    );
    vi.stubGlobal("crypto", { subtle: { digest } });
    const controller = new AbortController();
    const pending = buildDriveFromFiles([recording("clip.h264", "")], {
      signal: controller.signal,
    });
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    expect(digest).toHaveBeenCalledOnce();
    controller.abort();
    finishHash(new ArrayBuffer(32));
    await cancelled;
    expect(digest).toHaveBeenCalledOnce();
  });
});

describe("file picker lifecycle", () => {
  // Model the browser events independently of the OS picker. In particular,
  // returning focus does not mean that iOS has finished importing the directory.
  class FileInput extends EventTarget {
    files: File[] = [];
    value = "";
    style = {};
    multiple = false;
    setAttribute = vi.fn();
    click = vi.fn();
    remove = vi.fn();
  }

  let input: FileInput;
  let page: EventTarget;
  let documentEvents: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    input = new FileInput();
    page = new EventTarget();
    documentEvents = new EventTarget();
    vi.stubGlobal("window", page);
    vi.stubGlobal(
      "document",
      Object.assign(documentEvents, {
        visibilityState: "visible",
        createElement: () => input,
        body: { appendChild: vi.fn() },
      }),
    );
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
  });

  afterEach(() => {
    abortDirectoryPick();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts a complete directory after a long selection and import", async () => {
    const received = vi.fn();
    const pending = pickDirectoryFiles().then(received);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(received).not.toHaveBeenCalled();
    expect(input.remove).not.toHaveBeenCalled();

    const files = [
      recording("drive.h264", "USB/driverecord/drive.h264"),
      recording("sentinel.h264", "USB/sentinel/sentinel.h264"),
    ];
    input.files = files;
    input.dispatchEvent(new Event("change"));
    await pending;
    expect(received).toHaveBeenCalledExactlyOnceWith(files);
    await vi.runOnlyPendingTimersAsync();
    expect(input.remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["focus", "pageshow", "pointerdown", "touchstart", "visibilitychange"])(
    "%s does not discard a directory that is still being imported",
    async (eventName) => {
      const received = vi.fn();
      const onReturn = vi.fn();
      const pending = pickDirectoryFiles(undefined, { onReturn }).then(received);
      await vi.advanceTimersByTimeAsync(1_000);
      const target = eventName === "visibilitychange" ? documentEvents : page;
      target.dispatchEvent(new Event(eventName));
      target.dispatchEvent(new Event(eventName));
      expect(onReturn).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(received).not.toHaveBeenCalled();
      expect(input.remove).not.toHaveBeenCalled();

      const files = [recording("late.h264", "USB/driverecord/late.h264")];
      input.files = files;
      // Some picker implementations populate FileList without a change event.
      await vi.advanceTimersByTimeAsync(200);
      await pending;
      expect(received).toHaveBeenCalledExactlyOnceWith(files);
    },
  );

  it.each(["cancel", "change", "app cancel", "external abort"])(
    "%s settles an empty selection and releases the input",
    async (reason) => {
      const controller = new AbortController();
      const onReturn = vi.fn();
      const pending = pickDirectoryFiles(controller.signal, { onReturn });
      if (reason === "app cancel") abortDirectoryPick();
      else if (reason === "external abort") controller.abort();
      else input.dispatchEvent(new Event(reason));
      await expect(pending).resolves.toEqual([]);
      await vi.runOnlyPendingTimersAsync();
      expect(input.remove).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      page.dispatchEvent(new Event("focus"));
      expect(onReturn).not.toHaveBeenCalled();
    },
  );

  it("blocks the iPhone directory picker before opening any system UI", async () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone", platform: "iPhone" });
    await expect(pickDirectoryFiles()).rejects.toThrow("已停用文件夹导入");
    expect(input.click).not.toHaveBeenCalled();
    expect(input.setAttribute).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores late files from a cancelled picker after starting a new selection", async () => {
    const previousInput = input;
    const previous = pickRecordingFiles();
    abortDirectoryPick();
    await expect(previous).resolves.toEqual([]);

    input = new FileInput();
    const received = vi.fn();
    const pending = pickRecordingFiles().then(received);
    previousInput.files = [recording("stale.h264", "")];
    previousInput.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(received).not.toHaveBeenCalled();

    const files = [recording("fresh.h264", "")];
    input.files = files;
    input.dispatchEvent(new Event("change"));
    await pending;
    expect(received).toHaveBeenCalledExactlyOnceWith(files);
    await vi.runOnlyPendingTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens only a file picker on iPhone and rejects over-limit results", async () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone", platform: "iPhone" });
    const pending = pickRecordingFiles();
    expect(input.click).toHaveBeenCalledOnce();
    expect(input.multiple).toBe(true);
    expect(input.setAttribute).not.toHaveBeenCalledWith("webkitdirectory", "");
    expect(input.setAttribute).not.toHaveBeenCalledWith("directory", "");
    input.files = Array.from({ length: 11 }, (_, i) => recording(`${i}.h264`, ""));
    input.dispatchEvent(new Event("change"));
    await expect(pending).rejects.toThrow(
      `最多选择 ${IPHONE_RECORDING_LIMIT} 个文件，本次选择了 11 个`,
    );
    await vi.runOnlyPendingTimersAsync();
    expect(input.remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("iPhone recording limits", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { userAgent: "iPhone", platform: "iPhone" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["Safari on iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4) Safari/604.1", "", true],
    ["Chrome on iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4) CriOS/130.0", "", true],
    ["iPhone platform", "Mozilla/5.0 (Macintosh)", "iPhone", true],
    ["iPad", "Mozilla/5.0 (iPad; CPU OS 18_4)", "iPad", false],
    ["desktop-mode iPad", "Mozilla/5.0 (Macintosh)", "MacIntel", false],
    ["Android", "Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", false],
  ])("detects %s", (_label, userAgent, platform, expected) => {
    vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints: 5 });
    expect(isIPhoneBrowser()).toBe(expected);
  });

  it("accepts up to the mobile recording limit", async () => {
    const files = Array.from({ length: IPHONE_RECORDING_LIMIT }, (_, i) =>
      recording(`${i}.h264`, ""),
    );
    const result = await buildDriveFromFiles(files);
    expect(result.drive.recordings).toHaveLength(IPHONE_RECORDING_LIMIT);
    expect(result.fileMap.size).toBe(IPHONE_RECORDING_LIMIT);
  });

  it("rejects selections above the mobile limit before hashing or reading any content", async () => {
    const over = IPHONE_RECORDING_LIMIT + 1;
    const files = Array.from({ length: over }, (_, i) => recording(`${i}.h264`, ""));
    const reads = files.map((file) => vi.spyOn(file, "arrayBuffer"));
    const digest = vi.spyOn(crypto.subtle, "digest");
    await expect(buildDriveFromFiles(files)).rejects.toThrow(
      `最多选择 ${IPHONE_RECORDING_LIMIT} 个文件，本次选择了 ${over} 个`,
    );
    expect(digest).not.toHaveBeenCalled();
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it("rejects directory files even when their count is below the limit", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    await expect(
      buildDriveFromFiles([recording("clip.h264", "USB/driverecord/clip.h264")]),
    ).rejects.toThrow("已停用文件夹导入");
    expect(digest).not.toHaveBeenCalled();
  });

  it.each([["desktop", "Macintosh", "MacIntel", 0]])(
    "preserves unlimited directory indexing on %s",
    async (_label, userAgent, platform, touch) => {
      vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints: touch });
      const files = Array.from({ length: 11 }, (_, i) =>
        recording(`${i}.h264`, `USB/sentinel/${i}.h264`),
      );
      const result = await buildDriveFromFiles(files);
      expect(result.drive.recordings).toHaveLength(11);
      expect(result.drive.recordings.every((file) => file.kind === "sentinel")).toBe(true);
    },
  );
});
