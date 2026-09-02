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

const firstLoadedProject = {};
const firstLoadedUrls = new Set(['blob:first-project']);
test.stageProjectResources(firstLoadedProject, firstLoadedUrls);
test.activateProjectResources(firstLoadedProject);
if (firstLoadedUrls.size !== 1) throw new Error('New project resources were released too early');
const secondLoadedProject = {};
const secondLoadedUrls = new Set(['blob:second-project']);
test.stageProjectResources(secondLoadedProject, secondLoadedUrls);
test.activateProjectResources(secondLoadedProject);
if (firstLoadedUrls.size !== 0 || secondLoadedUrls.size !== 1) {
  throw new Error('Project resources were not swapped after activation');
}
test.activateProjectResources(undefined);
if (secondLoadedUrls.size !== 0) throw new Error('New workspace did not release old project resources');

const validProject = { scenes: [{ id: 'scene' }], objects: [{ id: 'object' }] };
if (!test.isRestorableProject(validProject)) throw new Error('Valid project was rejected');
if (test.isRestorableProject({ scenes: [], objects: [] })) throw new Error('Empty project was accepted');
if (test.isRestorableProject({ ...validProject, objects: [{ fileurl: 'blob:expired' }] })) {
  throw new Error('Expired project URL was accepted');
}
if (test.isRestorableProject({
  ...validProject,
  objects: [{ sprite: { pictures: [{ fileurl: 'undefinedmedia/entrybot1.svg' }] } }]
})) {
  throw new Error('Broken pre-init default project was accepted');
}

const [resourceObject] = test.importObjectsFromResource([{
  name: 'Entrybot',
  pictures: [{ filename: 'aabbcc', imageType: 'svg' }],
  sounds: [{ filename: 'ddeeff', ext: '.mp3' }]
}]);
if (resourceObject.pictures[0].fileurl !== '/renderer/resources/uploads/aa/bb/image/aabbcc.png') {
  throw new Error('Bundled object picture path is invalid');
}
if (resourceObject.sounds[0].fileurl !== '/renderer/resources/uploads/dd/ee/sound/ddeeff.mp3') {
  throw new Error('Bundled object sound path is invalid');
}

const buildScript = await readFile(new URL('./build-web.mjs', import.meta.url), 'utf8');
if (buildScript.includes('getStartProject(Entry.mediaFilePath)')) {
  throw new Error('Default project is still created before Entry.init');
}
if (!buildScript.includes('activateEntryMobileProjectResources?.(project)')) {
  throw new Error('Workspace resource activation patch is missing');
}
if (!buildScript.includes("libDir: ''")) {
  throw new Error('EntryJS media resources are not rooted at the app origin');
}

console.log('Mobile bridge TAR and resource lifecycle verification passed.');
