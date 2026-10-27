import { afterEach, expect, test, vi } from 'vitest';
import { onceVisible, installPageInteractions } from '../../demo/src/ui/pageInteractions.js';

class Node extends EventTarget {
  classList = { toggle: vi.fn(), remove: vi.fn(), add: vi.fn() };
  attributes = new Map();
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  querySelectorAll() { return []; }
}
afterEach(() => vi.unstubAllGlobals());

test('visibility launch owns asynchronous failures and ignores a queued launch after disposal', async () => {
  let deliver;
  const observer = { observe: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal('IntersectionObserver', class { constructor(callback) { deliver = callback; return observer; } });
  const failure = new Error('Section startup failed');
  let reported;
  const completed = new Promise((resolve) => { reported = resolve; });
  const onError = vi.fn((error) => reported(error));
  const cleanup = onceVisible(new Node(), async () => { throw failure; }, '0px', onError);
  deliver([{ isIntersecting: true }]);
  await completed;
  expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  cleanup();
  const launch = vi.fn();
  const dispose = onceVisible(new Node(), launch);
  deliver([{ isIntersecting: true }]); dispose();
  await Promise.resolve();
  expect(launch).not.toHaveBeenCalled();
});

test('page disposal removes navigation/copy handlers and blocks an awaited clipboard completion', async () => {
  const header = new Node(), nav = new Node(), toggle = new Node(), copy = new Node(), doc = new Node(), win = new Node();
  copy.textContent = 'Copy';
  const write = {};
  write.promise = new Promise((resolve) => { write.resolve = resolve; });
  vi.stubGlobal('navigator', { clipboard: { writeText: () => write.promise } });
  doc.querySelector = (selector) => ({ '[data-site-header]': header, '[data-site-nav]': nav,
    '[data-nav-toggle]': toggle, '[data-copy-install]': copy })[selector] ?? null;
  doc.querySelectorAll = () => [];
  win.setTimeout = vi.fn(() => 1); win.clearTimeout = vi.fn(); win.scrollY = 0;
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const cleanup = installPageInteractions();
  toggle.dispatchEvent(new Event('click'));
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  copy.dispatchEvent(new Event('click'));
  cleanup();
  toggle.dispatchEvent(new Event('click'));
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  write.resolve(); await Promise.resolve();
  expect(copy.textContent).toBe('Copy');
  expect(win.setTimeout).not.toHaveBeenCalled();
});
