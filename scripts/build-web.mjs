import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const upstream = path.resolve(process.argv[2] || path.join(root, '.upstream'));
const entryJs = path.resolve(process.argv[3] || path.join(root, '.vendor', 'entry-js'));
const entryTool = path.resolve(process.argv[4] || path.join(root, '.vendor', 'entry-tool'));
const output = path.join(root, 'dist');

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) await cp(source, target);
  }
}

async function replace(file, before, after) {
  const source = await readFile(file, 'utf8');
  if (!source.includes(before)) {
    if (source.includes(after)) return;
    throw new Error(`Patch target not found in ${file}: ${before.slice(0, 100)}`);
  }
  await writeFile(file, source.split(before).join(after));
}

async function run(command, args, cwd, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

for (const directory of [upstream, entryJs, entryTool]) {
  if (!(await stat(directory)).isDirectory()) throw new Error(`Missing source directory: ${directory}`);
}

// Use the official prebuilt EntryJS and Entry Tool branches instead of rebuilding them.
await rm(path.join(upstream, 'node_modules', 'entry-js'), { recursive: true, force: true });
await rm(path.join(upstream, 'node_modules', 'entry-tool'), { recursive: true, force: true });
await copyTree(entryJs, path.join(upstream, 'node_modules', 'entry-js'));
await copyTree(entryTool, path.join(upstream, 'node_modules', 'entry-tool'));

await replace(
  path.join(upstream, 'webpack', 'webpack.renderer.config.js'),
  "target: 'electron-renderer'",
  "target: 'web'"
);
await replace(
  path.join(upstream, 'src', 'renderer', 'renderEntry.tsx'),
  "from './components/Index'",
  "from './components/index'"
);
await replace(
  path.join(upstream, 'src', 'renderer', 'components', 'workspace.tsx'),
  "libDir: '../../../node_modules',\n        defaultDir: '../../renderer/resources',",
  "libDir: '.',\n        defaultDir: '/renderer/resources',"
);
await replace(
  path.join(upstream, 'src', 'renderer', 'helper', 'entry', 'entryPatcher.ts'),
  "        IpcRendererHelper.openHardwarePage();\n        Entry.hw._initSocket();",
  "        console.info('[Entry Mobile] Hardware connection is disabled.');"
);
await replace(
  path.join(upstream, 'src', 'renderer', 'helper', 'entry', 'entryModalHelper.ts'),
  "imageBaseUrl: string = '../../../node_modules/entry-js/images/hardware/'",
  "imageBaseUrl: string = '/entry-js/images/hardware/'"
);
await replace(
  path.join(upstream, 'src', 'renderer', 'helper', 'entry', 'entryModalHelper.ts'),
  "            if (value.path) {\n                uploadPaths.push(value.path);\n            }",
  "            if (value instanceof File) {\n                uploadPaths.push(value);\n            } else if (value.path) {\n                uploadPaths.push(value.path);\n            }"
);
await replace(
  path.join(upstream, 'src', 'renderer', 'helper', 'entry', 'entryModalHelper.ts'),
  '                            uploadFilePaths.push(value.path);',
  '                            uploadFilePaths.push(value);'
);

const ipcHelper = path.join(upstream, 'src', 'renderer', 'helper', 'ipcRendererHelper.ts');
for (const signature of [
  'static importObjects(filePaths: string[])',
  'static importPictures(filePaths: string[])',
  'static importSounds(filePath: string[])',
  'static createTableInfo(filePaths: string[])'
]) {
  const argument = signature.includes('filePath:') ? 'filePath' : 'filePaths';
  await replace(ipcHelper, signature, signature.replace(`${argument}: string[]`, `${argument}: Array<string | File>`));
}

const constantsFile = path.join(upstream, 'src', 'renderer', 'helper', 'constants.ts');
let constants = await readFile(constantsFile, 'utf8');
constants = constants
  .replace("return window.isOsx ? '/' : '\\\\';", "return '/';")
  .replace(/`\.\.\$\{this\.sep\}\.\.\$\{this\.sep\}\$\{this\.resourcePath\}/g, '`/${this.resourcePath}')
  .replace(/`\$\{this\.resourcePath\}/g, '`/${this.resourcePath}')
  .replace(/`temp\$\{this\.sep\}/g, '`/temp${this.sep}');
await writeFile(constantsFile, constants);

await run(
  path.join(upstream, 'node_modules', '.bin', 'webpack'),
  ['--config', 'webpack/webpack.renderer.config.js'],
  upstream,
  { NODE_ENV: 'production', NODE_OPTIONS: '--openssl-legacy-provider' }
);

await rm(output, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
await mkdir(output, { recursive: true });
await copyTree(path.join(upstream, 'src', 'renderer_build'), path.join(output, 'renderer_build'));
await copyTree(path.join(upstream, 'src', 'renderer', 'resources'), path.join(output, 'renderer', 'resources'));
await copyTree(entryJs, path.join(output, 'entry-js'));
await copyTree(entryTool, path.join(output, 'entry-tool'));

const libraries = [
  ['lodash', 'lodash'],
  ['jquery', 'jquery'],
  ['literallycanvas-mobile', 'literallycanvas-mobile'],
  ['@entrylabs/legacy-video', 'legacy-video']
];
for (const [moduleName, target] of libraries) {
  await copyTree(path.join(upstream, 'node_modules', moduleName), path.join(output, target));
}

let html = await readFile(path.join(upstream, 'src', 'main', 'views', 'main.html'), 'utf8');
html = html
  .replace(/\.\.\/\.\.\/renderer\//g, 'renderer/')
  .replace(/\.\.\/\.\.\/renderer_build\//g, 'renderer_build/')
  .replace(/\.\.\/\.\.\/\.\.\/node_modules\/entry-js\//g, 'entry-js/')
  .replace(/\.\.\/\.\.\/\.\.\/node_modules\/entry-tool\//g, 'entry-tool/')
  .replace(/\.\.\/\.\.\/\.\.\/node_modules\/literallycanvas-mobile\//g, 'literallycanvas-mobile/')
  .replace(/\.\.\/\.\.\/\.\.\/node_modules\/lodash\//g, 'lodash/')
  .replace(/\.\.\/\.\.\/\.\.\/node_modules\/jquery\//g, 'jquery/')
  .replace(/\.\.\/\.\.\/\.\.\/node_modules\/@entrylabs\/legacy-video\//g, 'legacy-video/')
  .replace('<div id="__next"></div>', '<div id="__next"></div>\n        <script src="mobile-bridge.js"></script>');
await writeFile(path.join(output, 'index.html'), html);

await run(path.join(root, 'node_modules', '.bin', 'esbuild'), ['src/mobile-bridge.ts', '--bundle', '--minify', '--format=iife', '--target=es2020', '--outfile=dist/mobile-bridge.js'], root);
console.log(`Assembled Android web application at ${output}`);
