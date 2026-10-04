# Privacy policy – I Love Cookies

I Love Cookies answers cookie consent banners on the websites you visit by accepting all cookies.
It does not collect data in normal use; data is only sent when you report a problem yourself.

## What the extension does on your device

- **Reads web pages** you open to find cookie consent banners and click their "accept all" option, or call the
  consent platform's own "accept all" function.
- **Stores settings** ("consent or pay" behaviour, age checks, excluded sites, rule updates, debug logging) in
  your browser's extension storage, synced by your browser if you use browser sync.
- **Keeps a short action log per tab** (detected consent platform, what was clicked, the result) in the browser's
  session storage. It is deleted when the tab or browser is closed.
- **Counts attempts per website and day** locally, to avoid click loops.
- **Counts the banners it answered** (a single number and the date counting started), shown in the popup as
  the time saved. Kept only in your browser.
- **Remembers websites whose cookie dialog needs a real mouse click** (Chrome, Edge), so it can answer them that
  way right away next time. Only the website's domain is kept, only in your browser.
- **Downloads rule updates** once a day from the project's GitHub releases (a static JSON file; the request
  contains no personal data). Can be switched off in the settings.

Consent you give through the extension is stored by each website, like a consent you click yourself. Switch the
extension off for a site in the toolbar popup, or exclude sites in the settings.

## What the extension does not do

- No analytics, no telemetry, no tracking, no account.
- Data leaves your browser only when you report a problem, and only what that report needs: the page address
  without query string, what you chose under "What's the problem?" and the note you typed (if any), the cookie
  banner's structure, text and buttons, the detected consent platform, the extension's log and relevant
  settings, browser and extension version. "Report Using GitHub" opens a pre-filled GitHub issue form that
  you submit yourself. "Report Anonymously" sends the report to our report service (api.i-love-cookies.com), which
  publishes it as a GitHub issue without any account; your IP address is only used for rate limiting
  (kept as a salted hash for one minute).

## Permissions

| Permission | Why |
|---|---|
| Access to all websites | Cookie banners appear on any website and inside embedded frames. |
| `scripting` | Runs consent platforms' own "accept all" functions in the page. |
| `storage` | Settings, per-tab status, daily attempt counters, the answered-banner counter. |
| `webNavigation` | Knows when a page (or a frame) loads to reset the status and find consent frames. |
| `alarms` | Schedules the daily rule update check. |
| `debugger` (Chrome, Edge) | Sends a real mouse click to a cookie dialog that ignores the extension's normal clicks. Attached to the tab only for that moment; nothing is read or recorded. |

## Contact

Questions: open an issue in the project's GitHub repository.
