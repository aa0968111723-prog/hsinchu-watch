(() => {
  const nav = document.querySelector('nav.civic-nav');
  if (!nav) return;
  function markCurrent() {
    const path = location.pathname.split('/').pop() || 'index.html';
    const hash = location.hash;
    for (const link of nav.querySelectorAll('a')) {
      const href = link.getAttribute('href') || '';
      const [filePart, hashPart] = href.split('#');
      const file = filePart.split('/').pop();
      const linkHash = hashPart ? '#' + hashPart : '';
      const current = file === path && (!linkHash || linkHash === hash);
      if (current) link.classList.add('is-here');
      else link.classList.remove('is-here');
    }
  }
  markCurrent();
  window.addEventListener('hashchange', markCurrent);
  document.documentElement.dataset.civicNav = 'ready';
})();
