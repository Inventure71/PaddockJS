export function clampPolicyAction(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function zeros(length) {
  return Array.from({ length }, () => 0);
}

export function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

export function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function ratioNumber(value, denominator) {
  const bottom = Number(denominator);
  if (!Number.isFinite(bottom) || bottom <= 0) return 0;
  return clampPolicyAction(Number(value) / bottom, 0, 1);
}

export function runLinear(input, weight, bias) {
  return weight.map((row, rowIndex) => {
    let sum = Number(bias?.[rowIndex] ?? 0);
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      sum += Number(row[columnIndex] ?? 0) * Number(input[columnIndex] ?? 0);
    }
    return Number.isFinite(sum) ? sum : 0;
  });
}

export function reluVector(values) {
  return values.map((value) => Math.max(0, value));
}

export function meanRows(rows) {
  if (!rows.length) return [];
  return rows[0].map((_, columnIndex) => rows.reduce((sum, row) => sum + row[columnIndex], 0) / rows.length);
}

export function attentionPool(rows, rawScores, mask = null) {
  if (!rows.length) return [];
  const validScores = rawScores.map((score, index) => (mask && !mask[index] ? -1e9 : score));
  const hasAny = mask ? mask.some(Boolean) : true;
  const scores = hasAny ? validScores : rawScores.map(() => 0);
  const maxScore = Math.max(...scores);
  const exps = scores.map((score, index) => {
    if (mask && hasAny && !mask[index]) return 0;
    return Math.exp(score - maxScore);
  });
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return rows[0].map((_, columnIndex) => rows.reduce((sum, row, rowIndex) => (
    sum + row[columnIndex] * exps[rowIndex]
  ), 0) / total);
}

export function fitCheckpointInput(vector, targetLength) {
  const length = Number(targetLength);
  if (!Number.isInteger(length) || length <= 0) return vector;
  if (vector.length === length) return vector;
  if (vector.length > length) return vector.slice(0, length);
  return vector.concat(Array.from({ length: length - vector.length }, () => 0));
}

export function runCheckpointActor(input, layers) {
  let values = input;
  for (let index = 0; index < layers.length; index += 1) {
    values = runLinearLayer(values, layers[index]);
    if (index < layers.length - 1) values = values.map((value) => Math.max(0, value));
  }
  return values.map((value) => Math.tanh(value));
}

function runLinearLayer(input, layer) {
  return layer.weight.map((row, rowIndex) => {
    let sum = Number(layer.bias?.[rowIndex] ?? 0);
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      sum += Number(row[columnIndex] ?? 0) * Number(input[columnIndex] ?? 0);
    }
    return sum;
  });
}
