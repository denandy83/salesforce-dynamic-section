import { createElement } from 'lwc';
import ND_SectionConfigBuilder from 'c/nD_SectionConfigBuilder';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import getRecentRecords from '@salesforce/apex/ND_SectionPreviewPicker.getRecentRecords';
import resolveRecordId from '@salesforce/apex/ND_SectionPreviewPicker.resolveRecordId';
import getPicklistValues from '@salesforce/apex/ND_SectionPreviewPicker.getPicklistValues';

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
jest.mock(
    '@salesforce/apex/ND_SectionPreviewPicker.getPicklistValues',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/wire-service-jest-util');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
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
        RecordTypeId: { apiName: 'RecordTypeId', label: 'Record Type' },
        Subject: { apiName: 'Subject', label: 'Subject' }
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
    function matched(element) {
        return Array.from(element.shadowRoot.querySelectorAll('.nd-match'))
            .map(b => b.dataset.field);
    }

    it('offers the object fields once the describe arrives', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const fields = matched(element);
        expect(fields).toContain('Status');
        expect(fields).toContain('AVB_Environment__c');
    });

    it('shows the field label and the API name together', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const row = element.shadowRoot.querySelector('.nd-match[data-field="Type"]');
        expect(row.querySelector('.nd-match-label').textContent).toBe('Issue Type');
        expect(row.querySelector('.nd-match-api').textContent).toBe('Type');
    });

    it('offers nothing when the describe fails', async () => {
        const element = mount();
        getObjectInfo.error();
        await Promise.resolve();

        expect(matched(element)).toEqual([]);
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

    // The "…is one of" controls now live inside the condition editor's own shadow root, so
    // these check the CONTRACT the builder hands it — which choices exist for which field —
    // rather than reaching through into the child's markup. The editor's own rendering is
    // covered in nD_conditionsEditor's tests.
    function editor(element) {
        return element.shadowRoot.querySelector('c-n-d_conditions-editor');
    }

    it('offers record type names rather than Ids, as choices for RecordTypeId', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"AVB_Environment__c","showIfField":"RecordTypeId"}]');

        const choices = editor(element).valueChoices.RecordTypeId;
        expect(choices.map(o => o.label)).toEqual(['AvioBook Case', 'AvioData Case']);
        // Names are shown; the Ids are what gets written
        expect(choices.map(o => o.value)).toEqual(['012KB000000kcw4YAA', '012KB000000kcw5YAA']);
    });

    it('hands the editor the condition already in the config', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(
            element,
            '[{"apiName":"AVB_Environment__c","showIfField":"RecordTypeId",'
            + '"showIfValue":"012KB000000kcw4YAA"}]'
        );

        expect(editor(element).group.conditions).toEqual([
            { field: 'RecordTypeId', value: '012KB000000kcw4YAA', negate: false }
        ]);
    });

    // One condition still writes the flat pair, which is what keeps every existing config
    // in the org — and any browser still running the previous bundle — working unchanged.
    it('writes one condition back as the flat showIfField/showIfValue pair', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"AVB_Environment__c","showIfField":"RecordTypeId"}]');

        editor(element).dispatchEvent(new CustomEvent('change', {
            detail: {
                site: 'showIf',
                group: {
                    logic: 'AND',
                    conditions: [{ field: 'RecordTypeId', value: '012KB000000kcw4YAA,012KB000000kcw5YAA' }]
                }
            }
        }));
        await Promise.resolve();

        const json = text(element, '.nd-json');
        expect(json).toContain('"showIfValue":"012KB000000kcw4YAA,012KB000000kcw5YAA"');
        expect(json).not.toContain('"showIf"');
    });

    it('writes two conditions back as the structured showIf, keeping the logic', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"AVB_Environment__c","showIfField":"RecordTypeId"}]');

        editor(element).dispatchEvent(new CustomEvent('change', {
            detail: {
                site: 'showIf',
                group: {
                    logic: 'OR',
                    conditions: [
                        { field: 'RecordTypeId', value: '012KB000000kcw4YAA' },
                        { field: 'Type', value: 'Bug or Incident', negate: true }
                    ]
                }
            }
        }));
        await Promise.resolve();

        const json = text(element, '.nd-json');
        expect(json).toContain('"logic":"OR"');
        expect(json).toContain('"field":"Type","value":"Bug or Incident","negate":true');
        expect(json).not.toContain('"showIfField"');
    });

    // The test that was missing: every unit around this passed while the round trip was
    // broken. The editor fired the right event, the writer applied its rule correctly, and
    // "Add condition" still did nothing, because the rule dropped the very thing the event
    // carried. Only a test that goes editor -> config -> back to the editor catches that.
    it('keeps a newly added condition, so the card stays on screen', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"AVB_Environment__c","label":"Environment"}]');

        // Exactly what the editor's "Add condition" button emits: no field chosen yet.
        editor(element).dispatchEvent(new CustomEvent('change', {
            detail: { site: 'showIf', group: { logic: 'AND', conditions: [{ field: '', negate: false }] } }
        }));
        await Promise.resolve();

        expect(editor(element).group.conditions).toEqual([{ field: '', negate: false }]);
        expect(text(element, '.nd-json')).toContain('"showIf":{"conditions":[{"field":""}]}');
    });

    it('keeps a second condition added beside a finished one', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"AVB_Environment__c","showIfField":"RecordTypeId"}]');

        editor(element).dispatchEvent(new CustomEvent('change', {
            detail: {
                site: 'showIf',
                group: { logic: 'AND', conditions: [{ field: 'RecordTypeId' }, { field: '', negate: false }] }
            }
        }));
        await Promise.resolve();

        expect(editor(element).group.conditions).toHaveLength(2);
    });

    it('offers picklist values for a picklist field a condition watches', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"AVB_Environment__c","showIfField":"Type"}]');

        getPicklistValues.emit({ Type: ['Bug or Incident', 'Service Request'] });
        await Promise.resolve();

        expect(editor(element).valueChoices.Type.map(o => o.value))
            .toEqual(['Bug or Incident', 'Service Request']);
    });

    it('offers no choices for a field with no fixed values, so the editor falls back to text', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();
        await loadOneRow(element, '[{"apiName":"AVB_Environment__c","showIfField":"Subject"}]');

        getPicklistValues.emit({});
        await Promise.resolve();

        expect(editor(element).valueChoices.Subject).toBeUndefined();
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
        element.shadowRoot.querySelector(`.nd-match[data-field="${apiName}"]`).click();
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

describe('colour pickers update during the drag', () => {
    function colourInputs(element) {
        return Array.from(element.shadowRoot.querySelectorAll('input.nd-color-input'));
    }

    // A colour input fires `input` continuously while the picker is open and `change` only
    // once it closes. Listening to change alone made the preview lag behind the drag.
    it('applies a section colour on input, not only on change', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const headerBg = colourInputs(element)[0];
        expect(headerBg).not.toBeUndefined();

        headerBg.value = '#123456';
        headerBg.dispatchEvent(new CustomEvent('input'));
        await Promise.resolve();

        expect(text(element, '.nd-json')).toContain('"headerColor":"#123456"');
    });

    it('writes the dragged colour into the config', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const headerBg = colourInputs(element)[0];
        headerBg.value = '#abcdef';
        headerBg.dispatchEvent(new CustomEvent('input'));
        await Promise.resolve();

        expect(text(element, '.nd-json')).toContain('#abcdef');
    });

    it('still applies on change, for a picker that only commits at the end', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        await Promise.resolve();

        const headerBg = colourInputs(element)[0];
        headerBg.value = '#0f0f0f';
        headerBg.dispatchEvent(new CustomEvent('change'));
        await Promise.resolve();

        expect(text(element, '.nd-json')).toContain('#0f0f0f');
    });

    it('does not remount the preview for a colour change, so it cannot flash', async () => {
        const element = mount();
        getObjectInfo.emit(OBJECT_INFO);
        getRecentRecords.emit([{ id: '500KB00000000001AAA', label: '1', sublabel: 'x' }]);
        await flushMicrotasks();

        const before = element.shadowRoot.querySelector('c-n-d_-dynamic-section');
        expect(before).not.toBeNull();

        const headerBg = colourInputs(element)[0];
        headerBg.value = '#654321';
        headerBg.dispatchEvent(new CustomEvent('input'));
        await Promise.resolve();

        // Same element instance: it was updated in place rather than torn down
        const after = element.shadowRoot.querySelector('c-n-d_-dynamic-section');
        expect(after).toBe(before);
        expect(after.ND_jsonConfigString).toContain('#654321');
    });
});

describe('the record type multi-select', () => {
    const WITH_MASTER = {
        apiName: 'Case',
        fields: {
            AVB_Environment__c: { apiName: 'AVB_Environment__c', label: 'Environment' },
            RecordTypeId: { apiName: 'RecordTypeId', label: 'Record Type' }
        },
        recordTypeInfos: {
            '012000000000000AAA': { recordTypeId: '012000000000000AAA', name: 'Master', master: true },
            '012KB000000kcw4YAA': { recordTypeId: '012KB000000kcw4YAA', name: 'AvioBook Case', master: false },
            '012KB000000kcw5YAA': { recordTypeId: '012KB000000kcw5YAA', name: 'AvioData Case', master: false }
        }
    };

    async function loadRow(element, json) {
        const textarea = element.shadowRoot.querySelector('lightning-textarea');
        textarea.value = json;
        textarea.dispatchEvent(new CustomEvent('change', { detail: { value: json } }));
        Array.from(element.shadowRoot.querySelectorAll('lightning-button'))
            .find(b => b.label === 'Load')
            .click();
        await Promise.resolve();
        await Promise.resolve();
        element.shadowRoot.querySelector(`${FIELD_ROW} .nd-row-btn`).click();
        await Promise.resolve();
    }

    // Master is in recordTypeInfos but is not something to scope a row to.
    it('does not offer Master alongside real record types', async () => {
        const element = mount();
        getObjectInfo.emit(WITH_MASTER);
        await Promise.resolve();
        await loadRow(element, '[{"apiName":"AVB_Environment__c","showIfField":"RecordTypeId"}]');

        const choices = element.shadowRoot
            .querySelector('c-n-d_conditions-editor').valueChoices.RecordTypeId;
        expect(choices.map(o => o.label)).toEqual(['AvioBook Case', 'AvioData Case']);
    });

    it('reports no problem once two record types are chosen', async () => {
        const element = mount();
        getObjectInfo.emit(WITH_MASTER);
        await Promise.resolve();
        await loadRow(
            element,
            '[{"apiName":"AVB_Environment__c","showIfField":"RecordTypeId",'
            + '"showIfValue":"012KB000000kcw4YAA,012KB000000kcw5YAA"}]'
        );

        expect(text(element, '.nd-ok')).toMatch(/No unknown keys/);
        expect(element.shadowRoot.querySelector('.nd-finding')).toBeNull();
    });
});

describe('finding a field among many', () => {
    // Case has 127 fields, lightning-combobox has no type-ahead, and fields already used by
    // a row were silently removed — which is exactly why RecordTypeId looked missing.
    const MANY = {
        apiName: 'Case',
        fields: Object.assign(
            { RecordTypeId: { apiName: 'RecordTypeId', label: 'Record Type ID' } },
            ...Array.from({ length: 40 }, (unused, i) => ({
                [`Filler${i}__c`]: { apiName: `Filler${i}__c`, label: `Filler ${i}` }
            }))
        ),
        recordTypeInfos: {}
    };

    function search(element) {
        return Array.from(element.shadowRoot.querySelectorAll('lightning-input'))
            .find(i => i.label === 'Add a field');
    }

    async function type(element, needle) {
        const box = search(element);
        box.value = needle;
        // oninput, not onchange: it has to narrow while typing
        box.dispatchEvent(new CustomEvent('input'));
        await Promise.resolve();
    }

    function matched(element) {
        return Array.from(element.shadowRoot.querySelectorAll('.nd-match'))
            .map(b => b.dataset.field);
    }

    it('offers RecordTypeId', async () => {
        const element = mount();
        getObjectInfo.emit(MANY);
        await Promise.resolve();

        expect(matched(element)).toContain('RecordTypeId');
    });

    it('narrows while typing, by label', async () => {
        const element = mount();
        getObjectInfo.emit(MANY);
        await Promise.resolve();
        await type(element, 'record type');

        expect(matched(element)).toEqual(['RecordTypeId']);
    });

    it('narrows by API name too', async () => {
        const element = mount();
        getObjectInfo.emit(MANY);
        await Promise.resolve();
        await type(element, 'RecordTypeId');

        expect(matched(element)).toEqual(['RecordTypeId']);
    });

    it('is case-insensitive', async () => {
        const element = mount();
        getObjectInfo.emit(MANY);
        await Promise.resolve();
        await type(element, 'RECORD TYPE');

        expect(matched(element)).toEqual(['RecordTypeId']);
    });

    it('says so when nothing matches', async () => {
        const element = mount();
        getObjectInfo.emit(MANY);
        await Promise.resolve();
        await type(element, 'zzzznothing');

        expect(matched(element)).toEqual([]);
        expect(element.shadowRoot.textContent).toContain('No field matches that.');
    });

    it('adds the field on a single click', async () => {
        const element = mount();
        getObjectInfo.emit(MANY);
        await Promise.resolve();
        await type(element, 'record type');

        element.shadowRoot.querySelector('.nd-match[data-field="RecordTypeId"]').click();
        await Promise.resolve();

        expect(text(element, '.nd-json')).toContain('"apiName":"RecordTypeId"');
    });

    it('clears the search after adding, ready for the next one', async () => {
        const element = mount();
        getObjectInfo.emit(MANY);
        await Promise.resolve();
        await type(element, 'record type');

        element.shadowRoot.querySelector('.nd-match[data-field="RecordTypeId"]').click();
        await Promise.resolve();

        expect(matched(element).length).toBeGreaterThan(1);
    });
});

describe('a field that is already a row', () => {
    const FIELDS = {
        apiName: 'Case',
        fields: {
            RecordTypeId: { apiName: 'RecordTypeId', label: 'Record Type ID' },
            Status: { apiName: 'Status', label: 'Status' }
        },
        recordTypeInfos: {}
    };

    async function load(element, json) {
        const textarea = element.shadowRoot.querySelector('lightning-textarea');
        textarea.value = json;
        textarea.dispatchEvent(new CustomEvent('change', { detail: { value: json } }));
        Array.from(element.shadowRoot.querySelectorAll('lightning-button'))
            .find(b => b.label === 'Load')
            .click();
        await Promise.resolve();
        await Promise.resolve();
    }

    // Six of the live configs already had a RecordTypeId row, so the old picker removed it
    // from the list and said nothing — the field looked absent from the org.
    it('stays in the list, marked, instead of vanishing', async () => {
        const element = mount();
        getObjectInfo.emit(FIELDS);
        await Promise.resolve();
        await load(element, '[{"apiName":"RecordTypeId","label":"Record Type"}]');

        const used = element.shadowRoot.querySelector('.nd-match_used');
        expect(used).not.toBeNull();
        expect(used.dataset.field).toBe('RecordTypeId');
        expect(used.textContent).toContain('already a row');
    });

    it('opens the existing row rather than adding a duplicate', async () => {
        const element = mount();
        getObjectInfo.emit(FIELDS);
        await Promise.resolve();
        await load(element, '[{"apiName":"RecordTypeId","label":"Record Type"}]');

        element.shadowRoot.querySelector('.nd-match[data-field="RecordTypeId"]').click();
        await Promise.resolve();

        // Still one row, and its properties are now open
        expect(element.shadowRoot.querySelectorAll(FIELD_ROW)).toHaveLength(1);
        expect(text(element, '.nd-json')).toContain('"apiName":"RecordTypeId"');
        expect(element.shadowRoot.querySelector('.nd-group legend').textContent).toBe('Field');
    });
});
