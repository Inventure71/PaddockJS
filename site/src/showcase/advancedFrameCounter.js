const DEFAULT_METRICS = Object.freeze({
  visualFrame: 0,
  simStep: 0,
  policyStep: 0,
  heldFramesRemaining: 0,
  lastPolicyDecisionMs: 0,
  lastExpertStepMs: 0,
  lastRenderMs: 0,
  lastVisualFrameMs: 0,
  lastAutoFrameGapMs: 0,
  visualFps: 0,
});

const DEFAULT_METRIC_DEFINITIONS = Object.freeze([
  { key: 'visualFrame', label: 'Visual frame' },
  { key: 'simStep', label: 'Sim step' },
  { key: 'policyStep', label: 'Policy' },
  { key: 'lastExpertStepMs', label: 'step', unit: 'ms' },
  { key: 'lastRenderMs', label: 'render', unit: 'ms' },
]);

export function createAdvancedFrameCounter(host, {
  label = 'Advanced FPS',
  metrics = DEFAULT_METRIC_DEFINITIONS,
} = {}) {
  if (!host) {
    return {
      update() {},
      reset() {},
      getMetrics: () => ({ ...DEFAULT_METRICS }),
    };
  }

  host.classList.add('advanced-fps-counter');
  host.setAttribute('role', 'status');
  host.setAttribute('aria-label', label);

  const title = document.createElement('span');
  title.className = 'advanced-fps-counter__title';
  title.textContent = label;

  const list = document.createElement('dl');
  list.className = 'advanced-fps-counter__metrics';

  const metricDefinitions = normalizeMetricDefinitions(metrics);
  const rows = metricDefinitions.map(({ key, label: displayLabel, unit }) => {
    const item = document.createElement('div');
    item.className = 'advanced-fps-counter__metric';
    const term = document.createElement('dt');
    term.textContent = displayLabel;
    const value = document.createElement('dd');
    value.dataset.advancedFpsMetric = key;
    item.append(term, value);
    list.append(item);
    return { key, valueNode: value, unit };
  });

  host.replaceChildren(title, list);

  let currentMetrics = { ...DEFAULT_METRICS };

  function update(metrics = {}) {
    currentMetrics = {
      ...currentMetrics,
      ...metrics,
    };
    for (const { key, valueNode, unit } of rows) {
      valueNode.textContent = formatMetricValue(currentMetrics[key], unit);
    }
  }

  update(currentMetrics);

  return {
    update,
    reset() {
      update(DEFAULT_METRICS);
    },
    getMetrics: () => ({ ...currentMetrics }),
  };
}

function normalizeMetricDefinitions(metrics) {
  const source = Array.isArray(metrics) && metrics.length ? metrics : DEFAULT_METRIC_DEFINITIONS;
  return source
    .map((metric) => {
      if (typeof metric === 'string') return { key: metric, label: metric, unit: metric.endsWith('Ms') ? 'ms' : null };
      return {
        key: String(metric?.key ?? ''),
        label: String(metric?.label ?? metric?.key ?? ''),
        unit: metric?.unit ?? (String(metric?.key ?? '').endsWith('Ms') ? 'ms' : null),
      };
    })
    .filter((metric) => metric.key && metric.label);
}

function formatMetricValue(value, unit) {
  if (unit === 'ms') return `${roundNumber(value)}ms`;
  if (unit === 'fps') return `${Math.round(Number(value) || 0)}fps`;
  if (unit) return `${roundNumber(value)}${unit}`;
  return String(Math.round(Number(value) || 0));
}

function roundNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 10) / 10;
}
