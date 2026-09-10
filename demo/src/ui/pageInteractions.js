export function installPageInteractions() {
  const header = document.querySelector('[data-site-header]');
  const nav = document.querySelector('[data-site-nav]');
  const navToggle = document.querySelector('[data-nav-toggle]');

  const syncHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 16);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  const closeNavigation = () => {
    nav?.classList.remove('is-open');
    navToggle?.setAttribute('aria-expanded', 'false');
  };

  navToggle?.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') !== 'true';
    navToggle.setAttribute('aria-expanded', String(open));
    nav?.classList.toggle('is-open', open);
  });
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeNavigation));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNavigation();
  });

  const sectionLinks = new Map([...nav?.querySelectorAll('a[href^="#"]') ?? []].map((link) => [
    link.getAttribute('href').slice(1),
    link,
  ]));
  const sectionObserver = new IntersectionObserver((entries) => {
    const active = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!active) return;
    sectionLinks.forEach((link, id) => {
      if (id === active.target.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-25% 0px -60% 0px', threshold: [0, 0.15, 0.45] });
  document.querySelectorAll('[data-nav-section]').forEach((section) => sectionObserver.observe(section));

  document.querySelectorAll('[data-component-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.componentTarget);
      if (!target) return;
      document.querySelectorAll('.component-specimen.is-targeted').forEach((node) => node.classList.remove('is-targeted'));
      target.classList.add('is-targeted');
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => target.classList.remove('is-targeted'), 1800);
    });
  });

  installCopyButton(document.querySelector('[data-copy-install]'), 'npm install @inventure71/paddockjs');
  document.querySelectorAll('[data-copy-code]').forEach((button) => {
    const text = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
    installCopyButton(button, text);
  });

  return () => {
    window.removeEventListener('scroll', syncHeader);
    sectionObserver.disconnect();
  };
}

function installCopyButton(button, text) {
  if (!button) return;
  button.addEventListener('click', async () => {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    window.setTimeout(() => {
      button.textContent = original;
    }, 1400);
  });
}

export function onceVisible(element, callback, rootMargin = '500px 0px') {
  if (!element) return () => {};
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    callback();
  }, { rootMargin });
  observer.observe(element);
  return () => observer.disconnect();
}
