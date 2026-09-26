import { describe, expect, it } from 'vitest';
import { normalizeSetting } from '../../src/ui/settings/normalize-setting';

describe('normalizeSetting', () => {
  it('clamps integer settings and falls back on invalid input', () => {
    expect(normalizeSetting('goldenMinIntervalMs', '300')).toBe(300);
    expect(normalizeSetting('goldenMinIntervalMs', '99999')).toBe(5000);
    expect(normalizeSetting('goldenMinIntervalMs', 'not a number')).toBe(200);
  });

  it('treats an empty string as "use the default", not 0, for fields that check raw !== ""', () => {
    expect(normalizeSetting('goldenMinFadeCurve', '')).toBe(0.55);
    expect(normalizeSetting('goldenMinFadeCurve', '0')).toBe(0);
    expect(normalizeSetting('panicFactor', '')).toBe(0.2);
  });

  it('falls back to a default for falsy (0 or NaN) values on fields using `value || default`', () => {
    expect(normalizeSetting('clickFrenzyCps', '0')).toBe(8);
    expect(normalizeSetting('idleSpeedPxPerSec', '0')).toBe(320);
    expect(normalizeSetting('clickFrenzyCps', '25')).toBe(25);
  });

  it('clamps to the documented range for every ranged setting', () => {
    expect(normalizeSetting('autoHammerMinShare', '5000')).toBe(1000);
    expect(normalizeSetting('autoProbeSec', '1')).toBe(2); // min 2
    expect(normalizeSetting('autoWizardTowerTarget', '9999')).toBe(500); // max 500
    expect(normalizeSetting('autoWizardTowerTarget', '0')).toBe(0);
    expect(normalizeSetting('autoWizardTowerTarget', '')).toBe(57);
    expect(normalizeSetting('hammerStepPx', '999')).toBe(60);
    expect(normalizeSetting('chartHours', '4')).toBe(6); // min 6
    expect(normalizeSetting('retentionDays', '0')).toBe(1); // min 1
    expect(normalizeSetting('logLimit', '10')).toBe(100); // min 100
    expect(normalizeSetting('frameOpacity', '0.01')).toBe(0.1); // min 0.1
    expect(normalizeSetting('frameOpacity', '5')).toBe(1); // max 1
    expect(normalizeSetting('frameOpacity', '')).toBe(0.95);
    expect(normalizeSetting('overlayOpacity', '0.01')).toBe(0.1); // min 0.1
    expect(normalizeSetting('overlayOpacity', '')).toBe(1);
  });

  it('passes unknown keys through as a plain number', () => {
    expect(normalizeSetting('someUnknownKey', '42')).toBe(42);
  });
});
