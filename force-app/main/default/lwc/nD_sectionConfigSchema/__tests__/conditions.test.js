import {
    operandDay,
    fieldDay,
    localToday,
    DATE_OP_KEYS,
    isRowVisible,
    holds,
    siteByKey,
    conditionsOf,
    withConditionsSet,
    watchedFieldsOf,
    parseLogic,
    describeConditions,
    describeRequirement,
    validateConfig,
    validateSection,
    serialize
} from 'c/nD_sectionConfigSchema';

// A row could be scoped to one record type but never to "this record type AND this
// customer", which is the commonest thing anyone actually asked for. These cover the
// engine all four condition sites now share, so a fix to one is a fix to all of them.

const SAVED = {
    RecordTypeId: { value: 'RT_AVIOBOOK' },
    AVB_ICAO_Account__c: { value: 'KLM' },
    Type: { value: 'Bug or Incident' },
    AVB_Blank__c: { value: null }
};

const CTX = { savedFields: SAVED };

const FIELDS = {
    AVB_Handover_Type__c: { label: 'Handover Type' },
    AVB_Environment__c: { label: 'Environment', updateable: true },
    RecordTypeId: { label: 'Record Type ID' },
    AVB_ICAO_Account__c: { label: 'ICAO Account' },
    Type: { label: 'Issue Type' }
};

const row = showIf => ({ apiName: 'AVB_Handover_Type__c', showIf });

describe('the flat single-condition form keeps working exactly as before', () => {
    it('matches a value', () => {
        expect(isRowVisible(
            { apiName: 'X', showIfField: 'AVB_ICAO_Account__c', showIfValue: 'KLM' }, CTX
        )).toBe(true);
    });

    it('misses a value', () => {
        expect(isRowVisible(
            { apiName: 'X', showIfField: 'AVB_ICAO_Account__c', showIfValue: 'SWA' }, CTX
        )).toBe(false);
    });

    it('treats a missing value as "any non-blank"', () => {
        expect(isRowVisible({ apiName: 'X', showIfField: 'AVB_ICAO_Account__c' }, CTX)).toBe(true);
        expect(isRowVisible({ apiName: 'X', showIfField: 'AVB_Blank__c' }, CTX)).toBe(false);
    });

    it('shows a row with no condition at all', () => {
        expect(isRowVisible({ apiName: 'X' }, CTX)).toBe(true);
    });

    it('normalises to the same group the structured form produces', () => {
        const flat = conditionsOf(
            { showIfField: 'Type', showIfValue: 'Bug or Incident' }, siteByKey('showIf')
        );
        expect(flat).toEqual({
            logic: 'AND',
            conditions: [{ field: 'Type', value: 'Bug or Incident', negate: false }]
        });
    });
});

// "ICAO is KLM or SWA" is ONE condition with two values, not two conditions OR'd together.
// Both work; the comma-separated list is the shorter way to say it.
describe('several values in one condition', () => {
    it('matches any of them', () => {
        expect(isRowVisible(row([{ field: 'AVB_ICAO_Account__c', value: 'KLM,SWA' }]), CTX)).toBe(true);
        expect(isRowVisible(row([{ field: 'AVB_ICAO_Account__c', value: 'SWA,GRL' }]), CTX)).toBe(false);
    });

    it('tolerates spaces around the commas', () => {
        expect(isRowVisible(row([{ field: 'AVB_ICAO_Account__c', value: ' SWA , KLM ' }]), CTX))
            .toBe(true);
    });

    it('negates to "none of them"', () => {
        expect(isRowVisible(row([
            { field: 'AVB_ICAO_Account__c', value: 'SWA,GRL', negate: true }
        ]), CTX)).toBe(true);
        expect(isRowVisible(row([
            { field: 'AVB_ICAO_Account__c', value: 'KLM,SWA', negate: true }
        ]), CTX)).toBe(false);
    });

    it('reads the same as two conditions combined with OR', () => {
        const asList = row([{ field: 'AVB_ICAO_Account__c', value: 'KLM,SWA' }]);
        const asOr = row({ logic: 'OR', conditions: [
            { field: 'AVB_ICAO_Account__c', value: 'KLM' },
            { field: 'AVB_ICAO_Account__c', value: 'SWA' }
        ] });
        expect(isRowVisible(asList, CTX)).toBe(isRowVisible(asOr, CTX));
    });
});

describe('combining conditions', () => {
    const both = [
        { field: 'RecordTypeId', value: 'RT_AVIOBOOK' },
        { field: 'AVB_ICAO_Account__c', value: 'KLM' }
    ];
    const oneWrong = [both[0], { field: 'AVB_ICAO_Account__c', value: 'SWA' }];

    it('AND needs every one', () => {
        expect(isRowVisible(row({ logic: 'AND', conditions: both }), CTX)).toBe(true);
        expect(isRowVisible(row({ logic: 'AND', conditions: oneWrong }), CTX)).toBe(false);
    });

    it('OR needs only one', () => {
        expect(isRowVisible(row({ logic: 'OR', conditions: oneWrong }), CTX)).toBe(true);
        expect(isRowVisible(row({
            logic: 'OR',
            conditions: [{ field: 'Type', value: 'Nope' }, { field: 'AVB_ICAO_Account__c', value: 'SWA' }]
        }), CTX)).toBe(false);
    });

    it('defaults to AND, both when the logic is missing and for a bare array', () => {
        expect(isRowVisible(row({ conditions: oneWrong }), CTX)).toBe(false);
        expect(isRowVisible(row(both), CTX)).toBe(true);
        expect(isRowVisible(row(oneWrong), CTX)).toBe(false);
    });

    it('is one condition short of nothing when the list is empty', () => {
        expect(isRowVisible(row({ conditions: [] }), CTX)).toBe(true);
    });
});

describe('negating one condition', () => {
    it('inverts a membership test', () => {
        expect(isRowVisible(row([
            { field: 'AVB_ICAO_Account__c', value: 'SWA', negate: true }
        ]), CTX)).toBe(true);
        expect(isRowVisible(row([
            { field: 'AVB_ICAO_Account__c', value: 'KLM', negate: true }
        ]), CTX)).toBe(false);
    });

    it('reads "no value at all" as "is empty" when negated', () => {
        expect(isRowVisible(row([{ field: 'AVB_Blank__c', negate: true }]), CTX)).toBe(true);
        expect(isRowVisible(row([{ field: 'AVB_ICAO_Account__c', negate: true }]), CTX)).toBe(false);
    });

    // Otherwise "is not KLM" would quietly become true for every field nobody loaded,
    // which is the opposite of a safe default for a visibility rule.
    it('leaves a field that was never loaded false, negated or not', () => {
        expect(isRowVisible(row([{ field: 'Never__c', value: 'KLM' }]), CTX)).toBe(false);
        expect(isRowVisible(row([{ field: 'Never__c', value: 'KLM', negate: true }]), CTX)).toBe(false);
    });
});

describe('custom logic', () => {
    const three = [
        { field: 'RecordTypeId', value: 'RT_AVIOBOOK' },   // true
        { field: 'AVB_ICAO_Account__c', value: 'SWA' },     // false
        { field: 'Type', value: 'Bug or Incident' }         // true
    ];
    const withLogic = logic => isRowVisible(row({ logic, conditions: three }), CTX);

    it('honours brackets', () => {
        expect(withLogic('(1 AND 2) OR 3')).toBe(true);
        expect(withLogic('1 AND (2 OR 3)')).toBe(true);
        expect(withLogic('(1 OR 2) AND 3')).toBe(true);
        expect(withLogic('1 AND 2')).toBe(false);
    });

    it('honours NOT', () => {
        expect(withLogic('1 AND NOT 2')).toBe(true);
        expect(withLogic('NOT 1')).toBe(false);
        expect(withLogic('NOT (1 AND 3)')).toBe(false);
    });

    it('accepts && and || out of habit', () => {
        expect(withLogic('1 && 3')).toBe(true);
        expect(withLogic('2 || 3')).toBe(true);
    });

    it('is case-insensitive about the operators', () => {
        expect(withLogic('1 and not 2')).toBe(true);
    });

    // A typo must not reveal every row the condition was guarding, so it falls back to
    // AND — the strictest reading — and validateConfig is what says so out loud.
    it('falls back to AND when it cannot be parsed', () => {
        expect(withLogic('1 AND (2')).toBe(false);
        expect(withLogic('1 AND 9')).toBe(false);
    });

    it('says why it cannot be parsed', () => {
        expect(parseLogic('1 AND (2', 3).error).toMatch(/never closed/);
        expect(parseLogic('1 AND 9', 3).error).toMatch(/only 3/);
        expect(parseLogic('AND 1', 3).error).toMatch(/starts an expression/);
        expect(parseLogic('1 AND', 3).error).toMatch(/ends too early/);
        expect(parseLogic('1 @ 2', 3).error).toMatch(/Cannot read "@"/);
        expect(parseLogic('', 3).error).toMatch(/empty/);
        expect(parseLogic('(1 AND 2) OR 3', 3).error).toBeUndefined();
    });
});

describe('the live form value still wins over the saved one', () => {
    it('uses the record type just picked, not the one on the record', () => {
        const item = row([{ field: 'RecordTypeId', value: 'RT_AVIODATA' }]);
        expect(isRowVisible(item, CTX)).toBe(false);
        expect(isRowVisible(item, { ...CTX, selectedRecordTypeId: 'RT_AVIODATA' })).toBe(true);
    });

    it('uses a value typed into another field', () => {
        const item = row([{ field: 'AVB_ICAO_Account__c', value: 'SWA' }]);
        expect(isRowVisible(item, CTX)).toBe(false);
        expect(isRowVisible(item, { ...CTX, liveValues: { AVB_ICAO_Account__c: 'SWA' } })).toBe(true);
    });
});

describe('the other three sites run on the same engine', () => {
    it('underlines only when the colour conditions hold', () => {
        const item = { apiName: 'Priority', color: '#ba0517' };
        expect(holds({ ...item, colorIf: [{ field: 'Type', value: 'Bug or Incident' }] },
            siteByKey('colorIf'), CTX, 'Priority')).toBe(true);
        expect(holds({ ...item, colorIf: { logic: 'OR', conditions: [
            { field: 'Type', value: 'Nope' }, { field: 'AVB_ICAO_Account__c', value: 'KLM' }
        ] } }, siteByKey('colorIf'), CTX, 'Priority')).toBe(true);
    });

    it("still lets a colour condition with no field watch the row's own field", () => {
        expect(holds({ apiName: 'Type', color: 'red', colorIfValue: 'Bug or Incident' },
            siteByKey('colorIf'), CTX, 'Type')).toBe(true);
        expect(holds({ apiName: 'Type', color: 'red', colorIf: [{ field: '', value: 'Bug or Incident' }] },
            siteByKey('colorIf'), CTX, 'Type')).toBe(true);
    });

    // The header alert is the one site where no conditions means "never", because an
    // alert with no condition is an alert that can never fire.
    it('leaves the header alert off when nothing is configured', () => {
        expect(holds({}, siteByKey('alertIf'), CTX)).toBe(false);
        expect(holds({ alertIf: [{ field: 'Type', value: 'Bug or Incident' }] },
            siteByKey('alertIf'), CTX)).toBe(true);
    });

    it('treats an unconditional take-it requirement as always required', () => {
        expect(holds({ apiName: 'X' }, siteByKey('requiredIf'), CTX)).toBe(true);
        expect(holds({ apiName: 'X', requiredIf: [{ field: 'Type', value: 'Service Request' }] },
            siteByKey('requiredIf'), CTX)).toBe(false);
    });
});

describe('watchedFieldsOf', () => {
    it('collects every field any site watches, across rows and the section', () => {
        const rows = [
            { apiName: 'A__c', showIfField: 'RecordTypeId' },
            { apiName: 'B__c', showIf: [{ field: 'AVB_ICAO_Account__c', value: 'KLM' }] },
            { apiName: 'C__c', color: 'red', colorIfValue: 'x' },
            { apiName: 'D__c', requiredBeforeTakeover: true, requiredIfField: 'Type' }
        ];
        expect(watchedFieldsOf(rows, { alertField: 'Priority' })).toEqual([
            'RecordTypeId', 'AVB_ICAO_Account__c', 'C__c', 'Type', 'Priority'
        ]);
    });

    it('lists each field once however many conditions name it', () => {
        expect(watchedFieldsOf([
            { apiName: 'A__c', showIf: [{ field: 'Type' }, { field: 'Type', value: 'x' }] },
            { apiName: 'B__c', showIfField: 'Type' }
        ], {})).toEqual(['Type']);
    });
});

describe('which shape gets written', () => {
    const site = siteByKey('showIf');
    const set = (holder, group) => withConditionsSet(holder, site, group);

    it('writes one plain condition as the flat pair', () => {
        expect(set({ apiName: 'X' }, {
            logic: 'AND', conditions: [{ field: 'Type', value: 'Bug or Incident' }]
        })).toEqual({ apiName: 'X', showIfField: 'Type', showIfValue: 'Bug or Incident' });
    });

    it('omits the value key entirely for an "any non-blank" condition', () => {
        expect(set({ apiName: 'X' }, { conditions: [{ field: 'Type' }] }))
            .toEqual({ apiName: 'X', showIfField: 'Type' });
    });

    it('writes two conditions as the structured key, and drops the flat pair', () => {
        expect(set({ apiName: 'X', showIfField: 'Type', showIfValue: 'a' }, {
            logic: 'OR',
            conditions: [{ field: 'Type', value: 'a' }, { field: 'RecordTypeId', value: 'RT' }]
        })).toEqual({
            apiName: 'X',
            showIf: {
                logic: 'OR',
                conditions: [
                    { field: 'Type', value: 'a' },
                    { field: 'RecordTypeId', value: 'RT' }
                ]
            }
        });
    });

    it('leaves AND out of the JSON, since it is the default', () => {
        const out = set({ apiName: 'X' }, {
            logic: 'AND',
            conditions: [{ field: 'Type', value: 'a' }, { field: 'RecordTypeId', value: 'RT' }]
        });
        expect(out.showIf.logic).toBeUndefined();
        expect(out.showIf.conditions).toHaveLength(2);
    });

    it('cannot flatten a negated condition, however lonely it is', () => {
        const out = set({ apiName: 'X' }, { conditions: [{ field: 'Type', value: 'a', negate: true }] });
        expect(out.showIfField).toBeUndefined();
        expect(out.showIf.conditions).toEqual([{ field: 'Type', value: 'a', negate: true }]);
    });

    it('clears both shapes when the last condition goes', () => {
        expect(set({ apiName: 'X', showIfField: 'Type', showIfValue: 'a' }, { conditions: [] }))
            .toEqual({ apiName: 'X' });
        expect(set({ apiName: 'X', showIf: { conditions: [{ field: 'A' }] } }, { conditions: [] }))
            .toEqual({ apiName: 'X' });
    });

    // Storing a fieldless condition is the whole reason "add condition" can work: the editor
    // keeps no state of its own, so a new condition has to survive a round trip through the
    // config before anyone has chosen a field. Dropping it here made the button do nothing.
    it('keeps a condition that names no field yet, so it can be filled in', () => {
        expect(set({ apiName: 'X' }, { conditions: [{ field: 'Type' }, { field: '' }] }))
            .toEqual({
                apiName: 'X',
                showIf: { conditions: [{ field: 'Type' }, { field: '' }] }
            });
    });

    // The flat pair has no way to say "no field yet" — writing neither key would lose it.
    it('stores a lone unfinished condition structurally, since the flat pair cannot say it', () => {
        expect(set({ apiName: 'X' }, { conditions: [{ field: '' }] }))
            .toEqual({ apiName: 'X', showIf: { conditions: [{ field: '' }] } });
    });

    it('flattens it as soon as it has a field', () => {
        expect(set({ apiName: 'X', showIf: { conditions: [{ field: '' }] } },
            { conditions: [{ field: 'Type' }] }))
            .toEqual({ apiName: 'X', showIfField: 'Type' });
    });

    it('still flattens a single condition whichever way the logic is set, AND or OR', () => {
        expect(set({ apiName: 'X' }, { logic: 'OR', conditions: [{ field: 'Type' }] }))
            .toEqual({ apiName: 'X', showIfField: 'Type' });
    });

    it('round-trips through the serialiser', () => {
        const stored = set({ apiName: 'X' }, {
            logic: '(1 AND 2) OR 1',
            conditions: [{ field: 'Type', value: 'a' }, { field: 'RecordTypeId', value: 'RT' }]
        });
        const back = JSON.parse(serialize([stored], {})).fields[0];
        expect(conditionsOf(back, site, 'X').logic).toBe('(1 AND 2) OR 1');
        expect(conditionsOf(back, site, 'X').conditions).toHaveLength(2);
    });
});

// An unfinished condition must not constrain anything: a blank `showIfField` has always
// meant "no condition", so the structured shape has to agree, or the same config would mean
// two different things depending on which shape it was written in.
// The registry has always documented the `…Value` keys as 'Empty means "any non-blank
// value"', while the code read a blank as membership of the empty string — a condition that
// could essentially never hold. They now agree, which is also what lets an editor clear the
// box and mean the same thing as never having filled it in.
describe('a blank value means "any non-blank value"', () => {
    it('matches a populated field', () => {
        expect(isRowVisible(row([{ field: 'AVB_ICAO_Account__c', value: '' }]), CTX)).toBe(true);
        expect(isRowVisible({ apiName: 'X', showIfField: 'AVB_ICAO_Account__c', showIfValue: '' }, CTX))
            .toBe(true);
    });

    it('does not match an empty field', () => {
        expect(isRowVisible(row([{ field: 'AVB_Blank__c', value: '' }]), CTX)).toBe(false);
    });

    it('reads the same as leaving the value out altogether', () => {
        expect(isRowVisible(row([{ field: 'AVB_ICAO_Account__c', value: '   ' }]), CTX))
            .toBe(isRowVisible(row([{ field: 'AVB_ICAO_Account__c' }]), CTX));
    });

    it('negates to "is empty"', () => {
        expect(isRowVisible(row([{ field: 'AVB_Blank__c', value: '', negate: true }]), CTX)).toBe(true);
        expect(isRowVisible(row([{ field: 'AVB_ICAO_Account__c', value: '', negate: true }]), CTX))
            .toBe(false);
    });
});

describe('an unfinished condition is ignored, not treated as false', () => {
    it('leaves the row visible when the only condition names no field', () => {
        expect(isRowVisible(row([{ field: '' }]), CTX)).toBe(true);
        expect(isRowVisible({ apiName: 'X', showIfField: '' }, CTX)).toBe(true);
    });

    it('does not drag an AND down', () => {
        expect(isRowVisible(row([
            { field: 'AVB_ICAO_Account__c', value: 'KLM' }, { field: '' }
        ]), CTX)).toBe(true);
    });

    it('does not prop an OR up', () => {
        expect(isRowVisible(row({
            logic: 'OR', conditions: [{ field: 'Type', value: 'Nope' }, { field: '' }]
        }), CTX)).toBe(false);
    });

    // Dropping it from the results array instead would renumber the expression, and
    // "1 AND 3" would quietly come to mean conditions the author never picked.
    it('does not renumber a custom expression', () => {
        // 1 = true, 2 = unfinished, 3 = true
        const conditions = [
            { field: 'AVB_ICAO_Account__c', value: 'KLM' },
            { field: '' },
            { field: 'Type', value: 'Bug or Incident' }
        ];
        expect(isRowVisible(row({ logic: '1 AND 3', conditions }), CTX)).toBe(true);
        expect(isRowVisible(row({ logic: 'NOT 3', conditions }), CTX)).toBe(false);
        // Neutral under AND, which is what an unfinished condition should be.
        expect(isRowVisible(row({ logic: '1 AND 2 AND 3', conditions }), CTX)).toBe(true);
    });

    it('still reports it, so it does not stay unfinished by accident', () => {
        const out = validateConfig([row([{ field: '' }])], { fields: FIELDS })
            .map(f => f.message);
        expect(out[0]).toMatch(/watches no field/);
    });
});

describe('validation of conditions', () => {
    const findings = (rows, ctx) => validateConfig(rows, ctx || { fields: FIELDS });
    const messages = (rows, ctx) => findings(rows, ctx).map(f => f.message);

    it('passes a well-formed multi-condition row', () => {
        expect(findings([row({
            logic: '1 AND 2',
            conditions: [
                { field: 'RecordTypeId', value: 'RT' },
                { field: 'AVB_ICAO_Account__c', value: 'KLM' }
            ]
        })], { fields: FIELDS })).toEqual([]);
    });

    it('nudges when a value list is left empty, since it then matches anything', () => {
        const out = validateConfig(
            [row([{ field: 'Type', value: '' }])], { fields: FIELDS }
        ).map(f => f.message);
        expect(out[0]).toMatch(/lists no values, so any value counts/);
        expect(out[0]).toMatch(/has any value/);
    });

    it('says nothing when the condition simply has no value key', () => {
        expect(validateConfig([row([{ field: 'Type' }])], { fields: FIELDS })).toEqual([]);
    });

    it('catches a condition that watches nothing', () => {
        expect(messages([row([{ field: '' }])])[0]).toMatch(/watches no field/);
    });

    it('catches a condition watching a field the org does not have', () => {
        expect(messages([row([{ field: 'Nope__c', value: 'x' }])])[0])
            .toMatch(/Nope__c, which does not exist/);
    });

    it('numbers the conditions once there is more than one to tell apart', () => {
        const out = messages([row([{ field: 'Type' }, { field: 'Nope__c' }])]);
        expect(out[0]).toMatch(/^Condition 2 of "Show this row only when…"/);
    });

    it('reports unreadable logic as an error, and says it falls back to AND', () => {
        const out = messages([row({
            logic: '1 AND (2',
            conditions: [{ field: 'Type' }, { field: 'RecordTypeId' }]
        })]);
        expect(out[0]).toMatch(/cannot be read/);
        expect(out[0]).toMatch(/never closed/);
        expect(out[0]).toMatch(/all conditions must hold \(AND\)/);
    });

    it('warns about a condition the logic never mentions', () => {
        const out = messages([row({
            logic: '1 AND 2',
            conditions: [{ field: 'Type' }, { field: 'RecordTypeId' }, { field: 'AVB_ICAO_Account__c' }]
        })]);
        expect(out[0]).toMatch(/never mentions condition 3/);
    });

    it('warns when both shapes are set, and says which one wins', () => {
        const out = messages([{
            apiName: 'AVB_Handover_Type__c',
            showIfField: 'Type',
            showIf: [{ field: 'RecordTypeId' }]
        }]);
        expect(out[0]).toMatch(/Both "showIf" and the older "showIfField" are set/);
        expect(out[0]).toMatch(/"showIf" wins/);
    });

    it('refuses a shape that is neither a list nor an object', () => {
        expect(messages([row('RecordTypeId')])[0]).toMatch(/must be a list of conditions/);
    });

    it('still checks record type Ids, in whichever condition they appear', () => {
        const out = messages([row([
            { field: 'Type' },
            { field: 'RecordTypeId', value: '012KB000000kcw4YAA,012000000000000AAA' }
        ])], { fields: FIELDS, recordTypes: { '012KB000000kcw4YAA': 'AvioBook Case' } });
        expect(out[0]).toMatch(/012000000000000AAA/);
        expect(out[0]).not.toMatch(/012KB000000kcw4YAA,/);
    });

    it('accepts the header alert colour gated by the structured shape', () => {
        expect(validateSection(
            { alertIf: [{ field: 'Type', value: 'a' }], alertColor: '#ba0517' },
            { fields: FIELDS }
        )).toEqual([]);
    });

    it('still wants a colour for a header alert that has conditions', () => {
        const out = validateSection({ alertIf: [{ field: 'Type', value: 'a' }] }, { fields: FIELDS });
        expect(out.map(f => f.message)[0]).toMatch(/no alert background colour/);
    });
});

describe('conditions in English', () => {
    const labels = { RecordTypeId: 'Record Type', AVB_ICAO_Account__c: 'ICAO Account', Type: 'Issue Type' };
    const labelOf = api => labels[api] || api;

    it('reads one condition plainly', () => {
        expect(describeConditions({ conditions: [{ field: 'Type', value: 'a,b' }] }, labelOf))
            .toBe('Issue Type is a or b');
    });

    it('reads a negated condition', () => {
        expect(describeConditions({ conditions: [{ field: 'Type', value: 'a', negate: true }] }, labelOf))
            .toBe('Issue Type is not a');
    });

    it('distinguishes "is set" from "is empty"', () => {
        expect(describeConditions({ conditions: [{ field: 'Type' }] }, labelOf)).toBe('Issue Type is set');
        expect(describeConditions({ conditions: [{ field: 'Type', negate: true }] }, labelOf))
            .toBe('Issue Type is empty');
    });

    it('joins with and / or', () => {
        const two = [{ field: 'Type', value: 'a' }, { field: 'AVB_ICAO_Account__c', value: 'KLM' }];
        expect(describeConditions({ logic: 'AND', conditions: two }, labelOf))
            .toBe('Issue Type is a and ICAO Account is KLM');
        expect(describeConditions({ logic: 'OR', conditions: two }, labelOf))
            .toBe('Issue Type is a or ICAO Account is KLM');
    });

    it('quotes custom logic rather than pretending to prosify it', () => {
        expect(describeConditions({
            logic: '(1 AND 2) OR 1',
            conditions: [{ field: 'Type', value: 'a' }, { field: 'Type', value: 'b' }]
        }, labelOf)).toBe('(1 AND 2) OR 1 of [Issue Type is a; Issue Type is b]');
    });

    it('keeps the take-it sentence readable for a multi-condition row', () => {
        const text = describeRequirement({
            apiName: 'AVB_Environment__c',
            requiredBeforeTakeover: true,
            showIf: [
                { field: 'RecordTypeId', value: '012KB000000kcw4YAA' },
                { field: 'AVB_ICAO_Account__c', value: 'KLM' }
            ]
        }, { labels: { AVB_Environment__c: 'Environment', ...labels },
             recordTypes: { '012KB000000kcw4YAA': 'AvioBook Case' } });

        expect(text).toBe(
            'Environment must have a value before someone can take this case, but only while '
            + 'Record Type is AvioBook Case and ICAO Account is KLM.'
        );
    });
});

// Date comparison — the one thing conditions could never express. "Remind Me is on or before
// today" needs an operator, and getting dates right in a browser is mostly about not being
// caught by the two timezone traps below.
describe('comparing dates', () => {
    // 2026-08-25 as whole days since the epoch. A fixed number, so these assertions mean the
    // same thing on a machine in any timezone — which is the point.
    const AUG_25 = 20690;

    const at = value => ({ savedFields: { D__c: { value } }, today: AUG_25 });
    const row = (op, value) => ({ apiName: 'X', showIf: [{ field: 'D__c', op, value }] });
    const holdsOn = (op, operand, fieldValue) => isRowVisible(row(op, operand), at(fieldValue));

    it('knows 2026-08-25 as a fixed day, whatever timezone the machine is in', () => {
        expect(operandDay('2026-08-25')).toBe(AUG_25);
        expect(fieldDay('2026-08-25')).toBe(AUG_25);
    });

    describe('the operators', () => {
        it('is before', () => {
            expect(holdsOn('before', 'today', '2026-08-24')).toBe(true);
            expect(holdsOn('before', 'today', '2026-08-25')).toBe(false);
        });

        it('is on or before — the overdue case', () => {
            expect(holdsOn('onOrBefore', 'today', '2026-08-24')).toBe(true);
            expect(holdsOn('onOrBefore', 'today', '2026-08-25')).toBe(true);
            expect(holdsOn('onOrBefore', 'today', '2026-08-26')).toBe(false);
        });

        it('is on', () => {
            expect(holdsOn('on', 'today', '2026-08-25')).toBe(true);
            expect(holdsOn('on', 'today', '2026-08-26')).toBe(false);
        });

        it('is on or after', () => {
            expect(holdsOn('onOrAfter', 'today', '2026-08-25')).toBe(true);
            expect(holdsOn('onOrAfter', 'today', '2026-08-24')).toBe(false);
        });

        it('is after', () => {
            expect(holdsOn('after', 'today', '2026-08-26')).toBe(true);
            expect(holdsOn('after', 'today', '2026-08-25')).toBe(false);
        });

        it('covers exactly the operators the editor offers', () => {
            expect(DATE_OP_KEYS).toEqual(['before', 'onOrBefore', 'on', 'onOrAfter', 'after']);
        });
    });

    describe('what it compares against', () => {
        it('takes today', () => {
            expect(operandDay('today', AUG_25)).toBe(AUG_25);
            expect(operandDay('TODAY', AUG_25)).toBe(AUG_25);
        });

        it('takes an offset in days, either direction', () => {
            expect(operandDay('today+7', AUG_25)).toBe(AUG_25 + 7);
            expect(operandDay('today-30', AUG_25)).toBe(AUG_25 - 30);
            expect(operandDay('today + 7', AUG_25)).toBe(AUG_25 + 7);
        });

        it('takes a literal date', () => {
            expect(operandDay('2026-09-01')).toBe(AUG_25 + 7);
        });

        it('refuses anything else, rather than guessing', () => {
            ['next tuesday', 'tomorrow', '25/08/2026', '2026-8-5', 'today+', '', null]
                .forEach(bad => expect(operandDay(bad, AUG_25)).toBeNull());
        });

        it('refuses a date that never existed', () => {
            expect(operandDay('2026-02-30')).toBeNull();
            expect(operandDay('2027-02-29')).toBeNull();
            expect(operandDay('2028-02-29')).not.toBeNull();   // 2028 is a leap year
        });

        it('reads a window as two conditions', () => {
            const dueThisWeek = {
                apiName: 'X',
                showIf: {
                    logic: 'AND',
                    conditions: [
                        { field: 'D__c', op: 'onOrAfter', value: 'today' },
                        { field: 'D__c', op: 'onOrBefore', value: 'today+7' }
                    ]
                }
            };
            expect(isRowVisible(dueThisWeek, at('2026-08-28'))).toBe(true);
            expect(isRowVisible(dueThisWeek, at('2026-09-05'))).toBe(false);
            expect(isRowVisible(dueThisWeek, at('2026-08-20'))).toBe(false);
        });
    });

    // Trap 1: new Date('2026-08-25') is UTC midnight, so anyone west of UTC reads it as the
    // 24th. A date-only value is therefore never put through the Date parser.
    it('reads a date-only field literally, with no timezone shift', () => {
        expect(fieldDay('2026-01-01')).toBe(operandDay('2026-01-01'));
        expect(fieldDay('2026-12-31')).toBe(operandDay('2026-12-31'));
    });

    // Trap 2: a DateTime is a real instant, so it has to become the VIEWER's day — a case
    // created at 23:30 local belongs to that day, not the next one in UTC.
    it('converts a DateTime to the viewer\'s own day', () => {
        const lateLocal = new Date(2026, 7, 25, 23, 30).toISOString();
        const earlyLocal = new Date(2026, 7, 25, 0, 30).toISOString();
        expect(fieldDay(lateLocal)).toBe(AUG_25);
        expect(fieldDay(earlyLocal)).toBe(AUG_25);
    });

    it('defaults to the viewer\'s today when nobody pins one', () => {
        const now = new Date();
        expect(localToday()).toBe(operandDay(
            `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`
            + `${String(now.getDate()).padStart(2, '0')}`
        ));
    });

    describe('what cannot be compared', () => {
        it('never holds for an empty date', () => {
            expect(holdsOn('onOrBefore', 'today', null)).toBe(false);
            expect(holdsOn('onOrBefore', 'today', '')).toBe(false);
        });

        it('never holds for an operand it cannot read', () => {
            expect(holdsOn('onOrBefore', 'next tuesday', '2026-01-01')).toBe(false);
        });

        it('never holds for a field value that is not a date', () => {
            expect(holdsOn('onOrBefore', 'today', 'KLM')).toBe(false);
        });
    });

    it('can be negated, though the operators mostly make that unnecessary', () => {
        expect(isRowVisible(
            { apiName: 'X', showIf: [{ field: 'D__c', op: 'before', value: 'today', negate: true }] },
            at('2026-08-26')
        )).toBe(true);
    });

    // The flat showIfField/showIfValue pair has room for a field and a value and nothing
    // else, so a condition carrying an operator can only be written structurally.
    it('is always stored structurally, never flattened', () => {
        const stored = withConditionsSet({ apiName: 'X' }, siteByKey('showIf'), {
            conditions: [{ field: 'D__c', op: 'onOrBefore', value: 'today' }]
        });
        expect(stored).toEqual({
            apiName: 'X',
            showIf: { conditions: [{ field: 'D__c', op: 'onOrBefore', value: 'today' }] }
        });
        expect(stored.showIfField).toBeUndefined();
    });

    it('survives a round trip through the serialiser', () => {
        const stored = withConditionsSet({ apiName: 'X' }, siteByKey('showIf'), {
            conditions: [{ field: 'D__c', op: 'after', value: 'today+3' }]
        });
        const back = JSON.parse(serialize([stored], {})).fields[0];
        expect(conditionsOf(back, siteByKey('showIf'), 'X').conditions).toEqual([
            { field: 'D__c', op: 'after', value: 'today+3', negate: false }
        ]);
    });

    describe('validation', () => {
        const FIELD_CTX = {
            fields: {
                X__c: { label: 'X' },
                D__c: { label: 'Remind Me', dataType: 'Date' },
                T__c: { label: 'Created', dataType: 'DateTime' },
                S__c: { label: 'Subject', dataType: 'String' }
            }
        };
        const check = condition =>
            validateConfig([{ apiName: 'X__c', showIf: [condition] }], FIELD_CTX).map(f => f.message);

        it('passes a well-formed comparison, on Date and on DateTime', () => {
            expect(check({ field: 'D__c', op: 'onOrBefore', value: 'today' })).toEqual([]);
            expect(check({ field: 'T__c', op: 'after', value: '2026-09-01' })).toEqual([]);
        });

        it('reports an operator nobody defined', () => {
            expect(check({ field: 'D__c', op: 'roughlyAround', value: 'today' })[0])
                .toMatch(/unknown operator "roughlyAround"/);
        });

        it('reports an operand it cannot read, and says what it takes', () => {
            const out = check({ field: 'D__c', op: 'before', value: 'next tuesday' });
            expect(out[0]).toMatch(/not a date/);
            expect(out[0]).toMatch(/today\+7/);
        });

        it('warns when a non-date field is compared as a date', () => {
            expect(check({ field: 'S__c', op: 'before', value: 'today' })[0])
                .toMatch(/it is a String field, so the comparison will never hold/);
        });
    });

    it('reads as English', () => {
        expect(describeConditions(
            { conditions: [{ field: 'D__c', op: 'onOrBefore', value: 'today' }] },
            api => (api === 'D__c' ? 'Remind Me' : api)
        )).toBe('Remind Me is on or before today');
    });
});
