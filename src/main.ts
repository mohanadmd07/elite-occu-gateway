import './styles.css';
import {
  fetchGatewayStatus,
  markRedirectTimestamp,
  resolvePhaseFromCheck,
  shouldAutoRedirect,
} from './healthClient';
import { renderGateway, RenderState } from './render';
import { applyThemeToDom, readStoredThemeMode, saveThemeMode, ThemeMode } from './theme';

const rootEl = document.getElementById('app');
if (!rootEl) {
  throw new Error('Gateway root element #app not found');
}
const appRoot: HTMLElement = rootEl;

let themeMode: ThemeMode = readStoredThemeMode();
let { isDark, solar } = applyThemeToDom(themeMode);
let autoRedirectEnabled = shouldAutoRedirect(window.location.search);
let redirectTimer: number | null = null;
let cooldownTimer: number | null = null;

const state: RenderState = {
  phase: 'checking',
  verdict: null,
  solar,
  themeMode,
  isDark,
  recheckCooldownSec: 0,
  isChecking: true,
  errorMessage: null,
};

function clearRedirectTimer(): void {
  if (redirectTimer !== null) {
    window.clearTimeout(redirectTimer);
    redirectTimer = null;
  }
}

function navigateToWorkspace(url: string): void {
  clearRedirectTimer();
  markRedirectTimestamp();
  window.location.replace(url);
}

function startCooldown(seconds: number): void {
  if (cooldownTimer !== null) {
    window.clearInterval(cooldownTimer);
  }
  state.recheckCooldownSec = seconds;
  cooldownTimer = window.setInterval(() => {
    state.recheckCooldownSec = Math.max(0, state.recheckCooldownSec - 1);
    if (state.recheckCooldownSec === 0 && cooldownTimer !== null) {
      window.clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
    paint();
  }, 1000);
}

function paint(): void {
  renderGateway(appRoot, state, {
    onStayHere: () => {
      autoRedirectEnabled = false;
      clearRedirectTimer();
      state.phase = state.verdict?.activeTarget ? 'paused' : state.phase;
      paint();
    },
    onRecheck: () => {
      if (state.isChecking || state.recheckCooldownSec > 0) return;
      void runCheck(true);
    },
    onCycleTheme: () => {
      const order: ThemeMode[] = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(state.themeMode) + 1) % order.length];
      state.themeMode = next;
      saveThemeMode(next);
      const applied = applyThemeToDom(next);
      state.isDark = applied.isDark;
      state.solar = applied.solar;
      paint();
    },
    onOpenNode: (url: string) => {
      navigateToWorkspace(url);
    },
  });
}

async function runCheck(isManual: boolean): Promise<void> {
  clearRedirectTimer();
  state.isChecking = true;
  state.errorMessage = null;
  if (!isManual) {
    state.phase = 'checking';
  }
  paint();

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    state.isChecking = false;
    state.phase = 'offline';
    state.errorMessage = 'Your device is currently offline.';
    paint();
    return;
  }

  try {
    const verdict = await fetchGatewayStatus(isManual);
    state.verdict = verdict;
    state.isChecking = false;

    const resolution = resolvePhaseFromCheck(verdict, autoRedirectEnabled);
    state.phase = resolution.phase;
    paint();

    if (isManual) {
      startCooldown(5);
    }

    if (
      autoRedirectEnabled &&
      resolution.targetUrl &&
      (resolution.phase === 'redirecting_primary' || resolution.phase === 'redirecting_mirror')
    ) {
      redirectTimer = window.setTimeout(() => {
        if (autoRedirectEnabled && resolution.targetUrl) {
          navigateToWorkspace(resolution.targetUrl);
        }
      }, resolution.delayMs);
    }
  } catch (err: unknown) {
    state.isChecking = false;
    state.phase = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'outage';
    state.errorMessage = err instanceof Error ? err.message : 'Unable to reach status check service.';
    paint();
    if (isManual) {
      startCooldown(5);
    }
  }
}

window.setInterval(() => {
  const applied = applyThemeToDom(state.themeMode);
  state.isDark = applied.isDark;
  state.solar = applied.solar;
  paint();
}, 30_000);

window.addEventListener('online', () => {
  if (state.phase === 'offline') {
    void runCheck(true);
  }
});

window.addEventListener('offline', () => {
  clearRedirectTimer();
  state.phase = 'offline';
  state.errorMessage = 'Network connection lost.';
  paint();
});

paint();
void runCheck(false);
