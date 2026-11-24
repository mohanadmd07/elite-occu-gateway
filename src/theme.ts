import { getCairoSolarSnapshot, SolarSnapshot } from './solar';

export type ThemeMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'elite_hospital_theme_mode';

export function readStoredThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'auto' || saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
  return 'auto';
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore storage errors
  }
}

export function resolveIsDark(mode: ThemeMode, solar: SolarSnapshot): boolean {
  if (mode === 'auto') return !solar.isDaytime;
  return mode === 'dark';
}

export function applyThemeToDom(mode: ThemeMode, now: Date = new Date()): { isDark: boolean; solar: SolarSnapshot } {
  const solar = getCairoSolarSnapshot(now);
  const isDark = resolveIsDark(mode, solar);
  const root = document.documentElement;
  const body = document.body;

  if (isDark) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
    body?.classList.add('dark');
    body?.setAttribute('data-theme', 'dark');
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
    body?.classList.remove('dark');
    body?.setAttribute('data-theme', 'light');
  }

  return { isDark, solar };
}
