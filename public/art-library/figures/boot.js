/**
 * Starts every figure on the page.
 *
 *   <link rel="stylesheet" href="/art-library/figures/figures.css">
 *   <div data-figure="evidence-desk"></div>
 *   <script type="module" src="/art-library/figures/boot.js"></script>
 *
 * If the fragment or its module cannot load, the host keeps or receives the
 * still drawing, so the page never shows an empty box.
 */
const HOME = new URL("./", import.meta.url);

export async function startFigure(host, options = {}) {
  const id = host.dataset.figure;
  const base = new URL(host.dataset.base || `${id}/`, host.dataset.base ? location.href : HOME);
  try {
    if (!host.querySelector(".iso-figure")) {
      const response = await fetch(new URL("fragment.html", base));
      if (!response.ok) throw new Error(`fragment ${response.status}`);
      host.innerHTML = await response.text();
    }
    const module = await import(new URL("live.js", base).href);
    const handle = module.mount(host, { ...host.dataset, ...options });
    host.dataset.state = "live";
    return handle;
  } catch (error) {
    host.dataset.state = "still";
    if (!host.querySelector(".iso-figure")) {
      const image = document.createElement("img");
      image.className = "fig-fallback";
      image.src = new URL("preview.svg", base).href;
      image.alt = host.dataset.alt || "示意元件的靜態圖";
      host.replaceChildren(image);
    }
    console.warn(`figure ${id} stays still:`, error);
    return null;
  }
}

if (!document.documentElement.dataset.figuresManual) {
  for (const host of document.querySelectorAll("[data-figure]")) startFigure(host);
}
