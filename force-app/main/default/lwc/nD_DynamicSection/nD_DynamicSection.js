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
    
    // JSON Config
    @api ND_jsonConfigString = ''; 

    // Dynamic Header Logic Props
    @api ND_headerLogicField;
    @api ND_headerLogicValue;
    @api ND_headerActiveColor;

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

    // --- 4. DATA LOADING ---
    get nd_wireFields() {
        if (!this.objectApiName) return [];
        const fieldsToLoad = new Set();
        
        if (this.ND_headerLogicField) {
            fieldsToLoad.add(`${this.objectApiName}.${this.ND_headerLogicField}`);
        }

        this.configObject.forEach(item => {
            if (item.apiName) {
                fieldsToLoad.add(`${this.objectApiName}.${item.apiName}`);
            }
            if (item.showIfField) {
                fieldsToLoad.add(`${this.objectApiName}.${item.showIfField}`);
            }
            if (item.color) {
                if (item.colorIfField) {
                    fieldsToLoad.add(`${this.objectApiName}.${item.colorIfField}`);
                } else if (item.colorIfValue !== undefined) {
                    fieldsToLoad.add(`${this.objectApiName}.${item.apiName}`);
                }
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

    // UPDATED: Now supports comma-separated values (e.g. "Working, Escalated")
    get ND_headerStyle() {
        let finalColor = this.ND_headerBackgroundColor; 

        if (this.ND_headerLogicField && this.ND_recordData && this.ND_headerActiveColor) {
            const field = this.ND_recordData.fields[this.ND_headerLogicField];
            
            if (field && field.value !== undefined && field.value !== null) {
                const val = String(field.value); // Convert to string for safe comparison
                let isMatch = false;

                if (this.ND_headerLogicValue) {
                    // Split by comma, trim whitespace, and check if value is in list
                    const validValues = this.ND_headerLogicValue.split(',').map(v => v.trim());
                    isMatch = validValues.includes(val);
                } else {
                    // If blank, just check if field is truthy (not null)
                    isMatch = !!val; 
                }

                if (isMatch) {
                    finalColor = this.ND_headerActiveColor;
                }
            }
        }
        return `background: linear-gradient(135deg, ${finalColor} 0%, ${finalColor} 80%, #000000 100%);`;
    }

    get ND_titleStyle() {
        return `color: ${this.ND_headerTextColor}; font-weight: 600;`;
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