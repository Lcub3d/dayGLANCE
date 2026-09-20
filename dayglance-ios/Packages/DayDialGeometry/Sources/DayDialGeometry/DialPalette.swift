import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The palette question is OPEN and gates Phase 2, not Phase 1. dayDial.js
// carries three treatments the web dial applies on top of a task's colour:
//
//   muteDialColor   hue kept, saturation capped at 0.5, lightness pinned at
//                   0.73 — every wedge in one pastel family;
//   dialIntensity   fill 0.05–0.16, edge 0.45–1.0 and edge width 2–4 by
//                   duration, saturating at 180 minutes;
//   state multipliers  completed 0.6 / 0.25, past-undone 0.35 / 1,
//                   past-event 0.6 / 0.6, sleep 0.6.
//
// The widget spec instead draws blocks as one stroke per category at a fixed
// alpha with past blocks at 42%. Which of these the widget inherits is a
// design decision not yet taken, so this file defines the SEAMS the geometry
// hands a colour decision through and implements none of them. The vectors
// for muteDialColor and dialIntensity stay in the fixture for whichever
// implementation lands.
// ─────────────────────────────────────────────────────────────────────────────

/// Opacity and stroke weight for a block of a given duration.
public struct DialIntensity: Equatable {
    public var fillOpacity: Double
    public var edgeOpacity: Double
    public var edgeWidth: Double
    public init(fillOpacity: Double, edgeOpacity: Double, edgeWidth: Double) {
        self.fillOpacity = fillOpacity
        self.edgeOpacity = edgeOpacity
        self.edgeWidth = edgeWidth
    }
}

/// How strongly a block is drawn as a function of its length. Unimplemented
/// on purpose; see the header. A conforming type is the Phase 2 decision.
public protocol DialIntensityProviding {
    func intensity(durationMinutes: Double) -> DialIntensity
}

/// How a task's own colour is pulled into the dial's palette. Unimplemented
/// on purpose; see the header. Takes and returns "#rrggbb".
public protocol DialColorMuting {
    func mute(hex: String) -> String
}

/// The multipliers a block's state applies to its fill and edge (completed,
/// past-undone, past-event, future). Unimplemented on purpose; see the header.
public protocol DialStateToning {
    func tone(completed: Bool, past: Bool, completable: Bool, startedPrevDay: Bool) -> (fill: Double, edge: Double)
}
