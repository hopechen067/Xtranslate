import AppKit
import ServiceManagement

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    private let store = SettingsStore()
    private let translator = TranslationService()
    private let modelCatalog = ModelCatalogService()
    private let integration = MacIntegration()
    private let hotkey = HotkeyManager()
    private let popup = PopupController()
    private var settings: SettingsController?
    private var statusItem: NSStatusItem!
    private var translationTask: Task<Void, Never>?
    private var generation = 0
    private var direction: TranslationDirection = .auto
    private var source = ""
    private var result = ""
    private var finished = false
    private var pendingCommit = false
    private var committing = false
    private var targetPID: Int32 = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        installMenu()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(systemSymbolName: "character.bubble", accessibilityDescription: "Xtranslate") {
            image.isTemplate = true; statusItem.button?.image = image
        } else { statusItem.button?.title = "译" }
        refreshMenu()
        do { try registerHotkey(store.value) } catch { showError(error.localizedDescription) }
        popup.textChanged = { [weak self] text in self?.changed(text) }
        popup.commit = { [weak self] in self?.commitTranslation() }
        popup.cancel = { [weak self] restore in self?.cancelPopup(restoreFocus: restore) }
        popup.cycleDirection = { [weak self] in self?.nextDirection() }
        popup.toggleEngine = { [weak self] in self?.toggleEngine() }
        popup.openSettings = { [weak self] in self?.showSettings() }
        if !MacIntegration.accessibilityGranted { showSettings() }
        NSLog("Xtranslate Native ready")
    }
    private func installMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 Xtranslate", action: #selector(about), keyEquivalent: "").target = self
        appMenu.addItem(withTitle: "设置…", action: #selector(showSettings), keyEquivalent: ",").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 Xtranslate", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let edit = NSMenuItem(); let editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销",Selector(("undo:")),"z"),("剪切",#selector(NSText.cut(_:)),"x"),("复制",#selector(NSText.copy(_:)),"c"),("粘贴",#selector(NSText.paste(_:)),"v"),("全选",#selector(NSText.selectAll(_:)),"a")] {
            editMenu.addItem(withTitle: title, action: selector, keyEquivalent: key)
        }
        edit.submenu = editMenu; menu.addItem(edit); NSApp.mainMenu = menu
    }
    private func refreshMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: "翻译（\(store.value.hotkeyDisplay)）", action: #selector(togglePopup), keyEquivalent: "").target = self
        menu.addItem(withTitle: "设置…", action: #selector(showSettings), keyEquivalent: ",").target = self
        menu.addItem(withTitle: "自动粘贴权限…", action: #selector(permission), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "关于原生版", action: #selector(about), keyEquivalent: "").target = self
        menu.addItem(withTitle: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
        statusItem.button?.toolTip = "Xtranslate · \(store.value.hotkeyDisplay)"
    }
    private func registerHotkey(_ value: AppSettings) throws {
        try hotkey.register(keyCode: value.hotkeyKeyCode, modifiers: value.hotkeyModifiers) { [weak self] in self?.togglePopup() }
    }
    @objc private func togglePopup() {
        guard !committing else { return }
        if popup.panel.isVisible { cancelPopup(restoreFocus: true); return }
        targetPID = integration.captureTarget()
        generation += 1; translationTask?.cancel(); source = ""; result = ""; finished = false; pendingCommit = false; direction = .auto
        refreshChips()
        popup.show(anchor: integration.caretRect(pid: targetPID))
    }
    private func refreshChips() {
        popup.directionButton.title = direction.title
        popup.engineButton.title = store.value.engine == "llm" ? "大模型 · 口语" : "免费翻译"
    }
    private func changed(_ text: String) {
        pendingCommit = false
        scheduleTranslation(text, immediate: false)
    }
    private func scheduleTranslation(_ text: String, immediate: Bool) {
        generation += 1; let token = generation
        translationTask?.cancel(); finished = false; source = text; result = ""
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { popup.render("",status: "输入文字，回车粘贴"); return }
        let config = store.value, selectedDirection = direction
        if !immediate && !config.livePreview { popup.render("",status:"按回车开始翻译"); return }
        popup.render("",status: immediate ? "正在翻译…" : "等待输入…")
        translationTask = Task { [weak self] in
            guard let self else { return }
            do {
                if !immediate { try await Task.sleep(nanoseconds: UInt64(max(100,config.previewDelayMs)) * 1_000_000) }
                try Task.checkCancellation()
                let secret = config.engine == "llm" ? try KeychainStore.read(config) : ""
                self.popup.status.stringValue = "正在翻译…"
                let translated = try await self.translator.translate(text: text, direction: selectedDirection, settings: config, apiKey: secret, onPartial: { [weak self] partial in
                    Task { @MainActor in guard let self, self.generation == token, !self.finished else { return }; self.popup.render(partial,status:"正在翻译…") }
                })
                try Task.checkCancellation()
                guard self.generation == token else { return }
                self.generation += 1
                self.result = translated; self.finished = true
                self.popup.render(translated,status:"回车粘贴 · Tab 切换方向 · ⌘E 切换引擎")
                if self.pendingCommit { self.commitTranslation() }
            } catch is CancellationError {}
            catch {
                guard !Task.isCancelled && self.generation == token else { return }
                self.generation += 1
                self.pendingCommit = false
                self.popup.render(error.localizedDescription,status:"可重试或在设置中切换服务",error:true)
            }
        }
    }
    private func commitTranslation() {
        guard !committing else { return }
        let text = popup.input.string
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { cancelPopup(restoreFocus: true); return }
        guard finished && source == text else {
            if pendingCommit { return }
            pendingCommit = true
            scheduleTranslation(text, immediate:true)
            return
        }
        guard !result.isEmpty else { return }
        committing = true; pendingCommit = false
        let translated = result, pid = targetPID, restore = store.value.restoreClipboard
        Task { [self] in
            do { try await integration.paste(text: translated, pid: pid, restoreClipboard: restore, hide: { [weak self] in self?.popup.hide() }) }
            catch { showError(error.localizedDescription) }
            committing = false
        }
    }
    private func cancelPopup(restoreFocus: Bool) {
        guard !committing else { return }
        generation += 1; translationTask?.cancel(); pendingCommit = false
        popup.hide()
        if restoreFocus && targetPID != 0 { _ = integration.activateTarget(pid: targetPID) }
    }
    private func nextDirection() {
        direction = direction == .auto ? .zh2en : (direction == .zh2en ? .en2zh : .auto)
        refreshChips(); pendingCommit = false; scheduleTranslation(popup.input.string, immediate:true)
    }
    private func toggleEngine() {
        var config = store.value; config.engine = config.engine == "free" ? "llm" : "free"
        do { try store.save(config); refreshChips(); pendingCommit = false; scheduleTranslation(popup.input.string,immediate:true) }
        catch { showError(error.localizedDescription) }
    }
    @objc private func showSettings() {
        cancelPopup(restoreFocus: false)
        if let settings, settings.window.isVisible { settings.show(); return }
        let controller = SettingsController(settings: store.value)
        controller.save = { [weak self] next, secret in
            guard let self else { return }
            let previous = self.store.value
            if next.launchAtLogin != previous.launchAtLogin {
                guard Bundle.main.bundlePath.contains("/Applications/") else { throw UserError("请先把应用放入“应用程序”，再设置登录时启动。") }
                if next.launchAtLogin { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            }
            do {
                try self.registerHotkey(next)
                try KeychainStore.save(secret,settings:next)
                try self.store.save(next)
            } catch {
                try? self.registerHotkey(previous)
                if next.launchAtLogin != previous.launchAtLogin {
                    if previous.launchAtLogin { try? SMAppService.mainApp.register() } else { try? SMAppService.mainApp.unregister() }
                }
                throw error
            }
            self.refreshMenu(); self.refreshChips()
        }
        controller.test = { [weak self] config, secret in
            guard let self else { throw CancellationError() }
            let apiKey = config.engine == "llm" && secret.isEmpty ? try KeychainStore.read(config) : secret
            return try await self.translator.translate(text:"你好",direction:.zh2en,settings:config,apiKey:apiKey,onPartial:{_ in})
        }
        controller.loadModels = { [weak self] config, typedKey in
            guard let self else { throw CancellationError() }
            let apiKey: String
            if !typedKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { apiKey = typedKey }
            else if config.providerID == "openrouter" && ModelCatalogService.allowsUnauthenticated(settings: config) { apiKey = "" }
            else { apiKey = try KeychainStore.read(config) }
            try Task.checkCancellation()
            return try await self.modelCatalog.listModels(settings: config, apiKey: apiKey)
        }
        settings = controller; controller.show()
    }
    @objc private func permission() { MacIntegration.requestAccessibility() }
    @objc private func about() { showError("Xtranslate 原生轻量版 1.1.1\n使用 macOS 系统组件，无 Electron 或浏览器内核。\n基于 hopechen067/Xtranslate（MIT）改写。") }
    private func showError(_ message: String) {
        let alert = NSAlert(); alert.messageText = "Xtranslate"; alert.informativeText = message; alert.addButton(withTitle:"知道了")
        NSApp.activate(ignoringOtherApps:true); alert.runModal()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { translationTask?.cancel(); hotkey.unregister() }
}
