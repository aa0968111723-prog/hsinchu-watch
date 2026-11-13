/** Reader's display choices, kept in this browser: night reading and motion.
 *  The OS "reduce motion" setting always wins; the switch can only add stillness
 *  or lift the small-device default.
 */
const KEYS = { theme: "civic-theme", motion: "civic-motion" };

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* stays for this page only */ } };

export function initPrefs(root = document, { theme = true } = {}) {
  const html = document.documentElement;
  if (theme && read(KEYS.theme) === "dark") html.dataset.civicTheme = "dark";
  const motion = read(KEYS.motion);
  if (motion === "off" || motion === "on") html.dataset.civicMotion = motion;

  const themeButton = root.querySelector("[data-civic-theme-toggle]");
  const motionButton = root.querySelector("[data-civic-motion-toggle]");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const paint = () => {
    themeButton?.setAttribute("aria-pressed", html.dataset.civicTheme === "dark" ? "true" : "false");
    if (motionButton) {
      const still = reduce.matches || html.dataset.civicMotion === "off";
      motionButton.setAttribute("aria-pressed", still ? "true" : "false");
      motionButton.disabled = reduce.matches;
      motionButton.title = reduce.matches ? "系統已設定減少動態效果" : "";
    }
  };
  themeButton?.addEventListener("click", () => {
    if (html.dataset.civicTheme === "dark") delete html.dataset.civicTheme;
    else html.dataset.civicTheme = "dark";
    write(KEYS.theme, html.dataset.civicTheme === "dark" ? "dark" : "light");
    paint();
    document.dispatchEvent(new CustomEvent("civic:theme"));
  });
  motionButton?.addEventListener("click", () => {
    html.dataset.civicMotion = html.dataset.civicMotion === "off" ? "on" : "off";
    write(KEYS.motion, html.dataset.civicMotion);
    paint();
    document.dispatchEvent(new CustomEvent("civic:motion"));
  });
  reduce.addEventListener("change", paint);
  paint();
}
