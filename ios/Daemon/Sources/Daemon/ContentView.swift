//
//  ContentView.swift
//  Daemon
//
//  Root chat UI. When unpaired, shows the QR scanner. When paired, shows
//  a message list with an input field at the bottom. Pure SwiftUI, no
//  third-party deps.
//

import SwiftUI
import AVFoundation

struct ContentView: View {
    @EnvironmentObject private var client: DaemonClient
    @State private var draft: String = ""
    @State private var showScanner: Bool = false

    var body: some View {
        NavigationStack {
            Group {
                if client.isPaired {
                    chatView
                } else {
                    unpairedView
                }
            }
            .navigationTitle("Daemon")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if client.isPaired {
                        Menu {
                            Button("Unpair", role: .destructive) {
                                client.unpair()
                            }
                            Button("Refresh") {
                                Task { await client.refreshThread() }
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $showScanner) {
                QRScannerView { code in
                    showScanner = false
                    Task { await client.pair(withCode: code) }
                }
            }
        }
    }

    // MARK: - Chat

    private var chatView: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(client.messages) { msg in
                            MessageRow(message: msg).id(msg.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: client.messages.count) { _, _ in
                    if let last = client.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
            Divider()
            HStack {
                TextField("Message your daemon…", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)
                Button {
                    send()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding()
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        draft = ""
        Task { await client.sendMessage(text) }
    }

    // MARK: - Unpaired

    private var unpairedView: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 80))
                .foregroundStyle(.tint)
            Text("Pair with your daemon")
                .font(.title2).bold()
            Text("Visit my.daemon.page → Settings → Pair new device, then scan the QR code.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                showScanner = true
            } label: {
                Label("Scan QR code", systemImage: "camera")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 32)

            #if DEBUG
            Button("Use Mock Relay (dev)") {
                client.enableMockMode()
            }
            .buttonStyle(.bordered)
            #endif
            Spacer()
        }
    }
}

struct MessageRow: View {
    let message: DaemonMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer() }
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                Text(message.role == .user ? "you" : "daemon")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(message.content)
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(message.role == .user ? Color.accentColor.opacity(0.2) : Color(.systemGray6))
                    )
            }
            if message.role != .user { Spacer() }
        }
    }
}

#Preview {
    ContentView().environmentObject(DaemonClient.shared)
}
