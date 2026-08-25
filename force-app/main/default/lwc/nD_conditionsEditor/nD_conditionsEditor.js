import { LightningElement, api } from 'lwc';
import {
    parseLogic,
    splitCsv,
    LOGIC_AND,
    LOGIC_OR,
    DATE_OPS,
    DATE_OPERAND_HINT,
    dateOpFor,
    operandDay
} from 'c/nD_sectionConfigSchema';

/**
 * The four states a condition can be in, named.
 *
 * They are only ever two booleans underneath — is there a value list, and is it negated —
 * but inferring the operator from those made the dropdown RELABEL ITSELF as soon as you
 * typed, which is no way to work. Naming all four keeps the labels fixed and the choice
 * explicit.
 *
 * The distinction that makes it work: a value key that is PRESENT but empty means "compare
 * against a list, nothing listed yet", while an ABSENT one means "do not compare at all".
 * Without that, choosing "is one of" and not having typed anything yet would be
 * indistinguishable from "has any value", and the dropdown would snap back on its own.
 */
const OPERATORS = [
    { value: 'oneOf', label: 'is one of', list: true, negate: false },
    { value: 'notOneOf', label: 'is not one of', list: true, negate: true },
    { value: 'any', label: 'has any value', list: false, negate: false },
    { value: 'empty', label: 'is empty', list: false, negate: true }
];

function operatorOf(condition) {
    // A date operator is stored outright, so there is nothing to infer.
    if (dateOpFor(condition.op)) return { value: condition.op, list: true, date: true };

    const comparing = condition.value !== undefined && condition.value !== null;
    return OPERATORS.find(o => o.list === comparing && o.negate === (condition.negate === true))
        || OPERATORS[0];
}

const DATE_TYPES = ['date', 'datetime'];

function isDateType(type) {
    return DATE_TYPES.includes(String(type || '').toLowerCase());
}

/**
 * The editor for one condition site — "Show this row only when…", "Underline the value
 * when…", and the other two. One component rather than a fourth copy of the builder's
 * control markup: the builder already renders its property pane three times over (section,
 * field, nested), and a condition list is far too much markup to paste into each.
 *
 * It owns no config state. Every edit rebuilds the whole group and fires `change` with it,
 * so the row (or the section) in the builder stays the single source of truth and undo /
 * re-select / paste-a-config all keep working without this component knowing about them.
 */
const CUSTOM = 'CUSTOM';

export default class ND_ConditionsEditor extends LightningElement {
    @api legend;
    @api help;
    @api site;

    /** { logic, conditions: [{ field, value, negate }] } — normalised by the schema module. */
    @api group;

    /** [{label, value}] — every field on the object. */
    @api fieldOptions = [];

    /** { apiName: [{label, value}] } for fields with a fixed set of values. */
    @api valueChoices = {};

    /** Label for the underline site's "this row's own field" choice, when there is one. */
    @api selfFieldLabel;

    /**
     * The field that choice actually selects — the row's own apiName. It writes a REAL name
     * rather than a blank, because a blank field now means "not chosen yet" at every site.
     */
    @api selfFieldValue = '';

    /** { apiName: dataType } — only Date and DateTime are acted on, to offer date operators. */
    @api fieldTypes = {};

    get conditions() {
        return ((this.group && this.group.conditions) || []).map((condition, index) => {
            const choices = this.valueChoices ? this.valueChoices[condition.field] : null;
            const operator = operatorOf(condition);
            const dateOp = dateOpFor(condition.op);
            // Date operators are offered for date fields — and kept on offer for a condition
            // that already carries one, whatever the field says now. Otherwise a combobox
            // would hold a value absent from its own options and render blank.
            const datey = isDateType(this.fieldTypes && this.fieldTypes[condition.field]) || !!dateOp;
            // A comparison takes one date, not a list of them.
            const hasChoices = !dateOp && !!(choices && choices.length);
            return {
                key: `c${index}`,
                index: String(index),
                number: index + 1,
                fieldValue: condition.field || '',
                operatorValue: operator.value,
                operatorOptions: datey
                    ? OPERATORS.map(o => ({ label: o.label, value: o.value }))
                        .concat(DATE_OPS.map(o => ({ label: o.label, value: o.value })))
                    : OPERATORS.map(o => ({ label: o.label, value: o.value })),
                // Only the comparing operators need somewhere to put values. This is still
                // derived state, but it follows from an explicit CHOICE rather than from
                // whether a box happens to be empty, so it cannot change while typing.
                showValues: operator.list,
                isDateOp: !!dateOp,
                hasChoices,
                valueOptions: choices || [],
                selectedValues: hasChoices ? splitCsv(condition.value) : [],
                valueText: condition.value === undefined || condition.value === null
                    ? ''
                    : String(condition.value),
                valueLabel: dateOp ? 'Date' : 'Values',
                valuePlaceholder: dateOp ? DATE_OPERAND_HINT : 'Any value — or list them: KLM,SWA',
                valueHint: dateOp
                    ? `Write ${DATE_OPERAND_HINT}.`
                    : (String(condition.value || '').trim() === ''
                        ? 'List none and any value counts. Separate several with commas.'
                        : 'Any one of these counts as a match.'),
                // Nothing else in a config can be MALFORMED rather than merely wrong, so a
                // date operand is the one value worth checking as it is written.
                valueError: dateOp && operandDay(condition.value) === null
                    ? `"${String(condition.value || '').trim()}" is not a date this understands.`
                    : null
            };
        });
    }

    get logicOptions() {
        return [
            { label: 'All of them must be true (AND)', value: LOGIC_AND },
            { label: 'Any one of them may be true (OR)', value: LOGIC_OR },
            { label: 'Custom…', value: CUSTOM }
        ];
    }

    get logicMode() {
        const logic = String((this.group && this.group.logic) || LOGIC_AND).trim().toUpperCase();
        return logic === LOGIC_AND || logic === LOGIC_OR ? logic : CUSTOM;
    }

    get isCustom() {
        return this.logicMode === CUSTOM;
    }

    get logicExpression() {
        return this.isCustom ? String(this.group.logic) : '';
    }

    /** Only worth choosing a mode once there are two conditions to combine. */
    get showLogic() {
        return this.conditions.length > 1;
    }

    get logicError() {
        if (!this.isCustom) return null;
        const parsed = parseLogic(this.logicExpression, this.conditions.length);
        return parsed.error || null;
    }

    get hasConditions() {
        return this.conditions.length > 0;
    }

    get emptyHint() {
        return this.selfFieldLabel
            ? `No conditions — always on. Add one to make it conditional.`
            : `No conditions — this always applies. Add one to make it conditional.`;
    }

    // --- edits. Each one rebuilds the group and hands it up. ------------------------

    get _list() {
        return ((this.group && this.group.conditions) || []).map(c => Object.assign({}, c));
    }

    _emit(conditions, logic) {
        this.dispatchEvent(new CustomEvent('change', {
            detail: {
                site: this.site,
                group: {
                    logic: logic === undefined ? (this.group && this.group.logic) || LOGIC_AND : logic,
                    conditions
                }
            }
        }));
    }

    _indexOf(event) {
        return Number(event.currentTarget.dataset.index);
    }

    handleAdd() {
        // Starts as "is one of" with nothing listed: that is what a condition is for most of
        // the time, and it shows the whole shape of one straight away.
        this._emit(this._list.concat({ field: '', value: '', negate: false }));
    }

    handleRemove(event) {
        const index = this._indexOf(event);
        const next = this._list.filter((_, i) => i !== index);
        // A custom expression numbered against the old list would now point at the wrong
        // conditions, so drop back to AND rather than silently changing what it means.
        this._emit(next, this.isCustom && next.length !== this._list.length ? LOGIC_AND : undefined);
    }

    handleFieldChange(event) {
        const index = this._indexOf(event);
        const next = this._list;
        next[index].field = event.detail.value;
        // The old value belonged to the old field's value set, so keeping it would leave a
        // condition that can never match.
        delete next[index].value;
        this._emit(next);
    }

    handleOperatorChange(event) {
        const index = this._indexOf(event);
        const next = this._list;
        const picked = event.detail.value;
        const dateOp = dateOpFor(picked);

        if (dateOp) {
            next[index].op = picked;
            next[index].negate = false;
            // "today" is what this is for nearly every time, so the condition is valid the
            // moment it is chosen rather than sitting in an error state waiting to be typed.
            const current = String(next[index].value || '').trim();
            if (!current || operandDay(current) === null) next[index].value = 'today';
            this._emit(next);
            return;
        }

        const chosen = OPERATORS.find(o => o.value === picked) || OPERATORS[0];
        delete next[index].op;
        next[index].negate = chosen.negate;
        // An empty string is what records "comparing, nothing listed yet"; dropping the key
        // is what records "not comparing at all". A date operand is not a value list, so it
        // does not survive the switch back.
        if (chosen.list) {
            const carried = String(next[index].value || '').trim();
            next[index].value = operandDay(carried) !== null && /today/i.test(carried) ? '' : (next[index].value || '');
        } else {
            delete next[index].value;
        }
        this._emit(next);
    }

    /**
     * A plain <input> committing on its native change event, which fires on blur and Enter —
     * NOT per keystroke. `lightning-input` maps native input to change, so every character
     * used to rewrite the whole config, re-render the entire property pane, and throw an
     * error Aura swallowed. Same reason nD_fieldCombobox uses a plain input.
     */
    handleValueChange(event) {
        const index = this._indexOf(event);
        const next = this._list;
        const raw = event.detail && event.detail.value !== undefined
            ? event.detail.value
            : event.target.value;
        const value = Array.isArray(raw) ? raw.join(',') : raw;
        // Always stored, empty included. Deleting the key on an empty box would move the
        // condition to "has any value", which hides the box — the operator dropdown is the
        // only thing allowed to change which controls exist.
        next[index].value = value === null || value === undefined ? '' : value;
        this._emit(next);
    }

    handleLogicMode(event) {
        const mode = event.detail.value;
        if (mode === LOGIC_AND || mode === LOGIC_OR) {
            this._emit(this._list, mode);
            return;
        }
        // Seed Custom with the expression the current mode already means, so the box is
        // never blank and the starting point is always valid.
        const joiner = this.logicMode === LOGIC_OR ? ` ${LOGIC_OR} ` : ` ${LOGIC_AND} `;
        const seeded = this.conditions.map(c => c.number).join(joiner);
        this._emit(this._list, seeded);
    }

    handleLogicExpression(event) {
        this._emit(this._list, event.target.value);
    }
}
