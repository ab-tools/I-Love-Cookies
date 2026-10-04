import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findConsentBanners } from '../../src/content/heuristic/banner';
import { extractButtons } from '../../src/content/heuristic/candidates';
import { acceptBanner } from '../../src/content/heuristic/flow';
import { heuristicOptions } from '../../src/content/heuristic/options';
import { decide } from '../../src/content/heuristic/policy';

// happy-dom has no layout: every element gets a box (data-rect="x,y,w,h" or a default one).
const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    const [x = 10, y = 10, w = 120, h = 30] = (this.getAttribute('data-rect') ?? '').split(',').filter(Boolean).map(Number);
    return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} } as DOMRect;
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  document.body.innerHTML = '';
});

const clicks: string[] = [];
function track() {
  clicks.length = 0;
  document.querySelectorAll('button,a,[role=button]').forEach((b) => b.addEventListener('click', () => clicks.push(b.id)));
}

const BANNER_TEXT = 'We and our 312 partners use cookies to personalise ads and measure traffic. You can change your consent at any time.';

describe('banner detection', () => {
  it('finds a fixed consent banner and ignores navigation, newsletters and plain content', () => {
    document.body.innerHTML = `
      <header style="position:fixed" data-rect="0,0,1024,60">Cookies partners privacy <button>Menu</button></header>
      <div id="newsletter" style="position:fixed" data-rect="200,200,500,300">Subscribe to our newsletter – we respect your privacy and cookies.
        <input type="email"><button>Subscribe</button></div>
      <main>${BANNER_TEXT}<button>Accept all</button></main>
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <button id="accept">Accept all</button><button id="reject">Reject all</button></div>`;
    expect(findConsentBanners().map((b) => b.element.id)).toEqual(['cmp']);
  });

  it('finds the banner when the page locks scrolling with a fixed <body>', () => {
    document.body.style.position = 'fixed';
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}<button>Accept all</button></div>`;
    expect(findConsentBanners().map((b) => b.element.id)).toEqual(['cmp']);
    document.body.style.position = '';
  });

  it('finds short cookie notices', () => {
    document.body.innerHTML = `
      <div id="notice" style="position:fixed" data-rect="0,700,1024,60">This website uses cookies to ensure you get the best experience.
        <button id="ok">Got it!</button></div>`;
    const [banner] = findConsentBanners();
    expect(banner?.element.id).toBe('notice');
    expect(decide(extractButtons(banner!.element))).toMatchObject({ action: 'click', kind: 'acknowledge' });
  });

  it('finds banners in shadow DOM', () => {
    document.body.innerHTML = `<cmp-root style="position:fixed" data-rect="0,500,1024,260"></cmp-root>`;
    const host = document.querySelector('cmp-root')!;
    host.attachShadow({ mode: 'open' }).innerHTML = `<div>${BANNER_TEXT}</div><button id="accept">Alle akzeptieren</button>`;
    const [banner] = findConsentBanners();
    expect(banner?.element).toBe(host);
    expect(extractButtons(host).map((b) => [b.label, b.cls])).toEqual([['Alle akzeptieren', 'ACCEPT_ALL']]);
  });

  it('treats script links as staying on the page and allows a language switch in a consent banner', () => {
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
      <select class="language-select">${'<option>Lang</option>'.repeat(12)}</select>
      <a href="Javascript:record_accept_all();">Accepter les cookies</a></div>`;
    const [banner] = findConsentBanners();
    expect(extractButtons(banner!.element).map((b) => [b.cls, b.navigates])).toEqual([['ACCEPT', false]]);
  });

  it('labels buttons inside custom elements by their slotted text', () => {
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
      <x-button>Cookies Akzeptieren</x-button></div>`;
    document.querySelector('x-button')!.attachShadow({ mode: 'open' }).innerHTML = '<button><slot></slot></button>';
    expect(extractButtons(document.getElementById('cmp')!).map((b) => [b.label, b.cls])).toEqual([['Cookies Akzeptieren', 'ACCEPT']]);
  });
});

describe('banner detection – special cases', () => {
  it('leaves age gates alone when age checks are switched off', () => {
    heuristicOptions.ageGates = false;
    document.body.innerHTML = `
      <div id="age" style="position:fixed" data-rect="0,0,1024,700">Willkommen! Bitte bestätigen Sie Ihr Alter und die
        Zustimmung zur Cookie-Nutzung. Sie bestätigen, dass Sie 18 Jahre oder älter sind. <button>Bestätigen</button></div>`;
    expect(findConsentBanners()).toEqual([]);
    heuristicOptions.ageGates = true;
  });

  it('confirms age checks, with or without cookie wording, when switched on', () => {
    document.body.innerHTML = `<div id="age" style="position:fixed" data-rect="0,0,1024,700">This website contains adult content.
      Are you 18 or older? <button id="yes">I am 18 or older – enter</button><button id="no">No, I am under 18</button></div>`;
    const [gate] = findConsentBanners();
    expect(gate?.element.id).toBe('age');
    expect(decide(extractButtons(gate!.element))).toMatchObject({ action: 'click', kind: 'age', button: { label: 'I am 18 or older – enter' } });
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT} Diese Website ist nur für Erwachsene.
      <button>Annehmen</button></div>`;
    expect(findConsentBanners()).toHaveLength(1);
  });

  it('finds banners in Bulgarian and Polish wording, also as a fixed <article>', () => {
    document.body.innerHTML = `<article id="bg" style="position:fixed" data-rect="0,700,1024,60">Използваме бисквитки, за да подобрим
      изживяването ви. <button>Приеми всички</button></article>`;
    expect(findConsentBanners().map((b) => b.element.id)).toEqual(['bg']);
    document.body.innerHTML = `<div id="pl" style="position:fixed" data-rect="0,700,1024,60">Używamy ciasteczek, dzięki którym nasza strona
      jest dla Ciebie bardziej przyjazna. <a id="accept_all_button" class="button">Akceptuję</a></div>`;
    expect(findConsentBanners().map((b) => b.element.id)).toEqual(['pl']);
  });

  it('closes notices whose close button is an icon without text', () => {
    document.body.innerHTML = `<div id="notice" style="position:fixed" data-rect="0,700,1024,60">We use cookies to offer you a better
      experience. <div class="close"><i class="efont eico-close"></i></div></div>`;
    const [banner] = findConsentBanners();
    expect(decide(extractButtons(banner!.element))).toMatchObject({ action: 'click', kind: 'close' });
  });

  it('takes a bare "Consent" button as accept all when its name says so', () => {
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,700,1024,200">${BANNER_TEXT}
      <a class="cookies__cta cookies-all">Consent</a><a class="cookies__cta cookies-selected">Consent to selected</a></div>`;
    const [banner] = findConsentBanners();
    expect(decide(extractButtons(banner!.element))).toMatchObject({ action: 'click', kind: 'accept_all', button: { label: 'Consent' } });
  });

  it('closes notices that offer nothing but "close"', () => {
    document.body.innerHTML = `<div id="notice" style="position:fixed" data-rect="0,700,1024,60">This website uses cookies to ensure you get
      the best experience. <a href="/privacy">Privacy Policy</a> <button id="x">×</button></div>`;
    const [banner] = findConsentBanners();
    expect(decide(extractButtons(banner!.element))).toMatchObject({ action: 'click', kind: 'close', button: { label: '×' } });
  });

  it('treats "if you are at least 16" consent wording as an ordinary consent banner', () => {
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT} Wenn Sie mindestens 16 Jahre alt sind,
      können Sie durch Klicken auf Alle akzeptieren zustimmen. <button>Alle akzeptieren</button></div>`;
    expect(findConsentBanners()).toHaveLength(1);
  });

  it('treats "if you agree and are over 18" as a consent condition, but not a declaration or an adult site', () => {
    heuristicOptions.ageGates = false;
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT} Wenn Sie der Verarbeitung zustimmen
      und über 18 Jahre alt sind, klicken Sie auf ALLE ERLAUBEN. <button>Alle erlauben</button></div>`;
    expect(findConsentBanners()).toHaveLength(1);
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT} Al visitar nuestro sitio web,
      declaras que eres mayor de 18 años y aceptas las cookies. <button>Aceptar todas las cookies</button></div>`;
    expect(findConsentBanners()).toEqual([]);
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT} Diese Website ist nur für Erwachsene.
      <button>Annehmen</button></div>`;
    expect(findConsentBanners()).toEqual([]);
    heuristicOptions.ageGates = true;
  });

  it('treats the GDPR parental-consent note as an ordinary consent banner', () => {
    document.body.innerHTML = `<div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT} Wenn Sie unter 16 Jahre alt sind und Ihre
      Zustimmung zu freiwilligen Diensten geben möchten, müssen Sie Ihre Erziehungsberechtigten um Erlaubnis bitten. <button>Alle akzeptieren</button></div>`;
    expect(findConsentBanners()).toHaveLength(1);
  });

  it('finds sticky bars by their utility classes', () => {
    document.body.innerHTML = `<div class="sticky bottom-0" style="position:sticky" data-rect="0,600,1024,70">This website uses cookies to ensure you get the best experience. <button>Got It!</button></div>`;
    expect(findConsentBanners()).toHaveLength(1);
  });

  it('uses script-driven pointer controls, but never labels of form controls', () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <div><input type="checkbox" id="analytics"><label for="analytics" style="cursor:pointer">Accept analytics</label></div>
        <div style="cursor:pointer">Accept All</div><div style="cursor:pointer">Reject Optional</div></div>`;
    const labels = extractButtons(document.getElementById('cmp')!).map((b) => `${b.cls}:${b.label}`);
    expect(labels).toEqual(['ACCEPT_ALL:Accept All', 'REJECT:Reject Optional']);
  });
});

describe('links', () => {
  it('allows accepting links to the same site, but never links to other sites or new tabs', () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <a id="same" href="/cookies/accept">Accept all cookies</a>
        <a id="info" href="/privacy">Privacy policy</a>
        <a id="away" href="https://other.example/accept">Accept</a>
        <a id="tab" href="/accept" target="_blank">Accept</a>
        <a id="policy" href="/policy/cookiepolicy">Optionale Einwilligung</a>
        <a id="shop" href="/shop/offer">Accept</a></div>`;
    const buttons = extractButtons(document.getElementById('cmp')!);
    const nav = Object.fromEntries(buttons.map((b) => [b.element.id, b.navigates]));
    expect(nav).toEqual({ same: false, info: true, away: true, tab: true, policy: true, shop: true });
    expect(decide(buttons)).toMatchObject({ action: 'click', button: { label: 'Accept all cookies' } });
  });
});

describe('decision', () => {
  it('prefers accept all and never clicks reject, paid, login or navigating buttons', () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <a id="more" href="https://example.org/privacy">Accept and read policy</a>
        <button id="pur">PUR-Abo für 2,99 €</button>
        <button id="login">Log in</button>
        <button id="reject">Alle ablehnen</button>
        <button id="accept">Zustimmen und weiter</button>
      </div>`;
    const decision = decide(extractButtons(document.getElementById('cmp')!));
    expect(decision).toMatchObject({ action: 'click', kind: 'accept' });
    expect(decision.action === 'click' && decision.button.element.id).toBe('accept');
  });

  it('does nothing when only rejecting or paying is offered', () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <button>Reject all</button><button>Subscribe for 3,99 €</button></div>`;
    expect(decide(extractButtons(document.getElementById('cmp')!))).toMatchObject({ action: 'none' });
  });
});

describe('acceptBanner', () => {
  it('clicks accept all', async () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <button id="settings">Settings</button><button id="reject">Reject all</button><button id="accept">Accept all</button></div>`;
    track();
    const result = await acceptBanner(document.getElementById('cmp')!);
    expect(result).toMatchObject({ done: true, clicked: ['Accept all'] });
    expect(clicks).toEqual(['accept']);
  });

  it('ticks a required "I accept the cookie settings" checkbox before accepting, but no category box', async () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <input type="checkbox" id="terms"><label for="terms">Akzeptieren <a href="#s">Cookie-Einstellungen</a> und <a href="#p">Datenschutzerklärung</a></label>
        <input type="checkbox" id="marketing"><label for="marketing">Marketing</label>
        <button id="accept">Zustimmen &amp; weiter</button></div>`;
    track();
    const result = await acceptBanner(document.getElementById('cmp')!);
    expect(result).toMatchObject({ done: true, clicked: ['Zustimmen & weiter'] });
    expect((document.getElementById('terms') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('marketing') as HTMLInputElement).checked).toBe(false);
  });

  it('switches every category on with toggle buttons, then closes the dialog', async () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <button id="cookies" data-rect="10,520,200,40">Accept Non-Essential Cookies</button>
        <button id="content" data-rect="10,570,200,30">Include Third Party Content</button>
        <button id="close" data-rect="10,610,200,30">Close this dialog box, leaving the settings as shown above.</button></div>`;
    const flip = (id: string, label: string) => document.getElementById(id)!.addEventListener('click', (e) => ((e.currentTarget as HTMLElement).textContent = label));
    flip('cookies', 'REJECT Non-Essential Cookies');
    flip('content', 'EXCLUDE Third Party Content');
    track();
    const result = await acceptBanner(document.getElementById('cmp')!);
    expect(result).toMatchObject({ done: true, clicked: ['Accept Non-Essential Cookies'] });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(clicks).toEqual(['cookies', 'content', 'close']);
  });

  it('opens the settings, switches every category on (never off) and saves', async () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <button id="reject">Reject all</button><button id="settings">Customise</button>
        <div id="layer"></div></div>`;
    track();
    let analytics: HTMLInputElement | null = null;
    document.getElementById('settings')!.addEventListener('click', () => {
      document.getElementById('layer')!.innerHTML = `
        <label><input type="checkbox" id="necessary" checked disabled> Necessary</label>
        <label><input type="checkbox" id="analytics"> Analytics</label>
        <label><input type="checkbox" id="marketing"> Marketing</label>
        <div role="switch" id="li" aria-checked="true" tabindex="0">Legitimate interest</div>
        <button id="save">Save my choices</button>`;
      analytics = document.getElementById('analytics') as HTMLInputElement;
      document.getElementById('save')!.addEventListener('click', () => clicks.push('save'));
      document.getElementById('li')!.addEventListener('click', () => clicks.push('li'));
    });
    const result = await acceptBanner(document.getElementById('cmp')!);
    expect(result.done).toBe(true);
    expect(result.toggled).toBe(2);
    expect(analytics!.checked).toBe(true);
    expect((document.getElementById('marketing') as HTMLInputElement).checked).toBe(true);
    expect(clicks).toEqual(['settings', 'save']); // legitimate-interest switch (already on) untouched
  });

  it('selects everything and saves when the banner shows its categories right away', async () => {
    document.body.innerHTML = `
      <dialog open id="cmp" data-rect="200,200,600,300">${BANNER_TEXT}
        <label><input type="checkbox" id="maps"> Kartendienste</label>
        <button id="none">Alle abwählen</button><button id="save">Speichern</button></dialog>`;
    track();
    const result = await acceptBanner(document.getElementById('cmp')!);
    expect(result).toMatchObject({ done: true, toggled: 1, clicked: ['Speichern'] });
    expect((document.getElementById('maps') as HTMLInputElement).checked).toBe(true);
    expect(clicks).toEqual(['save']);
  });

  it('switches categories on when the accept button is locked until then', async () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <label><input type="checkbox" id="all"> Alle Cookies</label>
        <button id="required">Akceptuję wymagane</button><button id="accept" disabled>Akceptuję</button></div>`;
    document.getElementById('all')!.addEventListener('change', () => document.getElementById('accept')!.removeAttribute('disabled'));
    track();
    const result = await acceptBanner(document.getElementById('cmp')!);
    expect(result).toMatchObject({ done: true, toggled: 1, clicked: ['Akceptuję'] });
    expect(clicks).toEqual(['accept']);
  });

  it('uses "accept all" inside the settings layer when there is one', async () => {
    document.body.innerHTML = `
      <div id="cmp" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <button id="reject">Ablehnen</button><button id="settings">Einstellungen</button><div id="layer"></div></div>`;
    track();
    document.getElementById('settings')!.addEventListener('click', () => {
      document.getElementById('layer')!.innerHTML = '<button id="all">Alle akzeptieren</button><button id="save">Auswahl speichern</button>';
      document.getElementById('all')!.addEventListener('click', () => clicks.push('all'));
    });
    const result = await acceptBanner(document.getElementById('cmp')!);
    expect(result).toMatchObject({ done: true, clicked: ['Einstellungen', 'Alle akzeptieren'] });
    expect(clicks).toEqual(['settings', 'all']);
  });
});
