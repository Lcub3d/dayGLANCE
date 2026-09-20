import SwiftUI
import UIKit
import os
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — the cached static face (handoff §6, decided in Phase 0).
//
// The face is rendered once through ImageRenderer and kept both in memory
// for this process and as a PNG in the App Group for the next one. Each
// timeline entry is that image plus the needle.
//
// THE KEY. Past/future now depends on the time, not only on the snapshot:
// a block changes state when it ends (variant C dims by state, not by a
// sector over the band). So the image is keyed on
//
//     renderVersion | digest(face input) | size@scale  +  "-b<n>"
//
// where n = DialBand.pastBucket: the number of blocks that have ended at the
// entry's minute. The ended set is a prefix of the blocks in end order, so
// its size names it exactly; two entries in the same bucket draw the same
// face, and the key changes precisely at each distinct block end — 8–12
// cold renders on a full day, against a 28 ms cold render measured in
// Phase 0. A tier change (pushed → projected) changes the input digest, so
// a projected morning never reuses last night's pushed face.
//
// The face input, not the raw snapshot, is what is digested: a push that
// only moved goals or the Up Next list leaves the image valid.
// ─────────────────────────────────────────────────────────────────────────────

enum DialFaceCache {
    /// Bump whenever anything in DialFaceView or the palette changes what
    /// the same input draws, or a stale PNG from the previous build is shown.
    static let renderVersion = "face-v1"

    static let logger = Logger(subsystem: "com.dayglance.app", category: "dialface")

    private static var memory: (key: String, image: UIImage)?

    enum Outcome: Equatable {
        case memory
        case disk(bytes: Int)
        case rendered(ms: Double, storedBytes: Int?)
        case failed

        /// Short form for a corner readout: "img mem" / "img disk" /
        /// "img cold 31ms" / "img FAILED".
        var summary: String {
            switch self {
            case .memory: return "img mem"
            case .disk: return "img disk"
            case let .rendered(ms, _): return "img cold \(Int(ms.rounded()))ms"
            case .failed: return "img FAILED"
            }
        }
    }

    static func directory() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: kAppGroupSuite)?
            .appendingPathComponent("dial-face", isDirectory: true)
    }

    /// The input's part of the key: everything but the bucket.
    static func facePrefix(input: DialFaceInput, size: CGSize, scale: CGFloat) -> String {
        "\(renderVersion)-\(input.digest)-\(Int(size.width))x\(Int(size.height))@\(scale)"
    }

    static func key(input: DialFaceInput, nowMin: Double, size: CGSize, scale: CGFloat) -> String {
        "\(facePrefix(input: input, size: size, scale: scale))-b\(DialBand.pastBucket(input.blocks, nowMin: nowMin))"
    }

    /// The face for one entry: memory, then the App Group PNG, then a fresh
    /// ImageRenderer pass (stored for next time). Main actor: ImageRenderer
    /// requires it.
    @MainActor
    static func image(input: DialFaceInput, nowMin: Double, size: CGSize, scale: CGFloat) -> (image: UIImage?, outcome: Outcome) {
        let k = key(input: input, nowMin: nowMin, size: size, scale: scale)
        if let memory, memory.key == k { return (memory.image, .memory) }

        let file = directory()?.appendingPathComponent("\(k).png")
        let pixelScale = scale * min(size.width / DialSpec.canvasWidth, size.height / DialSpec.canvasHeight)
        if let file, let data = try? Data(contentsOf: file), let img = UIImage(data: data, scale: pixelScale) {
            memory = (k, img)
            return (img, .disk(bytes: data.count))
        }

        let t0 = CFAbsoluteTimeGetCurrent()
        let renderer = ImageRenderer(content:
            DialFaceView(input: input, nowMin: nowMin)
                .background(Color(hex: DialSpec.backgroundHex)))
        // Pixels for the widget's own size on this screen: the view is spec
        // sized (364×382pt) and the widget scales it to fit, so render at the
        // device scale times that fit.
        renderer.scale = pixelScale
        guard let rendered = renderer.uiImage else {
            logger.error("face: ImageRenderer returned nil for \(k, privacy: .public)")
            return (nil, .failed)
        }
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        memory = (k, rendered)

        var stored: Int? = nil
        if let file, let dir = directory(), let png = rendered.pngData() {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            if (try? png.write(to: file, options: .atomic)) != nil { stored = png.count }
            prune(directory: dir, keepingPrefix: facePrefix(input: input, size: size, scale: scale))
        }
        logger.notice("face: rendered \(k, privacy: .public) in \(ms, format: .fixed(precision: 1), privacy: .public) ms, \(stored ?? 0, privacy: .public) bytes on disk")
        return (rendered, .rendered(ms: ms, storedBytes: stored))
    }

    /// Drops PNGs of any other input or size. A day leaves at most one file
    /// per bucket for the current face; yesterday's faces go the first time
    /// today renders cold.
    static func prune(directory dir: URL, keepingPrefix prefix: String) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        for f in files where !f.lastPathComponent.hasPrefix(prefix) {
            try? FileManager.default.removeItem(at: f)
        }
    }
}
