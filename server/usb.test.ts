import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { isLocalRequest, parseRange, stampForName, UsbLibrary } from "./usb";
const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
describe("只读 U 盘扫描", () => {
  it("发现真实零跑格式，忽略缩略图、普通文件夹和链接", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashcam-scan-test-"));
    cleanup.push(root);
    const drive = join(root, "USB", "driverecord");
    await mkdir(drive, { recursive: true });
    const file = join(drive, "2026-11-07_163334Z+0800_0027.h264");
    await writeFile(file, new Uint8Array([0, 0, 0, 1, 0x67]));
    await writeFile(join(drive, "thumbnail.jpeg"), "thumbnail");
    await symlink(file, join(drive, "symlink.h264"));
    const before = await stat(file),
      lib = new UsbLibrary(root, join(root, "cache"));
    const drives = await lib.scan();
    expect(drives).toHaveLength(1);
    expect(drives[0].recordings).toHaveLength(1);
    expect(drives[0].recordings[0]).toMatchObject({
      stamp: "2026-11-07 16:33:34",
      kind: "drive",
      size: 5,
    });
    expect(drives[0].recordings[0].duration).toBeUndefined();
    expect(drives[0].recordings[0].id).toMatch(/^[a-f0-9]{24}$/);
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
    await rm(file);
    await expect(lib.prepare(drives[0].recordings[0].id, true)).rejects.toThrow("U 盘已断开");
  });
  it("提取零跑时间戳且保留未知名称", () => {
    expect(stampForName("2026-11-07_163334Z+0800_0027.h264")).toBe("2026-11-07 16:33:34");
    expect(stampForName("unknown.h264")).toBe("unknown.h264");
  });
});
describe("媒体随机访问", () => {
  it("处理完整、起止和尾部范围", () => {
    expect(parseRange(undefined, 100)).toBeUndefined();
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
    expect(parseRange("bytes=90-200", 100)).toEqual({ start: 90, end: 99 });
  });
  it("拒绝无效和多段范围", () => {
    for (const range of [
      "bytes=100-",
      "bytes=20-10",
      "bytes=-0",
      "bytes=",
      "bytes=0-1,4-5",
      "bytes=999999999999999999-",
    ])
      expect(parseRange(range, 100)).toBeNull();
  });
});
describe("本地边界", () => {
  const request = (host: string, origin?: string, address = "127.0.0.1") =>
    ({ headers: { host, origin }, socket: { remoteAddress: address } }) as Pick<
      IncomingMessage,
      "headers" | "socket"
    >;
  it("允许本机同源请求", () => {
    expect(isLocalRequest(request("localhost:5174", "http://localhost:5174"))).toBe(true);
    expect(isLocalRequest(request("127.0.0.1:5174"))).toBe(true);
  });
  it("允许同一局域网私网访问", () => {
    expect(isLocalRequest(request("192.168.31.105:43123", undefined, "192.168.31.20"))).toBe(true);
    expect(
      isLocalRequest(
        request("192.168.31.105:43123", "http://192.168.31.105:43123", "192.168.31.20"),
      ),
    ).toBe(true);
  });
  it("拒绝公网、跨域和 DNS rebinding", () => {
    expect(isLocalRequest(request("evil.test:5174"))).toBe(false);
    expect(isLocalRequest(request("localhost:5174", "https://evil.test"))).toBe(false);
    expect(isLocalRequest(request("evil.test:5174", undefined, "192.168.1.2"))).toBe(false);
    expect(isLocalRequest(request("8.8.8.8:5174", undefined, "8.8.8.8"))).toBe(false);
  });
});
