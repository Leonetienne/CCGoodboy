import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLatestTag,
  isNewerVersion,
  LATEST_RELEASE_API,
  parseVersion,
  releaseScriptUrl,
  UpdateChecker,
} from '../../src/lifecycle/update-check';
import type { LogStore } from '../../src/stats/log';

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  document.getElementById('ccsb-update')?.remove();
});

const fakeLog = () => ({ log: vi.fn() }) as unknown as LogStore & { log: ReturnType<typeof vi.fn> };

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('versions (UPD-1)', () => {
  it('parses plain and v-prefixed tags, rejects anything else', () => {
    expect(parseVersion('5.5.8')).toEqual([5, 5, 8]);
    expect(parseVersion('v6.0')).toEqual([6, 0, 0]);
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('5.5.8"><img>')).toBeNull();
  });

  it('only a strictly higher version is newer', () => {
    expect(isNewerVersion('5.5.9', '5.5.8')).toBe(true);
    expect(isNewerVersion('5.10.0', '5.9.9')).toBe(true);
    expect(isNewerVersion('v6.0.0', '5.99.99')).toBe(true);
    expect(isNewerVersion('5.5.8', '5.5.8')).toBe(false);
    expect(isNewerVersion('5.0.11', '5.5.8')).toBe(false);
    expect(isNewerVersion('nope', '5.5.8')).toBe(false);
  });

  it('links the release asset of the tag', () => {
    expect(releaseScriptUrl('5.6.0')).toBe(
      'https://github.com/Leonetienne/CCGoodboy/releases/download/5.6.0/cc-good-boy.user.js',
    );
  });
});

describe('fetchLatestTag', () => {
  it('reads tag_name from the latest release API', async () => {
    const f = respond({ tag_name: '5.6.0' });
    expect(await fetchLatestTag(f)).toBe('5.6.0');
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(LATEST_RELEASE_API);
  });

  it('ignores a tag that is no version and throws on HTTP errors', async () => {
    expect(await fetchLatestTag(respond({ tag_name: 'nightly' }))).toBeNull();
    await expect(fetchLatestTag(respond({}, 403))).rejects.toThrow('403');
  });
});

describe('UpdateChecker (UPD-2/3)', () => {
  it('shows the popup with the download link when a newer release exists', async () => {
    const log = fakeLog();
    await new UpdateChecker(log, respond({ tag_name: '5.6.0' }), '5.5.8').check();

    const popup = document.getElementById('ccsb-update')!;
    expect(popup.textContent).toContain("There's an update for your gewd boy :3");
    expect(popup.textContent).toContain('Wanna update now?');
    const go = document.getElementById('ccsb-update-go') as HTMLAnchorElement;
    expect(go.href).toBe(releaseScriptUrl('5.6.0'));
    expect(log.log).toHaveBeenCalledWith('update available', 'v5.5.8 -> 5.6.0');
  });

  it('stays quiet when up to date, on a network error, and closes on "Later"', async () => {
    await new UpdateChecker(fakeLog(), respond({ tag_name: '5.5.8' }), '5.5.8').check();
    expect(document.getElementById('ccsb-update')).toBeNull();

    const broken = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(new UpdateChecker(fakeLog(), broken, '5.5.8').check()).resolves.toBeUndefined();
    expect(document.getElementById('ccsb-update')).toBeNull();

    await new UpdateChecker(fakeLog(), respond({ tag_name: '9.0.0' }), '5.5.8').check();
    (document.getElementById('ccsb-update-later') as HTMLButtonElement).click();
    expect(document.getElementById('ccsb-update')).toBeNull();
  });

  it('show() works for the DBG-21 dummy version', () => {
    new UpdateChecker(fakeLog(), respond({}), '5.5.9').show('DUMMY');
    expect(document.getElementById('ccsb-update')!.textContent).toContain('v5.5.9 -> vDUMMY');
    expect((document.getElementById('ccsb-update-go') as HTMLAnchorElement).href).toBe(releaseScriptUrl('DUMMY'));
  });

  it('does not pop up after the bot was destroyed mid-check', async () => {
    const c = new UpdateChecker(fakeLog(), respond({ tag_name: '9.0.0' }), '5.5.8');
    const p = c.check();
    c.destroy();
    await p;
    expect(document.getElementById('ccsb-update')).toBeNull();
  });
});
