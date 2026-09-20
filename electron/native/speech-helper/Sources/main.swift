import Foundation
import AVFoundation
import Speech

// dayglance-speech-helper
//
// On-device speech recognition for the macOS desktop build, via SFSpeechRecognizer.
// Spawned once per app session by the Electron main process (electron/speech.ts)
// and driven over stdin/stdout with newline-delimited JSON. The events it emits
// are the exact DayGlanceNative speech contract the iOS and Android bridges
// already implement, so the renderer's window.__speechEvent handling is
// unchanged (see src/native.js):
//
//   stdin  ← {"cmd":"supports"} | {"cmd":"start"} | {"cmd":"stop"} | {"cmd":"cancel"} | {"cmd":"quit"}
//   stdout → {"status":"ready"}
//            {"status":"supports","value":true|false}
//            {"status":"partial","text":"…"}
//            {"status":"final","text":"…"}
//            {"status":"error","message":"…"}
//
// The recognition loop mirrors dayglance-ios/DayGlance/Bridges/SpeechBridge.swift.
// Two things differ on macOS: AVAudioSession is an iOS-only API, so AVAudioEngine
// captures from the default input directly, and the microphone is authorised
// through AVCaptureDevice. Both TCC prompts (Speech Recognition, Microphone)
// attribute to dayGLANCE because the helper lives inside the app bundle — the
// same way the calendar helper's EventKit prompt does. The bundle's Info.plist
// therefore has to carry NSSpeechRecognitionUsageDescription and
// NSMicrophoneUsageDescription (electron-builder.config.cjs, extendInfo), or the
// authorisation request is refused before the user ever sees a prompt.
//
// Why a helper rather than Chromium's own SpeechRecognition: that API streams
// audio to the browser vendor's cloud service, which Electron builds cannot
// reach — the renderer gets `network` from the bare constructor. Apple's
// recogniser needs no key and prefers the on-device model when installed.

// MARK: - Output

func emit(_ payload: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: payload, options: []) else { return }
    data.append(0x0A)
    // FileHandle writes are unbuffered: the parent reads events as they happen,
    // not when a stdio buffer happens to fill.
    FileHandle.standardOutput.write(data)
}

func emitError(_ message: String) {
    emit(["status": "error", "message": message])
}

// MARK: - Recognition session

final class SpeechSession {
    private var recognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    // Mirrors the mobile bridges: SFSpeech often errors ("no speech detected")
    // when the user taps stop mid-utterance even though partials arrived fine —
    // in that case the last partial IS the result.
    private var lastPartial = ""
    private var stopRequested = false
    private var cancelled = false

    /// Recognition support for the current locale. Authorisation is asked for
    /// lazily on first start, exactly as on iOS.
    func supports() -> Bool {
        return SFSpeechRecognizer(locale: Locale.current)?.isAvailable ?? false
    }

    func start() {
        requestAuthorizationsThenStart()
    }

    func stop() {
        guard audioEngine != nil else { return }
        stopRequested = true
        stopEngine()
        // endAudio() lets the recogniser flush; the final result (or the error
        // we translate into one) arrives in the task callback.
        request?.endAudio()
    }

    func cancel() {
        cancelled = true
        stopEngine()
        task?.cancel()
        cleanup()
    }

    // MARK: Authorisation

    private func requestAuthorizationsThenStart() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    emitError("speech recognition permission denied — enable it in System Settings › Privacy & Security › Speech Recognition")
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        guard granted else {
                            emitError("microphone permission denied — enable it in System Settings › Privacy & Security › Microphone")
                            return
                        }
                        self?.startListening()
                    }
                }
            }
        }
    }

    // MARK: Capture

    private func startListening() {
        // Tear down any stale session first (mirrors Android's busy-guard).
        if audioEngine != nil {
            stopEngine()
            task?.cancel()
            cleanup()
        }
        lastPartial = ""
        stopRequested = false
        cancelled = false

        // AVAudioEngine.inputNode raises an uncatchable ObjC exception when the
        // Mac has no audio input at all, so check for a device before touching it.
        guard AVCaptureDevice.default(for: .audio) != nil else {
            emitError("no microphone found")
            return
        }

        guard let rec = SFSpeechRecognizer(locale: Locale.current), rec.isAvailable else {
            emitError("speech recognition not available")
            return
        }
        recognizer = rec

        do {
            let engine = AVAudioEngine()
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            // requiresOnDeviceRecognition stays at its default (false), as on iOS:
            // Apple uses the on-device model when it is installed and its own
            // recognition service otherwise. Forcing on-device would fail on a Mac
            // without the model downloaded.

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.channelCount > 0 else {
                emitError("microphone reported no audio channels")
                return
            }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                req.append(buffer)
            }
            engine.prepare()
            try engine.start()

            audioEngine = engine
            request = req
            task = rec.recognitionTask(with: req) { [weak self] result, error in
                DispatchQueue.main.async {
                    self?.handleRecognition(result: result, error: error)
                }
            }
        } catch {
            cleanup()
            emitError(error.localizedDescription)
        }
    }

    private func handleRecognition(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result {
            let text = result.bestTranscription.formattedString
            if result.isFinal {
                finish(with: text.isEmpty ? lastPartial : text)
                return
            }
            if !text.isEmpty {
                lastPartial = text
                emit(["status": "partial", "text": text])
            }
            return
        }
        if let error {
            if cancelled { cleanup(); return }
            if stopRequested {
                // "No speech detected" after a deliberate stop — the partials we
                // already have are the result.
                finish(with: lastPartial)
            } else {
                stopEngine()
                cleanup()
                emitError(error.localizedDescription)
            }
        }
    }

    private func finish(with text: String) {
        stopEngine()
        cleanup()
        emit(["status": "final", "text": text.trimmingCharacters(in: .whitespacesAndNewlines)])
    }

    private func stopEngine() {
        guard let engine = audioEngine else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
    }

    private func cleanup() {
        audioEngine = nil
        request = nil
        task = nil
    }
}

// MARK: - Command loop

let session = SpeechSession()

func handle(command line: Data) {
    guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
          let cmd = obj["cmd"] as? String else {
        emitError("malformed command")
        return
    }
    switch cmd {
    case "supports": emit(["status": "supports", "value": session.supports()])
    case "start":    session.start()
    case "stop":     session.stop()
    case "cancel":   session.cancel()
    case "quit":     session.cancel(); exit(0)
    default:         emitError("unknown command: \(cmd)")
    }
}

emit(["status": "ready"])

// stdin arrives on a background thread; every recogniser call is marshalled to
// the main thread, whose run loop below is what delivers the SFSpeech callbacks.
var pending = Data()
// The parameter must not be called `handle`: inside the closure that name would
// shadow the top-level `handle(command:)` and the dispatch below fails to compile.
FileHandle.standardInput.readabilityHandler = { input in
    let chunk = input.availableData
    if chunk.isEmpty {
        // EOF: the parent is gone. Nothing to report to; leave quietly.
        DispatchQueue.main.async { session.cancel(); exit(0) }
        return
    }
    pending.append(chunk)
    while let newline = pending.firstIndex(of: 0x0A) {
        let line = pending.subdata(in: pending.startIndex..<newline)
        pending.removeSubrange(pending.startIndex...newline)
        if !line.isEmpty {
            DispatchQueue.main.async { handle(command: line) }
        }
    }
}

RunLoop.main.run()
