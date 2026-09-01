import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../dist/mobile-bridge.js', import.meta.url), 'utf8');
const window = { addEventListener() {}, removeEventListener() {}, open() {}, location: { href: '' } };
const document = {
  readyState: 'loading', body: { appendChild() {} }, addEventListener() {},
  createElement() { return { style: {}, addEventListener() {}, click() {}, remove() {} }; }
};
const context = { window, document, console, Blob, File, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, atob, btoa, crypto, fetch, setTimeout, clearTimeout, navigator: {} };
context.globalThis = context;
vm.runInNewContext(code, context);
const test = window.__ENTRY_MOBILE_TEST__;
if (!test) throw new Error('Bridge test API missing');
const input = new TextEncoder().encode('{"hello":"entry"}');
const tar = test.makeTar([{ name: 'temp/project.json', data: input }]);
const output = test.parseTar(tar).get('temp/project.json');
if (!output || new TextDecoder().decode(output) !== '{"hello":"entry"}') throw new Error('TAR round-trip failed');

const project = {
  objects: [{ sprite: { pictures: [
    { filename: 'same', fileurl: 'temp/aa/bb/image/same.png' },
    { filename: 'same', fileurl: 'temp/aa/bb/image/same.png' }
  ] } }]
};
const ownedUrls = new Set();
test.hydrateProject(project, new Map([['temp/aa/bb/image/same.png', new Uint8Array([1, 2, 3])]]), ownedUrls);
const [firstPicture, secondPicture] = project.objects[0].sprite.pictures;
if (!firstPicture.fileurl.startsWith('blob:') || firstPicture.fileurl !== secondPicture.fileurl) {
  throw new Error('Duplicate archive resources did not share one object URL');
}
if (ownedUrls.size !== 1) throw new Error('Unexpected project object URL count');
test.releaseObjectUrls(ownedUrls);
if (ownedUrls.size !== 0) throw new Error('Project object URLs were not released');
if (test.resourceMime('.svg', 'image') !== 'image/svg+xml') throw new Error('SVG MIME type is invalid');
if (test.resourceMime('.mp3', 'sound') !== 'audio/mpeg') throw new Error('MP3 MIME type is invalid');

console.log('Mobile bridge TAR and resource lifecycle verification passed.');
