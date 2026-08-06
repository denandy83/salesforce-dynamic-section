import { createElement } from 'lwc';
import ND_DynamicSection from 'c/nD_DynamicSection';

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

describe('the App Builder canvas link', () => {
    // App Builder's record-page canvas supplies no recordId, which is the only signal a
    // component gets that it is being configured rather than used. A property panel cannot
    // render a clickable link, so this bar is where the link lives.
    it('shows a link to the builder when there is no record', async () => {
        const element = mount({ ND_jsonConfigString: CONFIG });
        await Promise.resolve();

        const link = element.shadowRoot.querySelector('.nd-builder-bar-link');
        expect(link).not.toBeNull();
        expect(link.href).toContain('/lightning/n/ND_Section_Config_Builder');
    });

    it('hides the bar once a record is present, so agents never see it', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: CONFIG
        });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-builder-bar')).toBeNull();
    });

    it('honours an overridden builder path', async () => {
        const element = mount({
            ND_jsonConfigString: CONFIG,
            ND_configBuilderUrl: '/lightning/n/Something_Else'
        });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-builder-bar-link').href)
            .toContain('/lightning/n/Something_Else');
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
