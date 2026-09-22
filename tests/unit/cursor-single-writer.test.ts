// @ts-expect-error no node types in this project (Vitest runs under Node at test time)
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-expect-error no node types in this project
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

declare const process: { cwd(): string };

const srcRoot = resolve(process.cwd(), 'src');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

describe('single cursor writer', () => {
  it('only the low-level CursorController mutates runtime.cursor.x/y directly', () => {
    const offenders: string[] = [];

    for (const file of walk(srcRoot)) {
      const text = readFileSync(file, 'utf8');

      if (/\.cursor\.(x|y)\s*=/.test(text) && file !== resolve(srcRoot, 'input/cursor-controller.ts')) {
        offenders.push(relative(srcRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
