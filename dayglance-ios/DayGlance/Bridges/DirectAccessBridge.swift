import Foundation
import UIKit
import WebKit
import UniformTypeIdentifiers

/// Direct Access sync (docs/direct-access-sync.md): window.DayGlanceDirectAccess.
///
/// The user picks a folder from a Files location — iCloud Drive, Google Drive,
/// Dropbox, a Nextcloud or SMB location — and dayGLANCE reads and writes
/// dayglance-sync.json in it; that location's provider moves the file between
/// devices. Access is held through a security-scoped bookmark in UserDefaults,
/// the way ObsidianBridge holds the vault. The web layer runs the same cycle it
/// runs for iCloud and for the desktop and Android folders, through the adapter
/// in src/sync/directAccessNativeBridge.js, which wraps these synchronous calls
/// in the promise shape the Electron preload offers.
///
/// Read classification mirrors electron/directAccessStore.ts and the Android
/// DirectAccessRead exactly, because the shared cycle treats all three alike:
///
///   absent       the file is not there: the web layer may seed it.
///   downloading  the file is there but cannot be trusted yet: a zero-length
///                placeholder, an iCloud `.icloud` stub, or a coordinated read
///                the provider could not satisfy yet. NEVER reported as absent,
///                because absent means "seed over it".
///   error        the folder cannot be used: no bookmark, a bookmark that no
///                longer resolves or grants access, a vanished folder.
///   text         the file's content.
///
/// Reads and writes go through NSFileCoordinator: for a File Provider location
/// a coordinated read is what materialises a cloud-only file, and a coordinated
/// `.forReplacing` write is what tells the provider to upload the new version.
///
/// JS contract (identical to Android's DirectAccessBridge.kt, with booleans as
/// the strings "true"/"false" because every dgbridge:// answer is text):
///   pickFolder()        → "null"; later window.__dgDirectAccessPicked({…} | null)
///   status()            → JSON { configured, name, path, reachable }
///   read()              → JSON { kind: absent|downloading|error|text, text?, error? }
///   write(text)         → "true" | "false"
///   deleteSnapshot()    → "true" | "false"
///   disconnect()        → "true"
final class DirectAccessBridge: NSObject {

    static let shared = DirectAccessBridge()

    /// Set by WebView.swift so the picker result can call back into the page.
    weak var webView: WKWebView?

    private let bookmarkKey  = "dayglance.directAccess.folderBookmark"
    private let syncFileName = "dayglance-sync.json"

    // The poll reads every 15 s; an unchanged file (same modification date and
    // size) is served from here. Our own writes invalidate it.
    private var cache: (modified: Date, size: Int, text: String)?

    // MARK: - Folder bookmark

    private func folderURL() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ) else { return nil }
        if stale, let fresh = try? url.bookmarkData(options: []) {
            UserDefaults.standard.set(fresh, forKey: bookmarkKey)
        }
        return url
    }

    private func isDirectory(_ url: URL) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
    }

    // MARK: - pickFolder

    func pickFolder() {
        DispatchQueue.main.async {
            guard let rootVC = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first?.windows.first?.rootViewController else {
                self.postPicked("null")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            rootVC.present(picker, animated: true)
        }
    }

    // MARK: - status / disconnect

    func status() -> String {
        let configured = UserDefaults.standard.data(forKey: bookmarkKey) != nil
        var name: Any = NSNull()
        var path: Any = NSNull()
        var reachable = false
        if configured, let url = folderURL() {
            name = url.lastPathComponent
            path = url.path
            if url.startAccessingSecurityScopedResource() {
                reachable = isDirectory(url)
                url.stopAccessingSecurityScopedResource()
            }
        }
        return json([
            "configured": configured,
            "name": name,
            "path": path,
            "reachable": reachable,
        ])
    }

    /// Forgets the folder. The file in it is left where it is.
    func disconnect() -> String {
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
        cache = nil
        return "true"
    }

    // MARK: - read / write / delete

    func read() -> String {
        guard UserDefaults.standard.data(forKey: bookmarkKey) != nil else {
            return kind("error", ["error": "no folder connected"])
        }
        // The folder first: a bookmark that no longer resolves or grants access,
        // or a folder that vanished, must read as an error, not as "the file is
        // absent" (which would seed a new file into whatever reappears there).
        guard let folder = folderURL(), folder.startAccessingSecurityScopedResource() else {
            return kind("error", ["error": "permission denied"])
        }
        defer { folder.stopAccessingSecurityScopedResource() }
        guard isDirectory(folder) else { return kind("error", ["error": "folder not found"]) }

        let fileURL = folder.appendingPathComponent(syncFileName)

        // An iCloud Drive folder picked here shows a cloud-only file as a hidden
        // .name.icloud stub; ask for the download and wait.
        let placeholderURL = folder.appendingPathComponent("." + syncFileName + ".icloud")
        if FileManager.default.fileExists(atPath: placeholderURL.path) {
            try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
            return kind("downloading")
        }

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir) else {
            return kind("absent")
        }
        if isDir.boolValue { return kind("error", ["error": "\(syncFileName) is not a file"]) }

        let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        let modified = (attrs?[.modificationDate] as? Date) ?? Date.distantPast
        // A cloud-only placeholder, or a provider part-way through replacing it.
        if size == 0 { return kind("downloading") }

        if let c = cache, c.modified == modified, c.size == size {
            return kind("text", ["text": c.text])
        }

        var text: String?
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: fileURL, options: [], error: &coordError) { url in
            if let data = try? Data(contentsOf: url), let s = String(data: data, encoding: .utf8) {
                text = s
            }
        }
        // The provider could not hand the file over yet (still materialising, a
        // lock held, a transient failure): the next poll retries.
        guard coordError == nil, let t = text, !t.isEmpty else { return kind("downloading") }
        cache = (modified, size, t)
        return kind("text", ["text": t])
    }

    func write(_ text: String) -> String {
        guard let folder = folderURL(), folder.startAccessingSecurityScopedResource() else { return "false" }
        defer { folder.stopAccessingSecurityScopedResource() }
        guard isDirectory(folder), let data = text.data(using: .utf8) else { return "false" }
        let fileURL = folder.appendingPathComponent(syncFileName)

        var ok = false
        var coordError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: fileURL, options: .forReplacing, error: &coordError) { url in
            // Atomic: a torn file is the worse hazard here, since the provider
            // would ship it to every other device.
            ok = (try? data.write(to: url, options: .atomic)) != nil
        }
        cache = nil
        return (ok && coordError == nil) ? "true" : "false"
    }

    /// Deletes the snapshot (reset scope "everywhere"). A missing file counts as deleted.
    func deleteSnapshot() -> String {
        guard let folder = folderURL(), folder.startAccessingSecurityScopedResource() else { return "false" }
        defer { folder.stopAccessingSecurityScopedResource() }
        let fileURL = folder.appendingPathComponent(syncFileName)
        cache = nil
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return "true" }

        var ok = false
        var coordError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: fileURL, options: .forDeleting, error: &coordError) { url in
            ok = (try? FileManager.default.removeItem(at: url)) != nil
        }
        return (ok && coordError == nil) ? "true" : "false"
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
            self.webView?.evaluateJavaScript(
                "window.__dgDirectAccessPicked && window.__dgDirectAccessPicked(\(literal))",
                completionHandler: nil
            )
        }
    }
}

// MARK: - UIDocumentPickerDelegate

extension DirectAccessBridge: UIDocumentPickerDelegate {

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first, url.startAccessingSecurityScopedResource() else {
            postPicked("null")
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let bookmark = try? url.bookmarkData(options: []) else {
            postPicked("null")
            return
        }
        UserDefaults.standard.set(bookmark, forKey: bookmarkKey)
        cache = nil
        // The page updates its card and kicks a cycle from this; no reload.
        postPicked(status())
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        postPicked("null")
    }
}
