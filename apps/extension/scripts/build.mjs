import { mkdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(packageRoot, 'dist');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: {
    background: path.join(packageRoot, 'src/background.ts'),
    content: path.join(packageRoot, 'src/content.ts'),
    popup: path.join(packageRoot, 'src/popup.ts')
  },
  bundle: true,
  format: 'esm',
  outdir: distDir,
  platform: 'browser',
  sourcemap: true,
  target: ['chrome115', 'firefox115'],
  legalComments: 'none',
  tsconfig: path.join(packageRoot, 'tsconfig.json')
});

await Promise.all([
  copyFile(path.join(packageRoot, 'manifest.json'), path.join(distDir, 'manifest.json')),
  copyFile(path.join(packageRoot, 'src/popup.html'), path.join(distDir, 'popup.html')),
  copyFile(path.join(packageRoot, 'src/popup.css'), path.join(distDir, 'popup.css'))
]);