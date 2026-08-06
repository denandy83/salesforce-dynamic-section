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

/* ---------------------------------------------------------------------------------
 * Section-level settings.
 *
 * These used to be separate App Builder properties. They now live inside the same JSON
 * as the field rows so the whole section is one artefact that the builder can compose,
 * validate and preview in one piece — and so App Builder needs exactly one field.
 * ------------------------------------------------------------------------------- */
const SECTION_KEYS = [
    {
        key: 'title',
        group: 'sectionBasics',
        label: 'Section title',
        control: 'text',
        fallback: 'Details',
        legacy: 'ND_sectionTitle',
        help: 'Heading shown at the top of the card.'
    },
    {
        key: 'icon',
        group: 'sectionBasics',
        label: 'Header icon',
        control: 'icon',
        fallback: 'utility:warning',
        legacy: 'ND_iconName',
        help: 'Any SLDS icon name, e.g. utility:warning. Pick one below or type it.'
    },
    {
        key: 'columns',
        group: 'sectionBasics',
        label: 'Columns',
        control: 'select',
        fallback: 2,
        options: [{ value: 2, title: 'Two columns' }, { value: 1, title: 'One column' }],
        help: 'One column forces every row full width.'
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
        legacy: 'ND_headerBackgroundColor',
        help: 'Normal header background colour.'
    },
    {
        key: 'headerTextColor',
        group: 'sectionHeader',
        label: 'Header text',
        control: 'color',
        fallback: '#FFFFFF',
        legacy: 'ND_headerTextColor',
        help: 'Normal header text colour.'
    },

    {
        key: 'alertField',
        group: 'sectionAlert',
        label: 'Recolour the header when this field…',
        control: 'fieldPicker',
        blank: true,
        legacy: 'ND_headerLogicField',
        help: 'One field only. Leave empty for a header that never changes colour.'
    },
    {
        key: 'alertValue',
        group: 'sectionAlert',
        label: '…is one of',
        control: 'values',
        requires: 'alertField',
        valuesFrom: 'alertField',
        legacy: 'ND_headerLogicValue',
        placeholder: 'High,Urgent',
        help: 'Comma-separated membership. Empty means any non-blank value.'
    },
    {
        key: 'alertColor',
        group: 'sectionAlert',
        label: 'Alert background',
        control: 'color',
        requires: 'alertField',
        legacy: 'ND_headerActiveColor',
        help: 'Header background while the condition holds. Required for the alert to do anything.'
    },
    {
        key: 'alertTextColor',
        group: 'sectionAlert',
        label: 'Alert text',
        control: 'color',
        requires: 'alertField',
        legacy: 'ND_headerActiveTextColor',
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
        // Formula, rollup, autonumber and system fields report updateable:false on the
        // describe. Ticking this on one of them cannot work, so an editor should refuse
        // rather than imply the field became editable.
        requiresUpdateable: true,
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
        label: '…is one of',
        control: 'values',
        requires: 'showIfField',
        valuesFrom: 'showIfField',
        help: 'Comma-separated membership. Empty means "any non-blank value".'
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
        control: 'values',
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
        control: 'values',
        nested: true,
        requires: 'requiredIfField',
        valuesFrom: 'requiredIfField',
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
 * Resolve the settings the section should actually use.
 *
 * Precedence: the JSON wins, then the legacy App Builder property, then the built-in
 * default. The legacy step is what lets a page configured the old way keep rendering
 * exactly as before after the App Builder properties are removed from the palette.
 */
function resolveSectionSettings(section, legacyProps) {
    const json = section || {};
    const legacy = legacyProps || {};
    const out = {};

    SECTION_KEYS.forEach(def => {
        if (json[def.key] !== undefined && json[def.key] !== '') {
            out[def.key] = json[def.key];
            return;
        }
        const legacyValue = def.legacy ? legacy[def.legacy] : undefined;
        if (legacyValue !== undefined && legacyValue !== '' && legacyValue !== null) {
            out[def.key] = legacyValue;
            return;
        }
        if (def.fallback !== undefined) out[def.key] = def.fallback;
    });

    // The legacy layout property was the string "1 Column" / "2 Columns"
    if (json.columns === undefined && legacy.ND_layoutType) {
        out.columns = legacy.ND_layoutType === '1 Column' ? 1 : 2;
    }
    if (json.startCollapsed === undefined && legacy.ND_startCollapsed !== undefined) {
        out.startCollapsed = legacy.ND_startCollapsed === true;
    }

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

        if (def.requires && isBlank(settings[def.requires])) {
            push('error', `"${def.key}" is set but "${def.requires}" is not.`, def.key);
        }
        if (def.control === 'fieldPicker' && ctx.fields && !ctx.fields[value]) {
            push('error', `Field ${value} does not exist on this object.`, def.key);
        }
        if (def.control === 'icon' && !/^[a-z]+:[a-z0-9_]+$/.test(String(value))) {
            push('warning', `"${value}" does not look like an icon name (expected e.g. utility:warning).`, def.key);
        }
    });

    // An alert condition with no colour to switch to does nothing at all
    if (!isBlank(settings.alertField) && isBlank(settings.alertColor)) {
        push('warning', 'The header alert has a condition but no alert background colour, so it will never change.', 'alertColor');
    }

    return findings;
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
