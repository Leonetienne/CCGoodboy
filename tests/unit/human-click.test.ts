import { describe, expect, it, vi } from 'vitest';
import { ClickTiming } from '../../src/input/human-click';

// jsdom rejects `view: window` in MouseEvent init; same events, minus the view.
vi.mock('../../src/input/dispatch', () => ({
  dispatchMouse: (el: Element | null, type: string, x: number, y: number) =>
    !!el && el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })),
}));

describe('ClickTiming.humanClick (MOUSE-2)', () => {
  it('puts the game mouse back at the paw when the real mouse moved during the hold', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Stand-in for the game: Game.GetMouseCoords on document mousemove, '+N' at click time.
    let mouse = { x: 0, y: 0 };
    const track = (e: Event) => {
      const me = e as MouseEvent;
      mouse = { x: me.clientX, y: me.clientY };
    };
    let numberAt: { x: number; y: number } | null = null;
    document.addEventListener('mousemove', track);
    el.addEventListener('click', () => {
      numberAt = { ...mouse };
    });

    const clock = {
      // the human moves their mouse while the paw holds the button down
      sleep: async () => {
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 400 }));
      },
    };
    const timing = new ClickTiming({ lastClickAt: 0 } as never, {} as never, {} as never, clock as never, () => false);

    await timing.humanClick(el, 100, 120, 10);

    expect(numberAt).toEqual({ x: 100, y: 120 });

    document.removeEventListener('mousemove', track);
    el.remove();
  });
});
