/* Long-page navigation, shared by the dashboard and preserved reference pages. */
(() => {
  if (document.querySelector('.back-to-top')) return;
  const heading = document.querySelector('.top h1');
  if (!heading) return;
  const link = document.createElement('a');
  link.className = 'back-to-top';
  link.href = '#page-top';
  link.textContent = '回到頁首 ↑';
  link.hidden = true;
  heading.id ||= 'page-top';
  link.href = '#' + heading.id;
  document.body.append(link);
  let queued = false;
  function update() {
    link.hidden = window.scrollY < 600;
    queued = false;
  }
  window.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }, { passive: true });
  link.addEventListener('click', event => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
  update();
  document.documentElement.dataset.pageTools = 'ready';
})();
