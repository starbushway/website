# Going live: GitHub Pages + starbushway.de

The repository is ready locally (branch `main`, one commit). These are the steps that need
your GitHub account and the domain's DNS access.

## 1. Create the GitHub repository

1. Go to https://github.com/new
2. Name: `starbushway` (any name works). Visibility: **Public**. GitHub Pages on a free
   account requires a public repository. The site is public anyway, and the repo holds
   no passwords.
3. Do **not** add a README, .gitignore or license, because the repo must start empty.

## 2. Push

```bash
git -C ~/Documents/Starbushway remote add origin https://github.com/<your-user>/starbushway.git
```

```bash
git -C ~/Documents/Starbushway push -u origin main
```

The first push uploads about 380 MB and takes a few minutes.

## 3. Switch Pages to "GitHub Actions"

Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Then open **Actions → "Website veröffentlichen" → Run workflow** (or push again). After about
2 minutes the site is live at `https://<your-user>.github.io/starbushway/`. Review it there
before switching the domain.

On that temporary address, *old* links such as `/zuchtluna.html` redirect to
`starbushway.de/...` (still the old server). That resolves itself after step 5.

## 4. Verify the domain with GitHub (prevents domain takeover)

GitHub → your avatar → **Settings → Pages → Add a domain** → `starbushway.de`.
GitHub shows a TXT record. Add it at the DNS provider (step 5) and click **Verify**.

## 5. DNS at neonect.de

The domain's DNS is hosted by neonect (`ns1/ns2.neonect.de`), which is also where the current
site runs (`195.149.99.171`). **E-mail also runs through neonect (`MX 10 mx1.neonect.de`).
Change only the records below and leave MX and any mail-related records untouched.**

| Name | Type | Value |
| --- | --- | --- |
| `starbushway.de` (@) | A | `185.199.108.153` |
| `starbushway.de` (@) | A | `185.199.109.153` |
| `starbushway.de` (@) | A | `185.199.110.153` |
| `starbushway.de` (@) | A | `185.199.111.153` |
| `starbushway.de` (@) | AAAA | `2606:50c0:8000::153` (also `8001::153`, `8002::153`, `8003::153`) |
| `www` | CNAME | `<your-user>.github.io.` |
| `_github-pages-challenge-<your-user>` | TXT | *(value GitHub showed in step 4)* |

Remove the old A record `195.149.99.171` for `@` and `www`.

If the neonect package does not allow editing DNS records, ask neonect to set them, or move
the domain to a provider that does. In that case, move the MX records along unchanged.

## 6. Connect the domain to the repository

Repository → **Settings → Pages → Custom domain**: `starbushway.de` → Save.
Once DNS has propagated (minutes to a few hours), tick **Enforce HTTPS**. GitHub issues the
certificate automatically.

## 7. Afterwards

- Check: https://starbushway.de, https://www.starbushway.de, and an old link such as
  https://starbushway.de/zuchtluna.html (it should redirect to `/katzen/zuchtluna/`).
- Cancel the old webspace only after checking that no mailboxes depend on it.
- Update the Datenschutz page: it must name GitHub (GitHub Inc., USA) as the hosting provider
  that processes visitors' IP addresses. I have not changed this page's text.

## Note on hosting terms

GitHub's terms do not allow Pages to be used mainly for commercial transactions. A breeder site
with a prices/reservation page is a grey area. If this becomes a concern, Cloudflare Pages can
build the same repository unchanged: build command `hugo --source site --minify`, output
directory `site/public`.
