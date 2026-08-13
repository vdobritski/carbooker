# 13 — Deploy to GitHub Pages

## Goal

The app is live at its GitHub Pages URL and a redeploy is one command.

## Dependencies

10. (11 is nice to have first, but not required.)

## Expected changes

- `package.json` — `gh-pages` dev dependency, `"deploy": "npm run build && gh-pages -d dist"`
- `vite.config.ts` — confirm `base` matches the repository name
- `README.md` — deploy section: the command, the env vars, the Pages setting

## Acceptance criteria

- `npm run deploy` publishes `dist/` to the `gh-pages` branch and the site loads at
  `https://<user>.github.io/<repo>/`.
- Sign-in works on the deployed site end to end: code email arrives, code verifies, session
  survives a refresh.
- Deep links work: opening `https://<user>.github.io/<repo>/#/trips/<id>` directly renders
  the trip, and refreshing on it does not 404.
- Assets load — no 404s in the console from a wrong `base`.
- A second `npm run deploy` updates the live site.

## Implementation notes

- Repository Settings → Pages → source: `gh-pages` branch, root.
- **The anon key ships in the bundle.** That is how Supabase is designed and it is fine —
  it is the RLS policies, not the key, that protect the data. Do not try to hide it, and do
  not put the service-role key anywhere near the client.
- Vite inlines `VITE_*` env vars at build time, so `.env` must be present on the machine
  running `npm run deploy`. Say so in the README.
- No GitHub Actions workflow. Deploy is a manual command, on purpose.
- If the Supabase project has a site-URL / redirect allow-list configured, add the Pages
  URL. With email OTP there is no redirect, so this usually is not needed — check rather
  than assume.
