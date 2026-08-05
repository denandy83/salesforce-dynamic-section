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

const GROUPS = [
    { id: 'field', legend: 'Field' },
    { id: 'visibility', legend: 'Show this row only when…' },
    { id: 'widget', legend: 'Render as' },
    { id: 'alert', legend: 'Underline the value when…' },
    { id: 'takeover', legend: 'Require before "take it!"' }
];

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
        key: 'apiName',
        group: 'field',
        label: 'Salesforce field',
        control: 'fieldPicker',
        required: true,
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
        options: [{ value: '', title: 'Half width' }, { value: 2, title: 'Full width' }],
        badge: 'full width',
        badgeWhen: 2,
        help: 'Set to 2 for a full-width row.'
    },
    {
        key: 'editable',
        group: 'field',
        label: 'Editing',
        control: 'check',
        title: 'Users can edit this field',
        badge: 'read only',
        badgeWhenFalsy: true,
        help: 'Unchecked renders the value as read-only output.'
    },

    {
        key: 'showIfField',
        group: 'visibility',
        label: 'Watch this field',
        control: 'fieldPicker',
        blank: true,
        badge: 'conditional',
        badgeClass: 'cond',
        help: 'Point it at this same field to mean "only when populated".'
    },
    {
        key: 'showIfValue',
        group: 'visibility',
        label: '…equals this value',
        control: 'recordType',
        requires: 'showIfField',
        help: 'Empty means "any non-blank value". Exact string equality, not membership.'
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
        key: 'colorIfField',
        group: 'alert',
        label: 'Watch this field',
        control: 'fieldPicker',
        blank: true,
        help: "Empty watches this row's own field."
    },
    {
        key: 'colorIfValue',
        group: 'alert',
        label: '…is one of',
        control: 'text',
        placeholder: 'High,Urgent',
        help: 'Comma-separated membership.'
    },
    {
        key: 'color',
        group: 'alert',
        label: 'Underline colour',
        control: 'color',
        placeholder: '#ba0517',
        badge: 'alert',
        help: 'Hex colour for the underline under the value.'
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
        key: 'requiredIfField',
        group: 'takeover',
        label: 'Only require it when',
        control: 'fieldPicker',
        blank: true,
        nested: true,
        appliesWhen: row => row.requiredBeforeTakeover === true,
        help: 'Leave empty to always require it.'
    },
    {
        key: 'requiredIfValue',
        group: 'takeover',
        label: '…is one of',
        control: 'text',
        nested: true,
        requires: 'requiredIfField',
        placeholder: 'Bug or Incident',
        appliesWhen: row => row.requiredBeforeTakeover === true,
        help: 'Comma-separated. Empty means "any non-blank value".'
    }
];

const KNOWN_KEYS = CONFIG_KEYS.map(d => d.key).concat(WIDGET_KEYS);

/** Which widget a row has chosen, or null for a plain field. */
function widgetOf(row) {
    return WIDGET_KEYS.find(k => row[k] === true) || null;
}

/** Blank-ish test used consistently for stored values and live form values. */
function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

/** Comma-separated membership, the config's only multi-value idiom. */
function matchesCsv(value, csv) {
    return String(csv)
        .split(',')
        .map(v => v.trim())
        .includes(String(value));
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

    config.forEach((row, index) => {
        const name = row.label || row.apiName || `row ${index + 1}`;
        const push = (level, message, key) => findings.push({ row: index, name, level, message, key });

        if (isBlank(row.apiName)) {
            push('error', 'No apiName — the row has no field to render.', 'apiName');
        } else if (ctx.fields && !ctx.fields[row.apiName]) {
            push('error', `Field ${row.apiName} does not exist on this object, so the row is skipped.`, 'apiName');
        }

        Object.keys(row).forEach(key => {
            if (KNOWN_KEYS.includes(key)) return;
            const suggestion = suggestKey(key);
            push(
                'error',
                `Unknown key "${key}"${suggestion ? `. Did you mean "${suggestion}"?` : '.'}`,
                key
            );
        });

        const widgetsOn = WIDGET_KEYS.filter(k => row[k] === true);
        if (widgetsOn.length > 1) {
            push('error', `Two widgets enabled at once: ${widgetsOn.join(' + ')}.`, widgetsOn[1]);
        }

        CONFIG_KEYS.forEach(def => {
            const present = row[def.key] !== undefined;
            if (!present) return;
            if (def.requires && isBlank(row[def.requires])) {
                push('error', `"${def.key}" is set but "${def.requires}" is not.`, def.key);
            }
            if (def.appliesWhen && !def.appliesWhen(row)) {
                push('warning', `"${def.key}" has no effect with this row's current settings.`, def.key);
            }
        });

        if (row.showIfField === 'RecordTypeId' && !isBlank(row.showIfValue)
            && ctx.recordTypes && !ctx.recordTypes[row.showIfValue]) {
            push('warning', `Record type Id ${row.showIfValue} is not in this org.`, 'showIfValue');
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

    if (row.showIfField === 'RecordTypeId' && !isBlank(row.showIfValue)) {
        const rt = (ctx.recordTypes && ctx.recordTypes[row.showIfValue]) || row.showIfValue;
        text += `, but only on ${rt}`;
    } else if (!isBlank(row.showIfField)) {
        text += `, but only while ${labelOf(row.showIfField)} is set`;
    }

    if (!isBlank(row.requiredIfField)) {
        text += `, and only when ${labelOf(row.requiredIfField)} is `;
        text += isBlank(row.requiredIfValue)
            ? 'set'
            : String(row.requiredIfValue).split(',').map(v => v.trim()).join(' or ');
    }

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
const OUTPUT_ORDER = ['apiName', 'label', 'colSpan', 'editable', 'showIfField', 'showIfValue']
    .concat(WIDGET_KEYS)
    .concat(CONFIG_KEYS
        .map(d => d.key)
        .filter(k => !['apiName', 'label', 'colSpan', 'editable', 'showIfField', 'showIfValue'].includes(k)));

/** One row with its keys in canonical order; unknown keys are kept, at the end. */
function orderRow(row) {
    const out = {};
    OUTPUT_ORDER.forEach(k => { if (row[k] !== undefined) out[k] = row[k]; });
    Object.keys(row).forEach(k => { if (out[k] === undefined) out[k] = row[k]; });
    return out;
}

function serialize(rows) {
    return JSON.stringify(rows.map(orderRow));
}

function serializePretty(rows) {
    if (!rows.length) return '[]';
    return `[\n${rows.map(r => `  ${JSON.stringify(orderRow(r))}`).join(',\n')}\n]`;
}

/** { rows, error }. Never throws, so a bad paste is a message rather than a crash. */
function parseConfig(text) {
    const raw = (text || '').trim();
    if (!raw) return { rows: null, error: 'Paste a config first.' };

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { rows: null, error: `That is not valid JSON: ${e.message}` };
    }
    if (!Array.isArray(parsed)) {
        return { rows: null, error: 'Expected a JSON array of field rows.' };
    }
    return { rows: parsed, error: '' };
}

function withRowAdded(rows, apiName, label) {
    return rows.concat({ apiName, label, editable: true });
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
function withKeySet(rows, index, key, value) {
    const next = rows.slice();
    const row = Object.assign({}, next[index]);

    if (value === '' || value === false || value === null || value === undefined) delete row[key];
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

export {
    WIDGETS,
    WIDGET_KEYS,
    GROUPS,
    CONFIG_KEYS,
    KNOWN_KEYS,
    OUTPUT_ORDER,
    widgetOf,
    isBlank,
    matchesCsv,
    validateConfig,
    suggestKey,
    describeRequirement,
    orderRow,
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
