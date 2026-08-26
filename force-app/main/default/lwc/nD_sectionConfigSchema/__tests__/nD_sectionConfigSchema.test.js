import {
    CONFIG_KEYS,
    KNOWN_KEYS,
    WIDGET_KEYS,
    widgetOf,
    isBlank,
    matchesCsv,
    validateConfig,
    suggestKey,
    describeRequirement
} from 'c/nD_sectionConfigSchema';

// The org facts the runtime component passes in, kept small on purpose.
const CONTEXT = {
    fields: {
        Type: { label: 'Issue Type' },
        AVB_Environment__c: { label: 'Environment' },
        RecordTypeId: { label: 'Record Type' },
        AVB_Followers__c: { label: 'Followers' }
    },
    recordTypes: {
        '012KB000000kcw4YAA': 'AvioBook Case',
        '012KB000000kcw5YAA': 'AvioData Case'
    }
};

const LABELS = {
    labels: { Type: 'Issue Type', AVB_Environment__c: 'Environment' },
    recordTypes: CONTEXT.recordTypes
};

function errorsOf(findings) {
    return findings.filter(f => f.level === 'error');
}
function warningsOf(findings) {
    return findings.filter(f => f.level === 'warning');
}

describe('registry shape', () => {
    it('gives every key a label, a control and help text', () => {
        CONFIG_KEYS.forEach(def => {
            expect(typeof def.key).toBe('string');
            expect(def.label).toBeTruthy();
            expect(def.control).toBeTruthy();
            expect(def.help).toBeTruthy();
        });
    });

    it('has no duplicate keys', () => {
        expect(new Set(KNOWN_KEYS).size).toBe(KNOWN_KEYS.length);
    });

    it('only points requires/group at things that exist', () => {
        const groups = ['field', 'divider', 'rollup', 'visibility', 'widget', 'alert', 'takeover'];
        expect(CONFIG_KEYS.filter(def => !groups.includes(def.group)).map(def => def.key)).toEqual([]);
        expect(
            CONFIG_KEYS
                .filter(def => def.requires && !KNOWN_KEYS.includes(def.requires))
                .map(def => `${def.key} -> ${def.requires}`)
        ).toEqual([]);
    });
});

describe('validateConfig', () => {
    it('accepts the live AvioBook config with no findings', () => {
        const config = [
            { apiName: 'AVB_Followers__c', label: 'Followers', colSpan: 2, editable: true, isEmailList: true, allowedDomains: 'aviobook.aero' },
            { apiName: 'Type', label: 'Issue Type', editable: true, requiredBeforeTakeover: true },
            {
                apiName: 'AVB_Environment__c', label: 'Environment', editable: true,
                showIfField: 'RecordTypeId', showIfValue: '012KB000000kcw4YAA',
                requiredBeforeTakeover: true, requiredIfField: 'Type', requiredIfValue: 'Bug or Incident'
            }
        ];
        expect(validateConfig(config, CONTEXT)).toEqual([]);
    });

    it('reports a config that is not an array', () => {
        const findings = validateConfig({ apiName: 'Type' }, CONTEXT);
        expect(errorsOf(findings)).toHaveLength(1);
        expect(findings[0].message).toMatch(/not a JSON array/);
    });

    it('catches a misspelled key and suggests the real one', () => {
        const findings = validateConfig([{ apiName: 'Type', requiredBeforeTakover: true }], CONTEXT);
        const errors = errorsOf(findings);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('requiredBeforeTakover');
        expect(errors[0].message).toContain('requiredBeforeTakeover');
    });

    it('catches two widgets on one row', () => {
        const findings = validateConfig([{ apiName: 'Type', isUrl: true, isEmailList: true }], CONTEXT);
        expect(errorsOf(findings).some(f => /Two widgets/.test(f.message))).toBe(true);
    });

    it('catches showIfValue with no showIfField', () => {
        const findings = validateConfig([{ apiName: 'Type', showIfValue: 'x' }], CONTEXT);
        expect(errorsOf(findings).some(f => /"showIfValue" is set but "showIfField" is not/.test(f.message))).toBe(true);
    });

    it('catches a missing apiName', () => {
        const findings = validateConfig([{ label: 'Orphan' }], CONTEXT);
        expect(errorsOf(findings).some(f => /No apiName/.test(f.message))).toBe(true);
    });

    it('catches a field the org does not have', () => {
        const findings = validateConfig([{ apiName: 'Nope__c' }], CONTEXT);
        expect(errorsOf(findings).some(f => /does not exist on this object/.test(f.message))).toBe(true);
    });

    it('skips the field-existence check when the describe is not in yet', () => {
        const findings = validateConfig([{ apiName: 'Nope__c' }], {});
        expect(errorsOf(findings)).toEqual([]);
    });

    it('warns about allowedDomains without the people widget', () => {
        const findings = validateConfig([{ apiName: 'AVB_Followers__c', allowedDomains: 'aviobook.aero' }], CONTEXT);
        const warnings = warningsOf(findings);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toMatch(/no effect/);
    });

    it('warns about requiredIfField without requiredBeforeTakeover', () => {
        const findings = validateConfig([{ apiName: 'AVB_Environment__c', requiredIfField: 'Type', requiredIfValue: 'Bug or Incident' }], CONTEXT);
        expect(warningsOf(findings).length).toBeGreaterThanOrEqual(1);
    });

    it('warns about a record type Id that is not in the org', () => {
        const findings = validateConfig(
            [{ apiName: 'AVB_Environment__c', showIfField: 'RecordTypeId', showIfValue: '012000000000000AAA' }],
            CONTEXT
        );
        expect(warningsOf(findings).some(f => /not in this org/.test(f.message))).toBe(true);
    });

    it('tags each finding with the row index so an editor can jump to it', () => {
        const findings = validateConfig(
            [{ apiName: 'Type' }, { apiName: 'Type', bogusKey: 1 }],
            CONTEXT
        );
        expect(findings[0].row).toBe(1);
    });
});

describe('describeRequirement', () => {
    it('returns null when the row is not required', () => {
        expect(describeRequirement({ apiName: 'Type' }, LABELS)).toBeNull();
    });

    it('states a plain requirement', () => {
        const text = describeRequirement({ apiName: 'Type', label: 'Issue Type', requiredBeforeTakeover: true }, LABELS);
        expect(text).toBe('Issue Type must have a value before someone can take this case.');
    });

    it('names the record type when the row is scoped by one', () => {
        const text = describeRequirement({
            apiName: 'AVB_Environment__c', label: 'Environment', requiredBeforeTakeover: true,
            showIfField: 'RecordTypeId', showIfValue: '012KB000000kcw4YAA',
            requiredIfField: 'Type', requiredIfValue: 'Bug or Incident'
        }, LABELS);
        expect(text).toBe(
            'Environment must have a value before someone can take this case, but only on ' +
            'AvioBook Case, and only when Issue Type is Bug or Incident.'
        );
    });

    it('reads a comma-separated gate as a list of alternatives', () => {
        const text = describeRequirement({
            apiName: 'AVB_Environment__c', label: 'Environment', requiredBeforeTakeover: true,
            requiredIfField: 'Type', requiredIfValue: 'Bug or Incident, Service Request'
        }, LABELS);
        expect(text).toContain('Bug or Incident or Service Request');
    });

    it('falls back to "is set" when no gate value is given', () => {
        const text = describeRequirement({
            apiName: 'AVB_Environment__c', label: 'Environment',
            requiredBeforeTakeover: true, requiredIfField: 'Type'
        }, LABELS);
        expect(text).toContain('only when Issue Type is set.');
    });
});

describe('helpers', () => {
    it('treats blank-ish values as blank', () => {
        [null, undefined, '', '   '].forEach(v => expect(isBlank(v)).toBe(true));
        [0, false, 'x'].forEach(v => expect(isBlank(v)).toBe(false));
    });

    it('matches comma-separated membership ignoring surrounding spaces', () => {
        expect(matchesCsv('Urgent', 'High, Urgent')).toBe(true);
        expect(matchesCsv('Low', 'High, Urgent')).toBe(false);
    });

    it('reports the one widget a row has chosen', () => {
        expect(widgetOf({ apiName: 'Type' })).toBeNull();
        expect(widgetOf({ apiName: 'Slack_Thread__c', isUrlList: true })).toBe('isUrlList');
        WIDGET_KEYS.forEach(key => {
            expect(widgetOf({ [key]: true })).toBe(key);
        });
    });

    it('suggests nothing for a key that resembles no known key', () => {
        expect(suggestKey('zzzzzzzz')).toBeNull();
    });
});
