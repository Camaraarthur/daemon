//
//  RemindMeIntent.swift
//  Daemon
//

import AppIntents

struct RemindMeIntent: AppIntent {
    static var title: LocalizedStringResource = "Remind Me"
    static var description = IntentDescription("Ask your daemon to remind you about something later.")

    @Parameter(title: "Note", requestValueDialog: "What should your daemon remind you about?")
    var note: String

    static var parameterSummary: some ParameterSummary {
        Summary("Remind me to \(\.$note)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let prompt = "Remind me later to: \(note)"
        await DaemonClient.shared.sendMessage(prompt)
        return .result(dialog: "Got it — your daemon will remind you to \(note).")
    }
}
