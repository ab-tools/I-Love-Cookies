# I Love Cookies 🍪❤️

A Chrome / Firefox extension (Manifest V3) that **answers every cookie banner with the maximum consent it offers**
("Accept all"), so websites work 100 % – videos, maps, embeds, comments, logins – without you ever clicking a banner.

Unlike "I don't care about cookies"-style extensions, it never just *hides* banners (which leaves half-broken
sites with grey overlays and locked scrolling). It gives the consent the site asks for and then **verifies** it:
via the IAB TCF API (`__tcfapi`), Google Consent Mode and the banner's visibility.

> The extension works right after installation. You can switch it off per site from the toolbar popup and
> exclude sites or address patterns in the settings.

## How it works

```
content script (every frame)            background orchestrator (per tab)
autoconsent: detect CMP + popup ──────► choose strategy per CMP (src/background/strategy.ts)
                                          ├─ rule   : declarative opt-in rule (clicks "Accept all")
                                          ├─ api    : the CMP's documented JS API (OneTrust.AllowAll(), …)
                                          └─ click  : known accept button, also inside closed shadow DOM
generic heuristic: unknown banner ────► if no rule handled it (or a rule failed):
                                          heuristic: accept all / accept / OK, else settings → all on → save
                                        verify (src/shared/verifier.ts):
                                          popup gone? TCF purposes/vendors? Consent Mode granted?
                                          → FULL / LIKELY_FULL / PARTIAL / FAILED / UNSAFE
```

- **Rules:**
  - [DuckDuckGo autoconsent](https://github.com/duckduckgo/autoconsent) (MPL-2.0): its full rule set with opt-in
    steps (generated opt-out-only and hide-only rules are dropped).
  - Our own rules in [src/rules/ilc/](src/rules/ilc/), e.g. "consent or pay" walls, where we pick the free *accept*
    option and never the subscription.
  - Site rules converted from Mozilla's [cookie-banner-rules-list](https://github.com/mozilla/cookie-banner-rules-list)
    (MPL-2.0).
  - [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) rules (MIT) for CMPs and
    sites not covered otherwise, run by our own interpreter with every consent category enabled. They act only
    when no other rule handles the popup.
- **Strategies:** the declarative rule by default; the CMP's JavaScript API (polled until the CMP is ready) as
  fallback, or as primary where it worked clearly better on real sites
  ([strategy-data.json](src/background/strategy-data.json)); a direct click on the accept button where rules fail.
- **Generic heuristic** ([src/content/heuristic/](src/content/heuristic/)) for banners no rule knows:
  - finds on-screen overlays/dialogs (also in shadow DOM) with consent wording, excluding newsletter, login,
    age-gate, region and app dialogs;
  - classifies button labels in 30 languages; reject, "necessary only", paid / subscription, login and links
    leaving the page are vetoed before anything is chosen;
  - clicks "accept all" > "accept" > "OK"; otherwise opens the settings and uses "accept all" there, or switches
    every category on (never off) and saves;
  - measured against 7,005 labelled real banner buttons: ≥ 99.5 % precision for accepting labels.
  - Rules always get a head start; a real user click inside the banner stops all automation on that page.
- **Settings:** "consent or pay" walls are accepted with the free option by default and can be left to the user
  instead. Sites can be excluded by domain (`example.com`, includes subdomains), address (`example.com/forum`),
  wildcard pattern (`*.example.*`) or regular expression (`/^news\.[a-z]+\.de\//`), see
  [src/shared/exclusions.ts](src/shared/exclusions.ts).
- **Loop guards:** one actor per tab, ≤ 2 attempts per frame and page load, daily per-site limits.
- **Rule updates:** once a day the extension downloads a rule set (`rules.json` plus its SHA-256 checksum) from this
  repository's `rules` release. It contains declarative rules and strategy choices only – no code; rules may only
  call snippets bundled with the extension ([src/shared/rule-set.ts](src/shared/rule-set.ts) validates every
  step). Invalid or older sets are ignored, and the bundled rules always remain the fallback. Can be switched off
  in the settings.
- **No data collection.** Data leaves the browser only when the user reports a problem: "Report Using GitHub"
  opens a prefilled issue form, "Report Anonymously" sends the same content to a report service that files the
  issue. A report contains the page address without parameters, the banner's structure, text and buttons (with
  their classified labels), detected consent platforms and the extension's log.

## Development

Requires Node.js ≥ 22.

```bash
npm install            # also builds the rule bundle (src/rules/generated/)
npm run dev            # Chrome with hot reload   (npm run dev:firefox for Firefox)
npm run build          # .output/chrome-mv3       (npm run build:firefox → .output/firefox-mv3)
npm run zip            # store packages           (npm run zip:firefox also creates the AMO source zip)
npm run compile        # type check
npm test               # unit tests (Vitest)
npm run lint:firefox   # AMO linter on the Firefox build
```

### Adding a rule

Add a JSON file in the [autoconsent rule format](https://github.com/duckduckgo/autoconsent/blob/main/docs/rule-syntax.md)
to [src/rules/ilc/](src/rules/ilc/) (see the README there). Rules must have `optIn` steps that click
"accept all". `eval` steps may reference our MAIN-world snippets in
[src/background/snippets.ts](src/background/snippets.ts) (all code is bundled – no remote code).

## License

[MPL-2.0](LICENSE). Includes DuckDuckGo autoconsent (MPL-2.0).
