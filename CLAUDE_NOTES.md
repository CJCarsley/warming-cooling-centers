# Claude Reference Notes — Warming & Cooling Centers

## Project Overview

Douglas County, Nebraska public-facing app showing warming/cooling center locations on an ArcGIS
map. Staff admins can toggle facility status (warming/cooling active) via a protected admin panel.
Built with React + TypeScript, AWS Amplify Gen 2, ArcGIS JS API.

**Stack**: React 18, TypeScript, Vite, react-i18next (en/es/vi/ar), CSS Modules, ArcGIS JS API,
AWS Amplify Gen 2 (Cognito auth, Lambda, API Gateway, EventBridge, DynamoDB), CDK v2.

---

## Production Deployment

- **Live app**: https://master.d2ru7u72364jx5.amplifyapp.com
- **AWS Region**: us-west-2
- **Amplify App ID**: `d2ru7u72364jx5`
- **GitHub repo**: https://github.com/CJCarsley/warming-cooling-centers
- **Default branch**: `master`
- **CI/CD**: GitHub → Amplify auto-deploy on push to connected branches

---

## amplify.yml — Final Working Build Commands

```yaml
backend:
  phases:
    build:
      commands:
        - npm install --prefix amplify --legacy-peer-deps   # NOT npm ci — Windows lock file incompatible with Linux CI
        - npm install --no-save esbuild --legacy-peer-deps  # CDK bundler runs npx --no-install esbuild from project root
        - npm exec --prefix amplify -- ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID

frontend:
  phases:
    preBuild:
      commands:
        - npm ci --legacy-peer-deps  # eslint-plugin-jsx-a11y peer dep conflict with eslint 10
    build:
      commands:
        - NODE_OPTIONS=--max-old-space-size=7168 npm run build  # @arcgis/core exhausts default 512MB heap
```

---

## Amplify Secrets (SSM Parameter Store)

Amplify Gen 2 `secret()` resolves at Lambda startup from SSM. The path is NOT
`/amplify/{appId}/{branchName}/{secret}` — it appends a backend suffix:

```
/amplify/d2ru7u72364jx5/master-branch-ee9b12ac00/ARCGIS_CLIENT_ID
/amplify/d2ru7u72364jx5/master-branch-ee9b12ac00/ARCGIS_CLIENT_SECRET
```

The actual path is visible in the Lambda's `AMPLIFY_SSM_ENV_CONFIG` environment variable.
Shared (branch-agnostic) fallback path: `/amplify/shared/d2ru7u72364jx5/{secret}`

---

## Amplify Hosting Setup Requirements

1. **Service role**: Create `amplifyconsole-backend-role` in IAM with `AdministratorAccess-Amplify`
   policy. Amplify needs this for CDK/CloudFormation permissions during `pipeline-deploy`.

2. **SPA routing**: Add rewrite rule under Hosting → Rewrites and redirects:
   - Source: `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>`
   - Target: `/index.html`
   - Type: 200 (Rewrite)

3. **CORS**: `backend.ts` currently uses `Cors.ALL_ORIGINS`. Update to production domain when stable.

---

## Production Cognito User Pool

`pipeline-deploy` creates a **new** Cognito pool separate from sandbox. Users must:
1. Re-register on the production URL
2. Be manually added to the `SuperAdmin` group in the production Cognito console

The `AwsCustomResource` that auto-adds `cjcarsley@douglascounty-ne.gov` to SuperAdmin
silently skips if the user doesn't exist yet — run it again after registering or add manually.

---

## ArcGIS Coordinate System Gotcha

- `Point.x` / `Point.y` = raw coordinates in the geometry's spatial reference (may be meters if Web Mercator)
- `Point.latitude` / `Point.longitude` = always WGS84 degrees (auto-converted by ArcGIS)
- The Search widget returns result geometries in Web Mercator — always use `.latitude`/`.longitude`
  for any geographic calculation, not `.x`/`.y`
- Search widget's `select-result` event is not typed in ArcGIS TS typings — cast to `any`

**Feature Layer URL**:
`https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0`

---

## CDK Circular Dependency Rules (hard-won)

Amplify Gen 2 puts each `defineFunction` in its own CFN nested stack. Any time you reference
a Lambda function from a custom stack (`backend.createStack(...)`), you get a one-directional
dep: custom stack → Lambda stack. That is fine. These create cycles:

1. **`fn.addEnvironment(key, table.tableName)` where table is in the custom stack** — makes Lambda
   stack import a value from the custom stack. If the custom stack also imports Lambda ARN (via
   LambdaIntegration), you have a cycle. Fix: hardcode the value in `resource.ts` instead.

2. **`table.grantReadData(fn)` / `table.grantWriteData(fn)` across stacks** — the CDK grant method
   adds a policy to the Lambda's role (Lambda stack) referencing the table ARN (custom stack token).
   Fix: use `fn.addToRolePolicy(new PolicyStatement({ resources: [Stack.of(fn).formatArn({ resourceName: 'literal-name' })] }))`.
   IMPORTANT: use a **literal string** for resourceName, NOT `table.tableName` — `table.tableName`
   is a CFN token (Ref) that creates a cross-stack import even if you called `Stack.of(fn)`.

3. **`LambdaFunctionTarget(fn)` for EventBridge** — `.bind()` calls `fn.addPermission(sourceArn: rule.ruleArn)`,
   placing a CfnPermission in the Lambda's stack with the rule ARN from the custom stack. Cycle.
   Fix: create `new CfnPermission(apiStack, ...)` in the custom stack directly, and use a plain
   `IRuleTarget = { bind: () => ({ arn: fn.functionArn }) }` that skips `addPermission`.

4. **DynamoDB `tableName` conflicts across Amplify environments** — if you specify an explicit
   `tableName`, every Amplify branch environment (feature branches, master) tries to create a table
   with that name. DynamoDB names are account/region-scoped → conflict. Fix: either omit `tableName`
   (auto-generate, unique per stack) or manage the table outside CDK and reference by hardcoded name.

---

## Lambda Functions

| Function | Route | Purpose |
|---|---|---|
| `updateStatus` | POST /facilities/status | Toggle Warming_Active / Cooling_Active on ArcGIS feature; sends SES email on activation |
| `getUsersAndFacilities` | GET /admin/users | List Cognito users (with groups) + ArcGIS facilities (SuperAdmin **or Admin**) |
| `updateUserFacilities` | PATCH /admin/users/facilities | Add/remove facility assignment for a user |
| `getKeepOpen` | GET /facilities/keep-open | Return which of caller's facilities have a midnight-reset override active |
| `updateKeepOpen` | PATCH /facilities/keep-open | Set or clear a keep-open override in DynamoDB |
| `autoResetFacilities` | EventBridge cron | Nightly midnight CT reset — deactivates all facilities except those with a keep-open override |
| `addFacility` | POST /facility/add | Add new ArcGIS feature, append ObjectID to caller's `custom:facility_ids`, seed creator email in DynamoDB |
| `updateFacilityAttributes` | POST /facility/update-attributes | Full attribute update for an existing facility (ownership check via `custom:facility_ids`) |
| `getFacilityNotifications` | GET /facilities/notifications | Return `notificationEmails` string from DynamoDB for caller's facilities |
| `setFacilityNotifications` | PATCH /facilities/notifications | Write `notificationEmails` to DynamoDB (comma-separated addresses) |
| `deleteFacility` | POST /facility/delete | ArcGIS `applyEdits` delete, remove ObjectID from caller's Cognito attribute, delete DynamoDB item |
| `manageUserRole` | POST /admin/users/role | Grant or remove the `Admin` Cognito group for a target user; blocks removing Admin from `cjcarsley@douglascounty-ne.gov`; only `Admin` group manageable (not `SuperAdmin`) |

**SES config** (in `updateStatus/handler.ts`): sender `do-not-reply@dcgis.org`, region `us-east-1`.
Recipients are hardcoded in the handler — update there if the notification list changes.

**EventBridge schedule**: `cron(0 6 * * ? *)` = 06:00 UTC = midnight CST (~1 AM CDT; DST drift accepted).

**DynamoDB table** `FacilityOverrides`: PK `facilityId` (String). Schema coexists `keepOpen` (Boolean) and `notificationEmails` (String, comma-separated) in the same item. Uses `UpdateExpression SET/REMOVE` — not PutItem — so fields coexist without overwriting each other.
Table is managed **outside CDK** (was created by feature/auto-reset branch Amplify deployment with
RETAIN policy). Lambda functions reference it by hardcoded name `'FacilityOverrides'` in their
`resource.ts` environment blocks. IAM policies use `Stack.of(fn).formatArn(...)` with the literal.

**Shared ArcGIS token utility**: `amplify/functions/shared/arcgisToken.ts` exports `getArcGISToken()`.
Reads `ARCGIS_CLIENT_ID` / `ARCGIS_CLIENT_SECRET` from env. Import with `'../shared/arcgisToken'`
from any sibling Lambda directory — esbuild follows relative imports across function boundaries at
bundle time.

---

## Feature Branch History (all merged to master)

### feature/flash-cursor (PR #1) — merged
- Empty map click drops a temporary animated pin, then triggers the Nearby Facilities panel
- Pin flashes 3× then disappears; no UI element persists for the click point itself
- Modified: `src/components/Map/MapView.tsx`

### feature/email-notification (PR #2) — merged
- `updateStatus` Lambda sends SES email when a facility is activated (warming or cooling ON)
- Deactivations are silent; email failure is non-fatal (logged, request still succeeds)
- Queries ArcGIS for facility name before sending; recipient list hardcoded in handler
- Modified: `amplify/functions/updateStatus/handler.ts`, `resource.ts`, `amplify/backend.ts`,
  `amplify/package.json` (`@aws-sdk/client-ses`)

### feature/get-directions (PR #3) — merged
- Added a single "Get Directions" button to the facility popup
- Desktop: Google Maps with origin = last map-click/search point; Mobile: device GPS as origin

### feature/get-directions-2 (PR #4) — merged
- Replaced single button with three-service row: Google Maps, Waze, Apple Maps
- Added directions buttons to each expanded facility in the Nearby panel (uses search/click point as origin)
- Fixed nested scrollbar in Nearby panel (removed `overflow-y: auto` from `.detail`)
- New files: `src/components/common/DirectionsButtons.tsx`, `.module.css`, `src/utils/directions.ts`
- New component: `src/components/Map/FacilityDetails.tsx` (shared between popup and nearby panel)

### feature/auto-reset — merged (PR #? — merged ~2026-05-07)
- Nightly auto-reset at midnight CT via EventBridge + Lambda (`autoResetFacilities`)
- DynamoDB `FacilityOverrides` table: facility admins can set a "Keep Open" override to skip reset
- Mutual exclusivity: turning Warming ON while Cooling is ON (or vice versa) auto-deactivates the other
  with a yellow conflict warning in the confirm dialog
- Keep-open is cleared silently on any Warming/Cooling toggle (regardless of direction)
- Admin panel UI: Keep Open checkbox per facility card, blue left-border highlight when active,
  info tooltip button, amber "Midnight reset override active" badge
- New API routes: `GET /facilities/keep-open`, `PATCH /facilities/keep-open` (Cognito-authorized)
- All 4 i18n locales updated (en/es/vi/ar)
- Key files: `amplify/functions/getKeepOpen/`, `updateKeepOpen/`, `autoResetFacilities/`,
  `src/pages/admin/AdminPanel.tsx`, `AdminPanel.module.css`

### feature/design-improvements — merged (PR #5–9 range)
- Basemap switcher, flame/snowflake symbols for warming/cooling markers, Douglas County logo in header
- Unified nav border, single "Get Directions" button replaced with three-service row in this merge
- Mobile legend overlay with collapse/expand toggle (`MobileLegendOverlay.tsx`)
- `legendItems.tsx` extracted as a shared data file for legend rendering

### feature/WCAG-update — merged (PRs #10 and #11)
- WCAG 2.1 AA accessibility pass: focus management, ARIA labels, skip links, contrast fixes
- PR #10: main WCAG fixes + design-improvements integration + basemap fix (invalid basemap IDs replaced)
- PR #11: filter Nearby panel to active-only facilities; empty-state message; mobile legend repositioned to bottom-left
- Note: local `master` was stale during development here — `dd9be85` (legend reposition) was a
  local-only commit that was never pushed as part of the PR. It got swept into feature/attribute-editing
  inadvertently and was dropped via `git rebase --onto` before pushing.

### feature/update-1.0 — merged (~2026-05-08)
- Mobile floating map legend repositioned to bottom-left (was top-right, overlapping content)
- Keep Open bug fix (details in session history)

### feature/update-1.1 — merged (~2026-05-08)
- Mobile footer anchored/frozen (removed from scroll flow)
- Admin: ability to add/remove notification email addresses per facility (DynamoDB `notificationEmails`)
- Mobile tooltip: 'i' button next to Keep Open now toggles tooltip on tap (click handler added)

### feature/update-1.2 — merged (~2026-05-08)
- Fixed header bar wrapping on Android narrow viewports
- Keep Open active → Active toggle locked (cannot be unchecked while keep-open override is set)
- "Contact Us" footer link changed to `https://contact.dogis.org/`

### feature/update-1.3 — merged (PR #16 — 2026-05-08)
- Re-established footer after it was lost in a prior merge
- Disabled pinch-zoom (`maximum-scale=1.0, user-scalable=no` in viewport meta)
- Nearby panel: clicking a result now expands the full card immediately
- Basemap selector auto-dismisses when a basemap is chosen
- Mobile: site title restored to header
- **Delete Facility**: "Delete" link per card opens a confirm `<dialog>` → POST /facility/delete;
  removes from ArcGIS, from caller's Cognito `custom:facility_ids`, and from DynamoDB
- Fixed: Save Notifications was sending `notificationEmails` field but Lambda expected `emails` → unified to `emails` in PATCH body
- New Lambda: `deleteFacility` + `getFacilityNotifications` + `setFacilityNotifications`
- New routes: GET/PATCH /facilities/notifications, POST /facility/delete

### feature/update-1.3 hotfix — merged (PR #17 — 2026-05-08)
- After `addFacility`, the cached JWT still had the old `custom:facility_ids` (without the new
  ObjectID), so immediate edit/notification ops returned 403
- Fix: call `fetchAuthSession({ forceRefresh: true })` in `onFacilityAdded` callback, then update
  the stored `idToken` state in AdminPanel so subsequent API calls use the fresh token

### feature/attribute-editing — merged (PR #12 — merged 2026-05-08)
- **Add New Facility**: "Add New" button next to "Your Facilities" heading opens a two-step `<dialog>` modal
  - Step 1: ArcGIS MapView + Search widget (top-right) + click-to-drop-pin; coords displayed below map
  - Step 2: dynamic attribute form built from live FeatureServer field schema (`?f=json`); coded-value
    domains render as `<select>`; address field auto-populated via reverse geocode (`reverseGeocode` endpoint)
  - On save: calls `POST /facility/add` Lambda → ArcGIS `applyEdits` (adds) → new ObjectID appended
    to `custom:facility_ids`; new facility immediately appended to "Your Facilities" list
- **Edit Existing Facility**: "Edit" link per facility card expands an inline attribute form
  - Fetches live `outFields=*` for that feature; reuses cached field schema
  - CSS `max-height` transition for expand/collapse; only one facility expanded at a time
  - On save: calls `POST /facility/update-attributes` Lambda → ArcGIS `applyEdits` (updates)
  - Name field update reflected immediately in the list; success announced via `aria-live`
- **Field schema cache**: `src/utils/fieldSchemaCache.ts` — module-level singleton; deduplicates
  in-flight requests; filters out system fields (OBJECTID, GlobalID, CreationDate, etc.) and
  non-editable fields
- **i18n**: new keys under `admin.addFacility` and `admin.editFacility` in en.json and es.json
- New files: `AddFacilityModal.tsx`, `AddFacilityModal.module.css`, `src/utils/fieldSchemaCache.ts`,
  `amplify/functions/addFacility/`, `amplify/functions/updateFacilityAttributes/`,
  `amplify/functions/shared/arcgisToken.ts`

### feature/updates-2.0 — merged (PR #18 — 2026-05-12)

**Task 1 — Mobile tooltip fix:**
- `.facilityCard` had `overflow: hidden` which clipped the absolutely-positioned Keep Open tooltip
  when it extended above the card top edge on mobile
- Fix: removed `overflow: hidden` from `.facilityCard`; added `border-radius: 0 0 8px 8px` to
  `.editForm` to preserve visual corner rounding when the edit form is expanded

**Task 2 — Accessible Facility List page (`/list`):**
- New route `/list` → `FacilityListPage.tsx`: queries ArcGIS REST API directly (no auth) for
  `Warming_Active='Yes' OR Cooling_Active='Yes'`; renders WCAG 2.1 AA compliant `<table>` with
  Name, Address (→ Google Maps link), Type badge (text+color), Hours, Phone, ADA Compliant
- "List" NavLink added to header between Map and Staff Login with `title="View Facilities as List"`
- Footer `/accessibility` link converted from `<a href>` to React `<Link to>` for SPA nav
- All 4 i18n files updated with `nav.list`, `nav.listTitle`, `facilityList.*` keys
- ar.json and vi.json were also missing `nav.staffLogin` — added

**Task 3 — Accessibility Statement page (`/accessibility`):**
- New route `/accessibility` → `AccessibilityStatement.tsx`: static content page covering WCAG 2.1
  AA goals, feature list, map alternative note, feedback/contact, ADA Title II info
- Content is English-only (legal document); heading uses the existing `footer.accessibilityStatement`
  i18n key; body hardcoded

**Task 4 — Admin group + User Management access for Admins:**
- `amplify/auth/resource.ts`: added `'Admin'` to `groups` array (Cognito group created on next deploy)
- New Lambda `manageUserRole` (POST /admin/users/role):
  - Accepts `{ targetUsername, action: 'add'|'remove', group: 'Admin' }`
  - Caller must be SuperAdmin or Admin
  - Only `Admin` group is manageable (SuperAdmin group blocked)
  - Removing Admin from `cjcarsley@douglascounty-ne.gov` is blocked (server-enforced via `AdminGetUser`)
- `getUsersAndFacilities` handler updated:
  - Now allows Admin callers (not just SuperAdmin)
  - Calls `ListUsersInGroup` for both Admin and SuperAdmin groups in parallel
  - Returns `groups: string[]` per user in the response
- `useAuthGroups.ts` now returns `isAdmin` in addition to `isSuperAdmin`
- `LoginPage.tsx`: `/admin/users` route now accessible to `isSuperAdmin || isAdmin`
- `UserManagementPanel.tsx`:
  - `CognitoUser` interface has `groups: string[]`
  - Shows "Admin" badge next to email for users in Admin group
  - Grant/Remove Admin button per user row (hidden for SuperAdmin users; Remove Admin disabled for protected email)
  - `handleRoleToggle` optimistically updates local state on success
- Key constant: `PROTECTED_EMAIL = 'cjcarsley@douglascounty-ne.gov'` in both handler and panel

### feature/update-2.1 — merged (PR #19 — 2026-05-13)

**Fix 1 — User Management link visibility:**
- `useAuthGroups.ts`: changed `fetchAuthSession()` → `fetchAuthSession({ forceRefresh: true })` so
  Cognito group membership is always re-validated on each Staff Login page load (not served from JWT cache)
- `AdminPanel.tsx`: `{isSuperAdmin && <NavLink>User Management</NavLink>}` → `{(isSuperAdmin || isAdmin) && ...}`
  so all Admin-group users see the link, not just SuperAdmin

**Fix 2 — Mobile white bar below footer:**
- Root cause: after SPA navigation on mobile, `html/body` height and `#root` layout was not
  anchored to the visual viewport; a gap appeared below the footer on some transitions
- Fix in `src/App.css` mobile block: replaced `height: 100dvh; min-height: 0` on `#root` with
  `position: fixed; inset: 0` — anchors the shell to the visual viewport, immune to browser chrome changes

**Fix 3 — Keep Open Lambda false-positive (midnight resets ignoring overrides):**
- `amplify/functions/getKeepOpen/handler.ts`: handler was returning ALL DynamoDB items without
  filtering; facility had `keepOpen` attribute removed (REMOVE expression) so the item existed but
  had no `keepOpen: true` — Lambda still returned it, causing AdminPanel to show override as active,
  but `autoResetFacilities` found no `keepOpen: true` and reset anyway
- Fix: added `.filter((item) => item.keepOpen === true)` before `.map()` in getKeepOpen handler

**Token injection in AdminPanel (added for proxy compatibility):**
- `AdminPanel.tsx`: added `getPublicArcGISToken` import; injected token into two raw fetch calls
  (`loadFacilities` effect and `handleEditOpen` callback) that were previously using ArcGIS JS API
  implicitly — needed after feature layer was made private in feature/proxy

### feature/proxy — merged (PR #20 — 2026-05-13)

New Lambda `getArcGISPublicToken` returns a short-lived ArcGIS token so the feature layer can be
made **private** (unshared from public) while remaining accessible to all app users without Cognito auth.

**Lambda** (`amplify/functions/getArcGISPublicToken/`):
- Public API route — NO Cognito authorizer: `GET /arcgis-token`
- Calls ArcGIS OAuth `client_credentials` grant with `ARCGIS_CLIENT_ID` / `ARCGIS_CLIENT_SECRET`
- Returns `{ token: string, expires: number }` where `expires = Date.now() + (expires_in - 60) * 1000`
  (60-second buffer so clients don't use a token that's about to expire)
- Secrets stored in SSM, read via Amplify `secret()` in `resource.ts`

**Client-side token cache** (`src/utils/arcgisToken.ts`):
- Module-level `cache` (token + expiry); inflight-deduplication via a single `inflightRequest` promise
- Serves cached token if >60s of life remains; otherwise fetches fresh
- `export async function getPublicArcGISToken(): Promise<string>`

**ArcGIS JS API interceptor** (`src/main.tsx`):
- `esriConfig.request.interceptors.push({ urls: 'https://services.arcgis.com/pDAi2YK0L0QxVJHj/', before: async (params) => { ... inject token ... } })`
- `esriConfig.request.interceptors ??= []` guard required (TypeScript TS18048 — value can be undefined)

**Other files updated to use token**: `FacilityListPage.tsx`, `fieldSchemaCache.ts`, `AdminPanel.tsx`

**ArcGIS Online config required** (manual steps, not in code):
1. Create a new OAuth2 "Server app" in ArcGIS Developer portal with `client_credentials` grant
2. Store client ID + secret in SSM under the Amplify branch secret path
3. In ArcGIS Online, unshare the feature layer from Public; add the OAuth app identity as a viewer

### feature/footer-update — merged (PRs #21 and #22 — 2026-05-13)

Mobile footer had disappeared completely after the `position: fixed; inset: 0` change in update-2.1.

**Root cause**: The desktop `#root { min-height: 100vh }` rule was never canceled in the mobile
media query. On iOS Safari, `100vh` can exceed the visual viewport height (URL bar counts toward
100vh). This pushed the CSS Grid container taller than the screen; `overflow: hidden` then clipped
the footer (in the 3rd grid row) below the bottom of the visible area.

**Fix** (`src/App.css` mobile block):
- Added `display: grid; grid-template-rows: auto 1fr auto` to `#root` — gives header/main/footer
  explicit rows so main's `flex-grow` can't starve the footer
- Added `min-height: 0` to `#root` mobile rule to cancel the desktop `min-height: 100vh`
- Added `overflow-y: auto; -webkit-overflow-scrolling: touch; min-height: 0` to `main` so it
  alone scrolls within the 1fr row

**Current final state of the mobile block in App.css:**
```css
@media (max-width: 767px) {
  html, body { height: 100%; overflow: hidden; }
  #root {
    position: fixed;
    inset: 0;
    min-height: 0;  /* cancels desktop min-height:100vh — iOS Safari 100vh > visual viewport */
    overflow: hidden;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }
  main {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    min-height: 0;
  }
}
```

**iOS Safari viewport notes:**
- `100vh` ≠ visual viewport height when the browser URL bar is visible. Use `position: fixed; inset: 0` to anchor to the visual viewport instead of relying on `height`/`min-height` values.
- `100dvh` is a safer alternative to `100vh` for full-viewport layouts but was NOT used here because
  `position: fixed; inset: 0` is more robust and avoids any unit-support questions on older iOS.

---

## Git Workflow Notes

- Local branch refs go stale — run `git fetch origin` (or `git pull`) before branching to ensure
  local `master` reflects the current GitHub state.
- Feature branches are pushed to GitHub, deployed via Amplify branch preview, then PR'd to master.
- When a feature branch is built on top of another unmerged feature branch, note the dependency
  so PRs are merged in the right order.
- If a stray local commit ends up on a feature branch, use `git rebase --onto origin/master <stray-commit-hash> <branch>`
  to drop it cleanly before force-pushing.

---

## Key Architectural Decisions

- **Auth**: Cognito User Pools with custom attribute `custom:facility_ids` (comma-separated ObjectIDs).
  Lambda functions read this from JWT claims (`event.requestContext.authorizer.claims`).
- **Cognito groups**: `SuperAdmin` and `Admin`. SuperAdmin was the original privileged group.
  `Admin` was added in updates-2.0 to allow a second tier of privileged users. Both groups can
  access User Management and manage the `Admin` group membership of other users. Only SuperAdmin
  is set up via the `AwsCustomResource` auto-add in `backend.ts`; Admin users must be granted
  manually (via the UI or Cognito console).
- **ArcGIS editing**: All facility status changes go through `applyEdits` on the feature layer
  using OAuth2 `client_credentials` token. Fields `Warming_Active` and `Cooling_Active` are
  string `'Yes'` / `'No'` (not boolean).
- **Translations**: App UI strings are in `src/i18n/{en,es,vi,ar}.json`. Dynamic field values
  from ArcGIS (facility name, address, hours, etc.) pass through `useTranslateContent` hook —
  currently a pass-through stub; designed for AWS Translate Lambda in a future phase.
- **Mobile detection**: `window.matchMedia('(hover: none) and (pointer: coarse)')` for
  distinguishing mobile (device GPS directions) vs desktop (origin-point directions).

---

## Planned / Future Work

- Phase 5: Replace `useTranslateContent` pass-through stub with AWS Translate Lambda call.
  Hook signature and call sites already in place — only the Lambda and hook internals change.
- CORS: Replace `Cors.ALL_ORIGINS` with production Amplify domain.
- Mutual exclusivity (future): Remove the dual Warming/Cooling toggle entirely; sites will be
  warming-only or cooling-only. The conflict-warning logic already anticipates this.
