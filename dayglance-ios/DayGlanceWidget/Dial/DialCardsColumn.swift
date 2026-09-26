import SwiftUI
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — systemExtraLarge (iPad only): the column beside the dial. The
// in-app dial's All Day pill and its legend (DayDial.jsx), in the legend's
// grammar (icon, label, then the fact), from the `allDay` and `totals` the
// app sends with each day's `dial` (projectDialSnapshot). The Android widget
// shows the same two cards in its roomy placements (DialCards.kt).
//
// Sizes are fixed points, like the rest of the dial: the geometry is fixed,
// and DialExtraLarge's metrics (how many all-day rows fit under the legend)
// are what this lays out. The rows are the in-app pill's: incomplete items
// at white 90 %, done ones at 40 %, each with its muted colour dot.
// ─────────────────────────────────────────────────────────────────────────────

/// The two cards' content for one entry.
struct DialCards {
    var allDay: [DialAllDayItem]
    var legend: [DialLegendItem]

    static let empty = DialCards(allDay: [], legend: [])

    /// From the day the entry shows (pushed or projected); the routine count
    /// comes off the ring's own blocks.
    init(day: ResolvedWidgetDay, blocks: [DialFaceBlock]) {
        let totals = day.dial?.totals
        self.allDay = (day.dial?.allDay ?? []).filter { !($0.title ?? "").isEmpty }
        self.legend = DialLegend.items(hasTotals: totals != nil,
                                       effortMinutes: totals?.effortMinutes.map(Double.init),
                                       restoreMinutes: totals?.restoreMinutes.map(Double.init),
                                       sleepMinutes: totals?.sleepMinutes.map(Double.init),
                                       unblockedMinutes: totals?.unblockedMinutes.map(Double.init),
                                       blocks: blocks)
    }

    init(allDay: [DialAllDayItem], legend: [DialLegendItem]) {
        self.allDay = allDay
        self.legend = legend
    }
}

struct DialCardsColumn: View {
    let cards: DialCards
    /// The widget's height, which decides how many all-day rows fit.
    let height: Double

    private typealias X = DialExtraLarge

    var body: some View {
        let rows = X.allDayRows(height: height, legendItems: cards.legend.count)
        // When they do not all fit, the last row gives way to "+N more".
        let fits = cards.allDay.count <= rows
        let shown = Array(cards.allDay.prefix(fits ? rows : Swift.max(0, rows - 1)))
        let hidden = cards.allDay.count - shown.count
        VStack(alignment: .leading, spacing: X.cardGap) {
            if !shown.isEmpty {
                allDayCard(shown, hidden: hidden)
            }
            if !cards.legend.isEmpty {
                legendCard
            }
        }
        .padding(.vertical, X.padding)
        .padding(.trailing, X.padding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    // MARK: All Day

    private func allDayCard(_ items: [DialAllDayItem], hidden: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "calendar")
                    .font(.system(size: 13))
                Text(String(localized: "All day"))
                    .font(.system(size: 12))
            }
            .foregroundStyle(Color.white.opacity(0.45))
            .frame(height: 20, alignment: .leading)
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(spacing: 8) {
                    Circle()
                        .fill(Color(hex: WidgetDialPalette.mute(hex: item.colorHex)))
                        .frame(width: 6, height: 6)
                    Text(verbatim: item.title ?? "")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.white.opacity((item.completed ?? false) ? 0.4 : 0.9))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .frame(height: X.allDayRow, alignment: .leading)
            }
            if hidden > 0 {
                Text(String(localized: "+\(hidden) more"))
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .frame(height: X.allDayRow, alignment: .leading)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(card)
    }

    // MARK: Legend, two to a row

    private var legendCard: some View {
        let pairs = stride(from: 0, to: cards.legend.count, by: 2).map {
            Array(cards.legend[$0..<Swift.min($0 + 2, cards.legend.count)])
        }
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(pairs.enumerated()), id: \.offset) { _, pair in
                HStack(spacing: 12) {
                    ForEach(pair, id: \.key) { item in
                        legendCell(item)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if pair.count == 1 {
                        Color.clear.frame(maxWidth: .infinity)
                    }
                }
                .frame(height: X.legendRow)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, X.legendChrome / 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(card)
    }

    private func legendCell(_ item: DialLegendItem) -> some View {
        HStack(spacing: 10) {
            Image(systemName: Self.symbol(item.key))
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color(hex: Self.colorHex(item.key)))
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(Self.label(item.key))
                    .font(.system(size: 11))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .lineLimit(1)
                Text(verbatim: Self.value(item))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.9))
                    .lineLimit(1)
            }
        }
    }

    /// The in-app pills: white at 4 %, rounded 16 (rounded-2xl).
    private var card: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(Color.white.opacity(0.04))
    }

    // MARK: the legend's vocabulary (DayDial.jsx `legend`)

    /// SF Symbols for the app's Lucide icons: Zap, Leaf, MoonStar,
    /// CircleDashed, Sparkles.
    static func symbol(_ key: DialLegendKey) -> String {
        switch key {
        case .effort: return "bolt"
        case .restore: return "leaf"
        case .sleep: return "moon.stars"
        case .unblocked: return "circle.dashed"
        case .routines: return "sparkles"
        }
    }

    /// DIAL_COLORS and ROUTINE_COLOR.
    static func colorHex(_ key: DialLegendKey) -> String {
        switch key {
        case .effort: return "#93c5fd"
        case .restore: return "#5eead4"
        case .sleep: return "#c4b5fd"
        case .unblocked: return "#9ca3af"
        case .routines: return "#5eead4"
        }
    }

    static func label(_ key: DialLegendKey) -> String {
        switch key {
        case .effort: return String(localized: "Effort")
        case .restore: return String(localized: "Restore")
        // Its own key: the legend's word differs from the hub's "Sleep" in
        // Spanish (Sueño / Dormir), as in the app.
        case .sleep: return String(localized: "legend.sleep", defaultValue: "Sleep")
        case .unblocked: return String(localized: "Unblocked")
        case .routines: return String(localized: "Routines")
        }
    }

    /// "3h 20m", or "2/3" for routines, as the in-app legend reads.
    static func value(_ item: DialLegendItem) -> String {
        item.key == .routines ? "\(item.done)/\(item.total)" : DialHubClock.duration(minutes: item.minutes ?? 0)
    }
}
