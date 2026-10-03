/** Permanent Firefox add-on ID – must never change once published on AMO. */
export const GECKO_ID = 'extension@i-love-cookies.com';

/** Project website ("More Info" link). */
export const WEBSITE_URL = 'https://www.i-love-cookies.com';

/** GitHub repository: receives "Report a problem" issues and publishes rule updates. */
export const REPO_URL = 'https://github.com/ab-tools/I-Love-Cookies';

/** Service that files anonymous problem reports as issues in REPO_URL. */
export const REPORT_API_URL = 'https://api.i-love-cookies.com/report.php';

/** Published rule updates (declarative rules only) and their SHA-256 checksum (same URL + ".sha256"). */
export const RULE_UPDATE_URL = `${REPO_URL}/releases/download/rules/rules.json`;

/** Name of the issue form in .github/ISSUE_TEMPLATE. */
export const ISSUE_TEMPLATE = 'site-report.yml';

/** Loop guards and timeouts. */
export const LIMITS = {
  /** Accept attempts per frame per page load. */
  attemptsPerDocument: 2,
  /** Failed attempts per site and day before we stop and show "needs attention". */
  failuresPerSitePerDay: 3,
  /** Any attempts per site and day (banner re-shown on every load etc.). */
  attemptsPerSitePerDay: 100,
  /** A frame that is clicking holds the tab for at most this long. */
  claimMs: 8000,
  /** Wait for autoconsentDone after a successful optIn before verifying anyway. */
  doneTimeoutMs: 6000,
  /** Wait after a failed rule before falling back (rules coordinating with an iframe wait doneTimeoutMs). */
  ruleFailedGraceMs: 1000,
  /** A leftover banner overturns an unconfirmed success only with strong consent wording (two strong words). */
  leftoverBannerMinScore: 4,
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
  /** A consent iframe must cover at least this share of the viewport for the heuristic to act in it. */
  minFrameOverlayArea: 0.05,
  /** Max duration of one generic accept (incl. settings flow). */
  heuristicActMs: 20000,
  /** Entries kept in the per-tab action log. */
  logEntries: 60,
  /** Rule update check interval and maximum download size. */
  ruleUpdateHours: 24,
  ruleSetMaxBytes: 2_000_000,
  /** Max time for one frame to answer a report snapshot request. */
  snapshotTimeoutMs: 3000,
} as const;
