import AppKit

@MainActor
final class LiveTestDelegate: NSObject, NSApplicationDelegate {
    var popup: NSWindow?
    var target: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { await runTest() }
    }

    func runTest() async {
        guard MacIntegration.accessibilityGranted else {
            print("SYSTEM_LIVE_PASTE_SKIPPED: test runner has no Accessibility permission")
            NSApp.terminate(nil)
            return
        }
        let clipboard = NSPasteboard.general
        let original = (clipboard.pasteboardItems ?? []).map { original in
            let copy = NSPasteboardItem()
            for type in original.types {
                if let data = original.data(forType: type) { copy.setData(data, forType: type) }
            }
            return copy
        }
        let translation = "Hello from native Xtranslate · 中文测试"
        let oldText = clipboard.string(forType: .string)
        let oldTypes = (clipboard.types ?? []).map(\.rawValue).sorted()
        let originalCount = clipboard.changeCount
        defer {
            target?.terminate()
            popup?.orderOut(nil)
            // On a failed paste, undo only the text written by this test.
            if clipboard.changeCount != originalCount,
               clipboard.string(forType: .string) == translation {
                clipboard.clearContents()
                if !original.isEmpty { clipboard.writeObjects(original) }
            }
        }
        do {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
            process.arguments = [CommandLine.arguments[2]]
            try process.run()
            target = process
            let integration = MacIntegration()
            let pid = process.processIdentifier
            var captured: Int32 = 0
            for _ in 0..<40 {
                try await Task.sleep(nanoseconds: 50_000_000)
                if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid {
                    captured = integration.captureTarget()
                    break
                }
            }
            guard captured == pid else { throw TestError.failed("Controlled target did not become foreground") }
            let hasCaret = integration.caretRect(pid: pid) != nil

            let window = NSWindow(contentRect: NSRect(x: 250, y: 250, width: 300, height: 100),
                                  styleMask: [.titled], backing: .buffered, defer: false)
            window.title = "Xtranslate 原生粘贴测试"
            window.isReleasedWhenClosed = false
            popup = window
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            // Deliberately move the background editor to a second field. The
            // integration must restore the field captured before the popup.
            try Data().write(to: URL(fileURLWithPath: CommandLine.arguments[2] + ".switch"))
            try await Task.sleep(nanoseconds: 200_000_000)
            // The captured process is our own controlled editor. Integration checks
            // the same PID and saved window again immediately before Cmd+V.
            try await integration.paste(text: translation, pid: pid, restoreClipboard: true) {
                window.orderOut(nil)
                NSApp.hide(nil)
            }
            try await Task.sleep(nanoseconds: 200_000_000)
            let received = try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
            guard received == translation else { throw TestError.failed("Controlled target text did not match") }
            let secondary = try String(contentsOfFile: CommandLine.arguments[2] + ".secondary", encoding: .utf8)
            guard secondary.isEmpty else { throw TestError.failed("Paste went into the wrong input field") }
            guard clipboard.string(forType: .string) == oldText,
                  (clipboard.types ?? []).map(\.rawValue).sorted() == oldTypes else {
                throw TestError.failed("Clipboard was not restored")
            }
            print("SYSTEM_LIVE_PASTE_OK: directed paste reached original field; background field switch corrected; clipboard restored; caret available: \(hasCaret)")
        } catch {
            print("SYSTEM_LIVE_PASTE_FAILED: \(error.localizedDescription)")
            target?.terminate()
            if clipboard.string(forType: .string) == translation {
                clipboard.clearContents()
                if !original.isEmpty { clipboard.writeObjects(original) }
            }
            exit(1)
        }
        target?.terminate()
        target?.waitUntilExit()
        popup?.orderOut(nil)
        NSApp.terminate(nil)
    }
}

enum TestError: LocalizedError {
    case failed(String)
    var errorDescription: String? { if case .failed(let message) = self { return message }; return nil }
}

@main
struct LiveSystemTest {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = LiveTestDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
