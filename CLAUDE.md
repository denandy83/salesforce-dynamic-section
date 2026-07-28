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
  <jm@x.com>;`) works. The STORED value is parsed by splitting on `,;` and newlines only, keeping
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
- `requireBeforeTakeover` (on the `OwnerId` entry) — comma-separated api names that must have a
  value before **"take it!"** will run, e.g. `"Type,AVB_Environment__c"`. Reads the LIVE form value
  first, so an unsaved dropdown selection counts as set. When something is missing it shows the
  top-of-card banner ("Issue Type and Environment need to be set before taking a case") and does
  not touch the owner. **Why:** taking a case out of the Service Queue makes
  `AVB_Case_Flow_After_Update` set Status to Open (decision `Case_Accepted_Check`, prior owner
  queue `AVB_Service_Queue`), which starts the SLA and trips validation rules on the flow's own
  write. That failure names no field and, because `AVB_Solved_Requires_Environment` exempts
  `AVB_System_Administrator`, is invisible to admins.
- **"take it!" saves through the form**, not a bare `updateRecord`, so pending edits are committed
  in the SAME DML. Otherwise a just-picked Environment is not yet on the record when the flow flips
  Status to Open, and the save fails.
- Save shows a **"Saving…"** spinner; owner **"take it!"** hides when the running user already owns the case and shows **"taking…"** while in flight.
- **Constraint (field existence):** a config field that does not exist in the org is skipped with a
  console warning rather than breaking the component. `getRecord` fails the whole request on one
  bad field, which used to blank every custom widget (owner, problem, links) while the standard
  fields kept working.
- **Constraint:** all conditional logic is equality / membership / truthy only — **no comparison operators and no date logic** (e.g. "date on or before today" is NOT expressible in config yet).

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
