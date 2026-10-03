# I Love Cookies 🍪❤️

A Chrome / Firefox extension (Manifest V3) that **answers every cookie banner with the maximum consent it offers**
("Accept all"), so websites work 100 % – videos, maps, embeds, comments, logins – without you ever clicking a banner.

Unlike "I don't care about cookies"-style extensions, it never just *hides* banners (which leaves half-broken
sites with grey overlays and locked scrolling). It gives the consent the site asks for and then **verifies** it:
via the IAB TCF API (`__tcfapi`), Google Consent Mode and the banner's visibility.

> The extension stays inactive until you confirm the onboarding page, which explains what is accepted on your
> behalf. You can pause it per site and withdraw consent for a site at any time from the toolbar popup.

## How it works

```
content script (every frame)            background orchestrator (per tab)
autoconsent: detect CMP + popup ──────► choose strategy per CMP (src/background/strategy.ts)
                                          ├─ rule   : autoconsent declarative opt-in (clicks "Accept all")
                                          ├─ api    : the CMP's documented JS API (OneTrust.AllowAll(), …)
                                          └─ shadow : click inside (closed) shadow DOM
                                        verify (src/shared/verifier.ts):
                                          popup gone? TCF purposes/vendors? Consent Mode granted?
                                          → FULL / LIKELY_FULL / PARTIAL / FAILED / UNSAFE
```

- **Rules:** [DuckDuckGo autoconsent](https://github.com/duckduckgo/autoconsent) (MPL-2.0) – its full rule set
  with opt-in steps (generated opt-out-only and hide-only rules are dropped) – plus our own rules in
  [src/rules/ilc/](src/rules/ilc/), e.g. "consent or pay" walls, where we pick the free *accept* option and never
  the subscription.
- **Loop guards:** one actor per tab, ≤ 2 attempts per frame and page load, daily per-site limits.
- **No data collection.** Problem reports are GitHub issues the user opens and submits.

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
