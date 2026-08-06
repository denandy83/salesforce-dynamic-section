import { createElement } from 'lwc';
import ND_SectionConfigBuilder from 'c/nD_SectionConfigBuilder';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import getRecentRecords from '@salesforce/apex/ND_SectionPreviewPicker.getRecentRecords';
import resolveRecordId from '@salesforce/apex/ND_SectionPreviewPicker.resolveRecordId';

// Both Apex imports need explicit mocks: getRecentRecords is consumed through @wire and
// needs a test wire adapter to push data in; resolveRecordId is imperative and needs a
// jest.fn whose resolved value each test can set.
jest.mock(
    '@salesforce/apex/ND_SectionPreviewPicker.getRecentRecords',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/wire-service-jest-util');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/ND_SectionPreviewPicker.resolveRecordId',
    () => ({ default: jest.fn(() => Promise.resolve(null)) }),
    { virtual: true }
);
import {
    IsConsoleNavigation,
    setTabLabel,
    setTabIcon,
    FOCUSED_TAB_ID
} from 'lightning/platformWorkspaceApi';

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

// The rail holds a Section entry as well as the field rows, so tests that count rows
// have to exclude it.
const FIELD_ROW = 'li.nd-row:not(.nd-row_section)';

// getFocusedTabInfo().then(...).then(Promise.all(...)) is several microtasks deep, so a
// single flush is not enough to observe the tab having been named.
function flushMicrotasks(times = 5) {
    return Array.from({ length: times })
        .reduce(chain => chain.then(() => undefined), Promise.resolve());
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
        expect(text(element, '.nd-json')).toBe('{\n  "section": {},\n  "fields": []\n}');
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

        const rows = element.shadowRoot.querySelectorAll(FIELD_ROW);
        expect(rows).toHaveLength(1);
        expect(text(element, `${FIELD_ROW} .nd-row-title`)).toContain('Issue Type');
        expect(text(element, `${FIELD_ROW} .nd-row-api`)).toBe('Type');
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
        expect(element.shadowRoot.querySelectorAll(FIELD_ROW)).toHaveLength(1);
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

        // A legacy import opens on the Section pane; click into the field row.
        element.shadowRoot.querySelector(`${FIELD_ROW} .nd-row-btn`).click();
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
        //
        // One property now: the JSON carries the section settings too, so the preview
        // receives the whole document rather than the bare array that was pasted in.
        expect(preview.ND_jsonConfigString)
            .toBe('{"section":{},"fields":[{"apiName":"Status","editable":true}]}');
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
        expect(preview.ND_jsonConfigString)
            .toBe('{"section":{},"fields":[{"apiName":"Status","editable":true}]}');
    });

    it('explains why there is no preview yet', async () => {
        const element = mount();
        await Promise.resolve();
        expect(element.shadowRoot.textContent)
            .toContain('Enter a record Id or case number above');
    });

    // The header — title, icon, colours — is the first thing configured, so it must be
    // previewable before any field rows exist.
    it('previews the header with no field rows at all', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const idInput = element.shadowRoot.querySelector('lightning-input');
        idInput.value = '500KB00000000000AAA';
        idInput.dispatchEvent(new CustomEvent('change'));
        await flushMicrotasks();

        const preview = element.shadowRoot.querySelector('c-n-d_-dynamic-section');
        expect(preview).not.toBeNull();
        expect(preview.ND_jsonConfigString).toBe('{"section":{},"fields":[]}');
    });
});

describe('picking a record to preview against', () => {
    const RECENT = [
        { id: '500KB00000000001AAA', label: '00012024', sublabel: 'Login failure' },
        { id: '500KB00000000002AAA', label: '00012023', sublabel: 'Sync stuck' }
    ];

    it('offers recently viewed records, newest first', async () => {
        const element = mount();
        getRecentRecords.emit(RECENT);
        await Promise.resolve();

        const combo = Array.from(element.shadowRoot.querySelectorAll('lightning-combobox'))
            .find(c => c.label === 'Preview against');
        expect(combo).not.toBeNull();
        expect(combo.options[0].label).toBe('00012024 — Login failure');
        expect(combo.options[0].value).toBe('500KB00000000001AAA');
    });

    it('starts on the most recent record so a preview appears immediately', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        getRecentRecords.emit(RECENT);
        await flushMicrotasks();

        const preview = element.shadowRoot.querySelector('c-n-d_-dynamic-section');
        expect(preview).not.toBeNull();
        expect(preview.recordId).toBe('500KB00000000001AAA');
    });

    it('falls back to a plain Id box when there are no recent records', async () => {
        const element = mount();
        getRecentRecords.emit([]);
        await Promise.resolve();

        const combo = Array.from(element.shadowRoot.querySelectorAll('lightning-combobox'))
            .find(c => c.label === 'Preview against');
        expect(combo).toBeUndefined();

        const idInput = Array.from(element.shadowRoot.querySelectorAll('lightning-input'))
            .find(i => i.label === 'Preview against this record Id');
        expect(idInput).not.toBeUndefined();
    });

    it('resolves a typed case number into a record Id', async () => {
        resolveRecordId.mockResolvedValue('500KB00000000009AAA');

        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        getRecentRecords.emit(RECENT);
        await Promise.resolve();

        const search = Array.from(element.shadowRoot.querySelectorAll('lightning-input'))
            .find(i => i.label === '…or find by number / Id');
        search.value = '12024';
        search.dispatchEvent(new CustomEvent('change'));
        await flushMicrotasks();

        expect(resolveRecordId).toHaveBeenCalledWith({ objectApiName: 'Case', term: '12024' });
        const preview = element.shadowRoot.querySelector('c-n-d_-dynamic-section');
        expect(preview.recordId).toBe('500KB00000000009AAA');
    });

    it('says so when nothing matches, rather than previewing the wrong record', async () => {
        resolveRecordId.mockResolvedValue(null);

        const element = mount();
        getRecentRecords.emit([]);
        await Promise.resolve();

        const search = Array.from(element.shadowRoot.querySelectorAll('lightning-input'))
            .find(i => i.label === '…or find by number / Id');
        search.value = '99999999';
        search.dispatchEvent(new CustomEvent('change'));
        await flushMicrotasks();

        expect(text(element, '.nd-import-error')).toContain('No Case matches "99999999"');
    });
});

describe('the icon picker', () => {
    it('has no filter box, and lists every icon', async () => {
        const element = mount();
        await Promise.resolve();

        expect(element.shadowRoot.textContent).not.toContain('Filter icons');
        const choices = element.shadowRoot.querySelectorAll('.nd-icon-choice');
        expect(choices.length).toBeGreaterThan(50);
    });
});

describe('console tab label', () => {
    it('names the tab, because a console tab otherwise reads "Loading..." forever', async () => {
        const element = mount();
        IsConsoleNavigation.emit(true);
        await flushMicrotasks();

        expect(setTabLabel).toHaveBeenCalledWith(FOCUSED_TAB_ID, 'Config Builder');
        expect(setTabIcon).toHaveBeenCalledWith(FOCUSED_TAB_ID, 'utility:builder');
        expect(element).not.toBeNull();
    });

    it('leaves standard navigation alone', async () => {
        mount();
        IsConsoleNavigation.emit(false);
        await flushMicrotasks();

        expect(setTabLabel).not.toHaveBeenCalled();
        expect(setTabIcon).not.toHaveBeenCalled();
    });

    it('names the tab once, not on every render', async () => {
        const element = mount();
        IsConsoleNavigation.emit(true);
        await flushMicrotasks();

        // Force more renders
        element.shadowRoot.querySelector('lightning-input').dispatchEvent(new CustomEvent('change'));
        await flushMicrotasks();

        expect(setTabLabel).toHaveBeenCalledTimes(1);
    });
});

describe('a field the org will not let anyone edit', () => {
    const WITH_FORMULA = {
        apiName: 'Case',
        fields: {
            Status: { apiName: 'Status', label: 'Status', updateable: true, calculated: false },
            AVB_ICAO_Account__c: {
                apiName: 'AVB_ICAO_Account__c', label: 'ICAO Account',
                updateable: false, calculated: true
            }
        },
        recordTypeInfos: {}
    };

    async function addField(element, apiName) {
        const combo = Array.from(element.shadowRoot.querySelectorAll('lightning-combobox'))
            .find(c => c.label === 'Add a field');
        combo.dispatchEvent(new CustomEvent('change', { detail: { value: apiName } }));
        await Promise.resolve();

        Array.from(element.shadowRoot.querySelectorAll('lightning-button'))
            .find(b => b.label === 'Add row')
            .click();
        await Promise.resolve();
        await Promise.resolve();
    }

    it('does not claim a formula field is editable when it is added', async () => {
        const element = mount();
        getObjectInfo.emit(WITH_FORMULA);
        await Promise.resolve();
        await addField(element, 'AVB_ICAO_Account__c');

        expect(text(element, '.nd-json'))
            .toContain('{"apiName":"AVB_ICAO_Account__c","label":"ICAO Account"}');
        expect(text(element, '.nd-json')).not.toContain('"editable":true');
    });

    it('marks it in the rail so it is obvious without selecting it', async () => {
        const element = mount();
        getObjectInfo.emit(WITH_FORMULA);
        await Promise.resolve();
        await addField(element, 'AVB_ICAO_Account__c');

        expect(text(element, '.nd-badge_locked')).toBe('formula');
    });

    it('disables the editable checkbox and explains why', async () => {
        const element = mount();
        getObjectInfo.emit(WITH_FORMULA);
        await Promise.resolve();
        await addField(element, 'AVB_ICAO_Account__c');

        const checkbox = Array.from(element.shadowRoot.querySelectorAll('lightning-input'))
            .find(i => i.label === 'Users can edit this field');
        expect(checkbox.disabled).toBe(true);
        expect(checkbox.checked).toBe(false);

        const help = Array.from(element.shadowRoot.querySelectorAll('.nd-help'))
            .map(n => n.textContent)
            .find(t => t.includes('cannot be edited'));
        expect(help).toContain('formula field');
    });

    it('leaves an ordinary field editable and enabled', async () => {
        const element = mount();
        getObjectInfo.emit(WITH_FORMULA);
        await Promise.resolve();
        await addField(element, 'Status');

        expect(text(element, '.nd-json')).toContain('"editable":true');
        expect(element.shadowRoot.querySelector('.nd-badge_locked')).toBeNull();

        const checkbox = Array.from(element.shadowRoot.querySelectorAll('lightning-input'))
            .find(i => i.label === 'Users can edit this field');
        expect(checkbox.disabled).toBe(false);
        expect(checkbox.checked).toBe(true);
    });
});
