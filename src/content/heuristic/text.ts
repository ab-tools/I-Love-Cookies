import {
  ACCEPT,
  ACKNOWLEDGE,
  AGE,
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
const MAX_LABEL_LENGTH = 48;
const OPTIONAL_COOKIES = /non essential|nicht (notwendig|essenziell)|optional/;

export function normalizeLabel(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^\p{L}\p{N}€+]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const compile = (sources: readonly string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${sources.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

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
};

/**
 * Button label → class. Dangerous classes are decided first, so "Accept only necessary",
 * "Continue without accepting" or "Accept and subscribe" never count as accepting.
 */
export function classifyLabel(text: string): ButtonClass {
  const label = normalizeLabel(text);
  if (!label || label.length > MAX_LABEL_LENGTH) return 'OTHER';
  if (RE.pay.test(label)) return 'PAY';
  if (RE.login.test(label)) return 'LOGIN';
  if (RE.age.test(label)) return 'OTHER';
  const accepting = RE.accept.test(label);
  if (
    RE.reject.test(label) ||
    RE.without.test(label) ||
    RE.revoke.test(label) ||
    (RE.necessary.test(label) && !OPTIONAL_COOKIES.test(label)) ||
    (accepting && (RE.negation.test(label) || RE.only.test(label)))
  ) {
    return 'REJECT';
  }
  if (RE.save.test(label)) return 'SAVE';
  if (RE.selectAll.test(label)) return 'SELECT_ALL';
  const all = RE.all.test(label);
  if (RE.settings.test(label) && !(accepting && all)) return 'SETTINGS';
  if (accepting) return all ? 'ACCEPT_ALL' : 'ACCEPT';
  if (RE.acknowledge.test(label)) return 'ACKNOWLEDGE';
  return 'OTHER';
}
