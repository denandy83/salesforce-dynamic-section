# salesforce-dynamic-section

Salesforce DX project (sourceApiVersion 65.0, no namespace) for AvioBook. Home of the
config-driven **`nD_DynamicSection`** LWC — a collapsible, App-Builder-configured detail
section for Lightning record pages (primarily **Case**).

## Orgs & deploy
- sf CLI aliases: **`UAT`** (`andy.cassiers@aviobook.aero.uat`, sandbox) · **`PROD`** (`andy.cassiers@aviobook.aero`).
- ⚠️ `.sf/config.json` default `target-org` is **PROD** — ALWAYS pass `--target-org UAT|PROD` explicitly on every command.
- Deploy to sandbox: `sf project deploy start --source-dir force-app/main/default/lwc force-app/main/default/classes --target-org UAT`
- PROD readiness gate (check-only + runs tests): `sf project deploy validate --source-dir <dirs> --target-org PROD --test-level RunSpecifiedTests --tests ND_ProblemPickerTest`
- Ship to PROD without re-running tests: `sf project deploy quick --job-id <validationId> --target-org PROD`
- Confirm a deploy: `sf project deploy report --use-most-recent --target-org <org>` (or `--job-id`).

## Components

### `lwc/nD_DynamicSection` (runtime, config-driven)
Reads ONE JSON document from the `ND_jsonConfigString` App Builder property:
`{"section":{…},"fields":[…]}`. A bare `[…]` array is still accepted as the legacy
fields-only shape. **Section settings live in the JSON** (`title`, `icon`, `columns`,
`startCollapsed`, `headerColor`, `headerTextColor`, `alertField`, `alertValue`,
`alertColor`, `alertTextColor`) — see `SECTION_KEYS` in the schema module.
- **`ND_jsonConfigString` is the ONE App Builder property, and must stay that way.** The
  setup instructions live in its `description`, because that is the only place text can go
  in a property panel: **there is no label-only or help-only property type**, so guidance
  added as its own entry becomes an input box nobody should type in. Config problems go to
  `console.warn` only; validation happens in the builder.
- **⚠️ Never add a property here casually.** The platform refuses to remove a property tag
  while the component is on any Lightning page, and clearing every value is not enough — it
  takes stripping the component from all 8 pages, deploying, removing the tag, restoring the
  pages, deploying. That sequence has been run **twice**: once for the ten legacy section
  properties, once for a `ND_configBuilderUrl` box that turned out to be exactly the input
  nobody should type in. Scripts for it are in the scratchpad
  (`strip_flexipages.py`, `migrate_flexipages.py`); originals in commit `dcee5a9`.
- **⚠️ Adding a property here is hard to undo.** The platform refuses to remove a property
  tag while the component is on any Lightning page — *"You can't remove the property tag
  named '…'. The component is in use on one or more Lightning pages"* — and **clearing every
  value is not enough**, the component has to come off the pages entirely. Removing the ten
  legacy properties took: migrate all 22 instances' configs → deploy pages → strip the
  component from all 8 pages → deploy → deploy the LWC → restore the pages from git →
  deploy. Originals are in commit `dcee5a9` and `~/Desktop/nd-flexipage-backup-*`.
- The **8 hosting pages** are committed under `force-app/main/default/flexipages/`, so the
  configs are now in version control rather than only in the org.
- **Pointing an admin at the builder — the answer is the card's own empty state.** An empty
  config renders a **setup prompt** naming the App Launcher, the builder, and the property to
  paste into. That is the single place it is said. Dead ends already tried and removed, so
  nobody repeats them:
  | Attempt | Why it failed |
  |---|---|
  | Custom Property Editor | Platform forbids it — `configurationEditor` is Flow-only |
  | A link in the property panel | Panels render inputs only |
  | A `ND_configBuilderUrl` box holding the path | Only ever an input nobody should type in; a `default` also does not populate existing instances |
  | A link in the App Builder canvas | The canvas swallows clicks — every component is a drag handle, so the link looked live and did nothing |
  | A permission-gated link on the record page | Worked, but put admin chrome in front of agents' data |
- **A property `default` does NOT reach instances already on a page** — only ones added
  afterwards. `ND_configBuilderUrl` had to be written into all 22 existing instances
  explicitly (`scratchpad/set_builder_url.py`).

Each `fields` entry is a field row.
Supported per-field keys:
- `apiName` (required), `label`, `editable`, `colSpan` (2 = full width)
- **Visibility:** `showIf` — a LIST of conditions with a logic mode, or the flat
  `showIfField` + `showIfValue` for a single one. See **Conditions** below; `showIfValue` is
  comma-separated **membership** (omit value = truthy check), and was exact equality until
  2026-08-06.
  **Reacts to the LIVE form value, not just the saved one:** picking a different Record Type hides
  rows scoped to the old one immediately. The decision is `isRowVisible()` in the schema module
  (pure, so it is tested); the component supplies `liveValues` (tracked, filled by
  `ND_handleFieldChange` for watched fields only) and `selectedRecordTypeId`. Both are cleared on
  save and on Cancel.
- **Field alert:** `colorIf` (or the flat `colorIfField`/`colorIfValue`) → bottom underline on
  the field value/control. An empty field watches the row's own field. **`color` is optional and
  defaults to `#ba0517`** (`DEFAULT_ALERT_COLOR` in the schema module, mirrored by the
  `var(--nd-alert-color, …)` fallback in the CSS). A row opts into the underline by naming a
  colour **or** by having a condition for one — it used to be the colour alone, so a row with
  conditions and no colour was configured to underline and then silently did not. Both are still
  needed as opt-ins: without the colour half, `color` with no condition would stop meaning
  "always on"; without the condition half, every row in the section would underline, since no
  conditions means "yes" at this site.
- `isRecordLink` — value is a record Id; opens via `NavigationMixin`. The open-window icon sits
  **beside the label**, at the weight of the inline-help ⓘ it may share the line with (small,
  grey, blue on hover). It used to sit in the bottom-right corner of the VALUE at
  `transform: scale(2)`, which made a secondary action the loudest thing in the row. A row with
  **no config `label`** keeps the corner icon as a fallback: the base component draws its own
  label inside its shadow DOM, so there is nothing of ours to sit beside — and only that
  fallback reserves the 28px on the right.
- **Row separators only line up because the grid is forced to `align-items: stretch`.**
  SLDS's `.slds-grid` computes **`align-items: flex-start`** (verified in a rendered card in
  UAT), so each `.nd-field-row` cell was only as tall as its own control and its
  `border-bottom` drew the separator at its own height — the two columns of a row stepped
  apart by however much their controls disagreed. And they do disagree: a date input measured
  **70px next to a picklist's 68px**, and a checkbox is shorter than either by ~13px. Hence
  `.nd-body .slds-grid { align-items: stretch }`, which makes the separator a property of the
  row instead of of whichever control is tallest. This is the general fix — chasing it per
  field type would never end.
- **This org renders LWC with NATIVE shadow DOM, not synthetic.** A walk of the record page
  found 558 shadow roots and `document.querySelector('.nd-field-row')` returns nothing. So the
  usual synthetic-shadow escape hatches do **not** apply here: this component's CSS genuinely
  cannot reach inside `lightning-input-field` / `lightning-output-field`, and JS cannot either.
  Anything that needs to move a base component's internals has to be done from outside its
  host element. Measuring the real thing means piercing `shadowRoot` recursively (Playwright
  over a `sf org open --url-only` front-door URL works, and beats guessing from screenshots).
- **`childRollup`** — the entry reads ONE field off EVERY child record and joins the values
  into a single read-only row. `{"label":"Fix versions","childRollup":{"relationship":
  "Jira_Tickets__r","field":"AVB_Fix_Versions__c","exclude":"not_applicable,no"}}`.
  Keyed by PRESENCE of the key, like `divider`, and for the same reason: the value is an
  options object, so "present but not filled in yet" has to survive a round trip while it is
  being edited. Optional `split` (default `,`; empty string treats the child value as atomic),
  `separator` (default `", "`), `exclude` (comma-separated placeholders, matched
  case-insensitively). Values are always de-duplicated case-insensitively (keeping the first
  spelling) and sorted, so the same case reads the same way twice.
  - **A rollup row has NO apiName**, which is the whole point: **a formula cannot do this.**
    Cross-object formulas only traverse child → parent, and a roll-up summary offers only
    COUNT / SUM / MIN / MAX — there is no text concatenation. Verified against the org, not
    assumed. `apiName` and `editable` carry `appliesWhen: row => !isChildRollup(row)` so an
    editor never offers them; `ROLLUP_ALLOWED_KEYS` is the rest of the whitelist and
    `validateConfig` warns on anything else.
  - **Backed by `ND_ChildRollup.getChildValues`** (Apex), because the UI API's describe does
    not expose child relationships at all. Values come back RAW; splitting, de-duplicating and
    filtering happen in `rollupValues()` in the schema module, which keeps them pure and
    Jest-testable.
  - **`—` and `…` are different states on purpose**: `…` while the request is out, `—` once it
    came back empty. Both looked like an empty row when they shared a rendering.
  - **The fetch is imperative, from `renderedCallback`, not a wire.** The relationship and
    field come out of the JSON, and a wire's parameters have to be declared statically — there
    is no way to wire N rollups whose targets are only known at runtime. A failed request is
    deliberately NOT retried: this runs on every render, so clearing the key on failure would
    turn one broken config into an endless stream of callouts.
  - **⚠️ That late write is what made the section come up dirty.** It lands after the form has
    settled, starting a second render pass, and a base input re-rendering fires `change`
    exactly like a user edit — the trap already noted on `ND_handleFieldChange` for cold loads.
    Fixed by `_settleRollup`, which re-derives the dirty state after storing the answer, and by
    `_recomputeDirtyAfterRefresh` no longer DROPPING a call that arrives while one is queued
    (it now guarantees one more pass). That swallow was pre-existing and unreachable while
    every render pass came from a wire; the rollup made it reachable. Isolated with three
    builder variants — the decisive one being a rollup row that is **not rendered** and still
    turned the card dirty, which is what proved the cause was the fetch and not the markup.
- **`divider`** — the entry is a RULE across the section, `———— SLA ————`, not a field.
  `{"divider": "SLA"}`, or `{"divider": ""}` for a plain unlabelled rule. **Presence of the key
  is the discriminator, not its truthiness**, so an empty caption is a deliberate plain rule
  rather than an unfinished one (same reasoning as a condition's value key). Always full width —
  half a rule across one column of two reads as a mistake. It takes `showIf` like any other row,
  which is the point: a captioned rule usually heads a group of conditional fields and has to
  disappear with them. Every other key is meaningless on it and `validateConfig` says so. Keyed
  by index, since a divider has no apiName and two unlabelled ones would otherwise collide.
- **A field with inline help text puts its ⓘ on its own line, and the fix is a floated
  label.** **`lightning-input-field` draws the field's help button itself — and
  `lightning-output-field` does NOT** (verified in UAT against a field that has inline help
  text; an earlier note here wrongly said both did, so read-only rows were being given the
  floated label for an icon that never appears). **`variant="label-hidden"` hides the label but
  NOT that button**, so it keeps the label's slot and lands between the `.nd-custom-label` div
  and the value. Only EDITABLE rows are flagged — and via the effective editability, since the
  App Builder canvas renders everything read-only. The icon
  is inside the field component's shadow DOM, so no selector in `nD_DynamicSection.css` can
  reach it: the label is the only side of the boundary that can move. Rows whose describe has
  `inlineHelpText` get `.nd-custom-label_inline-help`, which floats the label so the icon's
  line box flows up beside it. The label gets **no line-height override** — it must keep the
  height it has on every other row or it stops lining up with the labels beside it. The second
  half is `.nd-help-field`, a `margin-top: -0.25rem` on the field component itself: the line
  box the platform puts the icon in is **~19px against our ~15.5px label block**, so a row with
  help text used to sit ~4px lower than the row beside it, control and all. Pulling the field
  up by that difference lines the control back up with its neighbours *and* carries the icon up
  to the label, since the icon rides in that same line box — one number, three fixes. Measured
  on a rendered card against the row separator (a fixed origin), not nudged until it looked
  right. Dead end worth not repeating: raising the label's `line-height` to meet the icon does
  align the two, but drags the label ~4.5px below every other label in the section. Only rows that actually render one of those two components are
  flagged; every custom widget (`isUrl`, `isUrlList`, `isEmailList`, `isOpenProblem`, owner,
  record type) draws its own control and never shows the icon. Surfaced 2026-08-24 by
  `AVB_Version__c` — it is the first configured Case field with help text, which is why the
  section shipped for months without anyone seeing this.
- `isUrl` — single link: empty = paste input, saved = clickable link + `×` to clear
- `isEmailList` — **comma-separated email addresses shown as people** (`AVB_Collaborators__c`,
  `AVB_Followers__c`). Collapsed to an avatar cluster (photo when real, else initials) plus
  "N people / M organisations, K not in Salesforce"; click to open a capped-height roster with
  add and remove. Addresses resolve via `ND_EmailResolver`: Standard User wins, then Contact
  (subtitle = Account name), then community/portal User; anything unmatched still renders as a
  person marked "Not in Salesforce", which is the normal case for shared mailboxes. Stored format
  stays plain comma-separated text, so flows and integrations writing the field are unaffected.
  Typed/pasted input is parsed by extracting address-shaped tokens, so commas, semicolons,
  spaces and newlines all separate, and Outlook display-name form (`"Pater, Jean-Michel"
  <jm@x.example>;`) works. The STORED value is parsed by splitting on `,;` and newlines only, keeping
  malformed tokens so a bad entry stays visible and survives the next save.
  Avatar colour: blue = internal User, teal = Contact, grey = unmatched.
- `allowedDomains` (with `isEmailList`) — comma-separated domain allow-list, e.g.
  `"allowedDomains":"aviobook.aero"` on `AVB_Followers__c` so only internal addresses can be
  added. Applies per address in a pasted block: the valid ones are added, the refused ones stay
  in the input with a message naming them. Comparison ignores a trailing `.invalid` so sandbox
  scrambled copies still validate. Existing stored values are never removed by the rule.
- `isUrlList` — **multiple labeled links** stored as JSON `[{label,url}]` in a Long Text Area; add/edit via a pop-out modal (Label + URL fields), `×` to remove, click label to open. Backward-compatible: a legacy plain-URL value renders as one chip.
- `isOpenProblem` — Case lookup rendered as a **modal picker** (Case # / Subject / Status table) backed by `ND_ProblemPicker` Apex; removable filter chips (record type / open-only), search by number or subject; a linked value opens the case.
- **`alertTitle` (section setting) renames the header while the alert holds**, so an overdue
  case can say "OVERDUE" rather than only turning red. **Blank falls back to the normal
  title** — the same rule `alertTextColor` already used, which keeps recolour-without-rename
  the default and means no existing config loses its header text the moment its alert fires.
  Deliberately has NO `fallback` in the registry: a fallback would make "unset"
  indistinguishable from "same as the title" and the renderer's check could never take the
  second branch. Interpolation runs on whichever title won, so `{CaseNumber}` works in it —
  but only for fields the section already loads, which is a pre-existing limit of title
  interpolation, not specific to this key.
- Header alert (App Builder props, NOT the JSON): `ND_headerLogicField` + `ND_headerLogicValue` + `ND_headerActiveColor` (single field only).
- **`ND_showConfigDiagnostics`** (App Builder Boolean, default off) — renders a config check inside
  the card: unknown/misspelled keys, two widgets on one row, settings with no effect, and the
  take-it requirements in English. Off by default because the messages are for whoever edits the
  JSON, not for agents. Problems are **always** written to `console.warn` regardless of the flag,
  deduped by signature so the getter chain doesn't spam on every render. Known gap: an admin who
  never switches it on still won't see a typo in the UI.
- `requiredBeforeTakeover` (+ optional `requiredIfField` / `requiredIfValue`) — **"take it!"
  pre-flight, config-driven.** A row with `"requiredBeforeTakeover":true` must have a value or the
  click is refused with the top-of-card banner ("Issue Type needs to be set before taking a case")
  and the owner is left alone. `requiredIfField` + `requiredIfValue` (comma-separated membership;
  omit the value for a truthy check) make it conditional. **Nothing is required by default.**
  Scoping rules:
  - A row **hidden by `showIfField`, or absent from the org, is never demanded** — the user would
    have nowhere to fill it in. This is what scopes Environment to AvioBook cases: its row is
    already `showIfField`-ed to record type `012KB000000kcw4YAA`. `_isRowVisible()` is shared with
    the renderer so the two cannot drift.
  - Reads the LIVE form value before the saved one for both the required field and the
    `requiredIfField` gate, so an unsaved dropdown selection counts as set.
  - **History:** this replaced a hardcoded `TAKEOVER_REQUIRED_FIELDS` list that had no record-type
    awareness and so demanded Environment on AvioData cases, where the org rule does not apply.

  **Why any pre-flight exists:** taking a case out of the Service Queue makes
  `AVB_Case_Flow_After_Update` set Status to Open (decision `Case_Accepted_Check`, prior owner queue
  `AVB_Service_Queue`), which starts the SLA and trips validation rules on the flow's own write.
  That failure names no field and, because those rules exempt `AVB_System_Administrator`, is
  invisible to admins. Rules that actually fire on the New → Open transition (verified against UAT
  2026-08-05):
  | Rule | Record types | Requires | Extra condition |
  |---|---|---|---|
  | `AVB_Require_IssueType` | AvioBook **+** AvioData Case | `Type` | Status ≥ Open |
  | `AVB_Solved_Requires_Environment` | AvioBook Case only | `AVB_Environment__c` | `Type = "Bug or Incident"`, `ISCHANGED(Status)`, Status ≠ New — fires on New → Open too, despite the name |
  | `AVB_Require_Contact_When_Status_Open` | AvioBook **+** AvioData Case | `ContactId` | Status ≥ Open — **not** in the section config, so not pre-flighted |

  All three exempt profile `AVB_System_Administrator` and permission
  `AVB_Validation_Rule_Exclusion`; the LWC cannot see either, so it still pre-flights for admins.
  `AVB_Require_SRT_When_Status_open` needs Status ≥ Waiting for Customer, so take-it never trips it.
- **"take it!" sits on the LABEL line**, not under the picker. As a block below the control it
  made the owner cell taller than its partner, and `align-items: stretch` pushed that height
  onto the whole flex line — so an unrelated field beside it grew ~16px of empty space (29px
  between rows against 13px elsewhere, measured), and only while someone else owned the case,
  which made it look like a rendering glitch. On the label line it costs no height: the owner
  row now measures the same 58px as every other row. Kept blue and bold there, because it
  starts an SLA clock and must not read as decoration.
  - `ownerNotice` (the ✓ after taking) is still a block below the control, so the row still
    grows for a moment after a successful takeover. Left alone: it is transient feedback, and
    that is the one time a bit of movement is informative rather than annoying.
- **"take it!" saves through the form**, not a bare `updateRecord`, so pending edits are committed
  in the SAME DML. Otherwise a just-picked Environment is not yet on the record when the flow flips
  Status to Open, and the save fails.
- Save shows a **"Saving…"** spinner; owner **"take it!"** hides when the running user already owns the case and shows **"taking…"** while in flight.
- **Owner picker — the User side is filtered to internal, active users** (`ownerUserFilter`:
  `UserType = 'Standard' AND IsActive = true`), the Queue side to `Group.Type = 'Queue'`. Unfiltered,
  the `lightning-record-picker` searched every User the running user can see, and PROD has **400
  active `CspLitePortal` community users to 40 internal** — typing "dhanush" returned two portal
  accounts around the one colleague. `UserType = 'Standard'` is exactly the internal licences
  (Salesforce, Salesforce Platform); every community licence has its own UserType, as do `Guest`,
  `AutomatedProcess` and `CloudIntegrationUser`. Inactive users are dropped because they cannot own a
  record — offering them only buys a save error. Both fields are `filterable: true` in the UI API
  describe (`/ui-api/object-info/User`); **check that before adding any picker filter**, and note
  `UserType` is `searchPrefilterable: false` yet still works, so the docs' silence on prefilterability
  is not a blocker. Queues are not restricted to those supporting Case — PROD has exactly one queue
  and it does, so the case has never arisen.
- **Constraint (field existence):** a config field that does not exist in the org is skipped with a
  console warning rather than breaking the component. `getRecord` fails the whole request on one
  bad field, which used to blank every custom widget (owner, problem, links) while the standard
  fields kept working.
- **Constraint:** a condition on a non-date field is equality / membership / truthy only.
  **Date and DateTime fields can be compared** — see Conditions below. No numeric or text
  comparison operators, and no cross-field comparison.
- **Every `…is one of` control is a multi-select in the builder** where the watched field has fixed
  values: record types (offered by name, Ids written) and picklists (via
  `ND_SectionPreviewPicker.getPicklistValues`). Anything else falls back to a comma-separated text
  box. Applies to `showIfValue`, `colorIfValue`, `requiredIfValue` and the section's `alertValue`.

### Columns — 1, 2 or 3, and `colSpan` as a SPAN (2026-09-04)
`columns` takes **3** as well as 1 and 2. Added for the **portal card, which is full page
width**; the internal instances stay at 2, because those sit in the centre column of a
three-column page template and thirds would be cramped there. `columns` is per-instance
config, so the same component is 3 wide in the portal and 2 wide on the record page —
no code knows the difference.
- **`colSpan` has ALWAYS meant "how many of the section's columns this row spans."** It was
  only ever *written* as "2 = full width" because every section was two columns. Reading it
  as a span is what let three columns arrive **without migrating a single live config**:
  `colSpan: 2` still means full width at 2 columns and starts meaning two thirds at 3, and
  nothing changes until someone deliberately sets `columns: 3`.

  | | unset | `colSpan: 2` | `colSpan: 3` |
  |---|---|---|---|
  | 2 columns | half | full | full (clamped) |
  | 3 columns | one third | two thirds | full |
- **`sizeClassFor(colSpan, columns)` in the schema module is the single decision**, used by
  the field row, the rollup row and the builder. It was previously the same ternary written
  out **twice** in `nD_DynamicSection` — the two could have drifted and nothing would have
  caught it. Dividers are still unconditionally full width.
- **It CLAMPS rather than trusting the number.** A row left at `colSpan: 3` after the section
  is switched back to two columns renders full width instead of asking SLDS for a class that
  does not exist at that width. `validateConfig` warns about it separately (an error for a
  non-numeric span), because rendering something sane is not the same as the row doing what
  the number asks.
- **The Width dropdown's options depend on the section's width** — the one select that does.
  `colSpanOptions(columns, current)` **keeps the row's current value on offer even when the
  section is now too narrow for it**, because a combobox holding a value absent from its own
  options renders BLANK, and the row would look as if it had no width set while the JSON says
  otherwise. Exactly the lesson the date-operator combobox already cost.
- **The badge is computed, not a fixed word.** `badgeFor(value, ctx)` replaced
  `badge: 'full width' / badgeWhen: 2`, which is a lie for `colSpan: 2` in a three-column
  section. Same accuracy rule that stopped dividers inheriting "read only".
- **No responsive breakpoints, deliberately.** The existing sizes are non-responsive and
  mixing the two would be inconsistent; the lever for a narrow region is the section's own
  `columns` setting, which is already per-instance. 26 Jest tests in `columns.test.js`.

### Conditions — the shared engine behind all four "when…" settings (2026-08-25)
**Four places watch a field and act on what it holds**, and they all now run through ONE engine in
`nD_sectionConfigSchema`, so a fix or a feature lands on all four at once:

| Site | Structured key | Flat pair it grew out of | No conditions means |
|---|---|---|---|
| Show this row only when… | `showIf` | `showIfField` / `showIfValue` | visible |
| Underline the value when… | `colorIf` | `colorIfField` / `colorIfValue` | always on (given `color`) |
| Require before "take it!" | `requiredIf` | `requiredIfField` / `requiredIfValue` | always required |
| Recolour the header when… (section) | `alertIf` | `alertField` / `alertValue` | **never** — an alert with no condition can never fire |

```json
"showIf": { "logic": "(1 AND 2) OR 3", "conditions": [
    { "field": "RecordTypeId",        "value": "012KB000000kcw4YAA" },
    { "field": "AVB_ICAO_Account__c", "value": "KLM" },
    { "field": "Type", "value": "Bug or Incident", "negate": true } ] }
```
- `logic` is `AND` (the default), `OR`, or an expression in the org's own filter-logic style:
  condition numbers with `AND` / `OR` / `NOT` / brackets. `&&` and `||` are accepted too, since
  people reach for them. Parsed by a **recursive-descent parser, never `eval`** — the string comes
  out of admin-typed config, and a thrown `SyntaxError` could not say *why* it was wrong.
- **Unreadable logic falls back to AND, not to `true`.** A typo must not silently reveal every row
  it was guarding. `validateConfig` reports it as an **error** naming the fault ("A "(" is never
  closed"), because otherwise a broken expression looks like it works until the day it disagrees.
- `negate` per condition (the builder's `is one of` / `is NOT one of`). **A field that was never
  loaded is false BEFORE negate applies** — "is not KLM" must not become true just because nobody
  asked for the field. A loaded-but-EMPTY field is different: it is known, with a null value, which
  is what makes "is not KLM" correctly true for a blank ICAO.
- **Both shapes are read, forever, and the flat pair is still what gets WRITTEN for a single plain
  condition** (`withConditionsSet` is the only place that chooses). Not nostalgia: every live config
  in the org is written that way, and a browser still running the previous bundle goes on
  understanding it — see the cached-bundle lesson below. Only a genuinely multi-condition row needs
  the new shape, and only that row degrades on a stale bundle. `AND` is omitted from the JSON since
  it is the default.
- **A read-only value is given the control's height so its text lines up with an editable
  field's** (`.nd-readonly-value`). Bare text sits in a **~19px** box against a control's
  **32px**, so it rendered ~6px higher and a row pairing one of each looked out of line —
  "SWA" against "Andy Cassiers". `display: flex; align-items: center; min-height: 2rem` on the
  host centres it; that works because the shadow tree's top-level box is laid out as a child of
  the host box, which is the only way to move content this component cannot select. Derived from
  the control height rather than nudged by the measured 6px, so it survives SLDS changing what a
  static value's line-height is. Applies to plain read-only rows only — `isUrl`, `isUrlList` and
  `isEmailList` draw their own boxes, already at `min-height: 2rem`. **Costs ~13px of height per
  read-only row**, which is what alignment buys.
- **Row spacing is `.nd-field-row { padding: 0.25rem 0 }`** — halved from `0.5rem` once the
  separators went, since the padding then became the only thing dividing rows and 16px of
  nothing between a value and the next label is a lot over a dozen rows. `.nd-field-content`'s
  1px `margin-bottom` went with it. Its `border: 1px solid transparent` stays: it is invisible
  and always was, but the alert `::after` is positioned against the padding box, so removing it
  would shift every underline by 1px.
- **No row separators either** — `.nd-field-row` carries padding only. Rows are divided by
  whitespace alone, the way standard field sections do it. Useful side effect: the `divider`
  entries are now the section's ONLY horizontal rules, so a `———— SLA ————` reads as the
  deliberate grouping device it is rather than one more line among many. If a dense section
  reads tight without them, the lever is `.nd-field-row`'s padding, not putting the rule back.
  (`align-items: stretch` stays — it was added so these separators lined up across columns, but
  it still does the useful job of equalising cell heights.)
- **SLDS's own 1px rule under a read-only value is turned OFF**
  (`.nd-body lightning-output-field { border-bottom: none }`). SLDS draws it as the read-only
  counterpart of an input's border, so a value still reads as a field — reasonable in general,
  but here it earned nothing and cost something: every row already has its own separator, so a
  read-only value carried two rules ~11px apart, and **this section uses a bottom underline as a
  MEANINGFUL signal** (the `colorIf` alert). A permanent grey underline on half the rows teaches
  the eye that underlines are chrome, which is the opposite of what the alert needs.
  - The rule is on the **host element**, which the base component stamps
    `slds-form-element_readonly` onto. The host is in THIS component's tree, so unlike the value
    inside it, this one is ours to turn off.
  - Targeted by ELEMENT, not by `.nd-readonly-value`, so checkboxes and label-less rows lose it
    too — half the rows keeping it would look like a bug. The descendant selector
    (`.nd-body` …) is for specificity: a lone element selector loses to SLDS's class.
  - **Consequence to expect:** the section no longer matches the standard field sections beside
    it on the same record page, which still show SLDS's underline.
- **⚠️ Booleans are excluded, because a checkbox is not a 2rem control.** An editable checkbox
  measures **16.6px** and sits near the top (centre 24.3), so there is no shared band to centre a
  read-only one in: centring it in 2rem put it at 32, i.e. **7.7px BELOW** its editable
  counterpart, when its natural position (centre 26.3) was already within **2px**. Measured in
  UAT. The rule to take from it: before aligning A to B, measure B — "read-only sits higher than
  editable" is true for text and picklists and false for checkboxes, and one fix cannot serve
  both.
- **That retired the read-only underline offset for those rows.** The extra 4px drop existed
  only because a read-only value had no control box to sit under; with one, keeping it put the
  rule at 51 against the editable row's 47. `.nd-field-content_alert-readonly` now applies only
  where the box is still short.
- **The underline offset difference is now only for rows whose box is still short** (the
  three widget read-only forms): `.nd-field-content_alert-readonly { bottom: -4px }` vs
  `bottom: 0`. Otherwise: measured in a
  rendered card, every editable row is identical — `bottom: 0`, `height: 3px`, and the same 4px
  from the field component's own box, whether the control is a date input, a picklist or a text
  input. Apparent differences between editable rows are **subpixel rounding at non-100% zoom**:
  at ~81% a 3px rule is 2.44 device px so it lands on 2 or 3 rows depending on where each row's
  bottom edge falls, and a 1px control border (0.81px) can disappear altogether. Confirm the zoom
  before chasing that as a CSS bug.
- **Date and DateTime fields take a comparison operator** (2026-08-25), which closes the
  "date on or before today" gap that had been open since the start:
  `{"field":"AVB_On_Hold_Resolution_Target_Date__c","op":"onOrBefore","value":"today"}`.
  Operators: `before` · `onOrBefore` · `on` · `onOrAfter` · `after` (`DATE_OPS`). The operand is
  `today`, `today+7`, `today-30`, or a literal `YYYY-MM-DD`. A window is two conditions AND'ed.
  - **Two timezone traps, both deliberately avoided.** A date-only value is NEVER put through
    `new Date(string)` — that parses `"2026-09-01"` as UTC midnight, so anyone **west** of UTC
    reads it as 31 August, the classic off-by-one. Date-only values are split on their digits
    and compared as calendar day numbers. And **"today" is the VIEWER's today**, from their local
    calendar, not UTC: an overdue highlight that turns over at midnight UTC is wrong for most of
    the world. A **DateTime** is a real instant, so it is converted to the viewer's local day
    first — a case created 23:30 local counts as that day, not the next one in UTC.
    The tests assert against a fixed epoch-day number (2026-08-25 = 20690) so they mean the same
    thing on a machine in any timezone.
  - `op` **can never be written to the flat `showIfField`/`showIfValue` pair** — it has room for
    a field and a value and nothing else — so a comparison is always stored structurally.
  - An unreadable operand, an empty date field, or a value that is not a date **never holds**,
    rather than guessing; `validateConfig` reports the operand as an error, an unknown operator
    as an error, and a date op on a non-date field as a warning. Impossible dates (`2026-02-30`)
    are refused — `Date.UTC` would silently roll them over.
  - The builder offers the operators only for Date/DateTime fields (it passes `fieldTypes` from
    the describe), but **keeps them on offer for a condition that already carries one**, whatever
    the field's type says now — otherwise the combobox would hold a value absent from its own
    options and render blank, hiding a condition that is really there.
  - Choosing a comparison **seeds the operand with `today`**, so the condition is valid the
    moment it is picked instead of sitting in an error state.
  - **Still not done:** the operand is a text box, not a date picker. A picker would need a
    mode switch between "a date" and "relative to today", which is exactly the mutating-control
    trap above — worth doing only with that solved.
- **A BLANK value means "any non-blank value"** — what the registry always claimed the
  `…Value` keys meant, while the code read a blank as membership of the empty string, i.e. a
  condition that could essentially never hold. **Behaviour change (2026-08-25):** a config with
  `showIfValue: ""` used to hide its row and now shows it whenever the watched field is
  populated. Nothing in the live configs was written that way — nobody configures a row that
  can never appear — but it is a change. Absent and blank now agree, which is what lets an
  editor clear the box and mean the same as never having filled it in.
- **"is one of" takes a LIST: `KLM,SWA` matches either.** Two conditions OR'd together say the
  same thing; the comma-separated list is the shorter way and is tested as equivalent.
- **An unfinished condition — one that names no field — is IGNORED, not false, and it IS
  stored.** Both halves matter. It has to be stored because the editor keeps no state of its
  own, so a brand-new condition has to survive a round trip through the config before a field
  has been chosen; dropping it on the way out is what made **"Add condition" silently do
  nothing**. And it has to be ignored rather than false because a blank `showIfField` has
  always meant "no condition", so the two shapes must agree or the same config means different
  things depending on which one it is written in. `validateConfig` reports it as an error, so it
  cannot stay unfinished by accident. The flat pair cannot express "no field yet" (writing
  neither key loses it), so a lone unfinished condition is stored structurally and **flattens
  the moment a field is picked**.
- **Custom logic numbers the conditions AS WRITTEN**, so the results array stays aligned with
  the full list and unfinished ones are substituted with `true` (neutral under AND) rather than
  filtered out. Filtering would renumber the expression, and `1 AND 3` would quietly come to
  mean conditions the author never picked.
- `watchedFieldsOf(rows, section)` is the single source for which fields to add to the `getRecord`
  wire AND to track live. A watched field is usually **not** a row of its own (a take-it gate, an
  ICAO check), so it has to be requested explicitly or it is never known.
- **The underline and the take-it gate now react to the LIVE form value too**, not just the saved
  one, because they share the renderer's context. Previously only `showIf` did.
- Removing a condition while custom logic is set **drops back to AND**: the numbers in the
  expression would otherwise come to mean different conditions than the author picked.
- **Not done (deliberate):** no numeric or text comparison operators, and no cross-object or
  cross-field conditions. Date comparison IS done — see above.

### Experience Cloud — the same component in the Aura customer portal (2026-09-04)
`nD_DynamicSection` is exposed to **Experience Builder** as well as Lightning record pages.
Targets are additive and the config is per-instance, so ONE bundle serves both and nothing
about the 22 internal instances changed.

- **Targets:** `lightningCommunity__Page` puts it in the palette, `lightningCommunity__Default`
  is what lets it have properties there. Both are needed; one alone does nothing useful.
- **⚠️ A site does NOT inject `recordId` or `objectApiName`.** A Lightning record page supplies
  them; Experience Builder does not, so both are declared in the community `targetConfig` and
  the admin binds them to `{!recordId}` / `{!objectApiName}` in the property panel. Without
  them `nd_wireFields` returns undefined at its first line and the card comes up EMPTY — which
  reads as a broken component rather than a missing binding. This is the single most likely
  thing to go wrong when placing it.
- **⚠️ Those three property tags are as unremovable as the LEX one.** Same platform rule, same
  strip-it-off-every-page sequence. They are the minimum a site instance needs. Do not add a
  fourth.
- **No Apex, no permission set, no profile change is needed** — verified, not assumed. All three
  Apex calls are gated on row types being present: `getChildValues` returns early unless
  `isChildRollup(item)`, `resolveEmails` returns on an empty `wanted` list, and `getOpenProblems`
  is only reachable from the `isOpenProblem` modal. A portal config that omits those rows makes
  no callout at all. That matters because portal users get almost nothing from permission sets
  here (391 active `CspLitePortal` users; 2 permission-set assignments between them) — everything
  comes from their profile, and `PermissionSetAssignment` is data that does not travel in a deploy.
- **Read-only comes out clean with no work.** Save/Cancel live inside `<template if:true={isDirty}>`
  and `isDirty` can only be set by an editable widget, so an all-read-only config renders a card
  with no footer and nothing to suppress.
- **The internal widgets are excluded by CONFIG, not by code.** Owner + "take it!", `isOpenProblem`,
  `isEmailList` and `childRollup` are opt-in per row, so the portal instance simply omits them.
  Gating them in code would have been the wrong layer — the component is config-driven and the
  configs are already per-instance.
- **The setup prompt is suppressed in a site** (`isCommunityContext` → `showSetupPrompt`). It names
  the App Launcher and the Section Config Builder, which live on the internal Lightning domain, so
  an instance whose config had not arrived would show a CUSTOMER admin instructions and a tool they
  cannot reach. Detection is a path-segment check for exactly `s` — Aura sites route every page
  under `/<prefix>/s/…` (or `/s/…` with no prefix) and nothing in `/lightning/…` or
  `/flexipageEditor/…` has such a segment, so **the App Builder canvas still shows the prompt**,
  which is where an admin has just dropped the component and does need it. Like `isDesignPreview`
  this reads a platform URL rather than an API, and is deliberately written to fail towards
  SHOWING: a missed detection is exactly the old behaviour. 6 Jest tests, including Setup
  (`/lightning/setup/…`) as the substring-vs-segment case.

- **⚠️ `objectApiName` is a LITERAL (`Case`), never `{!objectApiName}` — this cost an afternoon
  on 2026-09-04.** Salesforce documents the expression as resolving *"only when you place or
  invoke the component in an explicit record context"* and *"only for components where the
  `{!objectApiName}` is in the route"*. A portal route is `/<prefix>/s/case/<id>`, whose segment
  is the object's URL NAME, not its API name — so it silently arrives unset. `{!recordId}` has
  no such caveat and does resolve; the meta's `default` is now `Case` for this reason.
  - **The symptom is a fully-drawn card holding nothing**, which is why it misleads: labels come
    from the JSON so every row renders, while ONE missing value blanks both data paths at once —
    no describe means `nd_wireFields` returns `undefined` at its second line and `getRecord`
    never fires (so the custom widgets are empty), and `lightning-record-edit-form` cannot load
    either (so every output field is empty). No error banner appears, because the form never gets
    far enough to raise a load error. It reads as "the component loaded and found no data" when
    it is really "the component was never told its object".
  - **The diagnostic that settles it in one look: WHICH things are blank.** Those two paths are
    independent and share only `recordId` / `objectApiName`, so both being empty points at the
    inputs, not at data access. A `showIf` row vanishing (no saved fields → condition false) is
    the same evidence. Conversely, if only the custom widgets were empty and the standard fields
    had values, THAT would be the FLS / bad-field case.
  - Ruled out on the way, and worth not re-checking: FLS is fine — `AVB_Product__c`,
    `AVB_Collaborators__c` and `Type` are all Read+Edit for both portal profiles.

**Still open / worth knowing:**
- **`isDesignPreview` does not fire in Experience Builder.** It keys on `/flexipageEditor/`, so the
  render-read-only mitigation for the form-associated-combobox drag crash is INACTIVE in the site
  builder. Whether Experience Builder's drag has the same jQuery-`cloneNode` bug is **untested** —
  deliberately left until observed rather than guessed at. If it crashes, it is one more path in
  that check. A mostly read-only portal config renders few comboboxes anyway.
- **⚠️ FLS could blank the whole card, and it would look like a broken component.** `getRecord` is
  all-or-nothing — the repo already learned this for a field that does not exist in the org. A field
  in the portal config that the community profiles lack FLS on risks the same. **Test the portal
  config as a real portal user, not as an admin.**
- **The portal's pages cannot be version-controlled.** `ExperienceBundle` Metadata API is **off for
  Aura sites** in this org (`sf project retrieve` says so outright), so unlike the 8 flexipages the
  site page config is not retrievable and placement is a UI-only step.
- Guest users are out: LDS/UI API is not available to them, so this only goes on authenticated pages.

**The working portal config (UAT, 2026-09-04) — kept here because THIS FILE IS ITS ONLY BACKUP.**
The site page is not retrievable (see above), so a config pasted into Experience Builder exists
nowhere else. Paste-back copy:
```json
{"section":{},"fields":[
 {"apiName":"CaseNumber","label":"Case Number"},
 {"apiName":"OwnerId","label":"Owner ID"},
 {"apiName":"Type","label":"Issue Type"},
 {"apiName":"AVB_Product__c","label":"Product"},
 {"apiName":"Subject","label":"Subject","colSpan":2},
 {"apiName":"AVB_Collaborators__c","label":"Collaborators","colSpan":2,"editable":true,"isEmailList":true},
 {"apiName":"AVB_Division__c","label":"Division","editable":true,"showIfField":"AVB_ICAO_Account__c","showIfValue":"DHL"}]}
```
Note it DOES carry `isEmailList` (Collaborators), so this instance does call `ND_EmailResolver` and
the "no Apex access needed" shortcut above does **not** hold for it as written — either grant the
class to the two community profiles or drop that row. Untested as at 2026-09-04; the addresses will
render as plain text with grey avatars until the grant exists, which is a permissions symptom that
looks like "not in Salesforce". `OwnerId` is present too, but read-only, so no "take it!" appears.

**Portal org facts (UAT, 2026-09-04):** site `AvioBook Customer Portal` (`0DBKB000000L3cW4AS`, Live,
`/aviobookportal`), Aura template. Members: `AVB_System_Administrator` plus two `CspLitePortal`
profiles — `AVB_General_Community_User` (78) and `AVB_General_Customer_Community_Login_User` (313).
Both have **Read+Edit on Case**, Read on Account/Contact, and **no access to the Jira ticket object**
(so a `childRollup` row would show `—` even if one were configured). Unrelated portal work exists in
the org and not in this repo: `ND_Portal_Agent_Actions`, `ND_Timeline_v2`.

### `lwc/nD_fieldCombobox` (service UI, used by the builder and the conditions editor)
**One control for picking a field: type to narrow, click to choose.** It replaced a
`lightning-combobox` with a separate "Type to filter this list…" box underneath — two inputs for
one decision, and the filter looked like a value you were meant to fill in. `lightning-combobox`
has no type-ahead, which is the only reason the filter box ever existed, and the same reason
"Add a field" was already a search list. This is that list, with a current selection. Used by the
row's own `apiName` picker and by every condition's "Watch this field". 19 Jest tests.
- **The current choice is hoisted to the top of the list.** Opening on an empty search lists all
  127 fields and the cap keeps 60, so a selection sorting past the cap was simply absent —
  `RecordTypeId` sorts under R and vanished, making the open list look like it had forgotten the
  choice. It is also marked `current`.
- **Picks on `onmousedown`, not `onclick`.** Click arrives *after* blur, and blur closes the list,
  so a click handler fires on an element that has already gone.
- A plain `<input>`, not `lightning-input`: focus / blur / keydown all need handling precisely and
  the base component wraps them. Escape closes, Enter takes the top match, blur reverts to the
  selection rather than leaving a half-typed term looking like a value.
- The panel is `position: absolute`, so opening it overlays what is below instead of pushing the
  whole property pane down.
- `blank-label` carries the one-off empty option (`— none —`, or colorIf's "this row's own
  field"), rather than it being glued to the front of the options array.

### `lwc/nD_conditionsEditor` (service UI, used by the Config Builder)
The editor for one condition site: numbered condition cards (field picker, is / is NOT, values as
a multi-select or a text box), Add/remove, and the AND / OR / Custom selector with live parse
errors. **A child component rather than a fourth copy of the builder's
control markup** — the builder already renders its property pane three times over (section, field,
nested) and a condition list is far too much markup to paste into each. It holds **no config
state**: every edit rebuilds the whole group and fires `change` with it, so the row (or section) in
the builder stays the single source of truth and undo / re-select / paste-a-config keep working
without this component knowing they exist. 25 Jest tests.
- The logic selector only appears at **2+ conditions**, where it can first matter. Switching to
  Custom **seeds** the box with what the current mode already means (`1 OR 2 OR 3`), so the
  starting point is always valid and the numbering is demonstrated rather than explained.
- **The Match dropdown names all four states outright: `is one of` · `is not one of` ·
  `has any value` · `is empty`.** Underneath it is only two booleans — is there a value list,
  is it negated — and the first two attempts both tried to INFER the operator from them, which
  failed twice over. First an "Any value at all" checkbox, where an empty box was read as that
  state, so clearing the box to retype removed the box from under the cursor and a value could
  be typed once but never replaced. Then a two-option dropdown whose labels were computed from
  emptiness, so it **relabelled itself as you typed** — pick "has any value", type, and find
  yourself looking at "is one of".
  The rule both broke: **which controls exist, and what they are called, must never depend on
  whether one of them happens to be empty.** The value control is still shown only for the two
  comparing operators, but that now follows from an explicit CHOICE, which cannot change under
  someone's fingers mid-edit.
- **What makes the four representable: a value key that is PRESENT but empty means "comparing,
  nothing listed yet", an ABSENT one means "not comparing at all".** Without that distinction
  "is one of" before anything is typed is indistinguishable from "has any value", and the
  dropdown snaps back on the next render. So `handleValueChange` never deletes the key — only
  the operator dropdown does. `validateConfig` warns on an empty list, since at runtime it
  matches any populated value.
- **Don't let a label echo the operator above it.** The value control was labelled
  "…one of these values" to finish the old sentence; against "is one of" it read as "is one of
  … one of these values". It is just "Values" now.
- **The text value is a plain `<input>` committing on its native `change`** — blur and Enter.
  `lightning-input` maps native `input` to `change`, so every keystroke rewrote the config,
  re-rendered the whole property pane, and threw an error Aura swallowed (7 characters, 7
  "Script error. null" entries). Same reason `nD_fieldCombobox` uses a plain input. A
  `value`-bound base input inside a parent that re-renders on change is the same trap as the
  wire-loop lesson below.
- Changing a condition's field **clears its value**: the old value belonged to the old field's
  value set, so keeping it would leave a condition that can never match.
- Each condition has its **own** field filter box, for the same reason "Add a field" is a search
  list — Case has 127 fields and `lightning-combobox` has no type-ahead.

### `lwc/nD_SectionConfigBuilder` (+ tab `ND_Section_Config_Builder`)
- **"Add a field" is a live search list, not a dropdown.** Case has **127 fields** and
  `lightning-combobox` has **no type-ahead**, so scrolling to one is not realistic. Typing
  narrows the list as you go (`oninput`, not `onchange`), matching label *and* API name,
  case-insensitively; clicking a match adds the row in one action.
- **Fields already used stay in the list, marked "already a row".** They used to be filtered
  out silently, which is why `RecordTypeId` looked absent from the org: six live configs
  already have a RecordTypeId row, so the picker removed it and the count quietly went from
  127 to 115. Clicking a used field now opens that row instead of adding a duplicate.
- **Every field picker is now that same search list** — see `nD_fieldCombobox` below. The
  combobox-plus-filter-box arrangement is gone.
The visual editor, at **`/lightning/n/ND_Section_Config_Builder`**. Three panes: Section +
field rows (add/delete/duplicate/reorder) · registry-generated properties · live preview of
the REAL `nD_DynamicSection` against a record Id, plus the JSON to copy and a box to paste
an existing config into.
- **Section panel** — title, icon picker (filterable grid of `ICON_CHOICES` + free text,
  live preview), colour pickers (native `<input type="color">` — LWC has no colour base
  component — paired with a text box so CSS names and brand hexes still work), columns,
  collapse, header alert.
- Importing a legacy bare array flags it and opens on the Section panel, since those
  settings need filling in before the JSON supersedes the old properties.
- Preview receives **only** `ND_jsonConfigString`, assigned in `renderedCallback`. **`ND_*`
  properties cannot be set from template attributes** — LWC cannot derive an attribute name
  with a leading capital, so `nd-json-config-string=` silently creates an expando and the
  child gets nothing. This cost an hour; the giveaway was the preview header showing the
  default title.

**Child rollup is authored in the builder, not by hand.** "Add a child rollup" sits beside
"Add a divider"; the row's panel offers two dependent `nD_fieldCombobox` pickers plus an
"Ignore these values" box. The relationship list comes from
`ND_SectionPreviewPicker.getChildRelationships` (Apex — the UI API's describe has no child
relationships), and the child's field list from a **dynamic `getObjectInfo` wire** on whichever
object the chosen relationship resolves to, so there is no second Apex call and FLS stays the
platform's. Typing "Jira" narrows 65 child relationships to `Jira Tickets · Jira_Tickets__r` —
which is the point: the field is `AVB_Case__c` and the relationship is **not**
`AVB_Jira_Tickets__r`, so nobody should be expected to guess it.
- The field picker is **disabled until a relationship is chosen** ("Pick a relationship first"),
  because an empty list reads as broken. Changing the relationship **clears the field**, since
  the old field belonged to the old child object — the same rule a condition's value follows.
- `withRollupKeySet` writes into the NESTED options object; a flat `withKeySet` would replace
  the whole thing and lose the other half of the pair. `relationship` and `field` are kept even
  when empty, so a half-finished rollup stays distinguishable from one never started.
- **Bug this surfaced: `handleAddDivider` never cleared `editingSection`.** The pane picks
  between the section panel and the row panel on that flag alone, so "Add a divider" added the
  row and left the panel on Section — the row was there but nothing opened, which reads as the
  button having done nothing. Both add-a-row paths now go through one `selectRow()`.

### `lwc/nD_sectionConfigSchema` (service module, no UI)
**The single definition of the config vocabulary.** Exports `CONFIG_KEYS` (one entry per supported
key: `label`, `control`, `help`, `group`, optional `requires` / `appliesWhen` / `badge`), `WIDGETS`
(the mutually exclusive render modes), `KNOWN_KEYS`, plus `validateConfig()`, `describeRequirement()`
and the shared `isBlank` / `matchesCsv` / `widgetOf` helpers. Imported by `nD_DynamicSection` and
intended for any future editor UI, so a key is defined, documented and validated in ONE place.
- `validateConfig(config, {fields, recordTypes})` is pure — pass the org facts instead of wiring —
  and returns `{row, name, level, message, key}` findings. Catches unknown/misspelled keys (edit
  distance, so a dropped letter is caught: `requiredBeforeTakover` → suggests the real key), two
  widgets on one row, `requires` violations, keys with no effect, and unknown record type Ids.
- `describeRequirement(row, ctx)` renders the take-it rule as an English sentence, so config can be
  reviewed without cross-referencing validation rules by hand.
- **Constraint:** `appliesWhen` is a function, so the registry is code, not data. It would need
  rewriting as declarative rules if the config ever moves to Custom Metadata.
- Jest tests in `__tests__/`. Run with `npm test` (needs `npm install` first — there is no
  lockfile). `nD_DynamicSection` has its own tests too, but only for what renders without a
  record: the unconfigured card and the inline-help label flag. Everything needing a form is
  exercised in the org. `conditions.test.js` covers the shared condition engine (52 tests) —
  that one is the safety net for all four "when…" settings at once.

**⚠️ A Custom Property Editor is NOT possible for this component.** The platform rejects it:
`The 'configurationEditor' attribute is only supported for target(s) [lightning__FlowAction,
lightning__FlowScreen]` — verified by check-only deploy against UAT 2026-08-05. CPEs are a Flow
Builder / Experience Builder feature; `lightning__RecordPage` cannot have one. Any visual editor has
to live outside the App Builder property panel (standalone app/tab with copy-out, or move the config
to Custom Metadata).

### `classes/ND_EmailResolver` (+ `ND_EmailResolverTest`)
`resolveEmails(List<String>)` — resolves addresses to Users and Contacts for `isEmailList`.
`cacheable=true`, `WITH SECURITY_ENFORCED`, capped at 200 addresses, order preserved, blanks
dropped, duplicates folded case-insensitively. Only genuine User photos are returned:
`SmallPhotoUrl` always resolves, but the default avatar is `/profilephoto/005/T` where the
segment is a key prefix rather than a photo Id (only ~9% of PROD users have a real photo).
`Contact.PhotoUrl` is deliberately unused, it always resolves to the generic silhouette endpoint
and cannot be distinguished from a real photo. Test class is self-contained (7 tests).

### `classes/ND_ChildRollup` (+ `ND_ChildRollupTest`)
`getChildValues(parentId, relationshipName, fieldName)` — one field off every child on the far
side of a child relationship, for the `childRollup` row type. `cacheable=true`,
`WITH SECURITY_ENFORCED`, `LIMIT 500`, ordered by the child's name field where it has one.
**Every name that reaches the query comes from the DESCRIBE, never from the caller's strings**:
the relationship name is matched against the parent's child relationships and everything after
that is read off the matched describe, so the only outside value in the query is `parentId` and
that goes through a bind. An inaccessible child object or field returns empty rather than
throwing — an agent without read should see an empty row, not a page error — while a
misconfigured relationship or field name DOES throw, because that is a config fault worth
surfacing. 8 tests.

### `classes/ND_ProblemPicker` (+ `ND_ProblemPickerTest`)
`getOpenProblems(searchTerm, recordTypeDeveloperName, excludedStatuses)` — dynamic SOQL over Case,
matches `Subject OR CaseNumber`, optional record-type (by **DeveloperName**) + status-exclude filters,
`ORDER BY CaseNumber DESC LIMIT 200`, `WITH SECURITY_ENFORCED`. Test class is self-contained (4 tests, ~100% of the class).

### `classes/ND_SectionPreviewPicker` (+ `ND_SectionPreviewPickerTest`)
Serves the Config Builder's record picker. `getRecentRecords(objectApiName)` — the running user's
recently viewed records (`LastViewedDate`, so genuinely "mine"), falling back to recently modified
so a fresh user is not handed an empty picker. `resolveRecordId(objectApiName, term)` — accepts an
Id or a human identifier; **Case numbers are stored zero-padded, so `12024` is also matched against
`%12024`**, and an Id belonging to another object is refused. `getPicklistValues(objectApiName,
fieldNames)` — active values for several fields at once, across all record types, so a row shown on
one record type can be coloured by a value only available on another; non-picklist fields are absent
from the result, which is how the builder knows to fall back to a text box. Object names are
whitelisted against the global describe before reaching the dynamic SOQL. 11 tests.
- **Two Apex gotchas this cost:** `like` is a reserved word, and `WITH SECURITY_ENFORCED` must sit
  **between** `WHERE` and `ORDER BY` or the parser throws `unexpected token: 'WITH'` at runtime only.

## Permission sets — created and assigned (2026-08-07)
Both live in **UAT and PROD**, committed under `force-app/main/default/permissionsets/`. Apex access
+ tab visibility only — **no object or field CRUD** — because agents already have Case/Contact/User
from their profile, and bundling data access into a component set turns it into a
privilege-escalation vector.

| Set | Apex Class Access | Tab `Section Config Builder` | Assign to |
|---|---|---|---|
| `ND_Dynamic_Section_User` | `ND_EmailResolver`, `ND_ProblemPicker` | Hidden | Everyone working Cases |
| `ND_Dynamic_Section_Config_Builder` | those two **+** `ND_SectionPreviewPicker` | Visible | The few who edit record pages — **assign alone** |

- **The Config Builder set is a SUPERSET, not an add-on, and there is deliberately no group.** The
  builder's live preview embeds the real `nD_DynamicSection`, so it calls `ND_EmailResolver` and
  `ND_ProblemPicker` too. Granting only `ND_SectionPreviewPicker` gives a preview whose people
  widgets show bare addresses and whose Problem picker finds nothing — looks like a bug, is a
  permissions gap. An earlier plan had two minimal sets plus a `ND_Dynamic_Section_Admin` group to
  bind them; that was dropped as dead weight, since permission sets union anyway and "either you can
  see them, or you can see them AND administer them" is the real shape. Cost: the two view classes
  are listed in both files, so a future class must be added to both.
- **Assignments as deployed:** PROD 27 view (12 `AVB_Service` · 13 `AVB_Sales` · 2 `AVB_Management`)
  + 4 builder (`AVB_System_Administrator`). UAT 11 view + 8 builder — UAT's admin list has drifted,
  see below. No user has both, by design.
- **`PermissionSetAssignment` is data, not metadata.** It does not travel in a deploy; each org needs
  its own `sf org assign permset` run. Nothing in git records who is assigned.
- **New joiners get nothing automatically.** A profile cannot have a permission set attached —
  `PermissionSetAssignment.AssigneeId` is a lookup to **User**, with no `ProfileId` field, so profiles
  and permission sets are parallel grant layers with no inheritance. Making it durable needs a
  record-triggered Flow on User (assign when Profile = one of the three) or the permissions moved onto
  the profiles themselves. **Neither is in place** — the current assignment is a one-time snapshot.
- **`description` on a PermissionSet maxes at 255 chars.** Over that, the deploy fails with
  `data value too large` and names no line number. The rationale belongs here, not in the metadata.
- **UAT admin drift:** UAT has 8 active `AVB_System_Administrator` users to PROD's 4, including
  `606059@` (inactive in PROD) and Jonas Lejeune / Justin Chng (Sales / Service in PROD). A stale
  `639537@aviobook.aero.old` duplicate was skipped. UAT is a smoke test of the mechanism, not a
  rehearsal of the rollout.
- **PROD's numeric usernames are people, not service accounts.** `157196 Roijens`, `25031 Franssens`,
  `639537 Schuurmans` are the live accounts; the matching `chris.roijens@` / `wouter.schuurmans@` /
  `tibo.vandenberg@` were deactivated in late 2025 under a username-convention change. Only Vandenberg
  has no active account.
- **Untested:** whether Salesforce rejects assigning a set to an *inactive* user. Both runs targeted
  active users only, so the platform was never asked.
- Skip: a read-only variant (no meaningful "view but not use" state), anything for
  `nD_sectionConfigSchema` (service module, no Apex, no UI), and View All / Modify All (every class is
  `with sharing` + `WITH SECURITY_ENFORCED` and runs as the user).
- **Failure mode worth knowing:** missing Apex access fails **silently** — no page error, only
  `console.warn`. And a **grey avatar can be a permissions symptom**: grey normally means "not in
  Salesforce" (correct for shared mailboxes), but a user lacking Contact/User read sees colleagues as
  grey too.
- **Prerequisite neither set grants:** pasting the config into App Builder needs **Customize
  Application** — deliberately not bundled, too broad.

## Case org facts (UAT and PROD share the same Ids)
- Record types: `AVB_Problem_Case` = `012KB000000kcw6YAA` · `AVB_AvioBook_Case` = `012KB000000kcw4YAA` · `AVB_AvioData_Case` = `012KB000000kcw5YAA`
- `Priority` picklist: Low, Normal, High, Urgent
- `AVB_Impact_Severity__c` picklist: Low, Normal, High, Significant
- `AVB_On_Hold_Resolution_Target_Date__c`: Date (label "Remind Me")
- `Slack_Thread__c`: Long Text Area (5000) — holds the `isUrlList` JSON
- Case Status: New, Open, Waiting for Customer, On Hold, Solved, **Closed** (closed), **Merged** (closed)
- Note: the standard field UI auto-linkifies URLs in text/long-text fields, so `isUrlList` JSON shows as raw JSON on standard layouts — only the LWC renders it as chips.

## Planned / next
- **⚠️ `nD_CaseAlert` — check `recordAlertBar` before building this.** The original plan (in this
  file unchanged since the first commit; **no code was ever written**) was: a full-width
  page-level banner in the record page's Header region, `anyOf` (OR) rules including
  `dateOnOrBefore: "today"`, fields via the `getRecord` wire, no Apex. Target rules: Priority in
  [High,Urgent] OR Impact Severity in [High,Significant] OR Remind Me on/before today.
  Two things have changed since it was written (both found 2026-08-25):
  - **A more complete feature already exists in the UAT org, and is not in this repo:**
    `recordAlertBar` ("polymorphic record alert bar placed under the highlights panel on any
    Lightning record page; stacks permanent/dismissible…"), plus `recordAlertBuilder` (visual
    composer with a config check and a live preview rendered by the real bar — the same
    architecture as `nD_SectionConfigBuilder`), `recordAlertSchema`, `recordAlertEditModal`,
    `recordAlertNewAction` (a headless Case quick action, "story #30") and `alertColorPicker`.
    All API **61**, backed by a custom object **`Record_Alert__c`** (7 rows in UAT). It is
    **already on `AVB_AvioBook_Case_Record_Page` in UAT** as the first component in the `main`
    region, above the path assistant. **Nothing of it is in PROD** — neither the components nor
    the object — and none of it is in this repo. Different admin model from the section
    (records, not App Builder JSON), so the two are not interchangeable; but building
    `nD_CaseAlert` from scratch would duplicate it. **Read its source before deciding.**
  - **The Header-region prerequisite is real and unmet.** All three desktop Case pages
    (`AVB_AvioBook`, `AVB_AvioData`, `AVB_Problem`) use
    `flexipage:recordHomeThreeColTemplateDesktop`, whose only regions are `leftsidebar`, `main`
    and `rightsidebar` — **there is no header region**. Only `AVB_Case_Record_Page_Mobile`
    (`recordHomeSimpleViewTemplate`) has one. Changing a live page's template migrates every
    component between regions, on three pages carrying 6–7 components per region. `recordAlertBar`
    sidesteps this by sitting at the top of `main` instead, which is centre-column width rather
    than full width. The four `ND_Case_page*` experiment pages all DO have a header region, three
    of them via custom templates (`ND_ThreeCol20_60_20`, `ND_PinnedLeftSidebar25_75`,
    `ND_StandardLeftSidebar25_75`) that are **not** FlexiPage records and are not in this repo.
  - The rule engine the plan needed now exists here: `nD_sectionConfigSchema` does AND/OR/custom
    logic and date comparison, so anything new should import `conditionsOf` / `holds` rather than
    growing its own copy.
- An `alert` entry type could also be added to `nD_DynamicSection` for an in-section banner (same
  rule format). **This is now the cheap option**: the condition engine is done, and it needs no
  template change and no new object — but it lives inside the card, not across the page.

## Status (as of 2026-09-04)
**Done 2026-09-04** — `nD_DynamicSection` exposed to **Experience Cloud** (Aura customer portal):
community targets + `recordId`/`objectApiName` properties, and the setup prompt suppressed inside a
site. Plus **three-column sections** (`colSpan` read as a span), for the portal card.
**455 Jest tests, all green** (32 new). eslint unchanged at its pre-existing errors — verified by
**stashing and re-linting**, which is the only way to say that honestly.

**Shipped:** branch `feat/experience-cloud-and-three-columns`, fast-forwarded into `main` at
`7ba94ed` and pushed. Deployed to **UAT** and **PROD** — LWC only, so no test level and 0 tests
run in either. UAT was confirmed by retrieving the meta back.

**Placed and working**: the card renders on a real Case in the AvioBook Customer Portal, on the
Case detail page, as a portal user.

**Next:** switch that instance to `columns: 3` and look at it. Then, before adding rows: the
portal config is the one thing NOT in version control, because ExperienceBundle Metadata API is
off for Aura sites in this org.

## Status (as of 2026-08-26)
**Done 2026-08-26** — `childRollup` rows (+ builder editor, `ND_ChildRollup`), the section
`alertTitle`, the dirty-on-load race, and `ND_Notify_New_Case` v6/v7 in PROD (see below).
**423 Jest tests, 36 Apex tests, all green.** eslint sits at 21 pre-existing errors — verified
by stashing and re-linting, so none of them are from this work.
**Known open:** the section can still come up dirty intermittently on the full 42-row Case
config even after the fix, so at least one more path is unaccounted for. It was reproduced and
fixed in isolation (three builder variants) but not eliminated on the record page.

## Status (as of 2026-08-25)
Working on `main`; `feat/section-config-editor` now points at the same commit, so the editor work is
in. Deployed to **UAT and PROD**.

PROD deploys: Apex + tests `0AfTX000001jUB30AM` · schema/builder/tab `0AfTX000001jUEH0A2` ·
`nD_DynamicSection` `0AfTX000001jUSn0AM` (08-06) → `0AfTX000001kCdV0AU` (08-15, owner filter) →
**`0AfTX000001lArN0AU` (08-25, all five LWC bundles)** · permission sets `0AfTX000001jajV0AQ`. UAT permission sets `0AfUB00000MrMdd0AF`. 27 Apex tests,
381 Jest tests, all green.

**Done since:** permission sets created and assigned in both orgs · PROD record pages repopulated ·
Confluence screenshots added and the Permissions page merged in · owner picker filtered to internal
users (both orgs).

**Done 2026-08-25** (branch `feat/conditions-dividers-and-canvas-fix`, merged to `main` and
pushed; deployed to **UAT and PROD** — PROD `0AfTX000001lArN0AU`, LWC only, 5 of 5 bundles,
0 component errors, 0 tests run):
- **Multi-condition logic** (AND / OR / custom expression + per-condition negate) on all four
  "when…" settings, plus **date comparison** on Date/DateTime fields — closing the
  `dateOnOrBefore` gap that had been open since the first CLAUDE.md.
- **`divider` entries** (`———— SLA ————`).
- **The App Builder drag crash** — the canvas renders read-only so no form-associated combobox
  is created.
- Two new service components: **`nD_conditionsEditor`**, **`nD_fieldCombobox`** (one search
  control replacing every combobox-plus-filter-box pair).
- **Eight bugs found reviewing the same day's work**, each with a regression test.
- Visual pass: inline-help ⓘ beside the label · record-link ↗ beside the label and no longer
  `scale(2)` · read-only values aligned with editable ones (checkboxes excluded) · SLDS's
  read-only underline off · row separators removed · row spacing halved · "take it!" on the
  Case Owner label line.
- **LWC only — no Apex was touched**, so a PROD deploy needs no test level.

**Open items:**
0. **Three known bugs, found in review and deliberately not yet fixed** (all UAT-only, none
   blocking): the record-link ↗ is clipped out of sight on a label that has inline help text AND
   a long caption (the floated label's `overflow: hidden`); the underline site's field picker
   offers "this row's own field" twice — it now carries the real apiName, so it collides with
   that field's own entry and LWC logs a duplicate-key error; and a read-only checkbox jumps
   ~11px on load, because `isCheckbox` needs the describe and is briefly false. Also parked: the
   ~2px residual between a read-only and an editable checkbox, and `hasRecordLink` is now dead.
1. UAT's 8 pages are committed under `force-app/main/default/flexipages/` and are fully migrated.
   PROD's are **not** in version control, though all 9 PROD instances were verified on 2026-08-07 to
   hold valid `{section, fields}` JSON, across `AVB_AvioBook_Case_Record_Page` (3),
   `AVB_AvioData_Case_Record_Page` (3), `AVB_Problem_Case_Record_Page` (1) and
   `AVB_Case_Record_Page_Mobile` (2).
2. Permission set assignment is a **one-time snapshot** — no Flow, no profile-level grant, so anyone
   added to `AVB_Service` / `AVB_Sales` / `AVB_Management` from now on gets nothing. See the
   permission sets section.
3. `npm install` is required before `npm test` or eslint. **`package-lock.json` is now committed**
   (2026-08-25), so versions are pinned. Installing it
   also activates husky's pre-commit hook, which fails on 8 pre-existing lint errors (the `ND_*`
   `@api` naming rule and four `setTimeout` calls), so commits here use `--no-verify`.

## Bugs that shipped once (2026-08-25 review)
All eight were found reviewing the same day's work, and all have regression tests. Two of them
are the same mistake in different clothes: **a rule that is correct on its own producing a wrong
result when combined with another rule that is also correct on its own.**
- **An empty value must not delete a key whose PRESENCE is the meaning.** `withKeySet` deletes
  on empty, and `divider` is the entry-type discriminator, so clearing a divider's caption in
  the builder turned the rule into a fieldless row — and made `{"divider": ""}` unreachable.
  `PRESENCE_KEYS` now exempts it.
- **A blank field means "not chosen yet" at EVERY site.** `conditionsOf` used to substitute the
  row's own field for a blank one on the underline site, so a freshly added condition (blank
  field + blank value = "any non-blank value") was complete and TRUE before anything had been
  chosen: clicking "add condition" underlined the row. Reading the legacy
  `colorIfValue`-with-no-`colorIfField` shape still fills the name in — that is the one place a
  blank really did mean the row's own field — but **writing** it no longer does, and the editor's
  "this row's own field" choice now carries the real apiName. Three separate places had to agree
  before it was actually fixed: the normaliser, the writer's `sayable`, and the component's
  opt-in (which counted unfinished conditions and so flipped the site to its "no conditions
  means always on" default).
- **`preventDefault` on a pick keeps focus, so `onfocus` alone cannot reopen a list.**
  `nD_fieldCombobox` also opens on mousedown.
- **The flat pair has nowhere to record OR**, so a single condition with OR is no longer
  flattened — it used to lose the OR silently and come back as AND on the next condition.
- Derived CSS must follow how a row RENDERS, not what the config asked for: the read-only
  underline offset read `item.editable` while the canvas forces read-only.
- A `badgeWhenFalsy` badge fires on entries that have no such key at all — every divider showed
  "read only". Dividers get their own badge and skip the field ones.
- A structured group with no `conditions` list was silently ignored; now reported.
- A capped list must not report the uncapped total ("127 fields" over 60 rows).

## Testing lessons
- **Three green unit tests can hide a broken feature.** "Add condition" did nothing while the
  editor's test asserted the event it fired, the writer's test asserted its drop-the-fieldless
  rule, and both were correct — the bug lived only in the round trip *between* them, where the
  rule deleted the very thing the event carried. Neither component was wrong on its own. Where
  a child edits state that a parent owns, the test that earns its keep goes **child → config →
  back to the child**, and there is now one of those for exactly this.
- **Verifying the reverse of an action is not verifying the action.** The same feature was
  driven in the org before shipping, but only *remove* was exercised, never *add* — and add was
  the broken half. Exercise the path that CREATES, not just the one that undoes.
- **Playwright over a `sf org open --url-only` front-door URL is the way to check any of this
  for real** (pierce `shadowRoot` recursively — this org runs native shadow DOM). Note it hits
  the cached-bundle trap too: a browser session that loaded a page BEFORE a deploy keeps serving
  the old modules, so a component added by that deploy appears simply absent. Clear storage and
  reload before concluding anything is wrong with the code.

## App Builder lessons
- **Dragging the component in App Builder killed the page** with `Cannot read properties of
  undefined (reading 'def')` (2026-08-25). Cause, measured rather than guessed: of **181 custom
  element types** on a Case record page, exactly **one** is form-associated —
  **`lightning-base-combobox`** — and this component rendered **six** of them (every editable
  picklist, the record-type picker, the owner picker). App Builder builds its drag ghost with
  jQuery `cloneNode`, cloning a form-associated custom element fires `formAssociatedCallback`,
  and LWC's handler dereferences a VM the clone does not have. On the pages checked, this
  component was the **only** source of them on the whole page, which is why it looks like our
  bug rather than the platform's. **Nothing in this repo caused it** — the picklists have been
  there for months; Salesforce made that primitive form-associated.
- **Fix: render read-only in the canvas** (`isDesignPreview` forces `editable: false`), so no
  combobox is created and there is nothing for the clone to choke on. Real data still shows,
  because the canvas is still a preview of a real record.
- **⚠️ App Builder DOES supply a recordId**, so `!this.recordId` is NOT a way to detect the
  canvas — verified in UAT, where it passed a real Case Id (`500UB00000WiFqXYAV`) and the live
  form rendered with real values. The signal used instead is the canvas iframe's own path,
  **`/flexipageEditor/surface.app`**. That is a platform detail, not an API: if Salesforce moves
  it this silently stops working and the crash returns. The failure mode is the old behaviour,
  not something worse.
- Verified after the fix: **0** form-associated elements in the entire canvas, down from 10, with
  22 output fields still showing real data.

## ✅ `ND_Notify_New_Case` — FIXED in PROD (2026-08-26). History below.

**PROD is on v7 and all four repo test classes pass (36 tests).** Apex CAN be deployed again.
Two changes got there, and the order matters:
- **v6** (routing): the `No_Contact` rule was DELETED and the **default outcome** pointed at
  `Get_New_Other`. That is what the subscriptions actually mean — KLM subs get KLM, SWA subs get
  SWA, Other subs get everything else INCLUDING no-contact. No earlier version had both: v3 had
  default→Other, v4/v5 traded it for No_Contact→Other. Measured cost of that trade: **46 of 53
  cases (87%)** created between 08-20 15:02 and the fix produced no notification at all.
- **v7** (safety): a **single shared fault path** from all three Send Custom Notification
  actions to one `Create_error` on `Error_Log__c`. `Missing required input parameter:
  recipientIds` IS catchable by a fault connector — established by experiment, not assumed:
  UAT v2 baseline passed (No_Contact ended the flow), UAT v3 with the routing change but no
  fault path failed exactly like PROD, UAT v4 with the fault path passed 4/4.
- **⚠️ v6 raised the stakes for v7.** Before it, 87% of cases hit default→END and could not
  fail; afterwards every case reaches a Send. So without the guard, the day the last "New
  Other" subscriber unticks their box, EVERY Case insert fails. PROD has 8 subscribers on that
  path (KLM 9, SWA 9), all active — UAT has **one**.
- **The fault handler must not itself fail**, or it re-raises and rolls the Case back anyway —
  same symptom, rarer trigger, much harder to diagnose. `Error_Log__c` was checked before being
  trusted: `Error_Description__c` is a 32,768-char textarea so fault messages fit, `More_info__c`
  is 255 and `v_ICAO` is short, `Name` is an auto-number so nothing required is unset.
- **A fault path is per ELEMENT, not flow-wide**, and governor limits bypass it entirely. Those
  three Sends are safe; `Get_notification`, the filters, loops and assignments are not.
- **UAT is now a copy of PROD v7.** They had diverged in notification CONTENT as well as
  routing (UAT said "NEW CASE" on all three; PROD says KLM / SWA / `v_ICAO`), so **never deploy
  the UAT flow file to PROD** — it would flatten PROD's better bodies.
- Loose end: `More_info__c = v_ICAO` reads "No contact" on almost every case that actually
  faults, because `AVB_ICAO_Account__c` resolves through Contact. `$Record.Account.AVB_ICAO__c`
  would name the airline instead.

### Why it failed (the original diagnosis, kept — the mechanism still applies)
`sf project deploy validate --target-org PROD` fails with **68 test errors and 0 component
errors**. None of them is this repo's code:
- **65 × `CANNOT_EXECUTE_FLOW_TRIGGER`** — the **`ND_Notify_New_Case`** Flow fails with *"Missing
  required input parameter: recipientIds"*, so **every test that inserts a Case fails**. That
  includes this repo's own `ND_ProblemPickerTest` and `ND_SectionPreviewPickerTest`, which are
  fine in UAT.
- 3 × a username validation rule (*"Please adjust the username to end with @aviobook.support."*).

**Consequence at the time: no Apex could be deployed to PROD until that Flow was fixed**, because an Apex
deployment must run tests — and both of this repo's Case-inserting test classes
(`ND_ProblemPickerTest`, `ND_SectionPreviewPickerTest`) are among the casualties, so even the
documented `--test-level RunSpecifiedTests` gate fails. LWC-only deployments are unaffected: they
require no tests, which is how the 08-25 release shipped (`deploy start`, 0 tests run).
**Do not read a failed `validate` as a problem with the change** — check `numberComponentErrors`
first (it was 0), and only then the test list. And **pass `--test-level` explicitly**: with none,
`validate` defaults to running every local test, which is not what the gate in this file
prescribes.

### Why `ND_Notify_New_Case` fails — it is a FLOW, not Apex
A record-triggered autolaunched Flow on **Case**, `RecordAfterSave` / **Create**, with **no entry
filters** — so it runs on every Case insert. It calls three **Send Custom Notification** actions,
each passing `recipientIds = v_Recipient`. That input is **required**, and an empty collection
trips *"Missing required input parameter: recipientIds"*.

`v_Recipient` is a String collection built by looping over `Custom_Configuration__c` records and
adding each `CreatedById`. **In an Apex test there is no org data** (no `SeeAllData`), so the 30
`Custom_Configuration__c` rows are invisible, the Collection Filter yields nothing, the loop never
runs, and `recipientIds` arrives empty → `CANNOT_EXECUTE_FLOW_TRIGGER` → the Case insert fails →
every test that inserts a Case fails. **Real traffic is fine** precisely because those 30 rows
exist.

**Why PROD and not UAT** — one routing change, PROD **v5** (activated 2026-08-20) vs UAT **v2**:

| `Who_created` outcome | UAT v2 | PROD v5 |
|---|---|---|
| `No_Contact` | **ends the flow** | → `Get_New_Other` |
| default | → `Get_New_Other` | **ends the flow** |

Tests insert Cases with **no ContactId**, so they match `No_Contact`. In UAT that path ends the
flow and the insert succeeds; in PROD v5 it now runs the notification with no recipients.

**Latent production risk, not just a test problem:** if that Collection Filter ever returns
nothing for a path — a config record deleted, or an ICAO with no matching configuration — Case
creation fails outright for the user. The robust fix is a decision guarding each Send Custom
Notification on `v_Recipient` not being empty; reverting the `No_Contact` / default swap only
hides it.

## Org-investigation lessons (2026-09-04) — how to find things out without a browser
Diagnosing the portal meant asking the org a lot of questions. These are the walls hit, so the
next session does not hit them again.
- **`sf org display --json` REDACTS `accessToken`** (`[REDACTED] Use 'sf org auth show-access-token'`).
  So the obvious way to build a `secur/frontdoor.jsp?sid=…` URL does not work. It matters because
  **a Lightning session cookie does NOT carry to `my.site.com`** — a Playwright session front-doored
  into LEX is bounced to the site's login page. Driving an Experience Cloud site therefore needs its
  own front door on the SITE domain (`/<prefix>/secur/frontdoor.jsp`), which needs that token.
  `sf org open --url-only --json` DOES return a usable front-door URL, but only for the Lightning
  domain.
- **Aura vs LWR in one command:** `sf org list metadata --metadata-type ExperienceBundle` vs
  `DigitalExperienceBundle`. A site in the FIRST and not the second is Aura. Faster and surer than
  reading templates.
- **`ExperienceBundle` retrieve fails on Aura sites** unless *Enable ExperienceBundle Metadata API*
  is on in Digital Experiences settings — and the error says exactly that, which is itself the
  cheapest Aura/LWR test. Consequence: the portal's page config **cannot be version-controlled or
  diffed** the way the 8 flexipages are.
- **SOQL shapes that do NOT exist**, each of which cost a round trip: `NetworkMemberGroup` has no
  `Parent` relationship and no `MemberType` (query `ParentId` and resolve it yourself); `User` has
  no `UserLicense` relationship; `SiteDetail` has no `Name` or `UrlPathPrefix` and **requires a
  filter on `DurableId`**. For portal URLs, query **`Domain`** instead.
- **`GROUP BY` aliases collide**: `SELECT Profile.Name, Profile.UserLicense.Name … GROUP BY` fails
  with `duplicate alias: Name`. Group by one at a time.
- **Which permission sets portal users actually have** is worth checking before designing any grant:
  `PermissionSetAssignment` filtered to `Assignee.UserType='CspLitePortal'` and
  `PermissionSet.IsOwnedByProfile=false`. Here it returned **2 assignments across 391 users** —
  everything comes from the profile, which is why the profile is the right place to grant Apex if it
  is ever needed.
- **Prove a lint claim by stashing.** `git stash && npx eslint <file> && git stash pop` is the only
  honest way to say "these errors are pre-existing" — the line numbers shift when you add code, so
  comparing counts by eye is not evidence.
- **`catch { }` (optional catch binding) avoids adding to the lint debt.** The repo's `no-unused-vars`
  errors include several `catch (e)` blocks; a new one does not have to join them.

## Deploy lessons that cost real time
- **A property tag cannot be removed while the component is on ANY Lightning page**, and clearing
  every value is *not* enough — the component must come off the pages entirely. Verified on both orgs.
  Sequence: migrate configs → deploy pages → strip the component → deploy → deploy the LWC → restore
  pages → deploy. Scripts: `scratchpad/migrate_flexipages.py`, `strip_flexipages.py`.
- **A property `default` never reaches instances already on a page**, only ones added afterwards.
- **Deploying Apex to PROD requires `--test-level`.** Omitting it fails with no component error and no
  message, which looks like a mystery. And deploying the classes folder while running only one test
  class fails the 75% gate — run **all three** test classes.
- **`ND_*` properties cannot be set from template attributes.** LWC cannot derive an attribute name
  with a leading capital, so `nd-json-config-string=` silently creates an expando and the child gets
  nothing. Assign them in JS. The giveaway is the child rendering its default value.
- **A wire keyed on a getter that builds a new array every evaluation loops**, re-rendering forever
  and wiping anything typed into a `value`-bound input.
- **LWC collapses whitespace between a text node and an element across a newline**, producing
  run-together words. Keep such sentences on one line.
- **Users keep running the OLD bundle after a deploy until they reload.** Lightning serves component
  modules from the browser's persistent cache for the life of a session, while the flexipage config
  is fetched fresh — so a shape change to the config breaks anyone with a tab open across the deploy,
  even though the org is fully migrated. This produced
  `[this.configObject.forEach is not a function]` in `get nd_wireFields` for a Sales user on
  2026-08-07: the LWC went to PROD at 13:33 UTC on 08-06, the four Case pages were rewritten to
  `{section, fields}` at 13:47–14:09, and their cached copy was the pre-`09f4167` component whose
  `configObject` was a bare `JSON.parse`. **Fix is a hard refresh**, not a redeploy. Deploying code
  before config is necessary but not sufficient — announce the refresh, or keep the reader
  backward-compatible for a release.
- **Diagnosing "is PROD actually running what I think?"** — retrieve into a throwaway DX project in
  the scratchpad (`sfdx-project.json` + an empty `force-app/`; `--output-dir` refuses paths outside
  the current project) and `diff` against the working tree. `sf project deploy report --job-id` gives
  the deploy time, and `SELECT DeveloperName, LastModifiedDate FROM FlexiPage` (tooling API,
  **no `LastModifiedBy` relation**) gives the config time — the two together settle code-vs-config
  ordering. A full `--metadata FlexiPage` retrieve takes over 120s, so background it.
- **Nothing clickable can be offered in the App Builder canvas** — it treats every component as a
  drag handle and swallows pointer events.
