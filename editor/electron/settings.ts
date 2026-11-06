// Settings live in the app's user-data folder. The GitHub token is encrypted with the
// operating system's key store (DPAPI on Windows, Keychain on macOS) via safeStorage.
import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Settings {
  repoUrl: string;
  editorName: string;
  /** Encrypted token, base64. */
  token: string;
  /** Branch that publishes the site. */
  branch: string;
}

const DEFAULTS: Settings = {
  repoUrl: 'https://github.com/starbushway/website.git',
  editorName: '',
  token: '',
  branch: 'main',
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

/** Folder that holds the website repository on this PC. */
export const repoDir = () =>
  process.env['STARBUSH_REPO_DIR'] || path.join(app.getPath('userData'), 'website');

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
}

export async function encryptToken(token: string): Promise<string> {
  return (await safeStorage.encryptStringAsync(token)).toString('base64');
}

export async function decryptToken(settings: Settings): Promise<string> {
  if (!settings.token) throw new Error('Kein Zugangsschlüssel gespeichert.');
  return (await safeStorage.decryptStringAsync(Buffer.from(settings.token, 'base64'))).result;
}
