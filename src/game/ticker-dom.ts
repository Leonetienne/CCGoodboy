import { visibleRect } from './dom-geometry';

/** The news ticker's current line, `#commentsText1` (the game's own click handler sits on it,
 * FORTUNE-1). A fortune is drawn as a `.fortune` span inside it. */
export function getTickerControl(): Element | null {
  return document.getElementById('commentsText1');
}

/** What the paw clicks for a fortune: its `.fortune` span (the click bubbles to the ticker's
 * handler), else the ticker line itself. */
export function fortuneElement(): Element | null {
  const ticker = getTickerControl();
  if (!ticker) return null;

  return ticker.querySelector('.fortune') || ticker;
}

/** Centre of the fortune text, or null while it isn't on screen. */
export function fortuneCenter(): { x: number; y: number } | null {
  const rect = visibleRect(fortuneElement());
  if (!rect) return null;

  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
