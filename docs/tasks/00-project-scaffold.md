# 00 — Project scaffold

## Goal

A running Vite + React + TypeScript app with routing, a Supabase client, and a build that
produces static files suitable for GitHub Pages. No features yet.

## Dependencies

None.

## Expected changes

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`
- `.env.example` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- `src/main.tsx`, `src/App.tsx`, `src/routes.tsx`
- `src/lib/supabase.ts` — the client, read from `import.meta.env`
- `src/lib/types.ts` — empty for now, one comment saying it mirrors the migrations
- `src/pages/SignIn.tsx`, `src/pages/Trips.tsx` — placeholders that render their name
- one small global stylesheet; no UI framework

## Acceptance criteria

- `npm run dev` serves the app; `/#/` shows the sign-in placeholder and `/#/trips` shows
  the trips placeholder.
- `npm run build` completes with no TypeScript errors and writes `dist/`.
- Opening `dist/index.html` through a static server and refreshing on `#/trips` still
  renders (proves hash routing works without a rewrite rule).
- `src/lib/supabase.ts` throws a clear error at startup if either env var is missing.

## Implementation notes

- `react-router-dom` with `createHashRouter` / `HashRouter`. Not `BrowserRouter` — GitHub
  Pages 404s on a refreshed deep path.
- `vite.config.ts`: `base: '/<repo-name>/'`. Ask the coordinator for the repo name if it
  is not obvious; do not guess a wrong one silently.
- Dependencies for this task: `react`, `react-dom`, `react-router-dom`,
  `@supabase/supabase-js`, and the Vite/TS dev deps. Nothing else.
- `tsconfig`: `strict: true`.
- Commit `.env.example`, never `.env`.
