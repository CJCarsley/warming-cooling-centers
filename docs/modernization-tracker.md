# Modernization & Future-Proofing Tracker

Tracks actions from the 2026-07-09 codebase efficiency / future-proofing review.
Update the Status column as items land (link the PR).

## Critical

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Upgrade all 21 Lambdas `runtime: 18` → `22` (Node 18 EOL Sept 2025) | **In progress** — this PR | In-place CFN update; no downtime. `@aws-amplify/backend@1.22.0` supports `18\|20\|22\|24`. |
| 2 | Remove `manualChunks` rule that forces `@arcgis/core` into one 12 MB chunk (3.3 MB gz) | Open | `vite.config.ts` — let the SDK code-split itself; also revisit `chunkSizeWarningLimit: 5000`. |
| 3 | Cache ArcGIS token in `getArcGISPublicToken` module scope + `Cache-Control` header; raise 10 rps API throttle | Open | Endpoint is hit by every visitor; throttle fails under storm-event traffic spikes. |

## High-value

| # | Item | Status | Notes |
|---|------|--------|-------|
| 4 | Centralize feature-layer URL (13 files re-declare it) | Open | Frontend: import from `src/config/map.ts`. Backend: shared constant/env. |
| 5 | Dedupe `getArcGISToken` in `updateStatus/handler.ts` (use `shared/arcgisToken.ts`); add module-scope token cache in handlers | Open | |
| 6 | Split `AdminPanel.tsx` (1,163 lines / ~30 useState) into `FacilityAdminCard` etc.; same for `UserManagementPanel.tsx` | Open | |
| 7 | Make toggle+clear atomic (single request instead of two sequential POSTs to `facilities/status`) | Open | Failure between the two leaves mixed state. |
| 8 | Fix `amplify.yml` cache: `npm ci` deletes `node_modules`, so caching it is pure overhead | Open | Cache `~/.npm` instead. |

## Future-proofing

| # | Item | Status | Notes |
|---|------|--------|-------|
| 9 | Move hardcoded personal email out of `backend.ts` SuperAdmin resource / `NOTIFICATION_EMAILS` | Open | Bus factor 1. |
| 10 | Lock CORS `allowOrigins` to app domain (`backend.ts` TODO) | Open | |
| 11 | `FacilityOverrides` DynamoDB table: document manual creation; consider per-branch name (sandbox currently shares prod table) | Open | |
| 12 | Nightly reset: move to EventBridge Scheduler with `America/Chicago` (removes DST drift); decommission external ArcGIS Notebook reset | Open | Notebook ignores keepOpen — competing reset mechanisms. |
| 13 | Add Vitest (start with `utils/hours.ts`) + GitHub Action for `lint` + `tsc` on PRs | Open | |
| 14 | Dependency horizon (off-season): React 19, react-router 7, Vite 7, i18next current, `@arcgis/core` 4.33+ | Open | One at a time; not urgent. |

## Minor

| # | Item | Status | Notes |
|---|------|--------|-------|
| 15 | Drop derivable `facilities` state in `useFeatureLayer`; share fetch with `FacilityListPage` | Open | |
| 16 | `fieldSchemaCache.ts`: move token out of URL query string | Open | |
| 17 | Delete stray `dchd_white.png` at repo root (duplicates `public/`) | Open | |
| 18 | Optional: slim `LoginPage` chunk (484 KB JS from `@aws-amplify/ui-react`) | Open | Lazy-loaded already; admins only. |

## Change log

- 2026-07-09 — Review completed; tracker created. Item 1 started (branch `worktree-lambda-runtime-22`).
