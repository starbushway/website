// Runs `hugo server` on the local copy of the website, so the preview shows exactly what
// will be published and updates by itself after every save. The installed app ships its
// own hugo.exe; during development the one on PATH is used.
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

let child: ChildProcess | null = null;
let base: string | null = null;

function hugoBinary(): string {
  const exe = process.platform === 'win32' ? 'hugo.exe' : 'hugo';
  const bundled = path.join(process.resourcesPath, 'hugo', exe);
  return app.isPackaged && fs.existsSync(bundled) ? bundled : exe;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Starts the preview server once and returns its address, e.g. http://127.0.0.1:51234/ */
export async function startPreview(siteDir: string): Promise<string> {
  if (base) return base;
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  child = spawn(hugoBinary(), [
    'server', '--source', siteDir, '--bind', '127.0.0.1', '--port', String(port),
    '--baseURL', url, '--appendPort=false', '--disableFastRender', '--renderToMemory',
  ], { windowsHide: true });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Die Vorschau startet nicht.')), 120_000);
    const onData = (data: Buffer) => {
      if (data.toString().includes('Web Server is available')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child!.stdout?.on('data', onData);
    child!.stderr?.on('data', (d: Buffer) => console.error('[hugo]', d.toString().trim()));
    child!.once('error', (e) => { clearTimeout(timer); reject(e); });
    child!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Hugo beendet (${code})`)); });
  });
  child.once('exit', () => { child = null; base = null; });
  base = url;
  return url;
}

export function stopPreview(): void {
  child?.kill();
  child = null;
  base = null;
}
