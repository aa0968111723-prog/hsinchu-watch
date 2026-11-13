import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareApiReachable, cloudflareAuthHeaders, cloudflareRefreshNeeded, deployCommand, PUBLISH_TIMEOUT_MS, sameSnapshot } from "./publish-gate.js";
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
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wranglerConfig = join(homedir(), ".wrangler", "config", "default.toml");
let configText = existsSync(wranglerConfig) ? readFileSync(wranglerConfig, "utf8") : "";
if (cloudflareRefreshNeeded(configText) && existsSync(wranglerBin)) {
  spawnSync(`node "${wranglerBin}" whoami`, { cwd: root, shell: true, stdio: "ignore", timeout: 20_000 });
  configText = existsSync(wranglerConfig) ? readFileSync(wranglerConfig, "utf8") : "";
}
const authHeaders = cloudflareAuthHeaders(configText);
const api = await cloudflareApiReachable(fetch, 8000, authHeaders);
if (!api.ok) {
  console.log(JSON.stringify({ published: false, reason: "cloudflare_unavailable", status: api.status }));
  writeFileSync(fileURLToPath(new URL("../state/publish-status.json", import.meta.url)), JSON.stringify({
    published: false,
    reason: "cloudflare_unavailable",
    status: api.status,
    at: new Date().toISOString(),
  }, null, 2));
  process.exit(0);
}
mkdirSync(`${mirror}\\data\\news-intel`, { recursive: true });
copyFileSync(fileURLToPath(new URL("../../../public/data/news-intel/latest.json", import.meta.url)), `${mirror}\\data\\news-intel\\latest.json`);
const catalogFile = fileURLToPath(new URL("../../../public/data/news-intel/city-catalog.json", import.meta.url));
if (existsSync(catalogFile)) copyFileSync(catalogFile, `${mirror}\\data\\news-intel\\city-catalog.json`);
const parkingFile = fileURLToPath(new URL("../../../public/data/news-intel/parking.json", import.meta.url));
if (existsSync(parkingFile)) copyFileSync(parkingFile, `${mirror}\\data\\news-intel\\parking.json`);
const schoolFile = fileURLToPath(new URL("../../../public/data/news-intel/school-zones.json", import.meta.url));
if (existsSync(schoolFile)) copyFileSync(schoolFile, `${mirror}\\data\\news-intel\\school-zones.json`);
const kindergartenFile = fileURLToPath(new URL("../../../public/data/news-intel/kindergartens.json", import.meta.url));
if (existsSync(kindergartenFile)) copyFileSync(kindergartenFile, `${mirror}\\data\\news-intel\\kindergartens.json`);
const specialFile = fileURLToPath(new URL("../../../public/data/news-intel/special-classes.json", import.meta.url));
if (existsSync(specialFile)) copyFileSync(specialFile, `${mirror}\\data\\news-intel\\special-classes.json`);
const hydrantFile = fileURLToPath(new URL("../../../public/data/news-intel/hydrants.json", import.meta.url));
if (existsSync(hydrantFile)) copyFileSync(hydrantFile, `${mirror}\\data\\news-intel\\hydrants.json`);
const shelterFile = fileURLToPath(new URL("../../../public/data/news-intel/bus-shelters.json", import.meta.url));
if (existsSync(shelterFile)) copyFileSync(shelterFile, `${mirror}\\data\\news-intel\\bus-shelters.json`);
const toiletFile = fileURLToPath(new URL("../../../public/data/news-intel/accessible-toilets.json", import.meta.url));
if (existsSync(toiletFile)) copyFileSync(toiletFile, `${mirror}\\data\\news-intel\\accessible-toilets.json`);
const heritageFile = fileURLToPath(new URL("../../../public/data/news-intel/heritage-sites.json", import.meta.url));
if (existsSync(heritageFile)) copyFileSync(heritageFile, `${mirror}\\data\\news-intel\\heritage-sites.json`);
const chargerFile = fileURLToPath(new URL("../../../public/data/news-intel/chargers.json", import.meta.url));
if (existsSync(chargerFile)) copyFileSync(chargerFile, `${mirror}\\data\\news-intel\\chargers.json`);
const gasFile = fileURLToPath(new URL("../../../public/data/news-intel/gas-stations.json", import.meta.url));
if (existsSync(gasFile)) copyFileSync(gasFile, `${mirror}\\data\\news-intel\\gas-stations.json`);
const farmFile = fileURLToPath(new URL("../../../public/data/news-intel/organic-farms.json", import.meta.url));
if (existsSync(farmFile)) copyFileSync(farmFile, `${mirror}\\data\\news-intel\\organic-farms.json`);
const rescueFile = fileURLToPath(new URL("../../../public/data/news-intel/rescue-stats.json", import.meta.url));
if (existsSync(rescueFile)) copyFileSync(rescueFile, `${mirror}\\data\\news-intel\\rescue-stats.json`);
const bridgeFile = fileURLToPath(new URL("../../../public/data/news-intel/bridges.json", import.meta.url));
if (existsSync(bridgeFile)) copyFileSync(bridgeFile, `${mirror}\\data\\news-intel\\bridges.json`);
copyFileSync(fileURLToPath(new URL("../../../public/news-hourly.html", import.meta.url)), `${mirror}\\news-hourly.html`);
const deployed = spawnSync(deployCommand(mirror, existsSync(wranglerBin) ? wranglerBin : ""), { cwd: root, shell: true, stdio: "inherit", timeout: PUBLISH_TIMEOUT_MS });
const status = deployed.status ?? 1;
writeFileSync(fileURLToPath(new URL("../state/publish-status.json", import.meta.url)), JSON.stringify({
  published: status === 0,
  status,
  timed_out: deployed.error?.code === "ETIMEDOUT",
  at: new Date().toISOString(),
}, null, 2));
process.exit(status);
