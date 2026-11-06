// Two "PCs" edit the same website and publish one after the other, against a local git
// server. Needs `npm run build:main` first (npm test does not build).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { startGitServer } from './git-server.mjs';

const require = createRequire(import.meta.url);
const repo = require('../dist-electron/electron/repo.js');

const tmp = mkdtempSync(join(tmpdir(), 'starbush-repo-'));
const page = 'site/content/katzen/luna/index.md';
const PAGE = '---\ntitle: "Luna"\n---\n\nZeile 1\n\nZeile 2\n\nZeile 3\n\nZeile 4\n\nZeile 5\n';
let server;
let url;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const opts = (name) => ({ dir: join(tmp, name), url, branch: 'main', token: 'test', authorName: name });
const read = (name, file) => readFileSync(join(tmp, name, file), 'utf8');
const write = (name, file, text) => {
  mkdirSync(join(tmp, name, file, '..'), { recursive: true });
  writeFileSync(join(tmp, name, file), text);
};
/** What is published: the file as the server has it. */
const published = (file) => git(join(tmp, 'remote', 'website.git'), 'show', `main:${file}`);

before(async () => {
  const seed = join(tmp, 'seed');
  mkdirSync(join(seed, 'site/content/katzen/luna'), { recursive: true });
  writeFileSync(join(seed, page), PAGE);
  writeFileSync(join(seed, 'site/content/katzen/luna/alt.jpg'), Buffer.from([0xff, 0xd8, 0, 1, 2]));
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'add', '.');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'start');
  mkdirSync(join(tmp, 'remote'));
  git(join(tmp, 'remote'), 'clone', '-q', '--bare', seed, 'website.git');
  server = await startGitServer(join(tmp, 'remote'));
  url = `http://127.0.0.1:${server.address().port}/website.git`;
  await repo.clone(opts('pc1'), () => {});
  await repo.clone(opts('pc2'), () => {});
});

after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('edits from two PCs to different lines of one page are both kept', async () => {
  write('pc1', page, PAGE.replace('Zeile 2', 'Zeile 2 von PC1'));
  write('pc1', 'site/content/katzen/luna/neu.jpg', Buffer.from([0xff, 0xd8, 9, 9]));
  write('pc2', page, PAGE.replace('Zeile 4', 'Zeile 4 von PC2'));
  rmSync(join(tmp, 'pc2', 'site/content/katzen/luna/alt.jpg'));

  assert.deepEqual((await repo.changes(opts('pc1'))).map((c) => c.kind).sort(), ['geändert', 'neu']);
  await repo.publish(opts('pc1'), () => {});
  await repo.publish(opts('pc2'), () => {}); // must merge PC1's work first

  const text = published(page);
  assert.match(text, /Zeile 2 von PC1/);
  assert.match(text, /Zeile 4 von PC2/);
  const files = git(join(tmp, 'remote', 'website.git'), 'ls-tree', '-r', '--name-only', 'main');
  assert.match(files, /luna\/neu\.jpg/);
  assert.doesNotMatch(files, /luna\/alt\.jpg/);
  assert.deepEqual(await repo.changes(opts('pc2')), []);
});

test('a PC without edits catches up on start', async () => {
  const result = await repo.sync(opts('pc1'));
  assert.deepEqual(result, { updated: true, skippedBecauseLocalChanges: false });
  assert.match(read('pc1', page), /Zeile 4 von PC2/);
  assert.ok(!existsSync(join(tmp, 'pc1', 'site/content/katzen/luna/alt.jpg')));
});

test('unpublished edits are never overwritten by catching up', async () => {
  write('pc2', page, read('pc2', page).replace('Zeile 5', 'Zeile 5 von PC2'));
  await repo.publish(opts('pc2'), () => {});
  write('pc1', page, read('pc1', page).replace('Zeile 1', 'Zeile 1 von PC1'));
  const result = await repo.sync(opts('pc1'));
  assert.equal(result.skippedBecauseLocalChanges, true);
  assert.match(read('pc1', page), /Zeile 1 von PC1/);
  await repo.publish(opts('pc1'), () => {});
  assert.match(published(page), /Zeile 1 von PC1[\s\S]*Zeile 5 von PC2/);
});

test('when both change the same line, the later publisher wins without asking', async () => {
  await repo.sync(opts('pc2'));
  write('pc1', page, read('pc1', page).replace('Zeile 3', 'Zeile 3 – PC1'));
  write('pc2', page, read('pc2', page).replace('Zeile 3', 'Zeile 3 – PC2'));
  await repo.publish(opts('pc1'), () => {});
  await repo.publish(opts('pc2'), () => {});
  const text = published(page);
  assert.match(text, /Zeile 3 – PC2/);
  assert.doesNotMatch(text, /<<<<<<<|>>>>>>>/);
  assert.doesNotMatch(text, /Zeile 3 – PC1/);
});

test('a new page from one PC and an edit from the other both arrive', async () => {
  await repo.sync(opts('pc1'));
  await repo.sync(opts('pc2'));
  write('pc1', 'site/content/katzen/neu/index.md', '---\ntitle: "Neu"\n---\n\nHallo\n');
  write('pc2', page, read('pc2', page).replace('Zeile 1', 'Zeile 1 (neu)'));
  await repo.publish(opts('pc2'), () => {});
  await repo.publish(opts('pc1'), () => {});
  assert.match(published('site/content/katzen/neu/index.md'), /Hallo/);
  assert.match(published(page), /Zeile 1 \(neu\)/);
});

test('discard brings back the published state, removing new files', async () => {
  await repo.sync(opts('pc1'));
  write('pc1', page, 'kaputt');
  write('pc1', 'site/content/katzen/weg/index.md', 'weg');
  await repo.discard(opts('pc1'));
  assert.equal(read('pc1', page), published(page) + '\n');
  assert.ok(!existsSync(join(tmp, 'pc1', 'site/content/katzen/weg')));
  assert.deepEqual(await repo.changes(opts('pc1')), []);
});
