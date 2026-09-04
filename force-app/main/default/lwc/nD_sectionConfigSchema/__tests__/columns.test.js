import {
    sizeClassFor,
    spanTitle,
    colSpanOptions,
    columnsOf,
    spanOf,
    validateConfig
} from 'c/nD_sectionConfigSchema';

// Three-column support was added for the full-page-width portal card. The whole design rests
// on colSpan having ALWAYS meant "how many of the section's columns this row spans" — it was
// only ever WRITTEN as "2 = full width" because every section was two columns. These tests
// pin both halves: that nothing two-column changes, and that three columns reads as thirds.

describe('columnsOf', () => {
    it('defaults to two', () => {
        expect(columnsOf(undefined)).toBe(2);
        expect(columnsOf(null)).toBe(2);
        expect(columnsOf('')).toBe(2);
    });

    it('takes 1, 2 and 3, as a number or a numeric string', () => {
        expect(columnsOf(1)).toBe(1);
        expect(columnsOf(3)).toBe(3);
        expect(columnsOf('3')).toBe(3);
    });

    it('falls back to two for anything else, rather than inventing a width', () => {
        expect(columnsOf(4)).toBe(2);
        expect(columnsOf(0)).toBe(2);
        expect(columnsOf('wide')).toBe(2);
    });
});

describe('sizeClassFor — two columns behaves exactly as before', () => {
    it('gives half width by default', () => {
        expect(sizeClassFor(undefined, 2)).toBe('slds-size_1-of-2');
        expect(sizeClassFor('', 2)).toBe('slds-size_1-of-2');
        expect(sizeClassFor(1, 2)).toBe('slds-size_1-of-2');
    });

    it('gives full width for colSpan 2 — the meaning every live config was written with', () => {
        expect(sizeClassFor(2, 2)).toBe('slds-size_1-of-1');
    });

    it('defaults the section width when none is set', () => {
        expect(sizeClassFor(undefined, undefined)).toBe('slds-size_1-of-2');
        expect(sizeClassFor(2, undefined)).toBe('slds-size_1-of-1');
    });

    it('forces every row full width in a one-column section', () => {
        expect(sizeClassFor(undefined, 1)).toBe('slds-size_1-of-1');
        expect(sizeClassFor(2, 1)).toBe('slds-size_1-of-1');
    });
});

describe('sizeClassFor — three columns', () => {
    it('gives a third by default', () => {
        expect(sizeClassFor(undefined, 3)).toBe('slds-size_1-of-3');
        expect(sizeClassFor(1, 3)).toBe('slds-size_1-of-3');
    });

    it('gives two thirds for colSpan 2, not full width', () => {
        expect(sizeClassFor(2, 3)).toBe('slds-size_2-of-3');
    });

    it('gives full width for colSpan 3', () => {
        expect(sizeClassFor(3, 3)).toBe('slds-size_1-of-1');
    });

    // A row left at colSpan 3 after the section is narrowed must not ask SLDS for a class
    // that does not exist at that width.
    it('clamps a span wider than the section instead of emitting a bad class', () => {
        expect(sizeClassFor(3, 2)).toBe('slds-size_1-of-1');
        expect(sizeClassFor(9, 3)).toBe('slds-size_1-of-1');
    });

    it('treats junk as a single column rather than throwing', () => {
        expect(sizeClassFor('wide', 3)).toBe('slds-size_1-of-3');
        expect(sizeClassFor(0, 3)).toBe('slds-size_1-of-3');
        expect(sizeClassFor(-2, 3)).toBe('slds-size_1-of-3');
    });
});

describe('spanOf', () => {
    it('never returns less than one or more than the section is wide', () => {
        expect(spanOf(0, 3)).toBe(1);
        expect(spanOf(2, 3)).toBe(2);
        expect(spanOf(7, 3)).toBe(3);
        expect(spanOf(7, 2)).toBe(2);
    });
});

describe('spanTitle — the dropdown and the badge read the same', () => {
    it('names halves in a two-column section', () => {
        expect(spanTitle(1, 2)).toBe('Half width');
        expect(spanTitle(2, 2)).toBe('Full width');
    });

    it('names thirds in a three-column section', () => {
        expect(spanTitle(1, 3)).toBe('One third');
        expect(spanTitle(2, 3)).toBe('Two thirds');
        expect(spanTitle(3, 3)).toBe('Full width');
    });

    // The badge used to be the fixed word "full width" on any colSpan of 2, which is a lie at
    // three columns. Same accuracy rule that stopped dividers inheriting "read only".
    it('does not call two thirds full width', () => {
        expect(spanTitle(2, 3)).not.toBe('Full width');
    });

    it('calls everything full width in a one-column section', () => {
        expect(spanTitle(1, 1)).toBe('Full width');
    });
});

describe('colSpanOptions', () => {
    it('offers two choices at two columns, with 1 written as an absent key', () => {
        expect(colSpanOptions(2)).toEqual([
            { value: '', title: 'Half width' },
            { value: 2, title: 'Full width' }
        ]);
    });

    it('offers three choices at three columns', () => {
        expect(colSpanOptions(3)).toEqual([
            { value: '', title: 'One third' },
            { value: 2, title: 'Two thirds' },
            { value: 3, title: 'Full width' }
        ]);
    });

    // A combobox holding a value absent from its own options renders BLANK, so the row would
    // look as though it had no width set while the JSON says otherwise. The date-operator
    // combobox already cost this lesson once.
    it('keeps a value the section is now too narrow for, so the control cannot render blank', () => {
        const options = colSpanOptions(2, 3);
        expect(options.map(o => Number(o.value))).toContain(3);
        expect(options).toHaveLength(3);
    });

    it('adds nothing when the current value is already on offer', () => {
        expect(colSpanOptions(3, 2)).toHaveLength(3);
        expect(colSpanOptions(2, 2)).toHaveLength(2);
    });

    it('adds nothing for a blank current value', () => {
        expect(colSpanOptions(3, '')).toHaveLength(3);
        expect(colSpanOptions(3, undefined)).toHaveLength(3);
    });
});

describe('validateConfig — row width against section width', () => {
    const findingsFor = (rows, columns) =>
        validateConfig(rows, { fields: null, recordTypes: {}, columns })
            .filter(f => f.key === 'colSpan');

    it('says nothing about the shape every live config uses', () => {
        expect(findingsFor([{ apiName: 'Subject', colSpan: 2 }], 2)).toHaveLength(0);
        expect(findingsFor([{ apiName: 'Subject' }], 3)).toHaveLength(0);
        expect(findingsFor([{ apiName: 'Subject', colSpan: 3 }], 3)).toHaveLength(0);
    });

    it('warns when a row is wider than its section, naming what happens', () => {
        const found = findingsFor([{ apiName: 'Subject', colSpan: 3 }], 2);
        expect(found).toHaveLength(1);
        expect(found[0].level).toBe('warning');
        expect(found[0].message).toContain('renders full width');
    });

    it('treats a non-numeric width as an error, not a warning', () => {
        const found = findingsFor([{ apiName: 'Subject', colSpan: 'full' }], 3);
        expect(found).toHaveLength(1);
        expect(found[0].level).toBe('error');
    });

    it('defaults the section to two columns when it does not say', () => {
        expect(findingsFor([{ apiName: 'Subject', colSpan: 3 }], undefined)).toHaveLength(1);
    });
});
