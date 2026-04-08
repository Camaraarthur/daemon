//
//  DaemonActivityAttributes.swift
//  Daemon
//
//  Defines the ActivityKit attributes for "your daemon is working on X"
//  live activities shown on the lock screen and Dynamic Island.
//
//  Fixed attributes are set at activity start (e.g. which device is
//  working, which project). ContentState is mutable and drives updates.
//

import Foundation
#if canImport(ActivityKit)
import ActivityKit

struct DaemonActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// One-line status, e.g. "reading src/lib/db.ts"
        public var status: String
        /// 0...1, or nil for indeterminate
        public var progress: Double?
        /// Short tool name, e.g. "read_file", "bash"
        public var toolName: String?
        public var updatedAt: Date

        public init(status: String, progress: Double? = nil, toolName: String? = nil, updatedAt: Date = Date()) {
            self.status = status
            self.progress = progress
            self.toolName = toolName
            self.updatedAt = updatedAt
        }
    }

    /// Which device is doing the work, e.g. "arturito" or "daemon-key"
    public var deviceLabel: String
    /// Optional project context, e.g. "daemon"
    public var projectName: String?
    /// Thread id the activity is tied to
    public var threadId: String

    public init(deviceLabel: String, projectName: String? = nil, threadId: String) {
        self.deviceLabel = deviceLabel
        self.projectName = projectName
        self.threadId = threadId
    }
}

// MARK: - Controller

/// Tiny helper for starting / updating / ending the live activity.
@available(iOS 16.1, *)
enum DaemonLiveActivity {
    @discardableResult
    static func start(device: String, project: String?, threadId: String, initial: String) -> Activity<DaemonActivityAttributes>? {
        let attrs = DaemonActivityAttributes(deviceLabel: device, projectName: project, threadId: threadId)
        let state = DaemonActivityAttributes.ContentState(status: initial)
        do {
            let activity = try Activity.request(
                attributes: attrs,
                content: .init(state: state, staleDate: nil)
            )
            return activity
        } catch {
            print("[Daemon] live activity start failed: \(error)")
            return nil
        }
    }

    static func update(_ activity: Activity<DaemonActivityAttributes>, status: String, progress: Double? = nil, toolName: String? = nil) async {
        let state = DaemonActivityAttributes.ContentState(status: status, progress: progress, toolName: toolName)
        await activity.update(.init(state: state, staleDate: nil))
    }

    static func end(_ activity: Activity<DaemonActivityAttributes>, finalStatus: String) async {
        let state = DaemonActivityAttributes.ContentState(status: finalStatus)
        await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .default)
    }
}
#endif
