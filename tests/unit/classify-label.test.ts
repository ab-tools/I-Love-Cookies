import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACCEPTING, classifyLabel } from '../../src/content/heuristic/text';

/** DuckDuckGo's labelled cookie-banner button texts (see tests/fixtures/README.md). */
const rows = readFileSync('tests/fixtures/labelled-button-texts.csv', 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [, text, count, label] = line.match(/^(.*),(\d+),([a-z]+)$/)!;
    return { text: text!.replace(/^"|"$/g, ''), count: Number(count), label: label! };
  });

describe('classifyLabel on labelled real-world button texts', () => {
  let truePositive = 0;
  let falsePositive = 0;
  let acceptTotal = 0;
  let acceptFound = 0;
  let rejectAsAccepting = 0;
  for (const { text, count, label } of rows) {
    const accepting = ACCEPTING.has(classifyLabel(text));
    if (accepting && (label === 'accept' || label === 'acknowledge')) truePositive += count;
    if (accepting && label !== 'accept' && label !== 'acknowledge') falsePositive += count;
    if (label === 'accept') {
      acceptTotal += count;
      if (accepting) acceptFound++;
    }
    if (label === 'accept' && accepting) acceptFound += count - 1;
    if (label === 'reject' && accepting) rejectAsAccepting += count;
  }

  it('clicks almost never on something that is not an accept button (precision ≥ 99.5 %)', () => {
    expect(truePositive / (truePositive + falsePositive)).toBeGreaterThanOrEqual(0.995);
  });

  it('recognises most accept buttons (recall ≥ 94 %)', () => {
    expect(acceptFound / acceptTotal).toBeGreaterThanOrEqual(0.94);
  });

  it('practically never mistakes a reject button for accept', () => {
    expect(rejectAsAccepting).toBeLessThanOrEqual(10);
  });
});

describe('classifyLabel examples', () => {
  const cases: [string, string][] = [
    ['Alle akzeptieren', 'ACCEPT_ALL'],
    ['Accept all cookies', 'ACCEPT_ALL'],
    ['Tout accepter', 'ACCEPT_ALL'],
    ['Aceptar todas', 'ACCEPT_ALL'],
    ['Accetta tutti', 'ACCEPT_ALL'],
    ['Alles toestaan', 'ACCEPT_ALL'],
    ['Akceptuję wszystkie', 'ACCEPT_ALL'],
    ['Přijmout vše', 'ACCEPT_ALL'],
    ['Godkänn alla', 'ACCEPT_ALL'],
    ['Hyväksy kaikki', 'ACCEPT_ALL'],
    ['Αποδοχή όλων', 'ACCEPT_ALL'],
    ['ΑΠΟΔΟΧΗ ΟΛΩΝ', 'ACCEPT_ALL'],
    ['ΣΥΜΦΩΝΩ', 'ACCEPT'],
    ['ΔΙΑΦΩΝΩ', 'REJECT'],
    ['ΠΕΡΙΣΣΟΤΕΡΕΣ ΕΠΙΛΟΓΕΣ', 'SETTINGS'],
    ['ACCEPTAȚI TOATE', 'ACCEPT_ALL'],
    ['Zustimmen und weiter mit Werbung', 'ACCEPT_ALL'],
    ['Continue with recommended cookies', 'ACCEPT_ALL'],
    ['Akzeptieren', 'ACCEPT'],
    ['I agree', 'ACCEPT'],
    ["J'accepte", 'ACCEPT'],
    ['Akceptuję i przechodzę do serwisu', 'ACCEPT'],
    ['Godkänn', 'ACCEPT'],
    ['OK, verstanden', 'ACKNOWLEDGE'],
    ['Got it!', 'ACKNOWLEDGE'],
    ['ENABLE COOKIES', 'ACCEPT'],
    ['Klingt gut', 'ACCEPT'],
    ['APSTIPRINĀT VISAS', 'ACCEPT_ALL'],
    ['Apstiprināt izvēlētās', 'OTHER'],
    ['Weiter zur Seite', 'ACKNOWLEDGE'],
    ['Consent Manager schließen', 'OTHER'],
    ['Accept & close', 'ACCEPT'],
    ['Prihvaćam sve', 'ACCEPT_ALL'],
    ['Essenziell + Analytik erlauben', 'ACCEPT'],
    ['Nur Essenziell erlauben', 'REJECT'],
    ['Хорошо', 'ACKNOWLEDGE'],
    ['Akceptovať všetky cookies', 'ACCEPT_ALL'],
    ['De acord', 'ACCEPT'],
    ['Nu sunt de acord', 'REJECT'],
    ['Omogući sve kolačiće', 'ACCEPT_ALL'],
    ['ZUR KENNTNIS GENOMMEN', 'ACKNOWLEDGE'],
    ['RENDBEN', 'ACKNOWLEDGE'],
    ['Godkend alle', 'ACCEPT_ALL'],
    ['Godkjenn alle', 'ACCEPT_ALL'],
    ['Godkjenn nødvendige', 'REJECT'],
    ['Bin dabei!', 'ACCEPT'],
    ['Godkend kun obligatoriske', 'REJECT'],
    ['Jag samtycker', 'ACCEPT'],
    ['Ich verstehe', 'ACKNOWLEDGE'],
    ['Piekrist visiem', 'ACCEPT_ALL'],
    ['Pieņemt atlasi', 'SAVE'],
    ['ДАЮ СОГЛАСИЕ', 'ACCEPT'],
    ['ACKNOWLEDGE', 'ACKNOWLEDGE'],
    ['Alle Cookies aktzeptieren', 'ACCEPT_ALL'],
    ['Totally fine!', 'ACCEPT'],
    ['ZGADZAM SIĘ', 'ACCEPT'],
    ['Akceptuję politykę plików cookies i przechodzę do strony', 'ACCEPT'],
    ['CIENTE', 'ACKNOWLEDGE'],
    ['ALL RIGHT', 'ACKNOWLEDGE'],
    ['GA VERDER', 'ACKNOWLEDGE'],
    ['Konfigurieren', 'SETTINGS'],
    ['Продолжить работу', 'ACKNOWLEDGE'],
    ['我知道了', 'ACKNOWLEDGE'],
    ['Schválit vše', 'ACCEPT_ALL'],
    ['Hide cookie message', 'ACKNOWLEDGE'],
    ['Alles toelaten', 'ACCEPT_ALL'],
    ['Nõustun kõigiga', 'ACCEPT_ALL'],
    ['Continuar', 'ACKNOWLEDGE'],
    ['全て同意', 'ACCEPT_ALL'],
    ['approvo', 'ACCEPT'],
    ['HABE ES', 'ACKNOWLEDGE'],
    ['全部接受', 'ACCEPT_ALL'],
    ['Ich stimme allen Cookies zu', 'ACCEPT_ALL'],
    ['Autorizzare tutti i cookie', 'ACCEPT_ALL'],
    ['OK, fermer', 'ACKNOWLEDGE'],
    ['Close', 'OTHER'],
    ["Let's go!", 'ACKNOWLEDGE'],
    ['ICH LASSE COOKIES ZU', 'ACCEPT'],
    ['Alle Cookies', 'ACCEPT_ALL'],
    ['Notwendige Cookies', 'REJECT'],
    ['接受', 'ACCEPT'],
    ['Ich stimme der Verwendung aller Cookies zu.', 'ACCEPT_ALL'],
    ['Je comprends et accepte', 'ACCEPT'],
    ['CONTINUAR E FECHAR', 'ACCEPT'],
    ["That's cool", 'ACCEPT'],
    ['ACEPTAR Y CONTINUAR GRATIS', 'ACCEPT_ALL'],
    ['SUSCRIBIRME DESDE 1.67 AL MES', 'PAY'],
    ['Continue', 'ACKNOWLEDGE'],
    ['Continue with Google', 'LOGIN'],
    ['Continue without accepting', 'REJECT'],
    ['Jazeker', 'ACCEPT'],
    ["Pas d'accord", 'REJECT'],
    ['Consent', 'OTHER'],
    ['Zustimmung erteilen', 'ACCEPT'],
    ['GÓÐTAK ALLAR', 'ACCEPT_ALL'],
    ['Eg góðkenni øll farspor', 'ACCEPT_ALL'],
    ['Να επιτραπούν όλα τα cookies', 'ACCEPT_ALL'],
    ['Mit allen Cookies fortfahren', 'ACCEPT_ALL'],
    ['Confirm', 'SAVE'],
    ['Confirm all', 'ACCEPT_ALL'],
    ['Approve all', 'ACCEPT_ALL'],
    ['Reject non-essential cookies', 'REJECT'],
    ['Allem zustimmen', 'ACCEPT_ALL'],
    ['Approve selection', 'SAVE'],
    ['Hinweis gelesen', 'ACKNOWLEDGE'],
    ['Đồng ý', 'ACCEPT'],
    ['同意します', 'ACCEPT'],
    ['同意しません', 'REJECT'],
    ['我接受', 'ACCEPT'],
    ['我不接受', 'REJECT'],
    ['ยอมรับ', 'ACCEPT'],
    ['ไม่ยอมรับ', 'REJECT'],
    ['Бәрін қабылдау', 'ACCEPT_ALL'],
    ['הבנתי', 'ACKNOWLEDGE'],
    ['Alle ablehnen', 'REJECT'],
    ['Nur notwendige Cookies', 'REJECT'],
    ['Accept only necessary', 'REJECT'],
    ['Accept necessary cookies', 'REJECT'],
    ['Continuer sans accepter', 'REJECT'],
    ['No acepto', 'REJECT'],
    ['Nicht einverstanden', 'REJECT'],
    ['Weiter ohne Einwilligung', 'REJECT'],
    ['Auswahl erlauben', 'SAVE'],
    ['Allow selection', 'SAVE'],
    ['Save preferences', 'SAVE'],
    ['Einstellungen', 'SETTINGS'],
    ['Manage options', 'SETTINGS'],
    ['Cookie consent settings', 'SETTINGS'],
    ['Alle auswählen', 'SELECT_ALL'],
    ['zeit.de werbefrei abonnieren', 'PAY'],
    ['PUR-Abo für 2,99 €', 'PAY'],
    ['Jetzt sichern', 'PAY'],
    ['Accept all and subscribe', 'PAY'],
    ['Log in', 'LOGIN'],
    ['I agree – enter', 'OTHER'],
    ['Yes, I am 18 or older', 'OTHER'],
    ['Privacy policy', 'OTHER'],
    ['Accept all above and continue reading the rest of this long sentence', 'OTHER'],
  ];
  it.each(cases)('%s → %s', (text, expected) => {
    expect(classifyLabel(text)).toBe(expected);
  });
});
