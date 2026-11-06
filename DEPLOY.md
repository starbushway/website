# Going live: GitHub Pages + starbushway.de

The repository is ready locally (GitHub account `starbushway`, repository `website`). These are the steps that need
your GitHub account and the domain's DNS access.

## 1–2. GitHub repository and push (done)

Repository: https://github.com/starbushway/website (public, owned by the `starbushway`
account). The remote is `https://starbushway@github.com/starbushway/website.git`; the
account's access token (scopes `repo`, `workflow`) is stored in the macOS Keychain, so
`git push` works without a prompt.

## 3. Pages via GitHub Actions (done)

Pages is set to **Source: GitHub Actions**. The site is live at
https://starbushway.github.io/website/. Review it there before switching the domain.

On that temporary address, *old* links such as `/zuchtluna.html` redirect to
`starbushway.de/...` (still the old server). That resolves itself after step 5.

## 4. Verify the domain with GitHub (prevents domain takeover)

Signed in as `starbushway`: avatar → **Settings → Pages → Add a domain** → `starbushway.de`.
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
| `www` | CNAME | `starbushway.github.io.` |
| `_github-pages-challenge-starbushway` | TXT | *(value GitHub showed in step 4)* |

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
