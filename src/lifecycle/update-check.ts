import { errText, sayCant, sayYay } from '../core/console-voice';
import { VERSION } from '../core/constants';
import type { LogStore } from '../stats/log';

/** GitHub's "latest release" (UPD-1). The page itself (github.com/.../releases/latest, a
 * redirect to the release's tag) sends no CORS headers, so a `@grant none` script can't see
 * where it redirects to; the REST API answers the same question with CORS allowed. */
export const LATEST_RELEASE_API = 'https://api.github.com/repos/Leonetienne/CCGoodboy/releases/latest';

/** The userscript file attached to the release `tag`. Opening it lets Tampermonkey offer the
 * update (UPD-2). */
export function releaseScriptUrl(tag: string): string {
  return `https://github.com/Leonetienne/CCGoodboy/releases/download/${encodeURIComponent(tag)}/cc-good-boy.user.js`;
}

/** "5.5.8" / "v5.5.8" -> [5, 5, 8]; null for anything that isn't a plain version tag. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(v).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/** Whether `latest` is a strictly higher MAJOR.MINOR.PATCH than `current` (an older or
 * unparsable release never asks for an "update"). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;

  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }

  return false;
}

/** Asks GitHub for the latest release's tag; null when there is none or it isn't a version. */
export async function fetchLatestTag(fetchFn: typeof fetch): Promise<string | null> {
  const res = await fetchFn(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);

  const body = (await res.json()) as { tag_name?: unknown };
  const tag = typeof body?.tag_name === 'string' ? body.tag_name.trim() : '';
  return parseVersion(tag) ? tag : null;
}

/** Checks once, at start-up, whether GitHub has a newer release and if so shows the cute
 * "wanna update?" popup (UPD-1..3). Never throws: a failed check only says so in the
 * console. */
export class UpdateChecker {
  private popup: HTMLElement | null = null;
  private destroyed = false;

  constructor(
    private readonly log: LogStore,
    private readonly fetchFn: typeof fetch = (...args) => window.fetch(...args),
    private readonly current: string = VERSION,
  ) {}

  async check(): Promise<void> {
    let tag: string | null;

    try {
      tag = await fetchLatestTag(this.fetchFn);
    } catch (e) {
      sayCant(`Wanted to sniff out a newer version of me, but couldn't reach GitHub (${errText(e)}) :c`);
      return;
    }

    if (this.destroyed || !tag || !isNewerVersion(tag, this.current)) return;

    this.log.log('update available', `v${this.current} -> ${tag}`);
    sayYay(`Psst, there's a new me on GitHub (${tag})!! :3`);
    this.show(tag);
  }

  /** Builds the popup. Only text nodes carry the tag, and the tag already passed
   * parseVersion(). */
  show(tag: string): void {
    this.popup?.remove();

    const popup = document.createElement('div');
    popup.id = 'ccsb-update';

    const title = document.createElement('div');
    title.className = 'ccsb-update-title';
    title.textContent = "There's an update for your gewd boy :3";

    const ask = document.createElement('div');
    ask.className = 'ccsb-update-text';
    ask.textContent = `Wanna update now? owo  (v${this.current.replace(/^v/, '')} -> v${tag.replace(/^v/, '')})`;

    const buttons = document.createElement('div');
    buttons.className = 'ccsb-update-buttons';

    const go = document.createElement('a');
    go.id = 'ccsb-update-go';
    go.href = releaseScriptUrl(tag);
    go.target = '_blank';
    go.rel = 'noopener noreferrer';
    go.innerHTML = '<span>Yes pls, update me! ^w^</span>';
    go.addEventListener('click', () => {
      this.log.log('update opened', tag);
      this.close();
    });

    const later = document.createElement('button');
    later.className = 'ccsb-btn';
    later.id = 'ccsb-update-later';
    later.textContent = 'Later :c';
    later.addEventListener('click', () => this.close());

    buttons.append(go, later);
    popup.append(title, ask, buttons);
    document.body.appendChild(popup);
    this.popup = popup;
  }

  close(): void {
    this.popup?.remove();
    this.popup = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.close();
  }
}
