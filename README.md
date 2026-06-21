# rackettap-site

Marketing landing page + legal/support pages for **RacketTap**, hosted on GitHub Pages.

## Files

- `index.html` — landing page
- `privacy/index.html` — Privacy Policy (linked from App Store Connect)
- `support/index.html` — Support page (linked from App Store Connect)
- `style.css` — shared styles
- `icon.png` — app icon (1024×1024)

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Deploy

1. Push to `main` on GitHub.
2. Repo Settings → Pages → Source: `Deploy from a branch`, Branch: `main`, Folder: `/ (root)`.
3. Wait ~30–60 seconds. The site goes live at:

   ```
   https://<your-github-username>.github.io/rackettap-site/
   ```

   The URLs you give App Store Connect are then:
   - Privacy Policy: `https://<user>.github.io/rackettap-site/privacy/`
   - Support:        `https://<user>.github.io/rackettap-site/support/`

## Custom domain (optional, ~$10/year)

If you later want a prettier URL like `rackettap.app`:

1. Buy the domain (Namecheap, Cloudflare Registrar, etc.).
2. Add a `CNAME` file to this repo containing just the domain on one line.
3. Point the DNS A/AAAA records at GitHub Pages IPs (Apple's docs cover this).
4. Settings → Pages → Custom domain → enter the domain → wait for SSL provisioning.

The content doesn't change — only the URL.
