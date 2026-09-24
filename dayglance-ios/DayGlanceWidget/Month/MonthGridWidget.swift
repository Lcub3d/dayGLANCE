import WidgetKit
import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Month grid — systemLarge. Six weeks of days as a 7 × 6 grid, each cell a
// miniature vertical timeline of that day's blocks. The layout is the
// reference mockup's (month-widget-mockup.html, "No header · capped"); the
// decisions are in MonthGridModel.swift, and this file only draws them.
//
// Measurements are the mockup's, in points, at every size: 11pt padding, a
// 14pt day-of-week row, a 14pt date header per cell, the track from 15pt to
// 2pt above the cell's bottom. The cells take whatever is left — at the
// smallest systemLarge (iPad mini, 306 × 306) that is a 40.6 × 45pt cell
// with a 28pt track (MonthGridSizeSweepTests).
// ─────────────────────────────────────────────────────────────────────────────

/// The mockup's palette. Dark only, like the Day Dial: the widget draws its own
/// ground rather than following the Home Screen's appearance.
enum MonthPalette {
    static let background = Color(hex: "#161b22")
    static let date = Color(hex: "#8b949e")
    static let dateEmphasis = Color(hex: "#c9d1d9")
    static let muted = Color(hex: "#6e7681")
    static let hairline = Color(hex: "#30363d")
    static let todayFill = Color(hex: "#1f6feb")
    /// The app's brand orange (tailwind `brand`, the Share Extension's `brand`).
    static let pip = Color(hex: "#fe8b00")
}

/// The mockup's measurements, and the cell geometry they leave at a size.
struct MonthGridMetrics: Equatable {
    static let padding: CGFloat = 11
    static let weekdayRowHeight: CGFloat = 14
    static let weekdayFontSize: CGFloat = 9
    static let headerHeight: CGFloat = 14
    static let dateFontSize: CGFloat = 10
    static let overflowFontSize: CGFloat = 8
    static let cellInset: CGFloat = 2
    static let trackTop: CGFloat = 15
    static let trackBottomInset: CGFloat = 2
    static let pipSize: CGFloat = 4
    static let pipGap: CGFloat = 3
    static let boxRadius: CGFloat = 4
    static let barRadius: CGFloat = 1.5
    static let todayFillHeight: CGFloat = 12
    static let todayMinWidth: CGFloat = 14
    static let todayPadding: CGFloat = 3

    /// The area under the day-of-week row.
    let gridSize: CGSize

    var cellWidth: CGFloat { gridSize.width / CGFloat(MonthGrid.columns) }
    var cellHeight: CGFloat { gridSize.height / CGFloat(MonthGrid.rows) }
    var trackWidth: CGFloat { max(0, cellWidth - 2 * Self.cellInset) }
    var trackHeight: CGFloat { max(0, cellHeight - Self.trackTop - Self.trackBottomInset) }

    /// The grid area for a widget of `size` with nothing above the weekday row.
    static func gridSize(widget size: CGSize, banner: CGFloat = 0) -> CGSize {
        CGSize(width: size.width - 2 * padding,
               height: size.height - 2 * padding - weekdayRowHeight - banner)
    }

    /// A cell's origin in widget coordinates (no banner), for the tests.
    static func cellOrigin(index: Int, widget size: CGSize) -> CGPoint {
        let m = MonthGridMetrics(gridSize: gridSize(widget: size))
        let col = CGFloat(index % MonthGrid.columns), row = CGFloat(index / MonthGrid.columns)
        return CGPoint(x: padding + col * m.cellWidth, y: padding + weekdayRowHeight + row * m.cellHeight)
    }
}

// MARK: - Timeline

struct MonthGridEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let window: MonthWindowPayload?
    var isPlaceholder: Bool = false
}

struct MonthGridProvider: TimelineProvider {
    func placeholder(in context: Context) -> MonthGridEntry {
        MonthGridEntry(date: Date(), snapshot: nil, window: nil, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (MonthGridEntry) -> Void) {
        let snapshot = loadSnapshot()
        let window = MonthWindowStore.load()
        completion(MonthGridEntry(date: Date(), snapshot: snapshot, window: window, isPlaceholder: window == nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MonthGridEntry>) -> Void) {
        let snapshot = loadSnapshot()
        let window = MonthWindowStore.load()
        let now = Date()
        let dates = MonthGridTimeline.entryDates(now: now, window: window)
        let entries = dates.map { MonthGridEntry(date: $0, snapshot: snapshot, window: window) }
        let policy: TimelineReloadPolicy = MonthGridTimeline.nextReload(after: dates, now: now).map { .after($0) } ?? .atEnd
        completion(Timeline(entries: entries, policy: policy))
    }
}

// MARK: - Views

struct MonthGridWidgetView: View {
    let entry: MonthGridEntry

    var body: some View {
        MonthGridContent(entry: entry)
            .containerBackground(MonthPalette.background, for: .widget)
    }
}

/// Everything inside the container background, so the tests can render it
/// with ImageRenderer at an exact size.
struct MonthGridContent: View {
    let entry: MonthGridEntry
    var calendar: Calendar = .current
    var locale: Locale = .current

    var body: some View {
        if entry.isPlaceholder {
            layout(MonthGridState.placeholder(at: entry.date, calendar: calendar, locale: locale), links: false)
        } else if let state = MonthGridState.resolve(snapshot: entry.snapshot, window: entry.window, at: entry.date,
                                                     calendar: calendar, locale: locale) {
            layout(state, links: true)
        } else {
            Text(entry.snapshot == nil ? String(localized: "Open dayGLANCE to set up")
                                       : String(localized: "Open dayGLANCE to refresh"))
                .font(.subheadline)
                .foregroundColor(MonthPalette.date)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func layout(_ state: MonthGridState, links: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if state.isStale {
                StaleBanner(freshness: state.freshness, use24Hour: entry.snapshot?.use24Hour)
                    .padding(.leading, MonthGridMetrics.cellInset)
            } else if state.isProjected {
                Text(state.freshness.monthPlannedAsOfLabel(use24Hour: entry.snapshot?.use24Hour, locale: locale, timeZone: calendar.timeZone))
                    .font(.caption2)
                    .foregroundColor(MonthPalette.muted)
                    .lineLimit(1)
                    .padding(.leading, MonthGridMetrics.cellInset)
                    .padding(.bottom, 2)
            }
            MonthWeekdayRow(initials: MonthGrid.weekdayInitials(weekStart: state.weekStart, calendar: calendar))
            GeometryReader { geo in
                MonthGridBody(cells: state.cells, metrics: MonthGridMetrics(gridSize: geo.size), links: links)
            }
            .staleDimmed(state.freshness)
        }
        .padding(MonthGridMetrics.padding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct MonthWeekdayRow: View {
    let initials: [String]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(initials.enumerated()), id: \.offset) { _, initial in
                Text(verbatim: initial)
                    .font(.system(size: MonthGridMetrics.weekdayFontSize))
                    .foregroundColor(MonthPalette.muted)
                    .lineLimit(1)
                    .padding(.leading, 3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(height: MonthGridMetrics.weekdayRowHeight, alignment: .top)
        .accessibilityHidden(true)
    }
}

struct MonthGridBody: View {
    let cells: [MonthGridCell]
    let metrics: MonthGridMetrics
    let links: Bool

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<MonthGrid.rows, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(0..<MonthGrid.columns, id: \.self) { col in
                        let i = row * MonthGrid.columns + col
                        if i < cells.count {
                            cell(cells[i])
                        } else {
                            Color.clear.frame(width: metrics.cellWidth, height: metrics.cellHeight)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func cell(_ cell: MonthGridCell) -> some View {
        let view = MonthGridCellView(cell: cell, metrics: metrics)
        if links, let url = cell.url {
            Link(destination: url) { view }
        } else {
            view
        }
    }
}

struct MonthGridCellView: View {
    let cell: MonthGridCell
    let metrics: MonthGridMetrics

    var body: some View {
        ZStack(alignment: .topLeading) {
            if cell.isFirstOfMonth {
                RoundedRectangle(cornerRadius: MonthGridMetrics.boxRadius)
                    .strokeBorder(MonthPalette.hairline, lineWidth: 0.5)
            }
            track
                .padding(.top, MonthGridMetrics.trackTop)
                .padding(.leading, MonthGridMetrics.cellInset)
            header
        }
        .frame(width: metrics.cellWidth, height: metrics.cellHeight, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// No lanes: overlapping bars stack, later on top. At this width lanes
    /// would be two 18pt slivers.
    private var track: some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(cell.bars.enumerated()), id: \.offset) { _, bar in
                let f = MonthGrid.barFrame(bar, trackHeight: metrics.trackHeight)
                RoundedRectangle(cornerRadius: MonthGridMetrics.barRadius)
                    .fill(Color(hex: bar.c))
                    .frame(width: metrics.trackWidth, height: f.height)
                    .padding(.top, f.y)
            }
        }
        .frame(width: metrics.trackWidth, height: metrics.trackHeight, alignment: .topLeading)
    }

    private var header: some View {
        HStack(spacing: 0) {
            HStack(spacing: MonthGridMetrics.pipGap) {
                dateLabel
                if cell.hasPip {
                    Circle()
                        .fill(MonthPalette.pip)
                        .frame(width: MonthGridMetrics.pipSize, height: MonthGridMetrics.pipSize)
                }
            }
            // 2pt at least between the pip and a `+N`: at 1pt they touched
            // on the smallest cells when today's fill widened the label.
            Spacer(minLength: 2)
            if cell.overflow > 0 {
                Text(verbatim: "+\(cell.overflow)")
                    .font(.system(size: MonthGridMetrics.overflowFontSize))
                    .foregroundColor(MonthPalette.muted)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.trailing, 1)
            }
        }
        .padding(.leading, 1)
        .padding(.horizontal, MonthGridMetrics.cellInset)
        .frame(width: metrics.cellWidth, height: MonthGridMetrics.headerHeight)
    }

    /// Today's fill is a BACKGROUND with a fixed height, and its padding is
    /// horizontal only, so the number sits on the same line as every other
    /// date number. The mockup's own box model: content at least 14pt wide,
    /// 3pt either side, pulled 2pt left.
    @ViewBuilder
    private var dateLabel: some View {
        let text = Text(verbatim: cell.label)
            .font(.system(size: MonthGridMetrics.dateFontSize, weight: cell.isBold ? .medium : .regular))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        if cell.isToday {
            text
                .foregroundColor(.white)
                .frame(minWidth: MonthGridMetrics.todayMinWidth)
                .padding(.horizontal, MonthGridMetrics.todayPadding)
                .background(
                    RoundedRectangle(cornerRadius: 4)
                        .fill(MonthPalette.todayFill)
                        .frame(height: MonthGridMetrics.todayFillHeight)
                )
                .padding(.leading, -2)
        } else {
            text.foregroundColor(cell.isBold ? MonthPalette.dateEmphasis : MonthPalette.date)
        }
    }

    private var accessibilitySummary: String {
        var parts: [String] = []
        if let day = WidgetFreshness.parseDay(cell.date, calendar: .current) {
            parts.append(day.formatted(.dateTime.weekday(.wide).month(.wide).day()))
        }
        if cell.totalBars > 0 { parts.append(String(localized: "\(cell.totalBars) scheduled")) }
        if cell.hasPip { parts.append(String(localized: "All-day or due")) }
        return parts.joined(separator: ", ")
    }
}

struct MonthGridWidget: Widget {
    let kind = "MonthGridWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MonthGridProvider()) { entry in
            MonthGridWidgetView(entry: entry)
        }
        .configurationDisplayName("Month")
        .description("Six weeks of your schedule at a glance.")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}
