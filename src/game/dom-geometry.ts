export interface LooseRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** True if the element itself or any ancestor is display:none / visibility:hidden / opacity:0.
 * getBoundingClientRect() can still report a plausible-looking rect for a collapsed accordion
 * panel, so size alone is not enough to trust it. */
export function elementHiddenByCss(el: Element): boolean {
  if (typeof (el as any).checkVisibility === 'function') {
    try {
      return !(el as any).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    } catch (_e) {
      /* fall through to the manual check below */
    }
  }

  for (let node: Element | null = el; node && node.nodeType === 1; node = node.parentElement) {
    const cs = window.getComputedStyle(node);

    if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
      return true;
    }
  }

  return false;
}

/** True if an ancestor clips the element away: an overflow:hidden/auto/scroll ancestor (e.g. a
 * collapsed store panel with height:0) whose own visible box does not actually contain the
 * element's rect. */
export function clippedByAncestor(el: Element, r: DOMRect): boolean {
  const clipRe = /(hidden|auto|scroll|clip)/;

  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const cs = window.getComputedStyle(node);

    const clipsX = clipRe.test(cs.overflowX) || clipRe.test(cs.overflow);
    const clipsY = clipRe.test(cs.overflowY) || clipRe.test(cs.overflow);

    if (!clipsX && !clipsY) continue;

    const cr = node.getBoundingClientRect();

    if (cr.width <= 0 || cr.height <= 0) {
      return true;
    }

    const overlapW = Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
    const overlapH = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);

    if ((clipsX && overlapW < r.width * 0.5) || (clipsY && overlapH < r.height * 0.5)) {
      return true;
    }
  }

  return false;
}

/** Bounding rect of an element if it is connected, non-empty and on screen; else null. */
export function visibleRect(el: Element | null | undefined): DOMRect | null {
  if (!el || !el.isConnected) {
    return null;
  }

  const r = el.getBoundingClientRect();

  if (!r || r.width <= 0 || r.height <= 0) {
    return null;
  }

  if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) {
    return null;
  }

  if (elementHiddenByCss(el)) {
    return null;
  }

  if (clippedByAncestor(el, r)) {
    return null;
  }

  return r;
}

/** Rect for something that may still be tiny or invisible (a cookie that is only just fading
 * in): centred on the element, at least minSize wide/high. Used for the immediate hitboxes. */
export function looseRect(el: Element | null | undefined, minSize: number): LooseRect | null {
  if (!el || !el.isConnected) {
    return null;
  }

  const r = el.getBoundingClientRect();
  if (!r) return null;

  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
    return null;
  }

  const w = Math.max(r.width, minSize || 0);
  const h = Math.max(r.height, minSize || 0);

  return {
    left: cx - w / 2,
    top: cy - h / 2,
    width: w,
    height: h,
  };
}

/** Centre of a shimmer on screen. */
export function shimmerCenter(shimmer: { l: Element | null } | null | undefined): (Point & { rect: DOMRect }) | null {
  const r = visibleRect(shimmer && shimmer.l);
  if (!r) return null;

  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    rect: r,
  };
}

/** Euclidean distance between two {x,y} points. */
export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
