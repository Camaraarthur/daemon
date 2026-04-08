//
//  WriteFileIntent.swift
//  Daemon
//

import AppIntents

struct WriteFileIntent: AppIntent {
    static var title: LocalizedStringResource = "Write File"
    static var description = IntentDescription("Ask your daemon to write text to a file on your other device.")

    @Parameter(title: "Path", requestValueDialog: "Where should your daemon save this?")
    var path: String

    @Parameter(title: "Contents", requestValueDialog: "What should the file contain?")
    var contents: String

    static var parameterSummary: some ParameterSummary {
        Summary("Write \(\.$contents) to \(\.$path)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let prompt = "Write the following to \(path):\n\n\(contents)"
        await DaemonClient.shared.sendMessage(prompt)
        return .result(dialog: "Told your daemon to write \(path).")
    }
}
