import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

await rm('dist', { recursive: true, force: true });
await mkdir('dist/icons', { recursive: true });

await build({
  entryPoints: {
    content: 'src/content/main.js',
    background: 'src/background.js',
    options: 'src/options/options.js',
  },
  bundle: true,
  format: 'iife',
  target: 'firefox142',
  outdir: 'dist',
  logLevel: 'info',
});

// The package.json version is the single source for the add-on version.
const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
manifest.version = pkg.version;
await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

await cp('src/content/content.css', 'dist/content.css');
await cp('src/options/options.html', 'dist/options.html');
await cp('src/options/options.css', 'dist/options.css');
await cp('src/icons/icon.svg', 'dist/icons/icon.svg');
