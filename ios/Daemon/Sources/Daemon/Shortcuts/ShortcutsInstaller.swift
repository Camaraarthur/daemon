//
//  ShortcutsInstaller.swift
//  Daemon
//
//  First-run installer for the bundled shortcuts library. Reads the
//  six .shortcut JSON templates out of the app bundle's Resources and
//  hands them to INVoiceShortcutCenter so they show up in Siri's
//  suggestions.
//
//  For users who open the Shortcuts app directly, the intents declared
//  in DaemonAppShortcuts already auto-appear — this installer is a belt
//  on top of the suspenders, so Siri learns the phrases even if the
//  user never opens Shortcuts.
//

import Foundation
import IntentsUI
import Intents

enum ShortcutsInstaller {
    private static let installedKey = "daemon.shortcuts.installed.v1"

    static func installIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: installedKey) else { return }
        defaults.set(true, forKey: installedKey)

        INVoiceShortcutCenter.shared.getAllVoiceShortcuts { existing, _ in
            let existingPhrases = Set((existing ?? []).map { $0.invocationPhrase })
            for template in bundledTemplates() {
                guard !existingPhrases.contains(template.phrase) else { continue }
                donate(template)
            }
        }
    }

    // MARK: - Donations

    private static func donate(_ template: ShortcutTemplate) {
        // Donation via NSUserActivity — Siri learns the phrase and the
        // system suggests the shortcut.
        let activity = NSUserActivity(activityType: template.activityType)
        activity.title = template.title
        activity.suggestedInvocationPhrase = template.phrase
        activity.isEligibleForPrediction = true
        activity.isEligibleForSearch = true
        activity.persistentIdentifier = NSUserActivityPersistentIdentifier(template.activityType)
        activity.becomeCurrent()
    }

    // MARK: - Templates

    struct ShortcutTemplate {
        let title: String
        let phrase: String
        let activityType: String
    }

    /// Reads shortcut JSON templates bundled under Resources/Shortcuts/*.json.
    /// Falls back to a hardcoded list if the bundle can't be read.
    private static func bundledTemplates() -> [ShortcutTemplate] {
        if let url = Bundle.main.url(forResource: "shortcuts", withExtension: "json", subdirectory: "Shortcuts"),
           let data = try? Data(contentsOf: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [[String: String]] {
            return json.compactMap {
                guard let t = $0["title"], let p = $0["phrase"], let a = $0["activityType"] else { return nil }
                return ShortcutTemplate(title: t, phrase: p, activityType: a)
            }
        }
        return [
            .init(title: "Ask Daemon", phrase: "Ask daemon", activityType: "page.daemon.ChatWithDaemonIntent"),
            .init(title: "Read File", phrase: "Read file with daemon", activityType: "page.daemon.ReadFileIntent"),
            .init(title: "Write File", phrase: "Write file with daemon", activityType: "page.daemon.WriteFileIntent"),
            .init(title: "Remind Me", phrase: "Daemon remind me", activityType: "page.daemon.RemindMeIntent"),
            .init(title: "Where Am I", phrase: "Daemon where am I", activityType: "page.daemon.WhereAmIIntent"),
            .init(title: "Clipboard to Daemon", phrase: "Send clipboard to daemon", activityType: "page.daemon.ClipboardToDaemonIntent"),
        ]
    }
}
