import SwiftUI
import UIKit
import os
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — the cached static face (handoff §6, decided in Phase 0).
//
// The face is rendered once through ImageRenderer and kept both in memory
// for this process and as a PNG in the App Group for the next one. Each
// timeline entry is that image plus the hub and the needle.
//
// THE KEY. Past/future depends on the time, not only on the snapshot: a
// block changes state when it ends (variant C dims by state, not by a
// sector over the band). So the image is keyed on
//
//     renderVersion | digest(face input) | size@scale  +  "-b<n>"
//
// with "-mono" after the version for the accented rendering mode (below),
// where n = DialBand.pastBucket: the number of blocks that have ended at the
// entry's minute. The ended set is a prefix of the blocks in end order, so
// its size names it exactly; two entries in the same bucket draw the same
// face, and the key changes precisely at each distinct block end — 8–12
// cold renders on a full day, against a 28 ms cold render measured in
// Phase 0. A tier change (pushed → projected) changes the input digest, so
// a projected morning never reuses last night's pushed face.
//
// RENDERING MODES (Phase 5). On a tinted or clear Home Screen (iOS 18+) the
// system renders the widget in the ACCENTED mode: every view is painted
// white at its own opacity, images included, and the container background
// is replaced. The full-colour face is an OPAQUE PNG (the background is
// baked in so the band's alpha composites once), and an opaque image in
// that mode is one solid white rectangle, over which the white hub text and
// the white needle vanish — the "completely blank" tinted dial. So the
// accented mode gets its own face: DialFaceView's mono variant, white at
// the spec's opacities on a transparent ground, separators cut out rather
// than painted, rendered and cached under a key of its own ("-mono"). The
// provider warms whichever modes the context says the widget may be shown
// in (environmentVariants.widgetRenderingMode), so a tinted first render is
// as warm as a full-colour one.
//
// THE LIFETIME (Phase 4). Files accumulate per bucket, per rendered day and
// per size@scale, so the directory is bounded three ways, enforced on every
// write, oldest first by modification date:
//
//     maxBytes 12 MB · maxFiles 40 · maxAge 48 h
//
// and a timeline build ends with `retain(prefixes:)`, which drops every file
// that is not one of the faces this timeline can show. Prune on write, not
// on read: a read never deletes anything except a file it could not decode.
//
// CORRUPTION. Files are written atomically, so a truncated file cannot come
// from this code. A read that fails to decode, or decodes to the wrong
// pixel size, deletes the file and renders again; the entry never fails.
//
// MEMORY. One decoded face at a time: `memory` holds the last key only.
// A 364×382pt face at 3× is ~5 MB decoded, and the extension's whole budget
// is ~30 MB, so entries carry the KEY (via their input and minute), never
// the image; the view fetches it here at render time, one entry at a time.
// ─────────────────────────────────────────────────────────────────────────────

enum DialFaceCache {
    /// Bump whenever anything in DialFaceView or the palette changes what
    /// the same input draws, or a stale PNG from the previous build is shown.
    static let renderVersion = "face-v4"   // v3: glyphs drawn in a real frame; v4: the mono variant joins the key

    static let maxBytes = 12 * 1024 * 1024
    static let maxFiles = 40
    static let maxAge: TimeInterval = 48 * 3600

    static let logger = Logger(subsystem: "com.dayglance.app", category: "dialface")

    /// The last decoded face, and only the last: see MEMORY above. Guarded
    /// because the provider warms the cache from its queue while the view
    /// reads on the main thread.
    private static var memoryStore: (key: String, image: UIImage)?
    private static let memoryLock = NSLock()
    private static var memory: (key: String, image: UIImage)? {
        get { memoryLock.lock(); defer { memoryLock.unlock() }; return memoryStore }
        set { memoryLock.lock(); defer { memoryLock.unlock() }; memoryStore = newValue }
    }

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

    /// The input's part of the key: everything but the bucket. `mono` is the
    /// accented-mode face (see RENDERING MODES above).
    static func facePrefix(input: DialFaceInput, size: CGSize, scale: CGFloat, mono: Bool = false) -> String {
        "\(renderVersion)\(mono ? "-mono" : "")-\(input.digest)-\(Int(size.width))x\(Int(size.height))@\(scale)"
    }

    static func key(input: DialFaceInput, nowMin: Double, size: CGSize, scale: CGFloat, mono: Bool = false) -> String {
        "\(facePrefix(input: input, size: size, scale: scale, mono: mono))-b\(DialBand.pastBucket(input.blocks, nowMin: nowMin))"
    }

    /// Pixels per point for a widget of `size` on a screen of `scale`: the
    /// view is spec sized (364×382pt) and the widget scales it to fit.
    static func pixelScale(size: CGSize, scale: CGFloat) -> CGFloat {
        scale * min(size.width / DialSpec.canvasWidth, size.height / DialSpec.canvasHeight)
    }

    /// The face for one entry: memory, then the App Group PNG, then a fresh
    /// ImageRenderer pass (stored for next time). Callable from any thread:
    /// the render itself hops to the main actor, which ImageRenderer requires.
    static func image(input: DialFaceInput, nowMin: Double, size: CGSize, scale: CGFloat, mono: Bool = false) -> (image: UIImage?, outcome: Outcome) {
        let k = key(input: input, nowMin: nowMin, size: size, scale: scale, mono: mono)
        if let memory, memory.key == k { return (memory.image, .memory) }

        let file = directory()?.appendingPathComponent("\(k).png")
        let px = pixelScale(size: size, scale: scale)
        if let file, let data = try? Data(contentsOf: file) {
            if let img = UIImage(data: data, scale: px), isPlausible(img) {
                memory = (k, img)
                return (img, .disk(bytes: data.count))
            }
            // Undecodable or the wrong size: not a face. Drop it and render.
            logger.error("face: discarding unreadable cache file \(file.lastPathComponent, privacy: .public) (\(data.count, privacy: .public) bytes)")
            try? FileManager.default.removeItem(at: file)
        }

        let t0 = CFAbsoluteTimeGetCurrent()
        let rendered = onMain { RenderBox(image: renderFace(input: input, nowMin: nowMin, pixelScale: px, mono: mono)) }.image
        guard let rendered else {
            logger.error("face: ImageRenderer returned nil for \(k, privacy: .public)")
            return (nil, .failed)
        }
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        memory = (k, rendered)

        var stored: Int? = nil
        if let file, let dir = directory(), let png = rendered.pngData() {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            if (try? png.write(to: file, options: .atomic)) != nil { stored = png.count }
            enforceBudget(directory: dir, keeping: file)
        }
        logger.notice("face: rendered \(k, privacy: .public) in \(ms, format: .fixed(precision: 1), privacy: .public) ms, \(stored ?? 0, privacy: .public) bytes on disk")
        return (rendered, .rendered(ms: ms, storedBytes: stored))
    }

    /// The full-colour face over the widget's background (opaque, so the
    /// band composites once); the mono face on nothing (its alpha IS the
    /// picture in the accented mode).
    @MainActor
    private static func renderFace(input: DialFaceInput, nowMin: Double, pixelScale: CGFloat, mono: Bool) -> UIImage? {
        let face = DialFaceView(input: input, nowMin: nowMin, mono: mono)
        if mono {
            let renderer = ImageRenderer(content: face)
            renderer.scale = pixelScale
            return renderer.uiImage
        }
        let renderer = ImageRenderer(content: face.background(Color(hex: DialSpec.backgroundHex)))
        renderer.scale = pixelScale
        return renderer.uiImage
    }

    /// Carries a UIImage across `assumeIsolated`, whose result must be Sendable.
    private struct RenderBox: @unchecked Sendable { let image: UIImage? }

    /// Runs main-actor work from wherever the cache was asked: the view body
    /// (already main) or a provider's background queue (hop and wait).
    private static func onMain<T: Sendable>(_ work: @MainActor () -> T) -> T {
        if Thread.isMainThread {
            return MainActor.assumeIsolated { work() }
        }
        return DispatchQueue.main.sync { MainActor.assumeIsolated { work() } }
    }

    /// A decoded face has the spec's point size; anything else is a damaged
    /// or foreign file.
    private static func isPlausible(_ img: UIImage) -> Bool {
        abs(img.size.width - DialSpec.canvasWidth) < 1 && abs(img.size.height - DialSpec.canvasHeight) < 1
    }

    // MARK: lifetime

    private struct Entry { let url: URL; let bytes: Int; let modified: Date }

    private static func entries(in dir: URL) -> [Entry] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys) else { return [] }
        return files.compactMap { url in
            let v = try? url.resourceValues(forKeys: Set(keys))
            return Entry(url: url, bytes: v?.fileSize ?? 0, modified: v?.contentModificationDate ?? .distantPast)
        }
    }

    /// Oldest first until the directory is under every ceiling. `keeping`
    /// (the file just written) is never a candidate.
    static func enforceBudget(directory dir: URL, keeping: URL? = nil, now: Date = Date()) {
        var all = entries(in: dir).sorted { $0.modified < $1.modified }
        let cutoff = now.addingTimeInterval(-maxAge)
        var removed = 0
        func remove(_ e: Entry) { try? FileManager.default.removeItem(at: e.url); removed += 1 }
        for e in all where e.modified < cutoff && e.url != keeping { remove(e) }
        all = all.filter { $0.modified >= cutoff || $0.url == keeping }
        var total = all.reduce(0) { $0 + $1.bytes }
        var count = all.count
        for e in all where (total > maxBytes || count > maxFiles) && e.url != keeping {
            remove(e); total -= e.bytes; count -= 1
        }
        if removed > 0 {
            logger.notice("face: evicted \(removed, privacy: .public) cached faces; \(count, privacy: .public) files, \(total, privacy: .public) bytes remain")
        }
    }

    /// Drops every cached face that is not one of the given inputs, at the
    /// given size. A timeline calls this once with the prefix of every day it
    /// can render, so yesterday's faces go the first morning they are not
    /// needed and nothing a live timeline needs is touched.
    static func retain(prefixes: Set<String>) {
        guard let dir = directory() else { return }
        var removed = 0
        for e in entries(in: dir) where !prefixes.contains(where: { e.url.lastPathComponent.hasPrefix($0) }) {
            try? FileManager.default.removeItem(at: e.url)
            removed += 1
        }
        if removed > 0 { logger.notice("face: retired \(removed, privacy: .public) faces of other days or sizes") }
    }

    /// For the corner readout and Console: what is on disk right now.
    static func usage() -> (files: Int, bytes: Int) {
        guard let dir = directory() else { return (0, 0) }
        let all = entries(in: dir)
        return (all.count, all.reduce(0) { $0 + $1.bytes })
    }
}
