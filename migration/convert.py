"""Convert the mirrored Dreamweaver site (migration/source/) into Hugo content (site/content/).

Usage: migration/.venv/bin/python -I migration/convert.py

Every old page becomes a Hugo page bundle (Markdown + its own photos), filed under the
section of the main-menu entry it is reached from. Old URLs stay reachable via `aliases`.
Images used by more than one page go to site/static/bilder/. A report of everything that
needs a human look is written to migration/report.md.
"""
import json
import re
import shutil
import sys
import unicodedata
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "source"
SITE = ROOT.parent / "site"
CONTENT = SITE / "content"
SHARED = SITE / "static" / "bilder"
BASE = "http://starbushway.de/"

# Main menu of indexa.htm: old page -> (section slug, menu title, menu order)
SECTIONS = {
    "index2a.htm": ("neuigkeiten", "Neuigkeiten", 1),
    "anfang.html": ("lesenswert", "Lesenswert", 2),
    "zuchtindex3.htm": ("kater", "Unsere Kater", 3),
    "zuchtindex5.htm": ("katzen", "Unsere Katzen", 4),
    "wuerfe.htm": ("wuerfe", "Kitten & Würfe", 5),
    "ueber.html": ("ueber-uns", "Über uns", 6),
    "wohnbereich.htm": ("wohnen", "Wohnbereich", 7),
    "besucht2.html": ("besuch", "Besuch", 8),
    "kastraten.htm": ("kastraten", "Kastraten", 9),
    "ernaehrung2.html": ("ernaehrung", "Ernährung", 10),
    "pflege.html": ("pflege", "Pflege", 11),
    "adresse.html": ("kontakt", "Kontakt", 12),
    "hunde.html": ("hunde", "Hunde", 13),
    "Link22.htm": ("links", "Links", 14),
    "oldis.htm": ("oldies", "Unsere Oldies", 15),
    "zuchtseite.htm": ("interessenten", "Für Interessenten", 16),
}
# Standalone pages that are not part of a menu section
SINGLE = {
    "Datenschutz.html": ("datenschutz", "Datenschutz"),
    "impressum1.html": ("impressum", "Impressum"),
}
HOME = "indexa.htm"
SPLASH = "index.html"
LOOSE = "sonstiges"  # pages reachable only from outside the menu tree

BLOCK_TAGS = {"p", "div", "table", "tr", "td", "th", "center", "h1", "h2", "h3", "h4",
              "h5", "h6", "ul", "ol", "li", "blockquote", "hr", "form", "body", "tbody",
              "thead", "dl", "dt", "dd", "pre", "address"}
SKIP_TAGS = {"script", "style", "head", "title", "meta", "link", "noscript", "map"}
IMG_EXT = {".jpg", ".jpeg", ".gif", ".png", ".bmp", ".webp"}

report = defaultdict(list)
sys.setrecursionlimit(50000)  # Dreamweaver nests <font> tags ~1000 levels deep


# ---------------------------------------------------------------- helpers

def slugify(name):
    s = unicodedata.normalize("NFKD", name.replace("ä", "ae").replace("ö", "oe")
                              .replace("ü", "ue").replace("Ä", "ae").replace("Ö", "oe")
                              .replace("Ü", "ue").replace("ß", "ss"))
    s = s.encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9._-]+", "-", s).strip("-.")
    return s or "datei"


def page_slug(old):
    return slugify(Path(old).stem)


def read_html(path):
    raw = path.read_bytes()
    head = raw[:2048].decode("ascii", "ignore").lower()
    enc = "utf-8" if "utf-8" in head else "cp1252"
    try:
        text = raw.decode(enc)
    except UnicodeDecodeError:
        text = raw.decode("cp1252", "replace")
    return BeautifulSoup(text, "lxml")


def rel_of(url):
    """Old absolute URL -> path relative to the site root, or None if external."""
    url = url.replace("http://www.starbushway.de/", BASE).replace("https://", "http://")
    if not url.startswith(BASE):
        return None
    return unquote(urlsplit(url).path.lstrip("/")) or SPLASH


def is_page(rel):
    return bool(re.search(r"\.(html?|php)$", rel, re.I))


def md_escape(text):
    return re.sub(r"([\\`*_\[\]<>])", r"\\\1", text)


def escape_line_start(line):
    """Text that Markdown would read as a heading, list or quote at the start of a line."""
    line = re.sub(r"^(\**)(\d+)\.(?=\s)", r"\1\2\\.", line)
    return re.sub(r"^([#+-])(?=\s|#)", r"\\\1", line)


# ---------------------------------------------------------------- crawl graph

LOCAL = {}  # old relative path -> mirrored file (case twins are stored as name~N.ext)


def src(rel):
    return SRC / LOCAL[rel]


def load_pages():
    status = json.loads((SRC / "_crawl.json").read_text())
    for url, path in json.loads((SRC / "_paths.json").read_text()).items():
        LOCAL[rel_of(url)] = path
    pages, missing = {}, set()
    for url, code in status.items():
        rel = rel_of(url)
        if rel is None or not is_page(rel):
            continue
        if code == 200 and rel in LOCAL:
            pages[rel] = read_html(src(rel))
        else:
            missing.add(rel)
    files_ok = {rel_of(u) for u, c in status.items() if c == 200}
    return pages, missing, files_ok


def links_of(rel, soup):
    out = []
    for a in soup.find_all("a", href=True):
        r = rel_of(urljoin(BASE + rel, a["href"].strip()))
        if r and is_page(r):
            out.append(r)
    return out


def assign_sections(pages):
    """BFS from each menu page; a page belongs to the first section that reaches it."""
    owner = {HOME: ("", None), SPLASH: ("", None)}
    for old, (sec, _, _) in SECTIONS.items():
        owner[old] = (sec, None)
    for old, (slug, _) in SINGLE.items():
        owner[old] = ("", slug)
    queue = deque(SECTIONS)
    while queue:
        cur = queue.popleft()
        if cur not in pages:
            continue
        sec = owner[cur][0]
        for nxt in links_of(cur, pages[cur]):
            if nxt in pages and nxt not in owner:
                owner[nxt] = (sec, page_slug(nxt))
                queue.append(nxt)
    for rel in pages:
        if rel not in owner:
            owner[rel] = (LOOSE, page_slug(rel))
            report["Seiten ohne Menü-Zuordnung (→ sonstiges)"].append(rel)
    return owner


def permalink(rel, owner):
    if rel in (HOME, SPLASH):
        return "/"
    sec, slug = owner[rel]
    if slug is None:
        return f"/{sec}/"
    return f"/{sec}/{slug}/" if sec else f"/{slug}/"


# ---------------------------------------------------------------- HTML -> Markdown

class Converter:
    def __init__(self, rel, owner, missing, image_home, files_ok):
        self.rel, self.owner, self.missing = rel, owner, missing
        self.image_home, self.files_ok = image_home, files_ok
        self.parent = None  # permalink of the section page, to drop "Zurück" links
        self.images = set()

    def url(self, href):
        return urljoin(BASE + self.rel, href.strip())

    def img_ref(self, src):
        r = rel_of(self.url(src))
        if r is None:
            return src  # external image, keep as is
        if r not in self.files_ok:
            report["Fehlende Bilder"].append(f"{self.rel}: {r}")
            return None
        self.images.add(r)
        return self.image_home(r, self.rel)

    def link_ref(self, href):
        if href.lower().startswith(("mailto:", "tel:")):
            return href.strip()
        if re.fullmatch(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", href.strip()):
            return "mailto:" + href.strip()
        if href.startswith("#"):
            return None
        r = rel_of(self.url(href))
        if r is None:
            return href.strip()
        if is_page(r):
            if r in self.owner:
                return permalink(r, self.owner)
            report["Tote Links (entfernt, Text bleibt)"].append(f"{self.rel} → {r}")
            return None
        if Path(r).suffix.lower() in IMG_EXT:
            return self.img_ref(r)
        if r in self.files_ok:  # pdf etc.
            self.images.add(r)
            return self.image_home(r, self.rel)
        report["Tote Links (entfernt, Text bleibt)"].append(f"{self.rel} → {r}")
        return None

    # Inline rendering returns a list of "chunks": strings, or ("img", markdown) for images.
    def inline(self, node, bold=False, italic=False):
        out = []
        for child in node.children:
            if isinstance(child, Comment):
                continue
            if isinstance(child, NavigableString):
                t = re.sub(r"\s+", " ", str(child).replace("\xa0", " "))
                if t:
                    out.append(md_escape(t))
                continue
            if not isinstance(child, Tag) or child.name in SKIP_TAGS:
                continue
            name = child.name
            if name == "br":
                out.append("\n")
            elif name == "img":
                src = child.get("src")
                ref = self.img_ref(src) if src else None
                if ref:
                    alt = md_escape(child.get("alt", "").strip())
                    out.append(("img", f"![{alt}]({ref})", self.row_of(child)))
            elif name in ("b", "strong") and not bold:
                out += self.wrap(self.inline(child, True, italic), "**")
            elif name in ("i", "em") and not italic:
                out += self.wrap(self.inline(child, bold, True), "*")
            elif name == "a" and child.get("href"):
                out += self.anchor(child, bold, italic)
            elif name in ("iframe", "embed", "object", "video", "audio"):
                src = child.get("src") or child.get("data") or ""
                report["Eingebettete Medien (manuell prüfen)"].append(f"{self.rel}: <{name}> {src}")
                if src:
                    out.append(f"[Video/Medien ansehen]({self.url(src)})")
            elif name in BLOCK_TAGS:
                out.append("\n\n")
                out += self.inline(child, bold, italic)
                out.append("\n\n")
            else:
                out += self.inline(child, bold, italic)
        return out

    @staticmethod
    def wrap(chunks, mark):
        text = [c for c in chunks if isinstance(c, str)]
        if not "".join(text).strip() or any(isinstance(c, tuple) for c in chunks) \
                or any("\n" in c for c in text):
            return chunks  # markers around images or across lines break Markdown
        s = "".join(text)
        lead, core, trail = re.match(r"^(\s*)(.*?)(\s*)$", s, re.S).groups()
        return [f"{lead}{mark}{core}{mark}{trail}"]

    def anchor(self, a, bold, italic):
        inner = self.inline(a, bold, italic)
        target = self.link_ref(a["href"])
        text = "".join(c for c in inner if isinstance(c, str)).strip()
        if target and target == self.parent and re.fullmatch(r"\**zur(ü|ue|\\?&uuml;)ck\**", text, re.I):
            return [c for c in inner if isinstance(c, tuple)]  # theme renders its own back link
        if not target:
            return inner
        out = []
        for c in inner:
            if isinstance(c, tuple):
                out.append(("img", f"[{c[1]}]({target})", c[2]))
            elif c.strip() and "\n" not in c:
                out.append(f"[{c.strip()}]({target}) " if c.endswith(" ") else f"[{c.strip()}]({target})")
            else:
                out.append(c)
        return out

    @staticmethod
    def row_of(img):
        """Images sharing a table row were shown side by side; elsewhere each image is its own row."""
        tr = img.find_parent("tr")
        return ("tr", id(tr)) if tr else ("img", id(img))

    def convert(self, body):
        chunks = self.inline(body)
        # Images of one table row become one Markdown paragraph (rendered as a gallery row);
        # every other image gets a paragraph of its own.
        text, last_row, gap = "", None, ""
        for c in chunks:
            if isinstance(c, tuple):
                if last_row == c[2] and c[2][0] == "tr" and not gap.strip():
                    text += "\n" + c[1]
                else:
                    text += gap + f"\n\n{c[1]}"
                last_row, gap = c[2], ""
            elif last_row is not None and not c.strip():
                gap += c
            else:
                text += gap + (c if last_row is None else "\n\n" + c.lstrip())
                last_row, gap = None, ""
        text += gap
        blocks = []
        for b in re.split(r"\n\s*\n", text):
            lines = [ln.strip() for ln in b.split("\n") if ln.strip()]
            if not lines:
                continue
            if all(re.fullmatch(r"\[?!\[.*\)", ln) for ln in lines):
                blocks.append("\n".join(lines))  # gallery row
            else:
                blocks.append("\\\n".join(escape_line_start(ln) for ln in lines))
        md = "\n\n".join(blocks).strip() + "\n"
        return md.replace("****", "").replace("\\\n\\\n", "\\\n")


# ---------------------------------------------------------------- titles

def guess_title(rel, soup, body_md):
    t = soup.title.get_text(" ", strip=True) if soup.title else ""
    if t and not re.search(r"starbushway|untitled|unbenannt|überschrift|spry|dokument", t, re.I):
        return t
    for line in body_md.splitlines():
        line = re.sub(r"!\[[^\]]*\]\([^)]*\)|\[|\]\([^)]*\)|[*\\>#&]|&gt;|&lt;", "", line).strip(" <>-")
        if 3 <= len(line) <= 70:
            return line
        if len(line) > 70:
            return line[:60].rsplit(" ", 1)[0] + " …"
    return Path(rel).stem


# ---------------------------------------------------------------- main

def main():
    pages, missing, files_ok = load_pages()
    owner = assign_sections(pages)

    # Which pages use which local image/file
    users = defaultdict(set)
    probe = {}
    for rel, soup in pages.items():
        conv = Converter(rel, owner, missing, lambda r, p: r, files_ok)
        body = soup.body or soup
        conv.inline(body)
        probe[rel] = conv.images
        for img in conv.images:
            users[img].add(rel)
    report.clear()

    def bundle_dir(rel):
        if rel in (HOME, SPLASH):
            return CONTENT
        sec, slug = owner[rel]
        if slug is None:
            return CONTENT / sec
        return CONTENT / sec / slug if sec else CONTENT / slug

    # Destination names: lower-case, unique within their folder
    taken = defaultdict(set)
    dest = {}  # (image, page) -> markdown reference

    def place(img, page):
        key = img if len(users[img]) > 1 else (img, page)
        if key in dest:
            return dest[key]
        stem, ext = Path(img).stem, Path(img).suffix.lower()
        folder = "shared" if len(users[img]) > 1 else str(bundle_dir(page))
        name = slugify(stem) + ext
        n = 2
        while name in taken[folder]:
            name = f"{slugify(stem)}-{n}{ext}"
            n += 1
        taken[folder].add(name)
        if len(users[img]) > 1:
            SHARED.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src(img), SHARED / name)
            dest[key] = f"/bilder/{name}"
        else:
            d = bundle_dir(page)
            d.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src(img), d / name)
            dest[key] = name
        return dest[key]

    for d in (CONTENT, SHARED):
        if d.exists():
            shutil.rmtree(d)
    CONTENT.mkdir(parents=True)

    for rel, soup in sorted(pages.items()):
        if rel == SPLASH:
            continue
        conv = Converter(rel, owner, missing, place, files_ok)
        sec, slug = owner[rel]
        if slug is not None and sec:
            conv.parent = f"/{sec}/"
        body = soup.body or soup
        md = conv.convert(body)
        if rel == HOME and SPLASH in pages:
            greet = Converter(SPLASH, owner, missing, place, files_ok).convert(pages[SPLASH].body)
            greet = re.sub(r"^.*(E N T E R|Besucher seit|Sie sind der|iwsr\.de).*$", "", greet, flags=re.M)
            greet = re.sub(r"\\\n(?=\n)", "\n", re.sub(r"\n{3,}", "\n\n", greet))
            md = greet.strip() + "\n\n" + md

        d = bundle_dir(rel)
        d.mkdir(parents=True, exist_ok=True)
        if rel == HOME:
            fm = {"title": "Starbushway – Maine Coon Zucht", "aliases": ["/indexa.htm", "/index.htm"]}
            name = "_index.md"
        elif slug is None and sec:
            _, title, order = SECTIONS[rel]
            fm = {"title": title, "menu": {"main": {"weight": order}}, "aliases": [f"/{rel}"]}
            name = "_index.md"
        elif not sec:
            fm = {"title": SINGLE[rel][1], "aliases": [f"/{rel}"]}
            name = "index.md"
        else:
            fm = {"title": guess_title(rel, soup, md), "aliases": [f"/{rel}"]}
            name = "index.md"
        fm["alt_url"] = rel  # provenance: the old file name
        (d / name).write_text(front_matter(fm) + "\n" + md, encoding="utf-8")

    loose = CONTENT / LOOSE
    if loose.exists():
        (loose / "_index.md").write_text(front_matter({"title": "Sonstiges", "build": {"list": "never"}}))

    write_report(pages, missing, owner)


def front_matter(fm):
    def val(v, ind):
        if isinstance(v, dict):
            return "\n" + "".join(f"{' ' * (ind + 2)}{k}:{val(x, ind + 2)}" for k, x in v.items())
        if isinstance(v, list):
            return "\n" + "".join(f"{' ' * (ind + 2)}- {json.dumps(x, ensure_ascii=False)}\n" for x in v)
        return f" {json.dumps(v, ensure_ascii=False)}\n"
    return "---\n" + "".join(f"{k}:{val(v, 0)}" for k, v in fm.items()) + "---\n"


def write_report(pages, missing, owner):
    counts = defaultdict(int)
    for rel in pages:
        counts[owner[rel][0] or "(oberste Ebene)"] += 1
    lines = ["# Migrationsbericht\n", f"{len(pages)} Seiten übernommen.\n", "## Seiten je Bereich\n"]
    lines += [f"- {k}: {v}" for k, v in sorted(counts.items())]
    lines.append(f"\n## Alte Seiten, die schon vorher fehlten (404)\n")
    lines += [f"- {m}" for m in sorted(missing)]
    for title, items in report.items():
        lines.append(f"\n## {title}\n")
        lines += [f"- {i}" for i in sorted(set(items))]
    (ROOT / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
