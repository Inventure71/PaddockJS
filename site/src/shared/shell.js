import './shell.css';

const header = document.querySelector('[data-site-header]');
const toggle = document.querySelector('[data-nav-toggle]');
const navigation = document.querySelector('[data-site-nav]');
function closeNavigation() {
  toggle?.setAttribute('aria-expanded', 'false');
  navigation?.classList.remove('is-open');
}
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  navigation?.classList.toggle('is-open', open);
});
header?.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeNavigation();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
    closeNavigation();
    toggle?.focus();
  }
});
const sections = [...document.querySelectorAll('[data-nav-section]')];
if (sections.length) {
  const links = [...document.querySelectorAll('[data-section-navigation] a')];
  const visible = new Map();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.set(entry.target, entry);
        else visible.delete(entry.target);
      }
      const active = [...visible.values()].sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!active) return;
      for (const link of links) {
        if (link.hash === `#${active.target.id}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    },
    { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.15, 0.45] },
  );
  sections.forEach((section) => observer.observe(section));
}
const search = document.querySelector('[data-reference-search]');
search?.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  let visible = 0;
  for (const item of document.querySelectorAll('[data-reference-document]')) {
    item.hidden = !item.textContent.toLowerCase().includes(query);
    if (!item.hidden) visible += 1;
  }
  for (const group of document.querySelectorAll('[data-reference-group]')) {
    group.hidden = ![...group.querySelectorAll('[data-reference-document]')].some((item) => !item.hidden);
  }
  const result = document.querySelector('[data-reference-results]');
  if (result) result.textContent = `${visible} documents`;
});
