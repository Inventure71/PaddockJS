import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const SHOWCASE_HTML_FILES = [
  'local-preview/index.html',
  'local-preview/templates.html',
  'local-preview/components.html',
  'local-preview/behavior.html',
  'local-preview/rules.html',
  'local-preview/api.html',
  'local-preview/playable.html',
  'local-preview/policy-runner.html',
  'local-preview/stewarding.html',
  'local-preview/collision-lab.html',
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
  'playable-root',
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
  test('showcase navigation includes the rules route on every page', () => {
    const html = SHOWCASE_HTML_FILES.map(readFile).join('\n');
    const main = readFile('local-preview/src/main.js');

    SHOWCASE_HTML_FILES.forEach((path) => {
      expect(readFile(path)).toMatch(/<a(?:\s+aria-current="page")?\s+href="\/rules\.html">Rules<\/a>/);
    });
    expect(main).toContain("{ page: 'rules', href: '/rules.html', label: 'Rules' }");
    expect(main).toContain("{ page: 'playable', href: '/playable.html', label: 'Playable' }");
    expect(html).toContain('data-page="rules"');
    expect(html).toContain('data-page="playable"');
  });

  test('rules page lists every host-configurable rule module', () => {
    const html = readFile('local-preview/rules.html');

    [
      'ruleset',
      'standingStart',
      'pitStops',
      'tireStrategy',
      'tireDegradation',
      'stalledDnf',
      'penalties',
      'weather',
      'reliability',
      'fuelLoad',
    ].forEach((ruleKey) => {
      expect(html).toContain(ruleKey);
    });
    expect(html).toContain('Default: off');
    expect(html).toContain('Default: on');
    expect(html).toContain('Reserved future module');
  });

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
    expect(css).toMatch(/\.host-embed\s*>\s*\.preview-mount\.f1-sim-component:has\(\[data-paddock-component\]\.is-loaded\)\s*\{[^}]*min-height:\s*0/);
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

  test('local preview simulators opt into stalled off-track DNF explicitly', () => {
    const main = readFile('local-preview/src/main.js');

    expect(main).toContain('function previewRules');
    expect(main).toContain('stalledDnf: {');
    expect(main).toContain('enabled: true');
    expect(main).toMatch(/rules:\s*previewRules\(\)/);
  });
});
