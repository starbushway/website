# Starbushway Editor

Windows program for editing starbushway.de without technical knowledge: choose a page, change
text and photos, look at the preview, click **Veröffentlichen**. Built with Electron + Angular.

## How it works

| Part | What it does |
| --- | --- |
| `electron/repo.ts` | Keeps a copy of this repository on the PC (isomorphic-git, no git installation needed). Publishing commits and pushes to `main`, which triggers the website build. |
| `electron/content.ts` | Reads and writes the pages in `site/content` (one folder per page, Markdown + photos). |
| `electron/hugo.ts` | Runs the bundled `hugo.exe` as preview server; the preview is the real site. |
| `src/app/` | The interface: page list, text and photo blocks, preview, publish. |

**Several PCs.** Each PC fetches the newest version on start (unless it has unpublished edits).
Publishing replays this PC's changed files on top of the newest published version, merging text
line by line. If two PCs changed the same lines, the later publisher wins; nobody is asked.

**Photos** are shrunk to at most 800 px on the longest side before saving (like the existing
ones) and re-encoded, which removes camera data such as the GPS position. A photo taken off a
page is deleted from the repository when publishing, so "Rückgängig" works until then.

**Access key.** Each PC needs a GitHub token with the `repo` scope for the `starbushway`
account. It is entered once in the setup screen and stored encrypted with Windows' own key
store (Electron `safeStorage`).

## Installing on a PC

1. GitHub → Actions → **Editor-Programm bauen** → Run workflow (or push a tag `editor-v0.1.0`).
2. Download the artifact `Starbushway-Editor-Windows` and run `Starbushway Editor Setup ….exe`.
   It installs for the current user and puts **Website bearbeiten** on the desktop.
   The installer is not code-signed, so Windows SmartScreen asks once: *Weitere Informationen →
   Trotzdem ausführen*.
3. On first start enter the editor's name and the access key. The website (~380 MB) is
   downloaded once.

## Development

Needs Node 22 and Hugo 0.131.0 extended on PATH.

```bash
npm install
npm start          # build and run the app
npm test           # page round-trip and two-PC publishing tests (run npm run build first)
```

To try the app without touching the real website, serve a copy of the repository locally and
point the setup screen's "Erweitert" address at it (any access key works):

```bash
git clone --bare .. /tmp/remote/website.git
node test/git-server.mjs /tmp/remote 8174        # → http://127.0.0.1:8174/website.git
STARBUSH_USER_DATA=/tmp/pc1-data STARBUSH_REPO_DIR=/tmp/pc1 npx electron .
```
