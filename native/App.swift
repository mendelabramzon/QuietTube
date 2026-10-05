import SafariServices
import SwiftUI

@main
struct QuietTubeApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 18) {
                Image(systemName: "play.rectangle.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(.green)
                Text("QuietTube").font(.largeTitle.bold())
                Text("YouTube ad filtering for macOS Safari")
                Text("Enable QuietTube in Safari’s Extensions settings, allow access to youtube.com, then reload YouTube. Use the toolbar button to control each filter.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Button("Open Safari Extensions Settings") {
                    SFSafariApplication.showPreferencesForExtension(withIdentifier: "dev.local.quiettube.Extension") { error in
                        if let error { print("Unable to open Safari settings: \(error.localizedDescription)") }
                    }
                }
                .buttonStyle(.borderedProminent)
                Text("Development build · No analytics")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(36)
            .frame(width: 440, height: 330)
        }
        .windowResizability(.contentSize)
    }
}
