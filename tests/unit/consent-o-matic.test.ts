import { beforeEach, describe, expect, it } from 'vitest';
import { ComFinder, ConsentOMaticCMP, type ComRule } from '../../src/content/consent-o-matic';
import comRules from '../../src/rules/consent-o-matic.json';

const rule: ComRule = {
  name: 'test',
  detectors: [
    {
      presentMatcher: { type: 'css', target: { selector: '#cmp' } },
      showingMatcher: { type: 'css', target: { selector: '#cmp', displayFilter: true } },
    },
  ],
  methods: [
    { name: 'HIDE_CMP', action: { type: 'hide', target: { selector: '#cmp' } } },
    { name: 'OPEN_OPTIONS', action: { type: 'click', target: { selector: 'button', textFilter: ['Settings', 'Einstellungen'] } } },
    {
      name: 'DO_CONSENT',
      action: {
        type: 'consent',
        consents: [
          {
            type: 'A',
            matcher: { type: 'checkbox', target: { selector: '#analytics' } },
            toggleAction: { type: 'click', target: { selector: '#analytics' } },
          },
          {
            type: 'F',
            matcher: { type: 'checkbox', target: { selector: '#ads' } },
            toggleAction: { type: 'click', target: { selector: '#ads' } },
          },
        ],
      },
    },
    { name: 'SAVE_CONSENT', action: { type: 'click', target: { selector: '#save' } } },
  ],
};

describe('Consent-O-Matic interpreter', () => {
  let saved = false;
  let opened = false;

  beforeEach(() => {
    saved = false;
    opened = false;
    document.body.innerHTML = `
      <div id="cmp">
        <button id="reject">Reject</button>
        <button id="settings">Einstellungen</button>
        <input type="checkbox" id="analytics">
        <input type="checkbox" id="ads" checked>
        <button id="save">Save</button>
      </div>`;
    // happy-dom has no layout: treat everything as displayed.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 20 });
    document.getElementById('settings')!.addEventListener('click', () => (opened = true));
    document.getElementById('save')!.addEventListener('click', () => (saved = true));
  });

  it('detects the banner', async () => {
    const cmp = new ConsentOMaticCMP(rule);
    expect(cmp.name).toBe('com-test');
    expect(await cmp.detectCmp()).toBe(true);
    expect(await cmp.detectPopup()).toBe(true);
    expect(cmp.prehideSelectors).toEqual(['#cmp']);
  });

  it('opens the settings, enables every category without toggling enabled ones off, and saves', async () => {
    const cmp = new ConsentOMaticCMP(rule);
    expect(await cmp.optIn()).toBe(true);
    expect(opened).toBe(true);
    expect((document.getElementById('analytics') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('ads') as HTMLInputElement).checked).toBe(true);
    expect(saved).toBe(true);
    // never hidden
    expect(document.getElementById('cmp')!.getAttribute('style')).toBeNull();
  });

  it('applies text filters case-insensitively', () => {
    const finder = new ComFinder();
    expect(finder.findOne({ target: { selector: 'button', textFilter: 'einstellungen' } })?.id).toBe('settings');
    expect(finder.findOne({ target: { selector: 'button', textFilter: ['nope'] } })).toBeNull();
  });

  it('does not detect anything on a page without the banner', async () => {
    document.body.innerHTML = '<p>Hello</p>';
    expect(await new ConsentOMaticCMP(rule).detectCmp()).toBe(false);
  });

  it('bundles only rules with actions and without hide methods', () => {
    const rules = comRules as unknown as ComRule[];
    expect(rules.length).toBeGreaterThan(50);
    for (const r of rules) {
      expect(r.methods.some((m) => m.name === 'HIDE_CMP'), r.name).toBe(false);
      expect(r.detectors.length, r.name).toBeGreaterThan(0);
    }
  });
});
