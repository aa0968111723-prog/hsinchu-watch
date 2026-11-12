export function focusActiveNav() {
  const nav = document.querySelector('.top .nav');
  const active = nav?.querySelector('a.active');
  if (!nav) return;
  nav.setAttribute('aria-label', '主選單');
  const main = document.querySelector('main');
  if (main && !document.querySelector('.skip-link')) {
    main.id ||= 'main-content';
    main.tabIndex = -1;
    const skip = document.createElement('a');
    skip.href = '#' + main.id;
    skip.className = 'skip-link';
    skip.textContent = '跳到主要內容';
    skip.addEventListener('click', () => main.focus());
    document.body.prepend(skip);
  }
  if (!active) return;
  active.setAttribute('aria-current', 'page');
  if (nav.scrollWidth <= nav.clientWidth) return;
  const menu = nav.getBoundingClientRect();
  const link = active.getBoundingClientRect();
  if (link.left < menu.left) nav.scrollLeft += link.left - menu.left;
  if (link.right > menu.right) nav.scrollLeft += link.right - menu.right;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', focusActiveNav, { once: true });
  } else {
    focusActiveNav();
  }
}
