//
//  DaemonClient.swift
//  Daemon
//
//  HTTP + WSS client for the daemon relay at my.daemon.page. Handles:
//  - Pairing (POST /api/pair, action: "claim") — token stored in Keychain
//  - Chat (POST /api/chat)
//  - WS subscription (wss://my.daemon.page/ws/client) — best-effort only,
//    because iOS cannot hold a background WebSocket. All durable sync is
//    via APNs silent push triggering `drainPendingEvents`.
//  - Mock mode for simulator testing when the relay isn't reachable.
//
//  Relay endpoints (see /home/arthur/daemon/web/src/app/api/pair/route.ts
//  and /home/arthur/daemon/web/src/app/api/chat/route.ts for the source
//  of truth).
//

import Foundation
import Security
import Combine
import UIKit

// MARK: - Models

enum MessageRole: String, Codable { case user, assistant, system }

struct DaemonMessage: Identifiable, Codable, Equatable {
    let id: String
    let role: MessageRole
    let content: String
    let createdAt: Date

    init(id: String = UUID().uuidString, role: MessageRole, content: String, createdAt: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
    }
}

struct PairClaimResponse: Codable {
    let device_token: String
    let ws_url: String
}

struct ChatResponse: Codable {
    let message: String?
    let threadId: String?
    let error: String?
}

// MARK: - DaemonClient

@MainActor
final class DaemonClient: ObservableObject {
    static let shared = DaemonClient()

    @Published private(set) var isPaired: Bool = false
    @Published private(set) var messages: [DaemonMessage] = []
    @Published private(set) var currentThreadId: String? = nil
    @Published private(set) var isMocked: Bool = false

    private let baseURL = URL(string: "https://my.daemon.page")!
    private let keychain = Keychain(service: "page.daemon.ios")
    private let deviceId: String
    private var wsTask: URLSessionWebSocketTask?
    private let session: URLSession = .shared

    private init() {
        // Stable per-install device identifier. Persisted in Keychain so
        // a reinstall doesn't confuse the relay's device registry.
        if let existing = Keychain(service: "page.daemon.ios").read(key: "device_id") {
            self.deviceId = existing
        } else {
            let id = "ios-" + UUID().uuidString.lowercased()
            Keychain(service: "page.daemon.ios").write(key: "device_id", value: id)
            self.deviceId = id
        }
        self.isPaired = (keychain.read(key: "device_token") != nil)
    }

    // MARK: - Pairing

    /// Claim a pairing code from my.daemon.page. Stores the returned
    /// device_token in the Keychain.
    func pair(withCode code: String) async {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        // Accept either a raw 6-char code or a URL of the form
        //   https://my.daemon.page/pair?code=ABC123
        let extractedCode: String = {
            if let url = URL(string: code), let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
               let item = comps.queryItems?.first(where: { $0.name == "code" })?.value {
                return item.uppercased()
            }
            return trimmed
        }()

        struct Body: Codable {
            let action: String
            let code: String
            let device_id: String
            let device_name: String
            let platform: String
        }
        let body = Body(
            action: "claim",
            code: extractedCode,
            device_id: deviceId,
            device_name: UIDevice.current.name,
            platform: "ios"
        )

        do {
            let (data, response) = try await postJSON(path: "/api/pair", body: body, authed: false)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                print("[Daemon] pair failed: HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                return
            }
            let decoded = try JSONDecoder().decode(PairClaimResponse.self, from: data)
            keychain.write(key: "device_token", value: decoded.device_token)
            keychain.write(key: "ws_url", value: decoded.ws_url)
            self.isPaired = true
            await connectWebSocket()
        } catch {
            print("[Daemon] pair error: \(error)")
        }
    }

    func unpair() {
        keychain.delete(key: "device_token")
        keychain.delete(key: "ws_url")
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil
        messages = []
        currentThreadId = nil
        isPaired = false
    }

    // MARK: - Chat

    /// POST /api/chat. Appends an optimistic user message, then the
    /// assistant's reply when it arrives.
    func sendMessage(_ text: String) async {
        let userMsg = DaemonMessage(role: .user, content: text)
        messages.append(userMsg)

        if isMocked {
            await mockAssistantReply(to: text)
            return
        }

        struct Body: Codable {
            let message: String
            let threadId: String?
            let stream: Bool
        }
        let body = Body(message: text, threadId: currentThreadId, stream: false)

        do {
            let (data, response) = try await postJSON(path: "/api/chat", body: body, authed: true)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                appendSystemError("HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                return
            }
            let decoded = try JSONDecoder().decode(ChatResponse.self, from: data)
            if let tid = decoded.threadId { currentThreadId = tid }
            if let reply = decoded.message {
                messages.append(DaemonMessage(role: .assistant, content: reply))
            } else if let err = decoded.error {
                appendSystemError(err)
            }
        } catch {
            appendSystemError(error.localizedDescription)
        }
    }

    /// Fetch latest thread state. Called on refresh and after silent push.
    func refreshThread() async {
        if isMocked { return }
        // Stub: once the relay exposes GET /api/chat/thread/{id}, wire it.
        print("[Daemon] refreshThread: not yet implemented — waiting for relay endpoint")
    }

    // MARK: - APNs

    func registerApnsToken(_ token: String) async {
        guard isPaired, !isMocked else { return }
        struct Body: Codable { let device_id: String; let apns_token: String }
        let body = Body(device_id: deviceId, apns_token: token)
        do {
            _ = try await postJSON(path: "/api/devices/apns", body: body, authed: true)
        } catch {
            print("[Daemon] registerApnsToken error: \(error)")
        }
    }

    /// Called from the silent-push handler. 30s budget.
    /// Returns true if new data was fetched.
    func drainPendingEvents(userInfo: [AnyHashable: Any]) async -> Bool {
        print("[Daemon] drainPendingEvents: \(userInfo)")
        await refreshThread()
        return true
    }

    // MARK: - WebSocket (best-effort foreground)

    func connectWebSocket() async {
        guard let urlStr = keychain.read(key: "ws_url"),
              let wsURL = URL(string: urlStr),
              let token = keychain.read(key: "device_token") else {
            return
        }
        var req = URLRequest(url: wsURL)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        wsTask = session.webSocketTask(with: req)
        wsTask?.resume()
        listenWebSocket()
    }

    private func listenWebSocket() {
        wsTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                Task { @MainActor in self.handleWsMessage(message) }
                self.listenWebSocket()
            case .failure(let error):
                print("[Daemon] ws receive error: \(error)")
            }
        }
    }

    private func handleWsMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            // Best-effort parse of thread events.
            guard let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            if let type = json["type"] as? String, type == "chat.message",
               let role = json["role"] as? String,
               let content = json["content"] as? String {
                let msg = DaemonMessage(role: MessageRole(rawValue: role) ?? .assistant, content: content)
                messages.append(msg)
            }
        case .data:
            break
        @unknown default:
            break
        }
    }

    // MARK: - Mock mode

    func enableMockMode() {
        isMocked = true
        isPaired = true
        messages = MockRelay.seedMessages()
    }

    private func mockAssistantReply(to text: String) async {
        try? await Task.sleep(nanoseconds: 600_000_000)
        let reply = MockRelay.fakeReply(for: text)
        messages.append(DaemonMessage(role: .assistant, content: reply))
    }

    // MARK: - HTTP helpers

    private func appendSystemError(_ err: String) {
        messages.append(DaemonMessage(role: .system, content: "error: \(err)"))
    }

    private func postJSON<T: Encodable>(path: String, body: T, authed: Bool) async throws -> (Data, URLResponse) {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authed, let token = keychain.read(key: "device_token") {
            req.setValue("daemon_token=\(token)", forHTTPHeaderField: "Cookie")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = try JSONEncoder().encode(body)
        return try await session.data(for: req)
    }
}

// MARK: - Keychain

/// Tiny Keychain wrapper — we don't want a dependency for three calls.
struct Keychain {
    let service: String

    func write(key: String, value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        var attrs = query
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attrs as CFDictionary, nil)
    }

    func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
