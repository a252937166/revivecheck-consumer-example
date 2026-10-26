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

| | |
| --- | --- |
| Release | `20261026-52ca088-demo-r1`, placement A, served from `/var/www/revivecheck-demo/current` → `releases/20261026-52ca088-demo-r1` on the server that hosts the App; vhost `/etc/nginx/conf.d/revivecheck-demo.conf` (SHA-256 `c86c3cc8…42058`, prepared with the host name's certificate on 2026-10-26 before this deployment; unchanged by it, no reload) |
| Source | commit `52ca088` (clean working tree), `WEB_BASE=/ npm run web:build`, built 2026-10-26T11:16:43Z |
| Payload | `revivecheck-demo-20261026-52ca088-demo-r1.tar.gz`, SHA-256 `8e97a4e085dd625829a2006c91b8e9a70757e806feea2baca657705816917996`, packed without macOS metadata; 4 files plus `hosting.json` (`revivecheck-consumer.hosting-manifest.v1`) inside |
| Index SHA-256 | `5afcc667537a7e2658269d86deb0251507593f1485ab5f3e3ddeffbb4791b4f2` |
| Activated | 2026-10-26T11:18:55Z by creating the `current` symlink atomically (no earlier release; the pending guard disappeared) |
| Verification | on the server every file matched its hash and no `._*` file was extracted; from outside, `scripts/verify-hosting.mjs --site https://demo.revivecheck.axiqo.xyz/ --commit 52ca0880…` reported every check ok (manifest served as `application/json`, commit and release as built, `index.html` hash as listed); all 4 files fetched over HTTPS matched; `/api/anything` and `/.git/config` 404; HTTP redirects to HTTPS (301) |
| Clean-browser journey | `node test/browser/release-journey.mjs --site https://demo.revivecheck.axiqo.xyz/` at 11:21:57Z: 11 of 11 (the wrong entry withheld with `entry-mismatch:decimals`, the corrected entry available with a stated deadline, release 1 `2a173b58…` prepared at 11:23:16Z on evaluation `a4135980…` at block 202,605, verified in Node, read by `revivecheck-catalog read` in another process, loaded back into the reader; no console errors) |
| Receipts | `deployment-20261026-52ca088-demo-r1.json`, `hosting-20261026-52ca088-demo-r1.json`, `hosting-verification-20261026-52ca088-demo-r1.json`, `sha256-20261026-52ca088-demo-r1.txt` and the payload under `/var/www/revivecheck-demo/ops/` |
| Mirror | the Pages workflow built the same commit at <https://a252937166.github.io/revivecheck-consumer-example/> |

Rollback: there is no earlier release; removing the `current` symlink restores the server's pending guard. Later releases are switched to by the same symlink replacement and every release directory is retained.
