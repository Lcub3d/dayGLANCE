import SwiftUI
import UIKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — the hub, Phase 3 (handoff §2 "Hub", §5 "Hub").
//
// The centre stack: weekday eyebrow, serif date, rule, the current block's
// title, its tag, "until HH:MM · Xh Ym left", and the runway line. A SwiftUI
// OVERLAY on the cached face, never part of the PNG: the current block and
// the countdown change per timeline entry, so baking them in would
// invalidate the cache every entry instead of every block boundary, and
// the countdown is a live Text (Phase 4, below). The cache key is untouched.
//
// THE COUNTDOWN. The widget draws the STATIC rounded form ("1h 10m left"),
// exact at each timeline entry: the grid is 15 minutes with an entry at
// every block boundary (DialTimeline), so the number is at most a quarter
// of an hour old and never counts past zero. The live alternative is still
// here: with `countdownEnd` (or `openEnd`) set the duration is `Text(end,
// style: .relative)`, spliced into the SAME localized phrase (the catalog
// string is formatted with a marker in the duration's place and split
// around it, so the words stay translated and the number is system
// updated). Phase 4 shipped it live and Phase 5 turned it off: under an
// hour the system's relative style counts seconds ("17 min, 37 sec"), which
// read as noise on the phone, and it spells the units, so the row shrank
// before it truncated.
//
// Rows are placed by BASELINE, as the spec's SVG text is (DialSpec.Hub),
// and each row's width is bounded by the chord of the hub circle at its
// baseline (DialSpec.Hub.width(atY:)), so a row further from the centre
// line gets less room. The one piece of arithmetic here is converting a
// baseline to the frame centre `.position` wants, which needs the font's
// own metrics and so cannot live in the geometry package.
//
// Type sizes are FIXED, not Dynamic Type: the geometry is fixed, and an
// accessibility size would overflow the circle rather than help. The list
// widgets (Up Next, Goal, Project) use text styles and do scale; the dial
// is deliberately the exception, and the title gets a minimum scale factor
// before it truncates.
// ─────────────────────────────────────────────────────────────────────────────

enum DialHubTypography {
    /// How far a row's text may shrink before tail truncation.
    static let titleMinimumScale: CGFloat = 0.8
    /// Breathing room between a row's ends and the sky ring, in points.
    static let chordInset: Double = 6

    /// Lora 500, fixed size (a `Font.custom(_:size:)` would scale with
    /// Dynamic Type). Falls back to the system serif when the face is not
    /// registered, so a broken bundle shows a date rather than nothing.
    static func dateFont(size: Double) -> Font {
        loraIsInstalled ? Font.custom(DialSpec.Hub.dateFontName, fixedSize: size)
                        : Font.system(size: size, weight: .medium, design: .serif)
    }

    /// Whether the bundled face is really registered in THIS process. The
    /// system serif is close enough to Lora to fool a glance, so the preview
    /// prints this in its corner and nobody has to squint.
    static var loraIsInstalled: Bool {
        UIFont(name: DialSpec.Hub.dateFontName, size: DialSpec.Hub.dateFontSize) != nil
    }

    static func dateUIFont(size: Double) -> UIFont {
        UIFont(name: DialSpec.Hub.dateFontName, size: size) ?? UIFont.systemFont(ofSize: size, weight: .medium)
    }

    /// Where a text frame's centre must sit for its baseline to land on
    /// `baseline`. A single line is ascender + |descender| (+ leading) tall
    /// with the baseline `ascender` below the top, so the centre is
    /// (ascender + descender) / 2 above the baseline (descender is negative).
    static func centerY(forBaseline baseline: Double, font: UIFont) -> Double {
        baseline - Double(font.ascender + font.descender) / 2 + Double(font.leading) / 2
    }
}

/// Clock text for a minute of the day, following the app's 24-hour
/// preference the way the other widgets and WidgetFreshness do: the
/// snapshot's `use24Hour` when it carries one, else the device's setting
/// (ClockPreference, which sets the locale's hour cycle, not just the field).
enum DialHubClock {
    static func text(minutesOfDay: Double, use24Hour: Bool?, calendar: Calendar = .current, reference: Date = Date()) -> String {
        let total = Int(minutesOfDay.rounded()) % Int(DialGeometry.dayMinutes)
        let m = (total + Int(DialGeometry.dayMinutes)) % Int(DialGeometry.dayMinutes)
        let date = calendar.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: reference) ?? reference
        return date.formatted(ClockPreference.hour(Date.FormatStyle().minute(), use24Hour: use24Hour))
    }

    /// "1h 10m", "45m", "2h" — hours and minutes in the locale's own narrow
    /// units, zero units hidden. System formatting, so no hand-written
    /// plurals to get wrong per language. `.wide` ("1 hour, 10 minutes") is
    /// what VoiceOver reads.
    static func duration(minutes: Double, width: Duration.UnitsFormatStyle.UnitWidth = .narrow) -> String {
        Duration.seconds(Swift.max(0, Int(minutes.rounded())) * 60)
            .formatted(.units(allowed: [.hours, .minutes], width: width))
    }
}

/// What the hub's task rows show (Phase 5). The eyebrow, date and rule are
/// always drawn; these decide the rest.
enum DialHubStatus: Equatable {
    /// A real day: the current block, sleep, or open time from `state`.
    case live
    /// The gallery and the pre-data render: weekday and date only.
    case placeholder
    /// Installed, never opened: the placeholder plus a line saying so.
    case setUp
    /// The payload is for another day: "Outdated" and its detail take the
    /// task rows; the face is dimmed by the caller, the needle stays.
    case outdated(detail: String?)
    /// The payload's clock minutes are in another zone's wall clock.
    case zoneChanged
}

struct DialHubView: View {
    /// The entry's day, for the eyebrow and the date row.
    let date: Date
    let state: DialHubState
    let use24Hour: Bool?
    /// The current block's end as an instant. Set: the countdown is live.
    var countdownEnd: Date? = nil
    /// Open time's end as an instant. Set: "35m open" is live.
    var openEnd: Date? = nil
    var status: DialHubStatus = .live
    /// The projected tier's soft note ("Planned as of Mon 8:42 PM"): the
    /// lowest, smallest row, so the task rows read first.
    var plannedAsOf: String? = nil

    private typealias H = DialSpec.Hub

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Eyebrow: the weekday, upper-cased in the locale.
            row(Text(verbatim: date.formatted(Date.FormatStyle().weekday(.wide)).uppercased(with: Locale.current))
                    .font(.system(size: H.eyebrowFontSize, weight: .semibold))
                    .tracking(H.eyebrowTracking)
                    .foregroundStyle(Color.white.opacity(H.eyebrowOpacity)),
                baseline: H.eyebrowY,
                metrics: UIFont.systemFont(ofSize: H.eyebrowFontSize, weight: .semibold))

            // Date: Lora 500, "July 7" in the locale's own order.
            row(Text(date, format: Date.FormatStyle().month(.wide).day())
                    .font(DialHubTypography.dateFont(size: H.dateFontSize))
                    .foregroundStyle(Color.white.opacity(H.dateOpacity)),
                baseline: H.dateY,
                metrics: DialHubTypography.dateUIFont(size: H.dateFontSize))

            rule

            switch status {
            case .placeholder:
                EmptyView()
            case .setUp:
                countdownRow(Text(verbatim: String(localized: "Open dayGLANCE to set up")))
            case let .outdated(detail):
                statusRow(String(localized: "Outdated"))
                if let detail { countdownRow(Text(verbatim: detail)) }
            case .zoneChanged:
                statusRow(String(localized: "Time zone changed"))
                countdownRow(Text(verbatim: String(localized: "Open dayGLANCE to refresh")))
            case .live:
                liveRows
            }

            if let plannedAsOf {
                row(Text(verbatim: plannedAsOf)
                        .font(.system(size: H.noteFontSize))
                        .foregroundStyle(Color.white.opacity(H.noteOpacity)),
                    baseline: H.noteY,
                    metrics: UIFont.systemFont(ofSize: H.noteFontSize),
                    minimumScale: DialHubTypography.titleMinimumScale)
            }
        }
        .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
    }

    // MARK: the live rows: current block, sleep, or open time

    @ViewBuilder private var liveRows: some View {
        if let c = state.current {
            row(Text(verbatim: c.title)
                    .font(.system(size: H.titleFontSize, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(H.titleOpacity)),
                baseline: H.titleY,
                metrics: UIFont.systemFont(ofSize: H.titleFontSize, weight: .semibold),
                minimumScale: DialHubTypography.titleMinimumScale)

            if let tag = c.tag {
                row(Text(verbatim: "#\(tag)")
                        .font(.system(size: H.tagFontSize))
                        .italic()
                        .foregroundStyle(Color.white.opacity(H.tagOpacity)),
                    baseline: H.tagY,
                    metrics: UIFont.systemFont(ofSize: H.tagFontSize))
            }

            row(countdown(c)
                    .font(.system(size: H.countdownFontSize))
                    .foregroundStyle(Color.white.opacity(H.countdownOpacity)),
                baseline: H.countdownY,
                metrics: UIFont.systemFont(ofSize: H.countdownFontSize),
                minimumScale: countdownEnd == nil ? 1 : DialHubTypography.titleMinimumScale)

            if let runway = state.runwayMinutes {
                row(Text(verbatim: runwayText(runway, toSleep: state.runwayEndsAtSleep))
                        .font(.system(size: H.runwayFontSize))
                        .foregroundStyle(Color(hex: H.runwayColorHex).opacity(H.runwayOpacity)),
                    baseline: H.runwayY,
                    metrics: UIFont.systemFont(ofSize: H.runwayFontSize))
            }
        } else if let s = state.sleep {
            // "Sleep", muted rather than teal: it is context, not a task.
            row(Text(verbatim: String(localized: "Sleep"))
                    .font(.system(size: H.titleFontSize, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(H.sleepOpacity)),
                baseline: H.titleY,
                metrics: UIFont.systemFont(ofSize: H.titleFontSize, weight: .semibold))
            countdownRow(Text(verbatim: sleepText(s)))
        } else if let o = state.open {
            // Open time in the runway's teal, live like the countdown.
            row(openTitle(o)
                    .font(.system(size: H.titleFontSize, weight: .semibold))
                    .foregroundStyle(Color(hex: H.openColorHex).opacity(H.titleOpacity)),
                baseline: H.titleY,
                metrics: UIFont.systemFont(ofSize: H.titleFontSize, weight: .semibold),
                minimumScale: DialHubTypography.titleMinimumScale)
            countdownRow(Text(verbatim: openDetail(o)))
        }
    }

    private func statusRow(_ text: String) -> some View {
        row(Text(verbatim: text)
                .font(.system(size: H.titleFontSize, weight: .semibold))
                .foregroundStyle(Color(hex: H.statusColorHex).opacity(H.titleOpacity)),
            baseline: H.titleY,
            metrics: UIFont.systemFont(ofSize: H.titleFontSize, weight: .semibold))
    }

    private func countdownRow(_ text: Text) -> some View {
        row(text
                .font(.system(size: H.countdownFontSize))
                .foregroundStyle(Color.white.opacity(H.countdownOpacity)),
            baseline: H.countdownY,
            metrics: UIFont.systemFont(ofSize: H.countdownFontSize))
    }

    // MARK: copy

    /// "until 12:30 · 1h 10m left", through the string catalog.
    func countdownText(_ c: DialHubCurrent) -> String {
        countdownPhrase(c, duration: DialHubClock.duration(minutes: c.minutesLeft))
    }

    /// The catalog phrase with `duration` in the second slot.
    private func countdownPhrase(_ c: DialHubCurrent, duration: String) -> String {
        let clock = DialHubClock.text(minutesOfDay: c.endMin, use24Hour: use24Hour, reference: date)
        return String(localized: "until \(clock) · \(duration) left")
    }

    /// A private-use character no translation contains, standing in for the
    /// duration while the phrase is split around it.
    static let durationMarker = "\u{F8FF}"

    /// The countdown row's Text: static when there is no end instant, live
    /// (the translated words around a system-updated duration) when there is.
    func countdown(_ c: DialHubCurrent) -> Text {
        guard let end = countdownEnd else { return Text(verbatim: countdownText(c)) }
        return Self.live(phrase: countdownPhrase(c, duration: Self.durationMarker), end: end)
            ?? Text(verbatim: countdownText(c))
    }

    /// "35m open" — live when `openEnd` is set.
    func openTitle(_ o: DialHubOpen) -> Text {
        if let end = openEnd, let live = Self.live(phrase: String(localized: "\(Self.durationMarker) open"), end: end) {
            return live
        }
        return Text(verbatim: openText(o))
    }

    func openText(_ o: DialHubOpen) -> String {
        String(localized: "\(DialHubClock.duration(minutes: o.minutesUntil)) open")
    }

    /// What ends the open time: "until Lunch at 12:30", "until sleep at
    /// 23:00", or "Nothing else today". The title is cut to the room the
    /// phrase leaves it (Phase 3's chord rule), so the time always survives.
    func openDetail(_ o: DialHubOpen) -> String {
        guard let end = o.endMin else { return String(localized: "Nothing else today") }
        let clock = DialHubClock.text(minutesOfDay: end, use24Hour: use24Hour, reference: date)
        if o.nextIsSleep { return String(localized: "until sleep at \(clock)") }
        let font = UIFont.systemFont(ofSize: H.countdownFontSize)
        let room = H.width(atY: H.countdownY, inset: DialHubTypography.chordInset)
        let frame = String(localized: "until \("") at \(clock)")
        let title = DialHubTypography.fit(o.nextTitle ?? "", width: room - DialHubTypography.width(of: frame, font: font), font: font)
        return String(localized: "until \(title) at \(clock)")
    }

    /// "until 06:25", the sleep row.
    func sleepText(_ s: DialHubSleep) -> String {
        String(localized: "until \(DialHubClock.text(minutesOfDay: s.endMin, use24Hour: use24Hour, reference: date))")
    }

    /// "then 1h open", or "then 1h until sleep" when the gap ends at bedtime.
    func runwayText(_ minutes: Double, toSleep: Bool) -> String {
        let d = DialHubClock.duration(minutes: minutes)
        return toSleep ? String(localized: "then \(d) until sleep") : String(localized: "then \(d) open")
    }

    /// The translated words around a system-updated relative duration.
    private static func live(phrase: String, end: Date) -> Text? {
        guard let range = phrase.range(of: durationMarker) else { return nil }
        return Text(verbatim: String(phrase[..<range.lowerBound]))
            + Text(end, style: .relative)
            + Text(verbatim: String(phrase[range.upperBound...]))
    }

    // MARK: VoiceOver

    /// One spoken summary for the whole widget, so VoiceOver never walks the
    /// paths: "Monday, September 21. Now: Write API documentation, 1 hour,
    /// 10 minutes left. Then 4 hours, 30 minutes open." Same catalog strings
    /// as the rows, wide durations.
    static func summary(date: Date, state: DialHubState, use24Hour: Bool?, status: DialHubStatus,
                        plannedAsOf: String?) -> String {
        var parts = [date.formatted(Date.FormatStyle().weekday(.wide).month(.wide).day())]
        let wide = { (m: Double) in DialHubClock.duration(minutes: m, width: .wide) }
        let clock = { (m: Double) in DialHubClock.text(minutesOfDay: m, use24Hour: use24Hour, reference: date) }
        switch status {
        case .placeholder:
            break
        case .setUp:
            parts.append(String(localized: "Open dayGLANCE to set up"))
        case let .outdated(detail):
            parts.append(([String(localized: "Outdated")] + [detail].compactMap { $0 }).joined(separator: ", "))
        case .zoneChanged:
            parts.append(String(localized: "Time zone changed"))
            parts.append(String(localized: "Open dayGLANCE to refresh"))
        case .live:
            if let c = state.current {
                parts.append(String(localized: "Now: \(c.title)") + ", " + String(localized: "\(wide(c.minutesLeft)) left"))
                if let r = state.runwayMinutes {
                    parts.append(state.runwayEndsAtSleep ? String(localized: "then \(wide(r)) until sleep")
                                                         : String(localized: "then \(wide(r)) open"))
                }
            } else if let s = state.sleep {
                parts.append(String(localized: "Sleep") + ", " + String(localized: "until \(clock(s.endMin))"))
            } else if let o = state.open {
                var line = String(localized: "\(wide(o.minutesUntil)) open")
                if let end = o.endMin {
                    line += ", " + (o.nextIsSleep ? String(localized: "until sleep at \(clock(end))")
                                                  : String(localized: "until \(o.nextTitle ?? "") at \(clock(end))"))
                } else {
                    line += ", " + String(localized: "Nothing else today")
                }
                parts.append(line)
            }
        }
        if let plannedAsOf { parts.append(plannedAsOf) }
        return parts.joined(separator: ". ") + "."
    }

    /// One row: a single line, centred on the dial's axis with its baseline
    /// at `baseline`, no wider than the hub's chord there; it shrinks to
    /// `minimumScale` (the title only) and then truncates with an ellipsis.
    ///
    /// The text alignment is not redundant with the centred frame: a live
    /// `Text(date, style: .relative)` reserves the widest width its value
    /// can take so the row never jitters as it counts, and lays its visible
    /// words leading-aligned inside that frame. The frame was centred; the
    /// words were not, and the countdown row sat left of the axis on device.
    private func row(_ text: Text, baseline: Double, metrics: UIFont, minimumScale: CGFloat = 1) -> some View {
        text
            .lineLimit(1)
            .truncationMode(.tail)
            .minimumScaleFactor(minimumScale)
            .multilineTextAlignment(.center)
            .frame(maxWidth: H.width(atY: baseline, inset: DialHubTypography.chordInset), alignment: .center)
            .position(x: DialSpec.cx, y: DialHubTypography.centerY(forBaseline: baseline, font: metrics))
    }

    /// The 68pt rule, collinear with the 06/18 tick row.
    private var rule: some View {
        var p = Path()
        p.move(to: CGPoint(x: DialSpec.cx - H.ruleHalfWidth, y: H.ruleY))
        p.addLine(to: CGPoint(x: DialSpec.cx + H.ruleHalfWidth, y: H.ruleY))
        return p.stroke(Color.white.opacity(H.ruleOpacity), lineWidth: H.ruleLineWidth)
    }
}

extension DialHubTypography {
    /// Measured width of `text` in `font`, for fitting one part of a phrase.
    static func width(of text: String, font: UIFont) -> Double {
        Double((text as NSString).size(withAttributes: [.font: font]).width)
    }

    /// `text` cut with an ellipsis to fit `width` in `font`; the whole text
    /// when it already fits. Measured, not estimated, so a wide title is cut
    /// where it actually overflows.
    static func fit(_ text: String, width: Double, font: UIFont) -> String {
        guard width > 0 else { return "…" }
        if self.width(of: text, font: font) <= width { return text }
        var chars = Array(text)
        while !chars.isEmpty {
            chars.removeLast()
            let candidate = String(chars).trimmingCharacters(in: .whitespaces) + "…"
            if self.width(of: candidate, font: font) <= width { return candidate }
        }
        return "…"
    }
}
