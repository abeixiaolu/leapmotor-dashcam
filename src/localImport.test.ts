import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { appendLocalDrive, buildDriveFromFiles } from "./localFolder";

function clip(name: string, path = "", bytes = [1, 2, 3, 4], lastModified = 1234) {
  const file = new File([new Uint8Array(bytes)], name, { lastModified });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

const firstName = "2026-11-07_120000_0001.h264";
const secondName = "2026-11-08_120000_0002.h264";

beforeEach(() => {
  vi.stubGlobal("navigator", { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe("append-only manual imports", () => {
  it("deduplicates a single batch and retains the first File", async () => {
    const file = clip(firstName);
    const result = await buildDriveFromFiles([file, file, clip(firstName)]);
    expect(result.drive.recordings).toHaveLength(1);
    expect(result.fileMap.size).toBe(1);
    expect([...result.fileMap.values()]).toEqual([file]);
  });

  it("repeated imports keep recording IDs, collection ID and old File references", async () => {
    const original = clip(firstName);
    const first = await buildDriveFromFiles([original]);
    const again = await buildDriveFromFiles([clip(firstName)], { existingFiles: first.fileMap });
    const previous = [first.drive];
    const merged = appendLocalDrive(previous, again.drive, first.fileMap);
    expect(merged).toBe(previous);
    expect(again.drive.recordings[0]?.id).toBe(first.drive.recordings[0]?.id);
    expect([...again.fileMap.values()]).toEqual([original]);
  });

  it("appends partially overlapping selections, newest first, without replacing old records", async () => {
    const first = await buildDriveFromFiles([clip(firstName)]);
    const thirdName = "2026-11-09_120000_0003.h264";
    const next = await buildDriveFromFiles([clip(firstName), clip(secondName), clip(thirdName)], {
      existingFiles: first.fileMap,
    });
    const files = new Map([...first.fileMap, ...next.fileMap]);
    const merged = appendLocalDrive([first.drive], next.drive, files);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(first.drive.id);
    expect(merged[0]?.recordings.map((r) => r.name)).toEqual([thirdName, secondName, firstName]);
    expect(merged[0]?.recordings[2]).toBe(first.drive.recordings[0]);
    expect(files.get(first.drive.recordings[0]!.id)).toBe([...first.fileMap.values()][0]);
  });

  it("recognizes the same file across directory and bare-file pickers in both directions", async () => {
    for (const [beforePath, afterPath] of [
      [`USB/driverecord/${firstName}`, ""],
      ["", `USB/driverecord/${firstName}`],
    ]) {
      const original = clip(firstName, beforePath);
      const first = await buildDriveFromFiles([original]);
      const next = await buildDriveFromFiles([clip(firstName, afterPath)], {
        existingFiles: first.fileMap,
      });
      expect(next.drive.recordings[0]?.id).toBe(first.drive.recordings[0]?.id);
      expect([...next.fileMap.values()]).toEqual([original]);
    }
  });

  it("preserves known distinct directories even with identical file metadata", async () => {
    const original = clip(firstName, `USB/driverecord/a/${firstName}`);
    const first = await buildDriveFromFiles([original]);
    const next = await buildDriveFromFiles([clip(firstName, `USB/driverecord/b/${firstName}`)], {
      existingFiles: first.fileMap,
    });
    expect(next.drive.recordings[0]?.id).not.toBe(first.drive.recordings[0]?.id);
    expect(appendLocalDrive([first.drive], next.drive, first.fileMap)[0]?.recordings).toHaveLength(
      2,
    );
  });

  it("does not merge distinct pathless files with identical metadata but different sampled content", async () => {
    const first = await buildDriveFromFiles([clip(firstName)]);
    const different = clip(firstName, "", [4, 3, 2, 1]);
    const next = await buildDriveFromFiles([different], { existingFiles: first.fileMap });
    expect(next.drive.recordings[0]?.id).not.toBe(first.drive.recordings[0]?.id);
    const files = new Map([...first.fileMap, ...next.fileMap]);
    const repeated = await buildDriveFromFiles([clip(firstName, "", [4, 3, 2, 1])], {
      existingFiles: files,
    });
    expect([...repeated.fileMap.values()]).toEqual([different]);
    expect(repeated.drive.recordings[0]?.id).toBe(next.drive.recordings[0]?.id);
  });

  it("uses size and modification time, not only the basename", async () => {
    const first = await buildDriveFromFiles([clip(firstName)]);
    const next = await buildDriveFromFiles(
      [clip(firstName, "", [1, 2, 3, 4], 5678), clip(firstName, "", [1, 2, 3])],
      { existingFiles: first.fileMap },
    );
    expect(appendLocalDrive([first.drive], next.drive, first.fileMap)[0]?.recordings).toHaveLength(
      3,
    );
  });

  it("does not collapse separate recordings that have the same displayed timestamp", async () => {
    const first = await buildDriveFromFiles([clip(firstName)]);
    const next = await buildDriveFromFiles([clip("2026-11-07_120000_0002.h264")]);
    expect(appendLocalDrive([first.drive], next.drive, first.fileMap)[0]?.recordings).toHaveLength(
      2,
    );
  });

  it("retains auto-scanned drives while appending to the existing manual collection", async () => {
    const first = await buildDriveFromFiles([clip(firstName)]);
    const auto = {
      id: "auto-drive",
      name: "USB",
      recordings: [
        {
          id: "auto-recording",
          name: firstName,
          stamp: "2026-11-07 12:00:00",
          kind: "drive" as const,
          size: 4,
        },
      ],
    };
    const next = await buildDriveFromFiles([clip(secondName)]);
    const merged = appendLocalDrive([auto, first.drive], next.drive, first.fileMap);
    expect(merged[0]).toBe(auto);
    expect(merged[1]?.id).toBe(first.drive.id);
    expect(merged[1]?.recordings).toHaveLength(2);
  });

  it("keeps the old library when import is cancelled between batches", async () => {
    const first = await buildDriveFromFiles([clip(firstName)]);
    const snapshot = first.drive.recordings.slice();
    const files = [...first.fileMap];
    const controller = new AbortController();
    await expect(
      buildDriveFromFiles(
        Array.from({ length: 100 }, (_, i) => clip(`${i}.h264`)),
        {
          existingFiles: first.fileMap,
          signal: controller.signal,
          onProgress: (processed) => {
            if (processed === 50) controller.abort();
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(first.drive.recordings).toEqual(snapshot);
    expect([...first.fileMap]).toEqual(files);
  });

  it("keeps the old library after empty, unsupported or zero-length imports", async () => {
    const first = await buildDriveFromFiles([clip(firstName)]);
    const original = [...first.fileMap.values()][0];
    for (const selection of [[], [clip("note.txt")], [clip(firstName, "", [])]]) {
      await expect(
        buildDriveFromFiles(selection, { existingFiles: first.fileMap }),
      ).rejects.toThrow();
      expect(first.drive.recordings).toHaveLength(1);
      expect([...first.fileMap.values()]).toEqual([original]);
    }
  });

  it("reads at most 64 KiB when resolving an ambiguous large-file match", async () => {
    const bytes = new Uint8Array(1024 * 1024);
    const original = new File([bytes], firstName, { lastModified: 1234 });
    Object.defineProperty(original, "webkitRelativePath", { value: `USB/${firstName}` });
    const first = await buildDriveFromFiles([original]);
    const same = new File([bytes], firstName, { lastModified: 1234 });
    const originalReads = vi.spyOn(original, "arrayBuffer");
    const nextReads = vi.spyOn(same, "arrayBuffer");
    const slices = vi.spyOn(same, "slice");
    const next = await buildDriveFromFiles([same], { existingFiles: first.fileMap });
    expect(next.drive.recordings[0]?.id).toBe(first.drive.recordings[0]?.id);
    expect(originalReads).not.toHaveBeenCalled();
    expect(nextReads).not.toHaveBeenCalled();
    expect(slices.mock.calls).toEqual([[0, 32768], [bytes.length - 32768]]);
  });
});
