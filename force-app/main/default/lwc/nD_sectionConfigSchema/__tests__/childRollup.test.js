import {
    isChildRollup,
    rollupOptions,
    rollupValues,
    withRollupAdded,
    withRollupKeySet,
    isRowVisible,
    validateConfig,
    validateSection,
    resolveSectionSettings,
    SECTION_KEYS
} from 'c/nD_sectionConfigSchema';

describe('isChildRollup', () => {
    it('is keyed on PRESENCE of the key, not its contents', () => {
        // Same reasoning as `divider`: the value is an options object being edited, so
        // "present but not filled in yet" has to survive a round trip through the config.
        expect(isChildRollup({ childRollup: {} })).toBe(true);
        expect(isChildRollup({ childRollup: { relationship: 'Jira_Tickets__r' } })).toBe(true);
    });

    it('is false for a normal row, a divider and a nullish row', () => {
        expect(isChildRollup({ apiName: 'Subject' })).toBe(false);
        expect(isChildRollup({ divider: 'SLA' })).toBe(false);
        expect(isChildRollup(null)).toBe(false);
        expect(isChildRollup(undefined)).toBe(false);
    });
});

describe('rollupOptions', () => {
    it('splits on commas by default, because one child value is already a list', () => {
        expect(rollupOptions({ childRollup: {} }).split).toBe(',');
    });

    it('lets an explicit empty split turn splitting off', () => {
        expect(rollupOptions({ childRollup: { split: '' } }).split).toBe('');
    });

    it('trims the relationship and field', () => {
        const opts = rollupOptions({
            childRollup: { relationship: '  Jira_Tickets__r ', field: ' AVB_Fix_Versions__c ' }
        });
        expect(opts.relationship).toBe('Jira_Tickets__r');
        expect(opts.field).toBe('AVB_Fix_Versions__c');
    });

    it('never returns null for a rollup row with no options at all', () => {
        const opts = rollupOptions({ childRollup: undefined });
        expect(opts.relationship).toBe('');
        expect(opts.field).toBe('');
        expect(opts.separator).toBe(', ');
    });
});

describe('rollupValues', () => {
    const opts = { split: ',', exclude: '' };

    it('splits each child value and flattens them', () => {
        // The real shape from PROD: one Jira ticket naming two fix versions.
        expect(rollupValues(['3.2.0-connect-x-service, 3.2.0-connect-x-app'], opts))
            .toEqual(['3.2.0-connect-x-app', '3.2.0-connect-x-service']);
    });

    it('combines several children into one sorted list', () => {
        expect(rollupValues(['27.1-iOS', '26.3-iOS'], opts))
            .toEqual(['26.3-iOS', '27.1-iOS']);
    });

    it('de-duplicates across children, keeping the first spelling seen', () => {
        // Two tickets carrying identical fix versions is the normal case in PROD, not an edge
        // one: AVIO-57527 and AVIO-57529 have the same three.
        expect(rollupValues(['26.3-iOS', '26.3-IOS', '27.1-iOS'], opts))
            .toEqual(['26.3-iOS', '27.1-iOS']);
    });

    it('drops excluded placeholder values, case-insensitively', () => {
        const withExclude = { split: ',', exclude: 'not_applicable,no' };
        expect(rollupValues(['26.3-iOS', 'not_applicable', 'NO'], withExclude))
            .toEqual(['26.3-iOS']);
    });

    it('drops blanks, nulls and whitespace-only pieces', () => {
        expect(rollupValues(['26.3-iOS', null, '   ', '', ' , ,'], opts))
            .toEqual(['26.3-iOS']);
    });

    it('treats the value as atomic when split is an empty string', () => {
        expect(rollupValues(['a, b'], { split: '', exclude: '' })).toEqual(['a, b']);
    });

    it('returns an empty array for undefined input, so "not loaded" is not an error', () => {
        expect(rollupValues(undefined, opts)).toEqual([]);
        expect(rollupValues(null, opts)).toEqual([]);
        expect(rollupValues([], opts)).toEqual([]);
    });

    it('tolerates no options at all', () => {
        expect(rollupValues(['b,a'])).toEqual(['a', 'b']);
    });

    it('is stable — the same children give the same order regardless of input order', () => {
        const a = rollupValues(['27.1-iOS', '26.3-iOS', '26.2.5-backend'], opts);
        const b = rollupValues(['26.2.5-backend', '27.1-iOS', '26.3-iOS'], opts);
        expect(a).toEqual(b);
    });
});

describe('a rollup row and the rest of the engine', () => {
    it('is visible even though it has no apiName', () => {
        // The guard in isRowVisible is `item.apiName && …`, so a row without one must not be
        // filtered out as "field missing from the org".
        const row = { label: 'Fix versions', childRollup: { relationship: 'r', field: 'f' } };
        expect(isRowVisible(row, { fields: { Subject: {} } })).toBe(true);
    });

    it('still honours showIf like any other row', () => {
        const row = {
            label: 'Fix versions',
            childRollup: { relationship: 'r', field: 'f' },
            showIfField: 'Type',
            showIfValue: 'Bug or Incident'
        };
        const ctx = { savedFields: { Type: { value: 'Question' } } };
        expect(isRowVisible(row, ctx)).toBe(false);
        expect(isRowVisible(row, { savedFields: { Type: { value: 'Bug or Incident' } } })).toBe(true);
    });
});

describe('validateConfig on rollup rows', () => {
    const findings = config => validateConfig(config, {});

    it('accepts a complete rollup with no complaints', () => {
        const out = findings([
            { label: 'Fix versions', childRollup: { relationship: 'Jira_Tickets__r', field: 'AVB_Fix_Versions__c' } }
        ]);
        expect(out).toEqual([]);
    });

    it('does NOT demand an apiName', () => {
        const out = findings([
            { label: 'Fix versions', childRollup: { relationship: 'r', field: 'f' } }
        ]);
        expect(out.filter(f => f.key === 'apiName')).toEqual([]);
    });

    it('reports a missing relationship and a missing field as errors', () => {
        const out = findings([{ label: 'Fix versions', childRollup: {} }]);
        const messages = out.filter(f => f.level === 'error').map(f => f.message);
        expect(messages).toEqual(
            expect.arrayContaining([
                expect.stringContaining('no "relationship"'),
                expect.stringContaining('no "field"')
            ])
        );
    });

    it('warns about keys that mean nothing on a rollup', () => {
        const out = findings([
            {
                label: 'Fix versions',
                childRollup: { relationship: 'r', field: 'f' },
                editable: true,
                isUrl: true
            }
        ]);
        const warned = out.filter(f => f.level === 'warning').map(f => f.key);
        expect(warned).toEqual(expect.arrayContaining(['editable', 'isUrl']));
    });

    it('does not warn about label, colSpan or the visibility keys', () => {
        const out = findings([
            {
                label: 'Fix versions',
                colSpan: 2,
                childRollup: { relationship: 'r', field: 'f' },
                showIfField: 'Type',
                showIfValue: 'Bug or Incident'
            }
        ]);
        expect(out).toEqual([]);
    });
});

describe('withRollupAdded / withRollupKeySet', () => {
    it('adds a storable but unfinished rollup row', () => {
        const rows = withRollupAdded([]);
        expect(rows).toHaveLength(1);
        expect(isChildRollup(rows[0])).toBe(true);
        // Storable while blank, for the same reason an unfinished condition is stored: the
        // editor keeps no state of its own, so the row has to survive the round trip.
        expect(rows[0].childRollup).toEqual({ relationship: '', field: '' });
    });

    it('reports the unfinished row as an error so it cannot stay that way by accident', () => {
        const rows = withRollupAdded([]);
        const errors = validateConfig(rows, {}).filter(f => f.level === 'error');
        expect(errors).toHaveLength(2);
    });

    it('sets a nested key without losing the other half of the pair', () => {
        let row = withRollupAdded([])[0];
        row = withRollupKeySet(row, 'relationship', 'Jira_Tickets__r');
        row = withRollupKeySet(row, 'field', 'AVB_Fix_Versions__c');
        expect(row.childRollup.relationship).toBe('Jira_Tickets__r');
        expect(row.childRollup.field).toBe('AVB_Fix_Versions__c');
    });

    it('clears the field when the relationship changes', () => {
        // The old field belonged to the old child object, so keeping it would leave a
        // rollup that can never read anything — same rule as a condition's value.
        let row = withRollupKeySet(withRollupAdded([])[0], 'relationship', 'Jira_Tickets__r');
        row = withRollupKeySet(row, 'field', 'AVB_Fix_Versions__c');
        row = withRollupKeySet(row, 'relationship', 'CaseComments');
        expect(row.childRollup.field).toBe('');
    });

    it('keeps relationship and field present when emptied, but drops optional keys', () => {
        let row = withRollupKeySet(withRollupAdded([])[0], 'exclude', 'no');
        expect(row.childRollup.exclude).toBe('no');
        row = withRollupKeySet(row, 'exclude', '');
        expect('exclude' in row.childRollup).toBe(false);
        row = withRollupKeySet(row, 'field', '');
        expect('field' in row.childRollup).toBe(true);
    });

    it('does not mutate the row it is given', () => {
        const row = withRollupAdded([])[0];
        const before = JSON.stringify(row);
        withRollupKeySet(row, 'relationship', 'Jira_Tickets__r');
        expect(JSON.stringify(row)).toBe(before);
    });
});

// --- the section alert's title ------------------------------------------------------
describe('alertTitle', () => {
    it('is a registry key in the alert group, gated on the alert condition', () => {
        const def = SECTION_KEYS.find(d => d.key === 'alertTitle');
        expect(def).toBeTruthy();
        expect(def.group).toBe('sectionAlert');
        // Gated the same way as the alert colours: a title with no condition to fire on is
        // config that can never do anything.
        expect(def.requires).toBe('alertField');
        expect(def.requiresSite).toBe('alertIf');
    });

    it('has no fallback, so blank stays blank and the renderer can detect it', () => {
        // A fallback here would make "unset" indistinguishable from "same as the title",
        // and the renderer's `alertTitle || title` check would never take the second branch.
        const def = SECTION_KEYS.find(d => d.key === 'alertTitle');
        expect(def.fallback).toBeUndefined();
    });

    it('is reported when set with no condition to fire on', () => {
        const findings = validateSection({ title: 'Details', alertTitle: 'ESCALATED' });
        expect(findings.some(f => f.key === 'alertTitle' && f.level === 'error')).toBe(true);
    });

    it('is accepted alongside a condition', () => {
        const findings = validateSection({
            title: 'Details',
            alertField: 'Status',
            alertValue: 'Escalated',
            alertColor: '#ba0517',
            alertTitle: 'ESCALATED'
        });
        expect(findings.filter(f => f.key === 'alertTitle')).toEqual([]);
    });

    it('survives a round trip through the section serialiser', () => {
        const settings = resolveSectionSettings({
            title: 'Details',
            alertField: 'Status',
            alertValue: 'Escalated',
            alertColor: '#ba0517',
            alertTitle: 'ESCALATED'
        });
        expect(settings.alertTitle).toBe('ESCALATED');
    });
});
