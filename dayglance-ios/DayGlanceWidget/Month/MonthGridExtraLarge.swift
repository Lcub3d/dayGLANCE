import SwiftUI
import WidgetKit
import AppIntents

// ─────────────────────────────────────────────────────────────────────────────
// Month — systemExtraLarge (iPad only). The left half is the systemLarge grid,
// reused unchanged (MonthGridContent, with the selected day ringed); the right
// half is one day, chosen with two arrow buttons (SelectMonthDayIntent). Grid
// cells stay deep links; the arrows are the only in-widget interaction.
//
// THIS BUILD IS THE INTENT SPIKE: the right half shows the selected date, the
// arrows, the day's item count from the grid's own data, and a diagnostic
// line saying which process ran the last arrow tap. The agenda rows replace
// the count and the diagnostic in the next step.
// ─────────────────────────────────────────────────────────────────────────────

struct MonthGridExtraLargeContent: View {
    let entry: MonthGridEntry
    var calendar: Calendar = .current
    var locale: Locale = .current

    var body: some View {
        let state: MonthGridState? = entry.isPlaceholder
            ? MonthGridState.placeholder(at: entry.date, calendar: calendar, locale: locale)
            : MonthGridState.resolve(snapshot: entry.snapshot, window: entry.window, at: entry.date,
                                     calendar: calendar, locale: locale)
        let entryDay = MonthGrid.isoDay(entry.date, calendar: calendar)
        let selected = state.flatMap { MonthDaySelection.resolve(entry.selection, cells: $0.cells, entryDay: entryDay) }
        GeometryReader { geo in
            HStack(spacing: 0) {
                MonthGridContent(entry: entry, calendar: calendar, locale: locale, selectedDate: selected)
                    .frame(width: geo.size.width / 2, height: geo.size.height)
                Rectangle()
                    .fill(MonthPalette.hairline)
                    .frame(width: 0.5)
                    .padding(.vertical, MonthGridMetrics.padding)
                MonthDayPanel(state: state, selected: selected, selection: entry.selection,
                              interactive: !entry.isPlaceholder, calendar: calendar, locale: locale)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }
}

struct MonthDayPanel: View {
    let state: MonthGridState?
    let selected: String?
    let selection: MonthDaySelection?
    let interactive: Bool
    var calendar: Calendar = .current
    var locale: Locale = .current

    private var cell: MonthGridCell? { state?.cells.first { $0.date == selected } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let cell {
                Text(String(localized: "\(cell.totalBars) scheduled"))
                    .font(.system(size: 12))
                    .foregroundColor(MonthPalette.date)
                if cell.hasPip {
                    Text(String(localized: "All-day or due"))
                        .font(.system(size: 12))
                        .foregroundColor(MonthPalette.pip)
                }
            }
            Spacer(minLength: 0)
            diagnostic
        }
        .padding(MonthGridMetrics.padding)
        .padding(.leading, 4)
        .staleDimmed(state?.freshness ?? .unknown)
    }

    private var header: some View {
        let neighbours = selected.flatMap { s in state.map { MonthDaySelection.neighbours(of: s, cells: $0.cells) } }
        return HStack(spacing: 4) {
            Text(verbatim: dateLabel)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(MonthPalette.dateEmphasis)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 4)
            arrow(to: neighbours?.previous, systemImage: "chevron.left", label: String(localized: "Previous day"))
            arrow(to: neighbours?.next, systemImage: "chevron.right", label: String(localized: "Next day"))
        }
    }

    /// A Button(intent:) when there is a day to go to; a dimmed chevron at
    /// either end of the grid (and in the gallery placeholder).
    @ViewBuilder
    private func arrow(to target: String?, systemImage: String, label: String) -> some View {
        let glyph = Image(systemName: systemImage)
            .font(.system(size: 14, weight: .semibold))
            .frame(width: 30, height: 30)
            .contentShape(Rectangle())
        if interactive, let target {
            Button(intent: SelectMonthDayIntent(date: target)) {
                glyph.foregroundColor(MonthPalette.dateEmphasis)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(label))
        } else {
            glyph.foregroundColor(MonthPalette.muted.opacity(0.4))
                .accessibilityLabel(Text(label))
                .accessibilityAddTraits(.isStaticText)
        }
    }

    private var dateLabel: String {
        guard let selected, let day = WidgetFreshness.parseDay(selected, calendar: calendar) else { return "" }
        var style = Date.FormatStyle().weekday(.wide).month(.abbreviated).day()
        style.calendar = calendar
        style.timeZone = calendar.timeZone
        return day.formatted(style.locale(locale))
    }

    /// SPIKE DIAGNOSTIC — removed with the agenda build. The process name
    /// proves where the last arrow tap ran: the widget extension means no app
    /// launch was involved.
    @ViewBuilder
    private var diagnostic: some View {
        if let at = selection?.handledAt {
            Text(verbatim: "Last arrow: \(selection?.handledBy ?? "?") at \(at.formatted(date: .omitted, time: .standard))")
                .font(.system(size: 9))
                .foregroundColor(MonthPalette.muted)
                .lineLimit(2)
        }
    }
}
