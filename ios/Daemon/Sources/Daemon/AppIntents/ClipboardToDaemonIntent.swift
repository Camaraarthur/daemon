//
//  ClipboardToDaemonIntent.swift
//  Daemon
//

import AppIntents
import UIKit

struct ClipboardToDaemonIntent: AppIntent {
    static var title: LocalizedStringResource = "Clipboard to Daemon"
    static var description = IntentDescription("Send the contents of your clipboard to your daemon.")

    static var parameterSummary: some ParameterSummary { Summary("Send clipboard to my daemon") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let pasteboard = UIPasteboard.general.string ?? ""
        guard !pasteboard.isEmpty else {
            return .result(dialog: "Your clipboard is empty.")
        }
        let prompt = "Here's what's on my clipboard:\n\n\(pasteboard)"
        await DaemonClient.shared.sendMessage(prompt)
        return .result(dialog: "Sent \(pasteboard.count) characters to your daemon.")
    }
}
