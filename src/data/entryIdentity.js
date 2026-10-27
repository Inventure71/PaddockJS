import { normalizeCssColorToken } from '../config/theme/cssTokens.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function normalizeLetters(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
}

function timingCodeCandidates(source) {
  const letters = normalizeLetters(source);
  if (!letters) return ['XXX'];
  if (letters.length <= 3) return [letters.padEnd(3, 'X')];

  const candidates = [letters.slice(0, 3)];
  for (let index = 1; index <= letters.length - 3; index += 1) {
    candidates.push(letters.slice(index, index + 3));
  }
  candidates.push(`${letters[0]}${letters[1]}${letters[letters.length - 1]}`);
  return [...new Set(candidates)];
}

export function pickUniqueTimingCode(source, usedCodes) {
  for (const candidate of timingCodeCandidates(source)) {
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }

  const letters = normalizeLetters(source).padEnd(2, 'X');
  for (const suffix of LETTERS) {
    const candidate = `${letters[0]}${letters[1]}${suffix}`;
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Unable to create a unique three-letter timing code for "${source}"`);
}

export function formatDriverNumber(driverNumber) {
  return String(driverNumber ?? '').padStart(2, '0');
}

function normalizeTeamIcon(source) {
  const letters = normalizeLetters(source);
  return letters.slice(0, 2).padEnd(2, 'X');
}

export function normalizeTeam(team, driver, timingCode) {
  const source = team ?? driver.team;
  if (!source) return null;
  const name = source.name ?? source.id ?? `${driver.name ?? timingCode} Team`;
  const id = (source.id ?? normalizeLetters(name).toLowerCase()) || `${driver.id}-team`;
  return {
    ...source,
    id,
    name,
    color: normalizeCssColorToken(source.color ?? driver.color, driver.color),
    icon: source.icon ?? normalizeTeamIcon(source.name ?? source.id ?? timingCode ?? driver.name),
  };
}
