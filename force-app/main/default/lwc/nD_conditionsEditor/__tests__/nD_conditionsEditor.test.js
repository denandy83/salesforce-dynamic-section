import { createElement } from 'lwc';
import ND_ConditionsEditor from 'c/nD_conditionsEditor';

// The editor holds no config state: every edit rebuilds the whole group and fires it
// upward, so almost every test here is "do this, and check what came out in the event".

const FIELD_OPTIONS = [
    { label: 'Issue Type', value: 'Type' },
    { label: 'Record Type ID', value: 'RecordTypeId' },
    { label: 'ICAO Account', value: 'AVB_ICAO_Account__c' },
    { label: 'Subject', value: 'Subject' }
];

const FIELD_TYPES = {
    Type: 'Picklist',
    RecordTypeId: 'Reference',
    AVB_ICAO_Account__c: 'String',
    Subject: 'String',
    Remind__c: 'Date',
    Created__c: 'DateTime'
};

const VALUE_CHOICES = {
    Type: [{ label: 'Bug or Incident', value: 'Bug or Incident' }],
    RecordTypeId: [{ label: 'AvioBook Case', value: '012KB000000kcw4YAA' }]
};

function mount(props = {}) {
    const element = createElement('c-n-d_conditions-editor', { is: ND_ConditionsEditor });
    Object.assign(element, {
        site: 'showIf',
        legend: 'Show this row only when…',
        fieldOptions: FIELD_OPTIONS,
        valueChoices: VALUE_CHOICES,
        fieldTypes: FIELD_TYPES,
        group: { logic: 'AND', conditions: [] }
    }, props);
    document.body.appendChild(element);
    return element;
}

function group(conditions, logic = 'AND') {
    return { logic, conditions };
}

/** The group carried by the next `change` event. */
function captureChange(element) {
    const seen = [];
    element.addEventListener('change', e => seen.push(e.detail));
    return seen;
}

function all(element, selector) {
    return Array.from(element.shadowRoot.querySelectorAll(selector));
}

function byLabel(element, tag, label) {
    return all(element, tag).find(n => n.label === label);
}

afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('an empty site', () => {
    it('says so rather than showing a blank panel', async () => {
        const element = mount();
        await Promise.resolve();
        expect(element.shadowRoot.querySelector('.nd-cond-empty')).not.toBeNull();
        expect(all(element, '.nd-cond-row')).toHaveLength(0);
    });

    it('adds a blank condition', async () => {
        const element = mount();
        const seen = captureChange(element);
        await Promise.resolve();

        element.shadowRoot.querySelector('.nd-cond-add').click();
        expect(seen[0].site).toBe('showIf');
        // Starts in "is one of" with nothing listed, which is what a condition is for most
        // of the time — the empty string is what records "comparing, nothing listed yet".
        expect(seen[0].group.conditions).toEqual([{ field: '', value: '', negate: false }]);
    });
});

describe('the condition cards', () => {
    it('renders one per condition, numbered from 1', async () => {
        const element = mount({
            group: group([{ field: 'Type' }, { field: 'RecordTypeId' }])
        });
        await Promise.resolve();

        expect(all(element, '.nd-cond-row')).toHaveLength(2);
        expect(all(element, '.nd-cond-num').map(n => n.textContent)).toEqual(['1', '2']);
    });

    it('removes the one that was clicked', async () => {
        const element = mount({
            group: group([{ field: 'Type' }, { field: 'RecordTypeId' }])
        });
        const seen = captureChange(element);
        await Promise.resolve();

        all(element, '.nd-cond-row lightning-button-icon')[0].click();
        expect(seen[0].group.conditions).toEqual([{ field: 'RecordTypeId' }]);
    });

    // The old value belonged to the old field's value set, so keeping it would leave a
    // condition that can never match anything.
    it('drops the value when the watched field changes', async () => {
        const element = mount({
            group: group([{ field: 'Type', value: 'Bug or Incident' }])
        });
        const seen = captureChange(element);
        await Promise.resolve();

        byLabel(element, 'c-n-d_field-combobox', 'Watch this field')
            .dispatchEvent(new CustomEvent('change', { detail: { value: 'RecordTypeId' } }));

        expect(seen[0].group.conditions).toEqual([{ field: 'RecordTypeId' }]);
    });

    const OPS = ['is one of', 'is not one of', 'has any value', 'is empty'];
    const match = element => byLabel(element, 'lightning-combobox', 'Match');

    // The options used to be computed from whether the value box was empty, so the dropdown
    // relabelled itself the moment you typed — you could pick "has any value", type, and find
    // yourself looking at "is one of". Four fixed options, whatever state the condition is in.
    it('offers the same four operators whatever the condition holds', async () => {
        const cases = [
            [{ field: 'Type', value: 'a' }, 'oneOf'],
            [{ field: 'Type', value: 'a', negate: true }, 'notOneOf'],
            [{ field: 'Type' }, 'any'],
            [{ field: 'Type', negate: true }, 'empty'],
            [{ field: 'Type', value: '' }, 'oneOf']
        ];
        for (const [condition, expected] of cases) {
            const element = mount({ group: group([condition]) });
            await Promise.resolve();
            expect(match(element).options.map(o => o.label)).toEqual(OPS);
            expect(match(element).value).toBe(expected);
        }
    });

    it('negates through the operator, keeping the values', async () => {
        const element = mount({ group: group([{ field: 'Type', value: 'a' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        match(element).dispatchEvent(new CustomEvent('change', { detail: { value: 'notOneOf' } }));
        expect(seen[0].group.conditions).toEqual([{ field: 'Type', value: 'a', negate: true }]);
    });

    it('drops the value list when it stops comparing values', async () => {
        const element = mount({ group: group([{ field: 'Type', value: 'a' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        match(element).dispatchEvent(new CustomEvent('change', { detail: { value: 'empty' } }));
        expect(seen[0].group.conditions).toEqual([{ field: 'Type', negate: true }]);
    });

    // Choosing "is one of" before typing anything has to be representable, or the dropdown
    // would snap straight back to "has any value" on the next render.
    it('holds "is one of" with nothing listed yet', async () => {
        const element = mount({ group: group([{ field: 'Type' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        match(element).dispatchEvent(new CustomEvent('change', { detail: { value: 'oneOf' } }));
        expect(seen[0].group.conditions).toEqual([{ field: 'Type', value: '', negate: false }]);
    });

    it('shows the value control only for the operators that compare values', async () => {
        // Subject has no fixed values, so it is the text-box path; Type has a picklist.
        const asText = mount({ group: group([{ field: 'Subject', value: '' }]) });
        await Promise.resolve();
        expect(asText.shadowRoot.querySelector('.nd-cond-input')).not.toBeNull();

        const asList = mount({ group: group([{ field: 'Type', value: '' }]) });
        await Promise.resolve();
        expect(byLabel(asList, 'lightning-checkbox-group', 'Values')).not.toBeUndefined();

        const noValues = mount({ group: group([{ field: 'Type' }]) });
        await Promise.resolve();
        expect(noValues.shadowRoot.querySelector('.nd-cond-input')).toBeNull();
        expect(byLabel(noValues, 'lightning-checkbox-group', 'Values')).toBeUndefined();
    });
});

describe('choosing values', () => {
    it('offers a checkbox group when the field has fixed values', async () => {
        const element = mount({ group: group([{ field: 'Type', value: 'Bug or Incident' }]) });
        await Promise.resolve();

        const box = byLabel(element, 'lightning-checkbox-group', 'Values');
        expect(box).not.toBeUndefined();
        expect(box.value).toEqual(['Bug or Incident']);
    });

    it('falls back to a text box when it does not', async () => {
        const element = mount({ group: group([{ field: 'Subject', value: 'anything' }]) });
        await Promise.resolve();

        expect(byLabel(element, 'lightning-checkbox-group', 'Values')).toBeUndefined();
        expect(element.shadowRoot.querySelector('.nd-cond-input').value).toBe('anything');
    });

    // Several values in one condition IS the "one of these" case — KLM,SWA rather than two
    // conditions OR'd together. It has to be typeable, which means the box has to survive
    // being cleared first.
    it('takes a comma-separated list', async () => {
        const element = mount({ group: group([{ field: 'AVB_ICAO_Account__c', value: '' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        const box = element.shadowRoot.querySelector('.nd-cond-input');
        box.value = 'KLM,SWA';
        box.dispatchEvent(new Event('change'));

        expect(seen[0].group.conditions).toEqual([
            { field: 'AVB_ICAO_Account__c', value: 'KLM,SWA' }
        ]);
    });

    it('joins a multi-select back into the comma-separated form the config stores', async () => {
        const element = mount({ group: group([{ field: 'RecordTypeId', value: '' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        byLabel(element, 'lightning-checkbox-group', 'Values')
            .dispatchEvent(new CustomEvent('change', { detail: { value: ['A', 'B'] } }));

        expect(seen[0].group.conditions).toEqual([{ field: 'RecordTypeId', value: 'A,B' }]);
    });

    // Clearing the box must NOT drop the key: that would move the condition to "has any
    // value" and take the box away mid-edit, which is the bug this shape exists to stop.
    it('clearing the box leaves it in list mode, box and all', async () => {
        const element = mount({ group: group([{ field: 'Subject', value: 'x' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        const box = element.shadowRoot.querySelector('.nd-cond-input');
        box.value = '';
        box.dispatchEvent(new Event('change'));

        expect(seen[0].group.conditions).toEqual([{ field: 'Subject', value: '' }]);
    });

    // THE bug: clearing the box to retype used to flip an "any value at all" checkbox on and
    // remove the box from under the cursor, so a value could never be replaced — only ever
    // typed once. Which control exists must not depend on whether it happens to be empty.
    it('keeps the box on screen when it is empty, so a value can be replaced', async () => {
        const element = mount({ group: group([{ field: 'Subject', value: '' }]) });
        await Promise.resolve();

        const box = element.shadowRoot.querySelector('.nd-cond-input');
        expect(box).not.toBeNull();
        expect(box.value).toBe('');
    });

    it('offers no separate "any value" control to get out of step with the box', async () => {
        const element = mount({ group: group([{ field: 'Subject', value: '' }]) });
        await Promise.resolve();

        expect(all(element, 'lightning-input').filter(i => /any value/i.test(i.label || '')))
            .toHaveLength(0);
    });

    it('says what an empty list does, since that is not guessable', async () => {
        const element = mount({ group: group([{ field: 'Subject', value: '' }]) });
        await Promise.resolve();
        expect(element.shadowRoot.querySelector('.nd-cond-vhelp').textContent)
            .toMatch(/any value counts/i);
    });
});

describe('combining them', () => {
    it('offers no logic choice for a single condition, where it could not matter', async () => {
        const element = mount({ group: group([{ field: 'Type' }]) });
        await Promise.resolve();
        expect(byLabel(element, 'lightning-combobox', 'Combine them with')).toBeUndefined();
    });

    it('offers AND, OR and Custom once there are two', async () => {
        const element = mount({ group: group([{ field: 'Type' }, { field: 'RecordTypeId' }]) });
        await Promise.resolve();

        const select = byLabel(element, 'lightning-combobox', 'Combine them with');
        expect(select.value).toBe('AND');
        expect(select.options.map(o => o.value)).toEqual(['AND', 'OR', 'CUSTOM']);
    });

    it('switches to OR', async () => {
        const element = mount({ group: group([{ field: 'Type' }, { field: 'RecordTypeId' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        byLabel(element, 'lightning-combobox', 'Combine them with')
            .dispatchEvent(new CustomEvent('change', { detail: { value: 'OR' } }));

        expect(seen[0].group.logic).toBe('OR');
    });

    // Seeded rather than blank, so the starting point is always valid and the numbering
    // is demonstrated rather than explained.
    it('seeds Custom with what the current mode already means', async () => {
        const element = mount({
            group: group([{ field: 'Type' }, { field: 'RecordTypeId' }, { field: 'Subject' }], 'OR')
        });
        const seen = captureChange(element);
        await Promise.resolve();

        byLabel(element, 'lightning-combobox', 'Combine them with')
            .dispatchEvent(new CustomEvent('change', { detail: { value: 'CUSTOM' } }));

        expect(seen[0].group.logic).toBe('1 OR 2 OR 3');
    });

    it('shows the expression box and reports it as Custom', async () => {
        const element = mount({
            group: group([{ field: 'Type' }, { field: 'RecordTypeId' }], '(1 AND 2) OR 1')
        });
        await Promise.resolve();

        expect(byLabel(element, 'lightning-combobox', 'Combine them with').value).toBe('CUSTOM');
        expect(byLabel(element, 'lightning-input', 'Logic').value).toBe('(1 AND 2) OR 1');
        expect(element.shadowRoot.querySelector('.nd-cond-error')).toBeNull();
    });

    it('names what is wrong with an expression as it is typed', async () => {
        const element = mount({
            group: group([{ field: 'Type' }, { field: 'RecordTypeId' }], '1 AND (2')
        });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-cond-error').textContent)
            .toMatch(/never closed/);
    });

    it('flags a number with no condition behind it', async () => {
        const element = mount({
            group: group([{ field: 'Type' }, { field: 'RecordTypeId' }], '1 AND 7')
        });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-cond-error').textContent)
            .toMatch(/only 2/);
    });

    // Otherwise the numbers in the expression would quietly come to mean other
    // conditions than the ones the author picked.
    it('drops back to AND when a removal would renumber a custom expression', async () => {
        const element = mount({
            group: group([{ field: 'Type' }, { field: 'RecordTypeId' }], '1 AND 2')
        });
        const seen = captureChange(element);
        await Promise.resolve();

        all(element, '.nd-cond-row lightning-button-icon')[0].click();
        expect(seen[0].group.logic).toBe('AND');
    });
});

describe("the underline site's own-field option", () => {
    it("hands the field picker the row's own field as its blank label", async () => {
        const element = mount({
            site: 'colorIf',
            selfFieldLabel: "— this row's own field (Priority) —",
            group: group([{ field: '' }])
        });
        await Promise.resolve();

        expect(byLabel(element, 'c-n-d_field-combobox', 'Watch this field').blankLabel)
            .toBe("— this row's own field (Priority) —");
    });

    // Everywhere else a blank field is simply unfinished, so there is nothing to offer.
    it('leaves the blank label unset everywhere else', async () => {
        const element = mount({ group: group([{ field: '' }]) });
        await Promise.resolve();

        expect(byLabel(element, 'c-n-d_field-combobox', 'Watch this field').blankLabel)
            .toBeFalsy();
    });

    it('passes the whole field list down, unfiltered — the picker does the searching', async () => {
        const element = mount({ group: group([{ field: '' }, { field: '' }]) });
        await Promise.resolve();

        const pickers = all(element, 'c-n-d_field-combobox');
        expect(pickers).toHaveLength(2);
        pickers.forEach(p => expect(p.options).toHaveLength(FIELD_OPTIONS.length));
    });
});

describe('comparing dates', () => {
    const match = element => byLabel(element, 'lightning-combobox', 'Match');
    const DATE_LABELS = ['is before', 'is on or before', 'is on', 'is on or after', 'is after'];

    it('offers the date operators for a Date field, and for a DateTime one', () => {
        ['Remind__c', 'Created__c'].forEach(async field => {
            const element = mount({ group: group([{ field }]) });
            await Promise.resolve();
            expect(match(element).options.map(o => o.label)).toEqual(
                ['is one of', 'is not one of', 'has any value', 'is empty'].concat(DATE_LABELS)
            );
        });
    });

    // Offering "is before" on a picklist would only produce a rule that can never hold.
    it('does not offer them for a field that is not a date', async () => {
        const element = mount({ group: group([{ field: 'Type' }]) });
        await Promise.resolve();
        expect(match(element).options.map(o => o.label))
            .toEqual(['is one of', 'is not one of', 'has any value', 'is empty']);
    });

    // Otherwise the combobox would hold a value absent from its own options and render blank,
    // hiding a condition that is really there.
    it('keeps them on offer for a condition that already carries one, whatever the field type', async () => {
        const element = mount({ group: group([{ field: 'Subject', op: 'before', value: 'today' }]) });
        await Promise.resolve();
        expect(match(element).value).toBe('before');
        expect(match(element).options.map(o => o.label)).toContain('is before');
    });

    it('seeds "today" when a comparison is chosen, so it is valid straight away', async () => {
        const element = mount({ group: group([{ field: 'Remind__c' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        match(element).dispatchEvent(new CustomEvent('change', { detail: { value: 'onOrBefore' } }));
        expect(seen[0].group.conditions).toEqual([
            { field: 'Remind__c', op: 'onOrBefore', value: 'today', negate: false }
        ]);
    });

    it('takes the operator off again when a plain test is chosen', async () => {
        const element = mount({ group: group([{ field: 'Remind__c', op: 'before', value: 'today' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        match(element).dispatchEvent(new CustomEvent('change', { detail: { value: 'any' } }));
        expect(seen[0].group.conditions).toEqual([{ field: 'Remind__c', negate: false }]);
    });

    it('labels the box Date and offers a comparison box, not a value list', async () => {
        const element = mount({ group: group([{ field: 'Remind__c', op: 'on', value: 'today' }]) });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-cond-vlabel').textContent).toBe('Date');
        expect(element.shadowRoot.querySelector('.nd-cond-input').value).toBe('today');
        expect(element.shadowRoot.querySelector('.nd-cond-input').placeholder).toMatch(/today\+7/);
    });

    // A date operand is the one value in a config that can be MALFORMED rather than merely
    // wrong, so it is worth saying so while it is being written.
    it('says so when the date cannot be read', async () => {
        const element = mount({ group: group([{ field: 'Remind__c', op: 'before', value: 'next tuesday' }]) });
        await Promise.resolve();
        expect(element.shadowRoot.querySelector('.nd-cond-error').textContent)
            .toMatch(/not a date this understands/);
    });

    it('is quiet about a date it can read', async () => {
        ['today', 'today+7', 'today-30', '2026-09-01'].forEach(async value => {
            const element = mount({ group: group([{ field: 'Remind__c', op: 'before', value }]) });
            await Promise.resolve();
            expect(element.shadowRoot.querySelector('.nd-cond-error')).toBeNull();
        });
    });

    it('accepts a typed date through the same box', async () => {
        const element = mount({ group: group([{ field: 'Remind__c', op: 'onOrBefore', value: 'today' }]) });
        const seen = captureChange(element);
        await Promise.resolve();

        const box = element.shadowRoot.querySelector('.nd-cond-input');
        box.value = 'today+14';
        box.dispatchEvent(new Event('change'));

        // No negate here: editing the value passes the condition through as given, and the
        // parent is what normalises. handleOperatorChange is the one that sets it.
        expect(seen[0].group.conditions).toEqual([
            { field: 'Remind__c', op: 'onOrBefore', value: 'today+14' }
        ]);
    });
});
