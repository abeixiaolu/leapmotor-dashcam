import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { abortDirectoryPick, pickDirectoryFiles } from "./localFolder";

type FileEntry = { kind: "file"; name: string; getFile: () => Promise<File> };
type DirectoryEntry = { kind: "directory"; name: string; values: () => AsyncIterable<Entry> };
type Entry = FileEntry | DirectoryEntry;

function directory(name: string, entries: Entry[]): DirectoryEntry {
  return {
    kind: "directory",
    name,
    values: async function* () {
      yield* entries;
    },
  };
}
function file(name: string): FileEntry {
  return { kind: "file", name, getFile: async () => new File(["synthetic"], name) };
}

class FileInput extends EventTarget {
  files: File[] = [];
  value = "";
  style = {};
  setAttribute = vi.fn();
  click = vi.fn();
  remove = vi.fn();
}

const picker = vi.fn<() => Promise<DirectoryEntry>>();
let input: FileInput;
let createElement: ReturnType<typeof vi.fn>;
let browser: EventTarget & { showDirectoryPicker?: typeof picker };

beforeEach(() => {
  picker.mockReset();
  picker.mockResolvedValue(directory("NO NAME", []));
  input = new FileInput();
  createElement = vi.fn(() => input);
  browser = Object.assign(new EventTarget(), { showDirectoryPicker: picker });
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh Chrome",
    platform: "MacIntel",
    maxTouchPoints: 0,
  });
  vi.stubGlobal("window", browser);
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      visibilityState: "visible",
      createElement,
      body: { appendChild: vi.fn() },
    }),
  );
});
afterEach(() => {
  abortDirectoryPick();
  vi.unstubAllGlobals();
});

describe("one directory grant, recursive local recording scan", () => {
  it("finds both recording trees beneath a USB root without opening a second picker", async () => {
    const drive = file("2026-11-08_120000.h264");
    const sentinel = file("2026-11-08_130000.H264");
    const ignored = file("thumbnail.jpg");
    const system = directory(".Spotlight-V100", []);
    const trash = directory(".Trashes", []);
    const music = directory("Music", []);
    const systemRead = vi.spyOn(system, "values").mockImplementation(() => {
      throw new Error("protected system directory");
    });
    const trashRead = vi.spyOn(trash, "values").mockImplementation(() => {
      throw new Error("protected trash directory");
    });
    const musicRead = vi.spyOn(music, "values").mockImplementation(() => {
      throw new Error("unrelated directory");
    });
    const ignoredRead = vi.spyOn(ignored, "getFile");
    picker.mockResolvedValue(
      directory("NO NAME", [
        directory("driverecord", [directory("2026-11-08", [drive, ignored])]),
        directory("sentinel", [sentinel]),
        system,
        trash,
        music,
      ]),
    );
    const files = await pickDirectoryFiles();
    expect(files.map((f) => f.webkitRelativePath)).toEqual([
      "NO NAME/driverecord/2026-11-08/2026-11-08_120000.h264",
      "NO NAME/sentinel/2026-11-08_130000.H264",
    ]);
    expect(systemRead).not.toHaveBeenCalled();
    expect(trashRead).not.toHaveBeenCalled();
    expect(musicRead).not.toHaveBeenCalled();
    expect(ignoredRead).not.toHaveBeenCalled();
    expect(picker).toHaveBeenCalledOnce();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("also accepts a recording directory itself and recursively scans date subfolders", async () => {
    picker.mockResolvedValue(directory("driverecord", [directory("date", [file("clip.h264")])]));
    expect((await pickDirectoryFiles()).map((f) => f.webkitRelativePath)).toEqual([
      "driverecord/date/clip.h264",
    ]);
    expect(picker).toHaveBeenCalledOnce();
  });

  it("returns a user cancellation without opening the fallback", async () => {
    picker.mockRejectedValue(new DOMException("cancelled", "AbortError"));
    await expect(pickDirectoryFiles()).resolves.toEqual([]);
    expect(picker).toHaveBeenCalledOnce();
    expect(createElement).not.toHaveBeenCalled();
  });

  it.each(["NotReadableError", "SecurityError", "NotFoundError", "NotAllowedError"])(
    "%s never automatically opens another picker",
    async (name) => {
      const error = new DOMException("directory access failed", name);
      picker.mockRejectedValue(error);
      await expect(pickDirectoryFiles()).rejects.toBe(error);
      expect(picker).toHaveBeenCalledOnce();
      expect(createElement).not.toHaveBeenCalled();
    },
  );

  it("reports a recording read error after the grant without opening fallback UI", async () => {
    const recording = file("clip.h264");
    const error = new DOMException("USB disconnected", "NotReadableError");
    vi.spyOn(recording, "getFile").mockRejectedValue(error);
    picker.mockResolvedValue(directory("NO NAME", [directory("driverecord", [recording])]));
    await expect(pickDirectoryFiles()).rejects.toBe(error);
    expect(picker).toHaveBeenCalledOnce();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("reports a required recording-directory enumeration failure, rather than retrying selection", async () => {
    const recordings = directory("driverecord", []);
    const error = new DOMException("USB disconnected", "NotFoundError");
    vi.spyOn(recordings, "values").mockImplementation(() => {
      throw error;
    });
    picker.mockResolvedValue(directory("NO NAME", [recordings]));
    await expect(pickDirectoryFiles()).rejects.toBe(error);
    expect(picker).toHaveBeenCalledOnce();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("does not scan or reopen after cancellation while the native picker is pending", async () => {
    const controller = new AbortController();
    const root = directory("NO NAME", [file("clip.h264")]);
    const read = vi.spyOn(root, "values");
    let grant: (value: DirectoryEntry) => void = () => {
      throw new Error("not waiting");
    };
    picker.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const pending = pickDirectoryFiles(controller.signal);
    controller.abort();
    grant(root);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
    expect(picker).toHaveBeenCalledOnce();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("checks cancellation between file reads without opening another picker", async () => {
    const controller = new AbortController();
    const first = file("one.h264");
    const second = file("two.h264");
    vi.spyOn(first, "getFile").mockImplementation(async () => {
      controller.abort();
      return new File(["synthetic"], first.name);
    });
    const secondRead = vi.spyOn(second, "getFile");
    picker.mockResolvedValue(directory("NO NAME", [first, second]));
    await expect(pickDirectoryFiles(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(secondRead).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("does not open any UI for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(pickDirectoryFiles(controller.signal)).resolves.toEqual([]);
    expect(picker).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("uses exactly one input picker when the directory handle API is unavailable", async () => {
    delete browser.showDirectoryPicker;
    const pending = pickDirectoryFiles();
    expect(input.click).toHaveBeenCalledOnce();
    expect(picker).not.toHaveBeenCalled();
    input.files = [new File(["synthetic"], "clip.h264")];
    input.dispatchEvent(new Event("change"));
    await expect(pending).resolves.toEqual(input.files);
    expect(createElement).toHaveBeenCalledOnce();
    expect(input.click).toHaveBeenCalledOnce();
  });
});
