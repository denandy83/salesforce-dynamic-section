import { LightningElement, api, wire, track } from 'lwc';
import { getFieldValue, getRecord, updateRecord } from 'lightning/uiRecordApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import USER_ID from '@salesforce/user/Id';
import getOpenProblems from '@salesforce/apex/ND_ProblemPicker.getOpenProblems';

// --- "isOpenProblem" lookup: baked-in business rule so it never has to be
// redefined in the JSON config. Problems are Cases of this record type (matched
// by developer name, which is stable across label renames/translations) whose
// Status is none of the closed-equivalent values.
const PROBLEM_RECORD_TYPE_DEVELOPER_NAME = 'AVB_Problem_Case';
const PROBLEM_EXCLUDED_STATUSES = ['Closed', 'Merged'];
const PROBLEM_SEARCH_DEBOUNCE_MS = 300;

export default class ND_DynamicSection extends NavigationMixin(LightningElement) {
    // --- 1. CONFIGURATION PROPERTIES ---
    @api recordId;
    @api objectApiName;

    @api ND_sectionTitle = 'Details';
    @api ND_iconName = 'utility:warning';
    @api ND_headerBackgroundColor = '#005FB2';
    @api ND_headerTextColor = '#FFFFFF';
    @api ND_startCollapsed = false;
    @api ND_jsonConfigString = '';

    // Dynamic Header Props
    @api ND_headerLogicField;
    @api ND_headerLogicValue;
    @api ND_headerActiveColor;
    @api ND_headerActiveTextColor;

    // NEW: Layout Prop
    @api ND_layoutType = '2 Columns';

    // --- 2. INTERNAL STATE ---
    @track ND_isOpen = true;
    @track ND_recordData;
    @track isDirty = false;
    @track isSaving = false;            // form save in flight
    _restoring = false;                 // true while Cancel puts values back (suppresses change handlers)
    @track isTakingOwnership = false;   // "take it!" in flight

    _skippedFieldsWarned;               // last set of config fields warned about as unknown

    // For Record Type Handling
    @track _objectInfo;
    @track selectedRecordTypeId;

    // For Owner Handling (OwnerId is polymorphic — User or Queue — so
    // lightning-input-field always renders it read-only; we use our own picker)
    @track selectedOwnerId;
    @track ownerPickerMode = 'User';
    @track ownerEditMode = false;
    ownerDirty = false;

    // Inline save-error banner ({title, items:[{key,text}], hasItems}) — rendered by us
    // instead of <lightning-messages> so the text wraps inside the card instead of
    // overflowing it (the platform component's markup lives in a shadow root we can't style).
    @track saveError;

    // Inline notice shown under the owner field (toasts can be missed / hidden in consoles)
    @track ownerNotice;
    @track ownerNoticeIsError = false;
    _ownerNoticeTimer;

    // For isOpenProblem lookup fields
    @track openProblemValues = {};   // apiName -> selected Case Id
    @track openProblemLabels = {};   // apiName -> display label (CaseNumber — Subject)
    openProblemDirty = false;

    // For isUrl fields (empty -> paste input, saved -> clickable link + ×)
    @track urlValues = {};    // apiName -> current URL string
    @track urlEditMode = {};  // apiName -> true while the user is entering a value
    urlDirty = false;

    // For isUrlList fields (multiple labeled links stored as JSON)
    @track urlListValues = {};  // apiName -> [{id,label,url}]
    urlListDirty = false;
    _urlSeq = 1;

    // Add/Edit-link modal (used for both adding and editing a link)
    @track linkModalOpen = false;
    linkModalField = null;      // apiName the modal is acting on
    linkModalId = null;         // id being edited, or null when adding
    @track linkModalLabel = '';
    @track linkModalUrl = '';

    // Shared state for the open-problem modal picker (one open at a time)
    @track isProblemModalOpen = false;
    @track problemPickerOpenFor = null; // apiName the modal is selecting for
    @track problemSearchTerm = '';
    @track problemResults = [];
    @track problemLoading = false;
    // Removable filter chips — both on by default; turning one off drops that
    // constraint from the query so any Case becomes reachable.
    @track problemFilterRecordType = true;
    @track problemFilterOpenOnly = true;
    _problemDebounce;

    connectedCallback() {
        if (this.ND_startCollapsed) {
            this.ND_isOpen = false;
        }
    }

    // --- 3. HELPERS ---
    get configObject() {
        try {
            return JSON.parse(this.ND_jsonConfigString);
        } catch (e) {
            return [];
        }
    }

    get isHeaderActive() {
        if (!this.ND_headerLogicField || !this.ND_recordData || !this.ND_headerActiveColor) return false;

        const field = this.ND_recordData.fields[this.ND_headerLogicField];
        if (!field || field.value === undefined) return false;

        const rawVal = field.value;

        // Multi-value check
        if (this.ND_headerLogicValue && this.ND_headerLogicValue.trim().length > 0) {
            const valStr = String(rawVal);
            const validValues = this.ND_headerLogicValue.split(',').map(v => v.trim());
            return validValues.includes(valStr);
        }

        // Strict Truthy check
        if (rawVal === 0 || rawVal === '0' || rawVal === false || rawVal === null) return false;

        return true;
    }

    // --- 4. DATA LOADING ---
    // getRecord fails the WHOLE request if any one field doesn't exist in the org,
    // and that failure would silently blank every widget backed by ND_recordData
    // (owner, isOpenProblem, isUrl, isUrlList) while the standard input fields kept
    // working — a very confusing way to fail. So we wait for the object describe and
    // drop unknown fields, warning about each one instead.
    get nd_wireFields() {
        if (!this.objectApiName) return undefined;
        if (!this._objectInfo || !this._objectInfo.fields) return undefined; // describe not in yet

        const known = this._objectInfo.fields;
        const fieldsToLoad = new Set();
        const skipped = new Set();

        const add = path => {
            if (!path) return;
            // Cross-object paths (e.g. Parent.Subject) are ours, not config-driven
            if (path.indexOf('.') === -1 && !known[path]) {
                skipped.add(path);
                return;
            }
            fieldsToLoad.add(`${this.objectApiName}.${path}`);
        };

        add(this.ND_headerLogicField);

        this.configObject.forEach(item => {
            add(item.apiName);
            if (item.isOpenProblem && item.apiName === 'ParentId' && this.objectApiName === 'Case') {
                add('Parent.Subject');
            }
            add(item.showIfField);
            if (item.color) {
                if (item.colorIfField) add(item.colorIfField);
                else if (item.colorIfValue !== undefined) add(item.apiName);
            }
        });

        if (skipped.size) {
            const signature = Array.from(skipped).sort().join(',');
            if (this._skippedFieldsWarned !== signature) {
                this._skippedFieldsWarned = signature;
                console.warn(
                    `nD_DynamicSection: these fields are in the config but do not exist on ${this.objectApiName} in this org, so they were skipped: ${signature}`
                );
            }
        }

        return Array.from(fieldsToLoad);
    }

    @wire(getObjectInfo, { objectApiName: '$objectApiName' })
    wiredObjectInfo({ error, data }) {
        if (data) {
            this._objectInfo = data;
        } else if (error) {
            console.error('Error getting object info', error);
        }
    }

    @wire(getRecord, { recordId: '$recordId', fields: '$nd_wireFields' })
    wiredRecord({ error, data }) {
        if (data) {
            this.ND_recordData = data;
            this._seedFromRecord(false);
        } else if (error) {
            // Never swallow this: without ND_recordData the owner / problem / link
            // widgets render empty even though the standard fields look fine.
            console.error('nD_DynamicSection: getRecord failed for fields', this.nd_wireFields, error);
        }
    }

    // Copies the record's saved values into the state behind our custom widgets
    // (record type, owner, isOpenProblem, isUrl, isUrlList). Normally seeds only
    // what is still unset, so a wire refresh can never clobber an in-flight edit;
    // Cancel calls it with force=true to overwrite the edits and go back to saved.
    _seedFromRecord(force) {
        const rec = this.ND_recordData;
        if (!rec) return;
        const fields = rec.fields || {};

        if (force || !this.selectedRecordTypeId) {
            if (rec.recordTypeId) {
                this.selectedRecordTypeId = rec.recordTypeId;
            } else if (fields.RecordTypeId) {
                this.selectedRecordTypeId = fields.RecordTypeId.value;
            }
        }

        // Owner picker (00G prefix = Queue)
        const ownerField = fields.OwnerId || null;
        if (ownerField && ownerField.value && (force || !this.selectedOwnerId)) {
            this.selectedOwnerId = ownerField.value;
            this.ownerPickerMode = String(ownerField.value).startsWith('00G') ? 'Queue' : 'User';
        }

        this.configObject.forEach(item => {
            // isOpenProblem — displayValue on a lookup is the related record's name
            if (item.isOpenProblem && (force || this.openProblemValues[item.apiName] === undefined)) {
                const field = fields[item.apiName];
                const problemTitle = item.apiName === 'ParentId' && this.objectApiName === 'Case'
                    ? getFieldValue(rec, 'Case.Parent.Subject')
                    : null;
                this.openProblemValues = {
                    ...this.openProblemValues,
                    [item.apiName]: field ? (field.value || null) : null
                };
                this.openProblemLabels = {
                    ...this.openProblemLabels,
                    [item.apiName]: problemTitle || (field ? (field.displayValue || null) : null)
                };
            }
            // isUrl — the saved value
            if (item.isUrl && (force || this.urlValues[item.apiName] === undefined)) {
                const field = fields[item.apiName];
                this.urlValues = {
                    ...this.urlValues,
                    [item.apiName]: field ? (field.value || '') : ''
                };
            }
            // isUrlList — parse JSON (or a legacy plain URL)
            if (item.isUrlList && (force || this.urlListValues[item.apiName] === undefined)) {
                const field = fields[item.apiName];
                this.urlListValues = {
                    ...this.urlListValues,
                    [item.apiName]: this._parseUrlList(field ? field.value : '')
                };
            }
        });
    }

    get recordTypeOptions() {
        if (!this._objectInfo || !this._objectInfo.recordTypeInfos) return [];
        return Object.values(this._objectInfo.recordTypeInfos)
            .filter(rt => rt.available && !rt.master)
            .map(rt => ({ label: rt.name, value: rt.recordTypeId }));
    }

    get ownerModeOptions() {
        return [
            { label: 'User', value: 'User' },
            { label: 'Queue', value: 'Queue' }
        ];
    }

    get isOwnerModeUser() {
        return this.ownerPickerMode === 'User';
    }

    // Hide the "take it!" shortcut when the running user already owns the record
    get isOwnedByCurrentUser() {
        const ownerField = this.ND_recordData && this.ND_recordData.fields
            ? this.ND_recordData.fields.OwnerId
            : null;
        return !!ownerField && ownerField.value === USER_ID;
    }

    get queueFilter() {
        return { criteria: [{ fieldPath: 'Type', operator: 'eq', value: 'Queue' }] };
    }

    get problemHasResults() {
        return this.problemResults && this.problemResults.length > 0;
    }

    // Filter chip styling / icon — active chips carry an "×" to remove,
    // inactive chips a "+" to re-apply.
    get recordTypeChipClass() {
        return this.problemFilterRecordType ? 'nd-chip nd-chip_active' : 'nd-chip';
    }
    get recordTypeChipIcon() {
        return this.problemFilterRecordType ? 'utility:close' : 'utility:add';
    }
    get openOnlyChipClass() {
        return this.problemFilterOpenOnly ? 'nd-chip nd-chip_active' : 'nd-chip';
    }
    get openOnlyChipIcon() {
        return this.problemFilterOpenOnly ? 'utility:close' : 'utility:add';
    }

    // --- 5. VISUAL LOGIC ---
    get computedTitle() {
        let titleRaw = this.ND_sectionTitle;
        if (!this.ND_recordData) return titleRaw;

        return titleRaw.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, fieldApiName) => {
            const fieldData = this.ND_recordData.fields[fieldApiName];
            return fieldData ? fieldData.value : '';
        });
    }

    get ND_headerStyle() {
        let finalColor = this.ND_headerBackgroundColor;
        if (this.isHeaderActive) finalColor = this.ND_headerActiveColor;
        return `background: linear-gradient(135deg, ${finalColor} 0%, ${finalColor} 80%, #000000 100%);`;
    }

    get ND_titleStyle() {
        let finalColor = this.ND_headerTextColor;
        if (this.isHeaderActive && this.ND_headerActiveTextColor) finalColor = this.ND_headerActiveTextColor;
        return `color: ${finalColor}; font-weight: 600;`;
    }

    get saveButtonLabel() {
        return this.isSaving ? 'Saving…' : 'Save';
    }

    get takeLinkLabel() {
        return this.isTakingOwnership ? 'taking…' : 'take it!';
    }

    get takeLinkClass() {
        return this.isTakingOwnership ? 'nd-take-link nd-take-link_busy' : 'nd-take-link';
    }

    get ND_chevronIcon() {
        return this.ND_isOpen ? 'utility:chevronup' : 'utility:chevrondown';
    }

    // Parse an isUrlList field value into [{id,label,url}]. Accepts a JSON array
    // ([{label,url}]) or a legacy plain/whitespace-separated URL string, so the
    // switch from a URL field is seamless.
    _parseUrlList(raw) {
        const out = [];
        if (!raw) return out;
        const s = String(raw).trim();
        if (s.charAt(0) === '[') {
            try {
                const arr = JSON.parse(s);
                if (Array.isArray(arr)) {
                    arr.forEach(o => {
                        if (o && o.url) out.push({ id: this._urlSeq++, label: o.label || o.url, url: o.url });
                    });
                    return out;
                }
            } catch (e) {
                // not valid JSON — fall through to legacy handling
            }
        }
        s.split(/[\s,]+/).filter(Boolean).forEach(u => out.push({ id: this._urlSeq++, label: u, url: u }));
        return out;
    }

    _normalizeHref(u) {
        return /^https?:\/\//i.test(u) ? u : 'https://' + u;
    }

    // --- 6. FIELD LIST RENDERING ---
    get ND_finalFieldList() {
        const config = this.configObject;
        return config.map(item => {
            // A. Visibility Logic
            let isVisible = true;
            // A field the org doesn't have can't be rendered — lightning-input-field
            // would error on it. Skip the row (nd_wireFields logs which ones).
            if (item.apiName && this._objectInfo && this._objectInfo.fields
                && !this._objectInfo.fields[item.apiName]) {
                isVisible = false;
            }
            if (isVisible && item.showIfField) {
                if (!this.ND_recordData || !this.ND_recordData.fields[item.showIfField]) {
                    isVisible = false;
                } else {
                    const fieldVal = this.ND_recordData.fields[item.showIfField].value;
                    if (item.showIfValue !== undefined) isVisible = (fieldVal === item.showIfValue);
                    else isVisible = !!fieldVal;
                }
            }

            // B. Conditional alert logic
            let isAlertActive = false;
            if (item.color) {
                const logicField = item.colorIfField || (item.colorIfValue !== undefined ? item.apiName : null);

                if (!logicField) {
                    isAlertActive = true;
                } else if (this.ND_recordData && this.ND_recordData.fields[logicField]) {
                    const val = this.ND_recordData.fields[logicField].value;

                    if (item.colorIfValue !== undefined) {
                        const valStr = String(val);
                        const validValues = String(item.colorIfValue).split(',').map(v => v.trim());
                        isAlertActive = validValues.includes(valStr);
                    } else {
                        isAlertActive = !!val;
                    }
                }
            }

            // C. Layout Logic
            let sizeClass = 'slds-size_1-of-2';

            if (this.ND_layoutType === '1 Column' || item.colSpan === 2) {
                sizeClass = 'slds-size_1-of-1';
            }

            const cssClass = `slds-col ${sizeClass} nd-field-row`;

            // D. Record-Link corner icon (isRecordLink only — isUrl renders its
            // own clickable link/paste widget, no corner icon)
            let recordLinkId = null;
            if (item.isRecordLink === true && this.ND_recordData && this.ND_recordData.fields[item.apiName]) {
                recordLinkId = this.ND_recordData.fields[item.apiName].value;
            }

            const hasIcon = !!recordLinkId;
            const contentCssClass = [
                'nd-field-content',
                isAlertActive ? 'nd-field-content_alert' : '',
                isAlertActive && !item.editable ? 'nd-field-content_alert-readonly' : '',
                hasIcon ? 'nd-field-content_has-corner-icon' : ''
            ].filter(Boolean).join(' ');
            const customStyle = isAlertActive ? `--nd-alert-color: ${item.color};` : '';

            const isOwner = item.apiName === 'OwnerId';
            const isOpenProblem = item.isOpenProblem === true;

            // E. isUrl widget state
            const isUrl = item.isUrl === true;
            const urlValue = isUrl ? (this.urlValues[item.apiName] || '') : '';
            const urlEditing = isUrl && !!this.urlEditMode[item.apiName];

            // F. isUrlList widget state
            const isUrlList = item.isUrlList === true;
            const listRaw = isUrlList ? (this.urlListValues[item.apiName] || []) : [];
            const urlListItems = listRaw.map(it => ({
                id: it.id,
                key: it.id,
                label: it.label || it.url,
                url: it.url,
                href: this._normalizeHref(it.url)
            }));

            return {
                apiName: item.apiName,
                customLabel: item.label || (isOwner && item.editable ? 'Owner' : null),
                isVisible: isVisible,
                style: customStyle,
                cssClass: cssClass,
                contentCssClass: contentCssClass,
                editable: item.editable || false,
                key: item.apiName,
                isRecordType: item.apiName === 'RecordTypeId',
                isOwner: isOwner,
                isOpenProblem: isOpenProblem,
                hasSelectedProblem: isOpenProblem && !!this.openProblemValues[item.apiName],
                selectedProblemId: isOpenProblem ? (this.openProblemValues[item.apiName] || null) : null,
                selectedProblemLabel: isOpenProblem ? (this.openProblemLabels[item.apiName] || this.openProblemValues[item.apiName] || '') : '',
                pickerPlaceholder: item.placeholder || 'Search Problems',
                isUrl: isUrl,
                urlValue: urlValue,
                urlHref: urlValue ? (/^https?:\/\//i.test(urlValue) ? urlValue : 'https://' + urlValue) : '',
                urlPlaceholder: item.placeholder || 'Paste a URL…',
                showUrlLink: isUrl && !!urlValue && !urlEditing,
                showUrlInput: isUrl && (!urlValue || urlEditing),
                isUrlList: isUrlList,
                urlListItems: urlListItems,
                urlListHasItems: urlListItems.length > 0,
                hasRecordLink: !!recordLinkId,
                recordLinkId: recordLinkId
            };
        });
    }

    ND_toggleSection() {
        this.ND_isOpen = !this.ND_isOpen;
    }

    ND_handleFieldChange(event) {
        if (this._restoring) return;
        this.isDirty = true;
    }

    // --- isUrl widget ---
    ND_handleUrlFocus(event) {
        const apiName = event.currentTarget.dataset.field;
        this.urlEditMode = { ...this.urlEditMode, [apiName]: true };
    }

    ND_handleUrlInput(event) {
        if (this._restoring) return;
        const apiName = event.currentTarget.dataset.field;
        this.urlValues = { ...this.urlValues, [apiName]: event.target.value };
        this.urlDirty = true;
        this.isDirty = true;
    }

    ND_handleUrlClear(event) {
        const apiName = event.currentTarget.dataset.field;
        this.urlValues = { ...this.urlValues, [apiName]: '' };
        this.urlEditMode = { ...this.urlEditMode, [apiName]: true }; // reveal the empty paste input
        this.urlDirty = true;
        this.isDirty = true;
    }

    // --- isUrlList widget (multiple labeled links via a pop-out modal) ---
    get linkModalTitle() {
        return this.linkModalId ? 'Edit link' : 'Add link';
    }

    ND_urlListAddOpen(event) {
        this.linkModalField = event.currentTarget.dataset.field;
        this.linkModalId = null;
        this.linkModalLabel = '';
        this.linkModalUrl = '';
        this.linkModalOpen = true;
    }

    ND_urlListEditOpen(event) {
        const apiName = event.currentTarget.dataset.field;
        const id = Number(event.currentTarget.dataset.id);
        const link = (this.urlListValues[apiName] || []).find(it => it.id === id);
        this.linkModalField = apiName;
        this.linkModalId = id;
        // Show a blank Label (placeholder) when it's only the URL fallback, so the
        // user isn't editing the URL out of the Label field
        this.linkModalLabel = link && link.label && link.label !== link.url ? link.label : '';
        this.linkModalUrl = link ? link.url : '';
        this.linkModalOpen = true;
    }

    ND_linkModalLabelChange(event) {
        this.linkModalLabel = event.target.value;
    }

    ND_linkModalUrlChange(event) {
        this.linkModalUrl = event.target.value;
    }

    ND_urlListModalCancel() {
        this.linkModalOpen = false;
    }

    ND_urlListModalSave() {
        const url = String(this.linkModalUrl || '').trim();
        if (!url) {
            const urlEl = this.template.querySelector('[data-role="linkmodal-url"]');
            if (urlEl) {
                urlEl.focus();
                if (urlEl.reportValidity) urlEl.reportValidity();
            }
            return; // a link must have a URL
        }
        const label = String(this.linkModalLabel || '').trim() || url;
        const apiName = this.linkModalField;
        let list = (this.urlListValues[apiName] || []).slice();
        if (this.linkModalId) {
            list = list.map(it => (it.id === this.linkModalId ? { ...it, label: label, url: url } : it));
        } else {
            list.push({ id: this._urlSeq++, label: label, url: url });
        }
        this.urlListValues = { ...this.urlListValues, [apiName]: list };
        this.urlListDirty = true;
        this.isDirty = true;
        this.linkModalOpen = false;
    }

    ND_urlListRemove(event) {
        const apiName = event.currentTarget.dataset.field;
        const id = Number(event.currentTarget.dataset.id);
        const list = (this.urlListValues[apiName] || []).filter(it => it.id !== id);
        this.urlListValues = { ...this.urlListValues, [apiName]: list };
        this.urlListDirty = true;
        this.isDirty = true;
    }

    // Navigates to a record page from a stored Salesforce Id. Salesforce derives
    // the target object from the Id prefix and uses the org's own Lightning
    // domain, so this works in any sandbox/prod org with no hardcoded URL.
    ND_handleOpenRecord(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id;
        if (!recordId) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: recordId,
                actionName: 'view'
            }
        });
    }

    ND_handleRecordTypeChange(event) {
        if (this._restoring) return;
        this.selectedRecordTypeId = event.detail.value;
        this.isDirty = true;
    }

    // --- Open-problem modal picker ---
    ND_openProblemModal(event) {
        this.problemPickerOpenFor = event.currentTarget.dataset.field;
        this.problemSearchTerm = '';
        this.problemResults = [];
        // Reset chips to the default (Problem + Open only) each time it opens
        this.problemFilterRecordType = true;
        this.problemFilterOpenOnly = true;
        this.isProblemModalOpen = true;
        this._loadProblems();
    }

    ND_toggleFilterRecordType() {
        this.problemFilterRecordType = !this.problemFilterRecordType;
        this._loadProblems();
    }

    ND_toggleFilterOpenOnly() {
        this.problemFilterOpenOnly = !this.problemFilterOpenOnly;
        this._loadProblems();
    }

    ND_handleProblemSearch(event) {
        this.problemSearchTerm = event.target.value;
        if (this._problemDebounce) clearTimeout(this._problemDebounce);
        this._problemDebounce = setTimeout(() => this._loadProblems(), PROBLEM_SEARCH_DEBOUNCE_MS);
    }

    _loadProblems() {
        this.problemLoading = true;
        getOpenProblems({
            searchTerm: this.problemSearchTerm,
            recordTypeDeveloperName: this.problemFilterRecordType ? PROBLEM_RECORD_TYPE_DEVELOPER_NAME : null,
            excludedStatuses: this.problemFilterOpenOnly ? PROBLEM_EXCLUDED_STATUSES : []
        })
            .then(rows => {
                this.problemResults = (rows || []).map(r => ({
                    id: r.Id,
                    caseNumber: r.CaseNumber,
                    subject: r.Subject,
                    status: r.Status,
                    label: r.Subject || r.CaseNumber
                }));
            })
            .catch(() => {
                this.problemResults = [];
            })
            .finally(() => {
                this.problemLoading = false;
            });
    }

    ND_handleProblemSelect(event) {
        const apiName = this.problemPickerOpenFor;
        if (!apiName) return;
        const { id, label } = event.currentTarget.dataset;
        this.openProblemValues = { ...this.openProblemValues, [apiName]: id };
        this.openProblemLabels = { ...this.openProblemLabels, [apiName]: label };
        this.openProblemDirty = true;
        this.isDirty = true;
        this.ND_closeProblemModal();
    }

    ND_handleProblemClear(event) {
        const apiName = event.currentTarget.dataset.field;
        this.openProblemValues = { ...this.openProblemValues, [apiName]: null };
        this.openProblemLabels = { ...this.openProblemLabels, [apiName]: null };
        this.openProblemDirty = true;
        this.isDirty = true;
    }

    ND_closeProblemModal() {
        this.isProblemModalOpen = false;
        this.problemPickerOpenFor = null;
        this.problemSearchTerm = '';
        this.problemResults = [];
    }

    ND_handleOwnerChange(event) {
        if (this._restoring) return;
        this.selectedOwnerId = event.detail.recordId;
        if (this.selectedOwnerId) {
            this.ownerDirty = true;
            this.isDirty = true;
            this.ownerEditMode = false;
        } else {
            // X-ing out the current owner reveals the User/Queue chooser
            this.ownerEditMode = true;
        }
    }

    ND_handleOwnerModeChange(event) {
        this.ownerPickerMode = event.detail.value;
        this.selectedOwnerId = null;
    }

    get ownerNoticeClass() {
        return this.ownerNoticeIsError
            ? 'nd-owner-notice nd-owner-notice_error'
            : 'nd-owner-notice nd-owner-notice_success';
    }

    _showOwnerNotice(message, isError) {
        this.ownerNotice = message;
        this.ownerNoticeIsError = isError;
        if (this._ownerNoticeTimer) clearTimeout(this._ownerNoticeTimer);
        this._ownerNoticeTimer = setTimeout(() => {
            this.ownerNotice = null;
        }, isError ? 8000 : 4000);
    }

    _clearOwnerNotice() {
        if (this._ownerNoticeTimer) {
            clearTimeout(this._ownerNoticeTimer);
            this._ownerNoticeTimer = undefined;
        }
        this.ownerNotice = null;
    }

    // Saves ownership to the current user immediately, without touching other edits
    ND_handleTakeOwnership() {
        if (this.isTakingOwnership) return; // ignore repeat clicks while in flight
        this.isTakingOwnership = true;
        updateRecord({ fields: { Id: this.recordId, OwnerId: USER_ID } })
            .then(() => {
                this.selectedOwnerId = USER_ID;
                this.ownerPickerMode = 'User';
                this.ownerEditMode = false;
                this.ownerDirty = false;
                this.isDirty = false;
                this._showOwnerNotice('✓ You are now the owner', false);
            })
            .catch(error => {
                let message = 'Could not take ownership';
                if (error.body && error.body.output && error.body.output.errors && error.body.output.errors.length > 0) {
                    message = error.body.output.errors[0].message;
                } else if (error.body && error.body.message) {
                    message = error.body.message;
                }
                this._showOwnerNotice(message, true);
            })
            .finally(() => {
                this.isTakingOwnership = false;
            });
    }

    // --- CANCEL HANDLER ---
    // Discards every unsaved edit: reset() puts each lightning-input-field back to
    // the value the form loaded, and _seedFromRecord(true) does the same for the
    // widgets we render ourselves.
    ND_handleCancel() {
        if (this.isSaving) return;

        // Restoring a value fires the same change events a user edit does, which
        // would immediately mark the form dirty again. Ignore them while we restore.
        this._restoring = true;

        this.template.querySelectorAll('lightning-input-field').forEach(field => {
            if (typeof field.reset === 'function') field.reset();
        });

        this._seedFromRecord(true);

        this.urlEditMode = {};      // saved URLs render as links again
        this.ownerEditMode = false;
        this._clearDirtyState();
        this.saveError = undefined;
        this._clearOwnerNotice();

        // Some of those change events land after this tick (base components fire
        // them on re-render), so drop the guard — and clear again — once they have.
        setTimeout(() => {
            this._restoring = false;
            this._clearDirtyState();
        }, 0);
    }

    _clearDirtyState() {
        this.isDirty = false;
        this.ownerDirty = false;
        this.openProblemDirty = false;
        this.urlDirty = false;
        this.urlListDirty = false;
    }

    // --- SUBMIT HANDLER ---
    ND_handleSubmit(event) {
        event.preventDefault();       // stop the form from submitting
        this.isSaving = true;         // show "Saving…" until success/error fires
        this.saveError = undefined;   // clear any banner from the previous attempt
        const fields = event.detail.fields;

        // If we have a selected record type ID, inject it
        if (this.selectedRecordTypeId) {
            fields.RecordTypeId = this.selectedRecordTypeId;
        }

        // Only send OwnerId when the user actually picked a new owner, so saves by
        // users without transfer permission don't fail on an untouched field
        if (this.ownerDirty && this.selectedOwnerId) {
            fields.OwnerId = this.selectedOwnerId;
        }

        // Inject any changed isOpenProblem lookups (null clears the value)
        if (this.openProblemDirty) {
            Object.keys(this.openProblemValues).forEach(apiName => {
                fields[apiName] = this.openProblemValues[apiName];
            });
        }

        // Inject any changed isUrl fields (empty string clears the value)
        if (this.urlDirty) {
            Object.keys(this.urlValues).forEach(apiName => {
                fields[apiName] = this.urlValues[apiName];
            });
        }

        // Inject any changed isUrlList fields as JSON (empty list clears the value)
        if (this.urlListDirty) {
            Object.keys(this.urlListValues).forEach(apiName => {
                const arr = (this.urlListValues[apiName] || []).map(it => ({ label: it.label, url: it.url }));
                fields[apiName] = arr.length ? JSON.stringify(arr) : '';
            });
        }

        this.template.querySelector('lightning-record-edit-form').submit(fields);
    }

    // --- ERROR HANDLER ---
    ND_handleError(event) {
        this.isSaving = false;
        console.log('FULL ERROR DETAILS:', JSON.parse(JSON.stringify(event.detail || {})));

        this.saveError = this._buildSaveError(event.detail);

        const evt = new ShowToastEvent({
            title: 'Error saving record',
            message: this.saveError.items.length
                ? this.saveError.items.map(i => i.text).join(' ')
                : this.saveError.title,
            variant: 'error',
        });
        this.dispatchEvent(evt);
    }

    ND_dismissError() {
        this.saveError = undefined;
    }

    // Flatten the record-edit-form error payload into {title, items[]} — a headline
    // plus one bullet per underlying validation/field error, like the standard UI.
    _buildSaveError(detail) {
        const d = detail || {};
        const out = d.output || {};
        const items = [];
        const seen = new Set();

        const add = text => {
            const t = (text || '').trim();
            if (t && !seen.has(t)) {
                seen.add(t);
                items.push({ key: `e${items.length}`, text: t });
            }
        };

        (out.errors || []).forEach(e => add(e.message));

        const fieldErrors = out.fieldErrors || {};
        Object.keys(fieldErrors).forEach(apiName => {
            (fieldErrors[apiName] || []).forEach(e => {
                const label = e.fieldLabel || apiName;
                add(e.message ? `${label}: ${e.message}` : label);
            });
        });

        (d.pageErrors || []).forEach(e => add(e.message));

        if (!items.length) add(d.detail);

        const title = (d.message || '').trim() || 'We hit a snag.';
        // Don't repeat the headline as its own bullet
        const filtered = items.filter(i => i.text !== title);

        return {
            title,
            items: filtered,
            hasItems: filtered.length > 0
        };
    }

    ND_handleSuccess(event) {
        this.isSaving = false;
        this.saveError = undefined;
        this.isDirty = false;
        this.ownerDirty = false;
        this.ownerEditMode = false;
        this.openProblemDirty = false;
        this.urlDirty = false;
        this.urlEditMode = {}; // saved values now render as links again
        this.urlListDirty = false;
        const evt = new ShowToastEvent({
            title: 'Success',
            message: 'Record updated successfully',
            variant: 'success',
        });
        this.dispatchEvent(evt);
    }
}
