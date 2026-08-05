import { createElement } from 'lwc';
import ND_SectionConfigBuilder from 'c/nD_SectionConfigBuilder';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';

// LWC does not expose non-@api internals on the host element, so these are DOM-level
// checks. The row/JSON logic itself is pure and covered in nD_sectionConfigSchema's
// configOps tests.

const OBJECT_INFO = {
    apiName: 'Case',
    fields: {
        Status: { apiName: 'Status', label: 'Status' },
        Type: { apiName: 'Type', label: 'Issue Type' },
        AVB_Environment__c: { apiName: 'AVB_Environment__c', label: 'Environment' },
        RecordTypeId: { apiName: 'RecordTypeId', label: 'Record Type' }
    },
    recordTypeInfos: {
        '012KB000000kcw4YAA': { recordTypeId: '012KB000000kcw4YAA', name: 'AvioBook Case' },
        '012KB000000kcw5YAA': { recordTypeId: '012KB000000kcw5YAA', name: 'AvioData Case' }
    }
};

function mount() {
    const element = createElement('c-nd-section-config-builder', { is: ND_SectionConfigBuilder });
    document.body.appendChild(element);
    return element;
}

function text(element, selector) {
    const node = element.shadowRoot.querySelector(selector);
    return node ? node.textContent.trim() : null;
}

afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    jest.clearAllMocks();
});

describe('first load', () => {
    it('renders an empty state and no preview', async () => {
        const element = mount();
        await Promise.resolve();

        expect(text(element, '.nd-empty-title')).toBe('No field rows yet');
        expect(element.shadowRoot.querySelector('c-n-d_-dynamic-section')).toBeNull();
    });

    it('reports an empty array as the output', async () => {
        const element = mount();
        await Promise.resolve();
        expect(text(element, '.nd-json')).toBe('[]');
    });

    it('reports a clean config check', async () => {
        const element = mount();
        await Promise.resolve();
        expect(text(element, '.nd-ok')).toMatch(/No unknown keys/);
    });
});

describe('field pickers come from the describe', () => {
    it('offers the object fields once the describe arrives', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const combo = element.shadowRoot.querySelector('lightning-combobox');
        expect(combo).not.toBeNull();
        const values = combo.options.map(o => o.value);
        expect(values).toContain('Status');
        expect(values).toContain('AVB_Environment__c');
    });

    it('labels options with the field label and api name', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const combo = element.shadowRoot.querySelector('lightning-combobox');
        const typeOption = combo.options.find(o => o.value === 'Type');
        expect(typeOption.label).toBe('Issue Type · Type');
    });

    it('shows no options when the describe fails', async () => {
        const element = mount();
        getObjectInfo.error();
        await Promise.resolve();

        const combo = element.shadowRoot.querySelector('lightning-combobox');
        expect(combo.options).toEqual([]);
    });
});

describe('the paste-in path', () => {
    async function importConfig(element, json) {
        const textarea = element.shadowRoot.querySelector('lightning-textarea');
        textarea.value = json;
        textarea.dispatchEvent(new CustomEvent('change', { detail: { value: json } }));

        const buttons = Array.from(element.shadowRoot.querySelectorAll('lightning-button'));
        const load = buttons.find(b => b.label === 'Load');
        load.click();
        await Promise.resolve();
        await Promise.resolve();
    }

    it('loads rows and renders them in the rail', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        await importConfig(element, '[{"apiName":"Type","label":"Issue Type","editable":true}]');

        const rows = element.shadowRoot.querySelectorAll('.nd-row');
        expect(rows).toHaveLength(1);
        expect(text(element, '.nd-row-title')).toContain('Issue Type');
        expect(text(element, '.nd-row-api')).toBe('Type');
    });

    it('surfaces a typo as a finding and flags the row invalid', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        await importConfig(element, '[{"apiName":"Type","requiredBeforeTakover":true}]');

        expect(text(element, '.nd-finding-text')).toMatch(/requiredBeforeTakeover/);
        expect(element.shadowRoot.querySelector('.nd-row_invalid')).not.toBeNull();
        expect(element.shadowRoot.querySelector('.nd-badge_bad')).not.toBeNull();
    });

    it('reports malformed JSON without wiping the rail', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        await importConfig(element, '[{"apiName":"Type"}]');
        await importConfig(element, '[{nope}]');

        expect(text(element, '.nd-import-error')).toMatch(/not valid JSON/);
        expect(element.shadowRoot.querySelectorAll('.nd-row')).toHaveLength(1);
    });
});

describe('the property pane is generated from the registry', () => {
    async function loadOneRow(element, json) {
        const textarea = element.shadowRoot.querySelector('lightning-textarea');
        // value first, then the event: the handler reads event.target.value
        textarea.value = json;
        textarea.dispatchEvent(new CustomEvent('change', { detail: { value: json } }));
        Array.from(element.shadowRoot.querySelectorAll('lightning-button'))
            .find(b => b.label === 'Load')
            .click();
        await Promise.resolve();
        await Promise.resolve();
    }

    it('renders a fieldset per registry group', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"Status"}]');

        const legends = Array.from(element.shadowRoot.querySelectorAll('.nd-group legend'))
            .map(l => l.textContent.trim());
        expect(legends).toEqual([
            'Field',
            'Show this row only when…',
            'Render as',
            'Underline the value when…',
            'Require before "take it!"'
        ]);
    });

    it('shows each key name next to its control', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"Status"}]');

        const keys = Array.from(element.shadowRoot.querySelectorAll('.nd-help code'))
            .map(c => c.textContent.trim());
        expect(keys).toContain('apiName');
        expect(keys).toContain('colSpan');
        expect(keys).toContain('requiredBeforeTakeover');
    });

    it('renders the widget choice as a single radio group', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"Status"}]');

        const radios = element.shadowRoot.querySelectorAll('lightning-radio-group');
        expect(radios).toHaveLength(1);
        expect(radios[0].options.map(o => o.value)).toEqual([
            'standard', 'isRecordLink', 'isUrl', 'isUrlList', 'isEmailList', 'isOpenProblem'
        ]);
    });

    it('states the take-it rule in English when the flag is on', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(
            element,
            '[{"apiName":"AVB_Environment__c","label":"Environment","requiredBeforeTakeover":true,'
            + '"showIfField":"RecordTypeId","showIfValue":"012KB000000kcw4YAA",'
            + '"requiredIfField":"Type","requiredIfValue":"Bug or Incident"}]'
        );

        expect(text(element, '.nd-sentence')).toBe(
            'Environment must have a value before someone can take this case, but only on '
            + 'AvioBook Case, and only when Issue Type is Bug or Incident.'
        );
    });

    it('offers record type names rather than Ids for showIfValue', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"AVB_Environment__c","showIfField":"RecordTypeId"}]');

        const combos = Array.from(element.shadowRoot.querySelectorAll('lightning-combobox'));
        const labels = combos.flatMap(c => (c.options || []).map(o => o.label));
        expect(labels).toContain('AvioBook Case');
        expect(labels).toContain('AvioData Case');
    });
});

describe('live preview', () => {
    it('embeds the real section component once a record Id and a row exist', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const textarea = element.shadowRoot.querySelector('lightning-textarea');
        const json = '[{"apiName":"Status","editable":true}]';
        textarea.value = json;
        textarea.dispatchEvent(new CustomEvent('change', { detail: { value: json } }));
        Array.from(element.shadowRoot.querySelectorAll('lightning-button'))
            .find(b => b.label === 'Load')
            .click();
        await Promise.resolve();

        const idInput = element.shadowRoot.querySelector('lightning-input');
        idInput.value = '500KB00000000000AAA';
        idInput.dispatchEvent(new CustomEvent('change'));
        await Promise.resolve();
        await Promise.resolve();

        const preview = element.shadowRoot.querySelector('c-n-d_-dynamic-section');
        expect(preview).not.toBeNull();
        expect(preview.recordId).toBe('500KB00000000000AAA');

        // Assert the REAL property name. An earlier version checked
        // `ndJsonConfigString`, which is only the expando the template attribute
        // created — it passed while the section received no config at all.
        expect(preview.ND_jsonConfigString).toBe(json);
        expect(preview.ND_sectionTitle).toBe('Preview');
    });

    it('sets the uppercase-named properties in JS, never as attributes', async () => {
        // Guards the actual bug: LWC cannot derive an attribute for a property whose
        // name starts with a capital, so nd-json-config-string reached nothing. If
        // anyone puts it back in the markup, the attribute reappears and this fails.
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const json = '[{"apiName":"Status","editable":true}]';
        const textarea = element.shadowRoot.querySelector('lightning-textarea');
        textarea.value = json;
        textarea.dispatchEvent(new CustomEvent('change', { detail: { value: json } }));
        Array.from(element.shadowRoot.querySelectorAll('lightning-button'))
            .find(b => b.label === 'Load')
            .click();
        await Promise.resolve();

        const idInput = element.shadowRoot.querySelector('lightning-input');
        idInput.value = '500KB00000000000AAA';
        idInput.dispatchEvent(new CustomEvent('change'));
        await Promise.resolve();
        await Promise.resolve();

        const preview = element.shadowRoot.querySelector('c-n-d_-dynamic-section');
        expect(preview.hasAttribute('nd-json-config-string')).toBe(false);
        expect(preview.hasAttribute('nd-section-title')).toBe(false);
        // …while the property itself did arrive
        expect(preview.ND_jsonConfigString).toBe(json);
    });

    it('explains why there is no preview yet', async () => {
        const element = mount();
        await Promise.resolve();
        expect(element.shadowRoot.textContent).toContain('Add a field row to see a preview.');
    });
});
