# Validation record

Development environment: macOS, Safari 26.6.2, Xcode 26.0.1, Node.js 22.22.0.

## Automated checks

Latest verification: **32 tests passed**, `npm run check` passed, and `codesign --verify --deep --strict` accepted the development app. All ten extension resources match both the temporary-install ZIP and the embedded app extension.

- Manifest resources exist and JavaScript files parse.
- Request rules match only the intended YouTube ad paths. Ordinary player requests, watchtime statistics, external pages, and media delivery remain eligible.
- Player filtering preserves content URLs, video details, and captions; supports known wrappers and XSSI; passes malformed and frozen responses through.
- Fetch behavior preserves response status, headers where appropriate, URL metadata, and usable clones. Non-player responses, HTTP failures, native rejection, and disabled filtering pass through.
- XHR filtering handles text and JSON responses, avoids repeated filtering, and retains native invalid-state errors.
- Ordinary videos are not advanced. Explicitly marked ads use enabled visible controls or finite media. Paused, live, unknown, long, and known content sources are not sought. User volume, mute, and speed remain intact.
- Settings patches are serialized. The master switch controls request rules, invalid values are rejected, and a failed settings write rolls request rules back. Rule synchronization queries the current enabled set, changes only a ruleset whose state differs, and omits the unused enable/disable operation.
- Content-script lifecycle tests verify that disabling clears pending scans and hiding, stale startup settings cannot override newer changes, settings errors recover, navigation retains the outgoing content-source guard, and back/forward restoration resumes only when enabled.
- Native app and extension compile; embedded bundle structure and local code signature validate.

These tests use simulated page and media objects in Node. They do **not** prove successful ad blocking in Safari or on live YouTube.

## Live Safari verification

On 2026-10-05, Safari's **Allow unsigned extensions** setting was observed enabled after it had previously been off. The agent did not change that setting. QuietTube was loaded from `build/QuietTube-extension.zip` using Safari's temporary-extension loader. YouTube access was granted for one day, and a new test tab was used; the pre-existing video tab was preserved.

The signed-in test page `https://www.youtube.com/watch?v=hPoy3vdT7xA` played ordinary content normally. After a reload, the popup reported **Player filtering is active on this page**, **Responses filtered: 2**, **Skip actions: 0**, and **Ad cards hidden: 0**. This confirms that Safari loads the extension and the page-world filtering path runs. No visibly served video ad was observed, so this does not yet establish suppression against a known ad baseline.

Two Safari-specific request-rule issues were found and corrected:

- A redundant ruleset update initially produced “The number of enabled static rulesets exceeds the limit. Only 50 rulesets can be enabled at once.” Synchronization now queries `getEnabledRulesets()` and submits only a necessary enable or disable operation. Regression tests cover redundant operations, failed updates, and rollback.
- The original grouped regex subsequently produced “Failed to apply rules.” A native `WKContentRuleListStore` compilation probe rejected that expression with “Disjunctions are not supported yet,” while an anchored literal compiled. The manifest now uses six anchored `urlFilter` rules for the three YouTube hosts and two ad paths.

After rebuilding and reloading the temporary extension, the master switch turned off successfully. The popup reported **QuietTube is paused**, showed the master switch off, disabled the individual controls, and displayed no save error. A read of the extension's actual `browser.storage.local` settings confirmed `enabled: false`, with the individual feature preferences preserved.

On `https://www.youtube.com/watch?v=7GIULwETan4`, Safari's developer console showed a content-blocker rejection for a `/pagead/viewthroughconversion/` request while the extension was enabled. Ordinary content played with a duration of approximately 1,223.6 seconds. This verifies a request block at an ad endpoint; it does not establish that a pre-roll or mid-roll video ad was removed.

An attempted filtering-off baseline was excluded: the page root still reported `data-quiettube-hide-ads="true"` during that sample. Saved settings were subsequently confirmed off, but the page attribute and settings were not captured together after a fresh reload. The cause of that discrepancy is unresolved. Before comparing ads, verify the saved master state, current page status, and root attribute in the same test tab, then reload and verify them again.

Desktop automation intermittently failed with `timeoutReached`, `cgWindowNotFound`, and a screen-capture stream error. It later reconnected and showed the pre-existing lecture in fullscreen. Further UI testing was deferred to avoid interrupting it. No browser restart, force quit, or further security-setting change was performed.

After loading the extension:

| Scenario | Check | Result |
| --- | --- | --- |
| Initial page | Popup reports active player filtering; YouTube works | Passed on the signed-in test page; two filtered responses, normal content playback |
| Monetized videos | Repeated pre-rolls are suppressed or skipped; content plays | Pending |
| Mid-roll | Content resumes at the right position after a marked ad | Pending |
| Internal navigation | Navigate between videos without a reload; filter remains active | Pending |
| History | Back/forward restores the page and filter correctly | Pending |
| Player controls | Pause, seek, volume, speed, captions, fullscreen still work | Pending |
| Live stream / Shorts | Ordinary media is never advanced or interrupted | Pending |
| Ad cards | Known ad cards disappear; regular recommendations remain | Pending |
| Each feature switch | Disabled feature stops acting; reload for fresh player data | Pending |
| Request blocking | A scoped ad request is blocked; ordinary video plays | Passed for `/pagead/viewthroughconversion/` while enabled; disable behavior pending |
| Master switch | Page filtering, skipping, cosmetics, and request rules stop | Save, stored off state, and paused popup passed after correction; fresh-reload page-state check pending |
| Signed-in / signed-out | Test each session separately without conflating results | Pending |
| Privacy-enhanced embed | Granted host permission allows filtering in its frame | Pending |

For every live run, record Safari version, date, session type, popup counters, presence of actual ad markers, and any playback error. A video that happened to show no ad is not evidence that filtering worked. Capture a baseline with filtering off and compare repeated playback under the same session conditions when ads are served.

If playback fails, turn off **Filter player ad data** and reload, then isolate request blocking and the skip fallback one at a time. Keep the observed symptoms and exact conditions in this record so future fixes target a reproducible problem.
