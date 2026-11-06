// Reads and writes the Hugo pages in site/content. Each page is a folder with index.md
// (or _index.md for menu sections) and its photos. Front matter is kept as written; only
// the title line is replaced when the title changes.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PageContent, PageInfo } from '../src/app/api';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const LINK_TARGET = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const IMAGE_FILE = /\.(jpe?g|png|gif|webp)$/i;

export class Content {
  constructor(private readonly siteDir: string) {}

  get contentDir(): string {
    return path.join(this.siteDir, 'content');
  }

  /** Resolves a folder below site/content and refuses anything outside it. */
  private pageDir(dir: string): string {
    const full = path.resolve(this.contentDir, dir);
    if (full !== this.contentDir && !full.startsWith(this.contentDir + path.sep)) {
      throw new Error(`Ungültiger Seitenpfad: ${dir}`);
    }
    return full;
  }

  private pageFile(dir: string): string {
    const folder = this.pageDir(dir);
    for (const name of ['_index.md', 'index.md']) {
      const file = path.join(folder, name);
      if (fs.existsSync(file)) return file;
    }
    throw new Error(`Seite nicht gefunden: ${dir || 'Startseite'}`);
  }

  listPages(): PageInfo[] {
    const pages: PageInfo[] = [];
    const walk = (folder: string) => {
      for (const name of ['_index.md', 'index.md']) {
        const file = path.join(folder, name);
        if (!fs.existsSync(file)) continue;
        const dir = path.relative(this.contentDir, folder).split(path.sep).join('/');
        const fm = splitFrontMatter(fs.readFileSync(file, 'utf8')).frontMatter;
        pages.push({
          dir,
          file: name,
          title: dir ? yamlValue(fm, 'title') || dir : 'Startseite',
          section: dir.split('/')[0] ?? '',
          isSection: name === '_index.md',
          weight: Number(/^\s+weight:\s*(\d+)/m.exec(fm)?.[1] ?? 0),
        });
      }
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(folder, entry.name));
      }
    };
    walk(this.contentDir);
    return pages;
  }

  readPage(dir: string): PageContent {
    const { frontMatter, body } = splitFrontMatter(fs.readFileSync(this.pageFile(dir), 'utf8'));
    return { title: yamlValue(frontMatter, 'title'), body };
  }

  savePage(dir: string, content: PageContent): void {
    const file = this.pageFile(dir);
    const old = splitFrontMatter(fs.readFileSync(file, 'utf8'));
    const title = `title: ${JSON.stringify(content.title.trim())}`;
    const frontMatter = /^title:.*$/m.test(old.frontMatter)
      ? old.frontMatter.replace(/^title:.*$/m, title)
      : `${title}\n${old.frontMatter}`;
    const body = content.body.replace(/\s+$/, '') + '\n';
    fs.writeFileSync(file, `---\n${frontMatter}\n---\n\n${body}`);
  }

  /**
   * Deletes photos of a page folder that were on the published page but are no longer on
   * the edited one. Runs just before publishing, so "undo" works until then.
   */
  removeDroppedImages(dir: string, publishedFile: string): void {
    const folder = this.pageDir(dir);
    const kept = references(this.readPage(dir).body);
    for (const ref of references(splitFrontMatter(publishedFile).body)) {
      const file = path.join(folder, ref);
      if (!kept.has(ref) && IMAGE_FILE.test(ref) && path.dirname(file) === folder && fs.existsSync(file)) {
        fs.rmSync(file);
      }
    }
  }

  /** Whether the page in `dir` shows or links the file `name` of its folder. */
  isReferenced(dir: string, name: string): boolean {
    return references(this.readPage(dir).body).has(name);
  }

  addImage(dir: string, name: string, data: ArrayBuffer): string {
    const folder = this.pageDir(dir);
    const ext = path.extname(name).toLowerCase() || '.jpg';
    const stem = slug(path.basename(name, path.extname(name))) || 'foto';
    let file = `${stem}${ext}`;
    for (let n = 2; fs.existsSync(path.join(folder, file)); n++) file = `${stem}-${n}${ext}`;
    fs.writeFileSync(path.join(folder, file), Buffer.from(data));
    return file;
  }

  /** Creates a page below a section and links it at the end of the section page. */
  createPage(sectionDir: string, title: string): string {
    const section = this.pageDir(sectionDir);
    if (!fs.existsSync(path.join(section, '_index.md'))) {
      throw new Error('Neue Seiten können nur in einem Menübereich angelegt werden.');
    }
    const base = slug(title) || 'seite';
    let name = base;
    for (let n = 2; fs.existsSync(path.join(section, name)); n++) name = `${base}-${n}`;
    fs.mkdirSync(path.join(section, name));
    fs.writeFileSync(
      path.join(section, name, 'index.md'),
      `---\ntitle: ${JSON.stringify(title.trim())}\n---\n\nHier steht bald mehr.\n`,
    );
    const dir = sectionDir ? `${sectionDir}/${name}` : name;
    const parent = this.readPage(sectionDir);
    this.savePage(sectionDir, {
      title: parent.title,
      body: `${parent.body.replace(/\s+$/, '')}\n\n**[${escapeMd(title.trim())}](/${dir}/)**\n`,
    });
    return dir;
  }

  /** Pages (other than the page itself) that link to `dir` or show its photos. */
  linkingPages(dir: string): PageInfo[] {
    const targets = this.addressesOf(dir);
    return this.listPages().filter((p) => p.dir !== dir && unlink(this.readPage(p.dir).body, targets) !== null);
  }

  /**
   * Deletes a page with its photos. Links to it elsewhere become plain text and photos
   * linking to it are removed, so no page points to a missing address afterwards.
   * Returns the pages that were changed that way.
   */
  deletePage(dir: string): PageInfo[] {
    const page = this.listPages().find((p) => p.dir === dir);
    if (!page) throw new Error(`Seite nicht gefunden: ${dir}`);
    if (page.isSection || !dir) throw new Error('Menübereiche und die Startseite können nicht gelöscht werden.');
    const folder = this.pageDir(dir);
    if (fs.readdirSync(folder, { withFileTypes: true }).some((e) => e.isDirectory())) {
      throw new Error('Diese Seite enthält Unterseiten und kann nicht gelöscht werden.');
    }
    const targets = this.addressesOf(dir);
    const changed = this.linkingPages(dir);
    for (const p of changed) {
      const content = this.readPage(p.dir);
      this.savePage(p.dir, { title: content.title, body: unlink(content.body, targets)! });
    }
    fs.rmSync(folder, { recursive: true });
    return changed;
  }

  /** Addresses under which a page can be reached: its path and its old .html names. */
  private addressesOf(dir: string): string[] {
    const fm = splitFrontMatter(fs.readFileSync(this.pageFile(dir), 'utf8')).frontMatter;
    const aliases = [...fm.matchAll(/^\s+-\s+"?([^"\n]+)"?\s*$/gm)].map((m) => m[1]!.trim());
    return [`/${dir}`, ...aliases.filter((a) => a.startsWith('/'))];
  }

  /** A file the UI may show, looked up like Hugo does: shared files first, then pages. */
  resolveAsset(rel: string): string | null {
    for (const root of [path.join(this.siteDir, 'static'), this.contentDir]) {
      const full = path.resolve(root, rel);
      if (full.startsWith(root + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
    return null;
  }
}

/**
 * Removes references to `targets` (a page path like "/katzen/luna" and its aliases) from a
 * page body: linked photos and photos stored in that page are dropped, text links keep their
 * text. Returns null when the body has no such reference.
 */
export function unlink(body: string, targets: string[]): string | null {
  const alt = targets
    .map((t) => {
      const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // A page path also matches with a trailing slash, anchors and files inside it.
      return t.endsWith('.html') || t.endsWith('.htm') ? `${e}(?:#[^)\\s]*)?` : `${e}(?:/[^)\\s]*)?`;
    })
    .join('|');
  const dest = `(?:${alt})(?:\\s+"[^"]*")?`;
  const linkedPhoto = new RegExp(`\\[!\\[[^\\]]*\\]\\([^)]*\\)\\]\\(${dest}\\)[ \\t]*\\\\?`, 'g');
  const photo = new RegExp(`!\\[[^\\]]*\\]\\(${dest}\\)[ \\t]*\\\\?`, 'g');
  const link = new RegExp(`(?<!!)\\[([^\\]]*)\\]\\(${dest}\\)`, 'g');
  const result = body.replace(linkedPhoto, '').replace(photo, '').replace(link, '$1');
  if (result === body) return null;
  // Tidy rows that became empty.
  return result.replace(/^[ \t\\]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}

/** Link and image targets of a page, e.g. photos and the larger versions they link to. */
function references(body: string): Set<string> {
  const refs = new Set<string>();
  for (const m of body.matchAll(LINK_TARGET)) {
    try { refs.add(decodeURI(m[1]!)); } catch { refs.add(m[1]!); }
  }
  return refs;
}

function splitFrontMatter(text: string): { frontMatter: string; body: string } {
  const m = FRONT_MATTER.exec(text);
  if (!m) return { frontMatter: '', body: text };
  return { frontMatter: m[1]!, body: text.slice(m[0].length).replace(/^\s*\n/, '') };
}

function yamlValue(frontMatter: string, key: string): string {
  const raw = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontMatter)?.[1]?.trim() ?? '';
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return raw.replace(/^'(.*)'$/, '$1');
}

/** "Wurf März 2027" → "wurf-maerz-2027" */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const escapeMd = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1');
