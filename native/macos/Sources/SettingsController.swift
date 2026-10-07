import AppKit

final class SettingsBackgroundView: NSView {
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        dirtyRect.fill()
    }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
}

final class HotkeyRecorder: NSButton {
    var recorded: ((UInt32, UInt32, String) -> Void)?
    private var recording = false
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) {
        recording = true; title = "按组合键…（Esc 取消）"; window?.makeFirstResponder(self)
    }
    override func keyDown(with event: NSEvent) {
        guard recording else { super.keyDown(with: event); return }
        if event.keyCode == 53 { recording = false; title = "点击重新录制"; return }
        var modifiers: UInt32 = 0; var symbols = ""
        if event.modifierFlags.contains(.control) { modifiers |= 4096; symbols += "⌃" }
        if event.modifierFlags.contains(.option) { modifiers |= 2048; symbols += "⌥" }
        if event.modifierFlags.contains(.shift) { modifiers |= 512; symbols += "⇧" }
        if event.modifierFlags.contains(.command) { modifiers |= 256; symbols += "⌘" }
        guard modifiers != 0, let char = event.charactersIgnoringModifiers, !char.isEmpty else { return }
        let display = symbols + (char == " " ? "Space" : char.uppercased())
        title = display; recording = false; recorded?(UInt32(event.keyCode), modifiers, display)
    }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if recording { keyDown(with: event); return true }; return super.performKeyEquivalent(with: event)
    }
}

@MainActor final class SettingsController: NSObject, NSWindowDelegate, NSTextFieldDelegate {
    let window: NSWindow
    private var draft: AppSettings
    private let engine = NSPopUpButton()
    private let free = NSPopUpButton()
    private let provider = NSPopUpButton()
    private let endpoint = NSTextField()
    private let model = NSComboBox()
    private let fetchModels = NSButton(title: "刷新模型", target: nil, action: nil)
    private let modelHint = NSTextField(wrappingLabelWithString: "填写 Key 后自动获取，也可手动输入模型名。")
    private let key = NSSecureTextField()
    private let live = NSButton(checkboxWithTitle: "停顿后自动翻译", target: nil, action: nil)
    private let restore = NSButton(checkboxWithTitle: "粘贴后恢复原来的剪贴板", target: nil, action: nil)
    private let login = NSButton(checkboxWithTitle: "登录 Mac 时启动", target: nil, action: nil)
    private let delay = NSPopUpButton()
    private let hotkey = HotkeyRecorder()
    private let result = NSTextField(wrappingLabelWithString: "")
    private let permission = NSButton(title: "允许自动粘贴…", target: nil, action: nil)
    private let permissionHint = NSTextField(wrappingLabelWithString: "")
    private var llmRows: [NSView] = []
    private var freeRow: NSView!
    private var testTask: Task<Void, Never>?
    private var modelTask: Task<Void, Never>?
    private var modelRevision = 0
    private var hasFetchedModels = false
    var save: ((AppSettings, String) throws -> Void)?
    var test: ((AppSettings, String) async throws -> String)?
    var loadModels: ((AppSettings, String) async throws -> [String])?

    init(settings: AppSettings) {
        draft = settings
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 670), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Xtranslate 原生版 · 设置"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 580, height: 420)
        super.init()
        window.delegate = self
        let content = SettingsBackgroundView()
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true; scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.documentView = content
        window.contentView = scroll
        content.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            content.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            content.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            content.topAnchor.constraint(equalTo: scroll.contentView.topAnchor)
        ])
        let title = NSTextField(labelWithString: "Xtranslate")
        title.font = .systemFont(ofSize: 25, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString: "轻巧的中英互译工具 · 菜单栏常驻 · 回车粘贴")
        subtitle.textColor = .secondaryLabelColor
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 13
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 22),stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 26),stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -26),stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -22)])
        stack.addArrangedSubview(title); stack.addArrangedSubview(subtitle)
        permission.target = self; permission.action = #selector(requestPermission); permission.bezelStyle = .rounded
        stack.addArrangedSubview(permission)
        permissionHint.font = .systemFont(ofSize: 11)
        permissionHint.textColor = .secondaryLabelColor
        stack.addArrangedSubview(permissionHint)
        permissionHint.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        let sep = NSBox(); sep.boxType = .separator; stack.addArrangedSubview(sep); sep.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        engine.addItems(withTitles: ["免费翻译（无需 Key）", "大模型 · 口语翻译"])
        engine.selectItem(at: draft.engine == "llm" ? 1 : 0)
        engine.target = self; engine.action = #selector(engineChanged)
        free.addItems(withTitles: ["微软翻译", "Google 翻译", "腾讯翻译"])
        free.selectItem(at: ["microsoft","google","tencent"].firstIndex(of: draft.freeProvider) ?? 0)
        provider.addItems(withTitles: ProviderPreset.all.map(\.name))
        provider.selectItem(at: ProviderPreset.all.firstIndex(where: {$0.id == draft.providerID}) ?? 0)
        provider.target = self; provider.action = #selector(providerChanged)
        endpoint.stringValue = draft.baseURL; endpoint.placeholderString = "https://…"
        endpoint.delegate = self; key.delegate = self
        engine.identifier = NSUserInterfaceItemIdentifier("engine")
        provider.identifier = NSUserInterfaceItemIdentifier("provider")
        endpoint.identifier = NSUserInterfaceItemIdentifier("endpoint")
        model.identifier = NSUserInterfaceItemIdentifier("model")
        key.identifier = NSUserInterfaceItemIdentifier("api-key")
        fetchModels.identifier = NSUserInterfaceItemIdentifier("fetch-models")
        modelHint.identifier = NSUserInterfaceItemIdentifier("model-hint")
        model.stringValue = draft.model; model.placeholderString = "选择模型或手动输入"
        model.isEditable = true; model.completes = true; model.numberOfVisibleItems = 10
        model.hasVerticalScroller = true
        model.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        model.setAccessibilityLabel("模型")
        fetchModels.target = self; fetchModels.action = #selector(refreshModelsClicked)
        fetchModels.bezelStyle = .rounded
        fetchModels.setContentHuggingPriority(.required, for: .horizontal)
        fetchModels.setContentCompressionResistancePriority(.required, for: .horizontal)
        modelHint.font = .systemFont(ofSize: 11); modelHint.textColor = .secondaryLabelColor
        key.placeholderString = "输入新 Key；留空保留已保存的 Key"
        let er = row("翻译引擎", engine); stack.addArrangedSubview(er)
        freeRow = row("免费服务", free); stack.addArrangedSubview(freeRow)
        let modelControls = NSStackView(views: [model, fetchModels])
        modelControls.orientation = .horizontal; modelControls.spacing = 8
        for (label, field) in [("服务商",provider as NSView),("服务地址",endpoint),("API Key",key),("模型",modelControls),("",modelHint)] {
            let r = row(label,field); llmRows.append(r); stack.addArrangedSubview(r)
        }
        hotkey.title = draft.hotkeyDisplay; hotkey.bezelStyle = .rounded
        hotkey.recorded = { [weak self] code, modifiers, display in self?.draft.hotkeyKeyCode = code; self?.draft.hotkeyModifiers = modifiers; self?.draft.hotkeyDisplay = display }
        stack.addArrangedSubview(row("呼出快捷键", hotkey))
        live.state = draft.livePreview ? .on : .off; restore.state = draft.restoreClipboard ? .on : .off; login.state = draft.launchAtLogin ? .on : .off
        stack.addArrangedSubview(live)
        delay.addItems(withTitles: ["0.2 秒", "0.3 秒", "0.5 秒", "0.8 秒", "1.2 秒"])
        delay.selectItem(at: [200,300,500,800,1200].firstIndex(of: draft.previewDelayMs) ?? 1)
        stack.addArrangedSubview(row("翻译等待", delay))
        stack.addArrangedSubview(restore); stack.addArrangedSubview(login)
        let saveButton = NSButton(title: "保存", target: self, action: #selector(saveClicked)); saveButton.bezelStyle = .rounded; saveButton.keyEquivalent = "\r"
        let testButton = NSButton(title: "测试翻译", target: self, action: #selector(testClicked)); testButton.bezelStyle = .rounded
        let buttons = NSStackView(views: [saveButton,testButton]); buttons.orientation = .horizontal; buttons.spacing = 10
        stack.addArrangedSubview(buttons)
        result.font = .systemFont(ofSize: 12); result.textColor = .secondaryLabelColor
        stack.addArrangedSubview(result); result.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        let note = NSTextField(wrappingLabelWithString: "⌘E 切换引擎 · Tab 切换方向 · Shift+回车换行\n免费服务依赖网络；API Key 仅保存在系统钥匙串。")
        note.font = .systemFont(ofSize: 11); note.textColor = .secondaryLabelColor
        stack.addArrangedSubview(note)
        for view in stack.arrangedSubviews where view is NSStackView { view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        engineChanged(); updatePermission()
    }
    private func row(_ title: String, _ control: NSView) -> NSStackView {
        let label = NSTextField(labelWithString: title); label.textColor = .secondaryLabelColor
        label.widthAnchor.constraint(equalToConstant: 96).isActive = true
        let s = NSStackView(views: [label,control]); s.orientation = .horizontal; s.spacing = 10
        control.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return s
    }
    func show() {
        NSApp.activate(ignoringOtherApps: true); window.center(); window.makeKeyAndOrderFront(nil); updatePermission()
        if !hasFetchedModels && modelTask == nil { requestModels() }
    }
    private func updatePermission() {
        let allowed = MacIntegration.accessibilityGranted && MacIntegration.canPostEvents
        permission.title = allowed ? "自动粘贴权限已开启 ✓" : "打开辅助功能设置…"
        permissionHint.stringValue = allowed
            ? "当前运行版本已获授权。请先点击目标输入框，再用快捷键呼出翻译。"
            : "当前运行版本尚未获授权。若已勾选，请移除旧条目，重新添加下方应用后退出并重开。\n当前应用：\(MacIntegration.runningApplicationPath)"
        permissionHint.toolTip = MacIntegration.runningApplicationPath
    }
    func windowDidBecomeKey(_ notification: Notification) { updatePermission() }
    func windowWillClose(_ notification: Notification) { testTask?.cancel(); cancelModelLoad(clearResults: false) }
    @objc private func requestPermission() { MacIntegration.requestAccessibility() }
    @objc private func engineChanged() {
        let llm = engine.indexOfSelectedItem == 1
        freeRow?.isHidden = llm
        llmRows.forEach { $0.isHidden = !llm }
        // More room for optional provider settings while keeping the free mode compact.
        let availableHeight = (window.screen ?? NSScreen.main)?.visibleFrame.height ?? 900
        let titleHeight = window.frame.height - window.contentLayoutRect.height
        window.setContentSize(NSSize(width: max(620, window.contentLayoutRect.width), height: min(llm ? 790 : 630, max(398, availableHeight - titleHeight - 32))))
        if llm { if !hasFetchedModels && modelTask == nil { requestModels() } }
        else { cancelModelLoad(clearResults: false) }
    }
    @objc private func providerChanged() {
        let p = ProviderPreset.all[provider.indexOfSelectedItem]
        draft.providerID = p.id; draft.apiStyle = p.apiStyle
        cancelModelLoad()
        endpoint.stringValue = p.baseURL; model.stringValue = p.model; key.stringValue = ""
        requestModels()
    }
    func controlTextDidChange(_ notification: Notification) {
        guard let field = notification.object as? NSTextField, field === endpoint || field === key else { return }
        // Cancel immediately, but wait until editing ends before contacting a typed address.
        cancelModelLoad()
    }
    func controlTextDidEndEditing(_ notification: Notification) {
        guard let field = notification.object as? NSTextField, field === endpoint || field === key else { return }
        if modelTask == nil && !hasFetchedModels { requestModels() }
    }
    private func cancelModelLoad(clearResults: Bool = true) {
        modelRevision += 1
        modelTask?.cancel(); modelTask = nil
        fetchModels.isEnabled = true; fetchModels.title = "刷新模型"
        if clearResults {
            let current = model.stringValue
            model.removeAllItems(); model.stringValue = current
            hasFetchedModels = false
            modelHint.stringValue = "填写 Key 后自动获取，也可手动输入模型名。"
            modelHint.textColor = .secondaryLabelColor
        }
    }
    @objc private func refreshModelsClicked() { requestModels() }
    private func requestModels() {
        guard engine.indexOfSelectedItem == 1, window.isVisible, let loadModels else { return }
        cancelModelLoad(clearResults: false)
        let revision = modelRevision
        do {
            // Fetching a list must work even before any model is chosen.
            let config = try collect(requireModel: false)
            let secret = key.stringValue
            fetchModels.isEnabled = false; fetchModels.title = "获取中…"
            modelHint.textColor = .secondaryLabelColor; modelHint.stringValue = "正在读取当前服务的模型列表…"
            modelTask = Task { [weak self] in
                do {
                    let names = try await loadModels(config, secret)
                    try Task.checkCancellation()
                    guard let self, self.modelRevision == revision else { return }
                    let current = self.model.stringValue
                    self.model.removeAllItems(); self.model.addItems(withObjectValues: names)
                    self.model.stringValue = current
                    self.hasFetchedModels = true
                    self.modelHint.textColor = .secondaryLabelColor
                    self.modelHint.stringValue = "已获取 \(names.count) 个模型；点右侧箭头选择，也可直接输入。"
                    self.modelTask = nil; self.fetchModels.isEnabled = true; self.fetchModels.title = "刷新模型"
                } catch {
                    guard let self, self.modelRevision == revision else { return }
                    self.modelTask = nil; self.fetchModels.isEnabled = true; self.fetchModels.title = "刷新模型"
                    guard !Task.isCancelled && !(error is CancellationError) else { return }
                    self.modelHint.textColor = .secondaryLabelColor
                    self.modelHint.stringValue = error.localizedDescription
                }
            }
        } catch {
            modelHint.textColor = .secondaryLabelColor; modelHint.stringValue = error.localizedDescription
        }
    }
    private func collect(requireModel: Bool = true) throws -> AppSettings {
        var settings = draft
        settings.engine = engine.indexOfSelectedItem == 1 ? "llm" : "free"
        settings.freeProvider = ["microsoft","google","tencent"][max(0,free.indexOfSelectedItem)]
        settings.baseURL = endpoint.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        settings.model = model.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        settings.livePreview = live.state == .on; settings.restoreClipboard = restore.state == .on; settings.launchAtLogin = login.state == .on
        settings.previewDelayMs = [200,300,500,800,1200][max(0,delay.indexOfSelectedItem)]
        if settings.engine == "llm" {
            _ = try TranslationService.endpoint(base: settings.baseURL, anthropic: settings.apiStyle == "anthropic")
            if requireModel && settings.model.isEmpty { throw UserError("请填写模型名称。") }
        }
        return settings
    }
    @objc private func saveClicked() {
        do { let settings = try collect(); try save?(settings,key.stringValue); draft = settings; key.stringValue = ""; cancelModelLoad(clearResults: false); if !hasFetchedModels { requestModels() }; result.textColor = .systemGreen; result.stringValue = "已保存 · 按 \(settings.hotkeyDisplay) 开始翻译" }
        catch { result.textColor = .systemRed; result.stringValue = error.localizedDescription }
    }
    @objc private func testClicked() {
        testTask?.cancel()
        do {
            let settings = try collect(), secret = key.stringValue
            result.textColor = .secondaryLabelColor; result.stringValue = "正在翻译“你好”…"
            testTask = Task { [weak self] in
                guard let self else { return }
                do { let translated = try await self.test?(settings,secret) ?? ""; try Task.checkCancellation(); self.result.textColor = .systemGreen; self.result.stringValue = "测试成功：\(translated)" }
                catch is CancellationError {}
                catch { if !Task.isCancelled { self.result.textColor = .systemRed; self.result.stringValue = error.localizedDescription } }
            }
        } catch { result.textColor = .systemRed; result.stringValue = error.localizedDescription }
    }
}
