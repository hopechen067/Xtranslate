import AppKit

@MainActor final class Probe {
    var requests: [AppSettings] = []
    var pending: [CheckedContinuation<[String], Error>] = []
    func fetch(_ settings: AppSettings) async throws -> [String] {
        requests.append(settings)
        return try await withCheckedThrowingContinuation { pending.append($0) }
    }
}
@main struct ModelUITests {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        Task { @MainActor in
            var checks = 0
            func expect(_ value: Bool, _ message: String) throws {
                guard value else { throw UserError(message) }
                checks += 1
            }
            func pause() async { try? await Task.sleep(nanoseconds: 50_000_000) }
            @MainActor func find<T: NSView>(_ view: NSView, _ id: String, _: T.Type) -> T? {
                if view.identifier?.rawValue == id { return view as? T }
                for child in view.subviews { if let found = find(child,id,T.self) { return found } }
                return nil
            }
            do {
                var config = AppSettings(); config.engine = "llm"; config.providerID = "custom"; config.baseURL = "http://localhost:11434/v1"; config.model = "manual-model"
                let controller = SettingsController(settings: config)
                let probe = Probe()
                controller.loadModels = { value, _ in try await probe.fetch(value) }
                controller.show(); await pause()
                let root = controller.window.contentView!
                let model = find(root,"model",NSComboBox.self)!
                let button = find(root,"fetch-models",NSButton.self)!
                let address = find(root,"endpoint",NSTextField.self)!
                let hint = find(root,"model-hint",NSTextField.self)!
                try expect(probe.requests.count == 1, "automatic fetch on show")
                try expect(!button.isEnabled, "loading disables refresh")
                model.stringValue = "manual-during-load"
                probe.pending[0].resume(returning: ["model-a","model-b"]); await pause()
                try expect(model.numberOfItems == 2 && model.itemObjectValue(at: 1) as? String == "model-b", "selectable models")
                try expect(model.stringValue == "manual-during-load", "preserves manual text")
                try expect(button.isEnabled && hint.stringValue.contains("2"), "completion resets loading")
                button.performClick(nil); await pause()
                address.stringValue = "http://localhost:11435/v1"
                controller.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification,object:address)); await pause()
                try expect(probe.requests.count == 2 && model.numberOfItems == 0, "editing cancels without sending")
                controller.controlTextDidEndEditing(Notification(name: NSControl.textDidEndEditingNotification,object:address)); await pause()
                try expect(probe.requests.count == 3 && probe.requests[2].baseURL.contains("11435"), "end edit fetches new address")
                probe.pending[2].resume(returning:["new-model"]); await pause()
                probe.pending[1].resume(returning:["obsolete-model"]); await pause()
                try expect(model.numberOfItems == 1 && model.itemObjectValue(at:0) as? String == "new-model", "stale response discarded")
                model.stringValue = ""
                button.performClick(nil); await pause()
                try expect(probe.requests.count == 4 && probe.requests[3].model.isEmpty, "fetch works with no model selected")
                probe.pending[3].resume(throwing:UserError("测试：服务暂不可用，可手动填写")); await pause()
                try expect(button.isEnabled && model.isEditable && hint.stringValue.contains("手动"), "error allows manual input and retry")
                model.stringValue = "hand-entered"
                button.performClick(nil); await pause()
                controller.window.orderOut(nil)
                probe.pending[4].resume(returning:["hidden-model"]); await pause()
                try expect(button.isEnabled && model.numberOfItems == 1, "hidden completion releases busy state")
                controller.show(); await pause()
                try expect(probe.requests.count == 5, "cached list survives window show")
                button.performClick(nil); await pause()
                probe.pending[5].resume(returning:["claude-haiku-4-5","gemini-2.5-flash-lite","qwen-turbo"]); await pause()
                root.layoutSubtreeIfNeeded()
                if let bitmap = root.bitmapImageRepForCachingDisplay(in:root.bounds) {
                    root.cacheDisplay(in:root.bounds,to:bitmap)
                    try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
                }
                controller.window.setContentSize(NSSize(width: 580, height: 398))
                root.layoutSubtreeIfNeeded()
                let scroll = root as! NSScrollView
                let document = scroll.documentView!
                try expect(document.frame.height > scroll.contentSize.height, "short settings window has scrollable content")
                document.scroll(NSPoint(x: 0, y: document.bounds.maxY))
                try expect(scroll.contentView.bounds.minY > 0, "settings scroll position moves")
                let bottom = scroll.contentView.bounds.maxY
                try expect(bottom >= document.bounds.maxY - 1, "bottom controls reachable on short screen")
                button.performClick(nil); await pause()
                controller.window.close()
                probe.pending[6].resume(returning:["after-close"]); await pause()
                try expect(model.numberOfItems == 3 && button.isEnabled, "close cancels and rejects pending response")
                print("MODEL_UI_PASS: \(checks) checks")
                app.terminate(nil)
            } catch { fputs("MODEL_UI_FAIL: \(error.localizedDescription)\n",stderr); exit(1) }
        }
        app.run()
    }
}
