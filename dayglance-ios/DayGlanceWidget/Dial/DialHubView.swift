import SwiftUI
import UIKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — the hub, Phase 3 (handoff §2 "Hub", §5 "Hub").
//
// The centre stack: weekday eyebrow, serif date, rule, the current block's
// title, its tag, "until HH:MM", "Xh Ym left", and the runway line. A SwiftUI
// OVERLAY on the cached face, never part of the PNG: the current block and
// the countdown change per timeline entry, so baking them in would
// invalidate the cache every entry instead of every block boundary, and
// the countdown is a live Text (Phase 4, below). The cache key is untouched.
//
// THE COUNTDOWN is three rows: the title, "until 19:00", and the time left.
// The last is LIVE on iOS 18: `Text(.currentDate, format: .offset(to:))`
// restricted to hours and minutes, which the system re-renders every minute
// with no timeline entry and never with seconds, spliced into the SAME
// localized phrase (the catalog string is formatted with a marker in the
// duration's place and split around it, so the words stay translated and
// the number is system updated). Phase 4 shipped `Text(end, style:
// .relative)`, which counts seconds under an hour and read as noise on the
// phone; a static form was exact only at each entry, so up to a quarter of
// an hour old between them. Below iOS 18 the static rounded form is drawn
// ("17m left"). The live form spells its units, so the row may shrink to
// 0.8 like the title before it truncates. It never counts past zero: the
// block's end is itself a timeline entry (DialTimeline). `countdownEnd`
// nil (the preview's fixed instants, App Store screenshots) keeps it static.
//
// Rows are placed by BASELINE, as the spec's SVG text is (DialSpec.Hub):
// the eyebrow, date and title at the spec's own y, the rows under the title
// stacked at DialSpec.Hub.rowBaseline so each state uses only the rows it
// has. Each row's width is bounded by the chord of the hub circle at its
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

    /// One row of the stack below the title: styled text, the UIFont its
    /// baseline is computed from, and how far it may shrink before it
    /// truncates.
    struct HubRow {
        var text: Text
        var metrics: UIFont
        var minimumScale: CGFloat = 1
    }

    var body: some View {
        let rows = self.rows()
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

            if let title = rows.title {
                row(title.text, baseline: H.titleY, metrics: title.metrics, minimumScale: title.minimumScale)
            }
            ForEach(Array(rows.stack.enumerated()), id: \.offset) { i, r in
                row(r.text, baseline: H.rowBaseline(i), metrics: r.metrics, minimumScale: r.minimumScale)
            }
        }
        .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
    }

    // MARK: the rows, by status

    private var titleFont: Font { .system(size: H.titleFontSize, weight: .semibold) }
    private var titleMetrics: UIFont { UIFont.systemFont(ofSize: H.titleFontSize, weight: .semibold) }

    /// The title row and the stack under it. Rows STACK from the title at
    /// `DialSpec.Hub.rowBaseline`, each state contributing only the rows it
    /// has: for a current block that is tag?, "until 19:00", "17m left",
    /// runway?, then the projected note for any status. The end time has a
    /// line of its own (the two-line "until 19:00 · 17m left" was the first
    /// device run's complaint), and a state with fewer rows closes up under
    /// the title.
    func rows() -> (title: HubRow?, stack: [HubRow]) {
        var title: HubRow? = nil
        var stack: [HubRow] = []
        switch status {
        case .placeholder:
            break
        case .setUp:
            stack.append(detailRow(Text(verbatim: String(localized: "Open dayGLANCE to set up"))))
        case let .outdated(detail):
            title = statusRow(String(localized: "Outdated"))
            if let detail { stack.append(detailRow(Text(verbatim: detail))) }
        case .zoneChanged:
            title = statusRow(String(localized: "Time zone changed"))
            stack.append(detailRow(Text(verbatim: String(localized: "Open dayGLANCE to refresh"))))
        case .live:
            if let c = state.current {
                title = HubRow(text: Text(verbatim: c.title).font(titleFont).foregroundStyle(Color.white.opacity(H.titleOpacity)),
                               metrics: titleMetrics, minimumScale: DialHubTypography.titleMinimumScale)
                if let tag = c.tag {
                    stack.append(HubRow(text: Text(verbatim: "#\(tag)").font(.system(size: H.tagFontSize)).italic()
                                            .foregroundStyle(Color.white.opacity(H.tagOpacity)),
                                        metrics: UIFont.systemFont(ofSize: H.tagFontSize)))
                }
                stack.append(detailRow(Text(verbatim: untilText(c))))
                let left = leftRow(c)
                // The live form spells its units, so it may shrink before it truncates.
                stack.append(detailRow(left.text, minimumScale: left.live ? DialHubTypography.titleMinimumScale : 1))
                if let runway = state.runwayMinutes {
                    stack.append(HubRow(text: Text(verbatim: runwayText(runway, toSleep: state.runwayEndsAtSleep))
                                            .font(.system(size: H.runwayFontSize))
                                            .foregroundStyle(Color(hex: H.runwayColorHex).opacity(H.runwayOpacity)),
                                        metrics: UIFont.systemFont(ofSize: H.runwayFontSize)))
                }
            } else if let s = state.sleep {
                // "Sleep", muted rather than teal: it is context, not a task.
                title = HubRow(text: Text(verbatim: String(localized: "Sleep")).font(titleFont).foregroundStyle(Color.white.opacity(H.sleepOpacity)),
                               metrics: titleMetrics)
                stack.append(detailRow(Text(verbatim: sleepText(s))))
            } else if let o = state.open {
                // Open time in the runway's teal, live like the countdown.
                let open = openTitle(o)
                title = HubRow(text: open.text.font(titleFont).foregroundStyle(Color(hex: H.openColorHex).opacity(H.titleOpacity)),
                               metrics: titleMetrics, minimumScale: DialHubTypography.titleMinimumScale)
                stack.append(detailRow(Text(verbatim: openDetail(o))))
            }
        }
        if let plannedAsOf {
            stack.append(HubRow(text: Text(verbatim: plannedAsOf).font(.system(size: H.noteFontSize))
                                    .foregroundStyle(Color.white.opacity(H.noteOpacity)),
                                metrics: UIFont.systemFont(ofSize: H.noteFontSize),
                                minimumScale: DialHubTypography.titleMinimumScale))
        }
        return (title, stack)
    }

    private func statusRow(_ text: String) -> HubRow {
        HubRow(text: Text(verbatim: text).font(titleFont).foregroundStyle(Color(hex: H.statusColorHex).opacity(H.titleOpacity)),
               metrics: titleMetrics)
    }

    /// A detail row: 11.5pt, white at 58 % (the spec's countdown style).
    private func detailRow(_ text: Text, minimumScale: CGFloat = 1) -> HubRow {
        HubRow(text: text.font(.system(size: H.countdownFontSize)).foregroundStyle(Color.white.opacity(H.countdownOpacity)),
               metrics: UIFont.systemFont(ofSize: H.countdownFontSize), minimumScale: minimumScale)
    }

    // MARK: copy

    /// "until 19:00": the block's end, on a row of its own.
    func untilText(_ c: DialHubCurrent) -> String {
        String(localized: "until \(DialHubClock.text(minutesOfDay: c.endMin, use24Hour: use24Hour, reference: date))")
    }

    /// "1h 10m left", the static rounded form.
    func leftText(_ c: DialHubCurrent) -> String {
        String(localized: "\(DialHubClock.duration(minutes: c.minutesLeft)) left")
    }

    /// The row under "until": live to the minute when there is an end
    /// instant and the platform has the minute-precision text (iOS 18),
    /// else the static form. `live` says which, for the row's minimum scale.
    func leftRow(_ c: DialHubCurrent) -> (text: Text, live: Bool) {
        if let end = countdownEnd, let live = Self.live(phrase: String(localized: "\(Self.durationMarker) left"), end: end) {
            return (live, true)
        }
        return (Text(verbatim: leftText(c)), false)
    }

    /// A private-use character no translation contains, standing in for the
    /// duration while the phrase is split around it.
    static let durationMarker = "\u{F8FF}"

    /// "35m open" — live to the minute when `openEnd` is set (iOS 18).
    func openTitle(_ o: DialHubOpen) -> (text: Text, live: Bool) {
        if let end = openEnd, let live = Self.live(phrase: String(localized: "\(Self.durationMarker) open"), end: end) {
            return (live, true)
        }
        return (Text(verbatim: openText(o)), false)
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
        let room = H.width(atY: H.rowBaseline(0), inset: DialHubTypography.chordInset)
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

    /// The translated words around a system-updated duration, or nil where
    /// the platform has no minute-precision text (the caller draws the
    /// static form).
    private static func live(phrase: String, end: Date) -> Text? {
        guard let range = phrase.range(of: durationMarker), let duration = liveDuration(to: end) else { return nil }
        return Text(verbatim: String(phrase[..<range.lowerBound]))
            + duration
            + Text(verbatim: String(phrase[range.upperBound...]))
    }

    /// iOS 18: the system's offset text restricted to hours and minutes,
    /// re-rendered every minute with no timeline entry and never showing
    /// seconds ("17 minutes", "1 hour, 5 minutes"). The relative style it
    /// replaces counted seconds under an hour, which is what the first
    /// device run rejected. Below iOS 18 there is no such text: nil.
    private static func liveDuration(to end: Date) -> Text? {
        if #available(iOS 18.0, *) {
            return Text(.currentDate, format: SystemFormatStyle.DateOffset(to: end, allowedFields: [.hour, .minute],
                                                                            maxFieldCount: 2, sign: .never))
        }
        return nil
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
