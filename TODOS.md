# TODOS

## P2: Computed metrics (`powerlifting_total = bench_1rm + squat_1rm + deadlift_1rm`)
**What:** A new flavor of metric_type whose value is derived from a formula over other metric_types' values, instead of stored readings. e.g. `powerlifting_total` = sum of latest `bench_1rm` + `squat_1rm` + `deadlift_1rm` per day.
**Why:** Lets the user track derived measures (powerlifting total, IPF GL points, weekly running mileage, weekly mat time) without writing them by hand.
**Design decisions before building:**
- Schema: add `formula TEXT` to `metric_types` (NULL for primitives), `kind TEXT CHECK (kind IN ('primitive','computed'))` or rely on `formula IS NOT NULL`. Lean toward the latter (one fewer column).
- Formula language: simple expression DSL over `metric_name` references (e.g. `bench_1rm + squat_1rm + deadlift_1rm`)? Or AST stored as JSON? DSL is more user-friendly, JSON is easier to evaluate. Recommend tiny DSL with whitelisted operators (+/-/*/) and metric refs only.
- Storage: persist computed values into `metrics` rows on each input source's commit, OR compute on-read from latest source values? Eager-write is consistent with how the rest of the app behaves but creates write-amplification (every bench_1rm reading triggers a powerlifting_total write).
- Aggregation window: "latest per day"? "max so far"? Probably needs a per-formula `aggregation` field.
- Goal targeting: can a goal point at a computed metric? Yes — required-rate logic still works.
- Editing: prevent direct insert into `metrics` for computed types.
**Effort:** M (human: ~1 week / CC: ~1-2h). Touches schema, ingest path, goal calc, metric detail page.
**Depends on:** Goals-as-Omnibus shipped (so the compute path doesn't fight the LLM context assembly which already pre-aggregates raw metrics).
**Source:** Surfaced 2026-04-28 alongside primitive-metric UI.

## P2: Categorical / ordinal metrics (`bjj_belt`, mood, RPE band)
**What:** Metric types whose readings aren't continuous numbers. Three sub-shapes:
1. Ordinal scales with a fixed mapping: `bjj_belt` → white(0) / blue(1) / purple(2) / brown(3) / black(4). Charts as a step function over time.
2. Categorical with no ordering: `mood` → great/good/ok/poor/awful. Charts as a stacked bar / heatmap.
3. Bounded numeric ranges (RPE 1-10): already representable today, just needs a UI hint.
**Why:** BJJ belt progression, training session quality, subjective measures. Currently impossible to capture without overloading a numeric column with documented mapping (which loses display labels in dashboards).
**Design decisions before building:**
- Schema: add `kind TEXT CHECK (kind IN ('numeric','ordinal','categorical'))` and `categories JSON` (NULL for numeric). For ordinal, categories array's index is its numeric value.
- Storage: keep `metrics.value REAL` for ordinal (store the integer as a real). For categorical, store the index too — but that loses the label round-trip. Probably need a `string_value TEXT` column on metrics.
- Display: charts need to map index back to label. Tooltip shows label, axis ticks show labels.
- Input UI: dropdown not number input on the entry form, gated on `metric_type.kind`.
**Effort:** M (human: ~3-4 days / CC: ~1h). Touches schema, entry form, charts, possibly the resolver.
**Depends on:** Decision on string_value column for true categorical (vs ordinal-only which fits today's schema).
**Source:** Surfaced 2026-04-28 alongside primitive-metric UI.

## P3 (maybe): Big 3 — local-time day grouping
**What:** `src/lib/strength-metrics.ts` uses `r.startedAt.slice(0, 10)` to key sessions by day, which is the UTC date. A 9pm PT workout has an ISO startedAt of the next UTC day, so it plots one day forward in the history chart and in the session-break logic.
**Why:** Cosmetic today (server runs in local TZ anyway for most Delta flows), but if we ever host outside Gary's TZ or care about UTC-boundary edge cases, the chart dates will read wrong.
**Fix sketch:** Build a `localDayKey(iso)` helper using a real `Date` object and use it both for the `byDay` map key and the session-break comparison.
**Effort:** XS (~10 min).
**When:** Only if UTC-boundary workouts start showing up in the wrong bucket visibly.

## P3 (maybe): Big 3 — expose lift-variant exclusions
**What:** `LIFT_PATTERNS` in `src/lib/strength-metrics.ts` silently excludes sumo deadlift, trap-bar deadlift, front squat, goblet squat, incline/decline/close-grip/dumbbell bench, etc. A user doing these won't see them in Big 3 with no UI explanation.
**Why:** Current behavior is defensible (Big 3 = competition-standard movements), but silent. If Gary ever programs sumo or trap-bar, those sessions will be invisible to the powerlifting page.
**Fix sketch:** Either (a) document the included variants on the `/powerlifting` page, or (b) expose the inclusion list as a user setting.
**Effort:** XS for (a), S for (b).
**When:** If Gary starts programming excluded variants regularly.

## P2: Focus Retrospective / Cross-Focus Comparison
**What:** When opening a new focus, include prior completed focuses with similar sport + metric links as context for the coach. When closing a focus, generate a comparison to prior focuses on the same topic.
**Why:** Enables compounding: each focus teaches the coach about the user's patterns. "Your last bench campaign: 8 weeks, +20lb, 85% protein compliance. This time: 6 weeks, +25lb, 90% compliance."
**When:** Build after 2+ completed focuses exist. The feature has no value with 0-1 completed focuses.
**Effort:** S (human: ~3h / CC: ~20 min)
**Depends on:** Focus lifecycle working, coach context assembly.
**Note (2026-04-28):** Now in scope for the Goals-as-Omnibus plan as cherry-pick #3 (close-time verdict that references prior closed focuses on the same goal). This entry can be removed once that plan ships.

## P2: Focus Priority Ordering
**What:** Add `focuses.priority INTEGER NOT NULL DEFAULT 0` (lower = higher priority). Default ordering becomes `priority ASC, start_date DESC`. UI: drag-to-reorder via @dnd-kit/core, or up/down arrows, or inline number input.
**Why:** Goals-as-Omnibus v1 ships ordered by `start_date DESC`. Works for BJJ (recent = what coach said) but breaks for powerlifting (a 6-week training block has 3 focuses that don't have a natural recency order). Sport-page mobile digest caps at 3 — without priority, the wrong 3 may surface.
**When:** When you notice the wrong focus is showing up at the top of the BJJ digest, or you set a 3-focus powerlifting block and want to mark which one is the lift's primary emphasis.
**Effort:** S (human: ~4-5h / CC: ~30 min) for drag, S (human: ~2-3h / CC: ~10 min) for arrows or number input.
**Depends on:** Goals-as-Omnibus shipped. Priority field touches focuses tray (goal page) + digest (sport page) + the LLM suggest-focuses prompt (should NOT generate a priority — promote-to-manual gets priority NULL until user assigns).
**Source:** Surfaced during /plan-design-review on 2026-04-28.

## P3: BJJ Belt Progress Tracker
**What:** Dedicated BJJ view with total mat hours by category (class/open_mat/drilling/teaching), monthly training volume trend, focus history timeline, and time-at-current-belt tracking.
**Why:** BJJ belts take years. A long-term progression view provides the same motivation as powerlifting PR curves but on a multi-year timescale.
**When:** Build when BJJ-specific visualization needs become clear through daily use.
**Effort:** S (human: ~3h / CC: ~20 min)
**Depends on:** Events table populated with BJJ data, Sport Detail view working.

## P3: Alert-Driven Drift Notifications
**What:** Proactive notifications when metrics drift beyond thresholds. "Your sleep dropped 20% this week, expect your lifts to suffer Thursday." Requires: threshold definitions per metric, notification storage, suppression logic (don't alert every day for same issue), and a delivery mechanism (in-app banner or push).
**Why:** The coach currently only speaks when asked (chat) or on schedule (briefing/review). Alert-driven mode catches issues in real-time.
**When:** Post-month-1. Requires understanding which thresholds matter through actual usage first.
**Effort:** M (human: ~1 week / CC: ~45 min)
**Depends on:** Pre-aggregation layer, coach engine, sufficient data history to define meaningful thresholds.

## P3: Multi-User Support
**What:** Pivot from single-user self-hosted to multi-user. Each user has:
- Their own account (login, session, password reset)
- Their own ingest API key (scoped to their user_id)
- Row-level scoping on every query (metrics, events, focuses, goals, coach_messages all get a user_id column)
- Their own coach context (only sees their own data)

Requires schema migration (add user_id FK everywhere), auth middleware on every route, session management (NextAuth or lucia-auth), user signup/login UI, and rewrites of every query to filter by current user.
**Why:** Currently Delta is single-user, built for Gary. If this proves useful and others want to try it without standing up their own EC2 instance, multi-user is the path. Also simplifies hosting — one Delta instance can serve friends/family instead of each person needing their own deployment.
**When:** Only if you decide Delta is worth turning into a product or shareable service. Explicitly rejected for v1 in the office-hours design doc ("Side project, self-hosted, user #1").
**Effort:** L (human: ~2-3 weeks / CC: ~3-4 hours). Touches every table, every query, every route.
**Depends on:** Product decision to open up beyond self-use. Also depends on having a stable single-user version first so the migration has something worth migrating.
**Notes:**
- Auth choice: NextAuth (v5 beta) for OAuth providers, or lucia-auth for more control.
- Key management: generate ingest keys as `bytes(32).hex()` per user, stored hashed in DB. Rotatable from settings UI.
- Data isolation strategy: add `user_id` FK to all tables (metrics, events, workout_sets, focuses, focus_entries, focus_metric_links, goals, coach_messages, ingest_configs, daily_summaries). Drizzle middleware enforces on every query.
- Migration path for Gary's data: all existing rows get user_id=1 (Gary). New users start with empty tables.

## P3: Convert remaining hard-coded `[Npx]` Tailwind values to relative units
**What:** Several existing components still use literal pixel values for small visual elements:
- `src/components/sidebar.tsx`, `src/components/goal-bar.tsx`, `src/components/focus-card.tsx`, `src/components/big-three.tsx`, `src/app/goals/page.tsx`, `src/app/input/goal/page.tsx`, `src/app/sports/[sport]/page.tsx`: `w-[6px] h-[6px] rounded-full` for sport-color dots, plus `mr-[6px]` in sidebar.
- `src/components/goal-bar.tsx`, `src/app/goals/page.tsx`: `h-[3px] bg-surface rounded-[1.5px]` for progress-bar fills.
- `src/app/data-sources/bodyspec/upload-client.tsx`: `h-[4px]` for upload progress bar.
**Why:** Configurable Dashboards (PR1) committed to "no pixels for layout, typography, or widget heights — pixels only for things that have to be pixels (1px borders, hairlines, focus rings)." These ~3-6px elements predate the rule and don't scale with text zoom — at 200% accessibility zoom the dots stay 6px while text grows.
**Fix sketch:** `[6px]` → `1.5` (Tailwind class = 0.375rem, scales with rem). `[3px]` → `0.5` rounded down or `border-[length:0.1875rem]`. `[1.5px]` border-radius → `rounded-sm`. Test at 100% / 150% / 200% browser zoom.
**Effort:** S (human: ~1h / CC: ~10min). Pure search-and-replace; rem-at-default-base equals current pixel values, so visual regression risk is minimal at 100% zoom.
**When:** Bundle with the next pass that touches these components, OR before multi-user ships (when accessibility scrutiny actually matters).
**Source:** Surfaced 2026-05-01 during /plan-design-review on configurable-dashboards plan; new dashboard code is pixel-clean but existing components were left alone.

## P3: Custom not-found.tsx so unknown routes return HTTP 404
**What:** Add `src/app/not-found.tsx` (or per-segment files) so calls to `notFound()` from server components actually surface as HTTP 404 status, not 200. Today `/dashboards/does-not-exist` renders Next's built-in 404 UI but returns HTTP 200.
**Why:** App Router's `notFound()` only sets the response status to 404 when there's a matching `not-found.tsx` in the route tree; without one, the runtime renders the default UI but returns 200. Cosmetic for a single-user installation, but real for monitoring, analytics, and search engines if Delta is ever exposed publicly.
**Fix sketch:** Create `src/app/not-found.tsx` matching Delta's existing visual language (Inter, neutral grays, "Page not found" + link back to `/`). Optionally a more specific `src/app/dashboards/[slug]/not-found.tsx` with a "Browse dashboards" CTA.
**Effort:** XS (~10 min).
**When:** Bundle with PR4 of configurable-dashboards (which deletes `/recovery`, `/body-comp`, `/sports/[sport]` — bookmarked URLs will start 404'ing, so a real 404 page becomes more valuable).
**Source:** Surfaced 2026-05-01 during PR1 of configurable-dashboards. `DashboardRenderer` correctly calls `notFound()` for unknown slugs but the response status is 200.

## P2: Batch `goal_list` widget into a single SQL query
**What:** `src/lib/widgets/goal-list/data.ts` calls `computeGoalProgress(g)` per goal via `Promise.all`, and `computeGoalProgress` itself runs 4 sub-queries on the `metrics` table (latest, earliest-after-creation, earliest-overall, last-4-weeks). With N goals on a dashboard this is `4N + 1` queries every render.
**Why:** Today (~5 goals) it's ~20 queries in <50ms. Acceptable. But the dashboard system was explicitly designed around dedupe + parallelism; this widget undermines both. With multi-user (planned within 6 months) and 10-15 goals per user, you'll hit 40-60 queries per dashboard load.
**Fix sketch:** Rewrite `computeGoalProgress` to accept all goals at once. Use a single CTE / window-function query that returns latest, earliest-after-creation, earliest-overall, and the last-4-weeks samples grouped by `metric_type_id`. Resolve regression slope and progress in JS from the batched results. Reduces N+1 to a fixed 1-2 queries regardless of goal count.
**Effort:** M (human: ~3-4h / CC: ~30min). Touches `src/lib/goal-calc.ts` (the batched compute) and `src/lib/widgets/goal-list/data.ts` (call site). The existing `computeGoalProgress` signature is also called from `src/app/page.tsx`'s old code path and `src/app/sports/[sport]/page.tsx`; both go through `goal_list` widget after PR4, so the per-goal signature can become a thin wrapper.
**When:** Before multi-user lands. Sooner if Gary creates more dashboards with goal_list widgets.
**Source:** Surfaced 2026-05-01 in the PR1 outside-agent review. Reviewer flagged P2 with confidence 10.

## P3: Test WidgetSlot's error fallback rendering paths
**What:** Add tests asserting that `<WidgetSlot>` renders the typed error fallback with the right `gridColumn: span N` styling under each failure mode: unknown `widget_type`, schema-parse failure, `validate()` returning `{ ok: false }`, `validate()` throwing, and (for the new Client boundary) Component render-time throws.
**Why:** PR1 has full-coverage tests for the data-deps layer and widget schemas, but the slot's error path — which is the user-visible failure mode — has no test. A regression that breaks fallback rendering would only surface via manual smoke tests.
**Fix sketch:** Use `@testing-library/react` (already a devDep) + `renderToString` for the server-component path. Mock the registry with a widget that throws on render. Assert the fallback HTML contains "Widget unavailable" / "Widget failed to render" and the wrapper carries the expected grid styles.
**Effort:** S (human: ~2h / CC: ~15min). New test file `src/components/dashboards/WidgetSlot.test.tsx`.
**When:** Bundle with PR2's mutation routes — the test infrastructure for full integration tests will be needed there anyway.
**Source:** Surfaced 2026-05-01 in the PR1 outside-agent review.

## P2: Add CSRF protection (or same-origin check) to mutation routes
**What:** All mutation routes — `/api/dashboards/...` (PR2), `/api/dev/wipe-data` (existing), `/api/import` (existing) — accept POST/PATCH/DELETE without any same-origin or CSRF token check. Auth.js session cookies are `SameSite=Lax` by default, which blocks cross-site POSTs from random origins; but `SameSite=Lax` allows top-level navigations and some other shapes, so a defense-in-depth `Sec-Fetch-Site: same-origin` check is still worth adding.
**Why:** Cosmetic for a single-user installation today; real for multi-user (planned within 6 months) and any time Delta is exposed to a public network. Defense in depth — basic auth + CSRF check is what every prod app does.
**Fix sketch:** Add a tiny `requireSameOrigin(req)` helper that checks `Origin` and/or `Sec-Fetch-Site` headers. Call from every mutation route. Browsers always send `Sec-Fetch-Site: same-origin` for first-party fetches; cross-site requests get `same-site` or `cross-site`. Reject anything that isn't `same-origin` (or `same-site` if the user explicitly opts in for embed scenarios). ~10 lines.
**Effort:** S (human: ~1-2h / CC: ~15min). One helper + one-line addition to ~6 routes (PR2's 5 + the existing wipe-data + import-data routes).
**When:** Before multi-user lands, OR before Delta is exposed publicly at a real domain.
**Source:** Surfaced 2026-05-02 in the PR2 outside-agent review.

## P3: Make `dashboard_widgets` import idempotent under re-import
**What:** The current `importDashboardWidgets` handler in `/api/import` always inserts (no natural unique key on widgets). Re-importing the same export without a wipe duplicates every widget row. The documented round-trip is wipe + import, but a guard against accidental re-imports would be polite.
**Why:** Footgun. User exports → tries to re-import "to be safe" → ends up with double-rendered widgets and a confusing dashboard. Hit live on 2026-05-04: pulled prod CSV into a fresh local DB whose seeded migrations had already populated Recovery's `metrics_grid`; the import added a second copy and the dashboard rendered both.
**Reasoning:** The duplicate happens for two distinct reasons that share the same fix:
1. **Re-import on top of itself.** Same CSV imported twice → 2× rows. Insert-only handler with no upsert key.
2. **Import on top of seeded data.** Seed migrations populate widgets at fresh-DB time; the CSV then imports its own widgets for the same dashboards. Even on a first import, you get duplicates if any seeded dashboard appears in the CSV (Today, Recovery, Body Comp all do).
The handler comment (`src/app/api/import/route.ts:945-948`) already acknowledges this and says "the documented round-trip is wipe + import" — i.e. it's intentional, not a bug. But "wipe first" isn't surfaced in the UI; nothing tells the user that import-without-wipe will dupe.
**Fix sketch:** Two paths, pick one:
- **REPLACE semantics:** before inserting, DELETE all `dashboard_widgets` rows for any `dashboard_slug` mentioned in the CSV. Idempotent under re-import AND on top of seeded data. Best if the eventual "restore from backup" flow ends up doing a full wipe anyway — same shape, just scoped to the dashboards the CSV touches.
- **Unique index + INSERT OR IGNORE:** add UNIQUE on `(dashboard_id, position)` and let the duplicates be silently skipped. Lighter touch but loses any edits from the CSV that don't match the existing row's position.
**Punt rationale (2026-05-04):** Future "restore from backup" / full-DB-replace flow will wipe first by design, which makes this moot. Not worth a one-off fix when the proper restore semantics are coming. Workaround in the meantime: `make distclean && make migrate && import` (clean DB before import).
**Effort:** XS (human: ~30min / CC: ~5min) for either path.
**When:** Before any user other than Gary uses the import flow on a populated DB, OR roll into the restore-from-backup work.
**Source:** Surfaced 2026-05-02 in the PR2 outside-agent review; re-confirmed live 2026-05-04 (Recovery dashboard doubled after prod-CSV import).

## P3: Settings drawer + widget palette can stack
**What:** `DashboardEditor` tracks `paletteOpen` and `settingsForId` as independent state. Nothing prevents both being open at once. Both `<Drawer>`s attach window keydown handlers, so one Escape closes both. Both also set `body.style.overflow = "hidden"` on mount and reset to `""` on unmount — if both are open and one closes, the other's body-scroll lock might be lost.
**Why:** In practice no UI flow opens both simultaneously today. But the architecture allows it; if PR4 adds a "settings → add another widget" link, the bug becomes user-visible.
**Fix sketch:** Either force the editor to close one drawer when the other opens (mutually exclusive state via a `drawer: 'palette' | 'settings' | null` discriminant), or maintain a stack-of-drawers manager that handles Escape + scroll-lock for the topmost only.
**Effort:** XS (~15min CC).
**When:** Before any flow legitimately needs nested drawers.
**Source:** Surfaced 2026-05-03 in the PR3 outside-agent review.

## P3: + Add widget cap doesn't account for in-flight POSTs
**What:** `DashboardEditor.onAddWidget` checks `widgets.length >= MAX_WIDGETS` against the local state. Local state only updates after the server response. A user clicking + Add 31 times rapidly fires 31 POSTs before the first response lands; the first 30 succeed, the 31st gets a server-side 400 if the server enforces the cap.
**Why:** Server-side cap (which we should add to `/api/dashboards/[id]/widgets/route.ts`) will catch it, but the client UX shows the error inline only on the first failure. Multiple toasts pile up.
**Fix sketch:** Disable the Add button while ANY add is in flight, OR track an "in-flight adds" counter and include it in the cap check. Also: enforce the 30-widget cap server-side as belt-and-suspenders.
**Effort:** XS (~15min CC).
**When:** Bundle with multi-user (when accidental rapid-clicks become more common).
**Source:** Surfaced 2026-05-03 in the PR3 outside-agent review.

## P3: Drag handle Tab focus doesn't reveal gear/trash
**What:** `EditableWidget` reveals the drag handle via `focus-visible:opacity-100` on the button itself. Gear + trash buttons are clustered in a separate div using `focus-within:opacity-100`. Tabbing to the drag handle reveals only the drag handle, not the action cluster — keyboard users can drag but can't reach settings/delete via Tab on a single widget without first hovering with mouse.
**Why:** Minor a11y inconsistency. Keyboard users can still reach the buttons by Tab-ing through them globally, just not from "select widget → its actions" mental model.
**Fix sketch:** Wrap the entire EditableWidget cell in a `group/widget` modifier that triggers visibility via `focus-within:opacity-100` on both clusters when ANY descendant is focused.
**Effort:** XS (~10min CC).
**Source:** Surfaced 2026-05-03 in the PR3 outside-agent review.

## P3: Enforce singleton owner via partial unique index
**What:** `users.is_owner BOOLEAN` has no unique constraint. Today the bootstrap script (`scripts/admin-bootstrap-owner.ts`) sets `isOwner: true` on a single row, but with `--force` against a non-bootstrap user (or any direct DB write), you can end up with two rows where `is_owner = true`. Schema and docs both promise singleton; nothing enforces it.
**Why:** Practical impact at this scale is small — both owners would see `/preferences/invites` and could mint codes; `createdByUserId` filtering on DELETE prevents one owner from revoking another's codes; nothing else breaks. Surfaces as "the docs say singleton but two people are admins now," which is a quiet drift bug if `admin-bootstrap-owner.ts` is ever run twice. Closing the loop matters more once the user count grows past Gary's single-instance EC2 friends-only deploy.
**Fix sketch:** Add a migration: `CREATE UNIQUE INDEX users_is_owner_uniq ON users (is_owner) WHERE is_owner = true`. This is a partial unique index that lets `is_owner = false` repeat freely but rejects a second `is_owner = true` insert/update. Drizzle expression: `uniqueIndex("users_is_owner_uniq").on(t.isOwner).where(sql\`is_owner = true\`)`.
**Effort:** XS (~15 min CC). One migration file plus the schema update.
**When:** Bundle with the next user-related migration, or if a multi-owner state is ever observed in prod.
**Source:** Surfaced 2026-05-10 during the multi-user PR2 adversarial security review (HIGH-5 finding). Skipped in the immediate fix-cluster because no observed multi-owner state and the per-route owner checks (`isOwner` boolean on the JWT-derived user) work correctly today.

## P3: Nonce-based CSP for /share/* (replace `'unsafe-inline'` script-src)
**What:** `next.config.ts` currently sets `script-src 'self' 'unsafe-inline'` on `/share/*` because React's RSC streaming emits inline `<script>` tags (`self.__next_f.push([...])` for the payload, `$RS = function(...)` for the suspense-placeholder swap). Without `'unsafe-inline'` the share page hangs in skeletons forever — the swap function never executes and the streamed content (in `<div hidden id="S:N">`) never replaces the `<template id="B:N">` placeholders. We picked the pragmatic path; the proper version is per-request nonce.
**Why:** With `'unsafe-inline'`, an attacker who can land arbitrary HTML on the share page (e.g. via a future widget renderer that uses `dangerouslySetInnerHTML` on an owner-controlled string) can execute `<script>` on a viewer's machine. React's default JSX escaping (`{title}` → text node) prevents this today, but it's discipline-dependent — every new widget renderer is a place where someone could `dangerouslySetInnerHTML` an owner-controlled string and reopen the hole. Nonce-based CSP closes the door regardless: an injected `<script>` carries no nonce, so the browser blocks it even if React ever lets it through. The eng-review's HIGH finding on owner-XSS specifically called out strict CSP as the defense.
**Fix sketch:** Three steps:
1. **Generate nonce in middleware/proxy.** Add `crypto.randomBytes(16).toString('base64')` per request, stash on a `x-csp-nonce` request header. The CSP header on the response uses `script-src 'self' 'nonce-XYZ'`.
2. **Read nonce in server components.** `headers().get('x-csp-nonce')` in the share page or root layout, pass into a context or React `<NonceProvider>`.
3. **Stamp nonce onto every script tag.** This is the painful step — Next emits its own RSC streaming scripts (the `self.__next_f.push` ones), and there's no public API to inject a nonce attribute on those. Options: wait for Next to wire `experimental.cspNonce` (tracked in vercel/next.js), use `next/script` with a nonce prop for app-level scripts plus accept that streaming RSC scripts inherit from the parent page's CSP (which means `'unsafe-inline'` still has to be there for streaming to work), or write a Streaming Response wrapper that post-processes script tags to add the nonce. None are clean.
**Effort:** M (human: ~3-5h once Next.js supports it, more if you DIY the script-tag rewriter; CC: similar). Tracking issue worth checking before starting: https://github.com/vercel/next.js/issues regarding csp nonce + RSC streaming.
**When:** Before share-link audience expands beyond "small group of friends." For Delta's current threat model (~20 invited users who trust each other), `'unsafe-inline'` is acceptable — the practical exploit requires both an XSS hole (a careless `dangerouslySetInnerHTML`) AND a malicious dashboard owner sharing their own dashboard. If sharing ever opens to "send a link to anyone on the internet," nonce-based becomes load-bearing.
**Source:** Surfaced 2026-05-10 during the multi-user PR2 share-link smoke test. `'unsafe-inline'` was added to unblock streaming after the initial strict CSP locked the page in skeleton state forever. Tradeoff documented inline in `next.config.ts`.

## P3: server-registry uses `as any` casts that erase widget P-parameterization
**What:** `src/lib/widgets/server-registry.ts` registers per-widget `dataDeps` functions in a `Record<string, DataDepsFn>` where `DataDepsFn = (config: any) => DataDep[]`. The `as DataDepsFn` cast at registration sites throws away the per-widget config type. If a widget's `dataDeps` signature drifts (extra param, returns Promise instead), TypeScript won't catch it because the cast erases the constraint.
**Why:** Today's widgets are all simple sync `(config) => DataDep[]`. As widgets grow more elaborate (computed metrics fetching multiple things in parallel), a signature drift could cause a runtime crash that a tighter type would have caught at compile time.
**Fix sketch:** Make the registration site take a `WidgetDef<P>` plus its dataDeps, and key the type by widget def. E.g. `registerWidget(metricBlockWidget, metricBlockDataDeps)` — the function signature ties the two together generically.
**Effort:** S (~30min CC).
**When:** Bundle with the next dataDeps signature change.
**Source:** Surfaced 2026-05-03 in the PR3 outside-agent review.
