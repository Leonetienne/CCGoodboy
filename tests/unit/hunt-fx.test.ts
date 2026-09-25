import { describe, expect, it } from 'vitest';
import {
  HUNT_FX_COMBO_RESET_MS,
  HUNT_FX_MAX_EVENTS,
  HUNT_FX_MAX_PARTICLES,
  HuntFx,
  approachScale,
  buffMultiplier,
  multiplierText,
  comboHue,
  judgementText,
  pushHuntFxEvent,
  type HuntFxEvent,
} from '../../src/rendering/hunt-fx';

function ev(kind: 'catch' | 'miss', t: number, extra: Partial<HuntFxEvent> = {}): HuntFxEvent {
  return { kind, x: 100, y: 100, label: 'Lucky', reindeer: false, small: false, t, ...extra };
}

describe('approachScale (FX-2)', () => {
  it('starts at 3.5x when the cookie became ready and closes to 1x at the planned click', () => {
    expect(approachScale(1000, 500, 1000)).toBeCloseTo(3.5);
    expect(approachScale(1000, 500, 1250)).toBeCloseTo(2.25);
    expect(approachScale(1000, 500, 1500)).toBeCloseTo(1);
    expect(approachScale(1000, 500, 9000)).toBe(1);
  });

  it('is 1 with no lead time', () => {
    expect(approachScale(1000, 0, 1000)).toBe(1);
  });
});

describe('judgementText (FX-3)', () => {
  it('shouts the effect name, louder for the big ones', () => {
    expect(judgementText('Lucky', false)).toBe('LUCKY!!');
    expect(judgementText('Click Frenzy', false)).toBe('CLICK FRENZY!!!');
    expect(judgementText('Cookie Storm Drop', false)).toBe('COOKIE STORM DROP!!');
  });

  it('says ho ho ho for a reindeer and gewd for an unknown effect', () => {
    expect(judgementText('Reindeer', true)).toBe('HO HO HO!!');
    expect(judgementText('Unknown', false)).toBe('GEWD!!');
    expect(judgementText('', false)).toBe('GEWD!!');
  });
});

describe('buffMultiplier (FX-4)', () => {
  it('is 1 without buffs', () => {
    expect(buffMultiplier({})).toBe(1);
    expect(buffMultiplier(null)).toBe(1);
  });

  it('is 7 during a Frenzy and multiplies every buff together', () => {
    expect(buffMultiplier({ Frenzy: { multCpS: 7 } })).toBe(7);
    expect(buffMultiplier({ Frenzy: { multCpS: 7 }, 'High-five': { multCpS: 10 }, 'Click frenzy': { multClick: 777 } })).toBe(70);
  });

  it('counts debuffs (Clot) and skips buffs without a CpS multiplier', () => {
    expect(buffMultiplier({ Clot: { multCpS: 0.5 }, x: { multCpS: 0 }, y: {} })).toBe(0.5);
  });
});

describe('multiplierText', () => {
  it('reads like the counter', () => {
    expect(multiplierText(7)).toBe('7x');
    expect(multiplierText(0.5)).toBe('0.5x');
    expect(multiplierText(1666)).toBe('1,666x');
    expect(multiplierText(2.3456)).toBe('2.35x');
  });
});

describe('comboHue', () => {
  it('cycles through the four combo colours', () => {
    expect(comboHue(0)).toBe(comboHue(4));
    expect(comboHue(1)).not.toBe(comboHue(0));
    expect(comboHue(-1)).toBe(comboHue(3));
  });
});

describe('pushHuntFxEvent', () => {
  it('keeps at most HUNT_FX_MAX_EVENTS, dropping the oldest', () => {
    const q: HuntFxEvent[] = [];
    for (let i = 0; i < HUNT_FX_MAX_EVENTS + 5; i++) pushHuntFxEvent(q, ev('catch', i));

    expect(q).toHaveLength(HUNT_FX_MAX_EVENTS);
    expect(q[0]!.t).toBe(5);
  });
});

describe('HuntFx combo (FX-4)', () => {
  it('counts catches and breaks the combo on a miss', () => {
    const fx = new HuntFx();
    const q: HuntFxEvent[] = [];

    pushHuntFxEvent(q, ev('catch', 1000));
    pushHuntFxEvent(q, ev('catch', 1000));
    pushHuntFxEvent(q, ev('catch', 1000));
    fx.consume(q, 1000);

    expect(q).toHaveLength(0);
    expect(fx.combo).toBe(3);

    pushHuntFxEvent(q, ev('miss', 1100));
    fx.consume(q, 1100);

    expect(fx.combo).toBe(0);
    expect(fx.maxCombo).toBe(3);
  });

  it('starts over after a long pause without catches', () => {
    const fx = new HuntFx();
    const q: HuntFxEvent[] = [];

    pushHuntFxEvent(q, ev('catch', 1000));
    fx.consume(q, 1000);

    const later = 1000 + HUNT_FX_COMBO_RESET_MS + 1;
    pushHuntFxEvent(q, ev('catch', later));
    fx.consume(q, later);

    expect(fx.combo).toBe(1);
  });

  it('drops stale events (a background tab coming back) without a show', () => {
    const fx = new HuntFx();
    const q: HuntFxEvent[] = [];

    pushHuntFxEvent(q, ev('catch', 1000));
    fx.consume(q, 5000);

    expect(fx.combo).toBe(0);
    expect(fx.particleCount).toBe(0);
    expect(q).toHaveLength(0);
  });
});

describe('HuntFx particles (FX-7)', () => {
  it('never keeps more than HUNT_FX_MAX_PARTICLES and lets them die out', () => {
    const fx = new HuntFx();
    const q: HuntFxEvent[] = [];

    for (let i = 0; i < 30; i++) pushHuntFxEvent(q, ev('catch', 1000));
    fx.consume(q, 1000);

    expect(fx.particleCount).toBeLessThanOrEqual(HUNT_FX_MAX_PARTICLES);
    expect(fx.particleCount).toBeGreaterThan(0);
    expect(fx.busy(1000)).toBe(true);

    for (let t = 1000; t <= 9000; t += 16) fx.step(t, false, false);

    expect(fx.particleCount).toBe(0);
    expect(fx.busy(9000)).toBe(false);
  });

  it('a storm drop only gets a small burst', () => {
    const big = new HuntFx();
    const small = new HuntFx();

    big.consume([ev('catch', 1000)], 1000);
    small.consume([ev('catch', 1000, { small: true })], 1000);

    expect(small.particleCount).toBeLessThan(big.particleCount);
  });
});
