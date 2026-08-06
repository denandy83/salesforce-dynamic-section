import { createElement } from 'lwc';
import ND_DynamicSection from 'c/nD_DynamicSection';

// The first tests for this component. They cover the unconfigured card — what an admin
// sees in App Builder before any config is pasted in. The rest of the component needs a
// record and a form, and is exercised in the org rather than here.

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

describe('the unconfigured card', () => {
    it('says what to do, naming the tool and the property', async () => {
        const element = mount({ ND_jsonConfigString: '' });
        await Promise.resolve();

        const body = element.shadowRoot.querySelector('.nd-setup-body').textContent;
        expect(body).toContain('App Launcher');
        expect(body).toContain('Section Config Builder');
        expect(body).toContain('Field JSON Configuration');
    });

    it('offers a link to the builder', async () => {
        const element = mount({ ND_jsonConfigString: '' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup-link').href)
            .toContain('/lightning/n/ND_Section_Config_Builder');
    });

    it('shows the prompt for a config that will not parse, rather than a blank card', async () => {
        const element = mount({ ND_jsonConfigString: '{not json' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup')).not.toBeNull();
    });

    it('shows the prompt for a config with no field rows', async () => {
        const element = mount({ ND_jsonConfigString: '{"section":{"title":"X"},"fields":[]}' });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup')).not.toBeNull();
    });

    it('disappears once there are field rows', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: CONFIG
        });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-setup')).toBeNull();
    });

    // The separate "configured by the builder" bars were removed: one in the App Builder
    // canvas, where clicks are swallowed by drag-and-drop and a link is therefore a lie,
    // and one on the record page, which put admin chrome in front of agents' data. The
    // card's own prompt is the single place this is said.
    it('adds no extra bar above the card', async () => {
        const element = mount({
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: CONFIG
        });
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-builder-bar')).toBeNull();
    });
});
