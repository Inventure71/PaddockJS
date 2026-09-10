import { FEATURE_CATALOG, FEATURE_CHAPTERS } from '../data/featureCatalog.js';

const SYSTEM_GROUPS = [
  ['Race flow', ['Standing start + lights', 'Laps, sectors + finish', 'Safety car + red flag', 'DRS timing + zones']],
  ['Vehicle', ['Arcade + advanced physics', 'Wheel-level surfaces', 'Contact + anti-tunnelling', 'Built-in racing AI']],
  ['Strategy', ['Pit entry + queue + service', 'Tyre wear + compounds', 'Pit crew variability', 'Pit intent + lane control']],
  ['Stewarding', ['Track limits', 'Collision fault', 'Pit-lane speeding', 'Tyre requirement']],
  ['Consequences', ['Warnings + time', 'Drive-through + stop-go', 'Grid + position drops', 'Disqualification + DNF']],
  ['Classification', ['Provisional finish', 'Penalty-adjusted order', 'DNF placement', 'Final winner + top three']],
];

export function renderSystemLedger(root) {
  root.innerHTML = SYSTEM_GROUPS.map(([title, items]) => `
    <article class="system-group">
      <h3>${title}</h3>
      <ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>
    </article>
  `).join('');
}

export function installFeatureInventory({ root, search, filters, empty }) {
  let activeMode = 'all';

  function render() {
    const query = search.value.trim().toLowerCase();
    const filtered = FEATURE_CATALOG.filter((feature) => {
      const matchesMode = activeMode === 'all' || feature.mode === activeMode;
      const haystack = `${feature.title} ${feature.summary} ${feature.chapter} ${feature.apis.join(' ')}`.toLowerCase();
      return matchesMode && (!query || haystack.includes(query));
    });

    root.innerHTML = FEATURE_CHAPTERS.map((chapter) => {
      const features = filtered.filter((feature) => feature.chapter === chapter.id);
      if (!features.length) return '';
      return `
        <section class="feature-chapter" aria-labelledby="feature-chapter-${chapter.id}">
          <h3 id="feature-chapter-${chapter.id}">${chapter.label}</h3>
          <ul class="feature-list">
            ${features.map((feature) => `
              <li class="feature-row" data-feature-id="${feature.id}">
                <a href="${feature.href}">${feature.title}</a>
                <p>${feature.summary}</p>
                <span class="feature-mode" data-mode="${feature.mode}">${feature.mode}</span>
              </li>
            `).join('')}
          </ul>
        </section>
      `;
    }).join('');
    empty.hidden = filtered.length > 0;
  }

  search.addEventListener('input', render);
  filters.forEach((button) => button.addEventListener('click', () => {
    activeMode = button.dataset.featureFilter;
    filters.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
  render();
}
