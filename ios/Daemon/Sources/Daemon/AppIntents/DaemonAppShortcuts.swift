//
//  DaemonAppShortcuts.swift
//  Daemon
//
//  Registers the six intents with Siri / Shortcuts / Spotlight.
//  AppShortcutsProvider is how you ship pre-baked shortcuts — they
//  appear automatically in the Shortcuts app once the user installs
//  the parent app.
//

import AppIntents

struct DaemonAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ChatWithDaemonIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Tell my \(.applicationName) \(\.$message)",
                "\(.applicationName) \(\.$message)"
            ],
            shortTitle: "Ask Daemon",
            systemImageName: "bubble.left.and.bubble.right"
        )
        AppShortcut(
            intent: ReadFileIntent(),
            phrases: [
                "Read \(\.$path) with \(.applicationName)",
                "\(.applicationName) read \(\.$path)"
            ],
            shortTitle: "Read File",
            systemImageName: "doc.text"
        )
        AppShortcut(
            intent: WriteFileIntent(),
            phrases: [
                "Write to \(\.$path) with \(.applicationName)"
            ],
            shortTitle: "Write File",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: RemindMeIntent(),
            phrases: [
                "Remind me to \(\.$note) with \(.applicationName)",
                "\(.applicationName) remind me to \(\.$note)"
            ],
            shortTitle: "Remind Me",
            systemImageName: "bell"
        )
        AppShortcut(
            intent: WhereAmIIntent(),
            phrases: [
                "Tell \(.applicationName) where I am",
                "\(.applicationName) where am I"
            ],
            shortTitle: "Where Am I",
            systemImageName: "location"
        )
        AppShortcut(
            intent: ClipboardToDaemonIntent(),
            phrases: [
                "Send clipboard to \(.applicationName)",
                "\(.applicationName) take this"
            ],
            shortTitle: "Clipboard to Daemon",
            systemImageName: "doc.on.clipboard"
        )
    }
}
