# KTS Host website

The public storefront presents KTS Host, its four service brands, and the shared infrastructure specifications. It links visitors to the KTS Host Discord for service information. There are no public account, sign-in, checkout, or admin pages or API routes.

Free offers shown on the site: VPS with 512 GB RAM and 80 threads, and bot hosting with 1 GB RAM, 5.9 GB storage, and 1 core. Shared infrastructure is listed as 8 TB RAM, 63.4 TB storage, and 256 cores. Contact: https://discord.gg/freevm.

## Run locally

Requires Node.js 24.12 or later. From this folder, run:

```sh
npm start
```

Then open http://localhost:8080. The site is served from `public/`; the KTS Host logo and other local assets are in `public/assets/`.

The previous storefront's private database and billing worker remain server-side, but its account and operations routes are not exposed by the website.

## GitHub Pages

The static `public/` site is published from the `gh-pages` branch at https://freediamodns.github.io/zubizubidada/.
