import { LightningElement, api, track } from 'lwc';

/**
 * One control for picking a field out of the ~127 an object has: type to narrow, click to
 * choose.
 *
 * It replaces a `lightning-combobox` with a separate filter box underneath it, which is two
 * inputs for one decision — and worse, the filter looked like a value you were supposed to
 * fill in. `lightning-combobox` has no type-ahead of its own, which is the whole reason the
 * filter box existed and the reason "Add a field" was already a search list rather than a
 * dropdown. This is that same search list, with a current selection.
 *
 * Deliberately a plain <input> rather than lightning-input: focus, blur and keydown all have
 * to be handled precisely here, and the base component wraps them.
 */
const MATCH_LIMIT = 60;

export default class ND_FieldCombobox extends LightningElement {
    @api label;
    @api value = '';
    /** [{ label, value }] — value is the API name, shown beside the label like "Add a field". */
    @api options = [];
    @api placeholder = 'Search fields…';
    /** Label for the empty value, on the one site where blank means something. */
    @api blankLabel;
    @api disabled = false;

    // null means "not searching, showing the selection". A string means the user is typing,
    // which is also what opens the list — one piece of state for both.
    @track draft = null;

    get isOpen() {
        return this.draft !== null && !this.disabled;
    }

    get inputValue() {
        return this.draft !== null ? this.draft : this.selectedText;
    }

    get selectedText() {
        if (!this.value) return this.blankLabel || '';
        const hit = (this.options || []).find(o => o.value === this.value);
        return hit ? `${hit.label} · ${hit.value}` : this.value;
    }

    /** True once a field is chosen, so the placeholder does not fight a real selection. */
    get hasSelection() {
        return !!this.value || !!this.blankLabel;
    }

    get matches() {
        const needle = String(this.draft || '').trim().toLowerCase();
        const base = this.blankLabel ? [{ label: this.blankLabel, value: '' }] : [];

        const hits = (this.options || []).filter(o => !needle
            || o.label.toLowerCase().includes(needle)
            || String(o.value).toLowerCase().includes(needle));

        // The current choice goes first. Opening on an empty search lists 127 fields and
        // the cap below keeps 60 of them, so without this the selected field is simply
        // absent from the list whenever it sorts past the cap — which is most of the time,
        // and makes the open list look like it has forgotten what was chosen.
        const current = this.value;
        if (current) {
            const at = hits.findIndex(o => o.value === current);
            if (at > 0) hits.unshift(hits.splice(at, 1)[0]);
        }

        return base.concat(hits)
            .slice(0, MATCH_LIMIT)
            .map(o => {
                const current = o.value === (this.value || '');
                return {
                    key: o.value || '__blank',
                    apiName: o.value,
                    label: o.label,
                    // The blank option has no API name to show, and repeating the label
                    // under itself would just be noise.
                    showApi: !!o.value,
                    note: current ? 'current' : '',
                    cssClass: current ? 'nd-fc-match nd-fc-match_current' : 'nd-fc-match'
                };
            });
    }

    get hasMatches() {
        return this.matches.length > 0;
    }

    get countText() {
        const total = (this.options || []).length;
        const shown = this.matches.length;
        if (this.draft === null || !String(this.draft).trim()) return `${total} fields`;
        return shown >= MATCH_LIMIT ? `first ${shown} of ${total}` : `${shown} of ${total}`;
    }

    // --- interaction ---------------------------------------------------------------

    handleFocus() {
        // Open on an empty search so the whole list is there to browse, the way the dropdown
        // it replaces was. The current choice is marked in the list, so it is not lost.
        this.draft = '';
    }

    handleInput(event) {
        this.draft = event.target.value;
    }

    /** Leaving without choosing reverts to the selection rather than keeping a half-typed term. */
    handleBlur() {
        this.draft = null;
    }

    /**
     * mousedown, not click: click arrives after blur, and blur closes the list, so a click
     * handler would fire on an element that had already been removed.
     */
    handlePick(event) {
        event.preventDefault();
        this.commit(event.currentTarget.dataset.field || '');
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            this.draft = null;
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const first = this.matches[0];
            if (first) this.commit(first.apiName || '');
        }
    }

    commit(next) {
        this.draft = null;
        if (next === (this.value || '')) return;
        // Same detail shape as lightning-combobox, so a parent that used to listen to one
        // needs no change beyond the tag.
        this.dispatchEvent(new CustomEvent('change', { detail: { value: next } }));
    }
}
