// Photo sizes, page deletion and the image adjustments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'starbush-features-'));
const bundle = (entry) => {
  const out = join(tmp, entry.replace(/\W/g, '_') + '.mjs');
  buildSync({ entryPoints: [join(here, '..', entry)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  return import(pathToFileURL(out));
};
const { parseBody, serializeBody } = await bundle('src/app/blocks.ts');
const { applyAdjustments, autoAdjust, NEUTRAL } = await bundle('src/app/adjust.ts');
const { Content, unlink } = createRequire(import.meta.url)('../dist-electron/electron/content.js');

// ---------------------------------------------------------------- photo sizes

test('a photo size is read from and written to the image title', () => {
  const blocks = parseBody('![](a.jpg "klein")\n[![](b.jpg "voll")](/x/)\n![](c.jpg)');
  assert.deepEqual(blocks[0].photos.map((p) => p.size), ['klein', 'voll', undefined]);
  blocks[0] = { ...blocks[0], raw: undefined, photos: blocks[0].photos.map((p) => ({ ...p, size: 'gross' })) };
  assert.equal(serializeBody(blocks), '![](a.jpg "gross")\n[![](b.jpg "gross")](/x/)\n![](c.jpg "gross")\n');
});

// ---------------------------------------------------------------- page deletion

test('unlink drops linked photos, keeps link text, handles old addresses', () => {
  const body = [
    'Unsere Mädchen',
    '[![](/bilder/luna.jpg)](/katzen/luna/) ![](/bilder/mia.jpg)',
    'Mehr über [**Luna**](/katzen/luna/) und [Mia](/katzen/mia/), alt: [hier](/zuchtluna.html).',
    '![](/katzen/luna/foto.jpg "mittel")',
    '[Luna 2](/katzen/luna-2/)',
  ].join('\n\n');
  const out = unlink(body, ['/katzen/luna', '/zuchtluna.html']);
  assert.equal(out, [
    'Unsere Mädchen',
    '![](/bilder/mia.jpg)',
    'Mehr über **Luna** und [Mia](/katzen/mia/), alt: hier.',
    '',
    '[Luna 2](/katzen/luna-2/)',
  ].join('\n\n').replace(/\n{3,}/g, '\n\n'));
  assert.equal(unlink('nichts hier', ['/katzen/luna']), null);
});

test('deleting a page removes its folder and every reference to it', () => {
  const site = join(tmp, 'site');
  const c = join(site, 'content');
  const page = (dir, file, fm, body) => {
    mkdirSync(join(c, dir), { recursive: true });
    writeFileSync(join(c, dir, file), `---\n${fm}\n---\n\n${body}\n`);
  };
  page('', '_index.md', 'title: "Start"', 'Hallo [Luna](/katzen/luna/)');
  page('katzen', '_index.md', 'title: "Katzen"\nmenu:\n  main:\n    weight: 4', '[![](/bilder/l.jpg)](/katzen/luna/)\n\nRest');
  page('katzen/luna', 'index.md', 'title: "Luna"\naliases:\n  - "/zuchtluna.html"', '![](luna.jpg)');
  writeFileSync(join(c, 'katzen/luna/luna.jpg'), 'x');
  page('katzen/mia', 'index.md', 'title: "Mia"', 'Schwester von [Luna](/zuchtluna.html)');

  const content = new Content(site);
  assert.deepEqual(content.linkingPages('katzen/luna').map((p) => p.title).sort(), ['Katzen', 'Mia', 'Startseite']);
  const changed = content.deletePage('katzen/luna');
  assert.equal(changed.length, 3);
  assert.ok(!existsSync(join(c, 'katzen/luna')));
  assert.match(readFileSync(join(c, '_index.md'), 'utf8'), /Hallo Luna\n/);
  assert.doesNotMatch(readFileSync(join(c, 'katzen/_index.md'), 'utf8'), /luna/);
  assert.match(readFileSync(join(c, 'katzen/mia/index.md'), 'utf8'), /Schwester von Luna/);
  assert.throws(() => content.deletePage('katzen'), /Menübereiche/);
});

// ---------------------------------------------------------------- adjustments

const image = (pixels) => {
  const data = new Uint8ClampedArray(pixels.flatMap((p) => [...p, 255]));
  return { width: pixels.length, height: 1, data };
};
const rgb = (img, i = 0) => [...img.data.slice(i * 4, i * 4 + 3)];

test('neutral settings leave the picture untouched', () => {
  const img = image([[10, 120, 240], [200, 50, 90]]);
  const before = [...img.data];
  applyAdjustments(img, NEUTRAL);
  assert.deepEqual([...img.data], before);
});

test('each light and colour control moves pixels the expected way', () => {
  const run = (adj, px = [100, 100, 100]) => { const i = image([px]); applyAdjustments(i, { ...NEUTRAL, ...adj }); return rgb(i); };
  assert.ok(run({ belichtung: 1 })[0] > 150, 'exposure +1 roughly doubles');
  assert.ok(run({ helligkeit: 50 })[0] > 100);
  assert.ok(run({ kontrast: 50 }, [60, 60, 60])[0] < 60, 'contrast darkens darks');
  assert.ok(run({ schatten: 80 }, [30, 30, 30])[0] > 30, 'shadows lift dark areas');
  assert.ok(run({ lichter: -80 }, [235, 235, 235])[0] < 235, 'highlights recover bright areas');
  assert.ok(run({ schwarzpunkt: 50 }, [30, 30, 30])[0] < 30);
  const warm = run({ waerme: 80 });
  assert.ok(warm[0] > warm[2], 'warmer = more red than blue');
  const grey = run({ saettigung: -100 }, [200, 50, 50]);
  assert.ok(Math.abs(grey[0] - grey[1]) <= 1 && Math.abs(grey[1] - grey[2]) <= 1, 'no saturation = grey');
});

test('sharpening increases local contrast at an edge', () => {
  const w = 5, h = 3;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x < 2 ? 80 : 160;
    data.set([v, v, v, 255], (y * w + x) * 4);
  }
  const img = { width: w, height: h, data };
  applyAdjustments(img, { ...NEUTRAL, schaerfe: 100 });
  const at = (x) => img.data[(1 * w + x) * 4];
  assert.ok(at(1) < 80 && at(2) > 160, `edge not sharpened: ${at(1)} ${at(2)}`);
});

test('automatic correction brightens a dull, dark picture', () => {
  const pixels = Array.from({ length: 400 }, (_, i) => { const v = 20 + (i % 100); return [v, v, v]; });
  const a = autoAdjust(image(pixels));
  assert.ok(a.belichtung > 0.5, `exposure ${a.belichtung}`);
});
