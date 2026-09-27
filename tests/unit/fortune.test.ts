import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FortuneClickAction, fortuneText } from '../../src/actions/fortune';
import { autoUpgradeGain, type UpgradeClassifyCtx } from '../../src/autoplay/upgrade-classifier';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY, type CursorJobContext } from '../../src/cursor/types';
import type { GameBuilding, GameUpgrade } from '../../src/game/types';
import { FortuneCatcher } from '../../src/hunting/fortune';
import { LogStore } from '../../src/stats/log';
import { StatsRecorder } from '../../src/stats/stats';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function ctx(overrides: Partial<UpgradeClassifyCtx> = {}): UpgradeClassifyCtx {
  return { cps: 100, mult: 1, biscuitBase: null, cursor: null, nonCursor: 0, clickUnit: 1, clicksPerSec: 0, ...overrides };
}

function upgrade(name: string, extra: Partial<GameUpgrade> = {}): GameUpgrade {
  return { name, buy: () => {}, ...extra };
}

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) } as DOMRect;
}

/** The game's ticker line with a fortune span in it, on screen. */
function withFortuneTicker(): HTMLElement {
  const ticker = document.createElement('div');
  ticker.id = 'commentsText1';
  const span = document.createElement('span');
  span.className = 'fortune';
  span.textContent = 'Fortune #001: Fingers are not the only thing you can count on.';
  ticker.appendChild(span);
  document.body.appendChild(ticker);
  ticker.style.opacity = '1';
  span.style.opacity = '1';
  ticker.getBoundingClientRect = () => rect(300, 10, 600, 30);
  span.getBoundingClientRect = () => rect(400, 14, 300, 20);
  return ticker;
}

describe('fortune upgrades (FORTUNE-3)', () => {
  it('values Fortune #001-#017 as their building 7% more efficient and 7% cheaper', () => {
    const game = new FakeGameAdapter();
    const cursor = { name: 'Cursor', storedTotalCps: 50 } as GameBuilding;
    const up = upgrade('Fortune #001', { desc: 'Cursors are <b>7%</b> more efficient and <b>7%</b> cheaper.<q>Fingers...</q>', buildingTie: cursor, buildingTie1: cursor });
    const g = autoUpgradeGain(game, up, ctx({ mult: 2 }));
    expect(g!.type).toBe('fortune');
    expect(g!.gain).toBeCloseTo(50 * 2 * 0.14);
  });

  it('values Fortune #103 as a kitten with milk factor 0.05', () => {
    const game = new FakeGameAdapter();
    game.milkProgress = 2;
    const g = autoUpgradeGain(game, upgrade('Fortune #103', { desc: 'You gain <b>more CpS</b> the more milk you have.' }), ctx());
    expect(g!.type).toBe('kitten');
    expect(g!.gain).toBeCloseTo(100 * 0.05 * 2);
  });

  it('values #100/#101 as multipliers, #104 as a mouse upgrade and #102 nominally', () => {
    const game = new FakeGameAdapter();
    const c = ctx({ clicksPerSec: 10 });
    expect(autoUpgradeGain(game, upgrade('Fortune #100', { desc: 'All buildings and upgrades are <b>1% cheaper</b>. Cookie production multiplier <b>+1%</b>.' }), c)).toEqual({ gain: 1, type: 'multiplier' });
    const g101 = autoUpgradeGain(game, upgrade('Fortune #101', { desc: 'Cookie production multiplier <b>+7%</b>.' }), c);
    expect(g101!.type).toBe('multiplier');
    expect(g101!.gain).toBeCloseTo(7);
    expect(autoUpgradeGain(game, upgrade('Fortune #104', { desc: 'Clicking gains <b>+1% of your CpS</b>.' }), c)).toEqual({ gain: 10, type: 'click' });
    expect(autoUpgradeGain(game, upgrade('Fortune #102', { desc: 'You gain another <b>+1%</b> of your regular CpS while the game is closed.' }), c)).toEqual({ gain: 0.1, type: 'fortune' });
  });
});

describe('FortuneCatcher (FORTUNE-1)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('is pending only while a fortune is in the ticker and on screen', () => {
    const game = new FakeGameAdapter();
    const catcher = new FortuneCatcher(new RuntimeState(), new PersistedData(), game, null as never, null as never, () => false);
    withFortuneTicker();
    expect(catcher.pending()).toBe(false);

    game.tickerFortune = { kind: 'upgrade', name: 'Fortune #001' };
    expect(catcher.pending()).toBe(true);

    game.ascending = true;
    expect(catcher.pending()).toBe(false);
  });

  it('is never pending with "Click fortune cookies in the news" off', () => {
    const game = new FakeGameAdapter();
    const data = new PersistedData();
    data.config.fortunes = false;
    withFortuneTicker();
    game.tickerFortune = { kind: 'golden' };
    expect(new FortuneCatcher(new RuntimeState(), data, game, null as never, null as never, () => false).pending()).toBe(false);
  });

  it('hands out a job at the FORTUNE priority, above the lump', () => {
    const game = new FakeGameAdapter();
    const job = new FortuneCatcher(new RuntimeState(), new PersistedData(), game, null as never, null as never, () => false).job();
    expect(job.priority).toBe(JOB_PRIORITY.FORTUNE);
    expect(job.key).toBe('fortune');
    expect(JOB_PRIORITY.FORTUNE).toBeLessThan(JOB_PRIORITY.LUMP_HARVEST);
  });
});

describe('FortuneClickAction', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('aborts for a golden cookie, a Click Frenzy or a fortune that is gone', () => {
    const game = new FakeGameAdapter();
    withFortuneTicker();
    game.tickerFortune = { kind: 'golden' };
    expect(new FortuneClickAction(new RuntimeState(), game, null as never, null as never, () => false).abortIf()).toBe(false);
    expect(new FortuneClickAction(new RuntimeState(), game, null as never, null as never, () => true).abortIf()).toBe(true);

    game.tickerFortune = null;
    expect(new FortuneClickAction(new RuntimeState(), game, null as never, null as never, () => false).abortIf()).toBe(true);
  });

  it('clicks the fortune span and records the fortune once the ticker took it', async () => {
    const game = new FakeGameAdapter();
    const ticker = withFortuneTicker();
    game.tickerFortune = { kind: 'upgrade', name: 'Fortune #001' };
    // the game's own handler sits on the ticker line; the click bubbles up from the span
    ticker.addEventListener('click', () => {
      game.tickerFortune = null;
    });

    const data = new PersistedData();
    const stats = new StatsRecorder(data);
    const log = new LogStore(data);
    const runtime = new RuntimeState();
    const humanClick = vi.fn(async (el: Element) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    });
    const jobCtx = { runtime, game, clickTiming: { humanClick } } as unknown as CursorJobContext;

    await new FortuneClickAction(runtime, game, stats, log, () => false).cursor_at_position(jobCtx);

    expect((humanClick.mock.calls[0]![0] as Element).className).toBe('fortune');
    expect(data.stats.fortunes).toBe(1);
    expect(fortuneText({ kind: 'cps' })).toBe('an hour of CpS');
  });
});
