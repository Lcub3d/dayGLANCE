import Foundation
import CryptoKit
import UIKit
import os

// Day Dial render-budget spike — support: the mode flag, the log channel,
// and the memory probes. See DialSpikeWidget.swift for what the spike is
// and how to read it. Nothing in this folder ships: the widget is only
// registered in DayGlanceWidgetBundle under `#if DIAL_SPIKE`.

/// Which rendering strategy this build exercises. Both compile in every
/// build — the flag only picks — so neither path can rot while the other is
/// being measured.
enum DialSpikeMode: String {
    /// (a) every timeline entry draws all ~985 static shapes itself.
    case livePaths
    /// (b) the static face is rendered once with ImageRenderer and cached in
    /// the App Group; each entry is that image + a rotated needle + one
    /// past-dimming sector.
    case cachedImage
}

#if DIAL_SPIKE_LIVE_PATHS
let dialSpikeMode = DialSpikeMode.livePaths
#else
let dialSpikeMode = DialSpikeMode.cachedImage
#endif

enum DialSpikeLog {
    /// Same subsystem as WidgetBridge, so one Console filter shows the app
    /// pushing a snapshot and the extension rendering it.
    static let subsystem = "com.dayglance.app"
    static let category = "dialspike"
    static let logger = Logger(subsystem: subsystem, category: category)
    static let signposter = OSSignposter(subsystem: subsystem, category: category)

    /// Bytes the process may still allocate before the extension's memory
    /// limit (the ~30 MB WidgetBridge.swift talks about) kills it. This is
    /// the number to watch: it counts down toward the kill, whatever the
    /// limit happens to be on the device under test.
    static func availableMemoryMB() -> Double {
        Double(os_proc_available_memory()) / 1_048_576
    }

    /// The process's physical footprint, the figure jetsam judges by.
    static func footprintMB() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(
            MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) { ptr in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return -1 }
        return Double(info.phys_footprint) / 1_048_576
    }

    /// Short, stable hex digest for cache keys. Hasher is randomly seeded per
    /// process, so it cannot name a file that must be found again next launch.
    static func digest(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }
}
