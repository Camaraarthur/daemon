//
//  ChatWithDaemonIntent.swift
//  Daemon
//
//  The headline intent. Sends a message to the user's daemon and reads
//  back the reply. Exposed to Siri / Shortcuts / Spotlight / Action
//  Button.
//

import AppIntents

struct ChatWithDaemonIntent: AppIntent {
    static var title: LocalizedStringResource = "Chat with Daemon"
    static var description = IntentDescription("Send a message to your daemon and hear the reply.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Message", requestValueDialog: "What do you want to tell your daemon?")
    var message: String

    static var parameterSummary: some ParameterSummary {
        Summary("Tell my daemon \(\.$message)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let client = DaemonClient.shared
        guard client.isPaired else {
            return .result(value: "", dialog: "Your daemon isn't paired yet. Open the app to scan the QR code.")
        }
        await client.sendMessage(message)
        let reply = client.messages.last(where: { $0.role == .assistant })?.content
            ?? "Your daemon heard you but hasn't replied yet."
        return .result(value: reply, dialog: IntentDialog(stringLiteral: reply))
    }
}
