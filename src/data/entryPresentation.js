import { normalizePublicUrlOption } from '../config/urlOptions.js';

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function lines(value) {
  return Array.isArray(value) ? value.filter((line) => typeof line === 'string' && line.trim()) : [];
}

export function normalizeEntryPresentation(driver, source = driver.presentation ?? {}) {
  const image = source?.image;
  const imageSrc = normalizePublicUrlOption(image?.src, '');
  return {
    name: text(source?.name).trim() || driver.name,
    summary: text(source?.summary, text(driver.raceData?.[0])),
    technologies: lines(source?.technologies),
    details: lines(source?.details ?? driver.raceData?.slice(1)),
    image: imageSrc ? { src: imageSrc, alt: text(image.alt) } : null,
    href: normalizePublicUrlOption(source?.href ?? driver.link, ''),
    linkLabel: text(source?.linkLabel).trim() || 'Open project',
  };
}
