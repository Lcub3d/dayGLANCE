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
// Phase 4 needs the countdown to be a live Text. The cache key is untouched.
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

                row(Text(verbatim: countdownText(c))
                        .font(.system(size: H.countdownFontSize))
                        .foregroundStyle(Color.white.opacity(H.countdownOpacity)),
                    baseline: H.countdownY,
                    metrics: UIFont.systemFont(ofSize: H.countdownFontSize))

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
        let clock = DialHubClock.text(minutesOfDay: c.endMin, use24Hour: use24Hour, reference: date)
        let left = DialHubClock.duration(minutes: c.minutesLeft)
        return String(localized: "until \(clock) · \(left) left")
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
