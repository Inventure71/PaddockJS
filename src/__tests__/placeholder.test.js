import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('startup placeholder subpath', () => {
  test('exports CSS-free placeholder markup for pre-JS simulator loading', async () => {
    const moduleUrl = new URL('../placeholder/index.js', import.meta.url);
    expect(existsSync(moduleUrl)).toBe(true);
    const source = readFileSync(moduleUrl, 'utf8');
    expect(source).not.toContain('pixi.js');
    expect(source).not.toContain('../index.js');
    expect(source).not.toContain('../styles.css');

    const { createPaddockLoadingPlaceholder } = await import('../placeholder/index.js');
    const html = createPaddockLoadingPlaceholder();

    expect(html).toContain('data-paddock-placeholder');
    expect(html).toContain('data-paddock-placeholder-variant="lights"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading simulator');
    expect(html).toContain('paddock-placeholder__lights');
  });

  test('escapes placeholder text and supports host customization hooks', async () => {
    const moduleUrl = new URL('../placeholder/index.js', import.meta.url);
    expect(existsSync(moduleUrl)).toBe(true);

    const { createPaddockLoadingPlaceholder } = await import('../placeholder/index.js');
    const html = createPaddockLoadingPlaceholder({
      label: 'Boot <race>',
      detail: 'Loading "fast" shell',
      className: 'portfolio-sim-shell',
      variant: 'custom',
      attributes: {
        id: 'project-sim-placeholder',
        'data-owner': 'host',
      },
    });

    expect(html).toContain('class="paddock-placeholder portfolio-sim-shell"');
    expect(html).toContain('id="project-sim-placeholder"');
    expect(html).toContain('data-owner="host"');
    expect(html).toContain('data-paddock-placeholder-variant="custom"');
    expect(html).toContain('Boot &lt;race&gt;');
    expect(html).toContain('Loading &quot;fast&quot; shell');
    expect(html).not.toContain('<race>');
  });

  test('ships a tiny standalone placeholder stylesheet with animated lights', () => {
    const cssUrl = new URL('../placeholder.css', import.meta.url);
    expect(existsSync(cssUrl)).toBe(true);

    const css = readFileSync(cssUrl, 'utf8');
    expect(css.length).toBeLessThan(5000);
    expect(css).toContain('.paddock-placeholder');
    expect(css).toContain('.paddock-placeholder__lights');
    expect(css).toContain('@keyframes paddock-placeholder-lights');
    expect(css).not.toContain('@import');
    expect(css).not.toContain('url(');
  });
});
