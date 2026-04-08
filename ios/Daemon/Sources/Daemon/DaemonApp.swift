//
//  DaemonApp.swift
//  Daemon
//
//  App entry point. Wires up the root scene, the APNs registration, the
//  Live Activity bootstrap, and triggers the first-run Shortcuts install.
//
//  The iPhone is a FACE for daemon — not a daemon. The brain runs on the
//  user's other devices (laptop, daemon-key Pi, server). This app is a
//  thin client to https://my.daemon.page.
//

import SwiftUI
import UserNotifications
#if canImport(ActivityKit)
import ActivityKit
#endif

@main
struct DaemonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var client = DaemonClient.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(client)
                .task {
                    await requestNotificationPermission()
                    ShortcutsInstaller.installIfNeeded()
                }
        }
    }

    private func requestNotificationPermission() async {
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])
            if granted {
                await MainActor.run {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        } catch {
            print("[Daemon] notification permission error: \(error)")
        }
    }
}

// MARK: - AppDelegate

/// Handles APNs device token registration and silent-push delivery.
///
/// On receiving a silent push (`content-available: 1`), iOS grants the
/// app roughly 30 seconds of background execution. We use that window
/// to drain pending messages from the relay.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let tokenString = deviceToken.map { String(format: "%02x", $0) }.joined()
        print("[Daemon] APNs token: \(tokenString)")
        Task { await DaemonClient.shared.registerApnsToken(tokenString) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[Daemon] APNs registration failed: \(error)")
    }

    /// Silent-push delivery. 30s budget.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        Task {
            let result = await DaemonClient.shared.drainPendingEvents(userInfo: userInfo)
            completionHandler(result ? .newData : .noData)
        }
    }
}

// MARK: - NotificationDelegate

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Handle action buttons from the Notification Service Extension here.
        let actionId = response.actionIdentifier
        print("[Daemon] notification action: \(actionId)")
        completionHandler()
    }
}
