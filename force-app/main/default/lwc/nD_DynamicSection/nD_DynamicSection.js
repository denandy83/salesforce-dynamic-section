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

    // Dynamic Header Logic Props
    @api ND_headerLogicField;
    @api ND_headerLogicValue;
    @api ND_headerActiveColor;
    @api ND_headerActiveTextColor; // NEW

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

    // Centralized Logic: Returns TRUE if we should switch colors
    get isHeaderActive() {
        if (!this.ND_headerLogicField || !this.ND_recordData || !this.ND_headerActiveColor) {
            return false;
        }

        const field = this.ND_recordData.fields[this.ND_headerLogicField];
        if (!field || field.value === undefined) {
            return false;
        }

        const rawVal = field.value;
        
        // Scenario A: Specific Values (e.g., "Working, Escalated")
        if (this.ND_headerLogicValue && this.ND_headerLogicValue.trim().length > 0) {
            const valStr = String(rawVal);
            const validValues = this.ND_headerLogicValue.split(',').map(v => v.trim());
            return validValues.includes(valStr);
        } 
        
        // Scenario B: Truthy Check (Strict Zero Rejection)
        if (rawVal === 0 || rawVal === '0' || rawVal === false || rawVal === null) {
            return false;
        }
        
        return true; // It's active (1, 5, "Text", True)
    }

    // --- 4. DATA LOADING ---
    get nd_wireFields() {
        if (!this.objectApiName) return [];
        const fieldsToLoad = new Set();
        
        if (this.ND_headerLogicField) {
            fieldsToLoad.add(`${this.objectApiName}.${this.ND_headerLogicField}`);
        }

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
        if (data) {
            this.ND_recordData = data;
        }
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
        if (this.isHeaderActive) {
            finalColor = this.ND_headerActiveColor;
        }
        return `background: linear-gradient(135deg, ${finalColor} 0%, ${finalColor} 80%, #000000 100%);`;
    }

    get ND_titleStyle() {
        let finalColor = this.ND_headerTextColor;
        // Only switch text color if active AND a specific text color was provided
        if (this.isHeaderActive && this.ND_headerActiveTextColor) {
            finalColor = this.ND_headerActiveTextColor;
        }
        return `color: ${finalColor}; font-weight: 600;`;
    }
    
    get ND_chevronIcon() {
        return this.ND_isOpen ? 'utility:chevronup' : 'utility:chevrondown';
    }

    // --- 6. FIELD LIST RENDERING ---
    get ND_finalFieldList() {
        const config = this.configObject;
        return config.map(item => {
            let isVisible = true;
            if (item.showIfField) {
                if (!this.ND_recordData || !this.ND_recordData.fields[item.showIfField]) {
                    isVisible = false; 
                } else {
                    const fieldVal = this.ND_recordData.fields[item.showIfField].value;
                    if (item.showIfValue !== undefined) {
                        isVisible = (fieldVal === item.showIfValue);
                    } else {
                        isVisible = !!fieldVal;
                    }
                }
            }

            let borderColor = 'transparent';
            if (item.color) {
                let applyColor = false;
                const logicField = item.colorIfField || (item.colorIfValue !== undefined ? item.apiName : null);

                if (!logicField) {
                    applyColor = true;
                } else if (this.ND_recordData && this.ND_recordData.fields[logicField]) {
                    const val = this.ND_recordData.fields[logicField].value;
                    if (item.colorIfValue !== undefined) {
                        applyColor = (val === item.colorIfValue);
                    } else {
                        applyColor = !!val; 
                    }
                }
                if (applyColor) borderColor = item.color;
            }

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