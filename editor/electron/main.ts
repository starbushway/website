import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PageContent, Progress, SetupInput } from '../src/app/api';
import { Content } from './content';
import { startPreview, stopPreview } from './hugo';
import * as repo from './repo';
import { decryptToken, encryptToken, loadSettings, repoDir, saveSettings } from './settings';

const DEV_URL = process.env['STARBUSH_DEV_URL'];
// Lets one machine act as several editor PCs when testing.
if (process.env['STARBUSH_USER_DATA']) app.setPath('userData', process.env['STARBUSH_USER_DATA']);
const RENDERER_DIR = path.join(__dirname, '..', '..', 'dist', 'editor', 'browser');

// app:// serves the built UI; seite:// shows the website's photos inside the editor.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'seite', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let window: BrowserWindow | null = null;
const siteDir = () => path.join(repoDir(), 'site');
const content = () => new Content(siteDir());

async function repoOptions(): Promise<repo.RepoOptions> {
  const s = loadSettings();
  return { dir: repoDir(), url: s.repoUrl, branch: s.branch, token: await decryptToken(s), authorName: s.editorName };
}

const progress = (p: Progress) => window?.webContents.send('progress', p);

// Git operations must not overlap (e.g. an autosave while publishing).
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T> | T): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (_event, ...args) => serial(() => fn(...args)));
}

handle('getState', () => {
  const s = loadSettings();
  return {
    configured: !!s.token,
    cloned: repo.isCloned(repoDir()),
    editorName: s.editorName,
    repoUrl: s.repoUrl,
  };
});

handle('setup', async (input: SetupInput) => {
  const s = loadSettings();
  saveSettings({ ...s, repoUrl: input.repoUrl.trim(), editorName: input.editorName.trim(), token: await encryptToken(input.token.trim()) });
  if (!repo.isCloned(repoDir())) await repo.clone(await repoOptions(), progress);
});

handle('sync', async () => repo.sync(await repoOptions()));
handle('listPages', () => content().listPages());
handle('readPage', (dir: string) => content().readPage(dir));
handle('savePage', (dir: string, page: PageContent) => content().savePage(dir, page));
handle('addImage', (dir: string, name: string, data: ArrayBuffer) => content().addImage(dir, name, data));
handle('createPage', (sectionDir: string, title: string) => content().createPage(sectionDir, title));
handle('linkingPages', (dir: string) => content().linkingPages(dir));
handle('deletePage', (dir: string) => content().deletePage(dir));
handle('changes', async () => repo.changes(await repoOptions()));
handle('discard', async () => repo.discard(await repoOptions()));
handle('previewBase', () => startPreview(siteDir()));

handle('publish', async () => {
  const o = await repoOptions();
  const pages = content();
  for (const c of await repo.changes(o)) {
    // Photos taken off a page are deleted, and so are new photos that were undone again.
    const page = /^site\/content\/(?:(.*)\/)?_?index\.md$/.exec(c.path);
    if (page && c.kind === 'geändert') {
      const published = await repo.publishedText(o, c.path);
      if (published) pages.removeDroppedImages(page[1] ?? '', published);
    }
    const photo = /^site\/content\/(?:(.*)\/)?([^/]+\.(?:jpe?g|png|gif|webp))$/i.exec(c.path);
    if (photo && c.kind === 'neu' && !pages.isReferenced(photo[1] ?? '', photo[2]!)) {
      fs.rmSync(path.join(repoDir(), c.path), { force: true });
    }
  }
  await repo.publish(o, progress);
});

function serveFiles() {
  protocol.handle('app', (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(RENDERER_DIR, rel);
    const safe = file.startsWith(RENDERER_DIR + path.sep) ? file : path.join(RENDERER_DIR, 'index.html');
    return net.fetch(pathToFileURL(safe).toString());
  });
  // seite://site/katzen/zuchtluna/luna.jpg, seite://site/bilder/royaltybar.gif
  protocol.handle('seite', async (request) => {
    const url = new URL(request.url);
    const file = content().resolveAsset(decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!file) return new Response('Nicht gefunden', { status: 404 });
    // The image editor reads the pixels, which needs CORS from the app's own pages.
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', DEV_URL ? new URL(DEV_URL).origin : 'app://editor');
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Starbushway – Website bearbeiten',
    backgroundColor: '#fdf6f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Links to other websites open in the normal browser, never inside the editor.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(DEV_URL ?? 'app://')) event.preventDefault();
  });
  void window.loadURL(DEV_URL ?? 'app://editor/index.html');
}

app.whenReady().then(() => {
  serveFiles();
  createWindow();
});

app.on('window-all-closed', () => {
  stopPreview();
  app.quit();
});
