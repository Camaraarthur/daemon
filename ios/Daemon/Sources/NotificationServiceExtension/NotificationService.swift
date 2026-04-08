//
//  NotificationService.swift
//  NotificationServiceExtension
//
//  Rich push delivery. Runs in a separate process from the main app when
//  a notification arrives. Has ~30s to mutate the notification content
//  (attach images, localize, add action buttons) before iOS posts it.
//
//  The relay sends pushes shaped like:
//    {
//      "aps": { "alert": { "title": "...", "body": "..." }, "mutable-content": 1 },
//      "category": "daemon.reply" | "daemon.status" | ...,
//      "thread_id": "...",
//      "image_url": "https://..." (optional)
//    }
//

import UserNotifications
import UIKit

final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        self.bestAttempt = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let content = bestAttempt else {
            contentHandler(request.content)
            return
        }

        // Attach category-based actions.
        if let category = request.content.userInfo["category"] as? String {
            content.categoryIdentifier = category
            Self.registerCategoriesIfNeeded()
        }

        // Attach image (optional).
        if let urlString = request.content.userInfo["image_url"] as? String,
           let url = URL(string: urlString) {
            downloadImage(from: url) { attachment in
                if let attachment { content.attachments = [attachment] }
                contentHandler(content)
            }
            return
        }

        contentHandler(content)
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler, let bestAttempt {
            contentHandler(bestAttempt)
        }
    }

    // MARK: - Helpers

    private func downloadImage(from url: URL, completion: @escaping (UNNotificationAttachment?) -> Void) {
        let task = URLSession.shared.downloadTask(with: url) { local, _, _ in
            guard let local else { completion(nil); return }
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
            try? FileManager.default.moveItem(at: local, to: tmp)
            let attachment = try? UNNotificationAttachment(identifier: "image", url: tmp, options: nil)
            completion(attachment)
        }
        task.resume()
    }

    private static var categoriesRegistered = false
    private static func registerCategoriesIfNeeded() {
        guard !categoriesRegistered else { return }
        categoriesRegistered = true

        let reply = UNNotificationAction(identifier: "daemon.reply.respond", title: "Reply", options: [.foreground])
        let dismiss = UNNotificationAction(identifier: "daemon.reply.dismiss", title: "Dismiss", options: [])
        let replyCategory = UNNotificationCategory(
            identifier: "daemon.reply",
            actions: [reply, dismiss],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        let resume = UNNotificationAction(identifier: "daemon.status.resume", title: "Open", options: [.foreground])
        let stop = UNNotificationAction(identifier: "daemon.status.stop", title: "Stop", options: [.destructive])
        let statusCategory = UNNotificationCategory(
            identifier: "daemon.status",
            actions: [resume, stop],
            intentIdentifiers: [],
            options: []
        )

        UNUserNotificationCenter.current().setNotificationCategories([replyCategory, statusCategory])
    }
}
