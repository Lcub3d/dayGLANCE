import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

// ─────────────────────────────────────────────────────────────────────────────
// The two cards beside the dial on iPad's systemExtraLarge: the in-app dial's
// All Day pill and its legend (DayDial.jsx), from the `allDay` and `totals`
// that projectDialSnapshot sends with each day's `dial`. The same rules as
// the Android widget's DialCards.kt, which draws them in its roomy
// placements. Pure; the view only lays them out.
// ─────────────────────────────────────────────────────────────────────────────

public enum DialLegendKey: String, CaseIterable, Equatable {
    case effort, restore, sleep, unblocked, routines, frames
}

/// One legend entry: a duration, for routines a done/total count, or for
/// frames a whole percent.
public struct DialLegendItem: Equatable {
    public var key: DialLegendKey
    public var minutes: Double?
    public var done: Int
    public var total: Int
    public var percent: Int?
    public init(key: DialLegendKey, minutes: Double? = nil, done: Int = 0, total: Int = 0, percent: Int? = nil) {
        self.key = key
        self.minutes = minutes
        self.done = done
        self.total = total
        self.percent = percent
    }
}

public enum DialLegend {
    /// The legend in the app's order. `hasTotals` false (a payload from an
    /// app build before the cards) is no legend, rather than zeros that would
    /// read as an empty day. Sleep and unblocked need a declared window (nil
    /// otherwise, as in the app); routines appear when the ring has any.
    /// Frames last, right of routines, when the day has frames: the app's
    /// `framesPercent` (scheduled minutes inside frames over frame minutes).
    public static func items(hasTotals: Bool, effortMinutes: Double?, restoreMinutes: Double?,
                             sleepMinutes: Double?, unblockedMinutes: Double?,
                             blocks: [DialFaceBlock], framesPercent: Int? = nil) -> [DialLegendItem] {
        guard hasTotals else { return [] }
        var out = [
            DialLegendItem(key: .effort, minutes: effortMinutes ?? 0),
            DialLegendItem(key: .restore, minutes: restoreMinutes ?? 0),
        ]
        if let sleepMinutes { out.append(DialLegendItem(key: .sleep, minutes: sleepMinutes)) }
        if let unblockedMinutes { out.append(DialLegendItem(key: .unblocked, minutes: unblockedMinutes)) }
        let routines = blocks.filter { $0.kind == .routine }
        if !routines.isEmpty {
            out.append(DialLegendItem(key: .routines, done: routines.filter(\.completed).count, total: routines.count))
        }
        if let framesPercent { out.append(DialLegendItem(key: .frames, percent: framesPercent)) }
        return out
    }
}

/// The extra-large layout: the widget split down the middle, the dial
/// centred in the left half at its full height, the cards in the right half.
/// Sizes in points.
public enum DialExtraLarge {
    /// The dial's box: as tall as the widget, the canvas's aspect, never
    /// wider than its half.
    public static func dialSize(in size: CGSize) -> CGSize {
        let height = Double(size.height)
        let width = Swift.min(height * DialSpec.canvasWidth / DialSpec.canvasHeight, Double(size.width) / 2)
        return CGSize(width: width, height: width * DialSpec.canvasHeight / DialSpec.canvasWidth)
    }

    /// Card metrics: the column's padding, the gap between cards, an all-day
    /// row, the all-day card's header and padding, a legend row (two to a row).
    public static let padding: Double = 14
    public static let cardGap: Double = 8
    public static let allDayRow: Double = 22
    public static let allDayChrome: Double = 20 + 24
    public static let legendRow: Double = 40
    public static let legendChrome: Double = 24

    public static func legendHeight(_ items: Int) -> Double {
        items == 0 ? 0 : legendChrome + legendRow * Double((items + 1) / 2)
    }

    /// How many all-day rows fit under the legend in a widget of `height`
    /// (0 when none do), at most `cap`.
    public static func allDayRows(height: Double, legendItems: Int, cap: Int = 8) -> Int {
        let legend = legendHeight(legendItems)
        let room = height - 2 * padding - legend - (legend > 0 ? cardGap : 0) - allDayChrome
        return Swift.max(0, Swift.min(cap, Int((room / allDayRow).rounded(.down))))
    }
}
