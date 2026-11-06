// The website repository on this PC, handled with isomorphic-git so no git installation
// is needed. Several PCs may edit at once: publishing replays this PC's changed files on
// top of the newest published version, merging text line by line; where both PCs changed
// the same lines, this PC's version wins. No questions are asked.
import * as fs from 'node:fs';
import * as path from 'node:path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import diff3Merge from 'diff3';
import type { Change, Progress, SyncResult } from '../src/app/api';

export interface RepoOptions {
  dir: string;
  url: string;
  branch: string;
  token: string;
  authorName: string;
}

type ProgressFn = (p: Progress) => void;

/** Only the website's files are edited; the rest of the repository is left alone. */
const EDITABLE = ['site'];

const auth = (o: RepoOptions) => () => ({ username: 'x-access-token', password: o.token });
const author = (o: RepoOptions) => ({
  name: o.authorName || 'Starbushway Editor',
  email: 'editor@starbushway.de',
});
const remoteRef = (o: RepoOptions) => `refs/remotes/origin/${o.branch}`;

export function isCloned(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'));
}

export async function clone(o: RepoOptions, onProgress: ProgressFn): Promise<void> {
  // A half-finished earlier attempt would make clone fail, so start from an empty folder.
  fs.rmSync(o.dir, { recursive: true, force: true });
  fs.mkdirSync(o.dir, { recursive: true });
  await git.clone({
    fs, http, dir: o.dir, url: o.url, ref: o.branch, singleBranch: true,
    onAuth: auth(o),
    onProgress: (e) => onProgress({
      phase: 'Website wird heruntergeladen',
      percent: e.total ? Math.round((e.loaded / e.total) * 100) : -1,
    }),
  });
}

/** Files under site/ that differ from the last published version. */
export async function changes(o: RepoOptions): Promise<Change[]> {
  const rows = await git.statusMatrix({ fs, dir: o.dir, filepaths: EDITABLE });
  const result: Change[] = [];
  for (const [filepath, head, workdir] of rows) {
    if (head === 1 && workdir === 1) continue;
    if (head === 0 && workdir === 0) continue;
    result.push({
      path: filepath,
      kind: head === 0 ? 'neu' : workdir === 0 ? 'gelöscht' : 'geändert',
    });
  }
  return result;
}

/** Brings this PC up to the newest published version, unless there are unpublished edits. */
export async function sync(o: RepoOptions): Promise<SyncResult> {
  await git.fetch({ fs, http, dir: o.dir, ref: o.branch, singleBranch: true, onAuth: auth(o) });
  const local = await git.resolveRef({ fs, dir: o.dir, ref: o.branch });
  const remote = await git.resolveRef({ fs, dir: o.dir, ref: remoteRef(o) });
  if (local === remote) return { updated: false, skippedBecauseLocalChanges: false };
  if ((await changes(o)).length) return { updated: false, skippedBecauseLocalChanges: true };
  await moveTo(o, remote);
  return { updated: true, skippedBecauseLocalChanges: false };
}

/** Throws away every unpublished edit. */
export async function discard(o: RepoOptions): Promise<void> {
  for (const c of await changes(o)) {
    if (c.kind === 'neu') fs.rmSync(path.join(o.dir, c.path), { force: true });
  }
  await git.checkout({ fs, dir: o.dir, ref: o.branch, force: true });
  removeEmptyFolders(path.join(o.dir, 'site', 'content'));
}

export async function publish(o: RepoOptions, onProgress: ProgressFn): Promise<void> {
  const changed = await changes(o);
  if (!changed.length) return;
  onProgress({ phase: 'Änderungen werden vorbereitet', percent: -1 });

  // Commit locally first, so the edits are safe even if the upload fails halfway.
  const base = await git.resolveRef({ fs, dir: o.dir, ref: o.branch });
  for (const c of changed) {
    if (c.kind === 'gelöscht') await git.remove({ fs, dir: o.dir, filepath: c.path });
    else await git.add({ fs, dir: o.dir, filepath: c.path });
  }
  const message = `Website bearbeitet von ${author(o).name}\n\n` +
    changed.map((c) => `${c.kind}: ${c.path.replace(/^site\/content\//, '')}`).join('\n');
  const ours = await git.commit({ fs, dir: o.dir, message, author: author(o) });

  for (let attempt = 1; ; attempt++) {
    onProgress({ phase: 'Neueste Version wird geholt', percent: -1 });
    await git.fetch({ fs, http, dir: o.dir, ref: o.branch, singleBranch: true, onAuth: auth(o) });
    const remote = await git.resolveRef({ fs, dir: o.dir, ref: remoteRef(o) });

    if (remote !== base) {
      // Someone else published meanwhile: start from their version and replay ours.
      onProgress({ phase: 'Änderungen anderer werden übernommen', percent: -1 });
      const replay = await Promise.all(changed.map((c) => mergedFile(o, c.path, base, ours, remote)));
      await moveTo(o, remote);
      for (const { filepath, content } of replay) {
        const target = path.join(o.dir, filepath);
        if (content === null) {
          fs.rmSync(target, { force: true });
          await git.remove({ fs, dir: o.dir, filepath });
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content);
          await git.add({ fs, dir: o.dir, filepath });
        }
      }
      removeEmptyFolders(path.join(o.dir, 'site', 'content'));
      await git.commit({ fs, dir: o.dir, message, author: author(o) });
    }

    onProgress({ phase: 'Website wird veröffentlicht', percent: -1 });
    try {
      await git.push({ fs, http, dir: o.dir, ref: o.branch, onAuth: auth(o) });
      return;
    } catch (e) {
      // Rejected because another PC published in the last seconds: replay again.
      if (attempt >= 3 || !isRejected(e)) throw e;
    }
  }
}

function isRejected(e: unknown): boolean {
  const err = e as { code?: string; data?: { reason?: string } };
  return err?.code === 'PushRejectedError';
}

/** Points the branch at `sha` and makes the files on disk match it. */
async function moveTo(o: RepoOptions, sha: string): Promise<void> {
  await git.writeRef({ fs, dir: o.dir, ref: `refs/heads/${o.branch}`, value: sha, force: true });
  await git.checkout({ fs, dir: o.dir, ref: o.branch, force: true });
}

/** A file as it was last published from this PC, or null if it is new. */
export async function publishedText(o: RepoOptions, filepath: string): Promise<string | null> {
  const head = await git.resolveRef({ fs, dir: o.dir, ref: o.branch });
  const blob = await blobAt(o, head, filepath);
  return blob ? decode(blob) : null;
}

async function blobAt(o: RepoOptions, oid: string, filepath: string): Promise<Uint8Array | null> {
  try {
    return (await git.readBlob({ fs, dir: o.dir, oid, filepath })).blob;
  } catch {
    return null;
  }
}

/** This PC's version of a file, merged with the other PC's edits where possible. */
async function mergedFile(o: RepoOptions, filepath: string, base: string, ours: string, theirs: string) {
  const [b, a, t] = await Promise.all([
    blobAt(o, base, filepath), blobAt(o, ours, filepath), blobAt(o, theirs, filepath),
  ]);
  let content: Uint8Array | null = a;
  if (a && b && t && isText(a) && isText(b) && isText(t)) {
    content = Buffer.from(mergeText(decode(b), decode(a), decode(t)), 'utf8');
  }
  return { filepath, content };
}

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const isText = (bytes: Uint8Array) => !bytes.subarray(0, 8000).includes(0);
const LINES = /^.*(\r?\n|$)/gm;

/** Three-way line merge; where both sides changed the same lines, ours wins. */
export function mergeText(base: string, ours: string, theirs: string): string {
  const result = diff3Merge(ours.match(LINES) ?? [], base.match(LINES) ?? [], theirs.match(LINES) ?? []);
  return result.map((r) => (r.ok ?? r.conflict!.a).join('')).join('');
}

function removeEmptyFolders(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    removeEmptyFolders(sub);
    if (!fs.readdirSync(sub).length) fs.rmdirSync(sub);
  }
}
