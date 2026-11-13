/** Screenshots for looking at pages, not for asserting on them.
 *
 *  node src/civic-ui/checks/shots.mjs --site=dist --routes=index,compare --widths=390
 *  node src/civic-ui/checks/shots.mjs --site=preview --routes=ui-lab --widths=390,1280 --theme=dark
 *
 *  --site=dist     serves dist/ (run `npm run build` first)
 *  --site=preview  builds ui-lab.html + index.html and serves them over public/
 *  --overlay       on dist pages, adds bright-civic.css and the body class the
 *                  way line 4 would, to rehearse the site-wide layer
 *  --full          whole page instead of the first screen
 *  --clip=#id      only that element
 *  --scroll=N      scroll N px before the shot
 *  --click=sel     click a selector first (repeatable, comma separated)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, flag, launch, previewServer, serve } from "./harness.mjs";

const site = flag("site", "preview");
const routes = String(flag("routes", "ui-lab")).split(",");
const widths = String(flag("widths", "390")).split(",").map(Number);
const theme = flag("theme", "");
const out = join(ROOT, "shots", String(flag("out", site)));
const height = Number(flag("height", 844));
const scale = Number(flag("scale", 1));
mkdirSync(out, { recursive: true });

const server = site === "dist"
  ? await serve([join(ROOT, "dist"), join(ROOT, "public")])
  : await previewServer();
const browser = await launch();
try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      reducedMotion: flag("reduced") ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of routes) {
      const [name, query = ""] = route.split("?");
      await page.goto(`${server.origin}/${name}.html${query ? `?${query}` : ""}`, { waitUntil: "networkidle" });
      if (flag("overlay")) {
        await page.addStyleTag({ url: "/bright-civic.css" });
        await page.evaluate(() => document.body.classList.add("civic-bright"));
      }
      if (theme) await page.evaluate((value) => { document.documentElement.dataset.civicTheme = value; }, theme);
      for (const selector of String(flag("click", "")).split(",").filter(Boolean)) {
        await page.locator(selector).first().click();
      }
      if (flag("scroll")) await page.evaluate((y) => window.scrollTo(0, y), Number(flag("scroll")));
      await page.waitForTimeout(Number(flag("wait", 500)));
      const file = join(out, `${name}-${width}${theme ? `-${theme}` : ""}${flag("tag") ? `-${flag("tag")}` : ""}.png`);
      const clip = flag("clip");
      if (clip) await page.locator(String(clip)).first().screenshot({ path: file });
      else await page.screenshot({ path: file, fullPage: Boolean(flag("full")) });
      console.log(file, errors.length ? `errors: ${errors.join(" | ")}` : "");
      errors.length = 0;
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
