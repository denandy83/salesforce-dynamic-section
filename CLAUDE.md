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
Reads a JSON array from the `ND_jsonConfigString` App Builder property. Each entry is a field row.
Supported per-field keys:
- `apiName` (required), `label`, `editable`, `colSpan` (2 = full width)
- **Visibility:** `showIfField` + `showIfValue` (string equality; omit value = truthy check)
- **Color strip:** `color` + `colorIfField`/`colorIfValue` (comma-separated equality/membership) → red-ish left border on the row
- `isRecordLink` — value is a record Id; opens via `NavigationMixin` (corner open-window icon)
- `isUrl` — single link: empty = paste input, saved = clickable link + `×` to clear
- `isUrlList` — **multiple labeled links** stored as JSON `[{label,url}]` in a Long Text Area; add/edit via a pop-out modal (Label + URL fields), `×` to remove, click label to open. Backward-compatible: a legacy plain-URL value renders as one chip.
- `isOpenProblem` — Case lookup rendered as a **modal picker** (Case # / Subject / Status table) backed by `ND_ProblemPicker` Apex; removable filter chips (record type / open-only), search by number or subject; a linked value opens the case.
- Header alert (App Builder props, NOT the JSON): `ND_headerLogicField` + `ND_headerLogicValue` + `ND_headerActiveColor` (single field only).
- Save shows a **"Saving…"** spinner; owner **"take it!"** hides when the running user already owns the case and shows **"taking…"** while in flight.
- **Constraint:** all conditional logic is equality / membership / truthy only — **no comparison operators and no date logic** (e.g. "date on or before today" is NOT expressible in config yet).

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
