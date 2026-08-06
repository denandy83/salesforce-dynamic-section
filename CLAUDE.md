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
- **Two App Builder properties, in this order:** `ND_configBuilderUrl` (① a copyable box
  holding `/lightning/n/ND_Section_Config_Builder` — App Builder cannot render a clickable
  link, and the component reuses this value for the link in its unconfigured prompt) and
  `ND_jsonConfigString` (② the whole configuration). The ten old section properties were
  deleted on 2026-08-06 along with `ND_showConfigDiagnostics`. Config problems go to
  `console.warn` only; validation happens in the builder.
- **⚠️ Adding a property here is hard to undo.** The platform refuses to remove a property
  tag while the component is on any Lightning page — *"You can't remove the property tag
  named '…'. The component is in use on one or more Lightning pages"* — and **clearing every
  value is not enough**, the component has to come off the pages entirely. Removing the ten
  legacy properties took: migrate all 22 instances' configs → deploy pages → strip the
  component from all 8 pages → deploy → deploy the LWC → restore the pages from git →
  deploy. Originals are in commit `dcee5a9` and `~/Desktop/nd-flexipage-backup-*`.
- The **8 hosting pages** are committed under `force-app/main/default/flexipages/`, so the
  configs are now in version control rather than only in the org.
- **Linking to the builder — every App Builder surface was tried and only one works.**
  | Surface | Result |
  |---|---|
  | Custom Property Editor | **Impossible** — `configurationEditor` is Flow-only |
  | Property panel | Renders inputs only; no link is possible. A pre-filled box (`ND_configBuilderUrl`) is the best it can do |
  | App Builder canvas | **Swallows clicks** — every component is a drag handle, so a link there looks live and does nothing |
  | Real record page | **Works.** Gated on the `CustomizeApplication` user permission (`@salesforce/userPermission/CustomizeApplication`), so admins get a clickable link and agents see nothing |

  So: design time (`isDesignTime` = `!this.recordId`) gets **plain text** that says links do
  not work in the canvas; the real record page gets the clickable link for admins only. An
  empty config renders a fuller **setup prompt** instead of a blank card.
- **A property `default` does NOT reach instances already on a page** — only ones added
  afterwards. `ND_configBuilderUrl` had to be written into all 22 existing instances
  explicitly (`scratchpad/set_builder_url.py`).

Each `fields` entry is a field row.
Supported per-field keys:
- `apiName` (required), `label`, `editable`, `colSpan` (2 = full width)
- **Visibility:** `showIfField` + `showIfValue` (comma-separated **membership**; omit value = truthy
  check). Was exact equality until 2026-08-06 — the only condition that could not hold a list, so a
  row could be scoped to one record type but never two. A single value behaves identically.
- **Field alert:** `color` + `colorIfField`/`colorIfValue` (comma-separated equality/membership) → bottom underline on the field value/control
- `isRecordLink` — value is a record Id; opens via `NavigationMixin` (corner open-window icon)
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
- **"take it!" saves through the form**, not a bare `updateRecord`, so pending edits are committed
  in the SAME DML. Otherwise a just-picked Environment is not yet on the record when the flow flips
  Status to Open, and the save fails.
- Save shows a **"Saving…"** spinner; owner **"take it!"** hides when the running user already owns the case and shows **"taking…"** while in flight.
- **Constraint (field existence):** a config field that does not exist in the org is skipped with a
  console warning rather than breaking the component. `getRecord` fails the whole request on one
  bad field, which used to blank every custom widget (owner, problem, links) while the standard
  fields kept working.
- **Constraint:** all conditional logic is equality / membership / truthy only — **no comparison
  operators and no date logic** (e.g. "date on or before today" is NOT expressible in config yet).
  There is also **one condition per row** — a row has a single `showIfField`, so two conditions
  cannot be combined.
- **Every `…is one of` control is a multi-select in the builder** where the watched field has fixed
  values: record types (offered by name, Ids written) and picklists (via
  `ND_SectionPreviewPicker.getPicklistValues`). Anything else falls back to a comma-separated text
  box. Applies to `showIfValue`, `colorIfValue`, `requiredIfValue` and the section's `alertValue`.

### `lwc/nD_SectionConfigBuilder` (+ tab `ND_Section_Config_Builder`)
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
- 24 Jest tests in `__tests__/`. These are the project's **only** tests on the LWC side;
  `nD_DynamicSection` itself still has none. Run with `npm test` (needs `npm install` first —
  there is no lockfile).

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

### `classes/ND_ProblemPicker` (+ `ND_ProblemPickerTest`)
`getOpenProblems(searchTerm, recordTypeDeveloperName, excludedStatuses)` — dynamic SOQL over Case,
matches `Subject OR CaseNumber`, optional record-type (by **DeveloperName**) + status-exclude filters,
`ORDER BY CaseNumber DESC LIMIT 200`, `WITH SECURITY_ENFORCED`. Test class is self-contained (4 tests, ~100% of the class).

## Case org facts (UAT and PROD share the same Ids)
- Record types: `AVB_Problem_Case` = `012KB000000kcw6YAA` · `AVB_AvioBook_Case` = `012KB000000kcw4YAA` · `AVB_AvioData_Case` = `012KB000000kcw5YAA`
- `Priority` picklist: Low, Normal, High, Urgent
- `AVB_Impact_Severity__c` picklist: Low, Normal, High, Significant
- `AVB_On_Hold_Resolution_Target_Date__c`: Date (label "Remind Me")
- `Slack_Thread__c`: Long Text Area (5000) — holds the `isUrlList` JSON
- Case Status: New, Open, Waiting for Customer, On Hold, Solved, **Closed** (closed), **Merged** (closed)
- Note: the standard field UI auto-linkifies URLs in text/long-text fields, so `isUrlList` JSON shows as raw JSON on standard layouts — only the LWC renders it as chips.

## Planned / next
- **`nD_CaseAlert`** (NEW, separate LWC): full-width, page-level alert banner placed in the record page's full-width **Header region**. `anyOf` (OR) rules incl. a date operator (`dateOnOrBefore: "today"`), reads fields via the `getRecord` wire (no Apex). Requires a page template with a full-width Header region. Target rules: Priority in [High,Urgent] OR Impact Severity in [High,Significant] OR Remind Me on/before today.
- An `alert` entry type could also be added to `nD_DynamicSection` for an in-section banner (same rule format).

## Status (as of 2026-07-21)
Committed to `main` and deployed to **PROD**. Remaining on the admin side: update the Case page's
App Builder JSON config on PROD to use the new flags (`isOpenProblem` on `ParentId`, `isUrlList` on `Slack_Thread__c`).
