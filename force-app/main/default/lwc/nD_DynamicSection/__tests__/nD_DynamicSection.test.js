import { createElement } from 'lwc';
import ND_DynamicSection from 'c/nD_DynamicSection';

// The permission gate is a compile-time import, so each state needs its own module mock.
jest.mock('@salesforce/userPermission/CustomizeApplication', () => ({ default: true }), {
    virtual: true
});

// The first tests for this component. They cover only the design-time affordances, which
// are what an admin sees in App Builder — the rest of the component needs a record and a
// form, and is exercised in the org rather than here.

const CONFIG = JSON.stringify({
    section: { title: 'Case Details' },
    fields: [{ apiName: 'Status', editable: true }]
});

function mount(props = {}) {
    const element = createElement('c-n-d_-dynamic-section', { is: ND_DynamicSection });
    Object.assign(element, props);
    document.body.appendChild(element);
    return element;
}

afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('design time in the App Builder canvas', () => {
    // App Builder makes every component in the canvas a drag handle and swallows pointer
    // events, so anything link-shaped here looks live and does nothing. Design time gets
    // plain text and says so.
    it('shows a note but no link, because the canvas cannot be clicked', async () => {
        const element = mount({ ND_jsonConfigString: CONFIG });
        await Promise.resolve();

        const note = element.shadowRoot.querySelector('.nd-builder-bar_flat');
        expect(note).not.toBeNull();
        expect(note.textContent).toContain('Section Config Builder');
        expect(element.shadowRoot.querySelector('.nd-builder-bar-link')).toBeNull();
    });
});

describe('the admin link on a real record', () => {
    const onRecord = extra => mount(Object.assign({
        recordId: '500KB00000000001AAA',
        objectApiName: 'Case',
        ND_jsonConfigString: CONFIG
    }, extra));

    // The record page is the only surface where a link actually works.
    it('offers a clickable link to someone who can edit Lightning pages', async () => {
        const element = onRecord();
        await Promise.resolve();

        const link = element.shadowRoot.querySelector('.nd-builder-bar-link');
        expect(link).not.toBeNull();
        expect(link.href).toContain('/lightning/n/ND_Section_Config_Builder');
    });

    it('honours an overridden builder path', async () => {
        const element = onRecord({ ND_configBuilderUrl: '/lightning/n/Something_Else' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-builder-bar-link').href)
            .toContain('/lightning/n/Something_Else');
    });

    it('does not show the design-time note on a real record', async () => {
        const element = onRecord();
        await Promise.resolve();
        expect(element.shadowRoot.querySelector('.nd-builder-bar_flat')).toBeNull();
    });
});

describe('the unconfigured prompt', () => {
    it('explains what to do when there are no field rows', async () => {
        const element = mount({ ND_jsonConfigString: '' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup')).not.toBeNull();
        expect(element.shadowRoot.querySelector('.nd-setup-link').href)
            .toContain('/lightning/n/ND_Section_Config_Builder');
    });

    it('does not also show the slim bar, which would repeat the same link', async () => {
        const element = mount({ ND_jsonConfigString: '' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-builder-bar')).toBeNull();
    });

    it('shows the prompt rather than the bar for a config that will not parse', async () => {
        const element = mount({ ND_jsonConfigString: '{not json' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup')).not.toBeNull();
    });
});
