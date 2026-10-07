import AppKit

final class TranslationPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class PopupBackgroundView: NSVisualEffectView {
    override var isOpaque: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        material = .popover
        blendingMode = .behindWindow
        state = .active
        // The material is composited outside CALayer; mask it at the effect-view
        // level too, including the window shadow, instead of clipping only children.
        let radius: CGFloat = 16
        let side = radius * 2 + 1
        let mask = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
            return true
        }
        mask.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
        mask.resizingMode = .stretch
        maskImage = mask
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
        layer?.cornerRadius = radius
        layer?.masksToBounds = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
final class InputTextView: NSTextView {
    var command: ((UInt16) -> Void)?
    override func keyDown(with event: NSEvent) {
        if hasMarkedText() { super.keyDown(with: event); return }
        if (event.keyCode == 36 && !event.modifierFlags.contains(.shift)) || event.keyCode == 53 || event.keyCode == 48 {
            command?(event.keyCode); return
        }
        if event.keyCode == 14 && event.modifierFlags.contains(.command) { command?(14); return }
        super.keyDown(with: event)
    }
}

@MainActor final class PopupController: NSObject, NSTextViewDelegate, NSWindowDelegate {
    let panel: TranslationPanel
    let input = InputTextView()
    let output = NSTextView()
    let status = NSTextField(labelWithString: "输入文字，回车粘贴")
    let directionButton = NSButton(title: "自动识别", target: nil, action: nil)
    let engineButton = NSButton(title: "免费翻译", target: nil, action: nil)
    var textChanged: ((String) -> Void)?
    var commit: (() -> Void)?
    var cancel: ((Bool) -> Void)?
    var cycleDirection: (() -> Void)?
    var toggleEngine: (() -> Void)?
    var openSettings: (() -> Void)?
    private var suppressResign = false
    private let sizePreferences: UserDefaults

    init(sizePreferences: UserDefaults = .standard) {
        self.sizePreferences = sizePreferences
        let width = sizePreferences.double(forKey: "translationWindowWidth")
        let height = sizePreferences.double(forKey: "translationWindowHeight")
        let size = NSSize(width: width.isFinite && width >= 420 ? min(width, 1600) : 570,
                          height: height.isFinite && height >= 260 ? min(height, 1200) : 320)
        panel = TranslationPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        super.init()
        panel.delegate = self
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.hasShadow = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.minSize = NSSize(width: 420, height: 260)
        panel.maxSize = NSSize(width: 1600, height: 1200)
        panel.isReleasedWhenClosed = false
        let content = PopupBackgroundView(frame: NSRect(origin: .zero, size: size))
        panel.contentView = content

        let settings = NSButton(image: NSImage(systemSymbolName: "gearshape", accessibilityDescription: "设置")!, target: self, action: #selector(settingsClicked))
        settings.bezelStyle = .inline
        directionButton.target = self; directionButton.action = #selector(directionClicked); directionButton.bezelStyle = .rounded
        engineButton.target = self; engineButton.action = #selector(engineClicked); engineButton.bezelStyle = .rounded
        let spacer = NSView()
        let header = NSStackView(views: [directionButton, engineButton, spacer, settings])
        header.orientation = .horizontal; header.spacing = 8
        header.setContentHuggingPriority(.required, for: .vertical)
        input.isRichText = false; input.font = .systemFont(ofSize: 19); input.drawsBackground = false
        input.textContainerInset = NSSize(width: 2, height: 4)
        input.isAutomaticQuoteSubstitutionEnabled = false
        input.isAutomaticDashSubstitutionEnabled = false
        input.isAutomaticSpellingCorrectionEnabled = false
        input.delegate = self
        input.command = { [weak self] key in
            switch key { case 36: self?.commit?(); case 53: self?.cancel?(true); case 48: self?.cycleDirection?(); case 14: self?.toggleEngine?(); default: break }
        }
        output.isEditable = false; output.isSelectable = true; output.isRichText = false
        output.font = .systemFont(ofSize: 17); output.drawsBackground = false; output.textColor = .secondaryLabelColor
        output.textContainerInset = NSSize(width: 2, height: 4)
        let inputScroll = scroller(input)
        let outputScroll = scroller(output)
        let separator = NSBox(); separator.boxType = .separator
        status.font = .systemFont(ofSize: 11); status.textColor = .secondaryLabelColor
        status.lineBreakMode = .byTruncatingTail
        status.setContentHuggingPriority(.required, for: .vertical)
        status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let stack = NSStackView(views: [header, inputScroll, separator, outputScroll, status])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 18), stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -18),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 16), stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14),
            header.widthAnchor.constraint(equalTo: stack.widthAnchor), inputScroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            outputScroll.widthAnchor.constraint(equalTo: stack.widthAnchor), separator.widthAnchor.constraint(equalTo: stack.widthAnchor),
            status.widthAnchor.constraint(equalTo: stack.widthAnchor),
            inputScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 58),
            outputScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 58),
            inputScroll.heightAnchor.constraint(equalTo: outputScroll.heightAnchor)
        ])
    }
    private func scroller(_ text: NSTextView) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        scroll.scrollerStyle = .overlay; scroll.autohidesScrollers = true
        text.isVerticallyResizable = true; text.isHorizontallyResizable = false
        text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        text.textContainer?.containerSize = NSSize(width: 530, height: CGFloat.greatestFiniteMagnitude)
        scroll.documentView = text
        return scroll
    }
    func show(anchor: CGRect?) {
        input.string = ""; output.string = ""; status.stringValue = "输入文字 · 回车粘贴 · ⇧回车换行 · Esc 关闭"
        let point: NSPoint
        if let anchor {
            let mainTop = NSScreen.screens.first?.frame.maxY ?? 0
            point = NSPoint(x: anchor.minX, y: mainTop - anchor.maxY)
        } else { point = NSEvent.mouseLocation }
        let screen = NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) }) ?? NSScreen.main ?? NSScreen.screens[0]
        let area = screen.visibleFrame
        let maximum = NSSize(width: max(420, min(1600, area.width - 16)), height: max(260, min(1200, area.height - 16)))
        panel.maxSize = maximum
        let size = NSSize(width: min(panel.frame.width, maximum.width), height: min(panel.frame.height, maximum.height))
        panel.setContentSize(size)
        var y = point.y - size.height - 10
        if y < area.minY { y = point.y + 20 }
        let origin = NSPoint(x: min(max(point.x - 20, area.minX + 8), area.maxX - size.width - 8), y: min(max(y, area.minY + 8), area.maxY - size.height - 8))
        panel.setFrameOrigin(origin)
        suppressResign = true
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(input)
        DispatchQueue.main.async { [weak self] in self?.suppressResign = false }
    }
    func hide() { panel.orderOut(nil) }
    func render(_ text: String, status message: String, error: Bool = false) {
        output.string = text; output.textColor = error ? .systemRed : .labelColor
        status.stringValue = message
    }
    func textDidChange(_ notification: Notification) { if !input.hasMarkedText() { textChanged?(input.string) } }
    func windowDidEndLiveResize(_ notification: Notification) {
        sizePreferences.set(Double(panel.frame.width), forKey: "translationWindowWidth")
        sizePreferences.set(Double(panel.frame.height), forKey: "translationWindowHeight")
        panel.invalidateShadow()
    }
    func windowDidResignKey(_ notification: Notification) { if !suppressResign && panel.isVisible { cancel?(false) } }
    @objc private func settingsClicked() { openSettings?() }
    @objc private func directionClicked() { cycleDirection?() }
    @objc private func engineClicked() { toggleEngine?() }
}
