import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The palette: how a block's colour and state become opacity and weight.
// Decided in Phase 2 (docs/day-dial-palette-study.html, variant C): the
// widget inherits the app's own treatment — muteDialColor, the duration
// curve and DayDial.jsx's state multipliers — reweighted for widget scale,
// and drops the spec's solid band with its 42 % time dimming. The three
// protocols Phase 1 left as seams are implemented here by `WidgetDialPalette`.
//
// Ported exactly from src/utils/dayDial.js (muteDialColor, dialIntensity)
// and src/components/DayDial.jsx (blockTone, SLEEP_MUTE, ROUTINE_OPACITY,
// ROUTINE_DONE_OPACITY); the vector tests hold the first two to the fixture.
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

/// How strongly a block is drawn as a function of its length.
public protocol DialIntensityProviding {
    func intensity(durationMinutes: Double) -> DialIntensity
}

/// How a task's own colour is pulled into the dial's palette. Takes and
/// returns "#rrggbb".
public protocol DialColorMuting {
    func mute(hex: String?) -> String
}

/// The multipliers a block's state applies to its fill and edge.
public protocol DialStateToning {
    func tone(_ input: DialToneInput) -> DialTone
}

/// What is on the ring, as the snapshot's `dial.blocks[].type` names it.
public enum DialBlockKind: String, Equatable {
    /// The user's own block: completable.
    case task
    /// A read-only imported calendar event: over, never done.
    case event
    /// A routine bar: rim only.
    case routine
    /// The declared night: context, never schedule.
    case sleep
}

/// Everything the state multipliers look at.
public struct DialToneInput: Equatable {
    public var kind: DialBlockKind
    public var completed: Bool
    /// Wholly behind the needle: the block's end is at or before the
    /// entry's minute (`endMin <= nowMin`, as DayDial.jsx's `isPast`).
    public var past: Bool
    /// Last night's overrun, drawn from midnight.
    public var startedPrevDay: Bool
    /// The entry is on a projected day (WidgetDayTier.projected): the
    /// completion flags carry no information and must not be read.
    public var projectedDay: Bool

    public init(kind: DialBlockKind, completed: Bool, past: Bool, startedPrevDay: Bool = false, projectedDay: Bool = false) {
        self.kind = kind
        self.completed = completed
        self.past = past
        self.startedPrevDay = startedPrevDay
        self.projectedDay = projectedDay
    }
}

/// Multipliers on the fill and the rim. For a routine `edge` is the rim's
/// ABSOLUTE opacity (0.5 / 0.18), since a routine has no duration curve.
public struct DialTone: Equatable {
    public var fill: Double
    public var edge: Double
    public init(fill: Double, edge: Double) { self.fill = fill; self.edge = edge }
}

/// The one palette the widget draws with.
public struct WidgetDialPalette: DialColorMuting, DialIntensityProviding, DialStateToning {
    public init() {}

    // MARK: muteDialColor

    /// What an unparseable colour falls back to: DIAL_COLORS.effort, returned
    /// RAW (the JS does not mute its own fallback).
    public static let fallbackHex = "#93c5fd"

    /// Keep the hue, cap saturation at 0.5, pin lightness at 0.73 — every
    /// wedge in one pastel family. The arithmetic is dayDial.js's, in its
    /// order, so the two round to the same byte.
    public static func mute(hex: String?) -> String {
        guard let rgb = Self.rgb(hex) else { return fallbackHex }
        let (r, g, b) = rgb
        let mx = Swift.max(r, g, b)
        let mn = Swift.min(r, g, b)
        var h = 0.0
        if mx != mn {
            let d = mx - mn
            if mx == r { h = ((g - b) / d + (g < b ? 6 : 0)) / 6 }
            else if mx == g { h = ((b - r) / d + 2) / 6 }
            else { h = ((r - g) / d + 4) / 6 }
        }
        let l0 = (mx + mn) / 2
        let s0 = mx == mn ? 0 : (mx - mn) / (1 - abs(2 * l0 - 1))

        let s = Swift.min(s0, 0.5)
        let l = 0.73

        let c = (1 - abs(2 * l - 1)) * s
        let x = c * (1 - abs((h * 6).truncatingRemainder(dividingBy: 2) - 1))
        let m2 = l - c / 2
        let seg = Int(floor(h * 6)) % 6
        let table: [(Double, Double, Double)] = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)]
        let (r1, g1, b1) = table[seg]
        func byte(_ v: Double) -> String {
            String(format: "%02x", Int(((v + m2) * 255).rounded(.toNearestOrAwayFromZero)))
        }
        return "#\(byte(r1))\(byte(g1))\(byte(b1))"
    }

    public func mute(hex: String?) -> String { Self.mute(hex: hex) }

    /// `/^#([0-9a-f]{6})$/i` → components in 0...1, else nil. Three-digit
    /// forms, names and nil are all "not a colour".
    static func rgb(_ hex: String?) -> (Double, Double, Double)? {
        guard let hex, hex.count == 7, hex.hasPrefix("#") else { return nil }
        let body = hex.dropFirst()
        guard body.allSatisfy({ $0.isHexDigit }), let n = UInt32(body, radix: 16) else { return nil }
        return (Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255)
    }

    // MARK: dialIntensity (the web curve, what the vectors pin)

    /// Saturates at three hours: a 15-minute sliver and a 3-hour block are
    /// the same family at different intensities.
    public static let saturationMinutes: Double = 180

    /// 0...1 by duration, the shared input of both curves.
    public static func t(durationMinutes: Double) -> Double {
        Swift.max(0, Swift.min(1, durationMinutes / saturationMinutes))
    }

    /// The web dial's curve (fill 0.05–0.16, edge 0.45–1.0, edge width 2–4
    /// viewBox units), rounded to three decimals as dayDial.js's `fmt`.
    /// Kept for the vectors; the widget draws `DialBandTreatment`.
    public static func webIntensity(durationMinutes: Double) -> DialIntensity {
        let t = t(durationMinutes: durationMinutes)
        return DialIntensity(fillOpacity: JSNumber.round3(0.05 + t * 0.11),
                             edgeOpacity: JSNumber.round3(0.45 + t * 0.55),
                             edgeWidth: JSNumber.round3(2 + t * 2))
    }

    public func intensity(durationMinutes: Double) -> DialIntensity { Self.webIntensity(durationMinutes: durationMinutes) }

    // MARK: state multipliers (DayDial.jsx blockTone, SLEEP_MUTE, routine opacities)

    /// Recede, don't erase: the spent day stays legible as history.
    public static let pastMute = 0.6
    /// A finished block settles into a quiet mass, its rim nearly gone.
    public static let doneEdgeMute = 0.25
    /// One you could have completed and did not keeps its rim at full
    /// strength over a hollowed fill.
    public static let undoneFillMute = 0.35
    /// Sleep is context, never schedule.
    public static let sleepMute = 0.6
    public static let routineOpacity = 0.5
    public static let routineDoneOpacity = 0.18

    /// The multipliers, as DayDial.jsx applies them, with one rule the app
    /// never needed: on a PROJECTED day the completion flags are always
    /// false (the state cannot be known), so every past block would render
    /// as "past undone" with a full rim and each morning the widget would
    /// mark finished work as unfinished. There, every past task and routine
    /// takes the past-event tone instead; only the pushed day reads
    /// completion.
    public static func tone(_ i: DialToneInput) -> DialTone {
        switch i.kind {
        case .sleep:
            let m = i.past ? sleepMute * pastMute : sleepMute
            return DialTone(fill: m, edge: m)
        case .routine:
            let done = i.projectedDay ? i.past : i.completed
            return DialTone(fill: 0, edge: done ? routineDoneOpacity : routineOpacity)
        case .task, .event:
            // Completed first, before past: a block ticked off early is done
            // now, not at its end (blockTone reads b.completed first).
            if i.completed, !i.projectedDay { return DialTone(fill: pastMute, edge: doneEdgeMute) }
            if !i.past { return DialTone(fill: 1, edge: 1) }
            if i.projectedDay { return DialTone(fill: pastMute, edge: pastMute) }
            // Yesterday's overrun is history the moment it ends; an event was
            // never the user's to complete. Both recede evenly.
            if i.kind == .event || i.startedPrevDay { return DialTone(fill: pastMute, edge: pastMute) }
            return DialTone(fill: undoneFillMute, edge: 1)
        }
    }

    public func tone(_ input: DialToneInput) -> DialTone { Self.tone(input) }
}
