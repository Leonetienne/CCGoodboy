import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const bannerTemplate = readFileSync(path.join(rootDir, 'build', 'userscript-banner.txt'), 'utf8');
const banner = bannerTemplate.replace('{{VERSION}}', pkg.version);

const outfile = path.join(rootDir, 'dist', 'cc-good-boy.user.js');
mkdirSync(path.dirname(outfile), { recursive: true });

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(rootDir, 'src', 'main.ts')],
  bundle: true,
  outfile,
  format: 'iife',
  target: 'es2020',
  loader: { '.svg': 'text' },
  legalComments: 'none',
};

function writeBanner() {
  const built = readFileSync(outfile, 'utf8');
  if (!built.startsWith(banner)) {
    writeFileSync(outfile, banner + '\n' + built);
  }
}

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [
      {
        name: 'userscript-banner',
        setup(b) {
          b.onEnd(() => writeBanner());
        },
      },
    ],
  });
  await ctx.watch();
  console.log('watching for changes...');
} else {
  await build(options);
  writeBanner();
  console.log(`built ${path.relative(rootDir, outfile)}`);
}
