import { describe, expect, it, beforeEach } from 'vitest';
import { getCairoSolarSnapshot } from '../solar';
import { markRedirectTimestamp, resolvePhaseFromCheck, shouldAutoRedirect } from '../healthClient';
import type { CheckResponsePayload } from '../../functions/api/check';

const baseVerdict = (primaryAlive: boolean, mirrorAlive: boolean): CheckResponsePayload => ({
  checkedAt: '2026-11-25T10:00:00.000Z',
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
    latencyMs: 120,
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
    latencyMs: 180,
    reason: mirrorAlive ? 'ok' : 'http_503',
    node: mirrorAlive ? 'mirror' : null,
  },
});

describe('shouldAutoRedirect', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('disables auto-redirect when ?stay=1 or ?status is present', () => {
    expect(shouldAutoRedirect('?stay=1', 100_000)).toBe(false);
    expect(shouldAutoRedirect('?status', 100_000)).toBe(false);
    expect(shouldAutoRedirect('', 100_000)).toBe(true);
  });

  it('pauses auto-redirect if user bounced back within 10 seconds', () => {
    markRedirectTimestamp(100_000);
    expect(shouldAutoRedirect('', 105_000)).toBe(false);
    expect(shouldAutoRedirect('', 112_000)).toBe(true);
  });
});

describe('resolvePhaseFromCheck', () => {
  it('routes to primary with short grace delay when primary is alive', () => {
    const res = resolvePhaseFromCheck(baseVerdict(true, true), true);
    expect(res.phase).toBe('redirecting_primary');
    expect(res.targetUrl).toBe('https://primary.example');
    expect(res.delayMs).toBe(450);
  });

  it('fails over to mirror with readable delay when primary is down', () => {
    const res = resolvePhaseFromCheck(baseVerdict(false, true), true);
    expect(res.phase).toBe('redirecting_mirror');
    expect(res.targetUrl).toBe('https://mirror.example');
    expect(res.delayMs).toBe(6000);
  });

  it('stays paused when auto-redirect is disabled', () => {
    const res = resolvePhaseFromCheck(baseVerdict(false, true), false);
    expect(res.phase).toBe('paused');
    expect(res.targetUrl).toBe('https://mirror.example');
  });

  it('enters outage phase when both are unavailable', () => {
    const res = resolvePhaseFromCheck(baseVerdict(false, false), true);
    expect(res.phase).toBe('outage');
    expect(res.targetUrl).toBeNull();
  });
});

describe('getCairoSolarSnapshot', () => {
  it('detects Cairo daytime and Day Shift accurately', () => {
    // 10:00 UTC = 12:00 Cairo (noon, Day Shift)
    const noonCairo = new Date('2026-11-25T10:00:00.000Z');
    const snap = getCairoSolarSnapshot(noonCairo);
    expect(snap.isDaytime).toBe(true);
    expect(snap.shiftLabel).toBe('Day Shift');
    expect(snap.shiftHours).toBe('07:00 – 19:00');
  });

  it('detects Cairo nighttime and Night Duty accurately', () => {
    // 20:00 UTC = 22:00 Cairo (night, Night Duty)
    const nightCairo = new Date('2026-11-25T20:00:00.000Z');
    const snap = getCairoSolarSnapshot(nightCairo);
    expect(snap.isDaytime).toBe(false);
    expect(snap.shiftLabel).toBe('Night Duty');
    expect(snap.shiftHours).toBe('19:00 – 07:00');
  });
});
