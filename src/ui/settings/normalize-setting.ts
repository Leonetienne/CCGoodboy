import { clamp, clampInt } from '../../core/constants';

/** Validates and clamps one setting typed into the UI (the ranges match the input elements'
 * min/max in panel-dom.ts). */
export function normalizeSetting(key: string, raw: string): number {
  const value = Number(raw);

  switch (key) {
    case 'goldenMinIntervalMs':
      return clampInt(value, 0, 5000, 200);

    case 'preClickDelayMs':
      return clampInt(value, 0, 2000, 100);

    case 'goldenMinFadeCurve':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 0, 1) : 0.55;

    case 'clickFrenzyCps':
      return clamp(value || 8, 0.2, 50);

    case 'clickFrenzyJitterMs':
      return clamp(value || 0, 0, 250);

    case 'cursorSpeedPxPerSec':
      return clamp(value || 4200, 500, 20000);

    case 'autoHammerMinShare':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 0, 1000) : 0.05;

    case 'autoProbeIntervalSec':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 0, 86400) : 300;

    case 'autoProbeSec':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 2, 120) : 10;

    case 'autoInsignificantSec':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 0, 3600) : 1;

    case 'autoGoodFactor':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 1, 10) : 1.2;

    case 'autoBiggerImpact':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 1, 100) : 3;

    case 'autoReachSec':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 0, 86400) : 1800;

    case 'autoMaxPaybackSec':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 60, 10000000) : 86400;

    case 'autoReserveSec':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 0, 1000000) : 0;

    case 'autoWizardTowerTarget':
      return Number.isFinite(value) && raw !== '' ? clampInt(value, 0, 500, 57) : 57;

    case 'panicFactor':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 0.01, 1) : 0.2;

    case 'hammerStepPx':
      return Number.isFinite(value) && raw !== '' ? clamp(value, 0, 60) : 3;

    case 'happyDanceMs':
      return clampInt(value, 0, 10000, 2200);

    case 'idleSpeedPxPerSec':
      return clamp(value || 320, 60, 2000);

    case 'chartHours':
      return clampInt(value, 6, 720, 48);

    case 'retentionDays':
      return clampInt(value, 1, 365, 30);

    case 'logLimit':
      return clampInt(value, 100, 50000, 10000);

    default:
      return value;
  }
}
