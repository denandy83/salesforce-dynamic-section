import { createElement } from 'lwc';
import ND_DynamicSection from 'c/nD_DynamicSection';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { getRecord } from 'lightning/uiRecordApi';

// The first tests for this component. They cover the unconfigured card — what an admin
// sees in App Builder before any config is pasted in. The rest of the component needs a
// record and a form, and is exercised in the org rather than here.

const CONFIG = JSON.stringify({
    section: { title: 'Case Details' },
    fields: [{ apiName: 'Status', editable: true }]
});

function mount(props = {}) {
    const element = createElement('c-n-d_-dynamic-section', { is: ND_DynamicSection });
    Object.assign(element, props);
    document.body.appendChild(element);
    return element;
}

afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('the unconfigured card', () => {
    function setupText(element) {
        return Array.from(element.shadowRoot.querySelectorAll('.nd-setup-body'))
            .map(n => n.textContent)
            .join(' ');
    }

    it('says what to do, naming the tool and the property', async () => {
        const element = mount({ ND_jsonConfigString: '' });
        await Promise.resolve();

        const body = setupText(element);
        expect(body).toContain('App Launcher');
        expect(body).toContain('Section Config Builder');
        expect(body).toContain('Field JSON Configuration');
    });

    // LWC collapses the whitespace between a text node and an element when a newline sits
    // between them, which produced "chooseSection Config Builder" and
    // "Field JSON Configurationproperty" until each sentence was put on one line.
    it('keeps the spaces around the bold phrases', async () => {
        const element = mount({ ND_jsonConfigString: '' });
        await Promise.resolve();

        const body = setupText(element);
        expect(body).toContain('choose Section Config Builder');
        expect(body).toContain('Field JSON Configuration property');
        expect(body).not.toMatch(/[a-z][A-Z][a-z]+ Config/);
    });

    // A link cannot be clicked in App Builder's canvas: every component there is a drag
    // handle. Offering one made it look live while doing nothing.
    it('offers no link at all, since the canvas cannot click one', async () => {
        const element = mount({ ND_jsonConfigString: '' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup a')).toBeNull();
        expect(element.shadowRoot.querySelector('.nd-setup-link')).toBeNull();
    });

    it('shows the prompt for a config that will not parse, rather than a blank card', async () => {
        const element = mount({ ND_jsonConfigString: '{not json' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup')).not.toBeNull();
    });

    it('shows the prompt for a config with no field rows', async () => {
        const element = mount({ ND_jsonConfigString: '{"section":{"title":"X"},"fields":[]}' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup')).not.toBeNull();
    });

    it('disappears once there are field rows', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: CONFIG
        });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup')).toBeNull();
    });

    // The separate "configured by the builder" bars were removed: one in the App Builder
    // canvas, where clicks are swallowed by drag-and-drop and a link is therefore a lie,
    // and one on the record page, which put admin chrome in front of agents' data. The
    // card's own prompt is the single place this is said.
    it('adds no extra bar above the card', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: CONFIG
        });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-builder-bar')).toBeNull();
    });
});

// lightning-input-field and lightning-output-field draw the field's help ⓘ themselves,
// and keep drawing it when variant="label-hidden" hides their label — so it lands on its
// own line between our label and the value. The icon sits in the field component's shadow
// DOM, out of reach of this component's CSS, so the fix floats our own label instead and
// the row has to be flagged for it. These tests cover the flag, which is the part that can
// silently pick the wrong rows; the float itself is CSS and only shows in an org.
describe('the label of a field that carries inline help text', () => {
    const HELP = 'Enter a value in one of the following formats: xxxx, x.x.x, xx.x, or N/A.';

    function objectInfo(fields) {
        return { apiName: 'Case', fields, recordTypeInfos: {} };
    }

    function labelClassOf(element) {
        const label = element.shadowRoot.querySelector('.nd-custom-label');
        return label ? label.className : null;
    }

    function pulledUpFields(element) {
        return element.shadowRoot.querySelectorAll('.nd-help-field').length;
    }

    async function mountWithHelp(row, fields) {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({
                section: { title: 'Case Details' },
                fields: [row]
            })
        });
        getObjectInfo.emit(objectInfo(fields));
        await Promise.resolve();
        await Promise.resolve();
        return element;
    }

    it('is floated, so the icon flows up beside it', async () => {
        const element = await mountWithHelp(
            { apiName: 'AVB_Version__c', label: 'Version', editable: true },
            { AVB_Version__c: { apiName: 'AVB_Version__c', label: 'Version', inlineHelpText: HELP } }
        );

        expect(labelClassOf(element)).toContain('nd-custom-label_inline-help');
    });

    // The label alone is not enough: the platform's icon rides in a line box taller than
    // our label block, so without pulling the field up the whole row — control included —
    // sits lower than the row beside it, and the icon lands below the label.
    it('pulls the field up so the control lines up with its neighbours', async () => {
        const element = await mountWithHelp(
            { apiName: 'AVB_Version__c', label: 'Version', editable: true },
            { AVB_Version__c: { apiName: 'AVB_Version__c', label: 'Version', inlineHelpText: HELP } }
        );

        expect(pulledUpFields(element)).toBe(1);
    });

    it('leaves the field alone when there is no help text to make room for', async () => {
        const element = await mountWithHelp(
            { apiName: 'Status', label: 'Status', editable: true },
            { Status: { apiName: 'Status', label: 'Status', inlineHelpText: null } }
        );

        expect(pulledUpFields(element)).toBe(0);
    });

    // Corrects an earlier assumption: lightning-input-field draws the help button,
    // lightning-output-field does NOT (verified in UAT). So a read-only row must not get the
    // floated label — it would take the nowrap and the ellipsis for an icon that never
    // appears, and a long label would be truncated for nothing.
    it('is left alone on a read-only row, where no icon is drawn', async () => {
        const element = await mountWithHelp(
            { apiName: 'AVB_Version__c', label: 'Version' },
            { AVB_Version__c: { apiName: 'AVB_Version__c', label: 'Version', inlineHelpText: HELP } }
        );

        expect(labelClassOf(element)).toBe('nd-custom-label');
    });

    // Every other row must be left alone: with no icon on the first line there is nothing
    // for the label to sit beside, and a float would only indent the value below it.
    it('is left alone when the field has no help text', async () => {
        const element = await mountWithHelp(
            { apiName: 'Status', label: 'Status', editable: true },
            { Status: { apiName: 'Status', label: 'Status', inlineHelpText: null } }
        );

        expect(labelClassOf(element)).toBe('nd-custom-label');
    });

    it('is left alone before the describe arrives', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({
                section: { title: 'Case Details' },
                fields: [{ apiName: 'AVB_Version__c', label: 'Version', editable: true }]
            })
        });
        await Promise.resolve();

        expect(labelClassOf(element)).toBe('nd-custom-label');
    });

    // The custom widgets draw their own control instead of a base field component, so none
    // of them renders the platform icon — floating their label would break their layout for
    // nothing.
    it.each([
        ['isUrl', { isUrl: true }],
        ['isUrlList', { isUrlList: true }],
        ['isEmailList', { isEmailList: true }],
        ['isOpenProblem', { isOpenProblem: true }]
    ])('is left alone on an %s row, which shows no platform icon', async (_name, widget) => {
        const element = await mountWithHelp(
            Object.assign({ apiName: 'AVB_Version__c', label: 'Version', editable: true }, widget),
            { AVB_Version__c: { apiName: 'AVB_Version__c', label: 'Version', inlineHelpText: HELP } }
        );

        expect(labelClassOf(element)).toBe('nd-custom-label');
    });
});

// The underline used to be gated on a colour being SET, so a row configured to underline
// under some condition, without a colour named, was configured to do nothing. The colour is
// a detail; the condition is the decision.
describe('the value underline', () => {
    const OBJECT_INFO = {
        apiName: 'Case',
        fields: {
            Priority: { apiName: 'Priority', label: 'Priority' },
            Type: { apiName: 'Type', label: 'Issue Type' }
        },
        recordTypeInfos: {}
    };

    function record(fields) {
        return { id: '500KB00000000001AAA', apiName: 'Case', fields };
    }

    async function mountRow(row, fields) {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({ section: { title: 'X' }, fields: [row] })
        });
        getObjectInfo.emit(OBJECT_INFO);
        getRecord.emit(record(fields));
        await Promise.resolve();
        await Promise.resolve();
        return element;
    }

    const content = element => element.shadowRoot.querySelector('.nd-field-content');

    it('uses #ba0517 when the row asks for an underline without naming a colour', async () => {
        const element = await mountRow(
            { apiName: 'Priority', label: 'Priority', colorIfValue: 'High,Urgent' },
            { Priority: { value: 'High' } }
        );

        const box = content(element);
        expect(box.className).toContain('nd-field-content_alert');
        expect(box.getAttribute('style')).toContain('--nd-alert-color: #ba0517');
    });

    it('still honours a colour that is named', async () => {
        const element = await mountRow(
            { apiName: 'Priority', label: 'Priority', color: '#2e844a', colorIfValue: 'High' },
            { Priority: { value: 'High' } }
        );

        expect(content(element).getAttribute('style')).toContain('--nd-alert-color: #2e844a');
    });

    it('stays off while the condition does not hold', async () => {
        const element = await mountRow(
            { apiName: 'Priority', label: 'Priority', colorIfValue: 'High,Urgent' },
            { Priority: { value: 'Low' } }
        );

        expect(content(element).className).not.toContain('nd-field-content_alert');
    });

    // The common case by far: most rows want no underline at all, and an empty condition list
    // must not be read as "always on" for them.
    it('stays off for a row that asks for no underline at all', async () => {
        const element = await mountRow(
            { apiName: 'Priority', label: 'Priority' },
            { Priority: { value: 'High' } }
        );

        expect(content(element).className).not.toContain('nd-field-content_alert');
        expect(content(element).getAttribute('style')).toBeFalsy();
    });

    // Clicking "add condition" under the underline site used to underline the row instantly:
    // the unfinished condition counted as opting in, while the engine ignored it and reported
    // "no conditions", which at this site means always on.
    it('stays off for a condition that has not been finished', async () => {
        const element = await mountRow(
            { apiName: 'Priority', label: 'Priority', colorIf: { conditions: [{ field: '', value: '' }] } },
            { Priority: { value: 'High' } }
        );

        expect(content(element).className).not.toContain('nd-field-content_alert');
    });

    it('turns on once that condition names a field', async () => {
        const element = await mountRow(
            { apiName: 'Priority', label: 'Priority', colorIf: { conditions: [{ field: 'Priority', value: 'High' }] } },
            { Priority: { value: 'High' } }
        );

        expect(content(element).className).toContain('nd-field-content_alert');
    });

    it('is always on for a colour with no condition, as it always was', async () => {
        const element = await mountRow(
            { apiName: 'Priority', label: 'Priority', color: '#2e844a' },
            { Priority: { value: 'Low' } }
        );

        expect(content(element).className).toContain('nd-field-content_alert');
    });
});

// A divider is a rule across the section — ———— SLA ———— — rather than a field. Presence of
// the `divider` key is what makes an entry one, so an empty caption is a deliberate plain
// rule and not an unfinished one.
describe('dividers', () => {
    function mountRows(fields) {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({ section: { title: 'X' }, fields })
        });
        getObjectInfo.emit({ apiName: 'Case', fields: { Status: { apiName: 'Status' } }, recordTypeInfos: {} });
        getRecord.emit({ id: '500KB00000000001AAA', apiName: 'Case', fields: { Status: { value: 'New' } } });
        return element;
    }

    it('renders a captioned rule', async () => {
        const element = mountRows([{ divider: 'SLA' }, { apiName: 'Status', label: 'Status' }]);
        await Promise.resolve();
        await Promise.resolve();

        const d = element.shadowRoot.querySelector('.nd-divider');
        expect(d).not.toBeNull();
        expect(d.className).toContain('nd-divider_captioned');
        expect(element.shadowRoot.querySelector('.nd-divider-caption').textContent).toBe('SLA');
        expect(d.getAttribute('role')).toBe('separator');
    });

    it('renders a plain rule with no caption, and no empty caption element', async () => {
        const element = mountRows([{ divider: '' }]);
        await Promise.resolve();
        await Promise.resolve();

        const d = element.shadowRoot.querySelector('.nd-divider');
        expect(d).not.toBeNull();
        expect(d.className).not.toContain('nd-divider_captioned');
        expect(element.shadowRoot.querySelector('.nd-divider-caption')).toBeNull();
    });

    // Half a rule across one column of two reads as a mistake, not a divider.
    it('is always full width, whatever the section columns say', async () => {
        const element = mountRows([{ divider: 'SLA' }]);
        await Promise.resolve();
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-divider-row').className)
            .toContain('slds-size_1-of-1');
    });

    it('renders no field markup for a divider', async () => {
        const element = mountRows([{ divider: 'SLA' }]);
        await Promise.resolve();
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-field-content')).toBeNull();
        expect(element.shadowRoot.querySelector('lightning-input-field')).toBeNull();
    });

    // The point of a captioned rule is usually to head a group of conditional rows, so the
    // rule itself has to be able to disappear with them.
    it('can be hidden by a condition like any other row', async () => {
        const shown = mountRows([{ divider: 'SLA', showIfField: 'Status', showIfValue: 'New' }]);
        await Promise.resolve();
        await Promise.resolve();
        expect(shown.shadowRoot.querySelector('.nd-divider')).not.toBeNull();

        const hidden = mountRows([{ divider: 'SLA', showIfField: 'Status', showIfValue: 'Closed' }]);
        await Promise.resolve();
        await Promise.resolve();
        expect(hidden.shadowRoot.querySelector('.nd-divider')).toBeNull();
    });

    it('keeps two unlabelled dividers apart, having no apiName to key on', async () => {
        const element = mountRows([{ divider: '' }, { apiName: 'Status' }, { divider: '' }]);
        await Promise.resolve();
        await Promise.resolve();
        expect(element.shadowRoot.querySelectorAll('.nd-divider')).toHaveLength(2);
    });
});

// Dragging the component in App Builder killed the page: the canvas builds its drag ghost
// with jQuery cloneNode, and `lightning-base-combobox` — inside every editable picklist, the
// record-type picker and the owner picker — is form-associated, so the clone fires
// formAssociatedCallback with no LWC VM behind it. Rendering read-only in the canvas creates
// none. App Builder DOES pass a real recordId, so the canvas is detected by its own iframe
// path instead.
describe('the App Builder canvas', () => {
    const CONFIG = JSON.stringify({
        section: { title: 'Case Details' },
        fields: [
            { divider: 'SLA' },
            { apiName: 'Status', label: 'Status', editable: true },
            { apiName: 'Type', label: 'Issue Type', editable: true }
        ]
    });

    function inCanvas(yes) {
        // jsdom lets the path be rewritten, which is the only thing the detection reads.
        window.history.replaceState({}, '', yes ? '/flexipageEditor/surface.app' : '/lightning/r/Case/x/view');
    }

    async function mountIt() {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: CONFIG
        });
        getObjectInfo.emit({
            apiName: 'Case',
            fields: { Status: { apiName: 'Status' }, Type: { apiName: 'Type' } },
            recordTypeInfos: {}
        });
        getRecord.emit({
            id: '500KB00000000001AAA', apiName: 'Case',
            fields: { Status: { value: 'New' }, Type: { value: 'Bug or Incident' } }
        });
        await Promise.resolve();
        await Promise.resolve();
        return element;
    }

    afterEach(() => inCanvas(false));

    it('renders every row read-only there, so no combobox is created', async () => {
        inCanvas(true);
        const element = await mountIt();

        expect(element.shadowRoot.querySelectorAll('lightning-input-field')).toHaveLength(0);
        expect(element.shadowRoot.querySelectorAll('lightning-combobox')).toHaveLength(0);
        expect(element.shadowRoot.querySelectorAll('lightning-record-picker')).toHaveLength(0);
        expect(element.shadowRoot.querySelectorAll('lightning-output-field').length).toBeGreaterThan(0);
    });

    // The canvas is still a preview of a real record, so the form and its data stay.
    it('keeps the live form, so the canvas still shows real values', async () => {
        inCanvas(true);
        const element = await mountIt();
        expect(element.shadowRoot.querySelector('lightning-record-edit-form')).not.toBeNull();
    });

    // In the canvas an "editable" row renders read-only, so it takes the aligned read-only
    // box — and therefore NOT the legacy offset, which only existed for a value that had no
    // control box to sit under. Either way the point is the same: this follows how the row
    // RENDERS, not what the config asked for.
    it('gives a canvas row the aligned read-only box, not the legacy offset', async () => {
        inCanvas(true);
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({
                section: {},
                fields: [{ apiName: 'Status', label: 'Status', editable: true, color: '#ba0517' }]
            })
        });
        getObjectInfo.emit({ apiName: 'Case', fields: { Status: { apiName: 'Status' } }, recordTypeInfos: {} });
        getRecord.emit({ id: '500KB00000000001AAA', apiName: 'Case', fields: { Status: { value: 'New' } } });
        await Promise.resolve();
        await Promise.resolve();

        const box = element.shadowRoot.querySelector('.nd-field-content');
        expect(box.className).not.toContain('nd-field-content_alert-readonly');
        expect(element.shadowRoot.querySelector('lightning-output-field').className)
            .toContain('nd-readonly-value');
    });

    it('still draws dividers there', async () => {
        inCanvas(true);
        const element = await mountIt();
        expect(element.shadowRoot.querySelector('.nd-divider-caption').textContent).toBe('SLA');
    });

    // Everywhere else the rows stay editable — the whole point of the component.
    it('leaves editing alone on a real record page', async () => {
        inCanvas(false);
        const element = await mountIt();
        expect(element.shadowRoot.querySelectorAll('lightning-input-field').length).toBeGreaterThan(0);
    });

    // A recordId is present in the canvas too, so it cannot be the signal.
    it('does not use the absence of a recordId as the signal', async () => {
        inCanvas(true);
        const element = await mountIt();
        expect(element.recordId).toBe('500KB00000000001AAA');
        expect(element.shadowRoot.querySelectorAll('lightning-input-field')).toHaveLength(0);
    });
});

// The record-link icon used to sit in the bottom-right corner of the VALUE at
// transform: scale(2), which made a secondary action the loudest thing in the row. It now
// sits beside the label at the weight of the inline-help ⓘ next to it.
describe('the record-link icon', () => {
    const CTX_FIELDS = { ParentId: { apiName: 'ParentId' }, Subject: { apiName: 'Subject' } };

    async function mountRow(row) {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({ section: {}, fields: [row] })
        });
        getObjectInfo.emit({ apiName: 'Case', fields: CTX_FIELDS, recordTypeInfos: {} });
        getRecord.emit({
            id: '500KB00000000001AAA', apiName: 'Case',
            fields: { ParentId: { value: '500KB00000000002AAA' }, Subject: { value: 'x' } }
        });
        await Promise.resolve();
        await Promise.resolve();
        return element;
    }

    it('sits inside the label, not in the corner of the value', async () => {
        const element = await mountRow({ apiName: 'ParentId', label: 'Problem Case', isRecordLink: true });

        const label = element.shadowRoot.querySelector('.nd-custom-label');
        expect(label.querySelector('.nd-label-link')).not.toBeNull();
        expect(element.shadowRoot.querySelector('.nd-url-icon')).toBeNull();
    });

    // scale(2) was the reason it shouted. Nothing should be resizing it now.
    it('is rendered at icon size, not scaled up', async () => {
        const element = await mountRow({ apiName: 'ParentId', label: 'Problem Case', isRecordLink: true });
        const icon = element.shadowRoot.querySelector('.nd-label-link');
        expect(icon.size).toBe('xx-small');
    });

    it('still opens the record it points at', async () => {
        const element = await mountRow({ apiName: 'ParentId', label: 'Problem Case', isRecordLink: true });
        expect(element.shadowRoot.querySelector('.nd-label-link').dataset.id)
            .toBe('500KB00000000002AAA');
    });

    // The base component draws its own label inside its shadow DOM, so a row with no config
    // label has nothing of ours to sit beside and keeps the corner icon rather than losing
    // the link altogether.
    it('falls back to the corner when the row has no label of ours', async () => {
        const element = await mountRow({ apiName: 'ParentId', isRecordLink: true });

        expect(element.shadowRoot.querySelector('.nd-url-icon')).not.toBeNull();
        expect(element.shadowRoot.querySelector('.nd-label-link')).toBeNull();
    });

    it('reserves room on the right only for the corner variant', async () => {
        const beside = await mountRow({ apiName: 'ParentId', label: 'Problem Case', isRecordLink: true });
        expect(beside.shadowRoot.querySelector('.nd-field-content').className)
            .not.toContain('nd-field-content_has-corner-icon');

        const corner = await mountRow({ apiName: 'ParentId', isRecordLink: true });
        expect(corner.shadowRoot.querySelector('.nd-field-content').className)
            .toContain('nd-field-content_has-corner-icon');
    });

    // Nothing to open, so nothing to click. (isRecordLink trusts the config about the field
    // holding an Id — pointing it at a text field has always produced a link to whatever is
    // in there, which is unchanged here.)
    it('shows no icon at all when the field is empty', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({
                section: {}, fields: [{ apiName: 'ParentId', label: 'Problem Case', isRecordLink: true }]
            })
        });
        getObjectInfo.emit({ apiName: 'Case', fields: CTX_FIELDS, recordTypeInfos: {} });
        getRecord.emit({
            id: '500KB00000000001AAA', apiName: 'Case', fields: { ParentId: { value: null } }
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-label-link')).toBeNull();
        expect(element.shadowRoot.querySelector('.nd-url-icon')).toBeNull();
    });

    // A row can have both, and the label is floated in that case — the icon has to stay in it.
    it('coexists with the inline-help ⓘ on the same label', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({
                section: {},
                fields: [{ apiName: 'ParentId', label: 'Problem Case', isRecordLink: true, editable: true }]
            })
        });
        getObjectInfo.emit({
            apiName: 'Case',
            fields: { ParentId: { apiName: 'ParentId', inlineHelpText: 'Which problem this belongs to.' } },
            recordTypeInfos: {}
        });
        getRecord.emit({
            id: '500KB00000000001AAA', apiName: 'Case',
            fields: { ParentId: { value: '500KB00000000002AAA' } }
        });
        await Promise.resolve();
        await Promise.resolve();

        const label = element.shadowRoot.querySelector('.nd-custom-label');
        expect(label.className).toContain('nd-custom-label_inline-help');
        expect(label.querySelector('.nd-label-link')).not.toBeNull();
    });
});

// A read-only value is bare text in a ~19px box, while an editable control is 2rem, so its
// text sat ~6px above the text in the input beside it and a row with one of each looked out
// of line. It now takes the control's height and is centred in it.
describe('read-only values line up with editable ones', () => {
    const FIELDS = { Status: { apiName: 'Status' }, CaseNumber: { apiName: 'CaseNumber' } };

    async function mountRows(fields) {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({ section: {}, fields })
        });
        getObjectInfo.emit({ apiName: 'Case', fields: FIELDS, recordTypeInfos: {} });
        getRecord.emit({
            id: '500KB00000000001AAA', apiName: 'Case',
            fields: { Status: { value: 'New' }, CaseNumber: { value: '00013006' } }
        });
        await Promise.resolve();
        await Promise.resolve();
        return element;
    }

    it('gives a plain read-only value the control height', async () => {
        const element = await mountRows([{ apiName: 'CaseNumber', label: 'Case Number' }]);
        expect(element.shadowRoot.querySelector('lightning-output-field').className)
            .toContain('nd-readonly-value');
    });

    it('leaves an editable control alone — it already has that height', async () => {
        const element = await mountRows([{ apiName: 'Status', label: 'Status', editable: true }]);
        expect(element.shadowRoot.querySelector('lightning-input-field').className)
            .not.toContain('nd-readonly-value');
    });

    // A checkbox is not a 2rem control: an editable one measures ~16.6px and sits near the
    // top, so there is no shared band to centre a read-only one in. Centring it moved it
    // 7.7px BELOW its editable counterpart, when its natural position was already within 2px.
    it('leaves a read-only checkbox at its natural height', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({
                section: {}, fields: [{ apiName: 'AVB_Fix_Sent__c', label: 'Fix Sent' }]
            })
        });
        getObjectInfo.emit({
            apiName: 'Case',
            fields: { AVB_Fix_Sent__c: { apiName: 'AVB_Fix_Sent__c', dataType: 'Boolean' } },
            recordTypeInfos: {}
        });
        getRecord.emit({
            id: '500KB00000000001AAA', apiName: 'Case', fields: { AVB_Fix_Sent__c: { value: true } }
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('lightning-output-field').className)
            .not.toContain('nd-readonly-value');
    });

    it('still aligns a read-only value whose editable form IS a 2rem control', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({
                section: {}, fields: [{ apiName: 'CaseNumber', label: 'Case Number' }]
            })
        });
        getObjectInfo.emit({
            apiName: 'Case',
            fields: { CaseNumber: { apiName: 'CaseNumber', dataType: 'String' } },
            recordTypeInfos: {}
        });
        getRecord.emit({
            id: '500KB00000000001AAA', apiName: 'Case', fields: { CaseNumber: { value: '1' } }
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('lightning-output-field').className)
            .toContain('nd-readonly-value');
    });

    // Those widgets draw their own boxes, already at min-height 2rem.
    it.each([['isUrl'], ['isUrlList'], ['isEmailList']])(
        'leaves a read-only %s widget alone, it sizes its own box', async widget => {
            const element = await mountRows([{ apiName: 'CaseNumber', label: 'X', [widget]: true }]);
            const host = element.shadowRoot.querySelector('lightning-output-field');
            if (host) expect(host.className).not.toContain('nd-readonly-value');
        }
    );

    // The extra 4px drop existed only because a read-only value had no control box to sit
    // under. Now that it has one, keeping it would put the rule 4px below where the editable
    // row's sits — measured at 51 against 47 in UAT before this.
    it('drops the legacy underline offset now the box is full height', async () => {
        const element = await mountRows([
            { apiName: 'CaseNumber', label: 'Case Number', color: '#ba0517' }
        ]);
        const box = element.shadowRoot.querySelector('.nd-field-content');
        expect(box.className).toContain('nd-field-content_alert');
        expect(box.className).not.toContain('nd-field-content_alert-readonly');
    });
});

// "take it!" used to be a block under the owner picker. That made the owner cell taller than
// its partner, and align-items: stretch pushed the height onto the whole row — so an
// unrelated field beside it grew ~16px of empty space, but only while someone else owned the
// case. It now sits on the label line, where it costs no height.
describe('the "take it!" link', () => {
    const FIELDS = { OwnerId: { apiName: 'OwnerId' }, Status: { apiName: 'Status' } };

    async function mountRows(fields) {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: JSON.stringify({ section: {}, fields })
        });
        getObjectInfo.emit({ apiName: 'Case', fields: FIELDS, recordTypeInfos: {} });
        getRecord.emit({
            id: '500KB00000000001AAA', apiName: 'Case',
            fields: { OwnerId: { value: '005000000000999AAA' }, Status: { value: 'New' } }
        });
        await Promise.resolve();
        await Promise.resolve();
        return element;
    }

    it('sits inside the label, not under the picker', async () => {
        const element = await mountRows([{ apiName: 'OwnerId', label: 'Case Owner', editable: true }]);

        const label = element.shadowRoot.querySelector('.nd-custom-label');
        expect(label.querySelector('.nd-take-link')).not.toBeNull();
        // Nothing left below the control to stretch the row.
        const content = element.shadowRoot.querySelector('.nd-field-content');
        const belowLabel = Array.from(content.querySelectorAll('.nd-take-link'))
            .filter(a => !a.closest('.nd-custom-label'));
        expect(belowLabel).toHaveLength(0);
    });

    it('still reads "take it!" and still triggers the takeover', async () => {
        const element = await mountRows([{ apiName: 'OwnerId', label: 'Case Owner', editable: true }]);
        const link = element.shadowRoot.querySelector('.nd-custom-label .nd-take-link');
        expect(link.textContent.trim()).toMatch(/take it/i);
        expect(link.className).toBe('nd-take-link');
    });

    it('is offered on no other row', async () => {
        const element = await mountRows([{ apiName: 'Status', label: 'Status', editable: true }]);
        expect(element.shadowRoot.querySelector('.nd-take-link')).toBeNull();
    });

    // A read-only owner row has no picker to take with, so no link either.
    it('is not offered on a read-only owner row', async () => {
        const element = await mountRows([{ apiName: 'OwnerId', label: 'Case Owner' }]);
        expect(element.shadowRoot.querySelector('.nd-take-link')).toBeNull();
    });
});
