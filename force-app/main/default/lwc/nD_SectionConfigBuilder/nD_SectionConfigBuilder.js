import { LightningElement, api, track, wire } from 'lwc';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import {
    WIDGETS,
    GROUPS,
    CONFIG_KEYS,
    widgetOf,
    isBlank,
    validateConfig,
    describeRequirement,
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

export default class ND_SectionConfigBuilder extends LightningElement {
    // Which object's fields the picker offers. Case unless someone overrides it.
    @api objectApiName = 'Case';

    @track rows = [];
    @track selectedIndex = -1;

    previewRecordId = '';
    previewVisible = true;
    importText = '';
    importError = '';
    copyLabel = 'Copy JSON';
    fieldToAdd = '';

    _objectInfo;

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

    labelFor(apiName) {
        const field = this.objectFields[apiName];
        return (field && field.label) || apiName;
    }

    get fieldPickerOptions() {
        return Object.keys(this.objectFields)
            .sort((a, b) => this.labelFor(a).localeCompare(this.labelFor(b)))
            .map(apiName => ({ label: `${this.labelFor(apiName)} · ${apiName}`, value: apiName }));
    }

    // Fields not already used by a row, so the same field cannot be added twice.
    get addableFieldOptions() {
        const used = this.rows.map(r => r.apiName);
        return this.fieldPickerOptions.filter(o => !used.includes(o.value));
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
                title: row.label || this.labelFor(row.apiName) || '(no field)',
                apiName: row.apiName || '—',
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
    }

    handleAddFieldChange(event) {
        this.fieldToAdd = event.detail.value;
    }

    handleAddRow() {
        if (!this.fieldToAdd) return;
        this.rows = withRowAdded(this.rows, this.fieldToAdd, this.labelFor(this.fieldToAdd));
        this.selectedIndex = this.rows.length - 1;
        this.fieldToAdd = '';
        this.refreshPreview();
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

    handleDuplicateRow(event) {
        const index = Number(event.currentTarget.dataset.index);
        this.rows = withRowDuplicated(this.rows, index);
        this.selectedIndex = index + 1;
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

        return GROUPS.map(group => {
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
                controls: defs.filter(d => !d.nested).map(d => this.controlFor(d, row)),
                nestedControls: defs.filter(d => d.nested).map(d => this.controlFor(d, row)),
                hasNested: defs.some(d => d.nested),
                sentence: group.id === 'takeover' ? this.requirementSentence : null
            };
        }).filter(g => g.isWidgetGroup || g.controls.length || g.nestedControls.length);
    }

    controlFor(def, row) {
        const value = row[def.key];
        const gate = def.requires ? row[def.requires] : null;
        const gated = !!def.requires;
        // showIfValue against RecordTypeId is the one place an 18-character Id would
        // otherwise be typed by hand, so it becomes a picklist of record type names.
        const asRecordType = def.control === 'recordType' && gate === 'RecordTypeId';

        return {
            key: def.key,
            label: def.label,
            help: asRecordType
                ? 'Record types are listed by name; the Id is written to the JSON.'
                : def.help,
            title: def.title || def.label,
            isText: def.control === 'text' || (def.control === 'recordType' && !asRecordType),
            isCheck: def.control === 'check',
            isFieldPicker: def.control === 'fieldPicker',
            isSelect: def.control === 'select',
            isColor: def.control === 'color',
            isRecordType: asRecordType,
            value: value === undefined ? '' : String(value),
            checked: value === true,
            disabled: gated && isBlank(gate),
            placeholder: this.placeholderFor(def, row, gated, gate),
            options: this.optionsFor(def, asRecordType),
            swatchStyle: def.control === 'color' ? `background:${value || 'transparent'}` : ''
        };
    }

    placeholderFor(def, row, gated, gate) {
        if (gated && isBlank(gate)) return `set ${def.requires} first`;
        if (def.key === 'label') return this.labelFor(row.apiName);
        return def.placeholder || '';
    }

    optionsFor(def, asRecordType) {
        if (asRecordType) return this.recordTypeOptions;
        if (def.control === 'fieldPicker') {
            const base = def.blank ? [{ label: '— none —', value: '' }] : [];
            return base.concat(this.fieldPickerOptions);
        }
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
        return validateConfig(this.rows, {
            fields: this.hasObjectInfo ? this.objectFields : null,
            recordTypes: this.recordTypesById
        });
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
        this.selectedIndex = Number(event.currentTarget.dataset.index);
    }

    // --- JSON in and out ----------------------------------------------------------
    get jsonOutput() {
        return serialize(this.rows);
    }

    get jsonPretty() {
        return serializePretty(this.rows);
    }

    get jsonLength() {
        return `${this.jsonOutput.length} chars`;
    }

    // Braces in a template attribute would be read as a data binding, so the example
    // config has to come from JS rather than sit inline in the markup.
    get importPlaceholder() {
        return '[{"apiName":"Status","editable":true}]';
    }

    handleImportChange(event) {
        this.importText = event.target.value;
    }

    handleImport() {
        const { rows, error } = parseConfig(this.importText);
        this.importError = error;
        if (!rows) return;

        this.rows = rows;
        this.selectedIndex = rows.length ? 0 : -1;
        this.refreshPreview();
    }

    handleClearAll() {
        this.rows = [];
        this.selectedIndex = -1;
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

    get canPreview() {
        return this.previewVisible && this.previewRecordId.length >= 15 && this.rows.length > 0;
    }

    get previewHint() {
        if (!this.rows.length) return 'Add a field row to see a preview.';
        if (this.previewRecordId.length < 15) {
            return 'Paste a record Id above to preview against real data.';
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

    handleRefreshPreview() {
        this.refreshPreview();
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
        const preview = this.template.querySelector('c-n-d_-dynamic-section');
        if (!preview) {
            this._previewSignature = null;
            return;
        }

        const json = this.jsonOutput;
        const signature = `${this.previewRecordId}|${this.objectApiName}|${json}`;
        if (this._previewSignature === signature) return;
        this._previewSignature = signature;

        preview.ND_sectionTitle = 'Preview';
        preview.ND_jsonConfigString = json;
        preview.ND_showConfigDiagnostics = true;
        preview.ND_startCollapsed = false;
    }
}
