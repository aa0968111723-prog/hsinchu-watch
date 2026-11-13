/** Shared harness for the civic-ui checks: an isolated static server on an
 *  ephemeral port (so the four lanes never fight over 4173/5173) and a
 *  production build of the preview pages that leaves public/ where it is.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const PREVIEW_DIR = join(ROOT, "artifacts", "civic-ui-preview");
export const WIDTHS = [320, 390, 430, 768, 1280];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function locate(roots, pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^([\\/])+/, "");
  for (const root of roots) {
    const base = resolve(root);
    let file = resolve(base, clean);
    if (file !== base && !file.startsWith(base + sep)) continue;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

/** Serve the first root that has the file. `block` is a list of path prefixes
 *  answered with 503, used to rehearse a failed input file. */
export function serve(roots, { block = [] } = {}) {
  const blocked = new Set(block);
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://local");
    if ([...blocked].some((prefix) => url.pathname.startsWith(prefix))) {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("blocked for the coverage-gap rehearsal");
      return;
    }
    const file = locate(roots, url.pathname === "/" ? "/index.html" : url.pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      done({
        origin: `http://127.0.0.1:${server.address().port}`,
        blocked,
        close: () => new Promise((closed) => { server.closeAllConnections?.(); server.close(() => closed()); }),
      });
    });
  });
}

/** Build ui-lab.html and index.html the way the release does, minus the copy of
 *  public/ (the server falls back to it). */
export async function buildPreview({ quiet = true } = {}) {
  const { build } = await import("vite");
  await build({
    root: ROOT,
    configFile: false,
    publicDir: false,
    logLevel: quiet ? "error" : "info",
    build: {
      outDir: PREVIEW_DIR,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          lab: join(ROOT, "ui-lab.html"),
          main: join(ROOT, "index.html"),
        },
      },
    },
  });
  return PREVIEW_DIR;
}

export async function previewServer(options) {
  const dir = await buildPreview();
  return serve([dir, join(ROOT, "public")], options);
}

export async function launch() {
  const { chromium } = await import("playwright");
  return chromium.launch();
}

export function flag(name, fallback = null) {
  const hit = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
}
