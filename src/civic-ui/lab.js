/** ui-lab.html: every bright component on real published data. */
import "../lib/mobile-nav.js";
import { mountBrowse } from "./browse.js";
import { mountDossiers } from "./dossier.js";
import { mountHome, readJson } from "./home-view.js";
import { escapeHtml, placeItems } from "./model.mjs";
import { initPrefs } from "./prefs.js";
import { mountSidebar } from "./sidebar.js";
import { mountSpecimens } from "./specimens.js";

initPrefs();
mountHome(document.querySelector("#labHome"));
mountBrowse(document.querySelector("#labArchive"));
mountSpecimens(document.querySelector("#labStyle"));

const governance = document.querySelector("#labGovernance");
const side = document.querySelector("#labSide");
const log = document.querySelector("#labMapLog");
Promise.all([readJson("/data/governance.json"), readJson("/data/governance-registry.json")]).then(([data, registry]) => {
  mountDossiers(governance, { data, registry });
  const panel = mountSidebar(side, { items: placeItems(data.projects), registry });
  side.addEventListener("civic:place-select", (event) => {
    log.textContent = `civic:place-select ${JSON.stringify({ id: event.detail.id, located: event.detail.located })}`;
  });
  document.querySelector("#labMapPick").addEventListener("click", () => {
    const first = data.projects[0];
    panel.select(first.id);
    log.textContent = `api.select(${JSON.stringify(first.id)})`;
  });
}).catch((error) => {
  const gap = `<p class="civic-gapnote" role="alert">${escapeHtml(error.message)}。治理案卷沒有載入，這是讀取缺口。</p>`;
  governance.innerHTML = gap;
  side.innerHTML = gap;
});
