import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'dist');
const target = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public');
const assets = path.dirname(target);

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(sourcePath, targetPath);
    else if (entry.isFile()) await cp(sourcePath, targetPath);
  }
}

if (!(await stat(path.join(source, 'index.html'))).isFile()) throw new Error('Run build:web first.');
await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
await copyTree(source, target);
await mkdir(assets, { recursive: true });
await writeFile(path.join(assets, 'capacitor.config.json'), `${JSON.stringify(JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'capacitor.config.json'), 'utf8')), null, 2)}\n`);
await writeFile(path.join(assets, 'capacitor.plugins.json'), '[]\n');
console.log('Synced Entry web assets into Android.');
