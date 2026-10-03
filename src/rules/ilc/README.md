# I Love Cookies – own rules

JSON files in this folder are merged into the shipped rule bundle by `scripts/build-rules.mjs`
(after DuckDuckGo autoconsent's rules; a rule with the same `name` overrides the upstream one).

Format: the [autoconsent rule format](https://github.com/duckduckgo/autoconsent/blob/main/docs/rule-syntax.md).
Every rule **must** have non-empty `optIn` steps that click the "accept all" button.
Cosmetic (hide-only) rules are rejected – we answer banners, we never just hide them.

If a fix applies to a rule that exists upstream, prefer contributing it to autoconsent.

`mozilla.json` is converted from Mozilla's cookie-banner-rules-list – do not edit it by hand.
