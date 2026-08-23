# QORPO — official website (static)

The new premium QORPO site — the attention economy token for games, AI and entertainment.

- `index.html` — home
- `ecosystem.html`, `token.html`, `staking.html`, `bridge.html` — subpages
- `assets/` — local media

## Hosting
Deployed via GitHub Pages using the workflow in `.github/workflows/deploy.yml`
(pushes to `main` auto-deploy). Live market data is pulled client-side from CoinGecko.

## Custom domain
Add a `CNAME` file containing `www.qorpo.world` and point DNS at GitHub Pages
to serve on the QORPO domain.
