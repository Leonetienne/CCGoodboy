import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { BuffLockTracker } from '../../src/game/buffs-lock';
import { LogStore } from '../../src/stats/log';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function withFrenzyBuff(game: FakeGameAdapter, count: number) {
  game.rawBuffs = {};
  for (let i = 0; i < count; i++) {
    game.rawBuffs[`buff${i}`] = { name: `Buff ${i}`, multCpS: 2, time: 100 };
  }
}

describe('BuffLockTracker', () => {
  let game: FakeGameAdapter;
  let runtime: RuntimeState;
  let tracker: BuffLockTracker;
  let logged: Array<{ action: string; meta: string }>;

  beforeEach(() => {
    localStorage.clear();
    game = new FakeGameAdapter();
    runtime = new RuntimeState();
    const data = new PersistedData();
    const log = new LogStore(data);
    logged = [];
    log.onLog((e) => logged.push({ action: e.action, meta: e.meta }));
    tracker = new BuffLockTracker(game, runtime, log);
  });

  it('opens LOCK_A once the buff count returns to 0', () => {
    runtime.lockA = true;
    withFrenzyBuff(game, 0);

    tracker.update();

    expect(runtime.lockA).toBe(false);
    expect(logged.some((l) => l.action === 'unlock A' && l.meta.includes('returned to 0'))).toBe(true);
  });

  it('opens LOCK_A once the buff count rises to >= 3 from a lower count', () => {
    runtime.lockA = true;
    runtime.lastCpsBuffCount = 1;
    withFrenzyBuff(game, 3);

    tracker.update();

    expect(runtime.lockA).toBe(false);
  });

  it('does not open LOCK_A when count is between 1 and 2', () => {
    runtime.lockA = true;
    runtime.lastCpsBuffCount = 0;
    withFrenzyBuff(game, 2);

    tracker.update();

    expect(runtime.lockA).toBe(true);
  });

  it('restarts the big-cookie timeline when Click Frenzy starts', () => {
    runtime.lastClickFrenzy = false;
    game.buffNames.add('Click frenzy');

    tracker.update();

    expect(runtime.nextBigClickAt).toBeGreaterThan(0);
    expect(runtime.lastClickFrenzy).toBe(true);
  });

  it('logs a signature change only when the buff set actually changes', () => {
    withFrenzyBuff(game, 1);
    tracker.update();
    const countAfterFirst = logged.filter((l) => l.action === 'cps buffs changed').length;

    tracker.update(); // same buffs again
    const countAfterSecond = logged.filter((l) => l.action === 'cps buffs changed').length;

    expect(countAfterFirst).toBe(1);
    expect(countAfterSecond).toBe(1);
  });
});
