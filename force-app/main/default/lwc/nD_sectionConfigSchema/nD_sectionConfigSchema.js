/**
 * The single definition of what nD_DynamicSection's JSON config accepts.
 *
 * Why this exists as its own module: the config vocabulary grew to ~15 keys typed by
 * hand into one App Builder textarea. Nothing announced that a key existed and a
 * misspelling failed silently, which is how AVB_Environment__c ended up demanded on
 * AvioData cases. Keeping the keys, their help text and their validation in ONE place
 * means a new option cannot ship undocumented — the same entry that makes the key work
 * is the entry that describes it and the entry the validator checks against.
 *
 * A Custom Property Editor was the original plan for surfacing this. It is not
 * possible: the platform rejects `configurationEditor` on lightning__RecordPage
 * ("only supported for target(s) [lightning__FlowAction, lightning__FlowScreen]"), so
 * any visual editor has to live somewhere other than the App Builder property panel.
 * This module is deliberately free of component/DOM concerns so whatever gets built
 * can import it unchanged.
 */

// Field widgets are mutually exclusive: a row renders exactly one way. They live in
// one list rather than as independent booleans so "two widgets at once" is detectable
// instead of resolved by whichever check happens to run first.
const WIDGETS = [
    {
        key: null,
        title: 'Standard field',
        help: 'Rendered by lightning-input-field with no custom widget.'
    },
    {
        key: 'isRecordLink',
        title: 'Record link',
        badge: 'record link',
        help: 'Value is a record Id; adds a corner icon that opens the record.'
    },
    {
        key: 'isUrl',
        title: 'Single URL',
        badge: 'url',
        help: 'Empty shows a paste box; saved shows a clickable link with a clear button.'
    },
    {
        key: 'isUrlList',
        title: 'Labeled links',
        badge: 'labeled links',
        help: 'Multiple {label, url} pairs as chips. Needs a Long Text Area field.'
    },
    {
        key: 'isEmailList',
        title: 'People from emails',
        badge: 'people',
        help: 'Comma-separated addresses shown as avatars, resolved to Users and Contacts.'
    },
    {
        key: 'isOpenProblem',
        title: 'Problem case picker',
        badge: 'problem picker',
        help: 'Opens a searchable Case table filtered to open Problem records.'
    }
];

const WIDGET_KEYS = WIDGETS.map(w => w.key).filter(Boolean);

/**
 * The underline colour a row gets when it asks for one without naming a colour.
 *
 * Setting a condition is the decision; the colour is a detail, and having to pick one before
 * anything appeared meant a row could be configured to underline and then quietly not. The
 * same value is the fallback in `var(--nd-alert-color, …)` in nD_DynamicSection.css, so the
 * two agree even if the property never reaches the element.
 */
const DEFAULT_ALERT_COLOR = '#ba0517';

/* ---------------------------------------------------------------------------------
 * Section-level settings.
 *
 * These used to be separate App Builder properties. They now live inside the same JSON
 * as the field rows so the whole section is one artefact that the builder can compose,
 * validate and preview in one piece — and so App Builder needs exactly one field.
 * ------------------------------------------------------------------------------- */
/**
 * Column layout. `colSpan` has ALWAYS meant "how many of the section's columns this row
 * spans" — it was only ever written as "2 = full width" because every section was two
 * columns wide. Reading it as a span is what lets three columns arrive without migrating a
 * single live config: colSpan 2 keeps meaning full width in a two-column section and starts
 * meaning two thirds in a three-column one, and nothing changes until someone deliberately
 * sets columns to 3.
 *
 * Both the runtime and the builder go through here, so the SLDS class, the dropdown label
 * and the badge can never disagree about what a span means.
 */
const COLUMN_COUNTS = [1, 2, 3];

/** The section width, defaulted and clamped, so every caller reads the same number. */
function columnsOf(columns) {
    const n = Number(columns);
    return COLUMN_COUNTS.indexOf(n) > -1 ? n : 2;
}

/** A colSpan as a usable span: at least 1, never more than the section is wide. */
function spanOf(colSpan, columns) {
    const cols = columnsOf(columns);
    const raw = Number(colSpan);
    const span = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
    return Math.min(span, cols);
}

/**
 * The SLDS width class for a row. Clamps rather than trusting the number: a row left at
 * colSpan 3 after the section is switched back to two columns renders full width instead of
 * asking SLDS for a class that does not exist.
 */
function sizeClassFor(colSpan, columns) {
    const cols = columnsOf(columns);
    const span = spanOf(colSpan, cols);
    if (span >= cols) return 'slds-size_1-of-1';
    if (cols === 3) return span === 2 ? 'slds-size_2-of-3' : 'slds-size_1-of-3';
    return 'slds-size_1-of-2';
}

/** What a span is CALLED at this section width — one wording for the dropdown and the badge. */
function spanTitle(colSpan, columns) {
    const cols = columnsOf(columns);
    const span = spanOf(colSpan, cols);
    if (span >= cols) return 'Full width';
    if (cols === 3) return span === 2 ? 'Two thirds' : 'One third';
    return 'Half width';
}

/**
 * The Width dropdown's options for a section this wide.
 *
 * `current` is included even when it is not one of them, because a combobox holding a value
 * absent from its own options renders BLANK — the row would look as if it had no width set
 * while the JSON says otherwise. The date-operator combobox already cost this lesson once.
 */
function colSpanOptions(columns, current) {
    const cols = columnsOf(columns);
    const spans = cols === 3 ? [1, 2, 3] : [1, 2];
    const options = spans.map(span => ({
        // 1 is the default and is written as an absent key, like every other default here.
        value: span === 1 ? '' : span,
        title: spanTitle(span, cols)
    }));
    if (isBlank(current)) return options;
    const asNumber = Number(current);
    if (options.some(o => Number(o.value) === asNumber)) return options;
    return options.concat([{ value: asNumber, title: `${asNumber} columns (more than this section has)` }]);
}

const SECTION_KEYS = [
    {
        key: 'title',
        group: 'sectionBasics',
        label: 'Section title',
        control: 'text',
        fallback: 'Details',
        help: 'Heading shown at the top of the card.'
    },
    {
        key: 'icon',
        group: 'sectionBasics',
        label: 'Header icon',
        control: 'icon',
        fallback: 'utility:warning',
        help: 'Any SLDS icon name, e.g. utility:warning. Pick one below or type it.'
    },
    {
        key: 'columns',
        group: 'sectionBasics',
        label: 'Columns',
        control: 'select',
        fallback: 2,
        options: [
            { value: 2, title: 'Two columns' },
            { value: 1, title: 'One column' },
            { value: 3, title: 'Three columns' }
        ],
        help: 'One column forces every row full width. Three needs the room — it was added for a full-page-width portal card, not for a record page\u2019s centre column.'
    },
    {
        key: 'startCollapsed',
        group: 'sectionBasics',
        label: 'Start collapsed',
        control: 'check',
        fallback: false,
        title: 'Section starts collapsed',
        help: 'Users can still expand it.'
    },

    {
        key: 'headerColor',
        group: 'sectionHeader',
        label: 'Header background',
        control: 'color',
        fallback: '#005FB2',
        help: 'Normal header background colour.'
    },
    {
        key: 'headerTextColor',
        group: 'sectionHeader',
        label: 'Header text',
        control: 'color',
        fallback: '#FFFFFF',
        help: 'Normal header text colour.'
    },

    {
        key: 'alertIf',
        group: 'sectionAlert',
        label: 'Conditions',
        control: 'conditions',
        site: 'alertIf',
        help: 'Any number of fields, combined with AND, OR, or your own expression.'
    },
    {
        key: 'alertField',
        group: 'sectionAlert',
        label: 'Recolour the header when this field…',
        control: 'fieldPicker',
        blank: true,
        legacy: true,
        help: 'The single-condition form. Still read, and still written for one condition.'
    },
    {
        key: 'alertValue',
        group: 'sectionAlert',
        label: '…is one of',
        control: 'values',
        requires: 'alertField',
        valuesFrom: 'alertField',
        placeholder: 'High,Urgent',
        legacy: true,
        help: 'Comma-separated membership. Empty means any non-blank value.'
    },
    {
        key: 'alertTitle',
        group: 'sectionAlert',
        label: 'Alert title',
        control: 'text',
        requires: 'alertField',
        requiresSite: 'alertIf',
        placeholder: 'Same as the section title',
        help:
            'Header title while the condition holds. Falls back to the normal title, so leave '
            + 'it empty to recolour without renaming. Field interpolation works here too.'
    },
    {
        key: 'alertColor',
        group: 'sectionAlert',
        label: 'Alert background',
        control: 'color',
        requires: 'alertField',
        requiresSite: 'alertIf',
        help: 'Header background while the condition holds. Required for the alert to do anything.'
    },
    {
        key: 'alertTextColor',
        group: 'sectionAlert',
        label: 'Alert text',
        control: 'color',
        requires: 'alertField',
        requiresSite: 'alertIf',
        help: 'Header text while the condition holds. Falls back to the normal header text colour.'
    }
];

const SECTION_KEY_NAMES = SECTION_KEYS.map(d => d.key);

/**
 * Curated SLDS utility icons for the picker. Not exhaustive on purpose — any icon name
 * can still be typed, and the picker previews whatever is entered so a wrong name is
 * visible immediately rather than silently blank.
 */
const ICON_CHOICES = [
    'utility:warning', 'utility:error', 'utility:info', 'utility:info_alt', 'utility:announcement',
    'utility:cases', 'utility:case', 'utility:priority', 'utility:flag', 'utility:bug',
    'utility:clock', 'utility:date_input', 'utility:event', 'utility:hourglass', 'utility:reminder',
    'utility:user', 'utility:people', 'utility:groups', 'utility:adduser', 'utility:company',
    'utility:email', 'utility:chat', 'utility:comments', 'utility:call', 'utility:notification',
    'utility:link', 'utility:attach', 'utility:file', 'utility:knowledge_base', 'utility:description',
    'utility:settings', 'utility:setup', 'utility:builder', 'utility:apex', 'utility:flow',
    'utility:lock', 'utility:unlock', 'utility:shield', 'utility:key', 'utility:ban',
    'utility:check', 'utility:success', 'utility:approval', 'utility:task', 'utility:checkin',
    'utility:search', 'utility:filter', 'utility:sort', 'utility:list', 'utility:table',
    'utility:trending', 'utility:metrics', 'utility:dashboard', 'utility:chart', 'utility:report',
    'utility:world', 'utility:location', 'utility:home', 'utility:office365', 'utility:database',
    'standard:case', 'standard:account', 'standard:contact', 'standard:problem', 'standard:incident'
];

const GROUPS = [
    { id: 'sectionBasics', legend: 'Section', scope: 'section' },
    { id: 'sectionHeader', legend: 'Header colours', scope: 'section' },
    { id: 'sectionAlert', legend: 'Recolour the header when…', scope: 'section' },
    { id: 'field', legend: 'Field', scope: 'field' },
    { id: 'divider', legend: 'Divider', scope: 'field' },
    { id: 'rollup', legend: 'Child rollup', scope: 'field' },
    { id: 'visibility', legend: 'Show this row only when…', scope: 'field' },
    { id: 'widget', legend: 'Render as', scope: 'field' },
    { id: 'alert', legend: 'Underline the value when…', scope: 'field' },
    { id: 'takeover', legend: 'Require before "take it!"', scope: 'field' }
];

const SECTION_GROUPS = GROUPS.filter(g => g.scope === 'section');
const FIELD_GROUPS = GROUPS.filter(g => g.scope === 'field');

/**
 * Every supported key.
 *   key        - the JSON key an admin writes
 *   group      - which section of an editor it belongs to
 *   control    - how an editor should render it (fieldPicker|text|check|select|color|recordType)
 *   requires   - another key that must be set for this one to mean anything
 *   appliesWhen- predicate: this key only has an effect when it returns true
 *   badge      - short chip an editor/summary can show on the row
 *
 * `appliesWhen` is a function, which makes this registry code rather than data. That is
 * a deliberate trade-off for expressiveness; it would need rewriting as declarative
 * rules if the config ever moves to Custom Metadata.
 */
const CONFIG_KEYS = [
    {
        key: 'divider',
        group: 'divider',
        label: 'Divider caption',
        control: 'text',
        badge: 'divider',
        badgeClass: 'cond',
        placeholder: 'SLA',
        help: 'Leave it empty for a plain rule with no caption. The row is always full width.'
    },
    {
        key: 'childRollup',
        group: 'rollup',
        label: 'Child rollup',
        control: 'rollup',
        badge: 'rollup',
        badgeClass: 'cond',
        help:
            'Reads one field off every child record and joins the values into a single '
            + 'read-only row. Needs a child relationship name and a field on the child. '
            + 'Values are split on commas, de-duplicated and sorted.'
    },
    {
        key: 'apiName',
        group: 'field',
        label: 'Salesforce field',
        control: 'fieldPicker',
        required: true,
        // A rollup row reads from child records and has no field on THIS object, so an
        // editor must not offer it one. Keeps `label` and `colSpan` available from the
        // same group, which a rollup does use.
        appliesWhen: row => !isChildRollup(row),
        help: 'The API name of the field on this object.'
    },
    {
        key: 'label',
        group: 'field',
        label: 'Label shown to users',
        control: 'text',
        help: "Leave empty to use the org's field label."
    },
    {
        key: 'colSpan',
        group: 'field',
        label: 'Width',
        control: 'select',
        // The list depends on how wide the SECTION is, so the builder asks colSpanOptions()
        // rather than reading this. These stay as the two-column answer, which is both the
        // default and what every live config uses.
        options: [{ value: '', title: 'Half width' }, { value: 2, title: 'Full width' }],
        // Not a fixed badge: "full width" is a lie for colSpan 2 in a three-column section,
        // where it is two thirds. Same accuracy rule that gave dividers their own badge
        // instead of inheriting "read only".
        badgeFor: (value, ctx) => (isBlank(value) ? null : spanTitle(value, ctx && ctx.columns)),
        help: 'How many of the section\u2019s columns this row spans. 2 is full width in a two-column section and two thirds in a three-column one.'
    },
    {
        key: 'editable',
        group: 'field',
        label: 'Editing',
        control: 'check',
        title: 'Users can edit this field',
        badge: 'read only',
        badgeWhenFalsy: true,
        // Formula, rollup, autonumber and system fields report updateable:false on the
        // describe. Ticking this on one of them cannot work, so an editor should refuse
        // rather than imply the field became editable.
        requiresUpdateable: true,
        // A rollup is read-only by nature: it is derived from many child records, so there
        // is no single field behind it to save into.
        appliesWhen: row => !isChildRollup(row),
        help: 'Unchecked renders the value as read-only output.'
    },

    {
        key: 'showIf',
        group: 'visibility',
        label: 'Conditions',
        control: 'conditions',
        site: 'showIf',
        badge: 'conditional',
        badgeClass: 'cond',
        help: 'Any number of fields, combined with AND, OR, or your own expression.'
    },
    {
        key: 'showIfField',
        group: 'visibility',
        label: 'Watch this field',
        control: 'fieldPicker',
        blank: true,
        badge: 'conditional',
        badgeClass: 'cond',
        legacy: true,
        help: 'The single-condition form. Still read, and still written for one condition.'
    },
    {
        key: 'showIfValue',
        group: 'visibility',
        label: '…is one of',
        control: 'values',
        requires: 'showIfField',
        valuesFrom: 'showIfField',
        legacy: true,
        help: 'Comma-separated membership — KLM,SWA matches either. Empty means any non-blank value.'
    },

    {
        key: 'allowedDomains',
        group: 'widget',
        label: 'Only allow these email domains',
        control: 'text',
        nested: true,
        appliesWhen: row => row.isEmailList === true,
        help:
            'Comma-separated. Refused addresses stay in the input with a message naming them. ' +
            'Existing stored values are never removed by the rule.'
    },
    {
        key: 'placeholder',
        group: 'widget',
        label: 'Placeholder text',
        control: 'text',
        nested: true,
        appliesWhen: row => !!(row.isUrl || row.isUrlList || row.isEmailList || row.isOpenProblem),
        help: 'Shown in the empty input.'
    },

    {
        key: 'colorIf',
        group: 'alert',
        label: 'Conditions',
        control: 'conditions',
        site: 'colorIf',
        help: "Any number of fields. A condition with no field watches this row's own field."
    },
    {
        key: 'colorIfField',
        group: 'alert',
        label: 'Watch this field',
        control: 'fieldPicker',
        blank: true,
        legacy: true,
        help: "Empty watches this row's own field."
    },
    {
        key: 'colorIfValue',
        group: 'alert',
        label: '…is one of',
        control: 'values',
        legacy: true,
        valuesFrom: 'colorIfField',
        // colorIfField empty means "watch this row's own field", so the choices come from
        // the row's own apiName in that case.
        valuesFromSelf: true,
        placeholder: 'High,Urgent',
        help: 'Comma-separated membership.'
    },
    {
        key: 'color',
        group: 'alert',
        label: 'Underline colour',
        control: 'color',
        placeholder: DEFAULT_ALERT_COLOR,
        fallback: DEFAULT_ALERT_COLOR,
        badge: 'alert',
        help: `Leave it empty for ${DEFAULT_ALERT_COLOR}. Set it only to underline in something else.`
    },

    {
        key: 'requiredBeforeTakeover',
        group: 'takeover',
        label: 'Requirement',
        control: 'check',
        title: 'Block "take it!" while this field is empty',
        badge: 'take it! required',
        badgeClass: 'req',
        help:
            'Taking a case out of the Service Queue flips Status to Open, which starts the SLA and ' +
            "runs the org's validation rules. Blocking early gives a readable message instead of a " +
            'flow error that names no field.'
    },
    {
        key: 'requiredIf',
        group: 'takeover',
        label: 'Conditions',
        control: 'conditions',
        site: 'requiredIf',
        nested: true,
        appliesWhen: row => row.requiredBeforeTakeover === true,
        help: 'Leave empty to always require it. Any number of fields, with AND/OR/custom logic.'
    },
    {
        key: 'requiredIfField',
        group: 'takeover',
        label: 'Only require it when',
        control: 'fieldPicker',
        blank: true,
        nested: true,
        legacy: true,
        appliesWhen: row => row.requiredBeforeTakeover === true,
        help: 'The single-condition form. Still read, and still written for one condition.'
    },
    {
        key: 'requiredIfValue',
        group: 'takeover',
        label: '…is one of',
        control: 'values',
        nested: true,
        legacy: true,
        requires: 'requiredIfField',
        valuesFrom: 'requiredIfField',
        placeholder: 'Bug or Incident',
        appliesWhen: row => row.requiredBeforeTakeover === true,
        help: 'Comma-separated. Empty means "any non-blank value".'
    }
];

const KNOWN_KEYS = CONFIG_KEYS.map(d => d.key).concat(WIDGET_KEYS);

/**
 * A divider is a rule across the section — `———— SLA ————` — rather than a field.
 *
 * PRESENCE of the key is the discriminator, not its truthiness, so `{"divider": ""}` is a
 * deliberate unlabelled rule and not an unfinished one. Same reasoning as a condition's
 * value key: an empty string is a real state and has to be distinguishable from absent.
 */
function isDivider(row) {
    return !!row && Object.prototype.hasOwnProperty.call(row, 'divider');
}

/**
 * Whether a config row is a child rollup — one field read off every child record on the
 * other side of a child relationship, joined into one value.
 *
 * PRESENCE of the key is the discriminator, as with `divider`, and for the same reason: the
 * value is an options object, so "present but not yet filled in" is a real state that has to
 * survive a round trip through the config while it is being edited.
 *
 * A rollup row has NO apiName. Its value does not come from a field on this record, which is
 * exactly why it exists: a formula cannot reach child records (cross-object formulas only go
 * child → parent) and a roll-up summary only does COUNT / SUM / MIN / MAX, never text.
 */
function isChildRollup(row) {
    return !!row && Object.prototype.hasOwnProperty.call(row, 'childRollup');
}

/**
 * The only keys that do anything on a rollup row. Everything else is about a field on THIS
 * record, which a rollup does not have. Visibility is included for the same reason a divider
 * takes it: a rollup usually belongs with a group of rows that appear together.
 */
const ROLLUP_ALLOWED_KEYS = [
    'childRollup', 'label', 'colSpan', 'showIf', 'showIfField', 'showIfValue'
];

/** The rollup's options, with the defaults applied. Never returns null for a rollup row. */
function rollupOptions(row) {
    const raw = (isChildRollup(row) && row.childRollup) || {};
    return {
        relationship: isBlank(raw.relationship) ? '' : String(raw.relationship).trim(),
        field: isBlank(raw.field) ? '' : String(raw.field).trim(),
        // The child field already holds a comma-separated list in the case this was built for
        // (one Jira ticket can name four fix versions), so splitting is the default, not a
        // special case. An explicit empty string turns it off and treats the value as atomic.
        split: raw.split === undefined ? ',' : String(raw.split),
        exclude: isBlank(raw.exclude) ? '' : String(raw.exclude),
        separator: raw.separator === undefined ? ', ' : String(raw.separator)
    };
}

/**
 * The displayed value for a rollup row: every child's value, split, cleaned and joined.
 *
 * Pure, so the whole of the interesting behaviour is testable without an org. The Apex side
 * deliberately returns the raw strings and does none of this.
 *
 * - split      each child value on this delimiter (empty = do not split)
 * - exclude    comma-separated placeholder values to drop, matched case-insensitively.
 *              Jira carries "not_applicable" and "no" in this field, and they are noise here.
 * - dedupe     always on, case-insensitively, keeping the FIRST spelling seen. Two tickets
 *              naming the same version is the normal case, not an edge one.
 * - sort       always on, so the same case reads the same way twice regardless of the order
 *              the children came back in.
 */
function rollupValues(rawValues, options) {
    const opts = options || {};
    const split = opts.split === undefined ? ',' : String(opts.split);
    const excluded = splitCsv(opts.exclude).map(v => v.toLowerCase());

    const parts = [];
    (Array.isArray(rawValues) ? rawValues : []).forEach(raw => {
        if (isBlank(raw)) return;
        const pieces = split === '' ? [String(raw)] : String(raw).split(split);
        pieces.forEach(piece => {
            const value = piece.trim();
            if (!value) return;
            if (excluded.includes(value.toLowerCase())) return;
            parts.push(value);
        });
    });

    const seen = new Set();
    const unique = [];
    parts.forEach(value => {
        const key = value.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        unique.push(value);
    });

    return unique.sort((a, b) => a.localeCompare(b));
}

/** Which widget a row has chosen, or null for a plain field. */
function widgetOf(row) {
    return WIDGET_KEYS.find(k => row[k] === true) || null;
}

/** Blank-ish test used consistently for stored values and live form values. */
function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

/** The config's only multi-value idiom, split into its parts. */
function splitCsv(value) {
    if (value === undefined || value === null || value === '') return [];
    return String(value).split(',').map(v => v.trim()).filter(Boolean);
}

/** "A", "A or B", "A, B or C" — an English list, not a machine one. */
function joinOr(parts) {
    if (parts.length <= 1) return parts[0] || '';
    return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}

/**
 * Whether a config row is on screen.
 *
 * Pure so it can be tested: the component only supplies what it knows.
 *   fields               - describe map, to skip a field the org does not have
 *   savedFields          - getRecord's fields map
 *   liveValues           - on-screen values of watched fields, not yet saved
 *   selectedRecordTypeId - the record type currently picked in the form
 *
 * The live value wins over the saved one. Without that, switching record type left rows
 * scoped to the old one on screen until the save went through, so the section showed
 * fields that were about to disappear.
 */
function isRowVisible(item, context) {
    const ctx = context || {};
    if (item.apiName && ctx.fields && !ctx.fields[item.apiName]) return false;
    return holds(item, SITE_SHOW, ctx);
}

/* ---------------------------------------------------------------------------------
 * DATE COMPARISON
 *
 * The one thing conditions could never express: "Remind Me is on or before today". Every
 * other test here is equality, membership or truthiness, which cannot say "overdue".
 *
 * Two rules make the date handling correct rather than merely working:
 *
 * 1. A date-only value is NEVER put through `new Date(string)`. That parses "2026-09-01"
 *    as UTC midnight, so anyone west of UTC reads it as 31 August — the classic off-by-one.
 *    Date-only values are split on their digits and compared as calendar days.
 * 2. "Today" is the VIEWER's today, taken from their local calendar, not UTC. An overdue
 *    highlight that flips at midnight UTC is wrong for most of the world; for a Belgian
 *    user it would turn over at 01:00 or 02:00 local.
 *
 * A DateTime field is converted to the viewer's local calendar day first, so a case created
 * at 23:30 local counts as that day and not the next one.
 * ------------------------------------------------------------------------------- */

const DATE_OPS = [
    { value: 'before', label: 'is before', test: (a, b) => a < b },
    { value: 'onOrBefore', label: 'is on or before', test: (a, b) => a <= b },
    { value: 'on', label: 'is on', test: (a, b) => a === b },
    { value: 'onOrAfter', label: 'is on or after', test: (a, b) => a >= b },
    { value: 'after', label: 'is after', test: (a, b) => a > b }
];

const DATE_OP_KEYS = DATE_OPS.map(o => o.value);

/** Whole days since the epoch. Built through Date.UTC so DST cannot shift the count. */
function dayNumber(year, month, day) {
    return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

/** The viewer's own calendar day, which is what "today" has to mean. */
function localToday(now) {
    const at = now || new Date();
    return dayNumber(at.getFullYear(), at.getMonth() + 1, at.getDate());
}

/**
 * A field value as a calendar day, or null when there is nothing to compare.
 *
 * Date-only strings are read literally. Anything carrying a time is a DateTime, which is a
 * real instant, so it is converted to the viewer's local day.
 */
function fieldDay(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const text = String(raw).trim();

    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) {
        return dayNumber(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    }

    const at = new Date(text);
    if (isNaN(at.getTime())) return null;
    return dayNumber(at.getFullYear(), at.getMonth() + 1, at.getDate());
}

/**
 * What a condition is comparing against: `today`, `today+7`, `today-30`, or a literal
 * `YYYY-MM-DD`. Returns null when it cannot be read, which validation reports and the
 * runtime treats as "does not hold" rather than guessing.
 */
function operandDay(value, today) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text) return null;

    const relative = /^today\s*(?:([+-])\s*(\d+))?$/i.exec(text);
    if (relative) {
        const base = today === undefined ? localToday() : today;
        if (!relative[1]) return base;
        return relative[1] === '+' ? base + Number(relative[2]) : base - Number(relative[2]);
    }

    const literal = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (literal) {
        const month = Number(literal[2]);
        const day = Number(literal[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        const number = dayNumber(Number(literal[1]), month, day);
        // Rejects 2026-02-30 and friends: Date.UTC rolls them over, so a round trip that
        // does not come back the same day means the date never existed.
        const back = new Date(number * 86400000);
        if (back.getUTCMonth() + 1 !== month || back.getUTCDate() !== day) return null;
        return number;
    }

    return null;
}

function dateOpFor(key) {
    return DATE_OPS.find(o => o.value === key) || null;
}

/** How a date operand should be written, for help text and validation messages. */
const DATE_OPERAND_HINT = 'today, today+7, today-30, or a date like 2026-09-01';

/** Comma-separated membership, the config's only multi-value idiom. */
function matchesCsv(value, csv) {
    return String(csv)
        .split(',')
        .map(v => v.trim())
        .includes(String(value));
}

/* ---------------------------------------------------------------------------------
 * CONDITION GROUPS
 *
 * Four places in the config watch a field and act on what it holds. Each started as a
 * single field + value pair, which meant a row could be scoped to one record type but
 * never to "this record type AND this customer" — the commonest thing anyone actually
 * wanted. They now all take a LIST of conditions plus a logic mode, and they all go
 * through the one engine below, so the four cannot drift apart in behaviour.
 *
 * Both shapes are read, forever:
 *
 *   "showIfField": "RecordTypeId", "showIfValue": "012…"        one condition, flat
 *   "showIf": { "logic": "AND", "conditions": [ {…}, {…} ] }    any number
 *
 * The flat pair is not deprecated-and-tolerated, it is the canonical way to write a
 * single condition, and the serialiser still emits it for one. Two reasons: every live
 * config in the org is written that way and rewriting 22 of them buys nothing, and a
 * browser still running the PREVIOUS bundle (Lightning caches component modules for the
 * life of a session) goes on understanding it. Only a genuinely multi-condition row
 * needs the new shape, and only that row degrades on a stale bundle.
 * ------------------------------------------------------------------------------- */

const LOGIC_AND = 'AND';
const LOGIC_OR = 'OR';

/**
 * scope        - 'row' or 'section', i.e. which half of the document holds it
 * legacyField  - the single-field key this site grew out of
 * legacyValue  - its companion value key
 * selfField    - a blank field means "watch the row's own field" (colorIf only)
 * whenEmpty    - what NO conditions means. Three sites default to "yes" (an
 *                unconditional row is visible, an unconditional underline is always on,
 *                an unconditional requirement always applies); the header alert defaults
 *                to "no", because an alert with no condition is an alert that never fires.
 */
const CONDITION_SITES = [
    {
        key: 'showIf',
        scope: 'row',
        legacyField: 'showIfField',
        legacyValue: 'showIfValue',
        whenEmpty: true,
        legend: 'Show this row only when…'
    },
    {
        key: 'colorIf',
        scope: 'row',
        legacyField: 'colorIfField',
        legacyValue: 'colorIfValue',
        selfField: true,
        whenEmpty: true,
        legend: 'Underline the value when…'
    },
    {
        key: 'requiredIf',
        scope: 'row',
        legacyField: 'requiredIfField',
        legacyValue: 'requiredIfValue',
        whenEmpty: true,
        legend: 'Only require it when…'
    },
    {
        key: 'alertIf',
        scope: 'section',
        legacyField: 'alertField',
        legacyValue: 'alertValue',
        whenEmpty: false,
        legend: 'Recolour the header when…'
    }
];

const SITE_SHOW = CONDITION_SITES[0];
const SITE_COLOR = CONDITION_SITES[1];
const SITE_REQUIRED = CONDITION_SITES[2];
const SITE_ALERT = CONDITION_SITES[3];

const CONDITION_SITE_KEYS = CONDITION_SITES.map(s => s.key);

function siteByKey(key) {
    return CONDITION_SITES.find(s => s.key === key) || null;
}

/** The site a legacy single-field key belongs to, or null. Used by `requires` checks. */
function siteByLegacyField(key) {
    return CONDITION_SITES.find(s => s.legacyField === key) || null;
}

/**
 * The conditions a holder (row or section settings) declares for one site, in one
 * normalised shape: { logic, conditions: [{ field, value, negate }] }.
 *
 * `value` stays undefined for a truthy check, exactly as the flat `…Value` key did —
 * undefined and empty-string are NOT the same thing and never have been.
 */
function conditionsOf(holder, site, ownApiName) {
    const source = holder ? holder[site.key] : undefined;
    let logic = LOGIC_AND;
    let list = [];

    if (Array.isArray(source)) {
        list = source;
    } else if (source && typeof source === 'object') {
        list = Array.isArray(source.conditions) ? source.conditions : [];
        if (!isBlank(source.logic)) logic = String(source.logic).trim();
    } else if (holder && !isBlank(holder[site.legacyField])) {
        list = [{ field: holder[site.legacyField], value: holder[site.legacyValue] }];
    } else if (holder && site.selfField && holder[site.legacyValue] !== undefined) {
        // colorIfValue with no colorIfField has always meant "watch this row's own field"
        list = [{ field: ownApiName, value: holder[site.legacyValue] }];
    }

    const conditions = list
        .filter(c => c && typeof c === 'object')
        .map(c => {
            // No substitution here on purpose. A blank field means "not chosen yet" at EVERY
            // site, so a freshly added condition is ignored until it is finished. The one
            // place a blank field genuinely means "this row's own field" is the legacy
            // `colorIfValue`-with-no-`colorIfField` shape, and that branch above fills the
            // name in explicitly. Substituting here as well made clicking "add condition"
            // under the underline site instantly underline the row: blank became the row's
            // own field, and a blank value means "any non-blank value", so the condition was
            // complete and true before anything had been chosen.
            const out = { field: c.field, negate: c.negate === true };
            if (c.value !== undefined) out.value = c.value;
            if (!isBlank(c.op)) out.op = String(c.op);
            return out;
        });

    return { logic: logic, conditions: conditions };
}

/** Every field any site watches, so the caller knows what to load and what to track. */
function watchedFieldsOf(rows, section) {
    const out = [];
    const add = f => { if (!isBlank(f) && !out.includes(f)) out.push(f); };

    (rows || []).forEach(row => {
        CONDITION_SITES
            .filter(site => site.scope === 'row')
            .forEach(site => conditionsOf(row, site, row.apiName).conditions.forEach(c => add(c.field)));
    });

    conditionsOf(section || {}, SITE_ALERT).conditions.forEach(c => add(c.field));
    return out;
}

/**
 * Reads a watched field the way the form does: the value on screen beats the saved one,
 * so picking a different Record Type hides rows scoped to the old one straight away
 * rather than after the save. `known` is false only when the field was never loaded —
 * a loaded-but-empty field is known, with a null value, which is what lets "is not KLM"
 * be true for a blank ICAO.
 */
function valueResolver(context) {
    const ctx = context || {};
    const saved = ctx.savedFields || {};
    const live = ctx.liveValues || {};

    return field => {
        if (isBlank(field)) return { known: false };
        if (field === 'RecordTypeId' && ctx.selectedRecordTypeId) {
            return { known: true, value: ctx.selectedRecordTypeId };
        }
        if (Object.prototype.hasOwnProperty.call(live, field)) {
            return { known: true, value: live[field] };
        }
        if (saved[field]) return { known: true, value: saved[field].value };
        return { known: false };
    };
}

/**
 * One condition. A field nobody loaded is false BEFORE `negate` is applied: "is not
 * KLM" should not become true just because we never asked for the field.
 */
function matchesCondition(condition, resolve, today) {
    const found = resolve(condition.field);
    if (!found.known) return false;

    const dateOp = dateOpFor(condition.op);
    if (dateOp) {
        const left = fieldDay(found.value);
        const right = operandDay(condition.value, today);
        // An empty date, or an operand nobody can read, is not a comparison anyone can make.
        // False rather than a guess, and validateConfig says so out loud.
        const hit = left !== null && right !== null && dateOp.test(left, right);
        return condition.negate ? !hit : hit;
    }

    // A BLANK value means "any non-blank value", which is what the registry has always said
    // the `…Value` keys mean — but the code used to read it as membership of the empty
    // string, i.e. a condition that could essentially never hold. Absent and blank now agree,
    // so clearing the box in an editor means the same thing as never filling it in.
    const hit = isBlank(condition.value)
        ? !!found.value
        : matchesCsv(found.value, condition.value);

    return condition.negate ? !hit : hit;
}

/**
 * Does a normalised group hold? `logic` is AND, OR, or an expression in the org's own
 * filter-logic syntax — condition numbers, AND, OR, NOT and parentheses, e.g.
 * "(1 AND 2) OR 3".
 *
 * Unparseable logic falls back to AND rather than to "true": a typo in an expression
 * should not silently reveal every row it guards. validateConfig is what reports it.
 */
function evaluateConditions(group, resolve, whenEmpty, today) {
    // A condition that names no field is UNFINISHED, not false. It has to be storable — an
    // editor adds one the moment you click "add", before you have chosen anything — and an
    // empty `showIfField` has always meant "no condition" rather than "never matches", so
    // the two shapes have to agree or the same config means different things depending on
    // which one it happens to be written in. validateConfig is what reports it.
    const written = (group && group.conditions) || [];
    const usable = written.filter(c => c && !isBlank(c.field));
    if (!usable.length) return whenEmpty !== false;

    const logic = String((group && group.logic) || LOGIC_AND).trim();
    const upper = logic.toUpperCase();

    if (!logic || upper === LOGIC_AND) return usable.every(c => matchesCondition(c, resolve, today));
    if (upper === LOGIC_OR) return usable.some(c => matchesCondition(c, resolve, today));

    // Custom logic numbers the conditions AS WRITTEN, so the results array has to stay
    // aligned with that list — dropping the unfinished ones from it would silently
    // renumber the expression, and "1 AND 3" would come to mean other conditions than the
    // author picked. An unfinished one counts as true instead, which is neutral under AND.
    const results = written.map(
        c => (c && !isBlank(c.field) ? matchesCondition(c, resolve, today) : true)
    );
    const parsed = parseLogic(logic, results.length);
    if (parsed.error) return usable.every(c => matchesCondition(c, resolve, today));
    return evaluateLogic(parsed.ast, results);
}

/** Site + holder + context in one call, which is all any caller actually wants. */
function holds(holder, site, context, ownApiName) {
    const group = conditionsOf(holder, site, ownApiName !== undefined ? ownApiName : (holder || {}).apiName);
    // context.today lets a caller pin the day — a test, mostly. Left out, it is the viewer's
    // own calendar day, which is the only reading of "today" that is not surprising.
    const today = context && context.today !== undefined ? context.today : localToday();
    return evaluateConditions(group, valueResolver(context), site.whenEmpty, today);
}

/* --- Custom filter logic -------------------------------------------------------
 * A tiny recursive-descent parser, NOT `eval` or `new Function`: this string comes out
 * of a config an admin typed, so it must never be executed. It also has to be able to
 * say WHY it is wrong, which a thrown SyntaxError cannot.
 *
 *   or   := and (OR and)*
 *   and  := not (AND not)*
 *   not  := NOT not | atom
 *   atom := NUMBER | '(' or ')'
 */
function tokenizeLogic(expr) {
    const tokens = [];
    const text = String(expr);
    let i = 0;

    while (i < text.length) {
        const ch = text[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === '(' || ch === ')') { tokens.push({ t: ch }); i++; continue; }

        const rest = text.slice(i);
        const num = /^\d+/.exec(rest);
        if (num) { tokens.push({ t: 'num', n: parseInt(num[0], 10) }); i += num[0].length; continue; }

        const word = /^(AND|OR|NOT)\b/i.exec(rest);
        if (word) { tokens.push({ t: word[1].toUpperCase() }); i += word[1].length; continue; }

        // && and || are what people reach for out of habit; accept them rather than
        // failing on a difference that carries no meaning.
        if (rest.startsWith('&&')) { tokens.push({ t: 'AND' }); i += 2; continue; }
        if (rest.startsWith('||')) { tokens.push({ t: 'OR' }); i += 2; continue; }

        return { error: `Cannot read "${ch}" in the logic.` };
    }

    return { tokens: tokens };
}

function parseLogic(expr, count) {
    if (isBlank(expr)) return { error: 'The logic is empty.' };

    const lexed = tokenizeLogic(expr);
    if (lexed.error) return lexed;

    const tokens = lexed.tokens;
    if (!tokens.length) return { error: 'The logic is empty.' };

    let pos = 0;
    let failure = null;
    const fail = message => { if (!failure) failure = message; return { t: 'num', n: 1 }; };
    const peek = () => tokens[pos];

    function parseOr() {
        let node = parseAnd();
        while (peek() && peek().t === LOGIC_OR) { pos++; node = { t: 'or', a: node, b: parseAnd() }; }
        return node;
    }

    function parseAnd() {
        let node = parseNot();
        while (peek() && peek().t === LOGIC_AND) { pos++; node = { t: 'and', a: node, b: parseNot() }; }
        return node;
    }

    function parseNot() {
        if (peek() && peek().t === 'NOT') { pos++; return { t: 'not', a: parseNot() }; }
        return parseAtom();
    }

    function parseAtom() {
        const token = peek();
        if (!token) return fail('The logic ends too early — something is missing after the last operator.');

        if (token.t === 'num') {
            pos++;
            if (token.n < 1 || token.n > count) {
                return fail(
                    `The logic mentions condition ${token.n}, but there ${count === 1 ? 'is' : 'are'} `
                    + `only ${count}.`
                );
            }
            return { t: 'num', n: token.n };
        }

        if (token.t === '(') {
            pos++;
            const inner = parseOr();
            if (!peek() || peek().t !== ')') return fail('A "(" is never closed.');
            pos++;
            return inner;
        }

        if (token.t === LOGIC_AND || token.t === LOGIC_OR) {
            return fail(`The logic starts an expression with "${token.t}".`);
        }
        return fail('Unexpected ")" in the logic.');
    }

    const ast = parseOr();
    if (failure) return { error: failure };
    if (pos !== tokens.length) return { error: 'There is leftover text after the end of the logic.' };
    return { ast: ast };
}

function evaluateLogic(node, results) {
    switch (node.t) {
        case 'num': return !!results[node.n - 1];
        case 'not': return !evaluateLogic(node.a, results);
        case 'and': return evaluateLogic(node.a, results) && evaluateLogic(node.b, results);
        case 'or': return evaluateLogic(node.a, results) || evaluateLogic(node.b, results);
        default: return false;
    }
}

/** Which condition numbers an expression actually uses, so unused ones can be flagged. */
function logicReferences(ast, into) {
    const seen = into || new Set();
    if (!ast) return seen;
    if (ast.t === 'num') seen.add(ast.n);
    if (ast.a) logicReferences(ast.a, seen);
    if (ast.b) logicReferences(ast.b, seen);
    return seen;
}

/** One condition as a sentence, for diagnostics and the take-it explanation. */
function describeCondition(condition, labelOf) {
    const label = labelOf ? labelOf(condition.field) : condition.field;

    const dateOp = dateOpFor(condition.op);
    if (dateOp) {
        const phrase = `${label} ${dateOp.label} ${String(condition.value || '').trim()}`;
        return condition.negate ? `NOT (${phrase})` : phrase;
    }

    if (condition.value === undefined) {
        return condition.negate ? `${label} is empty` : `${label} is set`;
    }
    const values = splitCsv(condition.value);
    return `${label} is ${condition.negate ? 'not ' : ''}${joinOr(values)}`;
}

/** A whole group as a sentence. Custom logic is quoted rather than prosified. */
function describeConditions(group, labelOf) {
    const conditions = (group && group.conditions) || [];
    if (!conditions.length) return '';

    const parts = conditions.map(c => describeCondition(c, labelOf));
    const logic = String((group && group.logic) || LOGIC_AND).trim().toUpperCase();

    if (conditions.length === 1) return parts[0];
    if (logic === LOGIC_AND) return parts.join(' and ');
    if (logic === LOGIC_OR) return parts.join(' or ');
    return `${group.logic} of [${parts.join('; ')}]`;
}

/** True when a `requires` on a flat key is instead satisfied by its condition site. */
function satisfiedBySite(holder, def) {
    const site = def.requiresSite ? siteByKey(def.requiresSite) : siteByLegacyField(def.requires);
    if (!site) return false;
    return conditionsOf(holder, site, (holder || {}).apiName).conditions.length > 0;
}

/**
 * Everything that can be wrong with one site's conditions. Shared by rows and the
 * section so the four sites report identically — the whole point of routing them all
 * through one engine is that a message written once covers all of them.
 */
function conditionFindings(holder, site, context, ownApiName) {
    const ctx = context || {};
    const out = [];
    const add = (level, message) => out.push({ level: level, message: message, key: site.key });

    const declared = holder ? holder[site.key] : undefined;
    if (declared !== undefined && !Array.isArray(declared) && (declared === null || typeof declared !== 'object')) {
        add('error', `"${site.key}" must be a list of conditions or an object with a "conditions" list.`);
        return out;
    }

    // Both shapes at once is not an error the engine cannot survive — the structured one
    // wins — but it is certainly not what anyone meant.
    if (declared !== undefined && holder && !isBlank(holder[site.legacyField])) {
        add(
            'warning',
            `Both "${site.key}" and the older "${site.legacyField}" are set. `
            + `"${site.key}" wins and "${site.legacyField}" is ignored.`
        );
    }

    // An object with no usable `conditions` list is almost certainly a mistyped group, and
    // silently behaves as though the site were never configured.
    if (declared !== undefined && !Array.isArray(declared) && declared
        && !Array.isArray(declared.conditions)) {
        add('error', `"${site.key}" has no "conditions" list, so nothing is checked.`);
        return out;
    }

    const group = conditionsOf(holder, site, ownApiName);
    if (!group.conditions.length) return out;

    group.conditions.forEach((condition, i) => {
        // Numbering only earns its keep once there is more than one to tell apart, and
        // the flat single-condition form is still much the commonest shape.
        const at = group.conditions.length > 1
            ? `Condition ${i + 1} of "${site.legend}"`
            : `"${site.legend}"`;

        if (isBlank(condition.field)) {
            add('error', `${at} watches no field.`);
            return;
        }
        if (ctx.fields && !ctx.fields[condition.field]) {
            add('error', `${at} watches ${condition.field}, which does not exist on this object.`);
            return;
        }
        // Date comparison is the one test that can be MALFORMED rather than merely wrong:
        // an operator nobody defined, or an operand nobody can parse, silently never holds.
        if (!isBlank(condition.op)) {
            if (!DATE_OP_KEYS.includes(condition.op)) {
                add('error', `${at} uses an unknown operator "${condition.op}".`);
                return;
            }
            if (operandDay(condition.value) === null) {
                add(
                    'error',
                    `${at} compares against "${String(condition.value || '').trim()}", which is `
                    + `not a date. Write ${DATE_OPERAND_HINT}.`
                );
                return;
            }
            const described = ctx.fields ? ctx.fields[condition.field] : null;
            const type = described && described.dataType ? String(described.dataType).toLowerCase() : null;
            if (type && type !== 'date' && type !== 'datetime') {
                add(
                    'warning',
                    `${at} compares ${condition.field} as a date, but it is a ${described.dataType} `
                    + `field, so the comparison will never hold.`
                );
            }
            return;
        }

        // "is one of" with nothing listed reads as a real restriction in an editor while
        // matching any populated value at runtime — worth saying out loud rather than
        // leaving as a rule that quietly does nothing.
        if (condition.value !== undefined && isBlank(condition.value)) {
            add(
                'warning',
                `${at} lists no values, so any value counts. `
                + `List some, or set it to "has any value" to say so plainly.`
            );
        }

        // Membership against record type Ids is the one value list whose contents can be
        // checked, and a stale Id is invisible otherwise: the row simply never shows.
        if (condition.field === 'RecordTypeId' && condition.value !== undefined && ctx.recordTypes) {
            const unknown = splitCsv(condition.value).filter(id => !ctx.recordTypes[id]);
            if (unknown.length) {
                add(
                    'warning',
                    `${at} names record type ${unknown.length > 1 ? 'Ids' : 'Id'} ${unknown.join(', ')}, `
                    + `which ${unknown.length > 1 ? 'are' : 'is'} not in this org.`
                );
            }
        }
    });

    const logic = String(group.logic || LOGIC_AND).trim();
    const upper = logic.toUpperCase();
    if (upper === LOGIC_AND || upper === LOGIC_OR) return out;

    const parsed = parseLogic(logic, group.conditions.length);
    if (parsed.error) {
        // Worth being loud: the runtime falls back to AND, so a broken expression looks
        // like it works until the day the two disagree.
        add('error', `The logic "${logic}" cannot be read — ${parsed.error} Until it is fixed, all conditions must hold (AND).`);
        return out;
    }

    const used = logicReferences(parsed.ast);
    const unused = group.conditions.map((c, i) => i + 1).filter(n => !used.has(n));
    if (unused.length) {
        add(
            'warning',
            `The logic "${logic}" never mentions condition ${unused.join(', ')}, so `
            + `${unused.length > 1 ? 'they have' : 'it has'} no effect.`
        );
    }

    return out;
}

/**
 * Problems with a config array. Pure: pass what's known about the org rather than
 * reaching for a wire, so an editor and the runtime component get identical answers.
 *
 * context.fields      - map of apiName -> anything, from getObjectInfo().fields
 * context.recordTypes - map of recordTypeId -> name
 */
function validateConfig(config, context) {
    const ctx = context || {};
    const findings = [];

    if (!Array.isArray(config)) {
        return [{ row: -1, level: 'error', message: 'Config is not a JSON array.' }];
    }

    const columns = columnsOf(ctx.columns);

    config.forEach((row, index) => {
        const name = row.label || row.apiName || `row ${index + 1}`;
        const push = (level, message, key) => findings.push({ row: index, name, level, message, key });

        // Renders full width rather than breaking, so this is a warning — but it is worth
        // saying, because the row is not doing what the number asks and nothing on screen
        // says so.
        if (!isBlank(row.colSpan)) {
            const asked = Number(row.colSpan);
            if (!Number.isFinite(asked) || asked < 1) {
                push('error', `"colSpan" must be a whole number of columns, not "${row.colSpan}".`, 'colSpan');
            } else if (asked > columns) {
                push('warning',
                    `"colSpan" of ${asked} is wider than the section's ${columns} column${columns === 1 ? '' : 's'}, so this row renders full width.`,
                    'colSpan');
            }
        }

        if (isDivider(row)) {
            // A divider draws a rule; anything about a field is meaningless on it. Visibility
            // is the exception and is checked below like any other row's.
            Object.keys(row).forEach(key => {
                if (['divider', 'showIf', 'showIfField', 'showIfValue'].includes(key)) return;
                push('warning', `"${key}" has no effect on a divider.`, key);
            });
        } else if (isChildRollup(row)) {
            // A rollup reads from child records, so it has no apiName on this object and
            // nothing about a field on this record applies to it. Visibility and width do.
            const opts = rollupOptions(row);
            if (!opts.relationship) {
                push('error', 'Child rollup has no "relationship" — nothing to read from.', 'childRollup');
            }
            if (!opts.field) {
                push('error', 'Child rollup has no "field" — nothing to read.', 'childRollup');
            }
            Object.keys(row).forEach(key => {
                if (ROLLUP_ALLOWED_KEYS.includes(key)) return;
                push('warning', `"${key}" has no effect on a child rollup.`, key);
            });
        } else if (isBlank(row.apiName)) {
            push('error', 'No apiName — the row has no field to render.', 'apiName');
        } else if (ctx.fields && !ctx.fields[row.apiName]) {
            push('error', `Field ${row.apiName} does not exist on this object, so the row is skipped.`, 'apiName');
        }

        Object.keys(row).forEach(key => {
            if (KNOWN_KEYS.includes(key)) return;
            if (isDivider(row)) return;   // already reported as having no effect
            const suggestion = suggestKey(key);
            push(
                'error',
                `Unknown key "${key}"${suggestion ? `. Did you mean "${suggestion}"?` : '.'}`,
                key
            );
        });

        const widgetsOn = isDivider(row) ? [] : WIDGET_KEYS.filter(k => row[k] === true);
        if (widgetsOn.length > 1) {
            push('error', `Two widgets enabled at once: ${widgetsOn.join(' + ')}.`, widgetsOn[1]);
        }

        CONFIG_KEYS.forEach(def => {
            const present = row[def.key] !== undefined;
            if (!present) return;
            if (isDivider(row) && def.key !== 'divider') return;
            // Already reported by the ROLLUP_ALLOWED_KEYS sweep above; without this the
            // new appliesWhen predicates would warn about the same key a second time.
            if (isChildRollup(row) && !ROLLUP_ALLOWED_KEYS.includes(def.key)) return;
            if (def.requires && isBlank(row[def.requires]) && !satisfiedBySite(row, def)) {
                push('error', `"${def.key}" is set but "${def.requires}" is not.`, def.key);
            }
            if (def.appliesWhen && !def.appliesWhen(row)) {
                push('warning', `"${def.key}" has no effect with this row's current settings.`, def.key);
            }
        });

        CONDITION_SITES
            .filter(site => site.scope === 'row')
            .forEach(site => {
                conditionFindings(row, site, ctx, row.apiName).forEach(f => push(f.level, f.message, f.key));
            });

        // A formula or system field cannot be edited whatever the config says, so
        // "editable" on one is a promise the page cannot keep.
        const described = ctx.fields && row.apiName ? ctx.fields[row.apiName] : null;
        if (row.editable === true && described && described.updateable === false) {
            push(
                'warning',
                `${row.apiName} is not updateable in this org`
                + `${described.calculated ? ' (it is a formula field)' : ''}`
                + ', so it will render read-only whatever "editable" says.',
                'editable'
            );
        }
    });

    return findings;
}

/** Levenshtein distance, iterative with two rows so long key lists stay cheap. */
function editDistance(a, b) {
    const n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    let curr = new Array(n + 1);

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        const swap = prev;
        prev = curr;
        curr = swap;
    }
    return prev[n];
}

/**
 * Nearest known key, or null when nothing is close enough to be worth suggesting.
 * Prefix matching was not enough here: the realistic typo is a dropped letter in the
 * middle ("requiredBeforeTakover"), which shares no usable prefix with the real key.
 * The budget scales with length so short keys need a near-exact match while long ones
 * tolerate a missing character.
 */
function suggestKey(typo) {
    const lower = String(typo).toLowerCase();
    const budget = Math.max(1, Math.floor(lower.length / 6));

    let best = null;
    let bestDistance = Infinity;
    KNOWN_KEYS.forEach(known => {
        const distance = editDistance(lower, known.toLowerCase());
        if (distance < bestDistance) {
            bestDistance = distance;
            best = known;
        }
    });

    return bestDistance <= budget ? best : null;
}

/**
 * The "take it!" requirement in plain English, so config can be reviewed without
 * cross-referencing three validation rules. Returns null when nothing is required.
 */
function describeRequirement(row, context) {
    if (row.requiredBeforeTakeover !== true) return null;
    const ctx = context || {};
    const labelOf = api => (ctx.labels && ctx.labels[api]) || api;
    const name = row.label || labelOf(row.apiName);

    let text = `${name} must have a value before someone can take this case`;

    // Record type Ids are unreadable on their own, so name them where we can.
    const readable = api => labelOf(api);
    const nameValues = condition => {
        if (condition.field !== 'RecordTypeId' || condition.value === undefined) return null;
        return joinOr(splitCsv(condition.value).map(id => (ctx.recordTypes && ctx.recordTypes[id]) || id));
    };
    const speak = group => describeConditions(
        {
            logic: group.logic,
            conditions: group.conditions.map(c => {
                const named = nameValues(c);
                return named === null ? c : { field: c.field, value: named, negate: c.negate };
            })
        },
        readable
    );

    const show = conditionsOf(row, SITE_SHOW, row.apiName);
    if (show.conditions.length) {
        // "only on AvioBook Case" reads better than "only while RecordTypeId is AvioBook
        // Case", and record-type scoping is by far the commonest thing here. Worth the
        // special case for the single-condition form; anything richer gets the general
        // sentence, which stays accurate if less pretty.
        const only = show.conditions.length === 1 ? show.conditions[0] : null;
        if (only && only.field === 'RecordTypeId' && only.value !== undefined && !only.negate) {
            text += `, but only on ${joinOr(splitCsv(only.value).map(
                id => (ctx.recordTypes && ctx.recordTypes[id]) || id
            ))}`;
        } else {
            text += `, but only while ${speak(show)}`;
        }
    }

    const required = conditionsOf(row, SITE_REQUIRED, row.apiName);
    if (required.conditions.length) text += `, and only when ${speak(required)}`;

    return `${text}.`;
}

/* ---------------------------------------------------------------------------------
 * Document operations.
 *
 * Pure array-in / array-out so the builder UI stays thin glue and this logic is
 * testable without mounting a component — LWC does not expose non-@api internals on
 * the host element, so anything worth testing has to live outside the class.
 * ------------------------------------------------------------------------------- */

// Emitted key order. Derived from the registry rather than hand-listed, so a new key
// lands in a predictable place and App Builder diffs stay readable.
const OUTPUT_HEAD = ['divider', 'apiName', 'label', 'colSpan', 'editable', 'showIf', 'showIfField', 'showIfValue'];

const OUTPUT_ORDER = OUTPUT_HEAD
    .concat(WIDGET_KEYS)
    .concat(CONFIG_KEYS
        .map(d => d.key)
        .filter(k => !OUTPUT_HEAD.includes(k)));

/** One row with its keys in canonical order; unknown keys are kept, at the end. */
function orderRow(row) {
    const out = {};
    OUTPUT_ORDER.forEach(k => { if (row[k] !== undefined) out[k] = row[k]; });
    Object.keys(row).forEach(k => { if (out[k] === undefined) out[k] = row[k]; });
    return out;
}

/** Section settings in registry order, dropping anything blank. */
function orderSection(section) {
    const out = {};
    const settings = section || {};
    SECTION_KEYS.forEach(def => {
        const value = settings[def.key];
        if (value === undefined || value === '' || value === null) return;
        out[def.key] = value;
    });
    return out;
}

/** The whole document: section settings plus field rows. */
function serialize(rows, section) {
    return JSON.stringify({ section: orderSection(section), fields: (rows || []).map(orderRow) });
}

/** Same document, laid out one field row per line so it can be read in a diff. */
function serializePretty(rows, section) {
    const sectionJson = JSON.stringify(orderSection(section));
    const list = rows || [];
    if (!list.length) return `{\n  "section": ${sectionJson},\n  "fields": []\n}`;

    const lines = list.map(r => `    ${JSON.stringify(orderRow(r))}`).join(',\n');
    return `{\n  "section": ${sectionJson},\n  "fields": [\n${lines}\n  ]\n}`;
}

/**
 * { rows, section, error, legacyShape }. Never throws, so a bad paste is a message
 * rather than a crash.
 *
 * Two shapes are accepted:
 *   { "section": {…}, "fields": […] }   the current shape, everything in one document
 *   [ … ]                               the original shape, field rows only
 *
 * A bare array still parses because every record page in the org was configured that
 * way, with the section settings held as separate App Builder properties. Those pages
 * keep working untouched; `legacyShape` lets a caller offer to migrate.
 */
function parseConfig(text) {
    const raw = (text || '').trim();
    if (!raw) return { rows: null, section: null, error: 'Paste a config first.', legacyShape: false };

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { rows: null, section: null, error: `That is not valid JSON: ${e.message}`, legacyShape: false };
    }

    if (Array.isArray(parsed)) {
        return { rows: parsed, section: {}, error: '', legacyShape: true };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.fields)) {
        return {
            rows: parsed.fields,
            section: (parsed.section && typeof parsed.section === 'object') ? parsed.section : {},
            error: '',
            legacyShape: false
        };
    }
    return {
        rows: null,
        section: null,
        error: 'Expected either a JSON array of field rows, or an object with a "fields" array.',
        legacyShape: false
    };
}

/**
 * The settings the section should use: whatever the JSON sets, with the registry's
 * defaults filling the gaps.
 *
 * The App Builder properties that used to act as a second source were removed once every
 * page had been migrated into the JSON, so this is now the only source.
 */
function resolveSectionSettings(section) {
    const json = section || {};
    const out = {};

    SECTION_KEYS.forEach(def => {
        if (json[def.key] !== undefined && json[def.key] !== '') out[def.key] = json[def.key];
        else if (def.fallback !== undefined) out[def.key] = def.fallback;
    });

    return out;
}

/** Problems with the section half of the document. Same finding shape as field rows. */
function validateSection(section, context) {
    const ctx = context || {};
    const settings = section || {};
    const findings = [];
    const push = (level, message, key) => findings.push({ row: -1, name: 'Section', level, message, key });

    Object.keys(settings).forEach(key => {
        if (SECTION_KEY_NAMES.includes(key)) return;
        const suggestion = SECTION_KEY_NAMES.find(known => editDistance(key.toLowerCase(), known.toLowerCase()) <= 2);
        push('error', `Unknown section setting "${key}"${suggestion ? `. Did you mean "${suggestion}"?` : '.'}`, key);
    });

    SECTION_KEYS.forEach(def => {
        const value = settings[def.key];
        if (value === undefined || value === '') return;

        if (def.requires && isBlank(settings[def.requires]) && !satisfiedBySite(settings, def)) {
            push('error', `"${def.key}" is set but "${def.requires}" is not.`, def.key);
        }
        if (def.control === 'fieldPicker' && ctx.fields && !ctx.fields[value]) {
            push('error', `Field ${value} does not exist on this object.`, def.key);
        }
        if (def.control === 'icon' && !/^[a-z]+:[a-z0-9_]+$/.test(String(value))) {
            push('warning', `"${value}" does not look like an icon name (expected e.g. utility:warning).`, def.key);
        }
    });

    conditionFindings(settings, SITE_ALERT, ctx).forEach(f => push(f.level, f.message, f.key));

    // An alert condition with no colour to switch to does nothing at all
    if (conditionsOf(settings, SITE_ALERT).conditions.length && isBlank(settings.alertColor)) {
        push('warning', 'The header alert has a condition but no alert background colour, so it will never change.', 'alertColor');
    }

    return findings;
}

/**
 * Store a condition group on a row or on the section settings.
 *
 * This is the ONLY place that chooses between the two shapes, and it prefers the flat
 * one: a single plain condition is written as `showIfField` + `showIfValue`, exactly as
 * it always was. Anything the flat pair cannot say — two or more conditions, a negated
 * one, or custom logic — is written as the structured `showIf`.
 *
 * Preferring flat is not nostalgia. A browser still running the previous bundle keeps
 * understanding every row it can, so a deploy does not break the rows that never needed
 * the new shape; and untouched configs stay byte-identical, which keeps App Builder
 * diffs honest about what actually changed.
 */
function withConditionsSet(holder, siteOrKey, group) {
    const site = typeof siteOrKey === 'string' ? siteByKey(siteOrKey) : siteOrKey;
    const next = Object.assign({}, holder);
    delete next[site.key];
    delete next[site.legacyField];
    delete next[site.legacyValue];

    const conditions = ((group && group.conditions) || []).filter(c => c && typeof c === 'object');
    if (!conditions.length) return next;

    const logic = String((group && group.logic) || LOGIC_AND).trim();
    const upper = logic.toUpperCase();
    // The flat pair cannot say "no field yet": writing neither key would drop the condition
    // on the floor, which is what made "add condition" appear to do nothing. colorIf is the
    // exception — there a blank field with a value is exactly what colorIfValue on its own
    // has always meant. One condition also cannot tell AND from OR, so either flattens.
    // The flat pair has room for a field and a value and nothing else, so a condition
    // carrying an operator can only be written structurally — and one that names no field
    // cannot be written flat at all.
    //
    // The underline site used to be excused from that second rule, so an unfinished
    // condition (blank field, blank value) was written as `colorIfValue: ""` — which the
    // reader correctly understands as "this row's own field, any value", making it complete
    // again by the back door. Reading that legacy shape still works; writing it no longer
    // does, so the same condition means the same thing whichever shape it is in.
    const sayable = !isBlank(conditions[0].field) && isBlank(conditions[0].op);
    // OR is deliberately NOT flattenable even though it means the same as AND for a single
    // condition: the flat pair has nowhere to record it, so deleting back down to one
    // condition used to drop the OR silently, and adding a second brought it back as AND.
    const flattenable = conditions.length === 1
        && !conditions[0].negate
        && sayable
        && (!logic || upper === LOGIC_AND);

    if (flattenable) {
        const only = conditions[0];
        if (!isBlank(only.field)) next[site.legacyField] = only.field;
        if (only.value !== undefined) next[site.legacyValue] = only.value;
        return next;
    }

    const stored = { conditions: conditions.map(c => {
        const out = { field: c.field === undefined ? '' : c.field };
        if (!isBlank(c.op)) out.op = String(c.op);
        if (c.value !== undefined) out.value = c.value;
        if (c.negate) out.negate = true;
        return out;
    }) };
    // AND is the default, so writing it only adds noise to the JSON.
    if (logic && logic.toUpperCase() !== LOGIC_AND) stored.logic = logic;
    next[site.key] = stored;
    return next;
}

/**
 * A new row, editable by default — unless the caller knows the org will not accept an
 * update, in which case claiming editability would be a lie the page cannot keep.
 */
function withRowAdded(rows, apiName, label, editable = true) {
    const row = { apiName, label };
    if (editable) row.editable = true;
    return rows.concat(row);
}

/** A divider entry. Empty caption by default: a plain rule is the commonest one. */
function withDividerAdded(rows, caption = '') {
    return rows.concat({ divider: caption });
}

/**
 * A child-rollup entry, deliberately EMPTY apart from the label.
 *
 * The relationship and field are chosen in the editor afterwards, which is why the row has
 * to be storable while they are still blank — the same reason an unfinished condition is
 * stored rather than dropped. validateConfig reports both as errors until they are filled
 * in, so it cannot stay half-configured by accident.
 */
function withRollupAdded(rows, label = '') {
    return rows.concat({ label: label, childRollup: { relationship: '', field: '' } });
}

/**
 * One key inside a row's `childRollup`, set or cleared.
 *
 * Kept separate from `withKeySet` because the target is nested: writing `childRollup` as a
 * flat value would replace the whole options object and lose the other half of the pair.
 * `relationship` and `field` are always written even when empty — they are the two the
 * editor is steering, and dropping them would make a half-finished rollup indistinguishable
 * from one that was never started.
 */
function withRollupKeySet(row, key, value) {
    const next = { ...row };
    const opts = { ...(next.childRollup || {}) };
    const empty = value === undefined || value === null || String(value) === '';

    if (empty && key !== 'relationship' && key !== 'field') {
        delete opts[key];
    } else {
        opts[key] = value === undefined || value === null ? '' : value;
    }
    // Changing the relationship changes which object the field belongs to, so a field
    // chosen against the old child can never match — same rule as a condition's value
    // being cleared when its field changes.
    if (key === 'relationship') opts.field = '';

    next.childRollup = opts;
    return next;
}

function withRowMoved(rows, index, step) {
    const target = index + step;
    if (target < 0 || target >= rows.length) return rows;

    const next = rows.slice();
    const moved = next[index];
    next[index] = next[target];
    next[target] = moved;
    return next;
}

function withRowDuplicated(rows, index) {
    const next = rows.slice();
    next.splice(index + 1, 0, Object.assign({}, rows[index]));
    return next;
}

function withRowRemoved(rows, index) {
    const next = rows.slice();
    next.splice(index, 1);
    return next;
}

/** Setting a key to blank/false removes it, so the JSON never carries dead entries. */
/**
 * Keys whose PRESENCE carries the meaning, so an empty value is a real state and not an
 * instruction to remove them. `divider` is the entry-type discriminator: deleting it when
 * the caption was cleared turned a plain rule into a row with no field, and made
 * `{"divider": ""}` unreachable from an editor.
 */
const PRESENCE_KEYS = ['divider'];

function withKeySet(rows, index, key, value) {
    const next = rows.slice();
    const row = Object.assign({}, next[index]);
    const empty = value === '' || value === false || value === null || value === undefined;

    if (PRESENCE_KEYS.includes(key)) row[key] = empty ? '' : value;
    else if (empty) delete row[key];
    else row[key] = value;

    next[index] = row;
    return next;
}

/**
 * Switch a row's widget. Clears every other widget key so two can never both be true,
 * and drops widget-scoped keys that no longer apply (e.g. allowedDomains when moving off
 * the people widget) rather than leaving them orphaned in the JSON.
 */
function withWidgetSet(rows, index, widgetKey) {
    const next = rows.slice();
    const row = Object.assign({}, next[index]);

    WIDGET_KEYS.forEach(k => delete row[k]);
    if (widgetKey && widgetKey !== 'standard') row[widgetKey] = true;

    CONFIG_KEYS.forEach(def => {
        if (def.group === 'widget' && def.appliesWhen
            && row[def.key] !== undefined && !def.appliesWhen(row)) {
            delete row[def.key];
        }
    });

    next[index] = row;
    return next;
}

/** Where the selection lands after removing a row, keeping the same row selected. */
function selectionAfterRemoval(selectedIndex, removedIndex, remainingCount) {
    if (!remainingCount) return -1;
    if (selectedIndex > removedIndex) return selectedIndex - 1;
    if (selectedIndex >= remainingCount) return remainingCount - 1;
    return selectedIndex;
}


/** Setting a section value to blank/false removes it, so defaults stay implicit. */
function withSectionKeySet(section, key, value) {
    const next = Object.assign({}, section || {});
    if (value === '' || value === false || value === null || value === undefined) delete next[key];
    else next[key] = value;
    return next;
}

export {
    WIDGETS,
    WIDGET_KEYS,
    GROUPS,
    SECTION_GROUPS,
    FIELD_GROUPS,
    SECTION_KEYS,
    SECTION_KEY_NAMES,
    ICON_CHOICES,
    CONFIG_KEYS,
    KNOWN_KEYS,
    OUTPUT_ORDER,
    widgetOf,
    isBlank,
    matchesCsv,
    isDivider,
    withDividerAdded,
    withRollupAdded,
    withRollupKeySet,
    isChildRollup,
    rollupOptions,
    rollupValues,
    ROLLUP_ALLOWED_KEYS,
    DEFAULT_ALERT_COLOR,
    DATE_OPS,
    DATE_OP_KEYS,
    DATE_OPERAND_HINT,
    dateOpFor,
    operandDay,
    fieldDay,
    localToday,
    isRowVisible,
    COLUMN_COUNTS,
    columnsOf,
    spanOf,
    sizeClassFor,
    spanTitle,
    colSpanOptions,
    LOGIC_AND,
    LOGIC_OR,
    CONDITION_SITES,
    CONDITION_SITE_KEYS,
    siteByKey,
    siteByLegacyField,
    conditionsOf,
    withConditionsSet,
    watchedFieldsOf,
    valueResolver,
    matchesCondition,
    evaluateConditions,
    holds,
    parseLogic,
    describeCondition,
    describeConditions,
    splitCsv,
    joinOr,
    validateConfig,
    suggestKey,
    describeRequirement,
    orderRow,
    orderSection,
    resolveSectionSettings,
    validateSection,
    withSectionKeySet,
    serialize,
    serializePretty,
    parseConfig,
    withRowAdded,
    withRowMoved,
    withRowDuplicated,
    withRowRemoved,
    withKeySet,
    withWidgetSet,
    selectionAfterRemoval
};
