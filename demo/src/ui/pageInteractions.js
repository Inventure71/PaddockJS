export function installPageInteractions() {
  const abort = new AbortController();
  const options = { signal: abort.signal };
  const timers = new Set();
  const later = (callback, duration) => {
    const timer = window.setTimeout(() => { timers.delete(timer); if (!abort.signal.aborted) callback(); }, duration);
    timers.add(timer);
  };
  const header = document.querySelector('[data-site-header]');
  const nav = document.querySelector('[data-site-nav]');
  const navToggle = document.querySelector('[data-nav-toggle]');

  const syncHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 16);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { ...options, passive: true });

  const closeNavigation = () => {
    nav?.classList.remove('is-open');
    navToggle?.setAttribute('aria-expanded', 'false');
  };

  navToggle?.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') !== 'true';
    navToggle.setAttribute('aria-expanded', String(open));
    nav?.classList.toggle('is-open', open);
  }, options);
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeNavigation, options));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNavigation();
  }, options);

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
      target.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      later(() => target.classList.remove('is-targeted'), 1800);
    }, options);
  });

  installCopyButton(document.querySelector('[data-copy-install]'), 'npm install @inventure71/paddockjs', { options, later });
  document.querySelectorAll('[data-copy-code]').forEach((button) => {
    const text = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
    installCopyButton(button, text, { options, later });
  });

  return () => {
    abort.abort();
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    sectionObserver.disconnect();
  };
}

function installCopyButton(button, text, { options, later }) {
  if (!button) return;
  button.addEventListener('click', async () => {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      if (options.signal.aborted) return;
      button.textContent = 'Copied';
    } catch {
      if (options.signal.aborted) return;
      button.textContent = 'Copy failed';
    }
    later(() => { button.textContent = original; }, 1400);
  }, options);
}

export function onceVisible(element, callback, rootMargin = '500px 0px', onError = (error) => console.error(error)) {
  if (!element) return () => {};
  let disposed = false;
  const observer = new IntersectionObserver((entries) => {
    if (disposed || !entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    Promise.resolve().then(() => disposed ? undefined : callback()).catch((error) => { if (!disposed) onError(error); });
  }, { rootMargin });
  observer.observe(element);
  return () => { disposed = true; observer.disconnect(); };
}
