# starbushway.de

Website of Starbushway Maine Coons (Duisburg), rebuilt in 2026 from the 1999 Dreamweaver site
as a static [Hugo](https://gohugo.io) site.

| Folder | What it is |
| --- | --- |
| `site/` | The Hugo site: `content/` (one folder per page, Markdown + photos), `layouts/` and `assets/` (theme), `static/` (shared images) |
| `migration/` | One-time scripts that converted the old site; `report.md` lists what needs a human look |
| `.github/workflows/deploy.yml` | Builds the site and publishes it to GitHub Pages on every push to `main` |

## Local preview

```bash
hugo server --source site
```

Then open http://localhost:1313.

## Publishing

Every push to `main` builds the site, checks all internal links and publishes it.
The build uses Hugo 0.131.0 (`HUGO_VERSION` in the workflow).

## Re-running the migration

Only needed if the old site changes before the switch. It overwrites `site/content/` and
`site/static/bilder/`.

```bash
python3 -I migration/mirror.py
python3 -m venv migration/.venv && migration/.venv/bin/pip install beautifulsoup4 lxml pillow
migration/.venv/bin/python -I migration/convert.py
```
