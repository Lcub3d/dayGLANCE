import Foundation
import UIKit
import WebKit
import UniformTypeIdentifiers

/// Direct Access sync (docs/direct-access-sync.md): window.DayGlanceDirectAccess.
///
/// On iPhone and iPad the bookmark is of the sync FILE, dayglance-sync.json,
/// not of its folder. Nextcloud, Google Drive, Dropbox, Box and OneDrive ship
/// Apple's older non-replicated File Provider extension, which keeps every
/// item in its own directory keyed by the item's id: a picked FOLDER has no
/// real directory on disk and never will, so a bookmark of it fails ("The
/// file couldn't be opened because it doesn't exist", iPhone, 2026-10-08),
/// and a path built by appending a file name to it points nowhere. Folder
/// selection from those providers is a known-open Apple bug (FB9703910). A
/// picked FILE works with all of them: the system calls the provider's
/// startProvidingItem on a coordinated read and itemChanged after a
/// coordinated `.forReplacing` write, which is how any app edits a provider's
/// document in place.
///
/// So the user either picks the existing file (a folder another device has
/// already seeded) or creates it in a folder of their choice through the
/// export picker (a first device). Access is held through a security-scoped
/// bookmark of the file in UserDefaults, the way ObsidianBridge holds the
/// vault. The web layer runs the same cycle it runs for iCloud and for the
/// desktop and Android folders, through the adapter in
/// src/sync/directAccessNativeBridge.js.
///
/// Read classification mirrors electron/directAccessStore.ts and the Android
/// DirectAccessRead, because the shared cycle treats all three alike, with one
/// difference: a bookmarked file that is gone is `error`, never `absent`. The
/// cycle seeds over "absent", and there is no folder to seed into here; the
/// user re-picks or re-creates the file instead.
///
///   downloading  the file is there but cannot be trusted yet: a zero-length
///                placeholder, an iCloud `.icloud` stub, or a coordinated read
///                the provider could not satisfy yet.
///   error        the file cannot be used: no bookmark, a bookmark that no
///                longer resolves or grants access, a file that is gone.
///   text         the file's content.
///
/// Two files, two bookmarks (docs/direct-access-sync.md, Phase 5): the
/// snapshot and the household roster, glance-users.json, each picked or
/// created the same way. The roster is a second bookmark because there is no
/// folder to find it in; the web layer's roster slot (`users`) reads and
/// writes it without a path.
///
/// JS contract (the method names Android's DirectAccessBridge.kt shares, plus
/// the iOS picks and the roster slot; booleans travel as the strings
/// "true"/"false" because every dgbridge:// answer is text):
///   pickFile(slot?)     → "null"; later window.__dgDirectAccessPicked({…, slot} | null | {error})
///   createFile(slot?)   → "null"; same callback. slot: "snapshot" (default) | "users"
///   pickFolder()        → same as pickFile (older callers)
///   status()            → JSON { configured, name, path, reachable }   (the snapshot)
///   read()              → JSON { kind: downloading|error|text, text?, error? }
///   write(text)         → "true" | "false"
///   deleteSnapshot()    → "true" | "false"
///   disconnect()        → "true"   (forgets both files)
///   usersStatus()       → JSON { configured, name, path, reachable }   (the roster)
///   readUsers()         → as read(), for the roster
///   writeUsers(text)    → "true" | "false"
///   forgetUsers()       → "true"
final class DirectAccessBridge: NSObject {

    static let shared = DirectAccessBridge()

    /// Set by WebView.swift so the picker result can call back into the page.
    weak var webView: WKWebView?

    /// The two files this bridge holds, each by its own bookmark.
    enum Slot: String {
        case snapshot, users

        var fileName: String {
            switch self {
            case .snapshot: return "dayglance-sync.json"
            case .users: return "glance-users.json"
            }
        }
        var bookmarkKey: String {
            switch self {
            case .snapshot: return "dayglance.directAccess.fileBookmark"
            case .users: return "dayglance.directAccess.usersBookmark"
            }
        }
        /// What createFile moves into the chosen folder. The snapshot's "null"
        /// classifies as absent so the first cycle seeds it; the roster's is
        /// an empty roster the first roster sync merges into.
        var seed: String {
            switch self {
            case .snapshot: return "null"
            case .users: return #"{"version":1,"users":[]}"#
            }
        }
        static func named(_ raw: Any?) -> Slot {
            (raw as? String).flatMap(Slot.init(rawValue:)) ?? .snapshot
        }
    }

    private let legacyFolderKey = "dayglance.directAccess.folderBookmark"

    /// Which file the open picker on screen is for.
    private var pendingSlot: Slot = .snapshot

    // The poll reads every 15 s; an unchanged file (same modification date and
    // size) is served from here. Our own writes invalidate it.
    private var caches: [Slot: (modified: Date, size: Int, text: String)] = [:]

    // MARK: - File bookmarks

    private func fileURL(_ slot: Slot) -> URL? {
        guard let data = UserDefaults.standard.data(forKey: slot.bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ) else { return nil }
        if stale, let fresh = try? url.bookmarkData(options: []) {
            UserDefaults.standard.set(fresh, forKey: slot.bookmarkKey)
        }
        return url
    }

    /// iCloud Drive keeps a cloud-only file as a hidden `.name.icloud` stub,
    /// and the older File Provider API writes its placeholders the same way.
    private func placeholderURL(for file: URL) -> URL {
        file.deletingLastPathComponent().appendingPathComponent("." + file.lastPathComponent + ".icloud")
    }

    private func isUbiquitous(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isUbiquitousItemKey]))?.isUbiquitousItem == true
    }

    private func present(_ picker: UIDocumentPickerViewController) {
        DispatchQueue.main.async {
            guard let rootVC = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first?.windows.first?.rootViewController else {
                NSLog("[directAccess] pick: no root view controller to present from")
                self.postPicked(self.json(["error": "no view controller to present the picker from"]))
                return
            }
            picker.delegate = self
            picker.allowsMultipleSelection = false
            rootVC.present(picker, animated: true)
        }
    }

    // MARK: - pickFile / createFile

    /// Opens the Files picker on an existing file for the slot (the snapshot,
    /// or the roster). Any file can be chosen; the delegate refuses one with
    /// another name, so a wrong file is never adopted.
    func pickFile(slot: Slot = .snapshot) {
        pendingSlot = slot
        present(UIDocumentPickerViewController(forOpeningContentTypes: [.json, .data]))
    }

    /// Creates the slot's file in a folder the user chooses, through the
    /// export picker: a temporary file holding the slot's seed is MOVED there
    /// (asCopy false), and the delegate bookmarks its new location. The
    /// snapshot's seed, "null", classifies as absent in the web layer, so the
    /// first cycle seeds the file from this device's data exactly as it seeds
    /// an empty folder.
    func createFile(slot: Slot = .snapshot) {
        pendingSlot = slot
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(slot.fileName)
        do {
            try slot.seed.data(using: .utf8)!.write(to: tmp, options: .atomic)
        } catch {
            NSLog("[directAccess] create: temp file failed: %@", error.localizedDescription)
            postPicked(json(["error": "could not prepare the file: \(error.localizedDescription)", "slot": slot.rawValue]))
            return
        }
        present(UIDocumentPickerViewController(forExporting: [tmp], asCopy: false))
    }

    /// Older callers; on iOS a folder cannot be held (header), so the file is picked.
    func pickFolder() { pickFile(slot: .snapshot) }

    // MARK: - status / disconnect

    private func statusObject(_ slot: Slot) -> [String: Any] {
        let configured = UserDefaults.standard.data(forKey: slot.bookmarkKey) != nil
        var name: Any = NSNull()
        var path: Any = NSNull()
        var reachable = false
        if configured, let url = fileURL(slot) {
            name = url.lastPathComponent
            path = url.path
            if url.startAccessingSecurityScopedResource() {
                // On disk, or a placeholder the provider will fill on the first read.
                reachable = FileManager.default.fileExists(atPath: url.path)
                    || FileManager.default.fileExists(atPath: placeholderURL(for: url).path)
                url.stopAccessingSecurityScopedResource()
            }
        }
        return [
            "configured": configured,
            "name": name,
            "path": path,
            "reachable": reachable,
        ]
    }

    func status() -> String { json(statusObject(.snapshot)) }
    func usersStatus() -> String { json(statusObject(.users)) }

    /// Forgets both files. The files themselves are left where they are.
    func disconnect() -> String {
        UserDefaults.standard.removeObject(forKey: Slot.snapshot.bookmarkKey)
        UserDefaults.standard.removeObject(forKey: Slot.users.bookmarkKey)
        UserDefaults.standard.removeObject(forKey: legacyFolderKey)
        caches = [:]
        return "true"
    }

    /// Forgets the roster file only.
    func forgetUsers() -> String {
        UserDefaults.standard.removeObject(forKey: Slot.users.bookmarkKey)
        caches[.users] = nil
        return "true"
    }

    // MARK: - read / write / delete

    func read() -> String { readSlot(.snapshot) }
    func readUsers() -> String { readSlot(.users) }
    func write(_ text: String) -> String { writeSlot(.snapshot, text) }
    func writeUsers(_ text: String) -> String { writeSlot(.users, text) }

    private func readSlot(_ slot: Slot) -> String {
        guard UserDefaults.standard.data(forKey: slot.bookmarkKey) != nil else {
            return kind("error", ["error": slot == .snapshot ? "no file connected" : "no roster file chosen"])
        }
        guard let file = fileURL(slot), file.startAccessingSecurityScopedResource() else {
            return kind("error", ["error": "permission denied"])
        }
        defer { file.stopAccessingSecurityScopedResource() }
        let cache = caches[slot]

        var isDir: ObjCBool = false
        let onDisk = FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir)
        if onDisk && isDir.boolValue { return kind("error", ["error": "\(slot.fileName) is not a file"]) }
        let stub = placeholderURL(for: file)
        let hasStub = FileManager.default.fileExists(atPath: stub.path)

        // iCloud Drive: a coordinated read of a cloud-only item blocks until it
        // is down, so ask for the download and let the next poll read it. A
        // provider's placeholder is filled by the coordinated read below.
        if !onDisk && hasStub && isUbiquitous(file) {
            try? FileManager.default.startDownloadingUbiquitousItem(at: file)
            return kind("downloading")
        }

        if onDisk {
            let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
            let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            let modified = (attrs?[.modificationDate] as? Date) ?? Date.distantPast
            // A provider part-way through replacing it.
            if size == 0 { return kind("downloading") }
            if let c = cache, c.modified == modified, c.size == size {
                return kind("text", ["text": c.text])
            }
        }

        // The coordinated read is what makes the provider put the file on disk
        // (startProvidingItem), and reads the one that is there.
        var text: String?
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: &coordError) { url in
            if let data = try? Data(contentsOf: url), let s = String(data: data, encoding: .utf8) {
                text = s
            }
        }
        if let e = coordError {
            // Gone for good (deleted on another device, the provider forgot
            // it): the user re-picks or re-creates. Anything else is transient.
            let gone = !onDisk && !hasStub
                && e.domain == NSCocoaErrorDomain
                && (e.code == NSFileReadNoSuchFileError || e.code == NSFileNoSuchFileError)
            return gone
                ? kind("error", ["error": "the sync file is gone: \(e.localizedDescription)"])
                : kind("downloading")
        }
        guard let t = text, !t.isEmpty else {
            return (onDisk || hasStub)
                ? kind("downloading")
                : kind("error", ["error": "the sync file is gone"])
        }
        let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? t.utf8.count
        let modified = (attrs?[.modificationDate] as? Date) ?? Date()
        caches[slot] = (modified, size, t)
        return kind("text", ["text": t])
    }

    private func writeSlot(_ slot: Slot, _ text: String) -> String {
        guard let file = fileURL(slot), file.startAccessingSecurityScopedResource() else { return "false" }
        defer { file.stopAccessingSecurityScopedResource() }
        guard let data = text.data(using: .utf8) else { return "false" }

        var ok = false
        var coordError: NSError?
        // `.forReplacing` is what tells a provider to upload the new version
        // (itemChanged); the write is atomic so a torn file never ships.
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: &coordError) { url in
            ok = (try? data.write(to: url, options: .atomic)) != nil
        }
        caches[slot] = nil
        return (ok && coordError == nil) ? "true" : "false"
    }

    /// Deletes the snapshot (reset scope "everywhere"), and forgets the
    /// bookmark with it: a bookmark of a deleted file is good for nothing,
    /// and the card then offers to pick or create again. A missing file
    /// counts as deleted.
    func deleteSnapshot() -> String {
        guard let file = fileURL(.snapshot), file.startAccessingSecurityScopedResource() else { return "false" }
        defer { file.stopAccessingSecurityScopedResource() }
        caches[.snapshot] = nil
        let present = FileManager.default.fileExists(atPath: file.path)
            || FileManager.default.fileExists(atPath: placeholderURL(for: file).path)
        var ok = !present
        if present {
            var coordError: NSError?
            NSFileCoordinator().coordinate(writingItemAt: file, options: .forDeleting, error: &coordError) { url in
                ok = (try? FileManager.default.removeItem(at: url)) != nil
            }
            ok = ok && coordError == nil
        }
        if ok { UserDefaults.standard.removeObject(forKey: Slot.snapshot.bookmarkKey) }
        return ok ? "true" : "false"
    }

    // MARK: - Helpers

    private func kind(_ kind: String, _ extra: [String: Any] = [:]) -> String {
        var obj: [String: Any] = ["kind": kind]
        for (k, v) in extra { obj[k] = v }
        return json(obj)
    }

    /// JSONSerialization escapes any content, a whole snapshot included, so the
    /// result is both valid JSON for the adapter and a valid JS object literal
    /// for the picker callback.
    private func json(_ obj: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
              let s = String(data: data, encoding: .utf8) else {
            return #"{"kind":"error","error":"encoding error"}"#
        }
        return s
    }

    private func postPicked(_ literal: String) {
        DispatchQueue.main.async {
            guard let webView = self.webView else {
                NSLog("[directAccess] pick result dropped: no web view to deliver it to")
                return
            }
            webView.evaluateJavaScript(
                "window.__dgDirectAccessPicked && window.__dgDirectAccessPicked(\(literal))"
            ) { _, error in
                if let error = error {
                    NSLog("[directAccess] pick result not delivered: %@", error.localizedDescription)
                }
            }
        }
    }
}

// MARK: - UIDocumentPickerDelegate

extension DirectAccessBridge: UIDocumentPickerDelegate {

    /// Both pickers land here: the open picker with the file the user chose,
    /// the export picker with the moved file's new location.
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            NSLog("[directAccess] pick: the picker returned no URL")
            postPicked(json(["error": "the picker returned no file"]))
            return
        }
        // A false here means the URL carried no security scope to start, not
        // that access is denied; the bookmark is the real test.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let slot = pendingSlot
        let expected = slot.fileName

        // The wrong file is never adopted. The export picker renames on a
        // name clash ("dayglance-sync 2.json"): that means the folder already
        // has the fleet's file, so the stray copy is removed and the user is
        // told to choose the existing one.
        guard url.lastPathComponent == expected else {
            NSLog("[directAccess] pick: refused %@ (not %@)", url.path, expected)
            let stem = (expected as NSString).deletingPathExtension
            if url.lastPathComponent.hasPrefix(stem) {
                var coordError: NSError?
                NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &coordError) { u in
                    try? FileManager.default.removeItem(at: u)
                }
                postPicked(json(["error": "that folder already has a \(expected): choose it instead of creating one", "path": url.path, "slot": slot.rawValue]))
            } else {
                postPicked(json(["error": "that is not \(expected)", "path": url.path, "slot": slot.rawValue]))
            }
            return
        }
        do {
            let bookmark = try url.bookmarkData(options: [])
            UserDefaults.standard.set(bookmark, forKey: slot.bookmarkKey)
            if slot == .snapshot { UserDefaults.standard.removeObject(forKey: legacyFolderKey) }
            caches[slot] = nil
            NSLog("[directAccess] picked %@ for %@ (security scope: %@)", url.path, slot.rawValue, scoped ? "yes" : "no")
            // The page updates its card and kicks a cycle from this; no reload.
            var st = statusObject(slot)
            st["slot"] = slot.rawValue
            postPicked(json(st))
        } catch {
            NSLog("[directAccess] pick: bookmark failed for %@ (security scope: %@): %@",
                  url.path, scoped ? "yes" : "no", error.localizedDescription)
            postPicked(json([
                "error": "bookmark: \(error.localizedDescription)",
                "path": url.path,
                "scoped": scoped,
                "slot": slot.rawValue,
            ]))
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        NSLog("[directAccess] pick cancelled")
        postPicked("null")
    }
}
