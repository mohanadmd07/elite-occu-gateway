import { describe, expect, it } from 'vitest';
import { evaluateTargets, probeDeployment } from '../../functions/api/check';

describe('probeDeployment', () => {
  it('returns not_configured when URL is empty', async () => {
    const res = await probeDeployment('mirror', 'Backup Workspace', '', '/api/ping', 4500);
    expect(res.configured).toBe(false);
    expect(res.alive).toBe(false);
    expect(res.reason).toBe('not_configured');
  });

  it('marks deployment alive when 200 JSON { ok: true } is returned', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ ok: true, node: 'primary', ts: 1234 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const res = await probeDeployment(
      'primary',
      'Primary Workspace',
      'https://elite-occu.vercel.app/',
      '/api/ping',
      4500,
      mockFetch as typeof fetch
    );

    expect(res.alive).toBe(true);
    expect(res.status).toBe(200);
    expect(res.node).toBe('primary');
    expect(res.url).toBe('https://elite-occu.vercel.app');
  });

  it('rejects HTML 200 error pages as non_json_response', async () => {
    const mockFetch = async () =>
      new Response('<html><body>Paused</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const res = await probeDeployment(
      'primary',
      'Primary Workspace',
      'https://elite-occu.vercel.app',
      '/api/ping',
      4500,
      mockFetch as typeof fetch
    );

    expect(res.alive).toBe(false);
    expect(res.reason).toBe('non_json_response');
  });

  it('captures Vercel pause / quota HTTP errors and x-vercel-error header', async () => {
    const mockFetch = async () =>
      new Response('Payment Required', {
        status: 402,
        headers: { 'x-vercel-error': 'DEPLOYMENT_PAUSED' },
      });

    const res = await probeDeployment(
      'primary',
      'Primary Workspace',
      'https://elite-occu.vercel.app',
      '/api/ping',
      4500,
      mockFetch as typeof fetch
    );

    expect(res.alive).toBe(false);
    expect(res.status).toBe(402);
    expect(res.reason).toBe('DEPLOYMENT_PAUSED');
  });

  it('handles aborted timeouts cleanly', async () => {
    const mockFetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };

    const res = await probeDeployment(
      'primary',
      'Primary Workspace',
      'https://elite-occu.vercel.app',
      '/api/ping',
      1000,
      mockFetch as typeof fetch
    );

    expect(res.alive).toBe(false);
    expect(res.reason).toBe('timeout');
  });
});

describe('evaluateTargets', () => {
  it('selects mirror when primary is down and mirror is healthy', async () => {
    const mockFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://primary.example')) {
        return new Response('Paused', { status: 503, headers: { 'x-vercel-error': 'FUNCTION_THROTTLED' } });
      }
      return new Response(JSON.stringify({ ok: true, node: 'mirror' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const verdict = await evaluateTargets(
      {
        PRIMARY_URL: 'https://primary.example',
        MIRROR_URL: 'https://mirror.example',
      },
      mockFetch as typeof fetch
    );

    expect(verdict.activeTarget).toBe('mirror');
    expect(verdict.primary.alive).toBe(false);
    expect(verdict.mirror.alive).toBe(true);
  });

  it('returns activeTarget null when both deployments are unavailable', async () => {
    const mockFetch = async () => new Response('Down', { status: 503 });

    const verdict = await evaluateTargets(
      {
        PRIMARY_URL: 'https://primary.example',
        MIRROR_URL: 'https://mirror.example',
      },
      mockFetch as typeof fetch
    );

    expect(verdict.activeTarget).toBeNull();
  });
});
