import AppKit
import Network
import WebKit

/**
 MoviesTv-Flix macOS wrapper.

 The app is the same web build the PWA serves, hosted in a WKWebView. WebKit has
 no Matroska demuxer, so any MKV source fails there no matter what its video
 codec is. The wrapper injects `window.__MOVIESTV_NATIVE__` at document start;
 when the web player decides a source cannot play in the browser it hands the
 URL (and any provider headers) to this process, which plays it with libVLC in
 an overlay window on top of the video area.

 Build:  apps/desktop-mac/build.sh
 Run:    build/MoviesTv-Flix.app/Contents/MacOS/MoviesTv-Flix --url <http://...>
 */

// MARK: - libVLC through dlopen
//
// Loading the dylib the user already has avoids vendoring a 100 MB framework in
// this repository. The path can be overridden with MTFLIX_VLC_LIB.

typealias VLCNew = @convention(c) (Int32, UnsafePointer<UnsafePointer<CChar>?>?) -> OpaquePointer?
typealias VLCCreate = @convention(c) (OpaquePointer?) -> OpaquePointer?
typealias VLCCreateFromLocation = @convention(c) (OpaquePointer?, UnsafePointer<CChar>) -> OpaquePointer?
typealias VLCMediaPlayerSetView = @convention(c) (OpaquePointer?, UnsafeMutableRawPointer?) -> Void
typealias VLCInt32Player = @convention(c) (OpaquePointer?) -> Int32
typealias VLCVoidPlayer = @convention(c) (OpaquePointer?) -> Void
typealias VLCVoidMedia = @convention(c) (OpaquePointer?) -> Void
typealias VLCTimeGet = @convention(c) (OpaquePointer?) -> Int64
typealias VLCTimeSet = @convention(c) (OpaquePointer?, Int64) -> Void
typealias VLCOption = @convention(c) (OpaquePointer?, UnsafePointer<CChar>) -> Int32
typealias VLANoArgPlayer = @convention(c) (OpaquePointer?) -> Int32

final class LibVLC {
    static let shared = LibVLC()

    private let handle: UnsafeMutableRawPointer?
    let new: VLCNew?
    let mediaNewLocation: VLCCreateFromLocation?
    let mediaPlayerNew: VLCCreate?
    let mediaPlayerSetView: VLCMediaPlayerSetView?
    let mediaPlayerPlay: VLCInt32Player?
    let mediaPlayerPause: VLCVoidPlayer?
    let mediaPlayerStop: VLCVoidPlayer?
    let mediaPlayerRelease: VLCVoidPlayer?
    let mediaPlayerSetTime: VLCTimeSet?
    let mediaPlayerGetTime: VLCTimeGet?
    let mediaPlayerGetLength: VLCTimeGet?
    let mediaPlayerIsPlaying: VLCInt32Player?
    let mediaRelease: VLCVoidMedia?
    let mediaAddOption: VLCOption?
    let release: VLCVoidMedia?
    let hasVout: VLANoArgPlayer?
    let audioTrackCount: VLANoArgPlayer?

    private static func candidatePaths() -> [String] {
        if let override = ProcessInfo.processInfo.environment["MTFLIX_VLC_LIB"], !override.isEmpty {
            return [override]
        }
        var paths = [
            "/Applications/VLC.app/Contents/MacOS/lib/libvlc.dylib",
            "/opt/homebrew/lib/libvlc.dylib",
            "/usr/local/lib/libvlc.dylib",
        ]
        // A framework bundled next to the executable wins over system copies.
        if let bundled = Bundle.main.privateFrameworksPath {
            paths.insert(bundled + "/libvlc.dylib", at: 0)
        }
        return paths
    }

    private static func loadSymbol<T>(_ handle: UnsafeMutableRawPointer?, _ name: String, as type: T.Type) -> T? {
        guard let handle, let symbol = dlsym(handle, name) else { return nil }
        return unsafeBitCast(symbol, to: type)
    }

    private init() {
        var loaded: UnsafeMutableRawPointer?
        for path in LibVLC.candidatePaths() where FileManager.default.fileExists(atPath: path) {
            loaded = dlopen(path, RTLD_NOW | RTLD_LOCAL)
            if loaded != nil {
                // VLC finds its modules relative to the app that owns libvlc.
                let bundleRoot = (path as NSString).deletingLastPathComponent
                setenv("VLC_PLUGIN_PATH", bundleRoot + "/../plugins", 1)
                break
            }
        }
        handle = loaded
        new = LibVLC.loadSymbol(loaded, "libvlc_new", as: VLCNew.self)
        mediaNewLocation = LibVLC.loadSymbol(loaded, "libvlc_media_new_location", as: VLCCreateFromLocation.self)
        mediaPlayerNew = LibVLC.loadSymbol(loaded, "libvlc_media_player_new_from_media", as: VLCCreate.self)
        mediaPlayerSetView = LibVLC.loadSymbol(loaded, "libvlc_media_player_set_nsobject", as: VLCMediaPlayerSetView.self)
        mediaPlayerPlay = LibVLC.loadSymbol(loaded, "libvlc_media_player_play", as: VLCInt32Player.self)
        mediaPlayerPause = LibVLC.loadSymbol(loaded, "libvlc_media_player_pause", as: VLCVoidPlayer.self)
        mediaPlayerStop = LibVLC.loadSymbol(loaded, "libvlc_media_player_stop", as: VLCVoidPlayer.self)
        mediaPlayerRelease = LibVLC.loadSymbol(loaded, "libvlc_media_player_release", as: VLCVoidPlayer.self)
        mediaPlayerSetTime = LibVLC.loadSymbol(loaded, "libvlc_media_player_set_time", as: VLCTimeSet.self)
        mediaPlayerGetTime = LibVLC.loadSymbol(loaded, "libvlc_media_player_get_time", as: VLCTimeGet.self)
        mediaPlayerGetLength = LibVLC.loadSymbol(loaded, "libvlc_media_player_get_length", as: VLCTimeGet.self)
        mediaPlayerIsPlaying = LibVLC.loadSymbol(loaded, "libvlc_media_player_is_playing", as: VLCInt32Player.self)
        mediaRelease = LibVLC.loadSymbol(loaded, "libvlc_media_release", as: VLCVoidMedia.self)
        mediaAddOption = LibVLC.loadSymbol(loaded, "libvlc_media_add_option", as: VLCOption.self)
        release = LibVLC.loadSymbol(loaded, "libvlc_release", as: VLCVoidMedia.self)
        hasVout = LibVLC.loadSymbol(loaded, "libvlc_media_player_has_vout", as: VLANoArgPlayer.self)
        audioTrackCount = LibVLC.loadSymbol(loaded, "libvlc_audio_get_track_count", as: VLANoArgPlayer.self)
    }

    var isAvailable: Bool { handle != nil && new != nil && mediaPlayerPlay != nil }
}

// MARK: - Native player window

final class NativePlayerWindow: NSWindow {
    private let libvlc = LibVLC.shared
    private var instance: OpaquePointer?
    private var player: OpaquePointer?
    private let videoView: NSView
    private let playButton = NSButton()
    private let closeButton = NSButton()
    private let slider = NSSlider()
    private let timeLabel = NSTextField(labelWithString: "0:00")
    private var ticker: Timer?
    private var lastRect: CGRect = .zero
    private var hostWindow: NSWindow?
    private var mediaTitle: String

    init(title: String) {
        self.mediaTitle = title
        videoView = NSView(frame: .zero)
        super.init(contentRect: NSRect(x: 0, y: 0, width: 640, height: 360),
                   styleMask: [.borderless], backing: .buffered, defer: false)
        isOpaque = true
        backgroundColor = .black
        hasShadow = false
        level = .floating
        collectionBehavior = [.fullScreenAuxiliary]
    }

    /// Position the overlay over the HTML video element.
    func place(over rect: CGRect, in parent: NSWindow) {
        lastRect = rect
        self.hostWindow = parent
        if parentFrameIsCurrent() == false {
            parent.addChildWindow(self, ordered: .above)
        }
        setFrame(screenFrame(for: rect, in: parent), display: true)
    }

    func reposition(in parent: NSWindow) {
        guard !lastRect.isEmpty else { return }
        setFrame(screenFrame(for: lastRect, in: parent), display: true)
    }

    private func parentFrameIsCurrent() -> Bool { self.hostWindow != nil }

    /// A CSS rect (top-left origin, points) inside the web view -> screen coords.
    private func screenFrame(for cssRect: CGRect, in parent: NSWindow) -> NSRect {
        guard let content = parent.contentView else { return cssRect }
        let flipped = CGRect(x: cssRect.origin.x,
                             y: content.bounds.height - cssRect.origin.y - cssRect.height,
                             width: cssRect.width,
                             height: cssRect.height)
        let inWindow = content.convert(flipped, to: nil)
        return parent.convertToScreen(inWindow)
    }

    func start(url: URL, headers: [String: String], startAt: Double) {
        guard libvlc.isAvailable else {
            presentFailure("libVLC was not found. Install VLC (brew install --cask vlc) or set MTFLIX_VLC_LIB.")
            return
        }
        guard let library = libvlc.new,
              let makeMedia = libvlc.mediaNewLocation,
              let makePlayer = libvlc.mediaPlayerNew,
              let play = libvlc.mediaPlayerPlay else { return }

        let args = ["--no-video-title-show", "--quiet", "--no-osd"]
        var cArgs: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) }
        defer { cArgs.forEach { if let pointer = $0 { free(pointer) } } }
        instance = cArgs.withUnsafeBufferPointer { buffer -> OpaquePointer? in
            guard let base = buffer.baseAddress else { return nil }
            return base.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buffer.count) { rebound in
                library(Int32(buffer.count), rebound)
            }
        }
        guard let instance else {
            presentFailure("libVLC could not start.")
            return
        }

        let media = url.absoluteString.withCString { makeMedia(instance, $0) }
        guard let media else {
            presentFailure("libVLC rejected the source URL.")
            return
        }
        // Provider-required headers. VLC 3 exposes User-Agent and Referer as
        // media options; other headers cannot be forwarded and are ignored.
        func addOption(_ option: String) {
            guard let add = libvlc.mediaAddOption else { return }
            _ = option.withCString { add(media, $0) }
        }
        if let userAgent = headers.first(where: { $0.key.lowercased() == "user-agent" })?.value {
            addOption(":http-user-agent=\(userAgent)")
        }
        if let referer = headers.first(where: { $0.key.lowercased() == "referer" })?.value {
            addOption(":http-referrer=\(referer)")
        }
        if startAt > 0 { addOption(":start-time=\(Int(startAt))") }

        player = makePlayer(media)
        libvlc.mediaRelease?(media)
        guard let player else {
            presentFailure("libVLC could not create a player.")
            return
        }

        buildControls()
        libvlc.mediaPlayerSetView?(player, Unmanaged.passUnretained(videoView).toOpaque())
        _ = play(player)
        startTicker()
    }

    private func buildControls() {
        contentView = NSView()
        guard let content = contentView else { return }
        videoView.frame = content.bounds
        videoView.autoresizingMask = [.width, .height]
        content.addSubview(videoView)

        let bar = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: content.bounds.width, height: 44))
        bar.material = .hudWindow
        bar.blendingMode = .withinWindow
        bar.autoresizingMask = [.width]
        content.addSubview(bar)

        playButton.frame = NSRect(x: 12, y: 8, width: 28, height: 28)
        playButton.bezelStyle = .texturedRounded
        playButton.title = "❚❚"
        playButton.target = self
        playButton.action = #selector(togglePlay)
        bar.addSubview(playButton)

        slider.frame = NSRect(x: 52, y: 10, width: content.bounds.width - 160, height: 24)
        slider.minValue = 0
        slider.maxValue = 1
        slider.target = self
        slider.action = #selector(seek)
        slider.autoresizingMask = [.width]
        slider.isContinuous = false
        bar.addSubview(slider)

        timeLabel.frame = NSRect(x: content.bounds.width - 104, y: 12, width: 64, height: 18)
        timeLabel.textColor = .white
        timeLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        timeLabel.autoresizingMask = [.minXMargin]
        bar.addSubview(timeLabel)

        closeButton.frame = NSRect(x: content.bounds.width - 36, y: 8, width: 26, height: 26)
        closeButton.bezelStyle = .circular
        closeButton.title = "✕"
        closeButton.target = self
        closeButton.action = #selector(closePlayer)
        closeButton.autoresizingMask = [.minXMargin]
        bar.addSubview(closeButton)

        titleLabel = NSTextField(labelWithString: mediaTitle)
        titleLabel.frame = NSRect(x: 52, y: content.bounds.height - 34, width: content.bounds.width - 120, height: 22)
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.autoresizingMask = [.width, .minYMargin]
        content.addSubview(titleLabel)
    }

    private var titleLabel = NSTextField(labelWithString: "")

    @objc private func togglePlay() {
        guard let player, let pause = libvlc.mediaPlayerPause else { return }
        pause(player)
        updatePlayButton()
    }

    @objc private func seek() {
        guard let player, let setTime = libvlc.mediaPlayerSetTime,
              let length = libvlc.mediaPlayerGetLength?(player), length > 0 else { return }
        setTime(player, Int64(slider.doubleValue * Double(length)))
    }

    @objc func closePlayer() {
        NSLog("MTFLIX closePlayer called")
        stopTicker()
        if let player {
            libvlc.mediaPlayerStop?(player)
            libvlc.mediaPlayerRelease?(player)
        }
        if let instance { libvlc.release?(instance) }
        player = nil
        instance = nil
        hostWindow?.removeChildWindow(self)
        orderOut(nil)
        NativeBridge.shared.onClose?()
    }

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }

    private func refresh() {
        guard let player else { return }
        let time = libvlc.mediaPlayerGetTime?(player) ?? 0
        let length = libvlc.mediaPlayerGetLength?(player) ?? 0
        if length > 0 {
            slider.doubleValue = Double(time) / Double(length)
            timeLabel.stringValue = "\(Self.clock(time)) / \(Self.clock(length))"
        } else {
            timeLabel.stringValue = Self.clock(time)
        }
        updatePlayButton()
    }

    private func updatePlayButton() {
        guard let player else { return }
        let playing = (libvlc.mediaPlayerIsPlaying?(player) ?? 0) != 0
        playButton.title = playing ? "❚❚" : "▶"
    }

    /// Verification hooks: report what the player is actually doing.
    func debugState() -> [String: Any] {
        guard let player else { return ["error": "no player"] }
        return [
            "timeMs": libvlc.mediaPlayerGetTime?(player) ?? 0,
            "lengthMs": libvlc.mediaPlayerGetLength?(player) ?? 0,
            "playing": (libvlc.mediaPlayerIsPlaying?(player) ?? 0) != 0,
            "hasVideo": (libvlc.hasVout?(player) ?? 0) > 0,
            "audioTracks": libvlc.audioTrackCount?(player) ?? 0,
        ]
    }

    func debugSeek(toMs ms: Int64) {
        guard let player, let setTime = libvlc.mediaPlayerSetTime else {
            NSLog("MTFLIX debugSeek: no player or no setTime")
            return
        }
        setTime(player, ms)
        NSLog("MTFLIX debugSeek -> \(ms) now=\(libvlc.mediaPlayerGetTime?(player) ?? -1)")
    }

    static func clock(_ ms: Int64) -> String {
        let total = max(0, ms / 1000)
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func presentFailure(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Playback failed"
        alert.informativeText = message
        alert.runModal()
        NativeBridge.shared.onClose?()
    }
}

// MARK: - Web <-> native bridge

final class NativeBridge: NSObject, WKScriptMessageHandler {
    static let shared = NativeBridge()
    weak var webView: WKWebView?
    /// The window the overlay is positioned in. Kept explicitly because
    /// `NSApp.keyWindow` is nil until the app is active, and a bridge message
    /// can arrive before that.
    weak var hostWindow: NSWindow?
    var playerWindow: NativePlayerWindow?
    var onClose: (() -> Void)?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "play":
            handlePlay(body)
        case "stop":
            playerWindow?.closePlayer()
        case "install-update":
            if let raw = body["url"] as? String {
                UpdateInstaller.shared.install(from: raw)
            }
        default:
            break
        }
    }

    private func handlePlay(_ body: [String: Any]) {
        NSLog("MTFLIX bridge play received")
        guard let raw = body["url"] as? String, let url = URL(string: raw),
              url.scheme == "https" || url.scheme == "http" else {
            NSLog("MTFLIX bridge play: bad url")
            return
        }
        guard let parent = NSApp.keyWindow ?? NativeBridge.shared.hostWindow ?? NSApp.mainWindow else {
            NSLog("MTFLIX bridge play: no window")
            return
        }

        playerWindow?.closePlayer()
        let title = (body["title"] as? String) ?? "Playing"
        let headers = (body["headers"] as? [String: String]) ?? [:]
        let startAt = (body["startAt"] as? Double) ?? 0

        let window = NativePlayerWindow(title: title)
        let rect: CGRect
        if let r = body["rect"] as? [String: Double],
           let x = r["x"], let y = r["y"], let w = r["width"], let h = r["height"] {
            rect = CGRect(x: x, y: y, width: w, height: h)
        } else {
            rect = parent.contentView?.bounds ?? parent.frame
        }
        window.place(over: rect, in: parent)
        window.orderFront(nil)
        playerWindow = window
        onClose = { [weak self] in
            self?.notifyWebClosed()
        }
        window.start(url: url, headers: headers, startAt: startAt)
    }

    private func notifyWebClosed() {
        webView?.evaluateJavaScript("window.__MOVIESTV_NATIVE_ON_CLOSE__ && window.__MOVIESTV_NATIVE_ON_CLOSE__()")
        playerWindow = nil
    }
}



// MARK: - Self update

/// Downloads the published DMG, replaces the copy in /Applications, relaunches.
///
/// The web layer only passes a GitHub-hosted URL, and the download is validated
/// again here: https plus github.com or a githubusercontent host. Nothing is
/// installed without the user pressing the button, and the app quits only after
/// the new bundle is in place, so a failed download leaves the current app running.
final class UpdateInstaller {
    static let shared = UpdateInstaller()

    private var running = false

    func install(from raw: String) {
        guard !running else { return }
        guard let url = URL(string: raw),
              url.scheme == "https",
              url.host == "github.com" || (url.host?.hasSuffix(".githubusercontent.com") ?? false) else {
            log("rejected update URL")
            return
        }
        running = true
        log("downloading \(url.lastPathComponent)")

        URLSession.shared.downloadTask(with: url) { [weak self] temporary, response, error in
            guard let self else { return }
            guard error == nil,
                  let temporary,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200 else {
                self.fail("download failed")
                return
            }
            let name = url.lastPathComponent.isEmpty ? "update.dmg" : url.lastPathComponent
            let dmg = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: dmg)
            do {
                try FileManager.default.moveItem(at: temporary, to: dmg)
            } catch {
                self.fail("could not keep the download")
                return
            }
            DispatchQueue.main.async { self.installDownloaded(dmg) }
        }.resume()
    }

    private func installDownloaded(_ dmg: URL) {
        let mount = FileManager.default.temporaryDirectory
            .appendingPathComponent("mtflix-update-mount", isDirectory: true)
        try? FileManager.default.removeItem(at: mount)
        try? FileManager.default.createDirectory(at: mount, withIntermediateDirectories: true)

        guard run("/usr/bin/hdiutil", ["attach", dmg.path, "-nobrowse", "-quiet", "-mountpoint", mount.path]) else {
            return fail("could not open the disk image")
        }
        defer {
            _ = run("/usr/bin/hdiutil", ["detach", mount.path, "-quiet", "-force"])
            try? FileManager.default.removeItem(at: dmg)
        }

        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: mount.path),
              let appName = entries.first(where: { $0.hasSuffix(".app") }) else {
            return fail("no app inside the disk image")
        }

        let applications = URL(fileURLWithPath: "/Applications", isDirectory: true)
        let destination = applications.appendingPathComponent("MoviesTv-Flix.app")
        let staging = applications.appendingPathComponent(".MoviesTv-Flix.app.updating")
        try? FileManager.default.removeItem(at: staging)
        guard run("/usr/bin/ditto", [mount.appendingPathComponent(appName).path, staging.path]) else {
            return fail("could not copy the new app")
        }
        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.moveItem(at: staging, to: destination)
        } catch {
            return fail("could not replace the app")
        }

        log("installed; relaunching")
        NSWorkspace.shared.open(destination)
        NSApp.terminate(nil)
    }

    private func fail(_ reason: String) {
        log(reason)
        running = false
    }

    private func log(_ message: String) {
        FileHandle.standardError.write(Data("UPDATE \(message)\n".utf8))
    }

    @discardableResult
    private func run(_ tool: String, _ arguments: [String]) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        do {
            try process.run()
        } catch {
            return false
        }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }
}

// MARK: - Bundled web build


/// The web build ships inside the app, so the DMG does not depend on a deploy.
///
/// It is served over loopback HTTP (see `LocalWebServer`) because WebKit does
/// not settle fonts under a custom URL scheme's opaque origin. Absolute asset
/// paths in the export (`/_expo/...`) map one-to-one onto files in `Web/`.
/// The Cloudflare `/api/*` proxies cannot be served from disk, so those are
/// forwarded to the live origin.
enum BundledWeb {
    static let apiOrigin = URL(string: "https://main.moviestv-flix.pages.dev")!

    static var root: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true)
    }

    static var isAvailable: Bool {
        guard let index = root?.appendingPathComponent("index.html") else { return false }
        return FileManager.default.fileExists(atPath: index.path)
    }

    static func startURL() -> URL? {
        guard isAvailable, let port = LocalWebServer.shared.start() else { return nil }
        return URL(string: "http://127.0.0.1:\(port)/")
    }
}

private func mimeType(for path: String) -> String {
    switch (path as NSString).pathExtension.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json": return "application/json; charset=utf-8"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "svg": return "image/svg+xml"
    case "ico": return "image/x-icon"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    case "ttf": return "font/ttf"
    case "map": return "application/json; charset=utf-8"
    case "txt": return "text/plain; charset=utf-8"
    case "wasm": return "application/wasm"
    default: return "application/octet-stream"
    }
}

// MARK: - Console relay

/// Forwards page errors to stderr, so a `--smoke-test` run can explain itself.
final class ConsoleRelay: NSObject, WKScriptMessageHandler {
    static let shared = ConsoleRelay()

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        if let text = message.body as? String {
            // stderr is unbuffered: exit() would otherwise drop buffered stdout.
            FileHandle.standardError.write(Data("JS \(text)\n".utf8))
        }
    }

    static let script = """
    (function () {
      function send(kind, detail) {
        try { window.webkit.messageHandlers.moviestvConsole.postMessage(kind + ': ' + detail); } catch (e) {}
      }
      window.addEventListener('error', function (event) {
        send('error', (event.message || 'unknown') + ' @ ' + (event.filename || '') + ':' + (event.lineno || 0));
      });
      window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason && (event.reason.stack || event.reason.message) || String(event.reason);
        send('rejection', String(reason).slice(0, 400));
      });
      var originalError = console.error;
      console.error = function () {
        var parts = Array.prototype.map.call(arguments, function (value) {
          try { return typeof value === 'string' ? value : JSON.stringify(value); } catch (e) { return String(value); }
        });
        send('console.error', parts.join(' ').slice(0, 400));
        return originalError.apply(console, arguments);
      };
    })();
    """
}

// MARK: - Local web server

/// Serves the bundled web build over loopback HTTP.
///
/// A custom URL scheme looked like the smaller change, but WebKit in a WKWebView
/// refuses to settle fonts (and hides message handlers) under an opaque origin —
/// the app stopped on its own "loading fonts" placeholder. Loopback HTTP is a
/// secure context with normal origin semantics, and the same export renders
/// there, so the DMG serves itself over 127.0.0.1.
final class LocalWebServer {
    static let shared = LocalWebServer()

    private let queue = DispatchQueue(label: "mtflix.localweb")
    private var listener: NWListener?
    private(set) var port: UInt16 = 0

    func start() -> UInt16? {
        guard BundledWeb.isAvailable else { return nil }
        if port > 0 { return port }

        for candidate in [47615, 47616, 47617, 47618, 47619] {
            guard let nwPort = NWEndpoint.Port(rawValue: UInt16(candidate)) else { continue }
            do {
                let listener = try NWListener(using: .tcp, on: nwPort)
                let ready = DispatchSemaphore(value: 0)
                listener.stateUpdateHandler = { state in
                    if case .ready = state { ready.signal() }
                    if case .failed = state { ready.signal() }
                }
                listener.newConnectionHandler = { [weak self] connection in
                    self?.handle(connection)
                }
                listener.start(queue: queue)
                _ = ready.wait(timeout: .now() + 2)
                if listener.state == .ready {
                    self.listener = listener
                    self.port = UInt16(candidate)
                    return self.port
                }
                listener.cancel()
            } catch {
                continue
            }
        }
        return nil
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        readRequest(connection, buffer: Data())
    }

    private func readRequest(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] chunk, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let chunk { buffer.append(chunk) }

            if let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[..<headerEnd.lowerBound], as: UTF8.self)
                self.respond(connection, to: head)
                return
            }
            if error != nil || isComplete || buffer.count > 64 * 1024 {
                connection.cancel()
                return
            }
            self.readRequest(connection, buffer: buffer)
        }
    }

    private func respond(_ connection: NWConnection, to head: String) {
        guard let requestLine = head.split(separator: "\r\n").first else {
            return send(connection, status: 400, type: "text/plain", body: Data("bad request".utf8))
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
            return send(connection, status: 400, type: "text/plain", body: Data("bad request".utf8))
        }
        var path = String(parts[1])
        if let query = path.firstIndex(of: "?") { path = String(path[..<query]) }
        path = path.removingPercentEncoding ?? path

        if path.hasPrefix("/api/") {
            return proxy(connection, path: path, head: head)
        }
        serveFile(connection, path: path)
    }

    private func serveFile(_ connection: NWConnection, path: String) {
        guard let root = BundledWeb.root else {
            return send(connection, status: 404, type: "text/plain", body: Data("no web build".utf8))
        }
        var relative = path
        if relative.isEmpty || relative == "/" { relative = "/index.html" }
        if relative.contains("..") {
            return send(connection, status: 403, type: "text/plain", body: Data("forbidden".utf8))
        }

        var file = root.appendingPathComponent(String(relative.dropFirst()))
        if !FileManager.default.fileExists(atPath: file.path) {
            let last = (relative as NSString).lastPathComponent
            guard !last.contains(".") else {
                return send(connection, status: 404, type: "text/plain", body: Data("not found".utf8))
            }
            file = root.appendingPathComponent("index.html")
        }
        guard let body = try? Data(contentsOf: file) else {
            return send(connection, status: 404, type: "text/plain", body: Data("not found".utf8))
        }
        send(connection, status: 200, type: mimeType(for: file.lastPathComponent), body: body)
    }

    private func proxy(_ connection: NWConnection, path: String, head: String) {
        var components = URLComponents(url: BundledWeb.apiOrigin, resolvingAgainstBaseURL: false)!
        let requestTarget = String(head.split(separator: "\r\n").first?.split(separator: " ").dropFirst().first ?? "/")
        if let queryIndex = requestTarget.firstIndex(of: "?") {
            components.path = path
            components.query = String(requestTarget[requestTarget.index(after: queryIndex)...])
        } else {
            components.path = path
        }
        guard let target = components.url else {
            return send(connection, status: 400, type: "text/plain", body: Data("bad api url".utf8))
        }

        var request = URLRequest(url: target)
        request.timeoutInterval = 20
        let semaphore = DispatchSemaphore(value: 0)
        var status = 502
        var body = Data()
        var type = "application/json"

        URLSession.shared.dataTask(with: request) { data, response, _ in
            if let http = response as? HTTPURLResponse {
                status = http.statusCode
                if let value = http.value(forHTTPHeaderField: "content-type") { type = value }
            }
            body = data ?? Data()
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 25)
        send(connection, status: status, type: type, body: body)
    }

    private func send(_ connection: NWConnection, status: Int, type: String, body: Data) {
        var header = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "ERR")\r\n"
        header += "Content-Type: \(type)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "Cache-Control: no-cache\r\n"
        header += "Connection: close\r\n\r\n"
        var payload = Data(header.utf8)
        payload.append(body)
        connection.send(content: payload, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}

// MARK: - App




final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private let defaultURL = BundledWeb.apiOrigin
    private var startURL: URL = BundledWeb.apiOrigin
    private let smokeTest = CommandLine.arguments.contains("--smoke-test")
    private var window: NSWindow!
    private var web: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--url"), index + 1 < args.count,
           let override = URL(string: args[index + 1]) {
            startURL = override
        } else if let env = ProcessInfo.processInfo.environment["MTFLIX_URL"], let override = URL(string: env) {
            startURL = override
        } else if let bundled = BundledWeb.startURL() {
            // Prefer the copy inside the app: no deploy, and it matches the DMG.
            startURL = bundled
        }

        buildMenu()

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(WKUserScript(
            source: Self.bridgeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        config.userContentController.add(NativeBridge.shared, name: "moviestvNative")
        config.userContentController.add(ConsoleRelay.shared, name: "moviestvConsole")
        config.userContentController.addUserScript(WKUserScript(
            source: ConsoleRelay.script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 760), configuration: config)
        web.navigationDelegate = self
        NativeBridge.shared.webView = web

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 760),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "MoviesTv-Flix"
        window.contentView = web
        window.center()
        NativeBridge.shared.hostWindow = window
        NotificationCenter.default.addObserver(
            forName: NSWindow.didResizeNotification, object: window, queue: .main
        ) { [weak self] _ in
            guard let self, let player = NativeBridge.shared.playerWindow else { return }
            player.reposition(in: self.window)
        }

        // Show the window even in a smoke run: WebKit throttles timers and
        // animation frames for a window that is never on screen, and expo-font
        // waits on a timer-based font observer, so a hidden run never paints.
        window.makeKeyAndOrderFront(nil)
        if !smokeTest {
            NSApp.activate(ignoringOtherApps: true)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 45) { exit(1) }
        }
        web.load(URLRequest(url: startURL))
    }

    static var hostVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.0.0"
    }

    static let bridgeScriptForTests: String = App.bridgeScript

    private static let bridgeScript = """
    (function () {
      // Tells the shared web bundle it runs inside the packaged desktop app, so
      // provider links can persist locally instead of living in page memory only.
      try {
        window.__MOVIESTV_DESKTOP__ = {
        platform: 'macos',
        bundle: 'MoviesTv-Flix',
        version: '\(App.hostVersion)'
      };
      } catch (e) {}
      if (!window.webkit || !window.webkit.messageHandlers.moviestvNative) return;
      window.__MOVIESTV_NATIVE__ = {
        native: true,
        play: function (request) {
          window.webkit.messageHandlers.moviestvNative.postMessage(Object.assign({ action: 'play' }, request));
        },
        stop: function () {
          window.webkit.messageHandlers.moviestvNative.postMessage({ action: 'stop' });
        },
        installUpdate: function (url) {
          window.webkit.messageHandlers.moviestvNative.postMessage({
            action: 'install-update',
            url: String(url)
          });
        }
      };
    })();
    """

    private func buildMenu() {
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit MoviesTv-Flix",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let root = NSMenu()
        let item = NSMenuItem()
        item.submenu = appMenu
        root.addItem(item)
        NSApp.mainMenu = root
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let destination = action.request.url, action.targetFrame?.isMainFrame != false else {
            decisionHandler(.allow)
            return
        }
        if destination.scheme == startURL.scheme && destination.host == startURL.host {
            if action.targetFrame == nil {
                webView.load(action.request)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        } else {
            if action.navigationType == .linkActivated && destination.scheme == "https" {
                NSWorkspace.shared.open(destination)
            }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard smokeTest else { return }
        print("Loaded \(webView.url?.absoluteString ?? "")")
        // URL equality cannot prove a bundled page rendered, so ask the DOM.
        // The window is on screen for this run: WebKit throttles timers in a
        // hidden window and expo-font would never settle.
        let started = Date()
        func poll() {
            let elapsed = Int(Date().timeIntervalSince(started) * 1000)
            webView.evaluateJavaScript("document.body.innerText.trim().length") { value, _ in
                let length = (value as? NSNumber)?.intValue ?? 0
                if length > 20 {
                    print("PAINTED after \(elapsed) ms")
                } else if elapsed < 20000 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { poll() }
                    return
                }
                dumpDOM()
            }
        }
        func dumpDOM() {
            webView.evaluateJavaScript(
                """
                JSON.stringify({
                  title: document.title,
                  nodes: document.querySelectorAll('*').length,
                  text: document.body.innerText.slice(0, 200),
                  rootHtml: (document.getElementById('root') || {}).innerHTML ? document.getElementById('root').innerHTML.length : -1,
                  secure: window.isSecureContext,
                  bridge: typeof window.__MOVIESTV_NATIVE__,
                  desktopHost: Boolean(window.__MOVIESTV_DESKTOP__),
                  localStorageOk: (function () { try { window.localStorage.setItem('x','1'); return true; } catch (e) { return String(e); } })(),
                  failed: performance.getEntriesByType('resource').filter(function (r) { return r.transferSize === 0 && r.decodedBodySize === 0; }).map(function (r) { return r.name; }).slice(0, 5),
                  overlap: (function () {
                    function deepest(text) {
                      var all = document.querySelectorAll('*');
                      for (var i = 0; i < all.length; i++) {
                        var el = all[i];
                        if (el.childElementCount === 0 && el.textContent.trim() === text) return el;
                      }
                      return null;
                    }
                    var header = deepest('MOVIESTV-FLIX');
                    var title = deepest('Continue Watching');
                    if (!header || !title) return 'missing';
                    var h = header.getBoundingClientRect();
                    var t = title.getBoundingClientRect();
                    return { headerBottom: Math.round(h.bottom), titleTop: Math.round(t.top), overlapping: t.top < h.bottom - 2 };
                  })()
                })
                """
            ) { value, _ in
                let payload = value as? String ?? ""
                print("DOM \(payload)")
                let loaded = webView.url?.host == self.startURL.host
                    && (payload.contains("MOVIESTV") || payload.contains("Home"))
                exit(loaded ? 0 : 1)
            }
        }
        poll()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        if smokeTest {
            print(error.localizedDescription)
            exit(1)
        }
        let alert = NSAlert(error: error)
        alert.beginSheetModal(for: window) { _ in }
    }
}


// MARK: - Verification modes

/// Plays a URL with libVLC inside the real app binary and reports what happened:
/// whether it started, whether audio and video tracks are live, and whether a
/// seek moves the clock. Writes JSON so a script can assert on it.
final class NativeSelfTest: NSObject, NSApplicationDelegate {
    let url: URL
    let outPath: String
    let window: NSWindow
    let player: NativePlayerWindow

    init(url: URL, outPath: String) {
        self.url = url
        self.outPath = outPath
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 640),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "MoviesTv-Flix self test"
        window.contentView = NSView()
        player = NativePlayerWindow(title: "self test")
        super.init()
    }

    func run() {
        window.makeKeyAndOrderFront(nil)
        player.place(over: CGRect(x: 0, y: 0, width: 1000, height: 560), in: window)
        player.orderFront(nil)
        player.start(url: url, headers: [:], startAt: 0)

        DispatchQueue.main.asyncAfter(deadline: .now() + 7) {
            let before = self.player.debugState()
            self.player.debugSeek(toMs: 8000)
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                var report = before
                report["afterSeek"] = self.player.debugState()
                report["searchedToMs"] = 8000
                let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted])
                try? data?.write(to: URL(fileURLWithPath: self.outPath))
                exit(0)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 40) {
            try? "{\"error\":\"timeout\"}".write(toFile: self.outPath, atomically: true, encoding: .utf8)
            exit(1)
        }
    }
}

/// Loads a page that calls `window.__MOVIESTV_NATIVE__.play(...)`, proving the
/// injected bridge and the script message handler work end to end.
final class BridgeSelfTest: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    let page: URL
    let outPath: String
    let window: NSWindow
    let web: WKWebView

    init(page: URL, outPath: String) {
        self.page = page
        self.outPath = outPath
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(WKUserScript(
            source: App.bridgeScriptForTests, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(NativeBridge.shared, name: "moviestvNative")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 700), configuration: config)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 700),
                          styleMask: [.titled], backing: .buffered, defer: false)
        super.init()
        web.navigationDelegate = self
        NativeBridge.shared.webView = web
    }

    func run() {
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NativeBridge.shared.hostWindow = window
        web.load(URLRequest(url: page))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
            let state = NativeBridge.shared.playerWindow?.debugState() ?? ["error": "no native player window"]
            var report: [String: Any] = [
                "bridgeInjected": true,
                "playerWindow": NativeBridge.shared.playerWindow != nil,
            ]
            report["state"] = state
            webView.evaluateJavaScript("document.getElementById('out') ? document.getElementById('out').textContent : ''") { text, _ in
                report["pageText"] = text ?? ""
                let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted])
                try? data?.write(to: URL(fileURLWithPath: self.outPath))
                exit(0)
            }
        }
    }
}

let arguments = CommandLine.arguments
let application = NSApplication.shared

if let modeIndex = arguments.firstIndex(of: "--native-test"), arguments.count > modeIndex + 2,
   let mediaURL = URL(string: arguments[modeIndex + 1]) {
    application.setActivationPolicy(.regular)
    let test = NativeSelfTest(url: mediaURL, outPath: arguments[modeIndex + 2])
    application.delegate = test
    DispatchQueue.main.async { test.run() }
    application.run()
} else if let modeIndex = arguments.firstIndex(of: "--bridge-test"), arguments.count > modeIndex + 2,
          let pageURL = URL(string: arguments[modeIndex + 1]) {
    application.setActivationPolicy(.regular)
    let test = BridgeSelfTest(page: pageURL, outPath: arguments[modeIndex + 2])
    application.delegate = test
    DispatchQueue.main.async { test.run() }
    application.run()
} else {
    application.setActivationPolicy(.regular)
    let delegate = App()
    application.delegate = delegate
    application.run()
}
