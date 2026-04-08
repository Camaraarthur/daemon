//
//  MockRelay.swift
//  Daemon
//
//  Fake relay responses for simulator testing when my.daemon.page isn't
//  reachable. Toggled via the "Use Mock Relay (dev)" button on the
//  unpaired screen (DEBUG builds only).
//

import Foundation

enum MockRelay {
    static func seedMessages() -> [DaemonMessage] {
        [
            DaemonMessage(role: .system, content: "mock relay — no traffic leaves the device"),
            DaemonMessage(role: .assistant, content: "hi. i'm your daemon (mocked). running on your laptop in this pretend world."),
            DaemonMessage(role: .user, content: "what's on my screen?"),
            DaemonMessage(role: .assistant, content: "a terminal with 7 tabs and what looks like Xcode in the background.")
        ]
    }

    static func fakeReply(for input: String) -> String {
        let lower = input.lowercased()
        if lower.contains("where") { return "you're at home according to your laptop's wifi." }
        if lower.contains("clipboard") { return "your clipboard holds: \"a daemon is a long-running background process.\"" }
        if lower.contains("read") { return "(mock) file contents would appear here." }
        if lower.contains("remind") { return "ok. i'll remind your daemon-key to ping you about that." }
        return "(mock reply) i heard: \(input)"
    }

    /// JSON fixture matching the real POST /api/chat response shape.
    static let chatResponseFixture: String = """
    {
      "message": "hello from the mock relay",
      "threadId": "mock-thread-0001"
    }
    """
}
