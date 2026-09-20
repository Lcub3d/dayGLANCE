import Foundation

/// The bezel's tick schedule. Port of dialTicks in dayDial.js, generalised by
/// step so one function serves both dials:
///
///   - the web dial: a tick every 5 minutes, `hour` / `quarter` / `minor`
///     (288 ticks; what the vectors pin, `schedule()` with the default step);
///   - the widget spec (docs/day-dial-widget-spec.html): 24 major ticks on
///     the hour and 3 minor per hour at 15 minutes, nothing finer
///     (`schedule(stepMinutes: 15)`: the `hour` kind is the spec's major, the
///     `quarter` kind its minor, and no `minor` is produced).
///
/// The two dials disagree here and the spec wins for the widget; both are
/// kept because the vectors are the web schedule. See DialSpec.ticks.
public struct DialTick: Equatable {
    public enum Kind: String { case hour, quarter, minor }
    public var minutes: Int
    public var kind: Kind
    public init(minutes: Int, kind: Kind) { self.minutes = minutes; self.kind = kind }
}

public enum DialTicks {
    public static func schedule(stepMinutes: Int = 5) -> [DialTick] {
        precondition(stepMinutes > 0)
        var ticks: [DialTick] = []
        var min = 0
        while min < Int(DialGeometry.dayMinutes) {
            let kind: DialTick.Kind = min % 60 == 0 ? .hour : (min % 15 == 0 ? .quarter : .minor)
            ticks.append(DialTick(minutes: min, kind: kind))
            min += stepMinutes
        }
        return ticks
    }
}
