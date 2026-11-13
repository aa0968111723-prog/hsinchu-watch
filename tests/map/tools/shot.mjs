#!/usr/bin/env node
// 截圖小工具：node tests/map/tools/shot.mjs <檔案或網址> <輸出.png> [寬] [高] [選項…]
//   --full               整頁
//   --2x                 2 倍像素密度
//   --wait=<毫秒>        載入後等待
//   --selector=<css>     只截這個元素
//   --click=<css>        截圖前依序點擊（可重複）
//   --press=<鍵>         截圖前按鍵（可重複，作用在目前聚焦的元素）
//   --touch              以觸控裝置模擬
//   --reduced-motion     prefers-reduced-motion: reduce
// 檔案路徑會轉成 file:// 網址；用來檢查靜態 SVG 與頁面外觀。
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [target, out, width = '960', height = '640', ...flags] = process.argv.slice(2);
if (!target || !out) {
  console.error('用法：node tests/map/tools/shot.mjs <檔案或網址> <輸出.png> [寬] [高] [--full] [--selector=css] [--click=css] …');
  process.exit(2);
}
const value = (name) => flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
const url = /^https?:/.test(target) ? target : pathToFileURL(resolve(target)).href;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: Number(width), height: Number(height) },
    deviceScaleFactor: flags.includes('--2x') ? 2 : 1,
    hasTouch: flags.includes('--touch'),
    isMobile: flags.includes('--touch'),
    reducedMotion: flags.includes('--reduced-motion') ? 'reduce' : 'no-preference',
    locale: 'zh-TW',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(Number(value('wait') ?? 300));
  for (const flag of flags) {
    if (flag.startsWith('--click=')) { await page.locator(flag.slice(8)).first().click(); await page.waitForTimeout(500); }
    if (flag.startsWith('--press=')) { await page.keyboard.press(flag.slice(8)); await page.waitForTimeout(300); }
  }
  const selector = value('selector');
  if (selector) await page.locator(selector).first().screenshot({ path: out });
  else await page.screenshot({ path: out, fullPage: flags.includes('--full') });
  console.log(`${out}${errors.length ? `  console errors: ${errors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
