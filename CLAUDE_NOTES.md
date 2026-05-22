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

5. **`defineAuth({ triggers: { <fn> } })` with the trigger Lambda in its own stack** — wiring a
   function as a Cognito auth trigger makes the auth stack import the function ARN, AND Amplify
   auto-generates a `CfnPermission` inside the function's stack with `sourceArn = userPoolArn`
   (cycle-closing import that is unreachable from `backend.ts`). Pattern 2 is not enough here —
   even with a clean IAM policy the auto-generated permission keeps the cycle. Fix: set
   `resourceGroupName: 'auth'` on the trigger function's `defineFunction` so it lives in the
   auth nested stack — LambdaConfig + CfnPermission both intra-stack, no cross-stack import.

---

## Lambda Functions

| Function | Route | Purpose |
|---|---|---|
| `updateStatus` | POST /facilities/status | Toggle Warming_Active / Cooling_Active on ArcGIS feature; sends SES email on activation |
| `getUsersAndFacilities` | GET /admin/users | List Cognito users (with groups) + ArcGIS facilities (SuperAdmin **or Admin**) |
| `updateUserFacilities` | PATCH /admin/users/facilities | Add/remove facility assignment for a user |
| `getKeepOpen` | GET /facilities/keep-open | Return which of caller's facilities have a midnight-reset override active |
| `updateKeepOpen` | PATCH /facilities/keep-open | Set or clear a keep-open override in DynamoDB |
| `autoResetFacilities` | EventBridge cron | Nightly midnight CT reset — deactivates all facilities except those with a keep-open override; also sends Keep Open reminder emails on schedule (day 3, 7, 21, 35, …) |
| `autoCloseByHours` | EventBridge cron */5 min | End-of-day reset: closes each active facility once its per-day closing time (from structured Hours) has passed in America/Chicago. Skips facilities whose today is Closed-per-Hours, whose Hours don't parse, whose schedule crosses midnight, or that have a keep-open override |
| `addFacility` | POST /facility/add | Add new ArcGIS feature, append ObjectID to caller's `custom:facility_ids`, seed creator email in DynamoDB |
| `updateFacilityAttributes` | POST /facility/update-attributes | Full attribute update for an existing facility (ownership check via `custom:facility_ids`) |
| `getFacilityNotifications` | GET /facilities/notifications | Return `notificationEmails` string from DynamoDB for caller's facilities |
| `setFacilityNotifications` | PATCH /facilities/notifications | Write `notificationEmails` to DynamoDB (comma-separated addresses) |
| `deleteFacility` | POST /facility/delete | ArcGIS `applyEdits` delete, remove ObjectID from caller's Cognito attribute, delete DynamoDB item |
| `manageUserRole` | POST /admin/users/role | Grant or remove the `Admin` Cognito group for a target user; blocks removing Admin from `cjcarsley@douglascounty-ne.gov`; only `Admin` group manageable (not `SuperAdmin`) |

**SES config** (in `updateStatus/handler.ts`): sender `do-not-reply@dcgis.org`, region `us-east-1`.
Recipients are hardcoded in the handler — update there if the notification list changes.

**EventBridge schedules**:
- `cron(0 6 * * ? *)` (nightly reset + reminder fan-out) = 06:00 UTC = midnight CST (~1 AM CDT; DST drift accepted)
- `cron(*/5 * * * ? *)` (end-of-day auto-close) = every 5 minutes

**Keep Open reminder schedule**: day 3 → day 7 → day 21 → day 35 → day 49 … (3, then +4, then +14 indefinitely). Counter resets when Keep Open is disabled.

**DynamoDB table** `FacilityOverrides`: PK `facilityId` (String). Schema coexists `keepOpen` (Boolean), `keepOpenSince` (Number, epoch ms — when Keep Open was enabled), `reminderCount` (Number — count of reminders sent this Keep Open session), and `notificationEmails` (String, comma-separated) in the same item. Uses `UpdateExpression SET/REMOVE` — not PutItem — so fields coexist without overwriting each other. `keepOpen`/`keepOpenSince`/`reminderCount` are written/cleared as a group by `updateKeepOpen`; `keepOpenSince` uses `if_not_exists` so a redundant enable-toggle doesn't reset the reminder clock.
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

### hotfix: autoResetFacilities Scan refactor — pushed directly to master (2026-05-14)

**Problem**: Despite keepOpen overrides being set in DynamoDB, all facilities reset at midnight.
Root cause was not a code bug in the Lambda (which always correctly checked `keepOpen`), but a
data-state issue: the `getKeepOpen` false-positive display bug (Fix 3 above) had masked the fact
that DynamoDB had no `keepOpen: true` entries. Disconnecting feature branches (to remove duplicate
EventBridge rules) did not help — stale rules from other branches cannot invoke the master branch's
Lambda (different function ARN).

**Fix** (`amplify/functions/autoResetFacilities/handler.ts`, `amplify/backend.ts`):
- Replaced N individual `GetItem` calls with a single `ScanCommand` filtered on `keepOpen = true`,
  building a `Set<string>` for O(1) lookup
- Added CloudWatch log line: `keepOpen overrides active: [12345, 67890]` (or `[none]`) so the
  midnight-reset decision is auditable without querying DynamoDB directly
- Fail-safe tightened: if the Scan itself throws, Lambda aborts rather than resetting facilities
  whose keepOpen status is unknown
- IAM permission updated from `dynamodb:GetItem` → `dynamodb:Scan` for `autoResetFn`

**If reset still fires** (historical guidance, kept for the diagnostic flow): Check CloudWatch
for `keepOpen overrides active: [none]` — that would mean PATCH calls from AdminPanel are not
reaching DynamoDB; investigate `updateKeepOpen` Lambda next.

### root cause: external ArcGIS Notebook (discovered 2026-05-18)

Even after the Scan refactor + log line, Keep Open overrides were still ignored. The CloudWatch
log query showed master's autoResetFacilities Lambda fired at 06:00 UTC and reported
`No active facilities to reset` — meaning Warming/Cooling were ALREADY 'No' in ArcGIS before
the cron ran. Plus Keep Open was still checked in the UI (so updateStatus didn't clear it).

A pre-existing ArcGIS Online Notebook (set up by cjcarsley long before this codebase existed)
runs its own scheduled nightly reset against the Warming_and_Cooling_Centers feature layer.
It writes directly via applyEdits and does NOT consult the FacilityOverrides table, so it has
no notion of Keep Open. Its schedule fires before Amplify's cron, so by the time the Lambda
runs every feature is already 'No'.

**Fix**: Notebook schedule disabled in ArcGIS Online (2026-05-18). Amplify's
`autoResetFacilities` is now the sole nightly reset path. No code change required.

**Audit lesson**: When a "ghost" mutation appears on the feature layer with no matching Lambda
CloudWatch entry, look at ArcGIS-side automation surfaces (Notebooks, Webhooks, GeoEvent)
before chasing a code bug. The diagnostic that nailed it: `EditDate` + `Editor` fields on the
feature layer (`outFields=EditDate,Editor`) show exactly when and by what identity each row
was last changed.

### feature/edit-assignments-fix — merged (PRs #23 and #24 — 2026-05-18)

**Fix 1 — Facility assignments list empty in User Management modal:**
- After `feature/proxy` made the feature layer private, `getUsersAndFacilities` was still
  querying ArcGIS without a token, so `data.facilities` came back empty. Modal showed only
  the search box; the underlying list it filters was empty.
- Fix (`amplify/functions/getUsersAndFacilities/`): import `getArcGISToken` from
  `../shared/arcgisToken`, add `ARCGIS_CLIENT_ID` / `ARCGIS_CLIENT_SECRET` secrets to
  `resource.ts` env, include `token` in the `/query` params.

**Delete user (cjcarsley only):**
- New Lambda `deleteUser` (POST `/admin/users/delete`). Caller email must equal
  `cjcarsley@douglascounty-ne.gov` (claims-based, server-enforced).
- Pre-checks via `AdminGetUser` + `AdminListGroupsForUser`: blocks self-delete (target email
  matching PROTECTED_EMAIL) and any SuperAdmin target. Calls `AdminDeleteUserCommand`.
- IAM: `cognito-idp:AdminDeleteUser`, `AdminGetUser`, `AdminListGroupsForUser` on userPoolArn.
- UI (`UserManagementPanel.tsx`): red Delete button per row, **only rendered when
  `userEmail === PROTECTED_EMAIL`** and target is neither cjcarsley nor SuperAdmin. Confirms
  via native `<dialog>` modal before firing.

**Request Access flow — gate Add New behind admin approval:**
- New Cognito groups: `Approved`, `PendingApproval` (added to `defineAuth.groups`).
- New `postConfirmation` Lambda wired via `defineAuth.triggers.postConfirmation` — auto-adds
  newly-confirmed users to `PendingApproval` unless they're already in
  SuperAdmin/Admin/Approved (idempotency guard via `AdminListGroupsForUser`).
- New Lambda `requestAccess` (POST `/admin/request-access`, Cognito-authorized):
  queries `ListUsersInGroup` for both `Admin` and `SuperAdmin`, sends one SES email with
  combined recipient list (excluding the requester). Env: `SES_FROM_EMAIL=do-not-reply@dcgis.org`,
  `SES_REGION=us-east-1`, `APP_URL` (deep link to `/admin/users` in the body).
- `manageUserRole/handler.ts`: `MANAGEABLE_GROUPS = ['Admin', 'Approved', 'PendingApproval']`
  (was Admin-only). Approve action calls it twice: add `Approved`, then remove `PendingApproval`.
- `getUsersAndFacilities`: now returns all 4 group memberships per user. Wrapped each
  `ListUsersInGroup` call in `listGroupSafe` so a missing group returns empty rather than
  failing the whole request — necessary because old environments may not yet have the new
  groups when this Lambda first runs.
- Client (`useAuthGroups.ts`): adds `isApproved`, `isPending` to the return value.
- AdminPanel: `canAddFacility = isSuperAdmin || isAdmin || isApproved`. If false and
  `isPending`, renders Request Access button instead of Add New. After click, the button
  shows "Request Sent" and stays disabled — `sessionStorage` key `wcc.requestAccessSent`
  persists across remounts within the tab.
- UserManagementPanel: amber `pendingBadge` next to email for PendingApproval users; green
  Approve button (visible only when target is in PendingApproval) that performs the two-step
  group swap.

**Why PendingApproval as a Cognito group (not a DynamoDB request table):**
- Single source of truth lives in Cognito. `getUsersAndFacilities` already enumerates groups
  per user, so the User Management UI sees pending users automatically with no extra fetch.
- No DynamoDB table to maintain. Approval is a Cognito-only operation.
- Tradeoff accepted: no audit trail of who requested vs. who was approved when. Acceptable
  for this scale (<100 users).

**Notes on deploy / pre-existing users:**
- Existing users who never sign up again (already CONFIRMED) won't run through the new
  `postConfirmation` trigger — they keep their current group state. If they were group-less
  before, they remain group-less after deploy → AdminPanel will show neither Add New nor
  Request Access (both conditions are false). Manually add them to `Approved` (for active
  facility admins) via Cognito console after the deploy if needed.
- cjcarsley is in SuperAdmin → unaffected.

**Deployment fix (2026-05-18, commits f513064 + 651d7e5):**
- First deploy attempt failed with `CloudformationStackCircularDependencyError` between
  `auth`, `FacilityStatusApiStack`, and the postConfirmation function stack.
- Root cause: `defineAuth.triggers.postConfirmation` makes the auth stack import the function
  ARN. Amplify ALSO auto-generates a `CfnPermission` inside the function's stack with
  `sourceArn = userPoolArn` so Cognito can invoke it — that import alone closes the cycle and
  is invisible from `backend.ts`.
- f513064 (didn't resolve it): rewrote our own IAM policy on postConfirmation to use
  `Stack.of(fn).formatArn({ resource: 'userpool', resourceName: '*' })` instead of
  `userPoolArn`. Treated this like circular-dep pattern 2 — but pattern 2 only covers cycles
  we create ourselves; here Amplify's auto-generated CfnPermission was the real edge.
- 651d7e5 (working fix): set `resourceGroupName: 'auth'` on postConfirmation's `defineFunction`.
  Places the Lambda IN the auth nested stack so both the LambdaConfig and the auto-generated
  CfnPermission are intra-stack. The wildcard IAM from f513064 is kept; it's harmless and
  matches the rest of the codebase's pattern-2 style.
- New rule: any `defineAuth.triggers.*` function MUST also set `resourceGroupName: 'auth'`.

### feature/mobile-user-page-update — merged (PR #25 — 2026-05-18)

Mobile redesign of the User Management table. On iPhone the original table required
horizontal scrolling to reach the action buttons, then scrolling back to see emails.

**Approach** (CSS-only — markup, TS, and a11y semantics unchanged):
- At `@media (max-width: 767px)` flip `<table>/<tr>/<td>` to `display: block`; visually
  hide `<thead>` (clip 1×1, kept in the a11y tree)
- Each row becomes a card: border, `border-radius: 8px`, padding, light shadow,
  bottom margin between cards
- Email cell → prominent heading (1rem, 600 weight, word-break)
- Status badge + facility count → side-by-side inline-flex on one secondary line
- Action buttons → dedicated bottom region. `Edit Assignments` takes `flex: 1 1 100%`
  (full row); secondary actions take `flex: 1 1 calc(50% - 0.25rem)` so two per row,
  but a lone secondary stretches to fill via `flex-grow: 1`
- All buttons retain ≥40–44px tap targets
- Tableless re-flow eliminates the horizontal scrollbar entirely

**Key file**: `src/components/AdminPanel/UserManagementPanel.module.css` (single
media query block at the bottom of the file)

### feature/list-mobile — merged (PR #26 — 2026-05-18)

Same card-pattern redesign for the public Active Facilities List (`/list`). Six
columns (Name, Address, Type, Hours, Phone, ADA) had been overflowing at iPhone width.

**Approach**:
- Identical `@media (max-width: 767px)` flip-to-cards pattern as PR #25
- Name → prominent heading; Type pill on its own line below the name; address /
  hours / phone / ADA stacked
- Two values (Hours, ADA) are bare strings — meaningless without their column header
  on mobile. Added a `<span className={styles.mobileLabel} aria-hidden="true">…:</span>`
  prefix inside those two `<td>`s. The span is `display: none` on desktop and
  `display: inline` at ≤767px. `aria-hidden` because the table column headers still
  appear in the a11y tree (clipped, not removed)
- The Maps link on Address and the `tel:` link on Phone continue to function unchanged

**Key files**: `src/pages/FacilityListPage.tsx` (added two `mobileLabel` spans),
`src/pages/FacilityListPage.module.css` (one media query block + the `.mobileLabel`
default rule)

**Mobile-card pattern (reusable)**: For any future tabular admin/list view where
horizontal scroll on mobile is undesired, copy the media-query block from one of these
files. The pattern is robust to column count: just stack the cells and add
`.mobileLabel` prefixes to any cell whose value is meaningless without its column
header. Avoid icon prefixes (no project convention for them yet).

### feature/accessibility-trans — merged (PR #27 — 2026-05-21)

The `/accessibility` page was previously English-only — switching the
header language switcher left every section in English. Now follows
the active language.

**Approach**:
- Added a top-level `accessibility.*` namespace to all four locale
  JSONs (en/es/vi/ar) covering: heading dates, Commitment, Features
  list (label + text per item), Interactive Map, Feedback & Contact,
  ADA Information
- Refactored `src/pages/AccessibilityStatement.tsx` to use `t()` for
  plain strings and `<Trans>` for the three sentences with inline
  links (WCAG external link, `/list` internal Link, DOJ external link)
- The `<Trans>` placeholders use named components (`wcag`, `list`,
  `doj`) — the JSX wrapper at the call site supplies the actual `<a>`
  / `<Link>` element

**Key files**: `src/pages/AccessibilityStatement.tsx`,
`src/i18n/{en,es,vi,ar}.json`

### feature/hours — merged (PR #28 — 2026-05-21)

User request: more structured way to edit a facility's `Hours` than
a freeform text input. ArcGIS field stays a single string column —
the editor produces a canonical string the existing column can hold.

**Approach** (per-day grid; option B from the design discussion):
- New `src/components/admin/HoursEditor.tsx` renders a 7-row grid
  (Mon→Sun) with two `<input type="time">` per row + a `Closed`
  checkbox. Mobile (≤600px) stacks the time pair below the day label
- Output format (canonical, collapsed): `Mon–Fri: 9:00 AM–5:00 PM; Sat–Sun: Closed`.
  Consecutive days with identical schedules collapse to a range.
  `00:00`–`23:59` displays as `Open 24 hours`
- Parser (`src/utils/hours.ts`) round-trips the canonical form and
  tolerates en-dash / em-dash / ASCII-hyphen and `24/7` aliases
- Wired into both `FieldInput` (Add modal) and `InlineFieldInput`
  (Edit form on AdminPanel) by branching on `field.name === 'Hours'`

**Data-safety behavior**: existing facilities have freeform Hours
strings that won't always parse. When parse fails the grid starts
all-closed but the underlying form value is **not** overwritten
until the user actually touches a day — opening Edit and saving
without touching Hours preserves the original string. A warning
banner above the grid shows the raw value in that case.

**i18n**: added `admin.hours.*` block (`legend`, `closed`,
`openTime`/`closeTime` aria labels, `parseWarning`, full day names)
to en/es/vi/ar.

**Key files**: `src/utils/hours.ts`, `src/components/admin/HoursEditor.tsx`,
`src/components/admin/HoursEditor.module.css`,
`src/pages/admin/AddFacilityModal.tsx` (FieldInput branch),
`src/pages/admin/AdminPanel.tsx` (InlineFieldInput branch),
`src/i18n/{en,es,vi,ar}.json`

### feature/wcag-update-2.0 — merged (PRs #31 and #32 — 2026-05-22)

WCAG 2.1 AA second pass focused on heading hierarchy, form labels,
and focus management.

**Heading hierarchy**:
- Site title in Header `<span>` → `<h1>` (single page heading across SPA)
- FacilityListPage "Active Facilities" `h1` → `h2`
- AccessibilityStatement `h1` → `h2`; child `h2`s → `h3` to preserve order

**Form labels** (axe "Missing form label"):
- ArcGIS Search `input.esri-search__input` — set `aria-label` via
  `search.when()` + a `viewModel.state` watcher
- Calcite autocomplete `<input slot="hidden-form-input">` mounts
  lazily when suggestions open. MutationObserver over `search.container`
  catches the dynamic insert and labels it. PR #32 was the follow-up —
  the initial `when()`/watch pass missed it because calcite hadn't
  mounted the hidden input yet.

**Focus management**:
- FacilityPopup: focus the dialog `h2` (with `tabindex=-1`) on open
  so AT announces the facility name first instead of the close button
- Route changes: `<main>` receives focus on `location.pathname` change
  (skip first mount) — `src/App.tsx`

**Other AA polish**:
- Map div: `role="application"` → `role="region"` (frees AT virtual cursor)
- Map page: added sr-only `<h2>` page heading
- MobileLegendOverlay: toggle button wrapped in `<h2>` for heading nav
- LanguageSwitcher: `aria-label` on select; visible native-name label
  marked `aria-hidden="true"` (decorative)
- FacilityListPage table: `<caption className=srOnly>` replaces aria-label
- SkipLink: added `:focus` alongside `:focus-visible` for broader AT
- Touch targets (WCAG 2.5.8): `min-height: 24px` on nav links + lang select

**i18n**: added `map.searchAria` and `map.pageHeading` keys in
en/es/ar/vi (`src/i18n/{en,es,ar,vi}.map.json`).

### feature/auto-close-and-reminder — merged (PR #30 — 2026-05-21)

Two new automated behaviours on top of the existing nightly reset:

**1. End-of-day auto-close** — new Lambda `autoCloseByHours`,
EventBridge cron `*/5 * * * ? *`. Queries active facilities + their
Hours, parses the structured Hours string (shared parser at
`amplify/functions/shared/hours.ts` — duplicate of `src/utils/hours.ts`
to avoid cross-tree imports), and resets Warming/Cooling_Active to
'No' once the current America/Chicago time has passed today's
closing time.

Skip rules (all defer to the nightly reset, preserving the
"emergency manual activation" case):
- Hours doesn't parse
- Today's `closed: true`
- Schedule crosses midnight (`open >= close`)
- Keep Open override active

Timezone: handler computes current day-of-week + HH:MM in
`America/Chicago` via `Intl.DateTimeFormat`. Lambda's own clock is
UTC; the Intl conversion is the only timezone surface.

**2. 3-day Keep Open reminder emails** — extended
`autoResetFacilities` handler (piggybacks on the existing nightly
cron so the reminder logic runs once per day, not every 5 min).
SES email to that facility's `notificationEmails` list. Cadence:
day 3, day 7, then every 14 days indefinitely (day 21, 35, 49, …).
`reminderCount` is reset when Keep Open is disabled.

DynamoDB additions on `FacilityOverrides`:
- `keepOpenSince` (Number, epoch ms) — set in `updateKeepOpen` via
  `if_not_exists` so a redundant on-toggle doesn't reset the clock
- `reminderCount` (Number) — incremented after each reminder send;
  REMOVEd along with `keepOpen` on disable

**Legacy keep-open items**: `processReminders` in
`autoResetFacilities/handler.ts` backfills `keepOpenSince=now` /
`reminderCount=0` on first sight of any item lacking those fields
(via `ConditionExpression: 'attribute_not_exists(keepOpenSince)'`).
Their reminder clock starts at backfill time, not retroactively —
no spurious day-N reminders for items enabled before the deploy.

**IAM/wiring changes** (`amplify/backend.ts`):
- `autoResetFn`: added `dynamodb:UpdateItem` (increment
  `reminderCount`) and `ses:SendEmail`
- `autoCloseFn`: added `dynamodb:Scan`
- New `CfnPermission` + plain `IRuleTarget` for the 5-min EventBridge
  rule (same cross-stack-cycle workaround as `NightlyResetRule` —
  see CDK Circular Dependency Rules pattern 3)

**Key files**: `amplify/functions/autoCloseByHours/{handler,resource}.ts`,
`amplify/functions/shared/hours.ts`,
`amplify/functions/autoResetFacilities/handler.ts` (added
`processReminders` block + SES env wiring),
`amplify/functions/autoResetFacilities/resource.ts` (added
`SES_FROM_EMAIL`/`SES_REGION`/`APP_URL`),
`amplify/functions/updateKeepOpen/handler.ts` (set/clear
`keepOpenSince` + `reminderCount`),
`amplify/backend.ts`

### feature/admin-assign-fix — merged (PR #29 — 2026-05-21)

`updateUserFacilities/handler.ts:44` still required SuperAdmin. When
the Admin tier was introduced in feature/updates-2.0, sibling Lambdas
(`getUsersAndFacilities`, `manageUserRole`) were updated to accept
either group but this one was missed. Admin users could open the Edit
Assignments modal — the PATCH 403'd and the client surfaced the
generic "Failed to update assignment" toast.

Fix: `!groups.includes('SuperAdmin') && !groups.includes('Admin')`.

**Audit takeaway**: When adding a new privileged group, grep every
`groups.includes(` in `amplify/functions/**` — the existing list is
the canonical authority list for that group's reach.

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
