import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const SHOWCASE_HTML_FILES = [
  'local-preview/templates.html',
  'local-preview/components.html',
  'local-preview/behavior.html',
  'local-preview/api.html',
  'local-preview/policy-runner.html',
  'local-preview/stewarding.html',
];

const HOST_EMBED_ROOT_IDS = [
  'template-complete-root',
  'template-dashboard-root',
  'template-overlay-root',
  'template-banner-root',
  'template-compact-root',
  'template-full-dashboard-root',
  'template-drawer-root',
  'behavior-expand-root',
  'behavior-scroll-root',
  'behavior-embedded-camera-root',
  'behavior-sector-banner-root',
  'behavior-finish-root',
  'api-simulator-root',
  'policy-runner-root',
  'stewarding-penalty-root',
  'component-embedded-canvas',
];

const PIECE_MOUNT_IDS = [
  'component-race-controls',
  'component-safety-car',
  'component-camera-controls',
  'component-timing-tower',
  'component-race-canvas',
  'component-telemetry-core',
  'component-telemetry-sectors',
  'component-telemetry-sector-banner',
  'component-telemetry-panel',
  'component-telemetry-lap-times',
  'component-telemetry-sector-times',
  'component-overview',
  'component-race-data',
  'component-telemetry-drawer',
];

function readFile(path) {
  return readFileSync(path, 'utf8');
}

describe('local preview markup contracts', () => {
  test('host-embed simulator roots use the explicit preview-mount hook', () => {
    const html = SHOWCASE_HTML_FILES.map(readFile).join('\n');

    HOST_EMBED_ROOT_IDS.forEach((id) => {
      expect(html).toContain(`class="preview-mount" id="${id}"`);
    });
  });

  test('components page piece mounts keep the explicit piece-mount hook', () => {
    const html = readFile('local-preview/components.html');

    PIECE_MOUNT_IDS.forEach((id) => {
      expect(html).toContain(`class="piece-mount" id="${id}"`);
    });
  });

  test('showcase CSS does not target anonymous host-embed child divs anymore', () => {
    const css = readFile('local-preview/src/styles.css');

    expect(css).not.toMatch(/\.host-embed(?:--[a-z-]+)?\s*>\s*div\b/);
    expect(css).toMatch(/\.host-embed(?:--[a-z-]+)?\s*>\s*\.preview-mount\b/);
  });

  test('host-embed variant rules do not force loaded preview mounts to keep placeholder min-heights', () => {
    const css = readFile('local-preview/src/styles.css');

    expect(css).toContain('--preview-placeholder-min-height');
    expect(css).not.toMatch(/\.host-embed--[a-z-]+\s*>\s*\.preview-mount[^{]*\{[^}]*min-height/);
    expect(css).not.toMatch(/\.host-embed--[a-z-]+[^{]*\.sim-canvas-panel[^{]*\{[^}]*min-height/);
  });

  test('section headings use the available row instead of hero-style narrow wrapping', () => {
    const css = readFile('local-preview/src/styles.css');
    const sectionHeadingRule = [...css.matchAll(/\.section-heading h2\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((ruleBody) => ruleBody.includes('max-width'));

    expect(sectionHeadingRule).toContain('max-width: 100%');
    expect(sectionHeadingRule).not.toMatch(/max-width:\s*min\([^)]*ch/);
    expect(sectionHeadingRule).not.toMatch(/font-size:\s*clamp\([^;]*6vw/);
    expect(sectionHeadingRule).not.toContain('text-wrap: balance');
  });
});
