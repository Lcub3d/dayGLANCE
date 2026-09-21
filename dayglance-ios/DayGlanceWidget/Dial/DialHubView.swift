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
// THE COUNTDOWN (Phase 4, decided for the live Text). Entries are 15 minutes
// apart, so a static "1h 10m left" would read "1h 10m" for up to a quarter
// of an hour after it stopped being true. With `countdownEnd` set the
// duration is `Text(end, style: .relative)`, which the system re-renders
// every minute with no timeline entry, inside the SAME localized phrase:
// the catalog string is formatted with a marker in the duration's place and
// split around it, so the words around the number stay translated and the
// number is live. The system's relative style spells its units ("1 hour,
// 10 minutes" where the static form says "1h 10m"), so the live row may
// shrink like the title before it truncates. It never counts past zero: the
// block's end is itself a timeline entry (DialTimeline), which replaces the
// row. `countdownEnd` nil (the preview, App Store screenshots) keeps the
// static, rounded form.
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
/// snapshot's `use24Hour` when it carries one, else the device's setting.
enum DialHubClock {
    static func text(minutesOfDay: Double, use24Hour: Bool?, calendar: Calendar = .current, reference: Date = Date()) -> String {
        let total = Int(minutesOfDay.rounded()) % Int(DialGeometry.dayMinutes)
        let m = (total + Int(DialGeometry.dayMinutes)) % Int(DialGeometry.dayMinutes)
        let date = calendar.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: reference) ?? reference
        var style = Date.FormatStyle().minute()
        switch use24Hour {
        case .some(true): style = style.hour(.twoDigits(amPM: .omitted))
        case .some(false): style = style.hour(.defaultDigits(amPM: .abbreviated))
        case .none: style = style.hour()
        }
        return date.formatted(style)
    }

    /// "1h 10m", "45m", "2h" — hours and minutes in the locale's own narrow
    /// units, zero units hidden. System formatting, so no hand-written
    /// plurals to get wrong per language.
    static func duration(minutes: Double) -> String {
        Duration.seconds(Int(minutes.rounded()) * 60)
            .formatted(.units(allowed: [.hours, .minutes], width: .narrow))
    }
}

struct DialHubView: View {
    /// The entry's day, for the eyebrow and the date row.
    let date: Date
    let state: DialHubState
    let use24Hour: Bool?
    /// The current block's end as an instant. Set: the countdown is live.
    var countdownEnd: Date? = nil

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
                    row(Text(verbatim: runwayText(runway))
                            .font(.system(size: H.runwayFontSize))
                            .foregroundStyle(Color(hex: H.runwayColorHex).opacity(H.runwayOpacity)),
                        baseline: H.runwayY,
                        metrics: UIFont.systemFont(ofSize: H.runwayFontSize))
                }
            }
        }
        .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
    }

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
    private static let durationMarker = "\u{F8FF}"

    /// The countdown row's Text: static when there is no end instant, live
    /// (the translated words around a system-updated duration) when there is.
    func countdown(_ c: DialHubCurrent) -> Text {
        guard let end = countdownEnd else { return Text(verbatim: countdownText(c)) }
        let phrase = countdownPhrase(c, duration: Self.durationMarker)
        guard let range = phrase.range(of: Self.durationMarker) else { return Text(verbatim: countdownText(c)) }
        return Text(verbatim: String(phrase[..<range.lowerBound]))
            + Text(end, style: .relative)
            + Text(verbatim: String(phrase[range.upperBound...]))
    }

    /// "then 1h open", through the string catalog.
    func runwayText(_ minutes: Double) -> String {
        String(localized: "then \(DialHubClock.duration(minutes: minutes)) open")
    }

    /// One row: a single line, centred on the dial's axis with its baseline
    /// at `baseline`, no wider than the hub's chord there; it shrinks to
    /// `minimumScale` (the title only) and then truncates with an ellipsis.
    private func row(_ text: Text, baseline: Double, metrics: UIFont, minimumScale: CGFloat = 1) -> some View {
        text
            .lineLimit(1)
            .truncationMode(.tail)
            .minimumScaleFactor(minimumScale)
            .frame(maxWidth: H.width(atY: baseline, inset: DialHubTypography.chordInset))
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
