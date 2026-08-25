import { LightningElement, api, wire, track } from 'lwc';
import { getFieldValue, getRecord, updateRecord } from 'lightning/uiRecordApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import USER_ID from '@salesforce/user/Id';
import getOpenProblems from '@salesforce/apex/ND_ProblemPicker.getOpenProblems';
import resolveEmails from '@salesforce/apex/ND_EmailResolver.resolveEmails';
import {
    isBlank,
    isDivider,
    isRowVisible,
    holds,
    siteByKey,
    conditionsOf,
    watchedFieldsOf,
    DEFAULT_ALERT_COLOR,
    validateConfig,
    validateSection,
    parseConfig,
    resolveSectionSettings
} from 'c/nD_sectionConfigSchema';

// --- "isOpenProblem" lookup: baked-in business rule so it never has to be
// redefined in the JSON config. Problems are Cases of this record type (matched
// by developer name, which is stable across label renames/translations) whose
// Status is none of the closed-equivalent values.
const PROBLEM_RECORD_TYPE_DEVELOPER_NAME = 'AVB_Problem_Case';
const PROBLEM_EXCLUDED_STATUSES = ['Closed', 'Merged'];
const PROBLEM_SEARCH_DEBOUNCE_MS = 300;

// Where the section points anyone who has to configure it. Hardcoded on purpose: it was
// briefly an App Builder property, which meant an input box in the panel that nobody
// should type in, and properties are painfully hard to remove once added.
const BUILDER_URL = '/lightning/n/ND_Section_Config_Builder';

// --- "take it!" pre-flight. Accepting a case out of the Service Queue makes
// AVB_Case_Flow_After_Update set Status to Open, which starts the SLA clock, and the
// org's validation rules demand certain fields at that moment. Without a pre-flight the
// save fails inside the flow with a FIELD_CUSTOM_VALIDATION_EXCEPTION that names no
// field, and only for non-admin profiles, since the rules exempt
// AVB_System_Administrator.
//
// WHICH fields those are is configuration, not a constant: it differs per record type
// and per Issue Type, and it moves whenever an admin edits a validation rule. Each
// field opts in from the JSON config with "requiredBeforeTakeover": true and nothing is
// required by default. See c/nD_sectionConfigSchema for the full key list — that module
// is the one place a key is defined, documented and validated.
//
// A row hidden by showIfField, or absent from the org, is never demanded: the user would
// have nowhere to fill it in. That is what scopes Environment to AvioBook cases, whose
// row is already showIfField-ed to that record type. The previous hardcoded list had no
// such scoping and so demanded Environment on AvioData cases too.

export default class ND_DynamicSection extends NavigationMixin(LightningElement) {
    // --- 1. CONFIGURATION PROPERTIES ---
    @api recordId;
    @api objectApiName;

    // The whole configuration: section settings AND field rows, so the section is a single
    // artefact the Config Builder composes.
    @api ND_jsonConfigString = '';


    // --- 2. INTERNAL STATE ---
    @track ND_isOpen = true;
    @track ND_recordData;
    @track isDirty = false;
    // On-screen values of fields that a showIfField condition watches, so conditional rows
    // react to an edit before it is saved.
    @track liveValues = {};
    @track isSaving = false;            // form save in flight
    _restoring = false;                 // true while Cancel puts values back (suppresses change handlers)
    _recomputeQueued = false;           // guards against stacking dirty recomputes on rapid wire refreshes
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

    // For isEmailList fields (comma-separated addresses shown as people)
    @track emailListValues = {};     // apiName -> [address, ...] in stored order
    @track emailListExpanded = {};   // apiName -> true while the roster is open
    @track emailDirectory = {};      // lowercased address -> resolved person from Apex
    @track emailListDraft = {};      // apiName -> value being typed into the add box
    @track emailListError = {};      // apiName -> message for addresses we refused
    emailListDirty = false;
    _emailsRequested = new Set();    // addresses already sent to Apex, so we ask once

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
        if (this.sectionSettings.startCollapsed) {
            this.ND_isOpen = false;
        }
    }

    // --- 3. HELPERS ---
    // The parsed document. Accepts both shapes: the current {section, fields} and the
    // original bare array of field rows, which every page used before the section
    // settings moved into the JSON.
    get _parsedConfig() {
        const raw = (this.ND_jsonConfigString || '').trim();
        if (!raw) return { rows: [], section: {}, error: '' };

        const result = parseConfig(raw);
        if (result.error) return { rows: [], section: {}, error: result.error };
        return { rows: result.rows, section: result.section, error: '' };
    }

    get configObject() {
        return this._parsedConfig.rows;
    }

    /**
     * Section settings from the JSON, with the registry's defaults filling any gaps.
     *
     * There is no other source. The App Builder properties that used to supply these were
     * removed once every page had been migrated, which required taking the component off
     * all 8 hosting pages first — the platform will not drop a property tag while the
     * component is present anywhere.
     */
    get sectionSettings() {
        return resolveSectionSettings(this._parsedConfig.section);
    }

    get resolvedIcon() {
        return this.sectionSettings.icon;
    }

    // Nothing configured at all. Rather than render an empty card with no explanation,
    // point whoever just dropped the component at the tool that configures it.
    /**
     * True in the App Builder canvas.
     *
     * WHY it has to be detected at all: dragging the component there killed the page with
     * "Cannot read properties of undefined (reading 'def')". The canvas builds its drag ghost
     * with jQuery cloneNode, and `lightning-base-combobox` is form-associated, so cloning one
     * fires formAssociatedCallback against a clone that has no LWC VM. On a Case page this
     * component renders six of them — every editable picklist, the record-type picker and the
     * owner picker — and on the pages checked it was the ONLY source of them, which is why it
     * looks like our bug rather than the platform's. Rendering read-only in the canvas creates
     * none, so there is nothing for the clone to choke on.
     *
     * HOW: not by the absence of a recordId — App Builder supplies a real one, so the canvas
     * shows live data (verified in UAT: it passed 500UB00000WiFqXYAV). The canvas is an iframe
     * served from /flexipageEditor/surface.app, and that path is the signal. It is a platform
     * detail rather than an API, so if Salesforce moves it this quietly stops working and the
     * crash returns — the failure mode is today's behaviour, not something worse.
     */
    get isDesignPreview() {
        try {
            return window.location.pathname.indexOf('/flexipageEditor/') === 0;
        } catch (e) {
            return false;
        }
    }

    get isUnconfigured() {
        return !this.configObject.length;
    }

    get builderUrl() {
        return BUILDER_URL;
    }

    // Record type names keyed by Id, for readable diagnostics. The UI API describe does
    // not expose developerName on recordTypeInfos, only name and recordTypeId.
    get _recordTypeNamesById() {
        if (!this._objectInfo || !this._objectInfo.recordTypeInfos) return null;
        const out = {};
        Object.values(this._objectInfo.recordTypeInfos).forEach(rt => {
            out[rt.recordTypeId] = rt.name;
        });
        return out;
    }

    // Config problems, from the shared registry. There is no longer any in-card display
    // for these — the Section Config Builder validates before anything is pasted — but
    // they still reach the browser console, which is the only signal available once a
    // config is live on a page.
    get configDiagnostics() {
        const raw = (this.ND_jsonConfigString || '').trim();
        if (!raw) return [];

        const parsed = this._parsedConfig;
        if (parsed.error) {
            return [{ level: 'error', name: 'Config', message: `${parsed.error} No fields will render.` }];
        }

        const ctx = {
            fields: this._objectInfo ? this._objectInfo.fields : null,
            recordTypes: this._recordTypeNamesById
        };
        return validateSection(parsed.section, ctx).concat(validateConfig(parsed.rows, ctx));
    }

    // Only warn when the set of problems actually changes: this getter chain re-runs on
    // every render.
    _warnAboutConfigOnce() {
        const all = this.configDiagnostics;
        const signature = all.map(d => `${d.level}:${d.name}:${d.message}`).join('|');
        if (this._configWarnSignature === signature) return;
        this._configWarnSignature = signature;
        if (!all.length) return;
        console.warn(
            `nD_DynamicSection "${this.sectionSettings.title}": ${all.length} config problem(s). ` +
            `Fix them in ${this.builderUrl}\n` +
            all.map(d => `  [${d.level}] ${d.name}: ${d.message}`).join('\n')
        );
    }

    renderedCallback() {
        this._warnAboutConfigOnce();
    }

    get isHeaderActive() {
        const settings = this.sectionSettings;
        if (!this.ND_recordData || !settings.alertColor) return false;
        return holds(settings, siteByKey('alertIf'), this._conditionContext);
    }

    /** What every condition site reads from. One place, so the four cannot disagree. */
    get _conditionContext() {
        return {
            fields: this._objectInfo ? this._objectInfo.fields : null,
            savedFields: this.ND_recordData ? this.ND_recordData.fields : null,
            liveValues: this.liveValues,
            selectedRecordTypeId: this.selectedRecordTypeId
        };
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

        this.configObject.forEach(item => {
            add(item.apiName);
            if (item.isOpenProblem && item.apiName === 'ParentId' && this.objectApiName === 'Case') {
                add('Parent.Subject');
            }
        });

        // Every field any condition watches, whichever of the four sites it belongs to.
        // A watched field is often not a row of its own — a take-it gate or an ICAO check
        // usually is not — so it has to be requested explicitly or it is never known.
        watchedFieldsOf(this.configObject, this.sectionSettings).forEach(add);

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
            this._recomputeDirtyAfterRefresh();
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
            // isEmailList — split the stored comma-separated string
            if (item.isEmailList && (force || this.emailListValues[item.apiName] === undefined)) {
                const field = fields[item.apiName];
                this.emailListValues = {
                    ...this.emailListValues,
                    [item.apiName]: this._parseEmailList(field ? field.value : '')
                };
            }
        });

        this._resolveKnownEmails();
    }

    // Reading the STORED value. Splits on the separators the field is written with
    // and keeps every non-empty token, including anything malformed, so a bad entry
    // stays visible and survives the next save instead of being silently dropped.
    _parseEmailList(raw) {
        if (!raw) return [];
        return String(raw)
            .split(/[,;\n\r]+/)
            .map(part => part.trim())
            .filter(part => part.length > 0);
    }

    // Reading TYPED or PASTED input, which is far messier than the stored value:
    // separated by commas, semicolons, spaces or newlines, and often carrying
    // Outlook display names ("Pater, Jean-Michel" <jm@x.example>; ...). Splitting on a
    // separator can't handle those, so pull out the address-shaped tokens instead.
    _extractEmails(raw) {
        if (!raw) return [];
        const found = String(raw).match(/[^\s<>,;"']+@[^\s<>,;"']+/g) || [];
        const seen = new Set();
        const out = [];
        found.forEach(token => {
            // A trailing dot or bracket picked up from prose is not part of the address
            const email = token.replace(/[.,;:>)\]]+$/, '');
            const key = email.toLowerCase();
            if (email && !seen.has(key)) {
                seen.add(key);
                out.push(email);
            }
        });
        return out;
    }

    // The allowedDomains config value, lowercased. Empty list means no restriction.
    _allowedDomainsFor(apiName) {
        const item = this.configObject.find(i => i.apiName === apiName);
        if (!item || !item.allowedDomains) return [];
        return String(item.allowedDomains)
            .split(',')
            .map(d => d.trim().toLowerCase().replace(/^@/, ''))
            .filter(d => d.length > 0);
    }

    // Splits an address and checks the domain against allowedDomains. A sandbox
    // refresh appends ".invalid" to every stored address, so that suffix is
    // ignored when comparing; it never occurs in production data.
    _emailDomainAllowed(email, allowed) {
        if (!allowed.length) return true;
        const at = String(email).lastIndexOf('@');
        if (at < 0) return false;
        const domain = String(email)
            .slice(at + 1)
            .toLowerCase()
            .replace(/\.invalid$/, '');
        return allowed.includes(domain);
    }

    _looksLikeEmail(email) {
        // Deliberately requires a 2+ letter TLD: andy@kd.c is a typo, not an address
        return /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/.test(String(email).replace(/\.invalid$/, ''));
    }

    // Sends any address we haven't resolved yet to Apex and merges the answers
    // into emailDirectory. Addresses are asked about once per component instance.
    _resolveKnownEmails() {
        const wanted = [];
        Object.keys(this.emailListValues).forEach(apiName => {
            (this.emailListValues[apiName] || []).forEach(email => {
                const key = email.toLowerCase();
                if (!this._emailsRequested.has(key)) {
                    this._emailsRequested.add(key);
                    wanted.push(email);
                }
            });
        });
        if (!wanted.length) return;

        resolveEmails({ emails: wanted })
            .then(people => {
                const merged = { ...this.emailDirectory };
                (people || []).forEach(person => {
                    merged[person.email.toLowerCase()] = person;
                });
                this.emailDirectory = merged;
            })
            .catch(error => {
                // Unresolved is a first-class state, so a failure here degrades to
                // plain addresses rather than breaking the field.
                console.error('nD_DynamicSection: could not resolve collaborator emails', error);
                wanted.forEach(email => this._emailsRequested.delete(email.toLowerCase()));
            });
    }

    // One entry per address: photo when there is a real one, initials otherwise.
    _buildEmailList(apiName, canEdit) {
        const addresses = this.emailListValues[apiName] || [];
        const rows = addresses.map((email, index) => {
            const person = this.emailDirectory[email.toLowerCase()];
            const resolved = !!(person && person.resolved);
            const initials = person && person.initials ? person.initials : this._initialsFromEmail(email);
            const photoUrl = person && person.photoUrl ? person.photoUrl : null;
            return {
                key: `${apiName}-${index}`,
                email: email,
                name: resolved ? person.name : email,
                subtitle: resolved ? person.subtitle : 'Not in Salesforce',
                recordId: resolved ? person.recordId : null,
                hasLink: !!(resolved && person.recordId),
                initials: initials,
                photoUrl: photoUrl,
                hasPhoto: !!photoUrl,
                avatarClass: this._avatarClass(email, person, !!photoUrl),
                isUnresolved: !resolved
            };
        });

        const expanded = !!this.emailListExpanded[apiName];
        const CLUSTER_MAX = 6;
        const domains = new Set(
            addresses.map(e => (e.indexOf('@') > -1 ? e.split('@').pop().toLowerCase() : e.toLowerCase()))
        );
        const overflow = rows.length - CLUSTER_MAX;

        const unresolved = rows.filter(r => r.isUnresolved).length;

        return {
            rows: rows,
            cluster: rows.slice(0, CLUSTER_MAX),
            hasOverflow: overflow > 0,
            overflowLabel: `+${overflow}`,
            count: rows.length,
            hasAny: rows.length > 0,
            countLabel: rows.length === 1 ? '1 person' : `${rows.length} people`,
            metaLabel: unresolved
                ? `${domains.size === 1 ? '1 organisation' : `${domains.size} organisations`}, ${unresolved} not in Salesforce`
                : (domains.size === 1 ? '1 organisation' : `${domains.size} organisations`),
            expanded: expanded,
            rosterHidden: !expanded,
            canEdit: canEdit === true,
            error: this.emailListError[apiName] || null,
            hasError: !!this.emailListError[apiName],
            showEmptyAdd: rows.length === 0 && canEdit === true && !expanded,
            showEmptyText: rows.length === 0 && canEdit !== true,
            draft: this.emailListDraft[apiName] || ''
        };
    }

    _initialsFromEmail(email) {
        const local = String(email || '').split('@')[0];
        const tokens = local.split(/[._\-+]/).filter(t => /^[a-z]/i.test(t));
        if (!tokens.length) return '?';
        if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
        return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
    }

    // Photos need no tint. Otherwise colour carries the one thing initials can't:
    // whether this is staff, a known customer contact, or nobody we have on file.
    _avatarClass(email, person, hasPhoto) {
        if (hasPhoto) return 'nd-avatar nd-avatar_photo';
        if (person && person.resolved) {
            return person.objectType === 'User'
                ? 'nd-avatar nd-avatar_user'
                : 'nd-avatar nd-avatar_contact';
        }
        return 'nd-avatar nd-avatar_unknown';
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

    /**
     * Only internal, active users can be offered as an owner.
     *
     * Unfiltered, the picker searched every User the running user can see, and PROD has
     * 400 active community (CspLitePortal) users to 40 internal ones — so typing a name
     * that exists on both sides buried the colleague among portal contacts. UserType
     * 'Standard' is exactly the internal licences (Salesforce, Salesforce Platform);
     * every community licence has its own UserType, as do Guest and the automated
     * accounts. Inactive users are dropped too — they cannot own a record, so offering
     * them only produces a save error.
     */
    get ownerUserFilter() {
        return {
            criteria: [
                { fieldPath: 'UserType', operator: 'eq', value: 'Standard' },
                { fieldPath: 'IsActive', operator: 'eq', value: true }
            ],
            filterLogic: '1 AND 2'
        };
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
    // A title may interpolate field values, e.g. "Details for {CaseNumber}".
    get computedTitle() {
        const titleRaw = this.sectionSettings.title || '';
        if (!this.ND_recordData) return titleRaw;

        return titleRaw.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, fieldApiName) => {
            const fieldData = this.ND_recordData.fields[fieldApiName];
            return fieldData ? fieldData.value : '';
        });
    }

    get ND_headerStyle() {
        const settings = this.sectionSettings;
        const finalColor = this.isHeaderActive ? settings.alertColor : settings.headerColor;
        return `background: linear-gradient(135deg, ${finalColor} 0%, ${finalColor} 80%, #000000 100%);`;
    }

    get ND_titleStyle() {
        const settings = this.sectionSettings;
        const finalColor = (this.isHeaderActive && settings.alertTextColor)
            ? settings.alertTextColor
            : settings.headerTextColor;
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
    // Whether a config row is on screen. The decision itself lives in the schema module
    // so it can be tested without mounting; this only gathers what it needs.
    _isRowVisible(item) {
        return isRowVisible(item, this._conditionContext);
    }

    get ND_finalFieldList() {
        const config = this.configObject;
        return config.map((item, index) => {
            // A. Visibility Logic
            const isVisible = this._isRowVisible(item);

            // A divider is a rule across the section, not a field, so none of the field view
            // model below applies to it. Visibility still does — the point of a captioned rule
            // is usually to head a group of rows that are themselves conditional.
            if (isDivider(item)) {
                const caption = String(item.divider === undefined ? '' : item.divider).trim();
                return {
                    // Dividers have no apiName to key on, and two unlabelled ones would
                    // collide, so the index is the only stable key.
                    key: `divider-${index}`,
                    isDivider: true,
                    isVisible: isVisible,
                    caption: caption,
                    hasCaption: !!caption,
                    // Always full width: half a rule across one column of two reads as a
                    // mistake rather than a divider.
                    cssClass: 'slds-col slds-size_1-of-1 nd-divider-row',
                    dividerClass: caption ? 'nd-divider nd-divider_captioned' : 'nd-divider'
                };
            }

            // B. Conditional alert logic
            // A row opts into the underline by naming a colour OR by having a condition for
            // one — either is a clear "underline this". It used to be the colour alone, which
            // meant a row with conditions and no colour was configured to underline and then
            // silently did not. Past the opt-in it is the same engine as everything else, so
            // it reacts to the live form value too rather than only to what is saved.
            const colorSite = siteByKey('colorIf');
            // Only FINISHED conditions count as opting in. An unfinished one — no field
            // chosen yet — is ignored by the engine, which then sees no conditions at all and
            // reports "always on" for this site. Counting it as an opt-in therefore underlined
            // the row the instant "add condition" was clicked, before anything was chosen.
            const colourConditions = conditionsOf(item, colorSite, item.apiName)
                .conditions.filter(c => !isBlank(c.field));
            const wantsUnderline = !!item.color || colourConditions.length > 0;
            const isAlertActive = wantsUnderline
                && holds(item, colorSite, this._conditionContext, item.apiName);
            const alertColor = item.color || DEFAULT_ALERT_COLOR;

            // C. Layout Logic
            let sizeClass = 'slds-size_1-of-2';

            if (this.sectionSettings.columns === 1 || item.colSpan === 2) {
                sizeClass = 'slds-size_1-of-1';
            }

            const cssClass = `slds-col ${sizeClass} nd-field-row`;

            // D. Record-Link corner icon (isRecordLink only — isUrl renders its
            // own clickable link/paste widget, no corner icon)
            let recordLinkId = null;
            if (item.isRecordLink === true && this.ND_recordData && this.ND_recordData.fields[item.apiName]) {
                recordLinkId = this.ND_recordData.fields[item.apiName].value;
            }

            const isOwner = item.apiName === 'OwnerId';
            const customLabel = item.label || (isOwner && item.editable ? 'Owner' : null);
            // The link icon sits beside the label when there IS one. Only the fallback corner
            // variant needs room reserved on the right.
            const hasIcon = !!recordLinkId && !customLabel;
            // The underline sits lower under a read-only value, so this has to follow how the
            // row actually RENDERS, not what the config asked for — in the App Builder canvas
            // an "editable" row renders read-only, and used to get the editable offset.
            const rowEditable = (item.editable || false) && !this.isDesignPreview;
            const contentCssClass = [
                'nd-field-content',
                isAlertActive ? 'nd-field-content_alert' : '',
                isAlertActive && !rowEditable ? 'nd-field-content_alert-readonly' : '',
                hasIcon ? 'nd-field-content_has-corner-icon' : ''
            ].filter(Boolean).join(' ');
            const customStyle = isAlertActive ? `--nd-alert-color: ${alertColor};` : '';

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

            // G. isEmailList widget state
            const isEmailList = item.isEmailList === true;
            const emailList = isEmailList ? this._buildEmailList(item.apiName, item.editable === true) : null;

            // H. Inline help text. lightning-input-field / lightning-output-field render
            // the field's help ⓘ themselves, and keep rendering it when
            // variant="label-hidden" hides their label — so it lands on its own line,
            // between our label and the value. Flagging the row lets the CSS float our
            // label so the icon flows up beside it. Only rows that actually render one of
            // those two components can produce the icon; every custom widget below draws
            // its own control and never shows one.
            // Only lightning-input-field draws the help button. lightning-output-field does
            // NOT — verified in UAT against a field that has inline help text — so a
            // read-only row was getting the floated label, with its nowrap and ellipsis, for
            // an icon that never appears. rowEditable rather than item.editable, because the
            // App Builder canvas renders everything read-only.
            const rendersBaseField = rowEditable
                && !(item.apiName === 'RecordTypeId' || isOwner || isOpenProblem
                    || isUrl || isUrlList || isEmailList);
            const described = this._objectInfo && this._objectInfo.fields
                ? this._objectInfo.fields[item.apiName]
                : null;
            const hasInlineHelp = rendersBaseField && !!(described && described.inlineHelpText);

            return {
                apiName: item.apiName,
                customLabel: customLabel,
                // Beside the label where there is one to sit beside; the base component draws
                // its own label inside its shadow DOM, so a row without a config label has
                // nowhere to put it and keeps the corner icon.
                hasLabelLink: !!recordLinkId && !!customLabel,
                hasCornerLink: !!recordLinkId && !customLabel,
                labelCssClass: hasInlineHelp
                    ? 'nd-custom-label nd-custom-label_inline-help'
                    : 'nd-custom-label',
                fieldCssClass: hasInlineHelp ? 'nd-help-field' : '',
                isVisible: isVisible,
                style: customStyle,
                cssClass: cssClass,
                contentCssClass: contentCssClass,
                // Read-only in the App Builder canvas: an editable picklist, owner picker or
                // record-type picker each mount a form-associated combobox, and the canvas
                // clones the DOM. Nothing there is meant to be edited anyway.
                editable: rowEditable,
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
                isEmailList: isEmailList,
                emailList: emailList,
                emailPlaceholder: item.placeholder || this._emailPlaceholderFor(item),
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

        // Record the live value so a conditional row reacts to the edit immediately rather
        // than waiting for a save. Only the fields something actually watches are kept, so
        // this stays a handful of entries however many rows the section has.
        this._noteLiveValue(event.target, event.detail);

        // On a cold load the form populates its own inputs and fires change for each
        // one. Until our wire lands there is nothing to compare against, and a user
        // cannot have edited a field that has only just been rendered, so treat these
        // as the form loading rather than guessing (guessing marked the section dirty
        // on every hard refresh). The recompute below settles it once data arrives.
        if (!this.ND_recordData) {
            this._recomputeDirtyAfterRefresh();
            return;
        }

        // A background write (email-to-case flow, process builder, another user)
        // refreshes the form, and reloading an input fires change exactly like a
        // user edit does. Dirty means "differs from what's saved", so compare.
        if (this._fieldDiffersFromSaved(event.target, event.detail)) {
            this.isDirty = true;
        }

        // Re-derive from the DOM either way: this event may have arrived before the
        // record data it should have been compared against.
        this._recomputeDirtyAfterRefresh();
    }

    /**
     * Remember the on-screen value of a field that a showIfField condition watches.
     *
     * Visibility used to read only the saved record, so picking a different record type
     * left rows scoped to the old one on screen until the save went through. Tracked state
     * rather than a DOM read at render time, because a getter that queries the DOM is not
     * reactive and would not re-run when the value changed.
     */
    _noteLiveValue(target, detail) {
        const apiName = target && target.fieldName;
        if (!apiName || !this._watchedFields.has(apiName)) return;

        const value = (detail && detail.value !== undefined) ? detail.value : target.value;
        this.liveValues = Object.assign({}, this.liveValues, { [apiName]: value });
    }

    // Every field any condition watches, so live tracking stays bounded to those.
    get _watchedFields() {
        return new Set(watchedFieldsOf(this.configObject, this.sectionSettings));
    }

    // True when the control's value differs from the saved record value. Errs
    // toward true: if the value can't be compared, treat it as a real edit so the
    // user is never left unable to save.
    _fieldDiffersFromSaved(target, detail) {
        const apiName = target && target.fieldName;
        const fields = this.ND_recordData && this.ND_recordData.fields;
        if (!apiName || !fields || !fields[apiName]) return true;

        const current = detail && Object.prototype.hasOwnProperty.call(detail, 'value')
            ? detail.value
            : target.value;
        return this._normalizeValue(current) !== this._normalizeValue(fields[apiName].value);
    }

    // null / undefined / '' all mean "empty" across the record API and the inputs
    _normalizeValue(value) {
        if (value === null || value === undefined || value === '') return '';
        return String(value);
    }

    // Recomputes isDirty by comparing every rendered input against the saved record.
    // Called after a wire refresh because the form and this wire both get their data
    // from LDS in no guaranteed order: if the form fired its change events before the
    // new record landed, the comparison in ND_handleFieldChange used stale saved
    // values and wrongly marked the section dirty. Deferred a tick so the form has
    // finished reloading its inputs.
    _recomputeDirtyAfterRefresh() {
        if (this._recomputeQueued) return;
        this._recomputeQueued = true;
        setTimeout(() => {
            this._recomputeQueued = false;
            if (this._restoring || this.isSaving) return;
            // Nothing to compare against yet. Leave isDirty alone; the wire calls
            // this again as soon as the record lands.
            if (!this.ND_recordData) return;

            // ownerDirty is verified against the record rather than trusted, because
            // the picker can raise a change event for a value we set ourselves. The
            // other widgets only ever flip their flag from a real click, and they hold
            // edits the record cannot confirm, so those are taken at face value.
            if (this.ownerDirty && this.selectedOwnerId !== this._savedOwnerId()) return;
            if (this.openProblemDirty || this.urlDirty || this.urlListDirty || this.emailListDirty) return;
            this.ownerDirty = this.ownerDirty && this.selectedOwnerId !== this._savedOwnerId();

            const edited = Array.from(this.template.querySelectorAll('lightning-input-field'))
                .some(field => this._fieldDiffersFromSaved(field, null));
            this.isDirty = edited;
        }, 0);
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

    // --- isEmailList widget ---
    ND_emailListToggle(event) {
        const apiName = event.currentTarget.dataset.field;
        this.emailListExpanded = {
            ...this.emailListExpanded,
            [apiName]: !this.emailListExpanded[apiName]
        };
    }

    ND_emailListRemove(event) {
        event.stopPropagation();
        const apiName = event.currentTarget.dataset.field;
        const email = event.currentTarget.dataset.email;
        const list = (this.emailListValues[apiName] || []).filter(
            e => e.toLowerCase() !== String(email).toLowerCase()
        );
        this.emailListValues = { ...this.emailListValues, [apiName]: list };
        this.emailListDirty = true;
        this.isDirty = true;
    }

    ND_emailListDraftChange(event) {
        const apiName = event.currentTarget.dataset.field;
        this.emailListDraft = { ...this.emailListDraft, [apiName]: event.target.value };
        if (this.emailListError[apiName]) {
            this.emailListError = { ...this.emailListError, [apiName]: null };
        }
    }

    ND_emailListDraftKey(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.ND_emailListAdd(event);
        }
    }

    ND_emailListAdd(event) {
        const apiName = event.currentTarget.dataset.field;
        // Accept a pasted block separated by , ; spaces or newlines, and tolerate
        // Outlook display names, not just one bare address at a time
        const draft = this.emailListDraft[apiName];
        const candidates = this._extractEmails(draft);
        if (!candidates.length) {
            // Something was typed but nothing address-shaped came out of it
            this.emailListError = {
                ...this.emailListError,
                [apiName]: String(draft || '').trim()
                    ? 'That does not look like an email address.'
                    : null
            };
            return;
        }

        const allowed = this._allowedDomainsFor(apiName);
        const list = (this.emailListValues[apiName] || []).slice();
        const seen = new Set(list.map(e => e.toLowerCase()));
        const rejected = [];
        let addedAny = false;

        candidates.forEach(email => {
            if (!this._looksLikeEmail(email) || !this._emailDomainAllowed(email, allowed)) {
                rejected.push(email);
                return;
            }
            if (!seen.has(email.toLowerCase())) {
                seen.add(email.toLowerCase());
                list.push(email);
                addedAny = true;
            }
        });

        if (addedAny) {
            this.emailListValues = { ...this.emailListValues, [apiName]: list };
            this.emailListDirty = true;
            this.isDirty = true;
            this.emailListExpanded = { ...this.emailListExpanded, [apiName]: true };
            this._resolveKnownEmails();
        }

        // Keep only what was refused in the box, so a mixed paste keeps the good
        // ones and leaves the rest in place to be corrected.
        this.emailListDraft = { ...this.emailListDraft, [apiName]: rejected.join(', ') };
        this.emailListError = {
            ...this.emailListError,
            [apiName]: rejected.length ? this._rejectionMessage(rejected, allowed) : null
        };
    }

    _emailPlaceholderFor(item) {
        const allowed = this._allowedDomainsFor(item.apiName);
        return allowed.length === 1
            ? `Add @${allowed[0]} address, or paste several`
            : 'Add address, or paste several';
    }

    _rejectionMessage(rejected, allowed) {
        const shown = rejected.slice(0, 3).join(', ');
        const more = rejected.length > 3 ? ` and ${rejected.length - 3} more` : '';
        if (allowed.length) {
            const domains = allowed.map(d => '@' + d).join(' or ');
            return `Only ${domains} addresses are allowed here. Not added: ${shown}${more}`;
        }
        return `Not a valid email address. Not added: ${shown}${more}`;
    }

    ND_emailListOpenRecord(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id;
        if (!recordId) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: recordId, actionName: 'view' }
        });
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

        const picked = event.detail.recordId;

        // lightning-record-picker fires change when we seed its value from the record
        // on load, which is not a user edit. Marking the section dirty here also set
        // ownerDirty, and that flag makes the dirty recompute bail out, so the section
        // stayed dirty for good after every hard refresh.
        if (picked && picked === this._savedOwnerId()) {
            this.selectedOwnerId = picked;
            this.ownerEditMode = false;
            return;
        }

        this.selectedOwnerId = picked;
        if (picked) {
            this.ownerDirty = true;
            this.isDirty = true;
            this.ownerEditMode = false;
        } else if (this.ND_recordData) {
            // X-ing out the current owner reveals the User/Queue chooser. Only once
            // the record is loaded, so a picker that reports null while still
            // resolving doesn't pop the chooser open on its own.
            this.ownerEditMode = true;
        }
    }

    _savedOwnerId() {
        const fields = this.ND_recordData && this.ND_recordData.fields;
        return fields && fields.OwnerId ? fields.OwnerId.value : null;
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
    // Taking a case out of a queue moves Status to Open, which starts the SLA clock,
    // so the fields the SLA depends on have to be there first. Without this check the
    // failure surfaces as a raw FIELD_CUSTOM_VALIDATION_EXCEPTION from an after-save
    // flow, which names no field and only appears for non-admin profiles.
    ND_handleTakeOwnership() {
        if (this.isTakingOwnership || this.isSaving) return; // ignore repeat clicks

        const missing = this._missingBeforeTakeover();
        if (missing.length) {
            this.saveError = {
                title: this._takeoverBlockedMessage(missing),
                items: [],
                hasItems: false
            };
            return;
        }

        this.isTakingOwnership = true;
        this.saveError = undefined;
        this.selectedOwnerId = USER_ID;
        this.ownerPickerMode = 'User';
        this.ownerDirty = true;

        // Drive the form's own submit path rather than assembling fields by hand, so
        // EVERY value on the form is committed in the SAME DML exactly as Save does
        // it. If the user just picked an Environment without saving, the after-save
        // flow has to see it, otherwise it flips Status to Open and validation fires.
        const submitter = this.template.querySelector('[data-role="silent-submit"]');
        if (submitter) {
            submitter.click();  // fires onsubmit -> ND_handleSubmit -> form.submit()
            return;             // ND_handleSuccess / ND_handleError finish up
        }

        // Section collapsed, so there is no form to submit through
        updateRecord({ fields: { Id: this.recordId, OwnerId: USER_ID } })
            .then(() => {
                this.ownerEditMode = false;
                this.ownerDirty = false;
                this.isDirty = false;
                this._showOwnerNotice('✓ You are now the owner', false);
            })
            .catch(error => {
                this.saveError = this._buildSaveError(error.body || {});
            })
            .finally(() => {
                this.isTakingOwnership = false;
            });
    }

    // Labels of the config rows marked requiredBeforeTakeover that have no value yet.
    // Reads the live UI value before the saved one, so a dropdown the user just changed
    // counts as set: they can pick an Environment and take the case in one go.
    _missingBeforeTakeover() {
        const live = this._currentFormValues();
        const saved = (this.ND_recordData && this.ND_recordData.fields) || {};

        const valueOf = apiName => (
            Object.prototype.hasOwnProperty.call(live, apiName)
                ? live[apiName]
                : (saved[apiName] ? saved[apiName].value : null)
        );

        return this.configObject.filter(item => {
            if (item.requiredBeforeTakeover !== true || !item.apiName) return false;

            // Missing from the org, or hidden by showIfField (e.g. Environment on a
            // non-AvioBook case), so it isn't ours to demand
            if (!this._isRowVisible(item)) return false;

            // Conditional requirement, e.g. Environment only for a Bug or Incident.
            // Same context as the renderer, so the live form value counts here too.
            if (!holds(item, siteByKey('requiredIf'), this._conditionContext, item.apiName)) return false;

            return isBlank(valueOf(item.apiName));
        }).map(item => this._labelFor(item.apiName, item.label));
    }

    // Prefer the label the config chose, then the org's field label, then the fallback
    _labelFor(apiName, fallback) {
        const item = this.configObject.find(i => i.apiName === apiName);
        if (item && item.label) return item.label;
        const described = this._objectInfo && this._objectInfo.fields && this._objectInfo.fields[apiName];
        if (described && described.label) return described.label;
        return fallback || apiName;
    }

    _takeoverBlockedMessage(labels) {
        if (labels.length === 1) {
            return `${labels[0]} needs to be set before taking a case`;
        }
        const last = labels[labels.length - 1];
        const rest = labels.slice(0, -1).join(', ');
        return `${rest} and ${last} need to be set before taking a case`;
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
        this.emailListDraft = {};   // discard anything typed into an add box
        this.emailListError = {};
        this.liveValues = {};       // conditional rows go back to what is saved
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
        // What was live is now saved, so conditional rows can read the record again
        this.liveValues = {};
        this.ownerDirty = false;
        this.openProblemDirty = false;
        this.urlDirty = false;
        this.urlListDirty = false;
        this.emailListDirty = false;
        this.emailListDraft = {};
        this.emailListError = {};
        this.emailListDirty = false;
    }

    // --- SUBMIT HANDLER ---
    ND_handleSubmit(event) {
        event.preventDefault();       // stop the form from submitting
        this.isSaving = true;         // show "Saving…" until success/error fires
        this.saveError = undefined;   // clear any banner from the previous attempt
        const fields = this._injectWidgetFields(event.detail.fields);
        this.template.querySelector('lightning-record-edit-form').submit(fields);
    }

    // Adds everything the standard form doesn't know about to a field map. Shared by
    // Save and by "take it", so taking a case commits the user's pending edits in the
    // same DML rather than losing them.
    _injectWidgetFields(baseFields) {
        const fields = { ...baseFields };

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

        // Inject any changed isEmailList fields. Stored format stays plain
        // comma-separated text so the flows and integrations writing this field
        // keep working untouched.
        if (this.emailListDirty) {
            Object.keys(this.emailListValues).forEach(apiName => {
                fields[apiName] = (this.emailListValues[apiName] || []).join(',');
            });
        }

        return fields;
    }

    // Values as they stand in the UI right now, including unsaved edits. Used only
    // for the pre-flight check; the commit goes through the form's own submit event
    // so it carries every field the form knows about, not just the ones read here.
    _currentFormValues() {
        const fields = {};
        this.template.querySelectorAll('lightning-input-field').forEach(field => {
            if (field.fieldName) fields[field.fieldName] = field.value;
        });
        return fields;
    }

    // --- ERROR HANDLER ---
    ND_handleError(event) {
        this.isSaving = false;
        this.isTakingOwnership = false;   // take it saves through the form too
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
        const wasTakingOwnership = this.isTakingOwnership;
        this.isSaving = false;
        this.isTakingOwnership = false;
        this.saveError = undefined;
        this._clearDirtyState();
        this.ownerEditMode = false;
        this.urlEditMode = {};      // saved values now render as links again
        this.emailListDraft = {};
        this.emailListError = {};

        if (wasTakingOwnership) {
            this._showOwnerNotice('✓ You are now the owner', false);
        }

        const evt = new ShowToastEvent({
            title: 'Success',
            message: wasTakingOwnership
                ? 'You are now the owner'
                : 'Record updated successfully',
            variant: 'success',
        });
        this.dispatchEvent(evt);
    }
}
