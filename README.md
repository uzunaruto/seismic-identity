# Seismic ID v2

Verified Seismic community identity card generator.

- **Discord** for community role verification (read-only OAuth)
- **X (Twitter)** as the public identity source (OAuth or manual paste)
- **Digital signature** drawn in the browser
- **Export** as PNG / PDF / share to X

## Stack

- Static frontend: `index.html` + `styles.css` + `app.js` (no build step)
- Vercel serverless: `api/discord/{auth,callback}.js` + `api/x/{auth,callback}.js`
- CDN deps: html2canvas (PNG), jsPDF (PDF), qrcodejs (QR), Phosphor icons, Outfit + JetBrains Mono + Caveat fonts

## Local dev

```bash
# Just serve the folder — no build needed
npx serve .
# or
python3 -m http.server 3000
```

OAuth buttons need the Vercel serverless endpoints, so they only work when deployed or when you run the `api/` folder with `vercel dev`.

## Deploy to Vercel

```bash
vercel deploy --prod --yes
```

### Required env vars (set in Vercel dashboard)

See `.env.example`. Get them from:

- **Discord**: https://discord.com/developers/applications → New Application → OAuth2 → add redirect URI `https://<your-domain>/api/discord/callback`
- **X**: https://developer.twitter.com/en/portal → New App → User authentication → enable OAuth2 with PKCE → add redirect URI `https://<your-domain>/api/x/callback` → scopes `tweet.read users.read`

### Discord role mapping

Edit the `KNOWN_ROLES` map in `api/discord/callback.js`:

```js
const KNOWN_ROLES = {
  '853265485178957834': 'Magnitude',
  // ...add Discord user ID -> role label pairs
};
```

Any Discord-verified Seismic guild member who isn't in the map gets the generic "Seismic Member" badge.

## Privacy

- Card data lives in your browser's `localStorage`. No backend storage.
- OAuth flows use Discord and X as identity providers only. We never post, DM, or scrape.
- The QR code links to a `/verify/<id>` URL that only resolves if the issuing browser has the matching local record (intentional — true cross-browser verification needs a backend the user can audit, which is out of scope for v2).

## License

MIT
