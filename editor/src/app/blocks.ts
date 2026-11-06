// A page body is shown as a list of blocks: text paragraphs and rows of photos (one
// Markdown paragraph each, like the old site's table rows). Blocks the editor did not
// touch are written back exactly as they were read.
import { Marked } from 'marked';
import TurndownService from 'turndown';

/** Display size on the website; none = the file's own size (all migrated photos). */
export type PhotoSize = 'klein' | 'mittel' | 'gross' | 'voll';
export const PHOTO_SIZES: { value: PhotoSize | undefined; label: string }[] = [
  { value: undefined, label: 'Original' },
  { value: 'klein', label: 'Klein' },
  { value: 'mittel', label: 'Mittel' },
  { value: 'gross', label: 'Groß' },
  { value: 'voll', label: 'Volle Breite' },
];

export interface Photo {
  src: string;
  alt: string;
  /** Page or larger image the photo links to. */
  href?: string;
  /** Stored as the Markdown image title, read by the site's render-image hook. */
  size?: PhotoSize;
}

export type Block =
  | { id: number; kind: 'text'; md: string }
  /** `raw` is the original Markdown, kept until the row is changed. */
  | { id: number; kind: 'photos'; photos: Photo[]; raw?: string };

let nextId = 1;
export const newId = () => nextId++;

const TITLE = '(?:\\s+"([^"]*)")?';
const PHOTO = new RegExp(
  `\\[!\\[([^\\]]*)\\]\\(([^)\\s]+)${TITLE}\\)\\]\\(([^)\\s]+)\\)|!\\[([^\\]]*)\\]\\(([^)\\s]+)${TITLE}\\)`,
  'g',
);
const asSize = (t: string | undefined) =>
  PHOTO_SIZES.some((s) => s.value && s.value === t) ? (t as PhotoSize) : undefined;

export function parseBody(body: string): Block[] {
  return body
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/^\n+|\s+$/g, ''))
    .filter((p) => p.length)
    .map((p): Block => {
      const rest = p.replace(PHOTO, '').replace(/[\s\\]/g, '');
      if (rest) return { id: newId(), kind: 'text', md: p };
      const photos = [...p.matchAll(PHOTO)].map((m): Photo => {
        const photo: Photo = m[2] ? { alt: m[1]!, src: m[2], href: m[4] } : { alt: m[5]!, src: m[6]! };
        const size = asSize(m[2] ? m[3] : m[7]);
        return size ? { ...photo, size } : photo;
      });
      return { id: newId(), kind: 'photos', photos, raw: p };
    });
}

export function serializeBody(blocks: Block[]): string {
  return blocks
    .map((b) => (b.kind === 'text' ? b.md.trim() : b.raw ?? b.photos.map(photoMd).join('\n')))
    .filter((s) => s.length)
    .join('\n\n') + '\n';
}

const photoMd = (p: Photo) => {
  const img = `![${p.alt}](${p.src}${p.size ? ` "${p.size}"` : ''})`;
  return p.href ? `[${img}](${p.href})` : img;
};

/** Address under which the editor can show a page's image (served by the main process). */
export function imageUrl(src: string, pageDir: string): string {
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  const path = src.startsWith('/') ? src.slice(1) : pageDir ? `${pageDir}/${src}` : src;
  return `seite://site/${path.split('/').map(encodeURIComponent).join('/')}`;
}

// ---------------------------------------------------------------- text ↔ HTML

export function markdownToHtml(md: string, pageDir: string): string {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      image({ href, text }) {
        return `<img src="${escapeAttr(imageUrl(href, pageDir))}" data-md-src="${escapeAttr(href)}" alt="${escapeAttr(text)}">`;
      },
    },
  });
  return marked.parse(md, { async: false });
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  emDelimiter: '_',
  strongDelimiter: '**',
  br: '\\',
});
turndown.addRule('image', {
  filter: 'img',
  replacement: (_content, node) => {
    const img = node as HTMLElement;
    return `![${img.getAttribute('alt') ?? ''}](${img.getAttribute('data-md-src') || img.getAttribute('src')})`;
  },
});
// Raw "<" would be read as HTML (and dropped) by Hugo, so escape it like the migration did.
const escape = turndown.escape.bind(turndown);
turndown.escape = (text: string) => escape(text).replace(/</g, '\\<');

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
