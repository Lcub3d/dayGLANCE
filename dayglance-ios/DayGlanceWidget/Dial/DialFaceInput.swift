import Foundation
import CryptoKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — what the static face draws, resolved from the snapshot.
//
// The face is keyed and rendered from THIS, not from the raw snapshot JSON:
// it carries exactly the fields the ring and sky use, so a push that only
// changed goals or the Up Next list does not invalidate the cached image,
// and the same day rendered from `snapshot.dial` (pushed) or `days[].dial`
// (projected) goes through one path. Pure mapping, no drawing.
// ─────────────────────────────────────────────────────────────────────────────

struct DialMoonGlyph: Equatable {
    var fraction: Double
    var waxing: Bool
    /// Minutes past midnight where the in-app dial places the glyph.
    var minutes: Double
    /// Southern hemisphere: the lit limb is on the other side (DayDial.jsx's
    /// `southern`), from the sign of the latitude the snapshot sends.
    var mirror: Bool = false
}

struct DialFaceInput: Equatable {
    var blocks: [DialFaceBlock]
    /// Empty when the snapshot has no sky (no geocoded location, handoff
    /// §5): the face draws the ring unlit and no glyphs (DialFaceView).
    var sky: [DialSpec.SkySegment]
    var sunriseMin: Double?
    var sunsetMin: Double?
    var moon: DialMoonGlyph?
    /// WidgetDayTier.projected: completion flags are not information.
    var projectedDay: Bool

    init(blocks: [DialFaceBlock], sky: [DialSpec.SkySegment] = [], sunriseMin: Double? = nil, sunsetMin: Double? = nil,
         moon: DialMoonGlyph? = nil, projectedDay: Bool = false) {
        self.blocks = blocks
        self.sky = sky
        self.sunriseMin = sunriseMin
        self.sunsetMin = sunsetMin
        self.moon = moon
        self.projectedDay = projectedDay
    }

    /// From a resolved day: the dial and sky of whichever tier applies.
    /// Stale and unknown tiers draw as pushed — their flags are the user's
    /// own, merely old, and the stale banner is Phase 5's to add.
    init(day: ResolvedWidgetDay) {
        self.init(dial: day.dial, sky: day.sky, projectedDay: day.isProjected)
    }

    init(dial: DialSnapshot?, sky: SkySnapshot?, projectedDay: Bool) {
        let blocks: [DialFaceBlock] = (dial?.blocks ?? []).compactMap { b -> DialFaceBlock? in
            let start = Double(b.startMin ?? 0)
            let duration = Double(b.durationMin ?? 0)
            guard duration > 0 else { return nil }
            let kind = DialBlockKind(rawValue: b.type ?? "") ?? .task
            return DialFaceBlock(id: b.id ?? "\(kind.rawValue)-\(Int(start))",
                                 kind: kind,
                                 startMin: start,
                                 endMin: start + duration,
                                 endsNextDay: b.endsNextDay ?? false,
                                 startedPrevDay: b.startedPrevDay ?? false,
                                 completed: b.completed ?? false,
                                 colorHex: b.colorHex,
                                 lane: b.lane ?? 0,
                                 laneCount: max(1, b.laneCount ?? 1),
                                 endMinTrue: b.endMinTrue.map(Double.init),
                                 title: b.title,
                                 tag: b.tag)
        }
        var segments: [DialSpec.SkySegment] = []
        var moon: DialMoonGlyph? = nil
        if let sky, let hours = sky.hours, !hours.isEmpty {
            segments = DialSpec.skySegments(hours: hours.map { (sun: $0.sun, moon: $0.moon) })
            if let m = sky.moon, let glyphMin = m.glyphMin {
                moon = DialMoonGlyph(fraction: m.fraction ?? 0, waxing: m.waxing ?? true, minutes: Double(glyphMin),
                                     mirror: sky.southern ?? false)
            }
        }
        self.init(blocks: blocks, sky: segments,
                  sunriseMin: sky?.sunriseMin.map(Double.init), sunsetMin: sky?.sunsetMin.map(Double.init),
                  moon: moon, projectedDay: projectedDay)
    }

    /// A canonical text of everything the FACE draws. Two inputs that draw
    /// the same face have the same seed; the cache key is its digest. Titles,
    /// tags and true ends are the hub's (an overlay, never in the image) and
    /// are deliberately left out, so the key is exactly Phase 2's.
    var seed: String {
        var parts: [String] = ["tier=\(projectedDay ? "projected" : "pushed")"]
        for b in blocks {
            parts.append("b:\(b.id)|\(b.kind.rawValue)|\(b.startMin)|\(b.endMin)|\(b.endsNextDay ? 1 : 0)\(b.startedPrevDay ? 1 : 0)\(b.completed ? 1 : 0)|\(b.colorHex ?? "-")|\(b.lane)/\(b.laneCount)")
        }
        for s in sky {
            parts.append("s:\(s.hour)|\(s.body == .sun ? "sun" : "moon")|\(s.strength)")
        }
        parts.append("rise=\(sunriseMin.map { "\($0)" } ?? "-")|set=\(sunsetMin.map { "\($0)" } ?? "-")")
        if let moon { parts.append("moon=\(moon.fraction)|\(moon.waxing ? 1 : 0)|\(moon.minutes)|\(moon.mirror ? "s" : "n")") }
        return parts.joined(separator: "\n")
    }

    // MARK: placeholder

    /// The face the gallery and a never-opened install show (Phase 5): a
    /// plausible sky ring and glyphs, ticks and labels, no block band. Not a
    /// real day, so a fixed mid-latitude summer sky (the palette study's:
    /// sunrise 05:37, sunset 20:31, a half moon up 21:30–06:30) rather than
    /// the unlit ring, which would read as broken in a gallery. Keyed like
    /// any other input, so it is rendered once and cached.
    static let placeholderSkyHours: [(sun: Double?, moon: Double?)] = {
        let sun: [Double] = [0, 0, 0, 0, 0, 0, 0.1852, 0.3867, 0.5712, 0.7303, 0.8571, 0.9459,
                             0.9929, 0.9958, 0.9547, 0.8712, 0.7492, 0.594, 0.4125, 0.2127, 0.0035, 0, 0, 0]
        let moon: [Double] = [0.433, 0.4924, 0.4924, 0.433, 0.3214, 0.171, 0, 0, 0, 0, 0, 0,
                              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.171, 0.3214]
        return zip(sun, moon).map { (sun: Optional($0.0), moon: Optional($0.1)) }
    }()

    static let placeholder = DialFaceInput(blocks: [],
                                           sky: DialSpec.skySegments(hours: placeholderSkyHours),
                                           sunriseMin: 5 * 60 + 37, sunsetMin: 20 * 60 + 31,
                                           moon: DialMoonGlyph(fraction: 0.5, waxing: true, minutes: 120))

    /// Short, stable hex digest of the seed. Hasher is randomly seeded per
    /// process, so it cannot name a file that must be found again next launch.
    var digest: String {
        SHA256.hash(data: Data(seed.utf8)).prefix(10).map { String(format: "%02x", $0) }.joined()
    }
}
