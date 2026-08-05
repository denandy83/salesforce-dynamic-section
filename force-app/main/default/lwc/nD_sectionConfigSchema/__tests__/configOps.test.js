import {
    orderRow,
    serialize,
    serializePretty,
    parseConfig,
    withRowAdded,
    withRowMoved,
    withRowDuplicated,
    withRowRemoved,
    withKeySet,
    withWidgetSet,
    selectionAfterRemoval
} from 'c/nD_sectionConfigSchema';

describe('orderRow / serialize', () => {
    it('emits a canonical key order regardless of insertion order', () => {
        const row = { editable: true, apiName: 'Status', label: 'Status' };
        expect(Object.keys(orderRow(row))).toEqual(['apiName', 'label', 'editable']);
        expect(serialize([row])).toBe('[{"apiName":"Status","label":"Status","editable":true}]');
    });

    it('keeps unknown keys instead of dropping them, at the end', () => {
        const row = { mysteryKey: 1, apiName: 'Status' };
        expect(Object.keys(orderRow(row))).toEqual(['apiName', 'mysteryKey']);
    });

    it('puts the widget before its dependent keys', () => {
        const row = { allowedDomains: 'aviobook.aero', isEmailList: true, apiName: 'AVB_Followers__c' };
        expect(Object.keys(orderRow(row))).toEqual(['apiName', 'isEmailList', 'allowedDomains']);
    });

    it('pretty-prints one row per line and handles the empty case', () => {
        expect(serializePretty([])).toBe('[]');
        expect(serializePretty([{ apiName: 'A' }, { apiName: 'B' }]))
            .toBe('[\n  {"apiName":"A"},\n  {"apiName":"B"}\n]');
    });
});

describe('parseConfig', () => {
    it('accepts an array of rows', () => {
        expect(parseConfig('[{"apiName":"Status"}]')).toEqual({
            rows: [{ apiName: 'Status' }],
            error: ''
        });
    });

    it('round-trips serialize output', () => {
        const rows = [{ apiName: 'Type', label: 'Issue Type', editable: true, requiredBeforeTakeover: true }];
        expect(parseConfig(serialize(rows)).rows).toEqual(rows);
    });

    it('rejects empty input', () => {
        expect(parseConfig('   ').error).toMatch(/Paste a config/);
        expect(parseConfig('   ').rows).toBeNull();
    });

    it('rejects malformed JSON without throwing', () => {
        const result = parseConfig('[{oops}]');
        expect(result.rows).toBeNull();
        expect(result.error).toMatch(/not valid JSON/);
    });

    it('rejects a bare object', () => {
        expect(parseConfig('{"apiName":"Status"}').error).toMatch(/Expected a JSON array/);
    });
});

describe('row operations are pure', () => {
    it('does not mutate the array it is given', () => {
        const rows = [{ apiName: 'Status' }];
        const frozen = JSON.stringify(rows);

        withRowAdded(rows, 'Type', 'Issue Type');
        withRowMoved(rows, 0, 1);
        withRowDuplicated(rows, 0);
        withRowRemoved(rows, 0);
        withKeySet(rows, 0, 'label', 'x');
        withWidgetSet(rows, 0, 'isUrl');

        expect(JSON.stringify(rows)).toBe(frozen);
    });

    it('adds a row as an editable standard field', () => {
        expect(withRowAdded([], 'Status', 'Status'))
            .toEqual([{ apiName: 'Status', label: 'Status', editable: true }]);
    });

    it('moves a row down', () => {
        const rows = [{ apiName: 'A' }, { apiName: 'B' }];
        expect(withRowMoved(rows, 0, 1).map(r => r.apiName)).toEqual(['B', 'A']);
    });

    it('returns the same array when a move would fall off either end', () => {
        const rows = [{ apiName: 'A' }, { apiName: 'B' }];
        expect(withRowMoved(rows, 0, -1)).toBe(rows);
        expect(withRowMoved(rows, 1, 1)).toBe(rows);
    });

    it('inserts a duplicate directly after the original', () => {
        const rows = [{ apiName: 'A' }, { apiName: 'B' }];
        expect(withRowDuplicated(rows, 0).map(r => r.apiName)).toEqual(['A', 'A', 'B']);
    });

    it('copies the duplicate rather than sharing a reference', () => {
        const rows = [{ apiName: 'A', label: 'first' }];
        const next = withRowDuplicated(rows, 0);
        next[1].label = 'changed';
        expect(next[0].label).toBe('first');
    });

    it('removes a row', () => {
        const rows = [{ apiName: 'A' }, { apiName: 'B' }];
        expect(withRowRemoved(rows, 0).map(r => r.apiName)).toEqual(['B']);
    });
});

describe('withKeySet', () => {
    it('sets a value', () => {
        expect(withKeySet([{ apiName: 'A' }], 0, 'label', 'Hi')[0].label).toBe('Hi');
    });

    it('deletes the key for blank, false, null and undefined', () => {
        ['', false, null, undefined].forEach(blank => {
            const next = withKeySet([{ apiName: 'A', label: 'Hi' }], 0, 'label', blank);
            expect('label' in next[0]).toBe(false);
        });
    });

    it('keeps a zero, which is a real value', () => {
        expect(withKeySet([{ apiName: 'A' }], 0, 'colSpan', 0)[0].colSpan).toBe(0);
    });
});

describe('withWidgetSet', () => {
    it('replaces the previous widget rather than adding a second', () => {
        const next = withWidgetSet([{ apiName: 'A', isEmailList: true }], 0, 'isUrlList');
        expect(next[0].isUrlList).toBe(true);
        expect('isEmailList' in next[0]).toBe(false);
    });

    it('drops a widget-scoped key that no longer applies', () => {
        const rows = [{ apiName: 'A', isEmailList: true, allowedDomains: 'aviobook.aero' }];
        const next = withWidgetSet(rows, 0, 'isUrlList');
        expect('allowedDomains' in next[0]).toBe(false);
    });

    it('keeps allowedDomains when staying on the people widget', () => {
        const rows = [{ apiName: 'A', isEmailList: true, allowedDomains: 'aviobook.aero' }];
        const next = withWidgetSet(rows, 0, 'isEmailList');
        expect(next[0].allowedDomains).toBe('aviobook.aero');
    });

    it('clears every widget key for a standard field', () => {
        const next = withWidgetSet([{ apiName: 'A', isUrl: true, placeholder: 'x' }], 0, 'standard');
        expect(next[0]).toEqual({ apiName: 'A' });
    });

    it('leaves keys from other groups alone', () => {
        const rows = [{ apiName: 'A', isUrl: true, color: '#ba0517', requiredBeforeTakeover: true }];
        const next = withWidgetSet(rows, 0, 'isUrlList');
        expect(next[0].color).toBe('#ba0517');
        expect(next[0].requiredBeforeTakeover).toBe(true);
    });
});

describe('selectionAfterRemoval', () => {
    it('clears the selection when nothing is left', () => {
        expect(selectionAfterRemoval(0, 0, 0)).toBe(-1);
    });

    it('shifts down when an earlier row went away', () => {
        expect(selectionAfterRemoval(2, 0, 2)).toBe(1);
    });

    it('clamps to the last row when the selected one was last', () => {
        expect(selectionAfterRemoval(2, 2, 2)).toBe(1);
    });

    it('stays put when a later row went away', () => {
        expect(selectionAfterRemoval(0, 1, 2)).toBe(0);
    });
});
