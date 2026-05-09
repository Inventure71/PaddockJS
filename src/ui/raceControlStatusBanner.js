import { escapeHtml } from './templateUtils.js';

export const RACE_CONTROL_STATUS_BANNERS = {
  'safety-car': {
    status: 'safety-car',
    className: 'is-safety-car',
    kicker: 'FIA',
    title: 'Safety Car',
  },
  'red-flag': {
    status: 'red-flag',
    className: 'is-red-flag',
    kicker: 'FIA',
    title: 'Red Flag',
  },
};

export function getRaceControlStatusBanner(mode) {
  return RACE_CONTROL_STATUS_BANNERS[mode] ?? null;
}

export function createRaceControlStatusBannerMarkup({ status = null } = {}) {
  const banner = getRaceControlStatusBanner(status);
  const className = [
    'broadcast-race-control-banner',
    banner?.className,
  ].filter(Boolean).join(' ');
  const hiddenAttribute = banner ? '' : ' hidden';
  const statusAttribute = banner ? ` data-race-control-status="${escapeHtml(banner.status)}"` : '';
  const kicker = banner?.kicker ?? 'FIA';
  const title = banner?.title ?? 'Race Control';

  return `
        <div class="${className}" data-tower-race-control-banner${statusAttribute}${hiddenAttribute}>
          <span data-tower-race-control-kicker>${escapeHtml(kicker)}</span>
          <strong data-tower-race-control-title>${escapeHtml(title)}</strong>
        </div>
  `;
}
