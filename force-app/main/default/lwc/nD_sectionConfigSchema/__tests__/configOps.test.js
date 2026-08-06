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
    withSectionKeySet,
    selectionAfterRemoval,
    resolveSectionSettings,
    validateSection,
    validateConfig,
    describeRequirement,
    joinOr,
    splitCsv
} from 'c/nD_sectionConfigSchema';

describe('orderRow / serialize', () => {
    it('emits a canonical key order regardless of insertion order', () => {
        const row = { editable: true, apiName: 'Status', label: 'Status' };
        expect(Object.keys(orderRow(row))).toEqual(['apiName', 'label', 'editable']);
        expect(serialize([row], {})).toBe(
            '{"section":{},"fields":[{"apiName":"Status","label":"Status","editable":true}]}'
        );
    });

    it('emits section settings alongside the field rows', () => {
        const json = serialize([{ apiName: 'Status' }], { title: 'Case Details', icon: 'utility:cases' });
        expect(json).toBe(
            '{"section":{"title":"Case Details","icon":"utility:cases"},'
            + '"fields":[{"apiName":"Status"}]}'
        );
    });

    it('drops blank section settings so defaults stay implicit', () => {
        expect(serialize([], { title: '', icon: undefined, headerColor: '#005FB2' }))
            .toBe('{"section":{"headerColor":"#005FB2"},"fields":[]}');
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
        expect(serializePretty([], {})).toBe('{\n  "section": {},\n  "fields": []\n}');
        expect(serializePretty([{ apiName: 'A' }, { apiName: 'B' }], {}))
            .toBe('{\n  "section": {},\n  "fields": [\n    {"apiName":"A"},\n    {"apiName":"B"}\n  ]\n}');
    });
});

describe('parseConfig', () => {
    it('accepts the current shape', () => {
        const result = parseConfig('{"section":{"title":"Hi"},"fields":[{"apiName":"Status"}]}');
        expect(result.rows).toEqual([{ apiName: 'Status' }]);
        expect(result.section).toEqual({ title: 'Hi' });
        expect(result.legacyShape).toBe(false);
        expect(result.error).toBe('');
    });

    it('still accepts a bare array, flagged as the legacy shape', () => {
        const result = parseConfig('[{"apiName":"Status"}]');
        expect(result.rows).toEqual([{ apiName: 'Status' }]);
        expect(result.section).toEqual({});
        expect(result.legacyShape).toBe(true);
        expect(result.error).toBe('');
    });

    it('round-trips serialize output including section settings', () => {
        const rows = [{ apiName: 'Type', label: 'Issue Type', editable: true, requiredBeforeTakeover: true }];
        const section = { title: 'Case Details', icon: 'utility:cases', columns: 1 };
        const back = parseConfig(serialize(rows, section));
        expect(back.rows).toEqual(rows);
        expect(back.section).toEqual(section);
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

    it('rejects an object with no fields array', () => {
        expect(parseConfig('{"apiName":"Status"}').error).toMatch(/Expected either a JSON array/);
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

describe('resolveSectionSettings', () => {
    it('falls back to defaults when nothing is set', () => {
        const s = resolveSectionSettings({});
        expect(s.title).toBe('Details');
        expect(s.icon).toBe('utility:warning');
        expect(s.headerColor).toBe('#005FB2');
        expect(s.headerTextColor).toBe('#FFFFFF');
        expect(s.columns).toBe(2);
        expect(s.startCollapsed).toBe(false);
    });

    it('uses whatever the JSON sets', () => {
        const s = resolveSectionSettings({ title: 'Case Details', icon: 'utility:cases', columns: 1 });
        expect(s.title).toBe('Case Details');
        expect(s.icon).toBe('utility:cases');
        expect(s.columns).toBe(1);
    });

    it('treats a blank value as unset, so the default applies', () => {
        expect(resolveSectionSettings({ title: '' }).title).toBe('Details');
    });

    it('carries the header alert through', () => {
        const s = resolveSectionSettings({
            alertField: 'Priority', alertValue: 'High,Urgent', alertColor: '#ba0517'
        });
        expect(s.alertField).toBe('Priority');
        expect(s.alertValue).toBe('High,Urgent');
        expect(s.alertColor).toBe('#ba0517');
    });

    // The App Builder properties that used to act as a second source are gone, removed
    // once every page had been migrated. Nothing outside the JSON feeds this any more.
    it('ignores a second argument, since there is no longer a legacy source', () => {
        const s = resolveSectionSettings({}, { ND_sectionTitle: 'From App Builder' });
        expect(s.title).toBe('Details');
    });

    it('is unaffected by anything not in the registry', () => {
        const s = resolveSectionSettings({ nonsense: 'x', title: 'Kept' });
        expect(s.title).toBe('Kept');
        expect(s.nonsense).toBeUndefined();
    });
});

describe('validateSection', () => {
    const CTX = { fields: { Priority: { label: 'Priority' } } };

    it('accepts a fully specified section', () => {
        expect(validateSection({
            title: 'Case Details', icon: 'utility:cases', columns: 2,
            headerColor: '#005FB2', headerTextColor: '#FFFFFF',
            alertField: 'Priority', alertValue: 'High,Urgent', alertColor: '#ba0517'
        }, CTX)).toEqual([]);
    });

    it('catches an unknown section setting and suggests the real one', () => {
        const findings = validateSection({ titel: 'Oops' }, CTX);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain('titel');
        expect(findings[0].message).toContain('title');
    });

    it('catches an alert value with no alert field', () => {
        const findings = validateSection({ alertValue: 'High' }, CTX);
        expect(findings.some(f => /"alertValue" is set but "alertField" is not/.test(f.message))).toBe(true);
    });

    it('catches an alert field the org does not have', () => {
        const findings = validateSection({ alertField: 'Nope__c', alertColor: '#fff' }, CTX);
        expect(findings.some(f => /does not exist/.test(f.message))).toBe(true);
    });

    it('warns when an alert condition has no colour to switch to', () => {
        const findings = validateSection({ alertField: 'Priority', alertValue: 'High' }, CTX);
        expect(findings.some(f => f.level === 'warning' && /never change/.test(f.message))).toBe(true);
    });

    it('warns about something that is not an icon name', () => {
        const findings = validateSection({ icon: 'warning' }, CTX);
        expect(findings.some(f => f.level === 'warning' && /icon name/.test(f.message))).toBe(true);
    });

    it('tags section findings with row -1 so they are distinguishable from rows', () => {
        expect(validateSection({ titel: 'x' }, CTX)[0].row).toBe(-1);
    });
});

describe('withSectionKeySet', () => {
    it('sets and clears without mutating', () => {
        const section = { title: 'Hi' };
        expect(withSectionKeySet(section, 'icon', 'utility:cases'))
            .toEqual({ title: 'Hi', icon: 'utility:cases' });
        expect('title' in withSectionKeySet(section, 'title', '')).toBe(false);
        expect(section).toEqual({ title: 'Hi' });
    });

    it('drops a false checkbox so the default stays implicit', () => {
        expect('startCollapsed' in withSectionKeySet({ startCollapsed: true }, 'startCollapsed', false))
            .toBe(false);
    });
});

describe('fields the org will not let anyone edit', () => {
    const CTX = {
        fields: {
            Status: { label: 'Status', updateable: true, calculated: false },
            CaseNumber: { label: 'Case Number', updateable: false, calculated: false },
            AVB_ICAO_Account__c: { label: 'ICAO Account', updateable: false, calculated: true }
        }
    };

    it('warns that editable cannot work on a formula field, and says it is a formula', () => {
        const findings = validateConfig([{ apiName: 'AVB_ICAO_Account__c', editable: true }], CTX);
        const warning = findings.find(f => f.key === 'editable');
        expect(warning).toBeDefined();
        expect(warning.level).toBe('warning');
        expect(warning.message).toContain('not updateable');
        expect(warning.message).toContain('formula field');
    });

    it('warns for a non-updateable field that is not a formula, without calling it one', () => {
        const findings = validateConfig([{ apiName: 'CaseNumber', editable: true }], CTX);
        const warning = findings.find(f => f.key === 'editable');
        expect(warning.message).toContain('not updateable');
        expect(warning.message).not.toContain('formula');
    });

    it('says nothing when such a field is left read-only', () => {
        expect(validateConfig([{ apiName: 'AVB_ICAO_Account__c' }], CTX)).toEqual([]);
    });

    it('says nothing about an ordinary updateable field', () => {
        expect(validateConfig([{ apiName: 'Status', editable: true }], CTX)).toEqual([]);
    });

    it('stays quiet before the describe has arrived', () => {
        expect(validateConfig([{ apiName: 'AVB_ICAO_Account__c', editable: true }], {})).toEqual([]);
    });
});

describe('withRowAdded editability', () => {
    it('marks a normal field editable', () => {
        expect(withRowAdded([], 'Status', 'Status')).toEqual([
            { apiName: 'Status', label: 'Status', editable: true }
        ]);
    });

    it('omits editable entirely when the org will not accept an update', () => {
        expect(withRowAdded([], 'AVB_ICAO_Account__c', 'ICAO Account', false)).toEqual([
            { apiName: 'AVB_ICAO_Account__c', label: 'ICAO Account' }
        ]);
    });
});

describe('record type Ids in showIfValue', () => {
    const CTX = {
        fields: { AVB_Environment__c: { label: 'Environment', updateable: true } },
        recordTypes: {
            '012KB000000kcw4YAA': 'AvioBook Case',
            '012KB000000kcw5YAA': 'AvioData Case'
        }
    };
    const row = value => [{
        apiName: 'AVB_Environment__c', showIfField: 'RecordTypeId', showIfValue: value
    }];

    // showIfValue became comma-separated membership, so the whole string is no longer a
    // single Id to look up — picking two record types used to warn that the joined string
    // was not in the org.
    it('accepts several record type Ids', () => {
        expect(validateConfig(row('012KB000000kcw4YAA,012KB000000kcw5YAA'), CTX)).toEqual([]);
    });

    it('accepts one', () => {
        expect(validateConfig(row('012KB000000kcw4YAA'), CTX)).toEqual([]);
    });

    it('tolerates spaces around the separators', () => {
        expect(validateConfig(row(' 012KB000000kcw4YAA , 012KB000000kcw5YAA '), CTX)).toEqual([]);
    });

    it('names only the Id that is actually missing', () => {
        const findings = validateConfig(row('012KB000000kcw4YAA,012000000000000AAA'), CTX);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain('012000000000000AAA');
        expect(findings[0].message).not.toContain('012KB000000kcw4YAA');
        expect(findings[0].message).toContain('is not in this org');
    });

    it('pluralises when several are missing', () => {
        const findings = validateConfig(row('012000000000000AAA,012999999999999AAA'), CTX);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain('Record type Ids');
        expect(findings[0].message).toContain('are not in this org');
    });
});

describe('describeRequirement with several record types', () => {
    const CTX = {
        labels: { Type: 'Issue Type', AVB_Environment__c: 'Environment' },
        recordTypes: {
            '012KB000000kcw4YAA': 'AvioBook Case',
            '012KB000000kcw5YAA': 'AvioData Case',
            '012KB000000kcw6YAA': 'Problem Case'
        }
    };
    const row = showIfValue => ({
        apiName: 'AVB_Environment__c', label: 'Environment', requiredBeforeTakeover: true,
        showIfField: 'RecordTypeId', showIfValue,
        requiredIfField: 'Type', requiredIfValue: 'Bug or Incident'
    });

    // showIfValue is membership, so the sentence has to name each record type. It used to
    // look the whole value up as one Id and print the raw comma-joined string on a miss.
    it('names two record types instead of printing their Ids', () => {
        expect(describeRequirement(row('012KB000000kcw4YAA,012KB000000kcw5YAA'), CTX)).toBe(
            'Environment must have a value before someone can take this case, but only on '
            + 'AvioBook Case or AvioData Case, and only when Issue Type is Bug or Incident.'
        );
    });

    it('reads three as an English list', () => {
        const text = describeRequirement(
            row('012KB000000kcw4YAA,012KB000000kcw5YAA,012KB000000kcw6YAA'), CTX
        );
        expect(text).toContain('only on AvioBook Case, AvioData Case or Problem Case,');
    });

    it('still reads correctly for one', () => {
        expect(describeRequirement(row('012KB000000kcw4YAA'), CTX))
            .toContain('but only on AvioBook Case,');
    });

    it('tolerates spaces around the separators', () => {
        expect(describeRequirement(row(' 012KB000000kcw4YAA , 012KB000000kcw5YAA '), CTX))
            .toContain('AvioBook Case or AvioData Case');
    });

    it('shows an unrecognised Id as-is rather than dropping it', () => {
        expect(describeRequirement(row('012KB000000kcw4YAA,012999999999999AAA'), CTX))
            .toContain('AvioBook Case or 012999999999999AAA');
    });

    it('contains no comma-joined Id string anywhere', () => {
        expect(describeRequirement(row('012KB000000kcw4YAA,012KB000000kcw5YAA'), CTX))
            .not.toContain('012KB000000kcw4YAA,');
    });
});

describe('joinOr', () => {
    it('reads as English for one, two and three', () => {
        expect(joinOr(['A'])).toBe('A');
        expect(joinOr(['A', 'B'])).toBe('A or B');
        expect(joinOr(['A', 'B', 'C'])).toBe('A, B or C');
    });

    it('is empty for nothing', () => {
        expect(joinOr([])).toBe('');
    });
});

describe('splitCsv', () => {
    it('trims and drops the empties', () => {
        expect(splitCsv(' a , b ,, c ')).toEqual(['a', 'b', 'c']);
    });

    it('is empty for blank-ish input', () => {
        [undefined, null, ''].forEach(v => expect(splitCsv(v)).toEqual([]));
    });
});
