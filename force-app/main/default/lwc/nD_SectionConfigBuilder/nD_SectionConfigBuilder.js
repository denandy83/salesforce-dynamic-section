import { LightningElement, api, track, wire } from 'lwc';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import {
    IsConsoleNavigation,
    getFocusedTabInfo,
    setTabLabel,
    setTabIcon
} from 'lightning/platformWorkspaceApi';
import getRecentRecords from '@salesforce/apex/ND_SectionPreviewPicker.getRecentRecords';
import resolveRecordId from '@salesforce/apex/ND_SectionPreviewPicker.resolveRecordId';
import getPicklistValues from '@salesforce/apex/ND_SectionPreviewPicker.getPicklistValues';
import {
    WIDGETS,
    SECTION_GROUPS,
    FIELD_GROUPS,
    SECTION_KEYS,
    ICON_CHOICES,
    CONFIG_KEYS,
    widgetOf,
    isBlank,
    splitCsv,
    validateConfig,
    describeRequirement,
    resolveSectionSettings,
    validateSection,
    withSectionKeySet,
    serialize,
    serializePretty,
    parseConfig,
    withRowAdded,
    withRowMoved,
    withRowRemoved,
    withKeySet,
    withWidgetSet,
    selectionAfterRemoval,
    CONDITION_SITES,
    conditionsOf,
    withConditionsSet,
    isDivider,
    withDividerAdded
} from 'c/nD_sectionConfigSchema';

/**
 * Visual builder for nD_DynamicSection's ND_jsonConfigString.
 *
 * Why this is a tab and not an App Builder property editor: the platform only allows
 * `configurationEditor` on lightning__FlowAction and lightning__FlowScreen, so a record
 * page component cannot have one. Building the config here and pasting the result is the
 * same paste an admin already does, with a real UI and a live preview in front of it.
 *
 * Every control is generated from c/nD_sectionConfigSchema rather than hand-written, so a
 * new config key appears here the moment it is added to the registry — including its help
 * text, its dependencies and its validation.
 */

// What the console workspace tab is called. Without this it reads "Loading..." forever.
// Section settings the preview cannot pick up without being rebuilt: startCollapsed is
// read once in connectedCallback. Everything else is a getter and updates in place.
const REMOUNT_ON_SECTION_KEYS = ['startCollapsed'];

// Enough to scroll, few enough to render without lag on an object with 127 fields.
const FIELD_MATCH_LIMIT = 60;

const TAB_LABEL = 'Config Builder';
const TAB_ICON = 'utility:builder';

// Only the handful a config is likely to contain by hand. Anything else falls back to
// the key's default so the picker still opens somewhere sensible.
const NAMED_COLOURS = {
    red: '#ff0000', green: '#008000', blue: '#0000ff', black: '#000000',
    white: '#ffffff', grey: '#808080', gray: '#808080', orange: '#ffa500',
    yellow: '#ffff00', purple: '#800080', teal: '#008080', navy: '#000080'
};

export default class ND_SectionConfigBuilder extends LightningElement {
    // Which object's fields the picker offers. Case unless someone overrides it.
    @api objectApiName = 'Case';

    @track rows = [];
    @track section = {};
    @track selectedIndex = -1;

    // The section settings and the field rows are edited in the same middle pane, so one
    // flag decides which. Start on the section: it is what a new config needs first.
    @track editingSection = true;
    importNotice = '';

    previewRecordId = '';
    previewVisible = true;
    @track recentRecords = [];
    @track picklistValues = {};
    _valueSourceFields = [];
    _valueSourceSignature = '';
    recordSearch = '';
    recordSearchError = '';
    importText = '';
    importError = '';
    copyLabel = 'Copy JSON';
    fieldSearch = '';

    _objectInfo;
    _tabNamed = false;

    /**
     * True only inside a console app, where tabs need naming by hand.
     *
     * Wired to a FUNCTION rather than a field on purpose: nothing in the template reads
     * this value, so a wired field would not trigger a re-render when it resolved, and a
     * renderedCallback-based approach would simply never run again — leaving the tab
     * reading "Loading..." exactly as before.
     */
    isConsoleNavigation = false;

    @wire(IsConsoleNavigation)
    wiredIsConsoleNavigation(isConsole) {
        this.isConsoleNavigation = isConsole === true;
        if (this.isConsoleNavigation) this._nameConsoleTab();
    }

    /**
     * Records the user recently looked at, so a preview target can be picked instead of
     * pasting an 18-character Id. Falls back to recently modified for a user who has
     * viewed nothing yet.
     */
    @wire(getRecentRecords, { objectApiName: '$objectApiName' })
    wiredRecentRecords({ data, error }) {
        if (data) {
            this.recentRecords = data;
            // Nothing chosen yet: start on the most recent record so the preview has
            // something real to render the moment the page opens.
            if (!this.previewRecordId && data.length) this.previewRecordId = data[0].id;
            return;
        }
        if (error) {
            this.recentRecords = [];
            console.warn('nD_SectionConfigBuilder: could not load recent records', error);
        }
    }

    get recentRecordOptions() {
        return this.recentRecords.map(r => ({
            label: r.sublabel ? `${r.label} — ${r.sublabel}` : r.label,
            value: r.id
        }));
    }

    get hasRecentRecords() {
        return this.recentRecords.length > 0;
    }

    handleRecentRecordChange(event) {
        this.previewRecordId = event.detail.value;
        this.recordSearchError = '';
        this.refreshPreview();
    }

    /**
     * Accepts a case number as well as an Id, resolved by Apex — a case number is what
     * someone reading a ticket actually has to hand, and it is stored zero-padded, so
     * "12024" has to match "00012024".
     */
    handleRecordSearch(event) {
        const term = (event.target.value || '').trim();
        this.recordSearch = term;
        if (!term) {
            this.recordSearchError = '';
            return;
        }

        resolveRecordId({ objectApiName: this.objectApiName, term })
            .then(recordId => {
                if (recordId) {
                    this.previewRecordId = recordId;
                    this.recordSearchError = '';
                } else {
                    this.recordSearchError = `No ${this.objectApiName} matches "${term}".`;
                }
                this.refreshPreview();
            })
            .catch(error => {
                this.recordSearchError = 'Could not look that up.';
                console.warn('nD_SectionConfigBuilder: record lookup failed', error);
            });
    }

    /**
     * Fields any "…is one of" control might need choices for. One wire covers all of them
     * because several conditions can each watch a different field at the same time, and
     * the alternative is a separate wire per condition.
     */
    get valueSourceFields() {
        const row = this.selectedRow || {};
        const wanted = new Set();

        CONFIG_KEYS.concat(SECTION_KEYS).forEach(def => {
            if (!def.valuesFrom) return;
            const source = def.group && def.group.startsWith('section') ? this.section : row;
            const field = source[def.valuesFrom];
            if (field) wanted.add(field);
            // colorIfValue with no colorIfField watches the row's own field
            else if (def.valuesFromSelf && row.apiName) wanted.add(row.apiName);
        });

        // Every field the condition editors are watching, on this row and on the section.
        // Each condition can point somewhere different, so this is where the "one wire for
        // all of them" above earns its keep.
        CONDITION_SITES.forEach(site => {
            const holder = site.scope === 'section' ? this.section : row;
            conditionsOf(holder, site, row.apiName).conditions.forEach(c => {
                if (c.field) wanted.add(c.field);
            });
        });

        // Return the SAME array instance while the contents are unchanged. A wire keyed on
        // a getter that builds a new array every time refires on every render, which
        // re-renders, which builds another array — a loop that also wiped anything typed
        // into a controlled input before it had been committed.
        const next = Array.from(wanted).sort();
        const signature = next.join(',');
        if (this._valueSourceSignature !== signature) {
            this._valueSourceSignature = signature;
            this._valueSourceFields = next;
        }
        return this._valueSourceFields;
    }

    @wire(getPicklistValues, { objectApiName: '$objectApiName', fieldNames: '$valueSourceFields' })
    wiredPicklistValues({ data, error }) {
        if (error) {
            this.picklistValues = {};
            console.warn('nD_SectionConfigBuilder: could not load picklist values', error);
            return;
        }
        // Only reassign on a real change: a fresh {} every time is a fresh render every time
        const next = data || {};
        if (JSON.stringify(next) !== JSON.stringify(this.picklistValues)) {
            this.picklistValues = next;
        }
    }

    @wire(getObjectInfo, { objectApiName: '$objectApiName' })
    wiredObjectInfo({ data, error }) {
        this._objectInfo = data || undefined;
        if (error) {
            console.warn(`nD_SectionConfigBuilder: could not describe ${this.objectApiName}`, error);
        }
    }

    // --- org metadata -------------------------------------------------------------
    get objectFields() {
        return (this._objectInfo && this._objectInfo.fields) || {};
    }

    get hasObjectInfo() {
        return Object.keys(this.objectFields).length > 0;
    }

    get recordTypesById() {
        const infos = (this._objectInfo && this._objectInfo.recordTypeInfos) || {};
        const out = {};
        Object.values(infos).forEach(rt => { out[rt.recordTypeId] = rt.name; });
        return out;
    }

    get fieldLabelsByApiName() {
        const labels = {};
        const fields = this.objectFields;
        Object.keys(fields).forEach(apiName => { labels[apiName] = fields[apiName].label; });
        return labels;
    }

    // The describe is the authority on whether a field can be written at all.
    isNotUpdateable(apiName) {
        const field = apiName ? this.objectFields[apiName] : null;
        return !!field && field.updateable === false;
    }

    isFormula(apiName) {
        const field = apiName ? this.objectFields[apiName] : null;
        return !!(field && field.calculated);
    }

    labelFor(apiName) {
        const field = this.objectFields[apiName];
        return (field && field.label) || apiName;
    }

    get fieldPickerOptions() {
        return Object.keys(this.objectFields)
            .sort((a, b) => this.labelFor(a).localeCompare(this.labelFor(b)))
            .map(apiName => ({ label: this.labelFor(apiName), value: apiName }));
    }

    /**
     * Fields matching what has been typed, as a clickable list.
     *
     * Fields already used by a row stay in the list, marked. They used to be filtered out
     * silently, which is how RecordTypeId came to look missing: six of the live configs
     * already have a RecordTypeId row, so the picker removed it and said nothing while the
     * count quietly dropped from 127 to 115.
     */
    get fieldMatches() {
        const needle = this.fieldSearch.trim().toLowerCase();
        const used = this.rows.map(r => r.apiName);

        return Object.keys(this.objectFields)
            .map(apiName => ({ apiName, label: this.labelFor(apiName) }))
            .filter(f => !needle
                || f.label.toLowerCase().includes(needle)
                || f.apiName.toLowerCase().includes(needle))
            .sort((a, b) => a.label.localeCompare(b.label))
            .slice(0, FIELD_MATCH_LIMIT)
            .map(f => {
                const isUsed = used.includes(f.apiName);
                return {
                    key: f.apiName,
                    apiName: f.apiName,
                    label: f.label,
                    used: isUsed,
                    note: isUsed ? 'already a row — click to open it' : '',
                    cssClass: isUsed ? 'nd-match nd-match_used' : 'nd-match'
                };
            });
    }

    get fieldMatchCount() {
        const total = Object.keys(this.objectFields).length;
        const shown = this.fieldMatches.length;
        if (!this.fieldSearch.trim()) return `${total} fields`;
        return shown >= FIELD_MATCH_LIMIT ? `first ${shown} of ${total}` : `${shown} of ${total}`;
    }

    get hasFieldMatches() {
        return this.fieldMatches.length > 0;
    }

    handleAddDivider() {
        this.rows = withDividerAdded(this.rows);
        this.selectedIndex = this.rows.length - 1;
        this.refreshPreview();
    }

    handleFieldSearch(event) {
        this.fieldSearch = event.target.value || '';
    }

    /**
     * Clicking a match adds it, or opens it when it is already a row. Adding on click keeps
     * it to one action; a separate Add button was a second click for no decision.
     */
    handlePickField(event) {
        const apiName = event.currentTarget.dataset.field;
        const existing = this.rows.findIndex(r => r.apiName === apiName);

        if (existing >= 0) {
            this.selectedIndex = existing;
            this.editingSection = false;
            return;
        }

        const editable = !this.isNotUpdateable(apiName);
        this.rows = withRowAdded(this.rows, apiName, this.labelFor(apiName), editable);
        this.selectedIndex = this.rows.length - 1;
        this.editingSection = false;
        this.fieldSearch = '';
        this.refreshPreview();
    }

    /**
     * Narrow a field list by whatever was typed into its filter box.
     *
     * Matches the label and the API name, so both "record type" and "RecordTypeId" find the
     * same field. A filter that matches nothing returns everything rather than an empty
     * dropdown, which would look broken.
     */
    // Record types excluding Master, which App Builder never scopes a page to either.
    get assignableRecordTypeIds() {
        const infos = (this._objectInfo && this._objectInfo.recordTypeInfos) || {};
        return Object.values(infos)
            .filter(rt => rt.master !== true)
            .map(rt => rt.recordTypeId);
    }

    get recordTypeOptions() {
        return [{ label: '— any record type —', value: '' }].concat(
            Object.keys(this.recordTypesById).map(id => ({ label: this.recordTypesById[id], value: id }))
        );
    }

    // --- row list -----------------------------------------------------------------
    get selectedRow() {
        return this.rows[this.selectedIndex];
    }

    get hasSelection() {
        return this.selectedIndex >= 0 && !!this.rows[this.selectedIndex];
    }

    get hasRows() {
        return this.rows.length > 0;
    }

    get rowCountLabel() {
        return `${this.rows.length} ${this.rows.length === 1 ? 'row' : 'rows'}`;
    }

    get rowItems() {
        const findings = this.findings;
        return this.rows.map((row, index) => {
            const invalid = findings.some(f => f.row === index && f.level === 'error');
            return {
                key: `row-${index}`,
                index,
                number: String(index + 1).padStart(2, '0'),
                title: isDivider(row)
                    ? (String(row.divider || '').trim() || '(plain rule)')
                    : (row.label || this.labelFor(row.apiName) || '(no field)'),
                apiName: isDivider(row) ? 'divider' : (row.apiName || '—'),
                badges: this.badgesFor(row, invalid),
                cssClass: `nd-row${index === this.selectedIndex ? ' nd-row_selected' : ''}`
                    + `${invalid ? ' nd-row_invalid' : ''}`,
                isFirst: index === 0,
                isLast: index === this.rows.length - 1
            };
        });
    }

    // Chips come from the registry's `badge` metadata, so a newly flagged key appears on
    // the row summary without touching this method.
    badgesFor(row, invalid) {
        const badges = [];
        if (invalid) badges.push({ key: 'bad', label: 'invalid', cssClass: 'nd-badge nd-badge_bad' });

        // Org-derived, not config-derived: worth showing so a formula field is obvious in
        // the list rather than only once the row is selected.
        if (this.isNotUpdateable(row.apiName)) {
            badges.push({
                key: 'notUpdateable',
                label: this.isFormula(row.apiName) ? 'formula' : 'not editable',
                cssClass: 'nd-badge nd-badge_locked'
            });
        }

        const widget = widgetOf(row);
        if (widget) {
            const def = WIDGETS.find(w => w.key === widget);
            badges.push({ key: widget, label: def.badge, cssClass: 'nd-badge nd-badge_widget' });
        }

        CONFIG_KEYS.forEach(def => {
            if (!def.badge) return;
            const value = row[def.key];
            let on;
            if (def.badgeWhen !== undefined) on = value === def.badgeWhen;
            else if (def.badgeWhenFalsy) on = !value;
            else on = !isBlank(value) && value !== false;

            if (on) {
                badges.push({
                    key: def.key,
                    label: def.badge,
                    cssClass: `nd-badge${def.badgeClass ? ` nd-badge_${def.badgeClass}` : ''}`
                });
            }
        });
        return badges;
    }

    handleSelectRow(event) {
        this.selectedIndex = Number(event.currentTarget.dataset.index);
        this.editingSection = false;
    }

    handleSelectSection() {
        this.editingSection = true;
    }

    // Resolved settings, so the rail preview shows what will actually render rather than
    // blanks where the admin has not overridden a default.
    get resolvedSection() {
        return resolveSectionSettings(this.section, {});
    }

    get sectionRailClass() {
        return this.editingSection ? 'nd-row nd-row_selected nd-row_section' : 'nd-row nd-row_section';
    }

    get sectionTitlePreview() {
        return this.resolvedSection.title;
    }

    get sectionIconPreview() {
        return this.resolvedSection.icon;
    }

    get sectionSwatchStyle() {
        return `background:${this.resolvedSection.headerColor}`;
    }

    get isEditingField() {
        return !this.editingSection && this.hasSelection;
    }

    get showNothingSelected() {
        return !this.editingSection && !this.hasSelection;
    }

    /* --- section settings pane, generated from SECTION_KEYS --------------------- */
    get sectionGroups() {
        return SECTION_GROUPS.map(group => {
            const defs = SECTION_KEYS.filter(d => d.group === group.id);
            return {
                key: group.id,
                legend: group.legend,
                conditions: this.conditionEditorFor(defs, this.section),
                controls: defs.filter(d => this.isPlainControl(d)).map(d => this.controlFor(d, this.section))
            };
        }).filter(g => g.controls.length || g.conditions);
    }

    handleSectionChange(event) {
        const key = event.currentTarget.dataset.key;
        const def = SECTION_KEYS.find(d => d.key === key);
        let value;

        if (def && def.control === 'check') value = event.target.checked;
        else if (event.detail && event.detail.value !== undefined) value = event.detail.value;
        else value = event.target.value;

        if (Array.isArray(value)) value = value.join(',');
        if (key === 'columns' && value !== '') value = Number(value);

        this.section = withSectionKeySet(this.section, key, value);

        // Colours, title, icon and columns are all read from the config string by getters,
        // so the preview picks them up on the next render. Remounting would make the whole
        // card flash on every drag of the colour picker.
        if (REMOUNT_ON_SECTION_KEYS.includes(key)) this.refreshPreview();
    }

    /* --- icon picker ------------------------------------------------------------ */
    handlePickIcon(event) {
        this.section = withSectionKeySet(this.section, 'icon', event.currentTarget.dataset.icon);
        this.refreshPreview();
    }

    // The catalogue is a shortlist, not a limit: any icon name can be typed into the
    // field above the grid, and the preview shows whatever is entered so a wrong name is
    // immediately visible rather than silently blank.
    get iconChoices() {
        const current = this.resolvedSection.icon;
        return ICON_CHOICES.map(name => ({
            key: name,
            name,
            cssClass: name === current ? 'nd-icon-choice nd-icon-choice_on' : 'nd-icon-choice'
        }));
    }

    handleMoveRow(event) {
        const index = Number(event.currentTarget.dataset.index);
        const target = index + Number(event.currentTarget.dataset.step);
        const next = withRowMoved(this.rows, index, Number(event.currentTarget.dataset.step));
        if (next === this.rows) return;

        this.rows = next;
        this.selectedIndex = target;
        this.refreshPreview();
    }

    handleRemoveRow(event) {
        const index = Number(event.currentTarget.dataset.index);
        const next = withRowRemoved(this.rows, index);
        this.rows = next;
        this.selectedIndex = selectionAfterRemoval(this.selectedIndex, index, next.length);
        this.refreshPreview();
    }

    // --- property pane, generated from the registry -------------------------------
    get propertyGroups() {
        const row = this.selectedRow;
        if (!row) return [];

        // A divider draws a rule; none of the field settings mean anything on one, and its
        // caption means nothing on a field. Filtering whole groups keeps this out of twenty
        // separate appliesWhen predicates.
        const allowed = isDivider(row) ? ['divider', 'visibility'] : null;

        return FIELD_GROUPS.filter(group => (allowed ? allowed.includes(group.id) : group.id !== 'divider')).map(group => {
            const defs = CONFIG_KEYS.filter(
                d => d.group === group.id && (!d.appliesWhen || d.appliesWhen(row))
            );
            const isWidgetGroup = group.id === 'widget';

            return {
                key: group.id,
                legend: group.legend,
                isWidgetGroup,
                widgetOptions: isWidgetGroup
                    ? WIDGETS.map(w => ({ label: w.title, value: w.key || 'standard' }))
                    : [],
                widgetValue: widgetOf(row) || 'standard',
                widgetHelp: isWidgetGroup
                    ? WIDGETS.map(w => ({ key: w.key || 'standard', title: w.title, help: w.help }))
                    : [],
                conditions: this.conditionEditorFor(defs, row),
                controls: defs.filter(d => this.isPlainControl(d) && !d.nested).map(d => this.controlFor(d, row)),
                nestedControls: defs.filter(d => this.isPlainControl(d) && d.nested).map(d => this.controlFor(d, row)),
                hasNested: defs.some(d => this.isPlainControl(d) && d.nested),
                sentence: group.id === 'takeover' ? this.requirementSentence : null
            };
        }).filter(g => g.isWidgetGroup || g.controls.length || g.nestedControls.length || g.conditions);
    }

/**
     * The flat `showIfField` / `showIfValue` pair is still valid config and still what
     * gets written for a single condition, but it is no longer worth its own pair of
     * boxes in the panel: the condition editor covers one condition and any number of
     * them, and two ways to edit the same setting is how they end up disagreeing.
     */
    isPlainControl(def) {
        return !def.legacy && def.control !== 'conditions';
    }

    /** The editor view model for whichever site lives in this group, or null. */
    conditionEditorFor(defs, holder) {
        const def = defs.find(d => d.control === 'conditions');
        if (!def) return null;

        const site = CONDITION_SITES.find(s => s.key === def.site);
        return {
            site: site.key,
            legend: site.legend,
            help: def.help,
            group: conditionsOf(holder, site, (holder || {}).apiName),
            fieldOptions: this.fieldPickerOptions,
            valueChoices: this.valueChoicesByField,
            fieldTypes: this.fieldTypesByName,
            // colorIf is the one site where a blank field has always meant "this row's
            // own field", so it needs that offered rather than looking like a mistake.
            selfFieldLabel: site.selfField && holder && holder.apiName
                ? `— this row's own field (${this.labelFor(holder.apiName)}) —`
                : null
        };
    }

    /**
     * apiName -> describe dataType. Only the date types are acted on, to decide whether a
     * condition may be compared with "is on or before" and friends.
     */
    get fieldTypesByName() {
        const fields = this.objectFields || {};
        const out = {};
        Object.keys(fields).forEach(apiName => {
            const described = fields[apiName];
            if (described && described.dataType) out[apiName] = described.dataType;
        });
        return out;
    }

    /** apiName -> fixed value list, for every field a condition might watch. */
    get valueChoicesByField() {
        const out = {};
        const types = this.recordTypesById;
        const real = this.assignableRecordTypeIds;
        const ids = real.length ? real : Object.keys(types);
        if (ids.length) out.RecordTypeId = ids.map(id => ({ label: types[id], value: id }));

        Object.keys(this.picklistValues || {}).forEach(apiName => {
            const values = this.picklistValues[apiName];
            if (values && values.length) out[apiName] = values.map(v => ({ label: v, value: v }));
        });
        return out;
    }

    handleConditionsChange(event) {
        const { site, group } = event.detail;
        const isSection = CONDITION_SITES.find(s => s.key === site).scope === 'section';

        if (isSection) {
            this.section = withConditionsSet(this.section, site, group);
        } else {
            const next = this.rows.slice();
            next[this.selectedIndex] = withConditionsSet(next[this.selectedIndex], site, group);
            this.rows = next;
        }
        this.refreshPreview();
    }

    controlFor(def, source) {
        const row = source || {};
        const value = row[def.key];
        const gate = def.requires ? row[def.requires] : null;
        const gated = !!def.requires;
        // A formula/rollup/system field reports updateable:false. Offering "editable" on
        // one would imply the page could edit it, which it cannot.
        const orgBlocked = def.requiresUpdateable && this.isNotUpdateable(row.apiName);
        // Real choices when the watched field has them; a text box when it does not.
        const valueChoices = def.control === 'values' ? this.choicesFor(def, row) : null;
        // showIfValue against RecordTypeId is the one place an 18-character Id would
        // otherwise be typed by hand, so it becomes a picklist of record type names.
        const asRecordType = def.control === 'recordType' && gate === 'RecordTypeId';

        return {
            key: def.key,
            label: def.label,
            help: orgBlocked
                ? `${row.apiName} cannot be edited in this org`
                  + `${this.isFormula(row.apiName) ? ' — it is a formula field' : ''}`
                  + ', so this row always renders read-only.'
                : (asRecordType
                    ? 'Record types are listed by name; the Id is written to the JSON.'
                    : def.help),
            title: def.title || def.label,
            isText: def.control === 'text' || (def.control === 'recordType' && !asRecordType),
            isCheck: def.control === 'check',
            isFieldPicker: def.control === 'fieldPicker',
            isSelect: def.control === 'select',
            isColor: def.control === 'color',
            isIcon: def.control === 'icon',
            isRecordType: asRecordType,
            blankLabel: def.control === 'fieldPicker' && def.blank ? '— none —' : '',
            isValues: def.control === 'values' && !!valueChoices,
            isValuesText: def.control === 'values' && !valueChoices,
            valueOptions: valueChoices || [],
            selectedValues: valueChoices ? splitCsv(value) : [],
            value: value === undefined ? '' : String(value),
            checked: value === true && !orgBlocked,
            disabled: (gated && isBlank(gate)) || orgBlocked,
            placeholder: this.placeholderFor(def, row, gated, gate),
            options: this.optionsFor(def, asRecordType),
            swatchStyle: def.control === 'color' ? `background:${value || 'transparent'}` : '',
            colorValue: def.control === 'color' ? this.asHex(value, def.fallback) : ''
        };
    }

    /**
     * A value the native colour input will accept.
     *
     * <input type="color"> only understands #rrggbb, but a stored value may legitimately
     * be a CSS colour name or a short hex — the live AvioBook config contains "red". The
     * text box beside the picker keeps whatever was written; this only feeds the swatch.
     */
    asHex(value, fallback) {
        const raw = String(value === undefined || value === null ? '' : value).trim();
        if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(raw)) {
            return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
        }
        if (NAMED_COLOURS[raw.toLowerCase()]) return NAMED_COLOURS[raw.toLowerCase()];
        if (/^#[0-9a-f]{6}$/i.test(String(fallback || ''))) return String(fallback).toLowerCase();
        return '#000000';
    }

    /**
     * Options for a "…is one of" control, or null when the watched field has no fixed set
     * of values and free text is the only sensible input.
     *
     * Record types are offered by name while their Ids are what gets written, so nobody
     * has to recognise an 18-character Id.
     */
    choicesFor(def, source) {
        const row = source || {};
        const watched = def.valuesFrom
            ? (row[def.valuesFrom] || (def.valuesFromSelf ? row.apiName : ''))
            : '';
        if (!watched) return null;

        if (watched === 'RecordTypeId') {
            const types = this.recordTypesById;
            // Master is in recordTypeInfos but is not something to scope a row to when the
            // object has real record types. It stays in recordTypesById so validation can
            // still recognise a config that references it.
            const real = this.assignableRecordTypeIds;
            const ids = real.length ? real : Object.keys(types);
            return ids.length ? ids.map(id => ({ label: types[id], value: id })) : null;
        }

        const values = this.picklistValues[watched];
        return values && values.length ? values.map(v => ({ label: v, value: v })) : null;
    }

    placeholderFor(def, row, gated, gate) {
        if (gated && isBlank(gate)) return `set ${def.requires} first`;
        // Only a field row has an apiName to borrow a default label from
        if (def.key === 'label' && row.apiName) return this.labelFor(row.apiName);
        if (def.fallback !== undefined && def.fallback !== false) return String(def.fallback);
        return def.placeholder || '';
    }

    optionsFor(def, asRecordType) {
        if (asRecordType) return this.recordTypeOptions;
        // The blank entry is a label on the combobox now, not an option glued to the front
        // of the list, so it is passed separately as blank-label.
        if (def.control === 'fieldPicker') return this.fieldPickerOptions;
        if (def.control === 'select') {
            return def.options.map(o => ({ label: o.title, value: String(o.value) }));
        }
        return [];
    }

    // Straight from the schema module, so the builder and the record page word the rule
    // identically rather than each maintaining a copy.
    get requirementSentence() {
        const row = this.selectedRow;
        if (!row) return null;
        return describeRequirement(row, {
            labels: this.fieldLabelsByApiName,
            recordTypes: this.recordTypesById
        });
    }

    // --- editing ------------------------------------------------------------------
    updateSelected(key, value) {
        this.rows = withKeySet(this.rows, this.selectedIndex, key, value);
        this.refreshPreview();
    }

    handleControlChange(event) {
        const key = event.currentTarget.dataset.key;
        const def = CONFIG_KEYS.find(d => d.key === key);
        let value;

        if (def && def.control === 'check') value = event.target.checked;
        else if (event.detail && event.detail.value !== undefined) value = event.detail.value;
        else value = event.target.value;

        // A multi-select hands back an array; the config format is a comma-separated string
        if (Array.isArray(value)) value = value.join(',');

        // colSpan is the only numeric key; keep it a number so it matches what the runtime
        // compares against (item.colSpan === 2).
        if (key === 'colSpan' && value !== '') value = Number(value);

        this.updateSelected(key, value);
    }

    handleWidgetChange(event) {
        this.rows = withWidgetSet(this.rows, this.selectedIndex, event.detail.value);
        this.refreshPreview();
    }

    // --- validation ---------------------------------------------------------------
    get findings() {
        const ctx = {
            fields: this.hasObjectInfo ? this.objectFields : null,
            recordTypes: this.recordTypesById
        };
        return validateSection(this.section, ctx).concat(validateConfig(this.rows, ctx));
    }

    get findingItems() {
        return this.findings.map((f, i) => ({
            key: `f${i}`,
            index: f.row,
            text: `${f.name} — ${f.message}`,
            cssClass: `nd-finding nd-finding_${f.level}`,
            icon: f.level === 'error' ? 'utility:error' : 'utility:warning',
            variant: f.level === 'error' ? 'error' : 'warning'
        }));
    }

    get hasFindings() {
        return this.findings.length > 0;
    }

    get findingSummary() {
        const errors = this.findings.filter(f => f.level === 'error').length;
        const warnings = this.findings.length - errors;
        if (!errors && !warnings) return 'Valid';

        const parts = [];
        if (errors) parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
        if (warnings) parts.push(`${warnings} warning${warnings > 1 ? 's' : ''}`);
        return parts.join(', ');
    }

    handleJumpToFinding(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (index < 0) {
            this.editingSection = true;
            return;
        }
        this.selectedIndex = index;
        this.editingSection = false;
    }

    // --- JSON in and out ----------------------------------------------------------
    get jsonOutput() {
        return serialize(this.rows, this.section);
    }

    get jsonPretty() {
        return serializePretty(this.rows, this.section);
    }

    get jsonLength() {
        return `${this.jsonOutput.length} chars`;
    }

    // Braces in a template attribute would be read as a data binding, so the example
    // config has to come from JS rather than sit inline in the markup.
    get importPlaceholder() {
        return '[{"apiName":"Status","editable":true}]';
    }

    // Only clears the message; the value itself is read from the DOM on Load. Binding
    // value= made the box controlled, and lightning-textarea fires change on blur, so any
    // re-render before you clicked away reset what you had pasted.
    handleImportChange() {
        this.importError = '';
        this.importNotice = '';
    }

    get importBoxValue() {
        const box = this.template.querySelector('.nd-import-box');
        return box ? box.value : '';
    }

    handleImport() {
        const { rows, section, error, legacyShape } = parseConfig(this.importBoxValue);
        this.importError = error;
        if (!rows) return;

        this.rows = rows;
        this.section = section || {};
        this.selectedIndex = rows.length ? 0 : -1;
        this.editingSection = legacyShape;
        this.importNotice = legacyShape
            ? 'Loaded an older config that held field rows only. Section settings start from '
              + 'their defaults — set them now and the copied JSON will carry them, so the '
              + 'component no longer needs any other App Builder property.'
            : '';
        this.refreshPreview();
    }

    handleClearAll() {
        this.rows = [];
        this.section = {};
        this.selectedIndex = -1;
        this.editingSection = true;
        this.importNotice = '';
        this.refreshPreview();
    }

    handleCopy() {
        if (!navigator.clipboard || !navigator.clipboard.writeText) return;
        navigator.clipboard.writeText(this.jsonOutput).then(() => {
            this.copyLabel = 'Copied';
        });
    }

    handleCopyLabelReset() {
        this.copyLabel = 'Copy JSON';
    }

    // --- live preview -------------------------------------------------------------
    handlePreviewIdChange(event) {
        this.previewRecordId = (event.target.value || '').trim();
        this.refreshPreview();
    }

    // A record Id is all that is needed. Rows are not required: the header — title, icon
    // and colours — is the first thing being configured and the first thing worth seeing.
    get canPreview() {
        return this.previewVisible && this.previewRecordId.length >= 15;
    }

    get previewHint() {
        if (this.previewRecordId.length < 15) {
            return this.hasRecentRecords
                ? 'Pick a record above to preview against real data.'
                : 'Enter a record Id or case number above to preview against real data.';
        }
        return null;
    }

    get hasPreviewHint() {
        return !!this.previewHint;
    }

    // nD_DynamicSection seeds its widgets from wire data on load, so changing the config
    // string alone does not re-seed it. Unmount and remount on a microtask instead — a
    // timer would trip LWC's no-async-operation rule.
    refreshPreview() {
        this.previewVisible = false;
        Promise.resolve().then(() => { this.previewVisible = true; });
    }

    /**
     * Push the config into the embedded section by hand.
     *
     * nD_DynamicSection's public properties are named ND_jsonConfigString,
     * ND_sectionTitle and so on. LWC derives an attribute name by lowercasing and
     * hyphenating, which cannot produce a leading uppercase letter — so those
     * properties are unreachable from template markup and have to be assigned in JS.
     * (This is exactly what eslint's no-leading-uppercase-api-name warns about.)
     *
     * Guarded by a signature so re-rendering does not reassign on every pass.
     */
    renderedCallback() {
        this._pushConfigToPreview();
    }

    /**
     * Name the console workspace tab.
     *
     * A console tab hosting an LWC shows "Loading..." indefinitely: the tab label is not
     * taken from the CustomTab label, and nothing resolves it unless the component sets it
     * itself. Standard (non-console) navigation is unaffected, which is why
     * IsConsoleNavigation gates this.
     */
    _nameConsoleTab() {
        if (!this.isConsoleNavigation || this._tabNamed) return;
        this._tabNamed = true;

        getFocusedTabInfo()
            .then(tab => Promise.all([
                setTabLabel(tab.tabId, TAB_LABEL),
                setTabIcon(tab.tabId, TAB_ICON)
            ]))
            .catch(error => {
                // Let a later render try again rather than leaving "Loading..." forever
                this._tabNamed = false;
                console.warn('nD_SectionConfigBuilder: could not set the console tab label', error);
            });
    }

    _pushConfigToPreview() {
        const preview = this.template.querySelector('c-n-d_-dynamic-section');
        if (!preview) {
            this._previewSignature = null;
            return;
        }

        const json = this.jsonOutput;
        const signature = `${this.previewRecordId}|${this.objectApiName}|${json}`;
        if (this._previewSignature === signature) return;
        this._previewSignature = signature;

        // One assignment: the JSON carries the title, icon, colours and layout too.
        preview.ND_jsonConfigString = json;
    }
}
