import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite-plus";
import { readRecordingTiming } from "./timing";

export type Recording = {
  id: string;
  name: string;
  stamp: string;
  kind: "drive" | "sentinel";
  size: number;
  duration?: number;
};
export type Drive = { id: string; name: string; recordings: Recording[] };
type Source = { path: string; size: number; mtimeMs: number };
type Job = {
  status: "preparing" | "ready" | "error";
  error?: string;
  duration?: number;
  url?: string;
  timing?: "recorded" | "estimated";
  touched: number;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
export const stampForName = (name: string) => {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : name;
};
export function parseRange(
  value: string | undefined,
  size: number,
): { start: number; end: number } | undefined | null {
  if (!value) return undefined;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]) || size < 1) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= size ||
    (!match[1] && Number(match[2]) === 0)
  )
    return null;
  start = Math.max(0, start);
  return { start, end };
}
export function isLocalRequest(req: Pick<IncomingMessage, "headers" | "socket">): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const address = req.socket.remoteAddress;
  if (address && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) return false;
  try {
    const target = new URL(`http://${host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) return false;
    if (req.headers.origin && new URL(req.headers.origin).host !== target.host) return false;
    if (
      req.headers["sec-fetch-site"] &&
      !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"]))
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
export class UsbLibrary {
  sources = new Map<string, Source>();
  jobs = new Map<string, Job>();
  private queue: string[] = [];
  private active = false;
  private disposed = false;
  private child: ReturnType<typeof spawn> | undefined;
  private listing: Promise<Drive[]> | undefined;
  private lastDrives: Drive[] = [];
  private lastScan = 0;
  readonly volumes: string;
  readonly cache: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
  constructor(
    volumes = "/Volumes",
    cache = join(tmpdir(), "leapmotor-dashcam-v3"),
    ffmpeg = "/opt/homebrew/bin/ffmpeg",
    ffprobe = "/opt/homebrew/bin/ffprobe",
  ) {
    this.volumes = volumes;
    this.cache = cache;
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
  }
  async scan(): Promise<Drive[]> {
    if (this.listing) return this.listing;
    if (Date.now() - this.lastScan < 2000) return this.lastDrives;
    this.listing = this.scanVolumes();
    try {
      this.lastDrives = await this.listing;
      this.lastScan = Date.now();
      return this.lastDrives;
    } finally {
      this.listing = undefined;
    }
  }
  private async scanVolumes(): Promise<Drive[]> {
    const volumeRoot = await realpath(this.volumes).catch(() => this.volumes);
    const mounts = await readdir(volumeRoot, { withFileTypes: true }).catch(() => []);
    const drives: Drive[] = [];
    for (const mount of mounts) {
      if (!mount.isDirectory() || mount.name.startsWith(".")) continue;
      const root = join(volumeRoot, mount.name);
      const drive: Drive = { id: hash(root), name: mount.name, recordings: [] };
      for (const [folder, kind] of [
        ["driverecord", "drive"],
        ["sentinel", "sentinel"],
      ] as const) {
        const directory = join(root, folder);
        if ((await realpath(directory).catch(() => "")) !== directory) continue;
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isFile() || !/\.h264$/i.test(entry.name)) continue;
          const path = join(directory, entry.name);
          const info = await stat(path).catch(() => undefined);
          if (!info || !info.size) continue;
          const id = hash(`${path}:${info.size}:${info.mtimeMs}`);
          this.sources.set(id, { path, size: info.size, mtimeMs: info.mtimeMs });
          drive.recordings.push({
            id,
            name: entry.name,
            stamp: stampForName(entry.name),
            kind,
            size: info.size,
            duration: this.jobs.get(id)?.duration,
          });
        }
      }
      if (drive.recordings.length) {
        drive.recordings.sort((a, b) => b.stamp.localeCompare(a.stamp));
        drives.push(drive);
      }
    }
    return drives;
  }
  private async sourceExists(id: string): Promise<Source> {
    let source = this.sources.get(id);
    if (!source) {
      await this.scan();
      source = this.sources.get(id);
    }
    if (!source) throw Error("录像未找到，请刷新 U 盘列表。");
    const info = await stat(source.path).catch(() => undefined);
    if (
      !info ||
      info.size !== source.size ||
      info.mtimeMs !== source.mtimeMs ||
      (await realpath(source.path).catch(() => "")) !== source.path
    )
      throw Error("U 盘已断开或录像发生变化，请重新连接后刷新。");
    return source;
  }
  async prepare(id: string, start: boolean): Promise<Job> {
    await this.sourceExists(id);
    const existing = this.jobs.get(id);
    if (existing) {
      existing.touched = Date.now();
      if (existing.status !== "error" || !start) return existing;
      this.jobs.delete(id);
    }
    if (!start) return { status: "error", error: "尚未准备此片段。", touched: Date.now() };
    if (this.queue.length >= 6) throw Error("正在准备其他录像，请稍后重试。");
    const job: Job = { status: "preparing", touched: Date.now() };
    this.jobs.set(id, job);
    this.queue.push(id);
    void this.drain();
    return job;
  }
  private run(executable: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
      this.child = child;
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 180000);
      child.stdout.on("data", (chunk) => {
        stdout = (stdout + String(chunk)).slice(-16384);
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-4096);
      });
      child.on("error", () => {
        clearTimeout(timer);
        reject(Error("无法启动本地视频处理工具，请确认已安装 FFmpeg。"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        this.child = undefined;
        if (code === 0) resolve(stdout);
        else
          reject(
            Error(
              stderr.includes("No such file")
                ? "U 盘已断开，无法继续读取录像。"
                : "此录像无法解析，文件可能未完整保存；请尝试其他片段。",
            ),
          );
      });
    });
  }
  private async drain(): Promise<void> {
    if (this.active || this.disposed) return;
    this.active = true;
    while (this.queue.length && !this.disposed) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id)!;
      const target = join(this.cache, `${id}.mp4`),
        partial = join(this.cache, `${id}.partial.mp4`);
      try {
        const source = await this.sourceExists(id);
        await mkdir(this.cache, { recursive: true, mode: 0o700 });
        if (
          !(await access(target).then(
            () => true,
            () => false,
          ))
        ) {
          const recorded = await readRecordingTiming(source.path);
          let fpsNumerator = 25,
            fpsDenominator = 1;
          let timing: "recorded" | "estimated" = "estimated";
          if (recorded) {
            const packetProbe = JSON.parse(
              await this.run(this.ffprobe, [
                "-v",
                "error",
                "-count_packets",
                "-show_entries",
                "stream=nb_read_packets",
                "-of",
                "json",
                source.path,
              ]),
            );
            if (Number(packetProbe.streams?.[0]?.nb_read_packets) === recorded.frameCount) {
              fpsNumerator = recorded.fpsNumerator;
              fpsDenominator = recorded.fpsDenominator;
              timing = "recorded";
            }
          }
          // Packet count validates one camera timestamp per frame. Preserve the measured wall-clock duration without re-encoding.
          await this.run(this.ffmpeg, [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-fflags",
            "+genpts",
            "-r",
            `${fpsNumerator}/${fpsDenominator}`,
            "-i",
            source.path,
            "-map",
            "0:v:0",
            "-c:v",
            "copy",
            "-bsf:v",
            `setts=ts=N*${fpsDenominator}/(${fpsNumerator}*TB)`,
            "-metadata",
            `comment=leapmotor-timing-${timing}`,
            "-movflags",
            "+faststart",
            "-y",
            partial,
          ]);
          await this.sourceExists(id);
          await rename(partial, target);
        }
        const probe = JSON.parse(
          await this.run(this.ffprobe, [
            "-v",
            "error",
            "-show_entries",
            "format=duration:format_tags=comment",
            "-of",
            "json",
            target,
          ]),
        );
        const duration = Number(probe.format?.duration);
        if (!Number.isFinite(duration) || duration <= 0) throw Error("无法读取有效的视频时长。");
        Object.assign(job, {
          status: "ready",
          duration,
          timing:
            probe.format?.tags?.comment === "leapmotor-timing-recorded" ? "recorded" : "estimated",
          url: `/api/media/${id}`,
          touched: Date.now(),
        });
        await this.trimCache(id);
      } catch (error) {
        Object.assign(job, {
          status: "error",
          error: error instanceof Error ? error.message : "准备录像失败。",
        });
        await unlink(partial).catch(() => {});
      }
    }
    this.active = false;
  }
  private async trimCache(keep: string): Promise<void> {
    const names = await readdir(this.cache);
    const entries = await Promise.all(
      names
        .filter((n) => /^[a-f0-9]{24}\.mp4$/.test(n))
        .map(async (name) => ({ name, info: await stat(join(this.cache, name)) })),
    );
    entries.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs);
    let total = entries.reduce((sum, item) => sum + item.info.size, 0);
    for (const item of entries) {
      if (total < 3 * 1024 ** 3 && Date.now() - item.info.mtimeMs < 7 * 86400000) continue;
      const id = item.name.slice(0, 24);
      if (id === keep || Date.now() - (this.jobs.get(id)?.touched || 0) < 600000) continue;
      await unlink(join(this.cache, item.name)).catch(() => {});
      total -= item.info.size;
      this.jobs.delete(id);
    }
  }
  async media(id: string): Promise<string> {
    await this.sourceExists(id);
    const job = this.jobs.get(id);
    if (!job || job.status !== "ready") throw Error("录像尚未准备完成。");
    job.touched = Date.now();
    return join(this.cache, `${id}.mp4`);
  }
  dispose() {
    this.disposed = true;
    this.queue = [];
    this.child?.kill("SIGTERM");
  }
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
export function usbPlugin(): Plugin {
  const library = new UsbLibrary();
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/")) return next();
    if (!isLocalRequest(req)) return json(res, 403, { error: "仅允许本机同源访问 U 盘。" });
    const path = req.url.split("?")[0];
    try {
      if (path === "/api/drives" && req.method === "GET")
        return json(res, 200, { drives: await library.scan() });
      const prepare = path.match(/^\/api\/recordings\/([a-f0-9]{24})\/prepare$/);
      if (prepare && ["GET", "POST"].includes(req.method || "")) {
        const { touched: _touched, ...job } = await library.prepare(
          prepare[1],
          req.method === "POST",
        );
        return json(res, 200, job);
      }
      const media = path.match(/^\/api\/media\/([a-f0-9]{24})$/);
      if (media && ["GET", "HEAD"].includes(req.method || "")) {
        const file = await library.media(media[1]),
          info = await stat(file),
          range = parseRange(req.headers.range, info.size);
        if (range === null) {
          res.writeHead(416, { "Content-Range": `bytes */${info.size}` });
          res.end();
          return;
        }
        const headers: Record<string, string | number> = {
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Length": range ? range.end - range.start + 1 : info.size,
        };
        if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
        res.writeHead(range ? 206 : 200, headers);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        const stream = createReadStream(file, range || undefined);
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
        return;
      }
      return json(res, 404, { error: "接口不存在。" });
    } catch (error) {
      return json(res, 400, {
        status: "error",
        error: error instanceof Error ? error.message : "读取录像失败。",
      });
    }
  };
  return {
    name: "leapmotor-readonly-usb",
    configureServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.once("close", () => library.dispose());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      server.httpServer.once("close", () => library.dispose());
    },
  };
}
