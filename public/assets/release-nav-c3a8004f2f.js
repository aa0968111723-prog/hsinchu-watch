
const ref = {
  index: ['liveRefresh', 'extraPeople', 'socialSection'],
  compare: ['compareBoard', 'sourceDist'],
  topics: ['stances', 'stanceChips', 'stanceBoard'],
  person: ['socialSection', 'personPlatform', 'personPlatformBody'],
};
const route = location.pathname.split('/').at(-1).replace(/\.html$/, '') || 'index';
const person = new URLSearchParams(location.search).get('id');
if (!location.pathname.startsWith('/reference/') &&
    (ref[route]?.includes(location.hash.slice(1)) ||
      (route === 'person' && ['chen', 'wu_zijia'].includes(person)))) {
  location.replace('/reference/' + route + '.html' + location.search + location.hash);
}
for (const link of document.querySelectorAll('a[data-profile-reference]')) link.search = location.search;
const nav = document.querySelector('.top nav.nav');
if (nav) {
  nav.setAttribute('aria-label', '主選單');
  nav.querySelector('a.active')?.setAttribute('aria-current', 'page');
}
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
