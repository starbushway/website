"""Check every internal href/src in a built Hugo site resolves to a file. Usage: checklinks.py <public-dir>"""
import re, sys
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

root = Path(sys.argv[1])
bad, n = [], 0
for html in root.rglob("*.html"):
    page = "/" + str(html.relative_to(root))
    for ref in [''.join(g) for g in re.findall(r'''(?:href|src)=(?:"([^"]*)"|([^\s>"]+))''', html.read_text(errors="replace"))]:
        if ref.startswith(("http:", "https:", "mailto:", "tel:", "#", "data:")):
            continue
        n += 1
        path = unquote(urlsplit(urljoin(page, ref)).path)
        target = root / path.lstrip("/")
        if not (target.is_file() or (target / "index.html").is_file()):
            bad.append(f"{page} -> {ref}")
print(f"{n} internal links checked, {len(bad)} broken")
print("\n".join(sorted(bad)[:40]))
