import WidgetKit
import SwiftUI

struct UpNextEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct UpNextProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpNextEntry {
        UpNextEntry(date: Date(), snapshot: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (UpNextEntry) -> Void) {
        completion(UpNextEntry(date: Date(), snapshot: loadSnapshot()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<UpNextEntry>) -> Void) {
        // One snapshot, two entries: now and the next local midnight, so the
        // stale state flips on the minute (WidgetFreshness.swift).
        let snapshot = loadSnapshot()
        let entries = WidgetTimelineDates.withMidnightRollover().map { UpNextEntry(date: $0, snapshot: snapshot) }
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        completion(Timeline(entries: entries, policy: .after(next)))
    }
}

struct UpNextWidgetView: View {
    var entry: UpNextEntry
    @Environment(\.widgetFamily) var family

    // Against the entry's date, not the clock: the midnight entry is what
    // turns this true at 00:00 (see WidgetTimelineDates).
    private var freshness: WidgetFreshness { .of(entry.snapshot, at: entry.date) }

    var body: some View {
        if let task = entry.snapshot?.nextTask {
            taskView(task: task)
        } else {
            emptyView
        }
    }

    private var emptyView: some View {
        VStack(alignment: .leading, spacing: 4) {
            header
            if freshness.isStale {
                StaleBanner(freshness: freshness, use24Hour: entry.snapshot?.use24Hour)
            }
            Spacer()
            // "Nothing scheduled" is a claim about today; a stale snapshot
            // cannot make it.
            Text(freshness.isStale ? String(localized: "Open dayGLANCE to refresh") : String(localized: "Nothing scheduled"))
                .font(.caption)
                .foregroundColor(.secondary)
                .staleDimmed(freshness)
            Spacer()
        }
        .padding()
        .containerBackground(.background, for: .widget)
    }

    private func taskView(task: NextTaskData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if freshness.isStale {
                StaleBanner(freshness: freshness, use24Hour: entry.snapshot?.use24Hour)
            }
            Divider().padding(.vertical, 3)
            taskBody(task: task)
                .staleDimmed(freshness)
            // Pack everything to the top; leftover space falls to the bottom.
            Spacer(minLength: 0)
        }
        .padding()
        .containerBackground(.background, for: .widget)
    }

    // The task itself stays visible on a stale snapshot — it is what the user
    // last saw, and hiding it would look like data loss — but dimmed, and with
    // the buttons gone (see below).
    @ViewBuilder
    private func taskBody(task: NextTaskData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(hex: task.colorHex ?? "#3b82f6"))
                    .frame(width: 3)
                    .padding(.vertical, 2)
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(task.title ?? "")
                            .font(.subheadline).fontWeight(.semibold)
                            .lineLimit(family == .systemLarge ? 3 : 2)
                        Spacer()
                        if let time = timeLabel(startTime: task.startTime, duration: task.duration) {
                            Text(time)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                    if let proj = task.projectName, !proj.isEmpty {
                        Text(proj)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    if let tags = task.tags, !tags.isEmpty {
                        Text(tags.map { "#\($0)" }.joined(separator: " "))
                            .font(.caption2)
                            .italic()
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    // Notes only on the large family, where there's room.
                    if family == .systemLarge, let notes = task.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(3)
                            .padding(.top, 2)
                    }
                    // Action buttons. These open the app via a dayglance:// deep
                    // link (same mechanism as Quick Actions / Spotlight), which the
                    // web layer drains on foreground. AppIntent-based buttons that
                    // try to act in the background never reliably reached the web
                    // layer, so the task was never completed / focus never started.
                    //
                    // Not offered on a stale snapshot. "Done" would complete
                    // yesterday's task by id (possibly already completed on
                    // another device), and "Focus" would start a session on a
                    // block that ended a day ago. A disabled button is a dead
                    // control that still invites the tap, so instead the row
                    // says what the only useful action is: the widget's own tap
                    // opens the app, and foregrounding is exactly what pushes a
                    // fresh snapshot.
                    if freshness.isStale {
                        Text("Open dayGLANCE to refresh")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .padding(.top, 3)
                    } else {
                        HStack(spacing: 8) {
                            if let id = task.id?.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
                               let doneURL = URL(string: "dayglance://completeTask?id=\(id)") {
                                Link(destination: doneURL) {
                                    actionLabel(String(localized: "Done"), systemImage: "checkmark.circle")
                                }
                            }
                            if let focusURL = URL(string: "dayglance://startFocus") {
                                Link(destination: focusURL) {
                                    actionLabel("Focus", systemImage: "play.circle")
                                }
                            }
                        }
                        .padding(.top, 1)
                    }
                }
            }
            // Keep the main row at its natural height — the color bar is a
            // greedy shape that would otherwise stretch and shove the list below
            // it to the bottom of the widget.
            .fixedSize(horizontal: false, vertical: true)
            if let subtasks = task.subtasks, !subtasks.isEmpty {
                Divider().padding(.vertical, 3)
                ForEach(subtasks.prefix(family == .systemLarge ? 7 : 4), id: \.title) { sub in
                    HStack(spacing: 6) {
                        Image(systemName: sub.completed ? "checkmark.circle.fill" : "circle")
                            .font(.caption2)
                            .foregroundColor(sub.completed ? .green : .secondary)
                        Text(sub.title)
                            .font(.caption2)
                            .foregroundColor(sub.completed ? .secondary : .primary)
                            .lineLimit(1)
                    }
                }
            } else if !showsNotes(task), let upcoming = entry.snapshot?.upcomingTasks, !upcoming.isEmpty {
                // The primary task is simple, so fill the leftover space with the
                // next upcoming tasks (title + time only — no action buttons).
                Divider().padding(.vertical, 3)
                ForEach(upcoming.prefix(family == .systemLarge ? 4 : 2), id: \.id) { up in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color(hex: up.colorHex ?? "#3b82f6"))
                            .frame(width: 3, height: 14)
                        Text(up.title ?? "")
                            .font(.caption2)
                            .lineLimit(1)
                        Spacer()
                        if let time = timeLabel(startTime: up.startTime, duration: up.duration) {
                            Text(time)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
        }
    }

    // Notes are only rendered on the Large family, and only when present.
    private func showsNotes(_ task: NextTaskData) -> Bool {
        family == .systemLarge && !(task.notes?.isEmpty ?? true)
    }

    // A bordered-pill label used for the Done / Focus deep-link buttons.
    private func actionLabel(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption2)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.quaternary, in: Capsule())
    }

    private var header: some View {
        HStack {
            // "UP NEXT" is a claim about now; on a stale snapshot the pill
            // becomes the state. The date label stays: it is the snapshot's own
            // day, yesterday's on a stale one, which is the truth.
            Text(freshness.isStale ? String(localized: "OUTDATED") : String(localized: "UP NEXT"))
                .font(.caption2).fontWeight(.bold)
                .foregroundColor(freshness.isStale ? .orange : .secondary)
            Spacer()
            Text(entry.snapshot?.dateLabel ?? "")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }

    // Start time plus duration, e.g. "9:00AM · 30m". Falls back to just the
    // start time when no duration is set.
    private func timeLabel(startTime: String?, duration: Int?) -> String? {
        guard let time = formattedTime(startTime) else { return nil }
        if let d = duration, d > 0 { return "\(time) · \(formattedDuration(d))" }
        return time
    }

    private func formattedDuration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes)m" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "\(h)h" : "\(h)h\(m)m"
    }

    private func formattedTime(_ startTime: String?) -> String? {
        guard let st = startTime, !st.isEmpty else { return nil }
        let use24 = entry.snapshot?.use24Hour ?? false
        let parts = st.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return st }
        let h = parts[0], m = parts[1]
        if use24 { return String(format: "%02d:%02d", h, m) }
        let period = h < 12 ? "AM" : "PM"
        let h12 = h == 0 ? 12 : (h > 12 ? h - 12 : h)
        return m == 0 ? "\(h12)\(period)" : "\(h12):\(String(format: "%02d", m))\(period)"
    }
}

struct UpNextWidget: Widget {
    let kind = "UpNextWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpNextProvider()) { entry in
            UpNextWidgetView(entry: entry)
        }
        .configurationDisplayName("Up Next")
        .description("Your next scheduled task.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
