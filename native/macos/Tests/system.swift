import AppKit
import Carbon

@main
struct SystemTests {
    @MainActor
    static func main() async throws {
        _ = NSApplication.shared
        let clipboard = NSPasteboard.general
        let original = copyItems(clipboard)
        var lastOwnCount = clipboard.changeCount
        defer {
            // Do not discard anything the user copied during the checks.
            if clipboard.changeCount == lastOwnCount {
                clipboard.clearContents()
                if !original.isEmpty { clipboard.writeObjects(original) }
            }
        }
        var checks = 0

        let customType = NSPasteboard.PasteboardType("com.xtranslate.test.binary")
        let item = NSPasteboardItem()
        item.setString("Original test text", forType: .string)
        item.setString("<b>Original test text</b>", forType: .html)
        item.setData(Data([0, 1, 127, 255]), forType: customType)
        clipboard.clearContents()
        precondition(clipboard.writeObjects([item]))
        lastOwnCount = clipboard.changeCount
        xt_save_clipboard()
        precondition(xt_write_text("Translation · 中文"))
        precondition(clipboard.string(forType: .string) == "Translation · 中文")
        checks += 1
        xt_finish_clipboard(true)
        lastOwnCount = clipboard.changeCount
        precondition(clipboard.string(forType: .string) == "Original test text")
        precondition(clipboard.string(forType: .html) == "<b>Original test text</b>")
        precondition(clipboard.data(forType: customType) == Data([0, 1, 127, 255]))
        checks += 3

        xt_save_clipboard()
        precondition(xt_write_text("Temporary translation"))
        clipboard.clearContents()
        clipboard.setString("New user copy", forType: .string)
        lastOwnCount = clipboard.changeCount
        xt_finish_clipboard(true)
        precondition(clipboard.string(forType: .string) == "New user copy")
        checks += 1

        xt_save_clipboard()
        precondition(xt_write_text("Keep copied translation"))
        xt_finish_clipboard(false)
        lastOwnCount = clipboard.changeCount
        precondition(clipboard.string(forType: .string) == "Keep copied translation")
        checks += 1

        clipboard.clearContents()
        xt_save_clipboard()
        precondition(xt_write_text("Restore an empty clipboard"))
        xt_finish_clipboard(true)
        lastOwnCount = clipboard.changeCount
        precondition(clipboard.pasteboardItems?.isEmpty != false)
        checks += 1

        let integration = MacIntegration()
        precondition(integration.caretRect(pid: 0) == nil)
        precondition(!integration.activateTarget(pid: 0))
        precondition(!xt_target_is_frontmost(0))
        precondition(!xt_paste(0)) // The guard must prevent all synthesized keys.
        checks += 4

        var hidden = false
        do {
            try await integration.paste(text: "Manual fallback", pid: 0, restoreClipboard: true) { hidden = true }
            preconditionFailure("Invalid targets must fail")
        } catch {
            precondition(error is IntegrationError)
        }
        lastOwnCount = clipboard.changeCount
        precondition(clipboard.string(forType: .string) == "Manual fallback")
        precondition(!hidden)
        checks += 2

        // Reserve two unusual combinations; no keys are synthesized for hotkey tests.
        let first = HotkeyManager(), blocker = HotkeyManager(), probe = HotkeyManager()
        let modifiers = UInt32(cmdKey | optionKey | controlKey | shiftKey)
        defer { first.unregister(); blocker.unregister(); probe.unregister() }
        try first.register(keyCode: 79, modifiers: modifiers) {}
        try first.register(keyCode: 79, modifiers: modifiers) {}
        checks += 1
        try blocker.register(keyCode: 80, modifiers: modifiers) {}
        do {
            try first.register(keyCode: 80, modifiers: modifiers) {}
            preconditionFailure("An occupied hotkey must reject replacement")
        } catch { precondition(error is IntegrationError) }
        checks += 1
        do {
            try probe.register(keyCode: 79, modifiers: modifiers) {}
            preconditionFailure("A rejected replacement must retain the old hotkey")
        } catch { precondition(error is IntegrationError) }
        checks += 1
        first.unregister()
        try probe.register(keyCode: 79, modifiers: modifiers) {}
        checks += 1
        print("SYSTEM_TESTS_OK \(checks) checks; Accessibility granted: \(MacIntegration.accessibilityGranted)")
    }

    static func copyItems(_ clipboard: NSPasteboard) -> [NSPasteboardItem] {
        (clipboard.pasteboardItems ?? []).map { original in
            let copy = NSPasteboardItem()
            for type in original.types {
                if let data = original.data(forType: type) { copy.setData(data, forType: type) }
            }
            return copy
        }
    }
}
