import { createElement } from 'lwc';
import ND_DynamicSection from 'c/nD_DynamicSection';

// Separate file because the permission is a compile-time import: one value per module
// registry, and this file is the "agent without Customize Application" case.
jest.mock('@salesforce/userPermission/CustomizeApplication', () => ({ default: false }), {
    virtual: true
});

const CONFIG = JSON.stringify({
    section: { title: 'Case Details' },
    fields: [{ apiName: 'Status', editable: true }]
});

afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('an agent without Customize Application', () => {
    it('never sees the builder link on a record', async () => {
        const element = createElement('c-n-d_-dynamic-section', { is: ND_DynamicSection });
        Object.assign(element, {
            recordId: '500KB00000000001AAA',
            objectApiName: 'Case',
            ND_jsonConfigString: CONFIG
        });
        document.body.appendChild(element);
        await Promise.resolve();

        expect(element.shadowRoot.querySelector('.nd-builder-bar')).toBeNull();
        expect(element.shadowRoot.querySelector('.nd-builder-bar-link')).toBeNull();
    });
});
