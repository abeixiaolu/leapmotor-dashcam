import { describe, expect, it } from "vite-plus/test";
import { buildDriveFromFiles, stampForName } from "./localFolder";

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
