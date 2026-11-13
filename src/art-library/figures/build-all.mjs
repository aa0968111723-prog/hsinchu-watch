/**
 * Builds every civic figure into public/art-library/figures/.
 *   node src/art-library/figures/build-all.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitShared } from "./lib/emit.mjs";
import { KIT_DIR } from "./lib/kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const listed = JSON.parse(readFileSync(join(HERE, "figures.json"), "utf8")).figures;

emitShared();
for (const entry of listed) {
  const built = (await import(`./${entry.folder}/build.mjs`)).default;
  if (built.id !== entry.folder) throw new Error(`${entry.folder} built as ${built.id}`);
  console.log(`built ${built.id} ${built.width}x${built.height}`);
}
console.log(`kit: ${KIT_DIR}`);
