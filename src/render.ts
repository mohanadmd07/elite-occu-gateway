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
  isChecking: boolean;
  errorMessage: string | null;
}

export interface RenderHandlers {
  onStayHere: () => void;
  onRecheck: () => void;
  onCycleTheme: () => void;
  onOpenNode: (url: string) => void;
}

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
  if (!Number.isFinite(ms)) return 'Just now';
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 5) return 'Checked just now';
  if (sec < 60) return `Checked ${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `Checked ${min}m ago`;
}

function describeNodeStatus(node: NodeProbeResult | null, isChecking: boolean): {
  dotClass: string;
  labelClass: string;
  text: string;
} {
  if (isChecking && !node) {
    return { dotClass: '', labelClass: '', text: 'Checking…' };
  }
  if (!node || !node.configured) {
    return { dotClass: '', labelClass: '', text: 'Not configured' };
  }
  if (node.alive) {
    const latency = node.latencyMs > 0 ? ` · ${node.latencyMs} ms` : '';
    return node.slow
      ? { dotClass: 'slow', labelClass: 'slow', text: `Slow${latency}` }
      : { dotClass: 'ok', labelClass: 'ok', text: `Available${latency}` };
  }
  return { dotClass: 'down', labelClass: 'down', text: 'Unavailable' };
}

function getHeaderCopy(state: RenderState): {
  eyebrow: string;
  heading: string;
  copy: string;
  showProgress: boolean;
  showStayBtn: boolean;
  alertType: 'none' | 'warn' | 'down';
  alertText: string;
} {
  switch (state.phase) {
    case 'checking':
      return {
        eyebrow: 'Server Check',
        heading: 'Opening Elite Occupancy Manager',
        copy: 'Checking which workspace server is ready…',
        showProgress: true,
        showStayBtn: true,
        alertType: 'none',
        alertText: '',
      };
    case 'redirecting_primary':
      return {
        eyebrow: 'Ready',
        heading: 'Primary workspace is ready',
        copy: 'Opening the main hospital dashboard now.',
        showProgress: true,
        showStayBtn: true,
        alertType: 'none',
        alertText: '',
      };
    case 'redirecting_mirror':
      return {
        eyebrow: 'Automatic Backup',
        heading: 'Switching to the backup workspace',
        copy: 'The primary server is temporarily unavailable. Opening the mirror with the same live hospital database.',
        showProgress: true,
        showStayBtn: true,
        alertType: 'warn',
        alertText: 'Primary server paused or busy — redirecting to Backup Workspace.',
      };
    case 'paused':
      return {
        eyebrow: 'Workspace Directory',
        heading: 'Choose a workspace server',
        copy: 'Auto-redirect is paused. Open any available server below to sign in.',
        showProgress: false,
        showStayBtn: false,
        alertType: 'none',
        alertText: '',
      };
    case 'offline':
      return {
        eyebrow: 'Connection Lost',
        heading: 'Your device is offline',
        copy: 'Reconnect to the hospital network, then check again.',
        showProgress: false,
        showStayBtn: false,
        alertType: 'down',
        alertText: state.errorMessage || 'No network connection detected.',
      };
    case 'outage':
      return {
        eyebrow: 'Service Notice',
        heading: 'Both workspace servers are unavailable',
        copy: 'Hospital records in the database are unaffected. Wait a moment and check again, or contact Dr. Mohand El Ma’moun.',
        showProgress: false,
        showStayBtn: false,
        alertType: 'down',
        alertText: state.errorMessage || 'Neither server responded in time.',
      };
  }
}

function renderNodeRow(
  node: NodeProbeResult | null,
  fallbackTitle: string,
  roleTag: string,
  isRecommended: boolean,
  isChecking: boolean
): string {
  const status = describeNodeStatus(node, isChecking);
  const url = node?.url || '';
  const canOpen = Boolean(node?.alive && url);

  return `
    <div class="ledger-row ${isRecommended ? 'is-recommended' : ''}">
      <div class="ledger-info">
        <div class="ledger-title-line">
          <span class="status-dot ${status.dotClass}" aria-hidden="true"></span>
          <span class="ledger-name">${escapeHtml(node?.label || fallbackTitle)}</span>
          <span class="role-tag">${escapeHtml(roleTag)}</span>
        </div>
        <div class="ledger-meta">
          <span class="status-label ${status.labelClass}">${escapeHtml(status.text)}</span>
          <span aria-hidden="true">·</span>
          <span class="ledger-url">${escapeHtml(formatHost(url))}</span>
        </div>
      </div>
      <div class="ledger-action">
        ${
          canOpen
            ? `<button type="button" class="btn ${isRecommended ? 'btn-primary' : 'btn-secondary'}" data-open-url="${escapeHtml(url)}">Open workspace →</button>`
            : `<button type="button" class="btn btn-secondary" disabled>${node?.configured ? 'Unavailable' : 'Not set'}</button>`
        }
      </div>
    </div>
  `;
}

export function renderGateway(root: HTMLElement, state: RenderState, handlers: RenderHandlers): void {
  const header = getHeaderCopy(state);
  const activeTarget = state.verdict?.activeTarget || null;
  const themeLabel =
    state.themeMode === 'auto'
      ? `Auto · ${state.isDark ? 'Night' : 'Day'}`
      : state.themeMode === 'dark'
      ? 'Dark'
      : 'Light';

  const recheckLabel = state.isChecking
    ? 'Checking…'
    : state.recheckCooldownSec > 0
    ? `Wait ${state.recheckCooldownSec}s`
    : 'Check again';

  root.innerHTML = `
    <section class="registry-frame" aria-live="polite">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-logo-box">
            <img src="/elite_logo.png" alt="Elite Hospital Logo" width="30" height="30" />
          </div>
          <div class="brand-text">
            <h1 class="brand-title">Elite Hospital Occupancy Manager</h1>
            <p class="brand-subtitle">Workspace Access</p>
          </div>
        </div>
        <div class="topbar-meta">
          <span class="shift-pill tabular-nums" title="Cairo local time &amp; clinical shift">
            Cairo · ${escapeHtml(state.solar.cairoTimeFormatted)} · ${escapeHtml(state.solar.shiftLabel)}
          </span>
          <button
            type="button"
            class="theme-btn"
            data-action="cycle-theme"
            aria-label="Switch theme mode (currently ${escapeHtml(themeLabel)})"
          >
            ${escapeHtml(themeLabel)}
          </button>
        </div>
      </header>

      <div class="status-section">
        <div class="status-eyebrow">${escapeHtml(header.eyebrow)}</div>
        <h2 class="status-heading">${escapeHtml(header.heading)}</h2>
        <p class="status-copy">${escapeHtml(header.copy)}</p>

        ${
          header.showProgress
            ? `<div class="progress-track" role="progressbar" aria-label="Checking workspace status"><div class="progress-bar"></div></div>`
            : ''
        }

        ${
          header.alertType !== 'none'
            ? `<div class="alert-banner ${header.alertType === 'warn' ? 'is-warn' : ''}" role="alert">${escapeHtml(header.alertText)}</div>`
            : ''
        }

        ${
          header.showStayBtn || state.phase === 'outage' || state.phase === 'offline'
            ? `<div class="status-actions">
                ${
                  header.showStayBtn
                    ? `<button type="button" class="btn btn-secondary" data-action="stay">Stay on this page</button>`
                    : `<button type="button" class="btn btn-primary" data-action="recheck" ${state.isChecking || state.recheckCooldownSec > 0 ? 'disabled' : ''}>${escapeHtml(recheckLabel)}</button>`
                }
              </div>`
            : ''
        }
      </div>

      <div class="ledger-section" aria-label="Workspace Servers">
        <div class="ledger-header">
          <span>Workspace Server</span>
          <span>Status</span>
        </div>
        ${renderNodeRow(
          state.verdict?.primary || null,
          'Primary Workspace',
          'Main',
          activeTarget === 'primary',
          state.isChecking
        )}
        ${renderNodeRow(
          state.verdict?.mirror || null,
          'Backup Workspace',
          'Mirror',
          activeTarget === 'mirror',
          state.isChecking
        )}
      </div>

      <div class="utility-bar">
        <span class="checked-meta tabular-nums">
          ${escapeHtml(formatAge(state.verdict?.checkedAt))}${state.verdict?.fromCache ? ' (cached)' : ''}
        </span>
        <button
          type="button"
          class="btn btn-secondary"
          data-action="recheck"
          ${state.isChecking || state.recheckCooldownSec > 0 ? 'disabled' : ''}
        >
          ${escapeHtml(recheckLabel)}
        </button>
      </div>

      ${
        state.verdict
          ? `<details class="details-panel">
              <summary>Connection details</summary>
              <div class="details-grid">
                <div class="details-card">
                  <strong>Primary:</strong> HTTP ${state.verdict.primary.status} (${escapeHtml(state.verdict.primary.reason)})<br />
                  Latency: ${state.verdict.primary.latencyMs} ms
                </div>
                <div class="details-card">
                  <strong>Mirror:</strong> HTTP ${state.verdict.mirror.status} (${escapeHtml(state.verdict.mirror.reason)})<br />
                  Latency: ${state.verdict.mirror.latencyMs} ms
                </div>
              </div>
            </details>`
          : ''
      }
    </section>

    <footer class="footer-note">
      All rights reserved to Dr. Mohand El Ma'moun — Duty Manager · Elite Hospital Management Systems
    </footer>
  `;

  root.querySelector('[data-action="stay"]')?.addEventListener('click', handlers.onStayHere);
  root.querySelector('[data-action="cycle-theme"]')?.addEventListener('click', handlers.onCycleTheme);
  root.querySelectorAll('[data-action="recheck"]').forEach((el) => {
    el.addEventListener('click', handlers.onRecheck);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-open-url]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = el.getAttribute('data-open-url');
      if (target) handlers.onOpenNode(target);
    });
  });
}
