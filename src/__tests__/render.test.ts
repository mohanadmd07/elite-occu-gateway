import { describe, expect, it, vi } from 'vitest';
import { renderGateway, RenderHandlers, RenderState } from '../render';
import { getCairoSolarSnapshot } from '../solar';
import type { CheckResponsePayload } from '../../functions/api/check';

const makeVerdict = (primaryAlive: boolean, mirrorAlive: boolean): CheckResponsePayload => ({
  checkedAt: new Date().toISOString(),
  fromCache: false,
  cacheAgeSeconds: 0,
  activeTarget: primaryAlive ? 'primary' : mirrorAlive ? 'mirror' : null,
  primary: {
    id: 'primary',
    label: 'Primary Workspace',
    url: 'https://primary.example',
    configured: true,
    alive: primaryAlive,
    slow: false,
    status: primaryAlive ? 200 : 402,
    latencyMs: 110,
    reason: primaryAlive ? 'ok' : 'DEPLOYMENT_PAUSED',
    node: primaryAlive ? 'primary' : null,
  },
  mirror: {
    id: 'mirror',
    label: 'Backup Workspace',
    url: 'https://mirror.example',
    configured: true,
    alive: mirrorAlive,
    slow: false,
    status: mirrorAlive ? 200 : 503,
    latencyMs: 165,
    reason: mirrorAlive ? 'ok' : 'http_503',
    node: mirrorAlive ? 'mirror' : null,
  },
});

const makeHandlers = (): RenderHandlers => ({
  onStayHere: vi.fn(),
  onRecheck: vi.fn(),
  onCycleTheme: vi.fn(),
  onOpenNode: vi.fn(),
});

const makeState = (overrides: Partial<RenderState> = {}): RenderState => ({
  phase: 'paused',
  verdict: makeVerdict(true, true),
  solar: getCairoSolarSnapshot(new Date('2026-11-25T10:00:00.000Z')),
  themeMode: 'auto',
  isDark: false,
  recheckCooldownSec: 0,
  redirectCountdownSec: 0,
  isChecking: false,
  errorMessage: null,
  ...overrides,
});

describe('renderGateway', () => {
  it('preserves open <details> state across subsequent re-renders', () => {
    const root = document.createElement('div');
    const handlers = makeHandlers();

    renderGateway(root, makeState(), handlers);
    const details = root.querySelector<HTMLDetailsElement>('.details-panel')!;
    details.open = true;

    renderGateway(root, makeState({ recheckCooldownSec: 4 }), handlers);
    expect(root.querySelector<HTMLDetailsElement>('.details-panel')?.open).toBe(true);
  });

  it('shows only one visible Check again button in outage and offline states', () => {
    const root = document.createElement('div');
    const handlers = makeHandlers();

    renderGateway(
      root,
      makeState({
        phase: 'outage',
        verdict: makeVerdict(false, false),
        errorMessage: 'Neither server responded.',
      }),
      handlers
    );

    const visibleRecheckButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter(
      (btn) => !btn.hidden && btn.textContent?.includes('Check again')
    );
    expect(visibleRecheckButtons).toHaveLength(1);
  });

  it('renders live backup countdown and Open backup now CTA during mirror failover', () => {
    const root = document.createElement('div');
    const handlers = makeHandlers();

    renderGateway(
      root,
      makeState({
        phase: 'redirecting_mirror',
        verdict: makeVerdict(false, true),
        redirectCountdownSec: 5,
      }),
      handlers
    );

    expect(root.querySelector('.status-heading')?.textContent).toBe('Switching to backup server in 5s');
    const openBackupBtn = root.querySelector<HTMLButtonElement>('[data-status-action="open-backup"]')!;
    expect(openBackupBtn).not.toBeNull();
    openBackupBtn.click();
    expect(handlers.onOpenNode).toHaveBeenCalledWith('https://mirror.example');
  });

  it('scopes aria-live="polite" to the status section rather than the outer frame', () => {
    const root = document.createElement('div');
    renderGateway(root, makeState(), makeHandlers());

    expect(root.querySelector('.registry-frame')?.hasAttribute('aria-live')).toBe(false);
    expect(root.querySelector('.status-section')?.getAttribute('aria-live')).toBe('polite');
  });
});
