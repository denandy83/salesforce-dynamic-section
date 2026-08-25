import { createElement } from 'lwc';
import ND_FieldCombobox from 'c/nD_fieldCombobox';

// One control replacing a dropdown plus a filter box beneath it. The searching that used
// to live in the builder and in the conditions editor now lives here, so these are the
// tests that used to sit in those two.

const OPTIONS = [
    { label: 'Issue Type', value: 'Type' },
    { label: 'Record Type ID', value: 'RecordTypeId' },
    { label: 'ICAO Account', value: 'AVB_ICAO_Account__c' },
    { label: 'Subject', value: 'Subject' }
];

function mount(props = {}) {
    const element = createElement('c-n-d_field-combobox', { is: ND_FieldCombobox });
    Object.assign(element, { label: 'Watch this field', options: OPTIONS, value: '' }, props);
    document.body.appendChild(element);
    return element;
}

const input = element => element.shadowRoot.querySelector('.nd-fc-input');
const panel = element => element.shadowRoot.querySelector('.nd-fc-panel');
const matches = element =>
    Array.from(element.shadowRoot.querySelectorAll('.nd-fc-match'));
const matchApis = element => matches(element).map(b => b.dataset.field);

function captureChange(element) {
    const seen = [];
    element.addEventListener('change', e => seen.push(e.detail.value));
    return seen;
}

async function search(element, term) {
    input(element).dispatchEvent(new CustomEvent('focus'));
    await Promise.resolve();
    input(element).value = term;
    input(element).dispatchEvent(new CustomEvent('input'));
    await Promise.resolve();
}

afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('closed', () => {
    it('shows the selected field, label and api name together', async () => {
        const element = mount({ value: 'AVB_ICAO_Account__c' });
        await Promise.resolve();
        expect(input(element).value).toBe('ICAO Account · AVB_ICAO_Account__c');
        expect(panel(element)).toBeNull();
    });

    it('shows the blank label when nothing is selected and blank means something', async () => {
        const element = mount({ value: '', blankLabel: "— this row's own field —" });
        await Promise.resolve();
        expect(input(element).value).toBe("— this row's own field —");
    });

    it('falls back to the raw api name for a field not in the list', async () => {
        const element = mount({ value: 'Gone__c' });
        await Promise.resolve();
        expect(input(element).value).toBe('Gone__c');
    });
});

describe('searching', () => {
    // Opening on an empty search means the control still works as the browsable dropdown it
    // replaces, for anyone who does not know what they are looking for.
    it('opens on focus with the whole list', async () => {
        const element = mount();
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();

        expect(panel(element)).not.toBeNull();
        expect(matchApis(element)).toEqual(OPTIONS.map(o => o.value));
    });

    it('narrows on the label as you type', async () => {
        const element = mount();
        await search(element, 'issue');
        expect(matchApis(element)).toEqual(['Type']);
    });

    it('narrows on the api name too', async () => {
        const element = mount();
        await search(element, 'icao_acc');
        expect(matchApis(element)).toEqual(['AVB_ICAO_Account__c']);
    });

    it('ignores case', async () => {
        const element = mount();
        await search(element, 'RECORDTYPE');
        expect(matchApis(element)).toEqual(['RecordTypeId']);
    });

    it('says so when nothing matches, rather than showing an empty box', async () => {
        const element = mount();
        await search(element, 'zzzz');
        expect(matches(element)).toHaveLength(0);
        expect(element.shadowRoot.querySelector('.nd-fc-none')).not.toBeNull();
    });

    it('counts what is on offer', async () => {
        const element = mount();
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();
        expect(element.shadowRoot.querySelector('.nd-fc-count').textContent).toBe('4 fields');

        await search(element, 'e');
        expect(element.shadowRoot.querySelector('.nd-fc-count').textContent)
            .toMatch(/^\d+ of 4$/);
    });

    // Opening on an empty search lists everything and the match cap keeps only the first
    // 60, so a selection that sorts past the cap would otherwise be missing entirely and
    // the open list would look like it had forgotten the choice.
    it('puts the current choice first, however far down the list it sorts', async () => {
        const many = Array.from({ length: 80 }, (_, i) => ({
            label: `Field ${String(i).padStart(2, '0')}`, value: `F${i}__c`
        }));
        const element = mount({ options: many, value: 'F79__c' });
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();

        expect(matchApis(element)[0]).toBe('F79__c');
        expect(matches(element)[0].className).toContain('nd-fc-match_current');
    });

    it('marks the current choice, which is otherwise lost in a full list', async () => {
        const element = mount({ value: 'Subject' });
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();

        const current = matches(element).filter(b => b.className.includes('nd-fc-match_current'));
        expect(current).toHaveLength(1);
        expect(current[0].dataset.field).toBe('Subject');
    });

    it('offers the blank value as the first choice when there is one', async () => {
        const element = mount({ blankLabel: '— none —' });
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();
        expect(matchApis(element)[0]).toBe('');
    });
});

describe('picking', () => {
    // mousedown, not click: click arrives after blur, and blur closes the list, so a click
    // handler would fire on an element that had already gone.
    it('picks on mousedown and reports the api name', async () => {
        const element = mount();
        const seen = captureChange(element);
        await search(element, 'icao');

        matches(element)[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(seen).toEqual(['AVB_ICAO_Account__c']);
    });

    it('closes and shows the new selection', async () => {
        const element = mount();
        await search(element, 'icao');
        matches(element)[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await Promise.resolve();

        expect(panel(element)).toBeNull();
    });

    it('says nothing when the pick is the value it already had', async () => {
        const element = mount({ value: 'Subject' });
        const seen = captureChange(element);
        await search(element, 'subject');

        matches(element)[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(seen).toEqual([]);
    });

    it('picks the top match on Enter', async () => {
        const element = mount();
        const seen = captureChange(element);
        await search(element, 'icao');

        input(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(seen).toEqual(['AVB_ICAO_Account__c']);
    });

    it('closes on Escape without choosing anything', async () => {
        const element = mount({ value: 'Subject' });
        const seen = captureChange(element);
        await search(element, 'icao');

        input(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await Promise.resolve();

        expect(panel(element)).toBeNull();
        expect(seen).toEqual([]);
        expect(input(element).value).toBe('Subject · Subject');
    });

    // Otherwise a half-typed term would sit in the box looking like the current value.
    it('reverts to the selection when it loses focus without a pick', async () => {
        const element = mount({ value: 'Subject' });
        await search(element, 'ica');

        input(element).dispatchEvent(new CustomEvent('blur'));
        await Promise.resolve();

        expect(panel(element)).toBeNull();
        expect(input(element).value).toBe('Subject · Subject');
    });
});

describe('disabled', () => {
    it('does not open', async () => {
        const element = mount({ disabled: true });
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();
        expect(panel(element)).toBeNull();
    });
});

describe('bugs that shipped once', () => {
    // Picking has to preventDefault on mousedown, or blur closes the list before the click
    // lands — which means focus never leaves the input, so a second click fired no focus
    // event and the list stayed shut until you clicked away and back.
    it('reopens on a click, without having to leave the field first', async () => {
        const element = mount();
        await Promise.resolve();

        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();
        matches(element)[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await Promise.resolve();
        expect(panel(element)).toBeNull();

        // A click with no focus change, exactly as after a pick.
        input(element).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await Promise.resolve();
        expect(panel(element)).not.toBeNull();
    });

    it('does not reset the search when clicking an already-open list', async () => {
        const element = mount();
        await search(element, 'icao');
        input(element).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await Promise.resolve();

        expect(matchApis(element)).toEqual(['AVB_ICAO_Account__c']);
    });

    // Saying "127 fields" over a list showing 60 of them is simply untrue.
    it('counts what is on screen when the list is capped', async () => {
        const many = Array.from({ length: 80 }, (_, i) => ({ label: `Field ${i}`, value: `F${i}__c` }));
        const element = mount({ options: many });
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-fc-count').textContent).toBe('first 60 of 80');
    });

    it('still reports the total when everything fits', async () => {
        const element = mount();
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();
        expect(element.shadowRoot.querySelector('.nd-fc-count').textContent).toBe('4 fields');
    });

    // The underline site's "this row's own field" has to select a REAL field name: a blank
    // one means "not chosen yet" at every site now.
    it('selects a real value for the extra leading choice', async () => {
        const element = mount({ blankLabel: "— this row's own field (Priority) —", blankValue: 'Priority' });
        const seen = captureChange(element);
        input(element).dispatchEvent(new CustomEvent('focus'));
        await Promise.resolve();

        expect(matchApis(element)[0]).toBe('Priority');
        matches(element)[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(seen).toEqual(['Priority']);
    });

    it('shows that choice as the selection when it is the current value', async () => {
        const element = mount({
            blankLabel: "— this row's own field (Priority) —", blankValue: 'Priority', value: 'Priority'
        });
        await Promise.resolve();
        expect(input(element).value).toBe("— this row's own field (Priority) —");
    });
});
