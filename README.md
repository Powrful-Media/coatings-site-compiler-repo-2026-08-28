# coatings-site-compiler

Deploy lane for Powrful Media dealer sites. **Phase 0** of the compiler plan
(`strategy/COMPILER-AND-CRM.md`): a push to `main` becomes a Vercel deploy — same
project, same URL, version controlled, diffs Jay can review. The config-driven compiler
gets folded in at Phase 1; **right now this repo holds the built Polytek of Redding v1.0
site as static output**, not compiler source.

## How deploy works

- The built site (33 pages) and `vercel.json` sit at the repo root. Vercel serves the root
  directly — **no build step** (`vercel.json` sets `framework: null`).
- `vercel.json` must stay at the repo root: Vercel reads it only from there, and it carries
  `trailingSlash: true`, the config that preserves every indexed URL.
- Push to `main` → Vercel deploys automatically.
- `.vercelignore` keeps `scripts/`, `.github/`, and this README out of what gets served.
- Every push runs `scripts/audit.py` in CI (`.github/workflows/audit.yml`). Exit 0 = safe.
  The validator also checks that `vercel.json` + `trailingSlash` are present — it fails the
  build if they ever go missing.

Run the validator locally before you push:

```bash
python3 scripts/audit.py .
```

Last verified: 33 pages, 6 lead forms, 0 failures, all gates pass.

## Rules you can break your neck on

- **Do not remove `trailingSlash: true` from `vercel.json`.** Without it every preserved
  URL takes a redirect and the migration strategy is defeated silently. Caught one day
  before it would have shipped. CI now fails the build if it disappears.
- **Do not move `vercel.json` out of the repo root.** Vercel only reads it there. In a
  subfolder it is silently ignored and `trailingSlash` is lost.
- **Do not change any URL slug.** They match what Google has indexed. `/why-protek/` looks
  like a typo; it is the dealer's former brand and Google knows that address.
- **This repo is not the DNS cutover.** Pushing here deploys a Vercel URL — reversible.
  Cutting the live domain over is gated separately (`LAUNCH-GATES.md`, `CUTOVER-RUNBOOK.md`
  in the handoff package) and is Jay's + Jon's call.
- **Reuse the one canonical Vercel project.** Vercel's drag-and-drop makes a new project
  every time (three orphans already exist). This repo connects to one project, once.
- **New Vercel projects default to Deployment Protection ON**, which silently blocks
  outside reviewers. Confirm it is OFF on the preview so panelists can actually see it.
- **Verify unauthenticated, on both hostnames.** Check apex and `www` in Incognito — the
  Penntek migration failed by redirecting `www` and forgetting the apex.

## Layout

```
vercel.json                     project config — governs the deploy (trailingSlash, images)
index.html, <page dirs>/        the built site, served as-is from root
_astro/ images/ robots.txt      assets, sitemaps
scripts/audit.py                release validator (also run in CI)
.github/workflows/audit.yml     runs the validator on every push/PR
.vercelignore                   keeps tooling/docs out of the served deploy
```
