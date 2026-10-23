# Slugger for iOS

A native iOS app around the web game in [`../slugger`](../slugger). Both versions share one codebase: the build copies the web folder into the app, so every web change ships to iOS on the next build.

What the app adds over the web version:
- Full screen in landscape, with the status bar and home indicator hidden.
- Edge swipes need a second swipe, so thumbs near the screen edge don't leave the game.
- Native haptics through the `haptic` bridge (`light`, `medium` and `heavy`).
- Works offline, and the save stays in the app.

## Build and run on your iPhone

You need a Mac with Xcode and a free Apple ID.

1. Install XcodeGen: `brew install xcodegen`.
2. Generate the project: `cd slugger-ios && xcodegen`.
3. Open it: `open Slugger.xcodeproj`.
4. Set up signing. Go to the Slugger target, then **Signing & Capabilities**, then **Team**, and pick your Apple ID. If Xcode says the bundle ID is taken, change `com.dayan.slugger`.
5. Plug in the iPhone, select it as the run destination and press **Run**.
6. Trust the developer on the iPhone, the first time only. Open **Settings → General → VPN & Device Management** and trust your Apple ID. The iPhone may also ask you to turn on **Developer Mode** under **Settings → Privacy & Security**.

With a free Apple ID the app stops opening after 7 days. Press Run again to renew it. A paid developer account lasts a year and allows TestFlight.

Run `xcodegen` again only when `project.yml` changes. Changes to the game in `../slugger` only need a new build.
