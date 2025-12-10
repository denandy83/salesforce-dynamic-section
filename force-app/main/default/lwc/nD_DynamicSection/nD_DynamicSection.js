import { LightningElement, api, wire, track } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

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

    @wire(getRecord, { recordId: '$recordId', fields: '$nd_wireFields' })
    wiredRecord({ error, data }) {
        if (data) this.ND_recordData = data;
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

    // --- 6. FIELD LIST RENDERING (UPDATED FOR LAYOUT) ---
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
                    // Case 1: No condition set, always apply color
                    applyColor = true;
                } else if (this.ND_recordData && this.ND_recordData.fields[logicField]) {
                    const val = this.ND_recordData.fields[logicField].value;
                    
                    if (item.colorIfValue !== undefined) {
                        // NEW: Check for comma-separated values
                        const valStr = String(val);
                        const validValues = String(item.colorIfValue).split(',').map(v => v.trim());
                        applyColor = validValues.includes(valStr);
                    } else {
                        // Old Logic: Truthy check (if colorIfValue is missing, check if field has data)
                        applyColor = !!val; 
                    }
                }
                if (applyColor) borderColor = item.color;
            }

            // C. Layout Logic (NEW)
            // Default to '1-of-2' (50%), unless layout is '1 Column' OR item requests 'span 2'
            let sizeClass = 'slds-size_1-of-2'; 
            
            if (this.ND_layoutType === '1 Column' || item.colSpan === 2) {
                sizeClass = 'slds-size_1-of-1'; // 100% width
            }

            // Combine into final CSS class
            const cssClass = `slds-col ${sizeClass} nd-field-row`;

            const customStyle = `
                border-left: 4px solid ${borderColor}; 
                background-color: transparent;
                padding-left: 12px; 
                margin-bottom: 4px;
                border-radius: 0; 
            `;

            return {
                apiName: item.apiName,
                customLabel: item.label || null, 
                isVisible: isVisible,
                style: customStyle,
                cssClass: cssClass, // Pass the dynamic class to HTML
                editable: item.editable || false,
                key: item.apiName
            };
        });
    }

    ND_toggleSection() {
        this.ND_isOpen = !this.ND_isOpen;
    }

    ND_handleFieldChange(event) {
        this.isDirty = true;
    }

    ND_handleSuccess(event) {
        this.isDirty = false;
        const evt = new ShowToastEvent({
            title: 'Success',
            message: 'Record updated successfully',
            variant: 'success',
        });
        this.dispatchEvent(evt);
    }
}