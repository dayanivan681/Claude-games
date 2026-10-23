import SwiftUI

@main
struct SluggerApp: App {
    var body: some Scene {
        WindowGroup {
            GameWebView()
                .ignoresSafeArea()
                .background(Color(red: 0x12 / 255, green: 0x0D / 255, blue: 0x0A / 255))
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)   // hide the home indicator while playing
                .defersSystemGestures(on: .all)      // edge swipes need a second swipe, so thumbs near the edges don't leave the game
        }
    }
}
