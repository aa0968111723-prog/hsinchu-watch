/**
 * Writes one figure as files a strict Content-Security-Policy accepts:
 * no inline script, nothing in an iframe. The production site sends
 * `script-src 'self'` and `frame-ancestors 'none'` for every path.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIGURES_OUT, KIT_LICENSE, k } from "./kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const THEME = readFileSync(join(HERE, "figures.css"), "utf8");
/** Browser modules every figure shares. They sit beside the figure folders in src/ and in public/. */
export const SHARED_MODULES = ["motion.js", "runtime.js", "boot.js"];
const NOTICE = `/*
 * Drawing styles from the anatomy kit (iso-kit), MIT License.
 * ${KIT_LICENSE.split("\n").find((line) => line.startsWith("Copyright")) ?? ""}
 * The full licence text is in /art-library/figures/NOTICE.txt.
 */`;

export function figuresCss() {
  return `${NOTICE}\n${k.ISO_CSS.trim()}\n\n${THEME}`;
}

export function emitShared() {
  mkdirSync(FIGURES_OUT, { recursive: true });
  writeFileSync(join(FIGURES_OUT, "figures.css"), figuresCss());
  for (const name of SHARED_MODULES) copyFileSync(join(HERE, "..", name), join(FIGURES_OUT, name));
  writeFileSync(
    join(FIGURES_OUT, "NOTICE.txt"),
    [
      "The figures in this folder are original drawings made for this site.",
      "Their SVG geometry was generated with the anatomy kit, and figures.css",
      "includes the kit's drawing styles. The kit is used under this licence:",
      "",
      KIT_LICENSE,
      "",
    ].join("\n"),
  );
}

/**
 * @param {object} figure
 * @param {string} figure.id            folder name and data-figure value
 * @param {string} figure.source        folder that holds live.js and model.js
 * @param {string[]} [figure.modules]   extra browser modules to copy
 */
export function emitFigure(figure) {
  const out = join(FIGURES_OUT, figure.id);
  mkdirSync(out, { recursive: true });
  const stage = figure.stage;
  const stageAttrs = [
    'class="iso-stage"',
    'tabindex="0"',
    `role="${stage.role ?? "slider"}"`,
    `aria-label="${escape(stage.label)}"`,
    stage.max === undefined ? "" : `aria-valuemin="0" aria-valuemax="${stage.max}" aria-valuenow="${stage.now}"`,
    `aria-valuetext="${escape(stage.text)}"`,
  ]
    .filter(Boolean)
    .join(" ");
  const plate = k.plateHtml({
    fig: figure.fig,
    title: figure.title,
    hint: figure.hint,
    readout: figure.readout,
    keys: figure.keys,
    caption: figure.caption,
    body: `<div ${stageAttrs}>${figure.svg}</div>`,
  });
  const controls = figure.controls ? `<div class="fig-controls">${figure.controls}</div>` : "";
  const fragment = plate
    .replace('<figure class="iso-figure">', `<figure class="iso-figure iso civic" data-theme="light" data-figure-id="${figure.id}">`)
    .replace('<figcaption class="iso-legend">', `${controls}<figcaption class="iso-legend">`);
  if (!fragment.includes("data-figure-id") || (controls && !fragment.includes("fig-controls"))) {
    throw new Error(`${figure.id}: plate markup changed, the fragment could not be assembled`);
  }
  writeFileSync(join(out, "fragment.html"), fragment);

  const preview = figure.preview
    .replace('class="iso-svg iso"', 'class="iso-svg iso civic"')
    .replace("</style>", `${THEME}</style>`);
  if (!preview.includes("iso civic")) throw new Error(`${figure.id}: preview svg could not be themed`);
  writeFileSync(join(out, "preview.svg"), preview);

  writeFileSync(join(out, "data.js"), `export default ${JSON.stringify(figure.data)};\n`);
  for (const name of ["live.js", "model.js", ...(figure.modules ?? [])]) {
    copyFileSync(join(figure.source, name), join(out, name));
  }

  const page = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escape(figure.title)}｜美術庫元件</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../figures.css">
</head>
<body class="fig-page">
<main class="fig-main">
<p class="fig-back"><a href="/asset-lab.html">回美術庫</a></p>
<div data-figure="${figure.id}" data-base="./">${fragment}</div>
<p class="fig-note">${escape(figure.note)}</p>
</main>
<script type="module" src="../boot.js"></script>
</body>
</html>
`;
  writeFileSync(join(out, "index.html"), page);
  return { id: figure.id, out, width: figure.width, height: figure.height };
}
