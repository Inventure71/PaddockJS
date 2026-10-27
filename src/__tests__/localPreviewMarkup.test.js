import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const SHOWCASE_HTML_FILES = [
  'site/guide/index.html',
  'site/guide/templates.html',
  'site/guide/components.html',
  'site/guide/customization.html',
  'site/guide/grid-walk.html',
  'site/labs/behavior.html',
  'site/guide/rules.html',
  'site/guide/api.html',
  'site/labs/playable.html',
  'site/labs/policy-runner.html',
  'site/labs/stewarding.html',
  'site/labs/collision-lab.html',
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
  test('guide and lab fixtures defer shared navigation to the site shell', () => {
    const fixturePages = SHOWCASE_HTML_FILES.filter((path) => !path.endsWith('/index.html'));
    const html = fixturePages.map(readFile).join('\n');

    fixturePages.forEach((path) => {
      expect(readFile(path)).toContain('<!-- site-header -->');
    });
    expect(html).toContain('data-page="rules"');
    expect(html).toContain('data-page="playable"');
    expect(html).toContain('data-page="grid-walk"');
  });

  test('rules page lists every host-configurable rule module', () => {
    const html = readFile('site/guide/rules.html');

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

  test('templates page uses the official pre-JS startup placeholder markup', () => {
    const html = readFile('site/guide/templates.html');
    const css = readFile('site/src/showcase/styles.css');

    expect(css).toContain("@import '@inventure71/paddockjs/placeholder.css';");
    expect(html).toContain('id="template-complete-root"');
    expect(html).toContain('data-paddock-placeholder');
    expect(html).toContain('data-paddock-placeholder-variant="lights"');
    expect(html).toContain('paddock-placeholder__lights');
    expect(html).toContain('Loading simulator');
  });

  test('components page piece mounts keep the explicit piece-mount hook', () => {
    const html = readFile('site/guide/components.html');

    PIECE_MOUNT_IDS.forEach((id) => {
      expect(html).toContain(`class="piece-mount" id="${id}"`);
    });
  });

  test('components page mounts every separate piece through the shared preview mount table', () => {
    const main = readFile('site/src/showcase/main.js');

    expect(main).toContain('const COMPONENT_PIECE_MOUNTS = [');
    expect(main).toContain('function mountComponentPieces');
    PIECE_MOUNT_IDS
      .filter((id) => id !== 'component-telemetry-drawer')
      .forEach((id) => {
        expect(main).toContain(`id: '${id}'`);
      });
    expect(main).toContain('mountComponentPieces(pieces)');
  });

  test('showcase CSS does not target anonymous host-embed child divs anymore', () => {
    const css = readFile('site/src/showcase/styles.css');

    expect(css).not.toMatch(/\.host-embed(?:--[a-z-]+)?\s*>\s*div\b/);
    expect(css).toMatch(/\.host-embed(?:--[a-z-]+)?\s*>\s*\.preview-mount\b/);
  });

  test('host-embed variant rules do not force loaded preview mounts to keep placeholder min-heights', () => {
    const css = readFile('site/src/showcase/styles.css');

    expect(css).toContain('--preview-placeholder-min-height');
    expect(css).toMatch(/\.host-embed\s*>\s*\.preview-mount\.f1-sim-component:has\(\[data-paddock-component\]\.is-loaded\)\s*\{[^}]*min-height:\s*0/);
    expect(css).not.toMatch(/\.host-embed--[a-z-]+\s*>\s*\.preview-mount[^{]*\{[^}]*min-height/);
    expect(css).not.toMatch(/\.host-embed--[a-z-]+[^{]*\.sim-canvas-panel[^{]*\{[^}]*min-height/);
  });

  test('section headings use the available row instead of hero-style narrow wrapping', () => {
    const css = readFile('site/src/showcase/styles.css');
    const sectionHeadingRule = [...css.matchAll(/\.section-heading h2\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((ruleBody) => ruleBody.includes('max-width'));

    expect(sectionHeadingRule).toContain('max-width: 100%');
    expect(sectionHeadingRule).not.toMatch(/max-width:\s*min\([^)]*ch/);
    expect(sectionHeadingRule).not.toMatch(/font-size:\s*clamp\([^;]*6vw/);
    expect(sectionHeadingRule).not.toContain('text-wrap: balance');
  });

  test('local preview simulators opt into stalled off-track DNF explicitly', () => {
    const main = readFile('site/src/showcase/main.js');

    expect(main).toContain('function previewRules');
    expect(main).toContain('stalledDnf: {');
    expect(main).toContain('enabled: true');
    expect(main).toMatch(/rules:\s*previewRules\(\)/);
  });

  test('playable page exposes pit controls and pit-state readout hooks', () => {
    const html = readFile('site/labs/playable.html');
    const main = readFile('site/src/showcase/playablePage.js');

    expect(html).toContain('data-playable-pit-intent="1"');
    expect(html).toContain('data-playable-pit-intent="2"');
    expect(html).toContain('data-playable-pit-intent="0"');
    expect(html).toContain('data-playable-compound="S"');
    expect(html).toContain('data-playable-pit-state');
    expect(main).toContain('data-playable-pit-intent');
    expect(main).toContain('pitStopPhase');
    expect(main).toContain('pitStopsCompleted');
  });

  test('playable toolbar keeps controls and status on one desktop row', () => {
    const css = readFile('site/src/showcase/styles.css');

    expect(css).toMatch(/\.playable-stage__toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(12rem,\s*max-content\)\s+minmax\(0,\s*max-content\)\s+minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.playable-controls\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(css).toMatch(/\.playable-controls\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.playable-controls button\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.playable-status\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.playable-status\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.playable-status\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  test('playable page surfaces expert episode stop reasons', () => {
    const main = readFile('site/src/showcase/playablePage.js');

    expect(main).toContain('endReason');
    expect(main).toContain('Stopped:');
  });

  test('showcase snippets do not advertise preview-only policy helpers as package exports', () => {
    const catalog = readFile('site/src/showcase/showcaseCatalog.js');

    expect(catalog).not.toMatch(
      /import\s*\{[^}]*\bcreateDistilledPolicyController\b[^}]*\}\s*from\s*'@inventure71\/paddockjs'/,
    );
    expect(catalog).not.toMatch(/code:\s*`[^`]*\bcreatePolicyServerController\b/);
    expect(catalog).not.toMatch(/code:\s*`[^`]*\bcreateLiveNodeViewController\b/);
  });
});
