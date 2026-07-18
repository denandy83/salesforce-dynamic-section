import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, updateRecord } from 'lightning/uiRecordApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import USER_ID from '@salesforce/user/Id';

export default class ND_DynamicSection extends LightningElement {
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
    
    // For Record Type Handling
    @track _objectInfo;
    @track selectedRecordTypeId;

    // For Owner Handling (OwnerId is polymorphic — User or Queue — so
    // lightning-input-field always renders it read-only; we use our own picker)
    @track selectedOwnerId;
    @track ownerPickerMode = 'User';
    @track ownerEditMode = false;
    ownerDirty = false;

    // Inline notice shown under the owner field (toasts can be missed / hidden in consoles)
    @track ownerNotice;
    @track ownerNoticeIsError = false;
    _ownerNoticeTimer;

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
    get nd_wireFields() {
        if (!this.objectApiName) return [];
        const fieldsToLoad = new Set();
        
        if (this.ND_headerLogicField) fieldsToLoad.add(`${this.objectApiName}.${this.ND_headerLogicField}`);

        this.configObject.forEach(item => {
            if (item.apiName) fieldsToLoad.add(`${this.objectApiName}.${item.apiName}`);
            if (item.showIfField) fieldsToLoad.add(`${this.objectApiName}.${item.showIfField}`);
            if (item.color) {
                if (item.colorIfField) fieldsToLoad.add(`${this.objectApiName}.${item.colorIfField}`);
                else if (item.colorIfValue !== undefined) fieldsToLoad.add(`${this.objectApiName}.${item.apiName}`);
            }
        });
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
            // Initialize selectedRecordTypeId if not set
            if (this.ND_recordData.recordTypeId && !this.selectedRecordTypeId) {
                this.selectedRecordTypeId = this.ND_recordData.recordTypeId;
            } else if (this.ND_recordData.fields && this.ND_recordData.fields.RecordTypeId && !this.selectedRecordTypeId) {
                 this.selectedRecordTypeId = this.ND_recordData.fields.RecordTypeId.value;
            }
            // Initialize the owner picker with the current owner (00G prefix = Queue)
            const ownerField = this.ND_recordData.fields ? this.ND_recordData.fields.OwnerId : null;
            if (ownerField && ownerField.value && !this.selectedOwnerId) {
                this.selectedOwnerId = ownerField.value;
                this.ownerPickerMode = String(ownerField.value).startsWith('00G') ? 'Queue' : 'User';
            }
        }
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

    get queueFilter() {
        return { criteria: [{ fieldPath: 'Type', operator: 'eq', value: 'Queue' }] };
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
    
    get ND_chevronIcon() {
        return this.ND_isOpen ? 'utility:chevronup' : 'utility:chevrondown';
    }

    // --- 6. FIELD LIST RENDERING ---
    get ND_finalFieldList() {
        const config = this.configObject;
        return config.map(item => {
            // A. Visibility Logic
            let isVisible = true;
            if (item.showIfField) {
                if (!this.ND_recordData || !this.ND_recordData.fields[item.showIfField]) {
                    isVisible = false; 
                } else {
                    const fieldVal = this.ND_recordData.fields[item.showIfField].value;
                    if (item.showIfValue !== undefined) isVisible = (fieldVal === item.showIfValue);
                    else isVisible = !!fieldVal;
                }
            }

            // B. Color Strip Logic
            let borderColor = 'transparent';
            if (item.color) {
                let applyColor = false;
                const logicField = item.colorIfField || (item.colorIfValue !== undefined ? item.apiName : null);

                if (!logicField) {
                    applyColor = true;
                } else if (this.ND_recordData && this.ND_recordData.fields[logicField]) {
                    const val = this.ND_recordData.fields[logicField].value;
                    
                    if (item.colorIfValue !== undefined) {
                        const valStr = String(val);
                        const validValues = String(item.colorIfValue).split(',').map(v => v.trim());
                        applyColor = validValues.includes(valStr);
                    } else {
                        applyColor = !!val; 
                    }
                }
                if (applyColor) borderColor = item.color;
            }

            // C. Layout Logic
            let sizeClass = 'slds-size_1-of-2'; 
            
            if (this.ND_layoutType === '1 Column' || item.colSpan === 2) {
                sizeClass = 'slds-size_1-of-1'; 
            }

            const cssClass = `slds-col ${sizeClass} nd-field-row`;

            // D. URL Icon Logic
            let urlValue = null;
            if (item.isUrl === true && this.ND_recordData && this.ND_recordData.fields[item.apiName]) {
                urlValue = this.ND_recordData.fields[item.apiName].value;
            }

            const customStyle = `
                position: relative;
                border-left: 4px solid ${borderColor};
                background-color: transparent;
                padding-left: 5px;
                padding-right: ${urlValue ? '28px' : '5px'};
                margin-bottom: 1px;
                border-radius: 0;
            `;

            const isOwner = item.apiName === 'OwnerId';

            return {
                apiName: item.apiName,
                customLabel: item.label || (isOwner && item.editable ? 'Owner' : null),
                isVisible: isVisible,
                style: customStyle,
                cssClass: cssClass,
                editable: item.editable || false,
                key: item.apiName,
                isRecordType: item.apiName === 'RecordTypeId',
                isOwner: isOwner,
                hasUrl: !!urlValue,
                urlValue: urlValue
            };
        });
    }

    ND_toggleSection() {
        this.ND_isOpen = !this.ND_isOpen;
    }

    ND_handleFieldChange(event) {
        this.isDirty = true;
    }

    ND_handleOpenUrl(event) {
        event.stopPropagation();
        let url = event.currentTarget.dataset.url;
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
        }
        window.open(url, '_blank');
    }

    ND_handleRecordTypeChange(event) {
        this.selectedRecordTypeId = event.detail.value;
        this.isDirty = true;
    }

    ND_handleOwnerChange(event) {
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

    // Saves ownership to the current user immediately, without touching other edits
    ND_handleTakeOwnership() {
        updateRecord({ fields: { Id: this.recordId, OwnerId: USER_ID } })
            .then(() => {
                this.selectedOwnerId = USER_ID;
                this.ownerPickerMode = 'User';
                this.ownerEditMode = false;
                this.ownerDirty = false;
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
            });
    }

    // --- SUBMIT HANDLER ---
    ND_handleSubmit(event) {
        event.preventDefault();       // stop the form from submitting
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

        this.template.querySelector('lightning-record-edit-form').submit(fields);
    }

    // --- ERROR HANDLER (New) ---
ND_handleError(event) {
    // 1. Log the ENTIRE error object to the console so we can expand it
    console.log('FULL ERROR DETAILS:', JSON.parse(JSON.stringify(event.detail)));

    let message = 'Unknown error';
    if (event.detail && event.detail.message) {
        message = event.detail.message;
    } else if (event.detail && event.detail.detail) {
        message = event.detail.detail;
    } else if (event.detail && event.detail.output && event.detail.output.errors && event.detail.output.errors.length > 0) {
        message = event.detail.output.errors[0].message;
    }

    const evt = new ShowToastEvent({
        title: 'Error saving record',
        message: message,
        variant: 'error',
    });
    this.dispatchEvent(evt);
}

    ND_handleSuccess(event) {
        this.isDirty = false;
        this.ownerDirty = false;
        this.ownerEditMode = false;
        const evt = new ShowToastEvent({
            title: 'Success',
            message: 'Record updated successfully',
            variant: 'success',
        });
        this.dispatchEvent(evt);
    }
}