import {
  ACCEPT,
  ACKNOWLEDGE,
  AGE,
  CLOSE,
  ALL,
  LOGIN,
  NECESSARY,
  NEGATION,
  ONLY,
  PAY,
  REJECT,
  REVOKE,
  SAVE,
  SELECT_ALL,
  SETTINGS,
  WITHOUT,
} from './patterns';

export type ButtonClass =
  | 'ACCEPT_ALL'
  | 'ACCEPT'
  | 'ACKNOWLEDGE'
  | 'SAVE'
  | 'SELECT_ALL'
  | 'SETTINGS'
  | 'REJECT'
  | 'PAY'
  | 'LOGIN'
  | 'OTHER';

/** Classes the policy may click to give consent. */
export const ACCEPTING: ReadonlySet<ButtonClass> = new Set(['ACCEPT_ALL', 'ACCEPT', 'ACKNOWLEDGE']);

/** Longer texts are sentences, not button labels. */
const MAX_LABEL_LENGTH = 64;
/** Bare nouns: tabs or headings of a dialog ("Consent | Details | About cookies"), never answers. */
const NOUN_ONLY = new Set(
  ['consent', 'toestemming', 'consentement', 'consenso', 'consentimiento', 'samtykke', 'samtycke', 'suostumus'].map((w) =>
    w.normalize('NFKD').replace(/\p{M}/gu, ''),
  ),
);

/** Labels naming more than the necessary category ("Essential + analytics") are not "necessary only". */
/** "Accept non-essential cookies": the "non" is no negation of accepting. */
const NON_ESSENTIAL_COOKIES = /non[ -]?essential cookies/;
const OPTIONAL_COOKIES = /non essential|nicht (notwendig|essenziell)|optional|\+|analy|statisti|marketing|komfort|tracking/;

/** Lower case without diacritics (capitals often drop them, e.g. Greek "ΣΥΜΦΩΝΩ" = "συμφωνώ"). */
const stripMarks = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC');

export function normalizeLabel(text: string): string {
  return stripMarks(text.normalize('NFKC'))
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^\p{L}\p{N}€+]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Scripts without spaces between words: their patterns match anywhere in the label. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

const compile = (sources: readonly string[]) => {
  const spaced = sources.filter((s) => !UNSPACED.test(s)).map(stripMarks);
  const unspaced = sources.filter((s) => UNSPACED.test(s)).map(stripMarks);
  const words = `(?<![\\p{L}\\p{N}])(?:${spaced.join('|')})(?![\\p{L}\\p{N}])`;
  return new RegExp(unspaced.length ? `${words}|${unspaced.join('|')}` : words, 'iu');
};

const RE = {
  pay: compile(PAY),
  login: compile(LOGIN),
  age: compile(AGE),
  reject: compile(REJECT),
  negation: compile(NEGATION),
  without: compile(WITHOUT),
  necessary: compile(NECESSARY),
  only: compile(ONLY),
  revoke: compile(REVOKE),
  save: compile(SAVE),
  accept: compile(ACCEPT),
  all: compile(ALL),
  acknowledge: compile(ACKNOWLEDGE),
  settings: compile(SETTINGS),
  selectAll: compile(SELECT_ALL),
  close: compile(CLOSE),
};

/**
 * Button label → class. Dangerous classes are decided first, so "Accept only necessary",
 * "Continue without accepting" or "Accept and subscribe" never count as accepting.
 */
export function classifyLabel(text: string): ButtonClass {
  const label = normalizeLabel(text);
  if (!label || label.length > MAX_LABEL_LENGTH) return 'OTHER';
  // A bare noun ("Consent", "Zustimmung") is a tab or heading of the dialog, not an answer.
  if (NOUN_ONLY.has(label)) return 'OTHER';
  if (RE.pay.test(label)) return 'PAY';
  if (RE.login.test(label)) return 'LOGIN';
  if (RE.age.test(label)) return 'OTHER';
  const accepting = RE.accept.test(label);
  if (
    RE.reject.test(label) ||
    RE.without.test(label) ||
    RE.revoke.test(label) ||
    (RE.necessary.test(label) && !OPTIONAL_COOKIES.test(label)) ||
    (accepting && (RE.negation.test(label.replace(NON_ESSENTIAL_COOKIES, '')) || RE.only.test(label)))
  ) {
    return 'REJECT';
  }
  if (RE.save.test(label)) return 'SAVE';
  if (RE.selectAll.test(label)) return 'SELECT_ALL';
  const all = RE.all.test(label);
  if (RE.close.test(label) && !accepting && !RE.acknowledge.test(label)) return 'OTHER';
  if (RE.settings.test(label) && !(accepting && all)) return 'SETTINGS';
  if (accepting) return all ? 'ACCEPT_ALL' : 'ACCEPT';
  if (RE.acknowledge.test(label)) return 'ACKNOWLEDGE';
  return 'OTHER';
}
