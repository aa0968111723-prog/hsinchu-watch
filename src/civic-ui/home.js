/** index.html: the reading desk at the top of the home page. */
import { mountHome } from "./home-view.js";
import { initPrefs } from "./prefs.js";

// Motion choice carries over from the preview page; night reading stays there
// until the older home panels have dark tokens.
initPrefs(document, { theme: false });
const root = document.querySelector("#civicHome");
if (root) mountHome(root);
