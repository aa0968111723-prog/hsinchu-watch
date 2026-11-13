import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareApiReachable, cloudflareAuthHeaders, deployCommand, PUBLISH_TIMEOUT_MS, sameSnapshot } from "./publish-gate.js";
import { FETCH_TIMEOUT_MS } from "./run.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const mirror = `${process.env.TEMP}\\hsinchu-pages-mirror`;

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function liveHash(path) {
  const response = await fetch(`https://hsinchu-watch.pages.dev${path}`, { headers: { "user-agent": "HsinchuNewsIntel/0.1" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) return "";
  return sha(Buffer.from(await response.arrayBuffer()));
}

const mirrorIndex = `${mirror}\\index.html`;
const mirrorCivic = `${mirror}\\data\\civic\\feed.json`;
if (!existsSync(mirrorIndex) || !existsSync(mirrorCivic)) {
  console.log(JSON.stringify({ published: false, reason: "mirror_missing" }));
  process.exit(0);
}
const live = { index: await liveHash("/"), civic: await liveHash("/data/civic/feed.json") };
const local = { index: sha(readFileSync(mirrorIndex)), civic: sha(readFileSync(mirrorCivic)) };
if (!sameSnapshot(live, local)) {
  console.log(JSON.stringify({ published: false, reason: "production_snapshot_changed" }));
  process.exit(0);
}
const wranglerConfig = join(homedir(), ".wrangler", "config", "default.toml");
const authHeaders = cloudflareAuthHeaders(existsSync(wranglerConfig) ? readFileSync(wranglerConfig, "utf8") : "");
const api = await cloudflareApiReachable(fetch, 8000, authHeaders);
if (!api.ok) {
  console.log(JSON.stringify({ published: false, reason: "cloudflare_unavailable", status: api.status }));
  writeFileSync(fileURLToPath(new URL("../state/publish-status.json", import.meta.url)), JSON.stringify({
    published: false,
    reason: "cloudflare_unavailable",
    status: api.status,
    at: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
}
copyFileSync(fileURLToPath(new URL("../../../public/data/news-intel/latest.json", import.meta.url)), `${mirror}\\data\\news-intel\\latest.json`);
copyFileSync(fileURLToPath(new URL("../../../public/news-hourly.html", import.meta.url)), `${mirror}\\news-hourly.html`);
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const deployed = spawnSync(deployCommand(mirror, existsSync(wranglerBin) ? wranglerBin : ""), { cwd: root, shell: true, stdio: "inherit", timeout: PUBLISH_TIMEOUT_MS });
const status = deployed.status ?? 1;
writeFileSync(fileURLToPath(new URL("../state/publish-status.json", import.meta.url)), JSON.stringify({
  published: status === 0,
  status,
  timed_out: deployed.error?.code === "ETIMEDOUT",
  at: new Date().toISOString(),
}, null, 2));
process.exit(status);
