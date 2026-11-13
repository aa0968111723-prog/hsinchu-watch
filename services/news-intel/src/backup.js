import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { chooseBackups } from "./pipeline.js";

export function backupPreviousNews(publicPath, backupDir) {
  try {
    if (!existsSync(publicPath)) return { backed_up: false };
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(publicPath, join(backupDir, `latest-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
    for (const name of chooseBackups(readdirSync(backupDir)).remove) unlinkSync(join(backupDir, name));
    return { backed_up: true };
  } catch (error) {
    return { backed_up: false, error: String(error.message || error).slice(0, 180) };
  }
}
