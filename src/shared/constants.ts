export const EXTENSION_NAME = 'I Love Cookies';

/** Permanent Firefox add-on ID – must never change once published on AMO. */
export const GECKO_ID = 'i-love-cookies@ilovecookies.dev';

/** GitHub repository that receives "Report a problem" issues. TODO: set to the real repository before release. */
export const REPO_URL = 'https://github.com/i-love-cookies/i-love-cookies';

/** Name of the issue form in .github/ISSUE_TEMPLATE. */
export const ISSUE_TEMPLATE = 'site-report.yml';

/** Loop guards and timeouts. */
export const LIMITS = {
  /** Accept attempts per frame per page load. */
  attemptsPerDocument: 2,
  /** Failed attempts per site and day before we stop and show "needs attention". */
  failuresPerSitePerDay: 3,
  /** Any attempts per site and day (banner re-shown on every load etc.). */
  attemptsPerSitePerDay: 20,
  /** A frame that is clicking holds the tab for at most this long. */
  claimMs: 8000,
  /** Wait for autoconsentDone after a successful optIn before verifying anyway. */
  doneTimeoutMs: 6000,
  /** Let the page settle before verifying. */
  settleMs: 1500,
  /** Max time for one frame to answer a verification request. */
  verifyTimeoutMs: 5000,
  /** How long to wait for a CMP's JavaScript API to become ready, and the polling interval. */
  apiReadyTimeoutMs: 6000,
  apiPollMs: 400,
  /** Head start of autoconsent rules over Consent-O-Matic rules for the same popup. */
  lowPriorityDelayMs: 2000,
  /** Head start of rules before the generic heuristic acts on a banner it found. */
  heuristicGraceMs: 2500,
  /** Max duration of one generic accept (incl. settings flow). */
  heuristicActMs: 20000,
  /** Entries kept in the per-tab action log. */
  logEntries: 60,
} as const;
