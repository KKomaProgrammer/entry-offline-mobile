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
console.log('Mobile bridge TAR round-trip verification passed.');
