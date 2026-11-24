import type { CheckResponsePayload } from '../functions/api/check';

export type GatewayPhase =
  | 'checking'
  | 'redirecting_primary'
  | 'redirecting_mirror'
  | 'paused'
  | 'outage'
  | 'offline';

const REDIRECT_STAMP_KEY = 'elite_gateway_last_redirect_ms';
const BACK_BOUNCE_WINDOW_MS = 10_000;

export function shouldAutoRedirect(search: string, nowMs: number = Date.now()): boolean {
  const params = new URLSearchParams(search);
  if (params.get('stay') === '1' || params.has('status')) {
    return false;
  }

  try {
    const raw = sessionStorage.getItem(REDIRECT_STAMP_KEY);
    if (raw) {
      const last = Number(raw);
      if (Number.isFinite(last) && nowMs - last < BACK_BOUNCE_WINDOW_MS) {
        return false;
      }
    }
  } catch {
    // Ignore sessionStorage restrictions
  }

  return true;
}

export function markRedirectTimestamp(nowMs: number = Date.now()): void {
  try {
    sessionStorage.setItem(REDIRECT_STAMP_KEY, String(nowMs));
  } catch {
    // Ignore
  }
}

export function resolvePhaseFromCheck(
  verdict: CheckResponsePayload,
  autoRedirectEnabled: boolean
): { phase: GatewayPhase; targetUrl: string | null; delayMs: number } {
  if (verdict.activeTarget === 'primary' && verdict.primary.url) {
    return {
      phase: autoRedirectEnabled ? 'redirecting_primary' : 'paused',
      targetUrl: verdict.primary.url,
      delayMs: 450,
    };
  }

  if (verdict.activeTarget === 'mirror' && verdict.mirror.url) {
    return {
      phase: autoRedirectEnabled ? 'redirecting_mirror' : 'paused',
      targetUrl: verdict.mirror.url,
      delayMs: 1100,
    };
  }

  return {
    phase: 'outage',
    targetUrl: null,
    delayMs: 0,
  };
}

export async function fetchGatewayStatus(fresh: boolean = false): Promise<CheckResponsePayload> {
  const endpoint = fresh ? '/api/check?fresh=1' : '/api/check';
  const res = await fetch(endpoint, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Status check returned HTTP ${res.status}`);
  }

  return (await res.json()) as CheckResponsePayload;
}
