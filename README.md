# Welcome to Remix + Vite!

📖 See the [Remix docs](https://remix.run/docs) and the [Remix Vite docs](https://remix.run/docs/en/main/guides/vite) for details on supported features.

## Typegen

Generate types for your Cloudflare bindings in `wrangler.toml`:

```sh
npm run typegen
```

You will need to rerun typegen whenever you make changes to `wrangler.toml`.

## Development

Run the Vite dev server:

```sh
npm run dev
```

To run Wrangler:

```sh
npm run build
npm run start
```

## Deployment

> [!WARNING]  
> Cloudflare does _not_ use `wrangler.toml` to configure deployment bindings.
> You **MUST** [configure deployment bindings manually in the Cloudflare dashboard][bindings].

Cloudflare Pages should use this build command:

```sh
npm run build:cloudflare
```

For production builds, configure these Cloudflare Pages environment variables:

- `RUN_PRODUCTION_MIGRATIONS=true`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Do not set `RUN_PRODUCTION_MIGRATIONS` for preview builds. This keeps preview deployments
from applying migrations to the production D1 database.

Before enabling automatic migrations, confirm the production Pages `DB` binding points at the
same database as `env.production` in `wrangler.toml`. The build runs production migrations with:

```sh
npm run db:migrate:production
```

If D1 migrations fail, the Cloudflare Pages build exits non-zero and Cloudflare keeps serving
the previous production deployment.

To deploy manually with Wrangler:

```sh
npm run deploy
```

[bindings]: https://developers.cloudflare.com/pages/functions/bindings/
