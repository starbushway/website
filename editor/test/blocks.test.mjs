// Checks that every real page survives being opened in the editor unchanged.
// Run with: npm test   (bundles src/app/blocks.ts with esbuild first)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { readFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'blocks-')), 'blocks.mjs');
buildSync({ entryPoints: [join(here, '../src/app/blocks.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { parseBody, serializeBody, markdownToHtml, htmlToMarkdown } = await import(pathToFileURL(out));

const contentDir = join(here, '../../site/content');
function* pages(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* pages(p);
    else if (/^_?index\.md$/.test(name)) yield p;
  }
}
const bodyOf = (file) => readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n\s*/, '');
// Blank-line runs and trailing spaces are not meaningful in Markdown.
const norm = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

test('every page is written back unchanged when nothing was edited', () => {
  let n = 0;
  for (const file of pages(contentDir)) {
    const body = bodyOf(file);
    assert.equal(norm(serializeBody(parseBody(body))), norm(body), file);
    n++;
  }
  assert.ok(n > 150, `only ${n} pages found`);
});

test('photo rows are recognised, including linked photos', () => {
  const blocks = parseBody('Text\n\n![](a.jpg)\n[![](b.jpg)](/katzen/x/)\n\n**fett**');
  assert.deepEqual(blocks.map((b) => b.kind), ['text', 'photos', 'text']);
  assert.deepEqual(blocks[1].photos, [{ alt: '', src: 'a.jpg' }, { alt: '', src: 'b.jpg', href: '/katzen/x/' }]);
});

test('editing a photo row writes standard Markdown', () => {
  const blocks = parseBody('![](a.jpg) ![](b.jpg)');
  blocks[0] = { ...blocks[0], photos: blocks[0].photos.reverse(), raw: undefined };
  assert.equal(serializeBody(blocks), '![](b.jpg)\n![](a.jpg)\n');
});
