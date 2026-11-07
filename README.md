# Tripwire website

A static site with a working Solana **Quick Scan**. There is no server code. Everything runs in the visitor's browser.

## What's live

| Check | Data source | What it flags |
|---|---|---|
| Authority wire | Solana RPC `getAccountInfo` | Mint or freeze authority still active; Token-2022 transfer fee, permanent delegate, transfer hook or pausable |
| Holders wire | RPC `getTokenLargestAccounts` + `getMultipleAccounts` | Top 10 non-pool wallets above 30% of supply, or one wallet above 10% |
| Exit wire | DexScreener public API | Pool liquidity under $10k, or a $1,000 sell moving price more than 10% (constant-product estimate) |

Tune the thresholds in `app.js` (the `T` object at the top).

**Full eight-wire scan:** deploy the `tripwire-bot` server (see its README), then set `apiUrl` in `config.js`. The site then runs bundle, sniper, dev history, agent and wash checks on top of the three above, and the "With X bot" labels switch to "Live now". If the server is down, the site falls back to the Quick Scan on its own. Set `botLive: true` once @TripwireScan is posting replies.

## Before you deploy (5 minutes)

1. **`config.js`**: set `siteUrl`, `xHandle` and `contact`. Leave `tokenCA` empty until launch.
2. **RPC key**: the free public Solana RPC rate limits hard and often refuses the holder lookup. Make a free key at Helius (or Triton or QuickNode), **restrict it to your domain** in their dashboard, and paste the URL into `rpcUrl`. The site still works without one, but the Holders wire will often show "Unavailable".
3. **Find and replace `https://tripwire.example`** in `index.html` with your real domain. X needs the absolute `og:image` URL to show your link card.
4. **Terms and Privacy**: fill in the `[BRACKETS]` and have a lawyer review both. Then remove the orange "Draft template" boxes.

## Deploy

**Vercel**: install the CLI (`npm i -g vercel`), run `vercel` inside this folder, then add your domain in the dashboard. Or drag the folder onto vercel.com/new. `vercel.json` adds security headers.

**Netlify**: drag this folder onto app.netlify.com/drop. `_headers` adds the same security headers.

Any static host works (Cloudflare Pages, GitHub Pages). Serve the folder as the site root.

## Test locally

```
python3 -m http.server 8000
```
Then open http://localhost:8000 and paste a real Solana token mint.

## Sharing

Every scan updates the URL to `/?ca=<mint>`, so a shared link reruns the scan. "Share on X" opens a pre-filled post with that link.

## Files

- `index.html`, `styles.css`, `app.js`, `config.js`: the site and scanner
- `terms.html`, `privacy.html`, `legal.js`, `404.html`
- `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `site.webmanifest`
- `og-image.png`: the 1200×630 link preview for X and Telegram
- `vercel.json` and `_headers`: security headers (CSP, no framing, nosniff)
