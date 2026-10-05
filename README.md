# QuietTube for macOS Safari

A development prototype of a YouTube ad blocker, with a toolbar popup and a locally signed macOS app. Safari has loaded the extension, run the player-response hooks, blocked a YouTube ad endpoint, and played ordinary content successfully. **Suppression of a visibly served video ad is not yet verified.** The master switch now saves successfully in Safari; page-state verification after a fresh disabled reload remains pending.

## What it does

- Removes known ad fields from the initial YouTube player response and JSON responses from `/youtubei/v1/player` (fetch and XHR).
- Clicks visible, enabled ad-skip controls, or seeks finite ad media to its end while the player has an explicit ad class.
- Hides known sponsored ad-card renderers and ad overlays.
- Blocks only YouTube `/pagead/` and `/api/stats/ads` requests. It does not blanket-block video delivery from `googlevideo.com`.
- Provides a master switch and independent controls for each layer, with counters for the current page.

All code and settings run locally. There are no analytics, remote scripts, browsing-history storage, external service calls, or native messaging. Permissions are limited to the listed YouTube hosts, local settings, declarative request blocking, and the active tab.

## Try it in Safari

Use Safari 18.4 or later on macOS for temporary folder installation. The development machine has Safari 26.6.2. This is a development build, not an App Store release.

1. In Safari > Settings > Advanced, enable **Show features for web developers** if needed.
2. Open Settings > Developer. To use this local prototype, enable **Allow unsigned extensions** and complete Safari's authentication prompt yourself.
3. Click **Add Temporary Extension…** and select this repository's `extension` folder, or `build/QuietTube-extension.zip`.
4. In Extensions settings, enable QuietTube and allow access to `youtube.com`. For privacy-enhanced embeds, separately allow `youtube-nocookie.com` when needed.
5. Open a new YouTube tab or reload an existing one. Open QuietTube's toolbar popup. Verify **Player filtering is active on this page**; inspect the counters while watching.

Temporary extensions disappear when Safari quits or after 24 hours. To test the app wrapper instead, build it using the commands below and open `build/DerivedData/Build/Products/Debug/QuietTube.app`. Its button opens Safari's Extensions settings. The locally signed app still needs Safari's unsigned-extension development setting.

When changing player filtering, reload YouTube. Data already removed from a player response cannot be restored by toggling a checkbox; reloading requests a fresh response. The master switch immediately stops future page filtering and skipping, removes cosmetic hiding, and disables the request rules.

## Develop and build

Requires Node.js 20+; the native wrapper also requires macOS and Xcode. There are no npm dependencies to install.

```sh
npm run check
npm test
npm run build:safari
```

`npm run package:safari` generates a minimal Xcode project at `build/safari/QuietTube/QuietTube.xcodeproj`. The project links the extension source directly. `npm run build:safari` generates that project, compiles the Swift companion app and extension, and signs them to run locally. It never requires a paid developer account for this development build. App Store distribution would need a real bundle identifier, Apple signing, icons, and release review.

Apple's extension packager could not access the source folder under this development environment's sandbox. The repository therefore includes its own small Xcode-project generator; the generated wrapper built successfully with Xcode 26.0.1.

## Source layout

| File | Purpose |
| --- | --- |
| `extension/core.js` | Shared settings, player-response filter, guarded ad skipping |
| `extension/page.js` | Page-world initial-response, fetch, and XHR hooks |
| `extension/content.js` | Isolated extension settings, DOM handling, lifecycle, diagnostics |
| `extension/background.js` | Serialized settings writes and request-rule synchronization |
| `extension/popup.*` | Toolbar controls and current-page counters |
| `extension/rules/youtube-ads.json` | Six narrow declarative request rules |
| `native/` | Minimal Swift macOS app and Safari extension wrapper |
| `tests/` | Behavioral tests for media guards, responses, and settings |

## Current limits

YouTube can change its player schema, selectors, delivery methods, and ad-block detection. This prototype does not promise complete suppression or bypass playback-blocking interstitials. It does not cover the native YouTube app, YouTube TV, or ads stitched directly into ordinary video media.

Page hooks wait for the extension's saved settings before filtering. An early initial response may be consumed before settings arrive; the marked-ad skipping layer is the fallback. Page-world hooks can be detected or modified by the webpage. A browser that ignores page-world injection should report an unavailable player filter in the popup.

The fallback avoids paused, live, uninitialized, and over-five-minute media and remembers the normal source to avoid seeking it during a mid-roll transition. It never changes mute, volume, or playback speed. Its fallback relies on YouTube's ad classes and source transitions being accurate. In-page counters report filtered responses, skip actions, and seen hidden ad cards; they are not a count of independently verified ads blocked. Popup counters cover the top frame only.

See [validation notes](docs/VALIDATION.md) for what has been checked and the live test procedure.

## Platform references

- [Apple: Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Apple: Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
- [Apple: Blocking content with your Safari web extension](https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension)
- [MDN: content script execution worlds](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)
