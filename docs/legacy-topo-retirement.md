# Retired topo hostname

The existing `tabvar` Worker serves `app.tabvar.org` and `topos.tabvar.org` as
Custom Domains. The old hostname no longer needs PHP or an origin server.

The Cloudflare Bulk Redirect list `tabvar_legacy_topos` runs first and keeps all
reviewed route/file 301s. The remaining old homepage requests get a 301 to
`https://app.tabvar.org/topos`; other old URLs get a plain 410 page with that link.
Restricted URLs also get the generic 410, without exposing original content.

Keep the legacy hostname check before assets and React Router in `workers/app.ts`.
`assets.run_worker_first` ensures old URLs cannot accidentally serve new app assets.
After that check, GET/HEAD asset responses pass through unchanged; asset misses
and other methods reach React Router. The active `/topos` index stays 200.

Validate with `npm run verify` and `npm run build`. No database migration is needed.
