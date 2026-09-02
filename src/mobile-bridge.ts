import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { registerPlugin } from '@capacitor/core';

type TarItem = { name: string; data: Uint8Array };
type EntryFileApi = {
  beginSave(options: { filename: string; mimeType: string }): Promise<{ token: string }>;
  appendSave(options: { token: string; data: string }): Promise<void>;
  finishSave(options: { token: string }): Promise<void>;
  abortSave(options: { token: string }): Promise<void>;
};

const win = window as any;
const EntryFile = registerPlugin<EntryFileApi>('EntryFile');
const tables = new Map<string, any>();
let activeProjectUrls = new Set<string>();
let stagedProject: any;
let stagedProjectUrls = new Set<string>();

function createProjectObjectUrl(blob: Blob, owner = activeProjectUrls) {
  const url = URL.createObjectURL(blob);
  owner.add(url);
  return url;
}

function releaseObjectUrls(urls: Set<string>) {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}

function releaseProjectResources() {
  const previousUrls = activeProjectUrls;
  activeProjectUrls = new Set<string>();
  releaseObjectUrls(previousUrls);
  releaseObjectUrls(stagedProjectUrls);
  stagedProject = undefined;
  stagedProjectUrls = new Set<string>();
}

function stageProjectResources(project: any, urls: Set<string>) {
  releaseObjectUrls(stagedProjectUrls);
  stagedProject = project;
  stagedProjectUrls = urls;
}

function activateProjectResources(project?: any) {
  if (project === stagedProject) {
    const previousUrls = activeProjectUrls;
    activeProjectUrls = stagedProjectUrls;
    stagedProject = undefined;
    stagedProjectUrls = new Set<string>();
    releaseObjectUrls(previousUrls);
  } else if (!project) {
    releaseProjectResources();
  }
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function writeText(target: Uint8Array, offset: number, length: number, value: string) {
  target.set(strToU8(value).subarray(0, length), offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number) {
  writeText(target, offset, length, value.toString(8).padStart(length - 1, '0') + '\0');
}

function makeTar(items: TarItem[]) {
  const chunks: Uint8Array[] = [];
  for (const item of items) {
    const nameBytes = strToU8(item.name);
    if (nameBytes.length > 100) throw new Error(`TAR path is too long: ${item.name}`);
    const header = new Uint8Array(512);
    writeText(header, 0, 100, item.name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, item.data.length);
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(32, 148, 156);
    header[156] = 48;
    writeText(header, 257, 6, 'ustar\0');
    writeText(header, 263, 2, '00');
    const checksum = header.reduce((sum, value) => sum + value, 0);
    writeText(header, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
    chunks.push(header, item.data);
    const padding = (512 - (item.data.length % 512)) % 512;
    if (padding) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(1024));
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function readString(data: Uint8Array, start: number, length: number) {
  const bytes = data.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return strFromU8(end < 0 ? bytes : bytes.subarray(0, end));
}

function readOctal(data: Uint8Array, start: number, length: number) {
  return parseInt(readString(data, start, length).trim() || '0', 8);
}

function parsePax(data: Uint8Array) {
  const values: Record<string, string> = {};
  const text = strFromU8(data);
  let offset = 0;
  while (offset < text.length) {
    const space = text.indexOf(' ', offset);
    if (space < 0) break;
    const length = Number(text.slice(offset, space));
    const record = text.slice(space + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function parseTar(data: Uint8Array) {
  const result = new Map<string, Uint8Array>();
  let offset = 0;
  let longName = '';
  let pax: Record<string, string> = {};
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = readString(header, 345, 155);
    const shortName = readString(header, 0, 100);
    const name = pax.path || longName || (prefix ? `${prefix}/${shortName}` : shortName);
    // Keep a view into the TAR buffer instead of copying every resource. Large
    // projects can contain thousands of images, so per-entry copies cause a
    // considerable temporary memory spike in Android WebView.
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (type === 'L') longName = readString(body, 0, body.length);
    else if (type === 'x' || type === 'g') pax = { ...pax, ...parsePax(body) };
    else if (type === '0' || type === '\0') {
      result.set(name.replace(/^\.\//, ''), body);
      longName = '';
      pax = {};
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}

function ungzipIfNeeded(data: Uint8Array) {
  return data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
}

function asArrayBuffer(data: Uint8Array) {
  return new Uint8Array(data).buffer as ArrayBuffer;
}

function extensionFrom(file: File, fallback: string) {
  const match = file.name.match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1].toLowerCase()}` : fallback;
}

function baseName(name: string) {
  return name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

function urlForBundledResource(value: string) {
  if (!value || /^(blob:|data:|https?:|\/)/.test(value)) return value;
  return `/${value.replace(/^(\.\.\/)+/, '').replace(/^src\//, '')}`;
}

function isRestorableProject(project: any) {
  if (!project || !Array.isArray(project.objects) || project.objects.length === 0) return false;
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) return false;
  try {
    const serialized = JSON.stringify(project);
    return !serialized.includes('blob:') &&
      !serialized.includes('undefinedmedia/') &&
      !serialized.includes('nullmedia/');
  } catch {
    return false;
  }
}

async function imageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    const finish = (size: { width: number; height: number }) => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      resolve(size);
    };
    image.onload = () => finish({ width: image.naturalWidth || 960, height: image.naturalHeight || 540 });
    image.onerror = () => finish({ width: 960, height: 540 });
    image.src = url;
  });
}

async function soundDuration(url: string) {
  return new Promise<number>((resolve) => {
    const audio = new Audio();
    const finish = (duration: number) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.src = '';
      resolve(duration);
    };
    audio.onloadedmetadata = () => finish(Math.round((audio.duration || 0) * 10) / 10);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}

async function importPicture(file: File) {
  const id = randomId();
  const url = createProjectObjectUrl(file);
  const ext = extensionFrom(file, '.png');
  return {
    _id: randomId(), id: randomId(), type: 'user', name: baseName(file.name), filename: id,
    fileurl: url, extension: ext, ext, dimension: await imageSize(url),
    imageType: ext === '.svg' ? 'svg' : 'png'
  };
}

async function importSound(file: File) {
  const id = randomId();
  const url = createProjectObjectUrl(file);
  const ext = extensionFrom(file, '.mp3');
  return {
    _id: randomId(), type: 'user', name: baseName(file.name), filename: id,
    ext, fileurl: url, path: url, duration: await soundDuration(url)
  };
}

function importPictureFromResource(picture: any) {
  const filename = String(picture?.filename || '');
  const fallback = filename
    ? `renderer/resources/uploads/${filename.slice(0, 2)}/${filename.slice(2, 4)}/image/${filename}${picture?.ext || '.png'}`
    : '';
  const fileurl = urlForBundledResource(picture?.fileurl || fallback);
  return { ...picture, fileurl, thumbUrl: urlForBundledResource(picture?.thumbUrl || fileurl) };
}

function importSoundFromResource(sound: any) {
  const filename = String(sound?.filename || '');
  const fallback = filename
    ? `renderer/resources/uploads/${filename.slice(0, 2)}/${filename.slice(2, 4)}/sound/${filename}${sound?.ext || '.mp3'}`
    : '';
  const fileurl = urlForBundledResource(sound?.fileurl || fallback);
  return { ...sound, fileurl, path: fileurl };
}

function importObjectsFromResource(objects: any[]) {
  return objects.map((object) => ({
    ...object,
    pictures: (object?.pictures || []).map(importPictureFromResource),
    sounds: (object?.sounds || []).map(importSoundFromResource)
  }));
}

function normalizeFiles(values: unknown[]) {
  return values.filter((value): value is File => value instanceof File);
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

type ArchiveResource = readonly [string, Uint8Array];

function indexArchiveFiles(files: Map<string, Uint8Array>) {
  const index = new Map<string, ArchiveResource>();
  for (const [name, bytes] of files) {
    const kind = name.includes('/image/') ? 'image' : name.includes('/sound/') ? 'sound' : undefined;
    if (!kind) continue;
    const leaf = name.split('/').pop() || '';
    const stem = leaf.replace(/\.[^.]+$/, '');
    index.set(`${kind}:${leaf}`, [name, bytes]);
    index.set(`${kind}:${stem}`, [name, bytes]);
  }
  return index;
}

function locateArchiveFile(
  files: Map<string, Uint8Array>,
  index: Map<string, ArchiveResource>,
  resource: any,
  kind: 'image' | 'sound'
) {
  const fileurl = String(resource.fileurl || '').replace(/^(\.\.\/)+/, '').replace(/^\//, '');
  if (files.has(fileurl)) return [fileurl, files.get(fileurl)!] as const;
  const filename = String(resource.filename || '');
  if (filename) return index.get(`${kind}:${filename}`);
}

function resourceMime(extension: string, kind: 'image' | 'sound') {
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (kind === 'image') {
    return ({ svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg' } as Record<string, string>)[ext] || `image/${ext}`;
  }
  return ({ mp3: 'audio/mpeg', m4a: 'audio/mp4' } as Record<string, string>)[ext] || `audio/${ext}`;
}

function hydrateProject(project: any, files: Map<string, Uint8Array>, owner = activeProjectUrls) {
  const archiveUrls = new Map<string, string>();
  const archiveIndex = indexArchiveFiles(files);
  for (const object of project.objects || []) {
    for (const [kind, resources] of [['image', object.sprite?.pictures || []], ['sound', object.sprite?.sounds || []]] as const) {
      for (const resource of resources as any[]) {
        const found = locateArchiveFile(files, archiveIndex, resource, kind);
        if (found) {
          const ext = found[0].match(/\.[^.]+$/)?.[0] || (kind === 'image' ? '.png' : '.mp3');
          const mime = resourceMime(ext, kind);
          let resourceUrl = archiveUrls.get(found[0]);
          if (!resourceUrl) {
            resourceUrl = createProjectObjectUrl(new Blob([asArrayBuffer(found[1])], { type: mime }), owner);
            archiveUrls.set(found[0], resourceUrl);
          }
          resource.fileurl = resourceUrl;
          if (kind === 'sound') resource.path = resource.fileurl;
        } else if (resource.fileurl) resource.fileurl = urlForBundledResource(resource.fileurl);
      }
    }
  }
  return project;
}

async function loadProject(source: File | string) {
  if (!(source instanceof File)) throw new Error('Android에서는 파일 선택기로 .ent 파일을 선택해야 합니다.');
  const archive = parseTar(ungzipIfNeeded(new Uint8Array(await source.arrayBuffer())));
  const projectFile = [...archive.entries()].find(([name]) => /(^|\/)project\.json$/.test(name));
  if (!projectFile) throw new Error('project.json이 없는 .ent 파일입니다.');
  const project = JSON.parse(strFromU8(projectFile[1]));
  project.savedPath = source.name;
  const nextProjectUrls = new Set<string>();
  try {
    const hydratedProject = hydrateProject(project, archive, nextProjectUrls);
    // Workspace activates this set after EntryJS has disposed the old project.
    // Until then both the old and the newly parsed .ent resources must remain valid.
    stageProjectResources(hydratedProject, nextProjectUrls);
    return hydratedProject;
  } catch (error) {
    releaseObjectUrls(nextProjectUrls);
    throw error;
  }
}

async function projectArchive(projectInput: any) {
  const project = structuredClone(projectInput);
  const items: TarItem[] = [];
  const originalObjects = projectInput.objects || [];
  for (let objectIndex = 0; objectIndex < (project.objects || []).length; objectIndex += 1) {
    const targetObject = project.objects[objectIndex];
    const sourceObject = originalObjects[objectIndex] || {};
    for (const [kind, targetResources, sourceResources] of [
      ['image', targetObject.sprite?.pictures || [], sourceObject.sprite?.pictures || []],
      ['sound', targetObject.sprite?.sounds || [], sourceObject.sprite?.sounds || []]
    ] as const) {
      for (let index = 0; index < targetResources.length; index += 1) {
        const target = targetResources[index];
        const source = sourceResources[index] || target;
        const url = String(source.fileurl || source.path || '');
        if (!/^(blob:|data:)/.test(url)) continue;
        const response = await fetch(url);
        const data = new Uint8Array(await response.arrayBuffer());
        const id = String(target.filename || randomId());
        const ext = String(target.ext || target.extension || (kind === 'image' ? '.png' : '.mp3'));
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        const directory = `${id.slice(0, 2)}/${id.slice(2, 4)}/${kind}`;
        const archiveName = `temp/${directory}/${id}${normalizedExt}`;
        items.push({ name: archiveName, data });
        target.filename = id;
        target.fileurl = archiveName;
        if (kind === 'sound') target.path = archiveName;
      }
    }
  }
  delete project.savedPath;
  items.unshift({ name: 'temp/project.json', data: strToU8(JSON.stringify(project)) });
  return gzipSync(makeTar(items), { level: 6 });
}

function bytesToBase64(data: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function download(data: Uint8Array | Blob, filename: string, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([asArrayBuffer(data)], { type: mime });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => { URL.revokeObjectURL(anchor.href); anchor.remove(); }, 1000);
}

async function saveNative(data: Uint8Array, filename: string) {
  const { token } = await EntryFile.beginSave({ filename, mimeType: 'application/gzip' });
  try {
    for (let offset = 0; offset < data.length; offset += 256 * 1024) {
      await EntryFile.appendSave({ token, data: bytesToBase64(data.subarray(offset, offset + 256 * 1024)) });
    }
    await EntryFile.finishSave({ token });
  } catch (error) {
    await EntryFile.abortSave({ token }).catch(() => undefined);
    throw error;
  }
}

async function saveProject(project: any, targetPath: string) {
  const data = await projectArchive(project);
  const filename = `${String(targetPath || project.name || 'Entry').replace(/\.ent$/i, '')}.ent`;
  if (win.Capacitor?.isNativePlatform?.()) await saveNative(data, filename);
  else download(data, filename, 'application/gzip');
}

function chooseFiles(options: any) {
  return new Promise<{ filePaths: File[]; canceled: boolean }>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = options?.properties?.includes('multiSelections') || false;
    const extensions = (options?.filters || []).flatMap((filter: any) => filter.extensions || []).filter((ext: string) => ext !== '*');
    if (extensions.length) input.accept = extensions.map((ext: string) => `.${ext}`).join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.remove();
      resolve({ filePaths: files, canceled: files.length === 0 });
    }, { once: true });
    input.click();
  });
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += character;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function invoke(channel: string, ...args: any[]): Promise<any> {
  switch (channel) {
    case 'loadProject': return loadProject(args[0]);
    case 'saveProject': return saveProject(args[0], args[1]);
    // Workspace performs resource cleanup at the safe point after EntryJS has
    // disposed its current image loader.
    case 'resetDirectory': return undefined;
    case 'isValidAsarFile': return true;
    case 'checkUpdate': return ['2.1.35', { hasNewVersion: false, recentVersion: '2.1.35' }];
    case 'importPictures': return mapWithConcurrency(normalizeFiles(args[0] || []), 6, importPicture);
    case 'importSounds': return mapWithConcurrency(normalizeFiles(args[0] || []), 4, importSound);
    case 'importObjectsFromResource': return importObjectsFromResource(args[0] || []);
    case 'importPicturesFromResource': return (args[0] || []).map(importPictureFromResource);
    case 'importSoundsFromResource': return (args[0] || []).map(importSoundFromResource);
    case 'getExistSoundFilePath': return urlForBundledResource(args[0]?.fileurl || `renderer/resources/uploads/${args[0]?.filename?.slice(0, 2)}/${args[0]?.filename?.slice(2, 4)}/sound/${args[0]?.filename}${args[0]?.ext || '.mp3'}`);
    case 'importPictureFromCanvas': {
      const image = args[0]?.image;
      const blob = image instanceof Blob ? image : await (await fetch(image)).blob();
      return importPicture(new File([blob], `${randomId()}.png`, { type: 'image/png' }));
    }
    case 'saveSoundBuffer': {
      const filename = randomId();
      const blob = new Blob([args[0]], { type: 'audio/wav' });
      const filePath = createProjectObjectUrl(blob);
      return { duration: await soundDuration(filePath), filename, filePath };
    }
    case 'createTableInfo': {
      const results = [];
      for (const file of normalizeFiles(args[0] || [])) {
        const rows = parseCsv(await file.text());
        const id = randomId();
        const fields = rows.shift() || [];
        tables.set(id, { chart: [], fields, rows: rows.length, data: rows, name: file.name });
        results.push({ id, name: file.name });
      }
      return results;
    }
    case 'getTable': return tables.get(args[0]);
    case 'writeFile': return download(args[0] instanceof Uint8Array ? args[0] : strToU8(String(args[0])), args[1] || 'download');
    case 'staticDownload': return download(new Blob([]), String(args[1] || 'download'));
    case 'tempResourceDownload': {
      const url = args[0]?.fileurl;
      if (url) download(await (await fetch(urlForBundledResource(url))).blob(), args[2] || args[0]?.filename || 'resource');
      return undefined;
    }
    case 'saveExcel': return download(strToU8((args[1] || []).join('\n')), args[0] || 'table.csv', 'text/csv');
    case 'captureBlockImage': case 'exportObject': case 'importObjects': return [];
    case 'getPapagoHeaderInfo': return {};
    default: console.info(`[Entry Mobile] Ignored Electron IPC channel: ${channel}`); return undefined;
  }
}

const dialog = {
  showOpenDialog: chooseFiles,
  showSaveDialog: async (options: any) => ({ filePath: options?.defaultPath || 'Entry.ent', canceled: false }),
  showSaveDialogSync: (options: any) => options?.defaultPath || 'Entry.ent'
};

win.dialog = dialog;
win.isOsx = false;
win.isOffline = true;
win.isMobileApp = true;
win.ipcInvoke = invoke;
win.ipcSend = () => undefined;
win.ipcListen = () => ({ on: () => undefined });
win.onPageLoaded = (callback: () => void) => {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(callback), { once: true });
  else setTimeout(callback);
};
win.onLoadProjectFromMain = () => undefined;
const sharedObject = { version: '2.1.35', roomIds: [] as string[], file: undefined as File | string | undefined };
win.getSharedObject = () => sharedObject;
win.initNativeMenu = () => undefined;
win.getLang = (key: string) => key.split('.').reduce((value: any, part) => value?.[part], win.Lang) || key;
win.openEntryWebPage = () => win.open('https://playentry.org/download/offline', '_blank');
win.openHardwarePage = () => console.info('[Entry Mobile] Hardware connection is disabled.');
win.checkPermission = async (type: 'microphone' | 'camera') => {
  const stream = await navigator.mediaDevices?.getUserMedia(type === 'microphone' ? { audio: true } : { video: true });
  stream?.getTracks().forEach((track) => track.stop());
};
win.getPapagoHeaderInfo = async () => ({});
win.weightsPath = () => '/entry-js/weights';
win.getEntryjsPath = () => '/entry-js';
win.getAppPathWithParams = (...parts: string[]) => `/${parts.join('/')}`;
win.releaseEntryMobileProjectResources = releaseProjectResources;
win.activateEntryMobileProjectResources = activateProjectResources;
win.isRestorableEntryMobileProject = isRestorableProject;
win.__ENTRY_MOBILE_TEST__ = {
  makeTar, parseTar, ungzipIfNeeded, hydrateProject, releaseObjectUrls, resourceMime,
  isRestorableProject, importObjectsFromResource, stageProjectResources, activateProjectResources
};

console.info('[Entry Mobile] Android browser bridge ready');
