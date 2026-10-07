import AppKit

final class MemoryPreferences: UserDefaults {
    private var values: [String: Double] = [:]
    override func double(forKey defaultName: String) -> Double { values[defaultName] ?? 0 }
    override func set(_ value: Double, forKey defaultName: String) { values[defaultName] = value }
}

@main struct PopupTests {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let preferences = MemoryPreferences()
        let popup = PopupController(sizePreferences: preferences)
        var checks = 0
        func check(_ condition: @autoclosure () -> Bool, _ message: String) {
            guard condition() else { print("FAIL: \(message)"); exit(1) }
            checks += 1
        }
        func capture(_ name: String) {
            let view = popup.panel.contentView!
            view.layoutSubtreeIfNeeded()
            guard let image = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { fatalError("capture") }
            view.cacheDisplay(in: view.bounds, to: image)
            try! image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "build/popup-tests/\(name).png"))
        }
        check(popup.panel.styleMask.contains(.resizable), "window is resizable")
        check(!popup.panel.styleMask.contains(.nonactivatingPanel), "normal activation restores focus")
        check(!popup.panel.isOpaque && popup.panel.backgroundColor.alphaComponent == 0, "transparent window background")
        let background = popup.panel.contentView as! PopupBackgroundView
        check(background.maskImage != nil && background.maskImage!.capInsets.top == 16, "effect material has a stretchable corner mask")
        check(background.layer?.masksToBounds == true, "children also clipped")
        let mask = NSBitmapImageRep(data: background.maskImage!.tiffRepresentation!)!
        check(mask.colorAt(x: 0, y: 0)!.alphaComponent < 0.01, "mask corner transparent")
        check(mask.colorAt(x: mask.pixelsWide/2, y: mask.pixelsHigh/2)!.alphaComponent > 0.99, "mask center opaque")
        popup.cancel = { _ in app.terminate(nil) }
        popup.panel.title = "Xtranslate 窗口验证"
        popup.show(anchor: nil)
        popup.input.string = "窗口可以拖动边缘调整大小，文字会随宽度自动换行。"
        popup.output.string = "Drag an edge to resize. Text wraps to fit the window."
        popup.status.stringValue = "输入文字 · 回车粘贴 · ⇧回车换行 · Esc 关闭"
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            for (name, size) in [("minimum",NSSize(width:420,height:260)), ("large",NSSize(width:860,height:520))] {
                popup.panel.setContentSize(size)
                background.layoutSubtreeIfNeeded()
                let input = popup.input.enclosingScrollView!
                let output = popup.output.enclosingScrollView!
                check(abs(input.frame.height-output.frame.height) < 1, "equal text areas at \(name)")
                check(input.frame.height >= 58 && input.frame.width >= 384, "text area fills \(name)")
                check(input.autohidesScrollers, "unused scrollbars hide")
                check(popup.input.textContainer!.widthTracksTextView, "text tracks resized width")
                check(!background.hasAmbiguousLayout, "unambiguous layout at \(name)")
                capture(name)
            }
            check(!popup.input.string.isEmpty && !popup.output.string.isEmpty, "resizing preserves text")
            popup.windowDidEndLiveResize(Notification(name: NSWindow.didEndLiveResizeNotification, object: popup.panel))
            let restored = PopupController(sizePreferences: preferences)
            check(restored.panel.frame.size == popup.panel.frame.size, "saved size reused")
            popup.panel.appearance = NSAppearance(named: .darkAqua)
            capture("dark")
            popup.panel.appearance = NSAppearance(named: .aqua)
            popup.panel.setContentSize(NSSize(width:570,height:320))
            popup.panel.center()
            print("POPUP_UI_PASS: \(checks) checks")
            fflush(stdout)
            if !CommandLine.arguments.contains("--interactive") { app.terminate(nil) }
        }
        app.run()
    }
}
