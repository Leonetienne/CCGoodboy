import { describe, expect, it } from 'vitest';
import { clampPawPoint, PAW_CONTAIN_MARGIN_PX } from '../../src/input/paw-bounds';

describe('clampPawPoint', () => {
  it('pulls an out-of-bounds point back inside the viewport margins', () => {
    const p = clampPawPoint(-5, -10);

    expect(p.x).toBe(PAW_CONTAIN_MARGIN_PX);
    expect(p.y).toBe(PAW_CONTAIN_MARGIN_PX);
  });

  it('leaves a comfortably interior point unchanged', () => {
    const p = clampPawPoint(200, 300);

    expect(p).toEqual({ x: 200, y: 300 });
  });
});
