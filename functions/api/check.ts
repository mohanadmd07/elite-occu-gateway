export interface Env {
  PRIMARY_URL?: string;
  MIRROR_URL?: string;
  PROBE_PATH?: string;
  CACHE_TTL_SECONDS?: string;
  PROBE_TIMEOUT_MS?: string;
}

interface PagesEventContext<E = unknown> {
  request: Request;
  env: E;
  waitUntil: (promise: Promise<unknown>) => void;
}

type PagesFunction<E = unknown> = (context: PagesEventContext<E>) => Response | Promise<Response>;

export interface NodeProbeResult {
  id: 'primary' | 'mirror';
  label: string;
  url: string;
  configured: boolean;
  alive: boolean;
  slow: boolean;
  status: number;
  latencyMs: number;
  reason: string;
  node: string | null;
}

export interface CheckResponsePayload {
  checkedAt: string;
  fromCache: boolean;
  cacheAgeSeconds: number;
  activeTarget: 'primary' | 'mirror' | null;
  primary: NodeProbeResult;
  mirror: NodeProbeResult;
}

function normalizeBaseUrl(raw?: string): string {
  if (!raw) return '';
  return raw.trim().replace(/\/+$/, '');
}

export async function probeDeployment(
  id: 'primary' | 'mirror',
  label: string,
  rawUrl: string | undefined,
  probePath: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<NodeProbeResult> {
  const url = normalizeBaseUrl(rawUrl);
  if (!url) {
    return {
      id,
      label,
      url: '',
      configured: false,
      alive: false,
      slow: false,
      status: 0,
      latencyMs: 0,
      reason: 'not_configured',
      node: null,
    };
  }

  const normalizedPath = probePath.startsWith('/') ? probePath : `/${probePath}`;
  const targetUrl = `${url}${normalizedPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const res = await fetchImpl(targetUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    const latencyMs = Date.now() - startedAt;
    const vercelErr = res.headers.get('x-vercel-error');
    const contentType = res.headers.get('content-type') || '';

    if (res.status !== 200) {
      return {
        id,
        label,
        url,
        configured: true,
        alive: false,
        slow: false,
        status: res.status,
        latencyMs,
        reason: vercelErr || `http_${res.status}`,
        node: null,
      };
    }

    if (!contentType.toLowerCase().includes('application/json')) {
      return {
        id,
        label,
        url,
        configured: true,
        alive: false,
        slow: false,
        status: res.status,
        latencyMs,
        reason: 'non_json_response',
        node: null,
      };
    }

    let body: { ok?: boolean; node?: string } | null = null;
    try {
      body = (await res.json()) as { ok?: boolean; node?: string };
    } catch {
      body = null;
    }

    if (!body || body.ok !== true) {
      return {
        id,
        label,
        url,
        configured: true,
        alive: false,
        slow: false,
        status: res.status,
        latencyMs,
        reason: 'invalid_payload',
        node: null,
      };
    }

    const slow = latencyMs > 2000;
    return {
      id,
      label,
      url,
      configured: true,
      alive: true,
      slow,
      status: 200,
      latencyMs,
      reason: slow ? 'slow' : 'ok',
      node: typeof body.node === 'string' ? body.node : null,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startedAt;
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'));
    return {
      id,
      label,
      url,
      configured: true,
      alive: false,
      slow: false,
      status: 0,
      latencyMs,
      reason: isAbort ? 'timeout' : 'network_error',
      node: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function evaluateTargets(
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<CheckResponsePayload> {
  const probePath = env.PROBE_PATH || '/api/ping';
  const timeoutMs = Math.max(1000, Math.min(9000, Number(env.PROBE_TIMEOUT_MS || '4500') || 4500));

  const [primary, mirror] = await Promise.all([
    probeDeployment('primary', 'Primary Workspace', env.PRIMARY_URL, probePath, timeoutMs, fetchImpl),
    probeDeployment('mirror', 'Backup Workspace', env.MIRROR_URL, probePath, timeoutMs, fetchImpl),
  ]);

  let activeTarget: 'primary' | 'mirror' | null = null;
  if (primary.alive) {
    activeTarget = 'primary';
  } else if (mirror.alive) {
    activeTarget = 'mirror';
  }

  return {
    checkedAt: new Date().toISOString(),
    fromCache: false,
    cacheAgeSeconds: 0,
    activeTarget,
    primary,
    mirror,
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const reqUrl = new URL(request.url);
  const wantFresh = reqUrl.searchParams.get('fresh') === '1';
  const cacheTtl = Math.max(5, Math.min(120, Number(env.CACHE_TTL_SECONDS || '25') || 25));

  const cacheUrl = new URL(reqUrl.origin + reqUrl.pathname);
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const cachedPayload = (await cached.json()) as CheckResponsePayload;
        const checkedMs = Date.parse(cachedPayload.checkedAt);
        const ageSeconds = Number.isFinite(checkedMs)
          ? Math.max(0, Math.round((Date.now() - checkedMs) / 1000))
          : 0;

        // Protect Vercel Fluid CPU: allow manual fresh=1 bypass only after 5s cooldown
        if (!wantFresh || ageSeconds < 5) {
          return Response.json(
            {
              ...cachedPayload,
              fromCache: true,
              cacheAgeSeconds: ageSeconds,
            } satisfies CheckResponsePayload,
            {
              headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
              },
            }
          );
        }
      } catch {
        // Fall through to live probe if cached entry cannot be parsed
      }
    }
  }

  const payload = await evaluateTargets(env);

  if (cache) {
    const toCache = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${cacheTtl}`,
      },
    });
    context.waitUntil(cache.put(cacheKey, toCache));
  }

  return Response.json(payload, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
};
