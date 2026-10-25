# Hosting the Token eligibility demo

The demo is a static build (`npm run web:build` → `dist-web/`): every check runs in the visitor's browser against the public Portaldot V3 testnet nodes, so the host serves files and nothing else. No key, no service, no database.

The intended production destination is the same custom-domain server that hosts the ReviveCheck App (`revivecheck.axiqo.xyz`, Nginx, releases under a directory with an atomically switched `current` symlink, Let's Encrypt certificates per site). GitHub Pages (`.github/workflows/pages.yml`) remains an optional mirror; it is not the destination the submission names.

Which build is served is stated by `hosting.json`, written beside the files after the build (`node scripts/hosting-manifest.mjs`), schema `revivecheck-consumer.hosting-manifest.v1`: the source commit, the repository, the build time and every served file with its SHA-256. It is verified by fetching it, parsing it as JSON (an HTTP 200 alone proves nothing: a single-page fallback answers every path with the HTML shell), comparing its commit with the one built and the served `index.html` with its listed hash. The ReviveCheck repository ships that reader: `node scripts/verify-hosting.mjs --site <url> --commit <sha>`.

## Two placements

| | A: its own host name (recommended) | B: a path under the App |
| --- | --- | --- |
| URL | `https://demo.revivecheck.axiqo.xyz/` | `https://revivecheck.axiqo.xyz/demo/` |
| Build | `WEB_BASE=/ npm run web:build` | `WEB_BASE=/demo/ npm run web:build` |
| Needs | one DNS `A` (and `AAAA`) record for the new name pointing at the server, a certificate (`certbot certonly --webroot`), one new vhost file | one `location` block added to the existing App vhost and an Nginx reload |
| What it shows | a separate origin for a separately built application | the same origin as the App; simpler, but the two sites share a host name |

Both serve the files from `/var/www/revivecheck-demo/current` → `releases/<id>`, keep every earlier release for rollback, and serve `/hosting.json` (A) or `/demo/hosting.json` (B) as JSON.

### A: vhost for the host name

```nginx
server {
    listen 80; listen [::]:80;
    server_name demo.revivecheck.axiqo.xyz;
    location ^~ /.well-known/acme-challenge/ { root /var/www/revivecheck-demo/acme; try_files $uri =404; }
    location / { return 301 https://demo.revivecheck.axiqo.xyz$request_uri; }
}
server {
    listen 443 ssl http2; listen [::]:443 ssl http2;
    server_name demo.revivecheck.axiqo.xyz;
    ssl_certificate /etc/letsencrypt/live/demo.revivecheck.axiqo.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/demo.revivecheck.axiqo.xyz/privkey.pem;
    root /var/www/revivecheck-demo/current;
    index index.html;
    server_tokens off; autoindex off;
    add_header X-Content-Type-Options nosniff always;
    location ~ (^|/)\. { return 404; }
    location ^~ /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; add_header X-Content-Type-Options nosniff always; }
    location = /hosting.json { try_files $uri =404; add_header Cache-Control "no-cache"; add_header X-Content-Type-Options nosniff always; }
    location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache"; add_header X-Content-Type-Options nosniff always; }
}
```

### B: location block inside the App vhost

```nginx
    location ^~ /demo/ {
        alias /var/www/revivecheck-demo/current/;
        try_files $uri $uri/ /demo/index.html;
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options nosniff always;
    }
```

`/demo/hosting.json` and `/demo/assets/*` resolve through the alias; `/demo/anything-else` falls back to the page.

## Procedure

```sh
# 1. Build from a clean commit and record the manifest.
git status --porcelain                                   # must be empty
WEB_BASE=/ npm run web:build                             # or WEB_BASE=/demo/ for placement B
RELEASE="$(date -u +%Y%m%d)-$(git rev-parse --short HEAD)-demo-r1"
node scripts/hosting-manifest.mjs --dist dist-web --release "$RELEASE" --site https://demo.revivecheck.axiqo.xyz/
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -C dist-web -czf "revivecheck-demo-$RELEASE.tar.gz" .   # no AppleDouble entries
shasum -a 256 "revivecheck-demo-$RELEASE.tar.gz"

# 2. Upload; extract into /var/www/revivecheck-demo/releases/$RELEASE; verify every file against hosting.json
#    (sha256sum -c from its files list) and that no ._* file was extracted.
# 3. First time only: DNS record, certificate, vhost (A) or location block (B), `nginx -t`, reload.
# 4. Switch the symlink atomically: ln -s releases/$RELEASE current.tmp && mv -Tf current.tmp current
# 5. Verify from outside: in the ReviveCheck checkout,
#    node scripts/verify-hosting.mjs --site https://demo.revivecheck.axiqo.xyz/ --commit $(git rev-parse HEAD)
#    then open the page in a clean browser (no login, no wallet) and complete the journey in README.md.
# 6. Keep the previous release directories; record the receipt in this file's log below.
```

## Log

No deployment has been performed yet. The first entry records the release ID, the commit, the payload hash, the index hash, the verification output and the clean-browser journey.
