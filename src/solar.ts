/**
 * Compact NOAA Solar & Shift Engine for Cairo, Egypt (Hospital Hub Default)
 * Matches src/logic/solar.ts in Hospital-Occupancy-Manager-REV.
 */

export interface SolarSnapshot {
  isDaytime: boolean;
  sunriseFormatted: string;
  sunsetFormatted: string;
  shiftLabel: 'Day Shift' | 'Night Duty';
  shiftHours: '07:00 – 19:00' | '19:00 – 07:00';
  cairoTimeFormatted: string;
  cairoDateFormatted: string;
}

const CAIRO_LAT = 30.0444;
const CAIRO_LON = 31.2357;
const CAIRO_TZ = 'Africa/Cairo';

const degToRad = (deg: number) => (deg * Math.PI) / 180.0;
const radToDeg = (rad: number) => (rad * 180.0) / Math.PI;

function calculateCairoSunTimes(date: Date): { sunrise: Date; sunset: Date } {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const N1 = Math.floor((275 * month) / 9);
  const N2 = Math.floor((month + 9) / 12);
  const N3 = 1 + Math.floor((year - 4 * Math.floor(year / 4) + 2) / 3);
  const dayOfYear = N1 - N2 * N3 + day - 30;
  const lngHour = CAIRO_LON / 15.0;

  const calc = (isSunrise: boolean): Date => {
    const t = isSunrise ? dayOfYear + (6.0 - lngHour) / 24.0 : dayOfYear + (18.0 - lngHour) / 24.0;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(degToRad(M)) + 0.02 * Math.sin(degToRad(2 * M)) + 282.634;
    L = (L + 360) % 360;

    let RA = radToDeg(Math.atan(0.91764 * Math.tan(degToRad(L))));
    RA = (RA + 360) % 360;
    RA = RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90);
    RA = RA / 15.0;

    const sinDec = 0.39782 * Math.sin(degToRad(L));
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH =
      (Math.cos(degToRad(90.833)) - sinDec * Math.sin(degToRad(CAIRO_LAT))) /
      (cosDec * Math.cos(degToRad(CAIRO_LAT)));

    const clamped = Math.max(-1, Math.min(1, cosH));
    const H = isSunrise ? 360.0 - radToDeg(Math.acos(clamped)) : radToDeg(Math.acos(clamped));
    const T = H / 15.0 + RA - 0.06571 * t - 6.622;
    const UT = (T - lngHour + 24) % 24;

    const resDate = new Date(Date.UTC(year, month - 1, day));
    const hours = Math.floor(UT);
    const minutes = Math.floor((UT - hours) * 60);
    const seconds = Math.floor(((UT - hours) * 60 - minutes) * 60);
    resDate.setUTCHours(hours, minutes, seconds, 0);
    return resDate;
  };

  return { sunrise: calc(true), sunset: calc(false) };
}

function formatCairoTime(date: Date): string {
  try {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: CAIRO_TZ,
    });
  } catch {
    return '12:00 PM';
  }
}

function getCairoHour(date: Date): number {
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: CAIRO_TZ,
    }).format(date);
    return Number(hourStr) % 24;
  } catch {
    return date.getHours();
  }
}

export function getCairoSolarSnapshot(now: Date = new Date()): SolarSnapshot {
  const { sunrise, sunset } = calculateCairoSunTimes(now);
  const nowMs = now.getTime();
  const isDaytime = nowMs >= sunrise.getTime() && nowMs < sunset.getTime();

  const cairoHour = getCairoHour(now);
  const isNightShift = cairoHour >= 19 || cairoHour < 7;

  let cairoDateFormatted = '';
  try {
    cairoDateFormatted = now.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: CAIRO_TZ,
    });
  } catch {
    cairoDateFormatted = now.toDateString();
  }

  return {
    isDaytime,
    sunriseFormatted: formatCairoTime(sunrise),
    sunsetFormatted: formatCairoTime(sunset),
    shiftLabel: isNightShift ? 'Night Duty' : 'Day Shift',
    shiftHours: isNightShift ? '19:00 – 07:00' : '07:00 – 19:00',
    cairoTimeFormatted: formatCairoTime(now),
    cairoDateFormatted,
  };
}
