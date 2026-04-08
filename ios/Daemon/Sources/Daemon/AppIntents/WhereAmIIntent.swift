//
//  WhereAmIIntent.swift
//  Daemon
//
//  Tells the user's daemon the phone's current location. The request is
//  synthesized into a chat message — the relay / agent decides what to
//  do with it (log, reminder geofencing, etc.).
//

import AppIntents
import CoreLocation

struct WhereAmIIntent: AppIntent {
    static var title: LocalizedStringResource = "Where Am I"
    static var description = IntentDescription("Tell your daemon where you are right now.")

    static var parameterSummary: some ParameterSummary { Summary("Tell my daemon where I am") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let coord = await LocationOnce.shared.fetch()
        let msg: String
        if let coord {
            msg = "I'm at \(coord.latitude), \(coord.longitude)."
        } else {
            msg = "I'm somewhere — couldn't get a fix right now."
        }
        await DaemonClient.shared.sendMessage(msg)
        return .result(dialog: IntentDialog(stringLiteral: msg))
    }
}

/// One-shot location helper — avoids the ceremony of a long-lived manager.
final class LocationOnce: NSObject, CLLocationManagerDelegate {
    static let shared = LocationOnce()
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    func fetch() async -> CLLocationCoordinate2D? {
        await withCheckedContinuation { cont in
            self.continuation = cont
            manager.delegate = self
            manager.requestWhenInUseAuthorization()
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        continuation?.resume(returning: locations.first?.coordinate)
        continuation = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(returning: nil)
        continuation = nil
    }
}
