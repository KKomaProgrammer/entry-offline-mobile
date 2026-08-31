import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'dist');
const expected = [
  'index.html', 'mobile-bridge.js', 'renderer_build/render.bundle.js',
  'renderer_build/init.bundle.js', 'renderer_build/bundle.css',
  'renderer/resources/modal/app.css', 'entry-js/dist/entry.js',
  'entry-js/dist/entry.css', 'entry-tool/dist/entry-tool.js'
];
for (const file of expected) {
  if (!(await stat(path.join(root, file))).isFile()) throw new Error(`Missing ${file}`);
}
let files = 0;
let bytes = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(current);
    else if (entry.isFile()) { files += 1; bytes += (await stat(current)).size; }
  }
}
await walk(root);
if (files < 10000 || bytes < 500 * 1024 * 1024) {
  throw new Error(`Web bundle is incomplete: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB`);
}
console.log(`Web bundle verification passed: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB.`);
