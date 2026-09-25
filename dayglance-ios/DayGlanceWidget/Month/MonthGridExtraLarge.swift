import SwiftUI
import WidgetKit
import AppIntents

// ─────────────────────────────────────────────────────────────────────────────
// Month — systemExtraLarge (iPad only). The left half is the systemLarge grid,
// reused unchanged (MonthGridContent, with the selected day ringed); the right
// half is one day, chosen with two arrow buttons (SelectMonthDayIntent). Grid
// cells stay deep links; the arrows are the only in-widget interaction.
//
// The right half lists the selected day from the payload's per-day agenda
// (buildAgenda in src/utils/widgetMonthWindow.js: at most 12 rows, titles
// cut to 48 characters, "+N more" past that), in Up Next's row style
// (WidgetAgendaRow). Completed items stay, drawn as SCHED draws them.
// Routines appear on today only, because only today's are in the payload.
//
// The arrow intent was verified on device (iPad, iOS 18.4+, app not running):
// it runs in the widget extension without launching the app.
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
                MonthDayPanel(state: state, selected: selected, today: entryDay, use24Hour: entry.snapshot?.use24Hour ?? false,
                              interactive: !entry.isPlaceholder, calendar: calendar, locale: locale)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }
}

struct MonthDayPanel: View {
    let state: MonthGridState?
    let selected: String?
    /// The entry's day, 'yyyy-MM-dd': where "Today" goes.
    var today: String? = nil
    var use24Hour: Bool = false
    let interactive: Bool
    var calendar: Calendar = .current
    var locale: Locale = .current

    /// Rows the panel lays out: the payload's cap. At the smallest size
    /// (634 × 306) twelve rows, the header and "+N more" fit in the height.
    static let rowSpacing: CGFloat = 4

    private var cell: MonthGridCell? { state?.cells.first { $0.date == selected } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let cell {
                if cell.agenda.isEmpty {
                    Text(String(localized: "Nothing scheduled"))
                        .font(.caption2)
                        .foregroundColor(MonthPalette.muted)
                } else {
                    VStack(alignment: .leading, spacing: Self.rowSpacing) {
                        ForEach(Array(cell.agenda.enumerated()), id: \.offset) { _, row in
                            WidgetAgendaRow(colorHex: row.c, title: row.t, time: timeText(row), completed: row.isCompleted)
                        }
                        if cell.agendaMore > 0 {
                            Text(String(localized: "+\(cell.agendaMore) more"))
                                .font(.caption2)
                                .foregroundColor(MonthPalette.muted)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(MonthGridMetrics.padding)
        .padding(.leading, 4)
        .staleDimmed(state?.freshness ?? .unknown)
    }

    /// "All day", "Due", or Up Next's "9:30AM · 15m".
    private func timeText(_ row: MonthAgendaRow) -> String? {
        switch row.k {
        case "a": return String(localized: "All day")
        case "l": return String(localized: "Due")
        default:
            guard let s = row.s else { return nil }
            return WidgetTimeLabel.label(startTime: WidgetTimeLabel.hhmm(s), duration: row.d.map { Int($0.rounded()) },
                                         use24Hour: use24Hour)
        }
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
            if interactive, let today, let state,
               MonthDaySelection.showsToday(selected: selected, cells: state.cells, today: today) {
                todayPill
            }
            arrow(to: neighbours?.previous, systemImage: "chevron.left", label: String(localized: "Previous day"))
            arrow(to: neighbours?.next, systemImage: "chevron.right", label: String(localized: "Next day"))
        }
        // The wider hit areas would pull the last glyph 7pt in from the edge;
        // this puts it back where it was.
        .padding(.trailing, -(Self.hitSize - Self.headerRowHeight) / 2)
    }

    /// Tap targets: Apple's 44pt minimum, around the same 14pt glyphs. The
    /// vertical overflow (44 − 30) is taken back with negative padding, so
    /// the header's layout height — and with it the agenda's room for its
    /// twelve rows at 634 × 306 — is unchanged; only the hit area grows.
    static let hitSize: CGFloat = 44
    static let headerRowHeight: CGFloat = 30

    /// "Today", when paged away from it (MonthDaySelection.showsToday):
    /// ShowTodayIntent clears the selection. A small pill in today's blue,
    /// the grid's today marker, inside a 44pt-tall hit area.
    private var todayPill: some View {
        Button(intent: ShowTodayIntent()) {
            Text(String(localized: "Today"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .frame(height: 20)
                .background(Capsule().fill(MonthPalette.todayFill))
                .frame(height: Self.hitSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, -(Self.hitSize - Self.headerRowHeight) / 2)
        .accessibilityLabel(Text(String(localized: "Today")))
    }

    /// A Button(intent:) when there is a day to go to; a dimmed chevron at
    /// either end of the grid (and in the gallery placeholder).
    @ViewBuilder
    private func arrow(to target: String?, systemImage: String, label: String) -> some View {
        let glyph = Image(systemName: systemImage)
            .font(.system(size: 14, weight: .semibold))
            .frame(width: Self.hitSize, height: Self.hitSize)
            .contentShape(Rectangle())
            .padding(.vertical, -(Self.hitSize - Self.headerRowHeight) / 2)
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
}
