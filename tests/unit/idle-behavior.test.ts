import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { pickIdleSpot } from '../../src/idle/idle-behavior';

function mountVisible(id: string, rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.style.opacity = '1'; // jsdom's default computed opacity is '', which visibleRect() would treat as hidden
  document.body.appendChild(el);

  el.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }) as DOMRect;

  return el;
}

describe('pickIdleSpot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns null when nothing from IDLE_SPOTS is visible', () => {
    expect(pickIdleSpot()).toBeNull();
  });

  it('picks a point inside the only visible spot when just one is present', () => {
    mountVisible('cookies', { left: 50, top: 60, width: 40, height: 20 });

    const spot = pickIdleSpot()!;

    expect(spot).not.toBeNull();
    expect(spot.label).toBe('the cookie counter');
    expect(spot.x).toBeGreaterThanOrEqual(50);
    expect(spot.x).toBeLessThanOrEqual(90);
    expect(spot.y).toBeGreaterThanOrEqual(60);
    expect(spot.y).toBeLessThanOrEqual(80);
  });
});

describe('RuntimeState (idle-related defaults)', () => {
  it('starts with idle scheduling fields at their neutral defaults', () => {
    const runtime = new RuntimeState();
    expect(runtime.nextIdleAt).toBe(0);
    expect(runtime.idleStay).toBe(false);
  });
});

describe('PersistedData idle config', () => {
  beforeEach(() => localStorage.clear());

  it('defaults idleWander to true and a sane idle speed', () => {
    const data = new PersistedData();
    expect(data.config.idleWander).toBe(true);
    expect(data.config.idleSpeedPxPerSec).toBe(320);
  });
});
