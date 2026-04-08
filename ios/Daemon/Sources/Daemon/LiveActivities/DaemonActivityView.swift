//
//  DaemonActivityView.swift
//  Daemon
//
//  Lock screen + Dynamic Island presentation for the live activity.
//  Requires a WidgetBundle entry point — we include a minimal one here.
//
//  Note: WidgetKit + ActivityKit require the app to have a Widget
//  Extension target if you want updates delivered by the system widget
//  process. For v0.1 we declare the widget inline on the main target,
//  which works for the Dynamic Island and lock screen.
//

import SwiftUI
#if canImport(ActivityKit) && canImport(WidgetKit)
import ActivityKit
import WidgetKit

@available(iOS 16.2, *)
struct DaemonActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DaemonActivityAttributes.self) { context in
            // Lock screen banner
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: "sparkles")
                    Text("Daemon on \(context.attributes.deviceLabel)")
                        .font(.caption).bold()
                    Spacer()
                    if let project = context.attributes.projectName {
                        Text(project).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Text(context.state.status)
                    .font(.body)
                    .lineLimit(2)
                if let progress = context.state.progress {
                    ProgressView(value: progress)
                }
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.85))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "sparkles")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.deviceLabel).font(.caption2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.status).lineLimit(2)
                }
            } compactLeading: {
                Image(systemName: "sparkles")
            } compactTrailing: {
                Text(context.state.toolName ?? "…").font(.caption2)
            } minimal: {
                Image(systemName: "sparkles")
            }
        }
    }
}
#endif
