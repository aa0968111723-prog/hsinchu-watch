import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deployCommand, sameSnapshot } from "./publish-gate.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const mirror = `${process.env.TEMP}\\hsinchu-pages-mirror`;

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function liveHash(path) {
  const response = await fetch(`https://hsinchu-watch.pages.dev${path}`, { headers: { "user-agent": "HsinchuNewsIntel/0.1" } });
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
copyFileSync(fileURLToPath(new URL("../../../public/data/news-intel/latest.json", import.meta.url)), `${mirror}\\data\\news-intel\\latest.json`);
copyFileSync(fileURLToPath(new URL("../../../public/news-hourly.html", import.meta.url)), `${mirror}\\news-hourly.html`);
const deployed = spawnSync(deployCommand(mirror), { cwd: root, shell: true, stdio: "inherit" });
process.exit(deployed.status ?? 1);
