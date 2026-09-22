import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { getHammerStepPx, nextBigCookiePoint, randomPointInBigCookie } from '../../src/actions/hammer';

function mountBigCookie(rect: { left: number; top: number; width: number; height: number }) {
  const el = document.createElement('div');
  el.id = 'bigCookie';
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

describe('getHammerStepPx', () => {
  let data: PersistedData;

  beforeEach(() => {
    localStorage.clear();
    data = new PersistedData();
  });

  it('reads the configured step, clamped to 0..60', () => {
    data.config.hammerStepPx = 5;
    expect(getHammerStepPx(data)).toBe(5);

    data.config.hammerStepPx = 999;
    expect(getHammerStepPx(data)).toBe(60);

    data.config.hammerStepPx = NaN;
    expect(getHammerStepPx(data)).toBe(3);
  });
});

describe('randomPointInBigCookie', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns null when the big cookie is not present/visible', () => {
    expect(randomPointInBigCookie()).toBeNull();
  });

  it('returns a point within the 36% radius of the cookie centre', () => {
    mountBigCookie({ left: 100, top: 100, width: 200, height: 200 });

    const point = randomPointInBigCookie()!;
    expect(point).not.toBeNull();

    const cx = 200;
    const cy = 200;
    const dist = Math.hypot(point.x - cx, point.y - cy);

    expect(dist).toBeLessThanOrEqual(200 * 0.36 + 1e-9);
  });
});

describe('nextBigCookiePoint', () => {
  let data: PersistedData;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    data = new PersistedData();
  });

  it('returns null when the big cookie is not present', () => {
    expect(nextBigCookiePoint(null, data)).toBeNull();
  });

  it('travels fresh (near: false) with no usable previous spot', () => {
    mountBigCookie({ left: 100, top: 100, width: 200, height: 200 });
    const point = nextBigCookiePoint(null, data);

    expect(point).not.toBeNull();
    expect(point!.near).toBe(false);
  });

  it('takes a small step (near: true) from a previous spot still on the cookie', () => {
    mountBigCookie({ left: 100, top: 100, width: 200, height: 200 });
    data.config.hammerStepPx = 3;

    const prev = { x: 200, y: 200 }; // dead centre
    const point = nextBigCookiePoint(prev, data)!;

    expect(point.near).toBe(true);
    expect(Math.hypot(point.x - prev.x, point.y - prev.y)).toBeLessThanOrEqual(3 + 1e-9);
  });

  it('never places the next point outside the cookie radius', () => {
    mountBigCookie({ left: 100, top: 100, width: 200, height: 200 });
    data.config.hammerStepPx = 60; // max step

    // Start right at the edge of the clickable radius.
    const maxR = 200 * 0.36;
    const prev = { x: 200 + maxR - 1, y: 200 };

    const point = nextBigCookiePoint(prev, data)!;
    const dist = Math.hypot(point.x - 200, point.y - 200);

    expect(dist).toBeLessThanOrEqual(maxR + 1e-6);
  });
});
