//
//  ReadFileIntent.swift
//  Daemon
//
//  Asks the user's agent-home device to read a file and return its
//  contents. The relay dispatches the tool call to the primary device;
//  iOS itself does not read the filesystem.
//

import AppIntents

struct ReadFileIntent: AppIntent {
    static var title: LocalizedStringResource = "Read File"
    static var description = IntentDescription("Ask your daemon to read a file on your other device.")

    @Parameter(title: "Path", requestValueDialog: "Which file should your daemon read?")
    var path: String

    static var parameterSummary: some ParameterSummary {
        Summary("Read \(\.$path) from my daemon")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let prompt = "Read the file at \(path) and show me the contents."
        await DaemonClient.shared.sendMessage(prompt)
        let reply = DaemonClient.shared.messages.last(where: { $0.role == .assistant })?.content
            ?? "(no reply yet)"
        return .result(value: reply, dialog: IntentDialog(stringLiteral: reply))
    }
}
