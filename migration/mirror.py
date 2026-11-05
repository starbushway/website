"""Mirror the old starbushway.de site (pages + referenced files) into migration/source/.

Usage: python3 -I migration/mirror.py
Writes source/<path> for every file and source/_crawl.json with status per URL.
"""
import json, re, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "http://starbushway.de/"
OUT = Path(__file__).resolve().parent / "source"
PAGE_RE = re.compile(r"\.(html?|php)$|/$", re.I)
REF_RE = re.compile(r"""(?:href|src|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return str(e), None


CASE_TWINS = {}  # url -> number, for urls whose name differs from another url only by case


def local_path(url):
    """Local file for a url. macOS disks ignore case, so case twins get a distinct suffix."""
    rel = urllib.parse.unquote(url[len(BASE):]) or "index.html"
    if rel.endswith("/"):
        rel += "index.html"
    if url in CASE_TWINS:
        stem, dot, ext = rel.rpartition(".")
        rel = f"{stem}~{CASE_TWINS[url]}.{ext}"
    return OUT / rel


def save(url, data):
    p = local_path(url)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def main():
    status, pages, files = {}, [BASE], set()
    seen = set()
    while pages:
        url = pages.pop(0)
        if url in seen:
            continue
        seen.add(url)
        code, data = fetch(url)
        status[url] = code
        if data is None:
            continue
        save(url, data)
        html = data.decode("latin-1")
        for groups in REF_RE.findall(html):
            ref = "".join(groups).strip()
            if ref.lower().startswith(("mailto:", "javascript:", "#")):
                continue
            a = urllib.parse.urljoin(url, urllib.parse.quote(ref, safe="/:%#?=&~")).split("#")[0].split("?")[0]
            a = a.replace("http://www.starbushway.de/", BASE)
            if not a.startswith(BASE) or "cgi-bin" in a:
                continue
            if PAGE_RE.search(a):
                pages.append(a)
            else:
                files.add(a)
    print(f"{len(seen)} pages crawled, downloading {len(files)} files", file=sys.stderr)
    by_lower = {}
    for url in files:
        by_lower.setdefault(url.lower(), []).append(url)
    for twins in by_lower.values():
        if len(twins) > 1:
            plain = local_path(twins[0])
            plain.unlink(missing_ok=True)  # may hold either twin's bytes from an earlier run
            for n, url in enumerate(sorted(twins), 1):
                CASE_TWINS[url] = n

    def dl(url):
        if local_path(url).exists():
            return url, 200
        code, data = fetch(url)
        if data is not None:
            save(url, data)
        return url, code

    with ThreadPoolExecutor(8) as ex:
        for url, code in ex.map(dl, sorted(files)):
            status[url] = code
    (OUT / "_crawl.json").write_text(json.dumps(status, indent=1, sort_keys=True))
    paths = {u: str(local_path(u).relative_to(OUT)) for u, c in status.items() if c == 200}
    (OUT / "_paths.json").write_text(json.dumps(paths, indent=1, sort_keys=True))
    bad = {u: c for u, c in status.items() if c != 200}
    print(f"done: {len(status)} urls, {len(bad)} failed", file=sys.stderr)


if __name__ == "__main__":
    main()
