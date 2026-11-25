import type { CheckResponsePayload, NodeProbeResult } from '../functions/api/check';
import type { GatewayPhase } from './healthClient';
import type { SolarSnapshot } from './solar';
import type { ThemeMode } from './theme';

export interface RenderState {
  phase: GatewayPhase;
  verdict: CheckResponsePayload | null;
  solar: SolarSnapshot;
  themeMode: ThemeMode;
  isDark: boolean;
  recheckCooldownSec: number;
  redirectCountdownSec: number;
  isChecking: boolean;
  errorMessage: string | null;
}

export interface RenderHandlers {
  onStayHere: () => void;
  onRecheck: () => void;
  onCycleTheme: () => void;
  onOpenNode: (url: string) => void;
}

interface MountedRefs {
  handlers: RenderHandlers;
  shiftPill: HTMLElement;
  themeBtn: HTMLButtonElement;
  statusSection: HTMLElement;
  statusIndicator: HTMLElement;
  statusHeading: HTMLElement;
  statusCopy: HTMLElement;
  progressTrack: HTMLElement;
  progressBar: HTMLElement;
  alertBanner: HTMLElement;
  statusActions: HTMLElement;
  primaryRow: RowRefs;
  mirrorRow: RowRefs;
  checkedMeta: HTMLElement;
  utilityRecheckBtn: HTMLButtonElement;
  detailsPanel: HTMLDetailsElement;
  detailsGrid: HTMLElement;
}

interface RowRefs {
  row: HTMLElement;
  name: HTMLElement;
  roleTag: HTMLElement;
  url: HTMLElement;
  dot: HTMLElement;
  statusLabel: HTMLElement;
  latency: HTMLElement;
  actionBtn: HTMLButtonElement;
  currentUrl: string;
}

const mountedMap = new WeakMap<HTMLElement, MountedRefs>();

const ICON_EXTERNAL = `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"/><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5 7.5 8.5"/></svg>`;
const ICON_REFRESH = `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.45-3.72"/><path d="M13.5 2.5v2.75h-2.75"/></svg>`;
const ICON_CHEVRON = `<svg class="icon details-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>`;
const ICON_SUN = `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.25M8 13.25V14.5M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9"/></svg>`;
const ICON_MOON = `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 9.8A5.5 5.5 0 0 1 6.2 2.8a5.5 5.5 0 1 0 7 7Z"/></svg>`;
const ICON_AUTO = `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11"/><path d="M8 4.5a3.5 3.5 0 0 1 0 7"/></svg>`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatHost(url: string): string {
  if (!url) return 'Not configured';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatAge(checkedAt?: string): string {
  if (!checkedAt) return 'Not checked yet';
  const ms = Date.parse(checkedAt);
  if (!Number.isFinite(ms)) return 'Checked just now';
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 5) return 'Checked just now';
  if (sec < 60) return `Checked ${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `Checked ${min}m ago`;
}

function describeReasonPlain(reason: string): string {
  switch (reason) {
    case 'ok':
      return 'Healthy';
    case 'slow':
      return 'Responding slowly';
    case 'DEPLOYMENT_PAUSED':
      return 'Paused by hosting provider';
    case 'FUNCTION_THROTTLED':
      return 'Temporarily rate-limited';
    case 'timeout':
      return 'Timed out';
    case 'network_error':
      return 'Network unreachable';
    case 'non_json_response':
      return 'Returned error page';
    case 'invalid_payload':
      return 'Unexpected health response';
    case 'not_configured':
      return 'Not configured';
    default:
      return reason;
  }
}

function describeNodeStatus(
  node: NodeProbeResult | null,
  isChecking: boolean
): {
  dotClass: string;
  labelClass: string;
  text: string;
  latencyText: string;
} {
  if (isChecking && !node) {
    return { dotClass: '', labelClass: '', text: 'Checking…', latencyText: '' };
  }
  if (!node || !node.configured) {
    return { dotClass: '', labelClass: '', text: 'Not configured', latencyText: '' };
  }
  if (node.alive) {
    const latencyText = node.latencyMs > 0 ? `${node.latencyMs} ms` : '';
    return node.slow
      ? { dotClass: 'slow', labelClass: 'slow', text: 'Slow', latencyText }
      : { dotClass: 'ok', labelClass: 'ok', text: 'Available', latencyText };
  }
  return { dotClass: 'down', labelClass: 'down', text: 'Unavailable', latencyText: '' };
}

function getHeaderCopy(state: RenderState): {
  indicatorClass: string;
  heading: string;
  copy: string;
  showProgress: boolean;
  progressFraction: number | null;
  showStayBtn: boolean;
  showOpenBackupBtn: boolean;
  showPrimaryRecheckBtn: boolean;
  alertType: 'none' | 'warn' | 'down';
  alertText: string;
} {
  switch (state.phase) {
    case 'checking':
      return {
        indicatorClass: 'is-checking',
        heading: 'Checking workspace servers…',
        copy: 'Verifying which Elite Hospital server is ready for your shift.',
        showProgress: true,
        progressFraction: null,
        showStayBtn: true,
        showOpenBackupBtn: false,
        showPrimaryRecheckBtn: false,
        alertType: 'none',
        alertText: '',
      };
    case 'redirecting_primary':
      return {
        indicatorClass: 'is-ok',
        heading: 'Primary server is ready',
        copy: 'Opening the main occupancy dashboard now.',
        showProgress: true,
        progressFraction: null,
        showStayBtn: true,
        showOpenBackupBtn: false,
        showPrimaryRecheckBtn: false,
        alertType: 'none',
        alertText: '',
      };
    case 'redirecting_mirror': {
      const sec = Math.max(0, state.redirectCountdownSec);
      const fraction = Math.max(0, Math.min(1, (6 - sec) / 6));
      return {
        indicatorClass: 'is-warn',
        heading: sec > 0 ? `Switching to backup server in ${sec}s` : 'Opening backup server…',
        copy: 'The primary server is temporarily unavailable. Your hospital records remain on the same live database.',
        showProgress: true,
        progressFraction: fraction,
        showStayBtn: true,
        showOpenBackupBtn: Boolean(state.verdict?.mirror.url),
        showPrimaryRecheckBtn: false,
        alertType: 'none',
        alertText: '',
      };
    }
    case 'paused':
      return {
        indicatorClass: state.verdict?.activeTarget ? 'is-ok' : 'is-warn',
        heading: 'Select a workspace server',
        copy: 'Automatic redirect is paused. Open an available server below to sign in.',
        showProgress: false,
        progressFraction: null,
        showStayBtn: false,
        showOpenBackupBtn: false,
        showPrimaryRecheckBtn: false,
        alertType: 'none',
        alertText: '',
      };
    case 'offline':
      return {
        indicatorClass: 'is-down',
        heading: 'Your device is offline',
        copy: 'Reconnect to the hospital network or Wi-Fi, then check again.',
        showProgress: false,
        progressFraction: null,
        showStayBtn: false,
        showOpenBackupBtn: false,
        showPrimaryRecheckBtn: true,
        alertType: state.errorMessage ? 'down' : 'none',
        alertText: state.errorMessage || '',
      };
    case 'outage':
      return {
        indicatorClass: 'is-down',
        heading: 'Both workspace servers are unavailable',
        copy: "Hospital database records are unaffected. Wait a moment and check again, or contact Dr. Mohand El Ma'moun.",
        showProgress: false,
        progressFraction: null,
        showStayBtn: false,
        showOpenBackupBtn: false,
        showPrimaryRecheckBtn: true,
        alertType: state.errorMessage ? 'down' : 'none',
        alertText: state.errorMessage || '',
      };
  }
}

function buildRowMarkup(id: 'primary' | 'mirror', title: string, roleTag: string): string {
  return `
    <div class="ledger-row" data-row="${id}">
      <div class="ledger-info">
        <div class="ledger-title-line">
          <span class="ledger-name">${escapeHtml(title)}</span>
          <span class="role-tag">${escapeHtml(roleTag)}</span>
        </div>
        <span class="ledger-url" data-part="url"></span>
      </div>
      <div class="ledger-status">
        <span class="status-dot" data-part="dot" aria-hidden="true"></span>
        <span class="status-label" data-part="status-label"></span>
        <span class="ledger-latency tabular-nums" data-part="latency"></span>
      </div>
      <div class="ledger-action">
        <button type="button" class="btn btn-secondary" data-part="action"></button>
      </div>
    </div>
  `;
}

function queryRowRefs(root: HTMLElement, id: 'primary' | 'mirror', getHandlers: () => RenderHandlers): RowRefs {
  const row = root.querySelector<HTMLElement>(`[data-row="${id}"]`)!;
  const refs: RowRefs = {
    row,
    name: row.querySelector<HTMLElement>('.ledger-name')!,
    roleTag: row.querySelector<HTMLElement>('.role-tag')!,
    url: row.querySelector<HTMLElement>('[data-part="url"]')!,
    dot: row.querySelector<HTMLElement>('[data-part="dot"]')!,
    statusLabel: row.querySelector<HTMLElement>('[data-part="status-label"]')!,
    latency: row.querySelector<HTMLElement>('[data-part="latency"]')!,
    actionBtn: row.querySelector<HTMLButtonElement>('[data-part="action"]')!,
    currentUrl: '',
  };

  refs.actionBtn.addEventListener('click', () => {
    if (refs.currentUrl) {
      getHandlers().onOpenNode(refs.currentUrl);
    }
  });

  return refs;
}

function mountShell(root: HTMLElement, handlers: RenderHandlers): MountedRefs {
  root.innerHTML = `
    <section class="registry-frame">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-logo-box">
            <img src="/elite_logo.png" alt="Elite Hospital Logo" width="32" height="32" />
          </div>
          <div class="brand-text">
            <h1 class="brand-title">Elite Hospital Occupancy Manager</h1>
            <p class="brand-subtitle">Workspace Gateway</p>
          </div>
        </div>
        <div class="topbar-meta">
          <span class="shift-pill tabular-nums" data-ref="shift-pill"></span>
          <button type="button" class="theme-btn" data-ref="theme-btn"></button>
        </div>
      </header>

      <div class="status-section" data-ref="status-section" aria-live="polite">
        <div class="status-headline-row">
          <span class="status-indicator" data-ref="status-indicator" aria-hidden="true"></span>
          <h2 class="status-heading" data-ref="status-heading"></h2>
        </div>
        <p class="status-copy" data-ref="status-copy"></p>
        <div class="progress-track" data-ref="progress-track" role="progressbar" aria-label="Workspace status check" hidden>
          <div class="progress-bar" data-ref="progress-bar"></div>
        </div>
        <div class="alert-banner" data-ref="alert-banner" role="alert" hidden></div>
        <div class="status-actions" data-ref="status-actions" hidden></div>
      </div>

      <div class="ledger-section" aria-label="Workspace Servers">
        <div class="ledger-header">
          <span>Server</span>
          <span>Status</span>
          <span class="ledger-col-right">Access</span>
        </div>
        ${buildRowMarkup('primary', 'Primary Workspace', 'Main')}
        ${buildRowMarkup('mirror', 'Backup Workspace', 'Backup')}
      </div>

      <div class="utility-bar">
        <span class="checked-meta tabular-nums" data-ref="checked-meta"></span>
        <button type="button" class="btn btn-secondary" data-ref="utility-recheck"></button>
      </div>

      <details class="details-panel" data-ref="details-panel" hidden>
        <summary>${ICON_CHEVRON}<span>Connection details</span></summary>
        <div class="details-grid" data-ref="details-grid"></div>
      </details>
    </section>

    <footer class="footer-note">
      All rights reserved to Dr. Mohand El Ma'moun, Duty Manager · Elite Hospital Management Systems
    </footer>
  `;

  let currentHandlers = handlers;
  const getHandlers = () => currentHandlers;

  const refs: MountedRefs = {
    handlers,
    shiftPill: root.querySelector<HTMLElement>('[data-ref="shift-pill"]')!,
    themeBtn: root.querySelector<HTMLButtonElement>('[data-ref="theme-btn"]')!,
    statusSection: root.querySelector<HTMLElement>('[data-ref="status-section"]')!,
    statusIndicator: root.querySelector<HTMLElement>('[data-ref="status-indicator"]')!,
    statusHeading: root.querySelector<HTMLElement>('[data-ref="status-heading"]')!,
    statusCopy: root.querySelector<HTMLElement>('[data-ref="status-copy"]')!,
    progressTrack: root.querySelector<HTMLElement>('[data-ref="progress-track"]')!,
    progressBar: root.querySelector<HTMLElement>('[data-ref="progress-bar"]')!,
    alertBanner: root.querySelector<HTMLElement>('[data-ref="alert-banner"]')!,
    statusActions: root.querySelector<HTMLElement>('[data-ref="status-actions"]')!,
    primaryRow: queryRowRefs(root, 'primary', getHandlers),
    mirrorRow: queryRowRefs(root, 'mirror', getHandlers),
    checkedMeta: root.querySelector<HTMLElement>('[data-ref="checked-meta"]')!,
    utilityRecheckBtn: root.querySelector<HTMLButtonElement>('[data-ref="utility-recheck"]')!,
    detailsPanel: root.querySelector<HTMLDetailsElement>('[data-ref="details-panel"]')!,
    detailsGrid: root.querySelector<HTMLElement>('[data-ref="details-grid"]')!,
  };

  refs.themeBtn.addEventListener('click', () => refs.handlers.onCycleTheme());
  refs.utilityRecheckBtn.addEventListener('click', () => refs.handlers.onRecheck());

  mountedMap.set(root, refs);
  return refs;
}

function updateRow(
  rowRefs: RowRefs,
  node: NodeProbeResult | null,
  fallbackTitle: string,
  roleTag: string,
  isRecommended: boolean,
  isChecking: boolean
): void {
  const status = describeNodeStatus(node, isChecking);
  const url = node?.url || '';
  const canOpen = Boolean(node?.alive && url);

  rowRefs.row.className = `ledger-row${isRecommended ? ' is-recommended' : ''}`;
  rowRefs.name.textContent = node?.label || fallbackTitle;
  rowRefs.roleTag.textContent = roleTag;
  rowRefs.url.textContent = formatHost(url);

  rowRefs.dot.className = `status-dot${status.dotClass ? ` ${status.dotClass}` : ''}`;
  rowRefs.statusLabel.className = `status-label${status.labelClass ? ` ${status.labelClass}` : ''}`;
  rowRefs.statusLabel.textContent = status.text;
  rowRefs.latency.textContent = status.latencyText;

  rowRefs.currentUrl = canOpen ? url : '';
  rowRefs.actionBtn.disabled = !canOpen;
  rowRefs.actionBtn.className = `btn ${canOpen && isRecommended ? 'btn-primary' : 'btn-secondary'}`;
  rowRefs.actionBtn.innerHTML = canOpen
    ? `<span>Open</span>${ICON_EXTERNAL}`
    : `<span>${node?.configured ? 'Unavailable' : 'Not configured'}</span>`;
}

function syncStatusActions(refs: MountedRefs, state: RenderState, header: ReturnType<typeof getHeaderCopy>, recheckLabel: string): void {
  const hasActions = header.showStayBtn || header.showOpenBackupBtn || header.showPrimaryRecheckBtn;
  refs.statusActions.hidden = !hasActions;
  if (!hasActions) {
    refs.statusActions.innerHTML = '';
    return;
  }

  const parts: string[] = [];
  if (header.showOpenBackupBtn && state.verdict?.mirror.url) {
    parts.push(
      `<button type="button" class="btn btn-primary" data-status-action="open-backup"><span>Open backup now</span>${ICON_EXTERNAL}</button>`
    );
  }
  if (header.showStayBtn) {
    parts.push(`<button type="button" class="btn btn-secondary" data-status-action="stay">Stay on this page</button>`);
  }
  if (header.showPrimaryRecheckBtn) {
    const disabled = state.isChecking || state.recheckCooldownSec > 0 ? 'disabled' : '';
    parts.push(
      `<button type="button" class="btn btn-primary" data-status-action="recheck" ${disabled}>${ICON_REFRESH}<span>${escapeHtml(recheckLabel)}</span></button>`
    );
  }

  const nextHtml = parts.join('');
  if (refs.statusActions.dataset.renderedHtml !== nextHtml) {
    refs.statusActions.innerHTML = nextHtml;
    refs.statusActions.dataset.renderedHtml = nextHtml;

    refs.statusActions.querySelector('[data-status-action="stay"]')?.addEventListener('click', () => {
      refs.handlers.onStayHere();
    });
    refs.statusActions.querySelector('[data-status-action="recheck"]')?.addEventListener('click', () => {
      refs.handlers.onRecheck();
    });
    refs.statusActions.querySelector('[data-status-action="open-backup"]')?.addEventListener('click', () => {
      const target = state.verdict?.mirror.url;
      if (target) refs.handlers.onOpenNode(target);
    });
  } else if (header.showPrimaryRecheckBtn) {
    const btn = refs.statusActions.querySelector<HTMLButtonElement>('[data-status-action="recheck"]');
    if (btn) {
      btn.disabled = state.isChecking || state.recheckCooldownSec > 0;
    }
  }
}

export function renderGateway(root: HTMLElement, state: RenderState, handlers: RenderHandlers): void {
  const refs = mountedMap.get(root) || mountShell(root, handlers);
  refs.handlers = handlers;

  const header = getHeaderCopy(state);
  const activeTarget = state.verdict?.activeTarget || null;

  const themeIcon =
    state.themeMode === 'auto' ? ICON_AUTO : state.themeMode === 'dark' ? ICON_MOON : ICON_SUN;
  const themeLabel =
    state.themeMode === 'auto'
      ? `Auto (${state.isDark ? 'Night' : 'Day'})`
      : state.themeMode === 'dark'
      ? 'Dark'
      : 'Light';

  const recheckLabel = state.isChecking
    ? 'Checking…'
    : state.recheckCooldownSec > 0
    ? `Wait ${state.recheckCooldownSec}s`
    : 'Check again';

  refs.shiftPill.textContent = `Cairo · ${state.solar.cairoTimeFormatted} · ${state.solar.shiftLabel}`;
  refs.shiftPill.title = `${state.solar.cairoDateFormatted} · Shift ${state.solar.shiftHours} · Sunrise ${state.solar.sunriseFormatted}, Sunset ${state.solar.sunsetFormatted}`;

  refs.themeBtn.innerHTML = `${themeIcon}<span>${escapeHtml(themeLabel)}</span>`;
  refs.themeBtn.setAttribute('aria-label', `Switch theme mode, currently ${themeLabel}`);

  refs.statusIndicator.className = `status-indicator ${header.indicatorClass}`;
  refs.statusHeading.textContent = header.heading;
  refs.statusCopy.textContent = header.copy;

  refs.progressTrack.hidden = !header.showProgress;
  if (header.progressFraction !== null) {
    refs.progressBar.className = 'progress-bar is-determinate';
    refs.progressBar.style.transform = `scaleX(${header.progressFraction})`;
  } else {
    refs.progressBar.className = 'progress-bar';
    refs.progressBar.style.transform = '';
  }

  if (header.alertType !== 'none' && header.alertText) {
    refs.alertBanner.hidden = false;
    refs.alertBanner.className = `alert-banner${header.alertType === 'warn' ? ' is-warn' : ''}`;
    refs.alertBanner.textContent = header.alertText;
  } else {
    refs.alertBanner.hidden = true;
    refs.alertBanner.textContent = '';
  }

  syncStatusActions(refs, state, header, recheckLabel);

  updateRow(
    refs.primaryRow,
    state.verdict?.primary || null,
    'Primary Workspace',
    'Main',
    activeTarget === 'primary',
    state.isChecking
  );
  updateRow(
    refs.mirrorRow,
    state.verdict?.mirror || null,
    'Backup Workspace',
    'Backup',
    activeTarget === 'mirror',
    state.isChecking
  );

  const ageText = formatAge(state.verdict?.checkedAt);
  refs.checkedMeta.textContent =
    state.verdict?.fromCache && state.verdict.cacheAgeSeconds > 0
      ? `${ageText} · shared check`
      : ageText;

  refs.utilityRecheckBtn.hidden = header.showPrimaryRecheckBtn;
  refs.utilityRecheckBtn.disabled = state.isChecking || state.recheckCooldownSec > 0;
  refs.utilityRecheckBtn.innerHTML = `${ICON_REFRESH}<span>${escapeHtml(recheckLabel)}</span>`;

  if (state.verdict) {
    refs.detailsPanel.hidden = false;
    refs.detailsGrid.innerHTML = `
      <div class="details-card">
        <div class="details-card-title">Primary · ${escapeHtml(describeReasonPlain(state.verdict.primary.reason))}</div>
        <div class="details-mono">HTTP ${state.verdict.primary.status} (${escapeHtml(state.verdict.primary.reason)}) · ${state.verdict.primary.latencyMs} ms</div>
      </div>
      <div class="details-card">
        <div class="details-card-title">Backup · ${escapeHtml(describeReasonPlain(state.verdict.mirror.reason))}</div>
        <div class="details-mono">HTTP ${state.verdict.mirror.status} (${escapeHtml(state.verdict.mirror.reason)}) · ${state.verdict.mirror.latencyMs} ms</div>
      </div>
    `;
  } else {
    refs.detailsPanel.hidden = true;
  }
}
