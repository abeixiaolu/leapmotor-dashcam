import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite-plus";
import { stampForName } from "../src/localFolder";

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
};

export function createLocalDriveHandler(root = "/Volumes") {
  let files = new Map<string, { path: string; root: string; size: number; modified: number }>();
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (!url.pathname.startsWith("/api/local-drives")) return next();
    const host = req.headers.host || "";
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
    const peer = req.socket.remoteAddress;
    if (
      !local ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer || "") ||
      (req.headers.origin &&
        req.headers.origin !== `http://${host}` &&
        req.headers.origin !== `https://${host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    try {
      if (url.pathname === "/api/local-drives") {
        const indexed: typeof files = new Map();
        const drives = [];
        const volumes = await readdir(root, { withFileTypes: true }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        );
        for (const volume of volumes) {
          if (!volume.isDirectory() || volume.name.startsWith(".")) continue;
          const volumeRoot = await realpath(join(root, volume.name));
          const recordings: {
            id: string;
            name: string;
            stamp: string;
            kind: "drive" | "sentinel";
            size: number;
          }[] = [];
          const walk = async (dir: string, kind: "drive" | "sentinel", depth = 0) => {
            if (depth > 8) return;
            const entries = await readdir(dir, { withFileTypes: true }).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return [];
                throw error;
              },
            );
            for (const entry of entries) {
              if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
              const path = join(dir, entry.name);
              if (entry.isDirectory()) await walk(path, kind, depth + 1);
              else if (entry.isFile() && /\.h264$/i.test(entry.name)) {
                const info = await stat(path);
                if (!info.size) continue;
                const id = digest(`${path}:${info.size}:${info.mtimeMs}`);
                indexed.set(id, {
                  path,
                  root: volumeRoot,
                  size: info.size,
                  modified: info.mtimeMs,
                });
                recordings.push({
                  id,
                  name: entry.name,
                  stamp: stampForName(entry.name),
                  kind,
                  size: info.size,
                });
              }
            }
          };
          // Only inspect the recorder's directories; never traverse unrelated USB content.
          for (const [folder, kind] of [
            ["driverecord", "drive"],
            ["sentinel", "sentinel"],
          ] as const) {
            const path = join(volumeRoot, folder);
            const resolved = await realpath(path).catch(() => "");
            if (resolved && inside(volumeRoot, resolved)) await walk(resolved, kind);
          }
          if (recordings.length) {
            recordings.sort((a, b) => b.stamp.localeCompare(a.stamp));
            drives.push({ id: digest(volumeRoot), name: volume.name, recordings });
          }
        }
        files = indexed;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ drives }));
        return;
      }
      const id = url.pathname.slice("/api/local-drives/".length);
      const file = files.get(id);
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      const resolved = await realpath(file.path);
      const info = await stat(resolved);
      if (
        !inside(file.root, resolved) ||
        info.size !== file.size ||
        info.mtimeMs !== file.modified
      ) {
        res.writeHead(409).end();
        return;
      }
      if (info.size > 512 * 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", info.size);
      const stream = createReadStream(resolved);
      res.on("close", () => stream.destroy());
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(503).end("无法读取 U 盘，请检查连接及磁盘访问权限。");
      else res.destroy();
    }
  };
}

export function localDrivesPlugin(): Plugin {
  return {
    name: "local-drives",
    configureServer(server) {
      server.middlewares.use(createLocalDriveHandler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createLocalDriveHandler());
    },
  };
}
