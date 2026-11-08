import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, get } from "node:http";
import { createLocalDriveHandler } from "./localDrives";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dashcam-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "USB", "driverecord");
  await mkdir(folder, { recursive: true });
  const handler = createLocalDriveHandler(root);
  const server = createServer((req, res) => {
    void handler(req, res, () => res.writeHead(404).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const url = `http://127.0.0.1:${address.port}/api/local-drives`;
  return { root, folder, url };
}
it("discovers inserted drives, serves selected recordings, and removes disconnected drives", async () => {
  const { folder, root, url } = await fixture();
  expect((await (await fetch(url)).json()).drives).toEqual([]);
  await writeFile(join(folder, "2026-11-08_120000.h264"), "video");
  const { drives } = await (await fetch(url)).json();
  expect(drives[0].name).toBe("USB");
  expect(drives[0].recordings[0].stamp).toBe("2026-11-08 12:00:00");
  const clipUrl = `${url}/${drives[0].recordings[0].id}`;
  expect(await (await fetch(clipUrl)).text()).toBe("video");
  expect((await (await fetch(url)).json()).drives).toEqual(drives);
  await rm(join(root, "USB"), { recursive: true });
  expect((await (await fetch(url)).json()).drives).toEqual([]);
  expect((await fetch(clipUrl)).status).toBe(404);
});
it("rejects foreign origins, hostnames, writes, arbitrary paths and symlink escapes", async () => {
  const { folder, root, url } = await fixture();
  await writeFile(join(root, "private.h264"), "secret");
  await symlink(join(root, "private.h264"), join(folder, "escape.h264"));
  expect((await (await fetch(url)).json()).drives).toEqual([]);
  expect((await fetch(url, { headers: { Origin: "https://example.com" } })).status).toBe(403);
  const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(url, { headers: { Host: "example.com" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  expect(foreignHostStatus).toBe(403);
  expect((await fetch(url, { method: "POST" })).status).toBe(405);
  expect((await fetch(`${url}/unknown`)).status).toBe(404);
});
it("refuses a recording changed after scanning", async () => {
  const { folder, url } = await fixture();
  const path = join(folder, "clip.h264");
  await writeFile(path, "video");
  const { drives } = await (await fetch(url)).json();
  await writeFile(path, "replacement");
  expect((await fetch(`${url}/${drives[0].recordings[0].id}`)).status).toBe(409);
});
