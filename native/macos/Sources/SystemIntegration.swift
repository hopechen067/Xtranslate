import AppKit
import ApplicationServices
import Carbon

enum IntegrationError: LocalizedError {
    case accessibility, eventPermission, secureInput, missingTarget, targetNotReady, clipboard, clipboardChanged, pasteBusy
    case hotkey(OSStatus)

    var errorDescription: String? {
        switch self {
        case .accessibility:
            return "当前运行的 Xtranslate 尚未获得辅助功能权限。若列表里已勾选，请移除旧条目，重新添加“应用程序”中的最新版 Xtranslate，并退出后重新打开。译文已复制，可手动按 ⌘V。"
        case .eventPermission:
            return "macOS 仍未允许当前版本发送粘贴按键。请在辅助功能中重新添加最新版 Xtranslate，然后退出并重新打开。译文已复制，可手动按 ⌘V。"
        case .secureInput:
            return "当前应用启用了安全键盘输入，暂时不能自动发送粘贴按键。译文已复制，可切回输入框手动按 ⌘V。"
        case .missingTarget:
            return "译文已复制。原来的应用已关闭或未找到，请切回需要输入的窗口后按 ⌘V。"
        case .targetNotReady:
            return "译文已复制。未能确认原输入窗口或快捷键尚未松开，请切回输入窗口后按 ⌘V。"
        case .clipboard:
            return "暂时无法写入剪贴板，请重试。"
        case .clipboardChanged:
            return "等待粘贴时剪贴板被其他应用更新，已停止自动粘贴，请重试。"
        case .pasteBusy:
            return "正在粘贴上一段译文，请稍候。"
        case .hotkey:
            return "这个快捷键已被占用或无法注册，请换一个组合。"
        }
    }
}

/// Carbon hotkeys do not require monitoring all of the user's keyboard input.
final class HotkeyManager {
    private var hotkey: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var registeredKey: UInt32?
    private var registeredModifiers: UInt32?
    private var action: (() -> Void)?
    private static var nextIdentifier: UInt32 = 1
    private var activeIdentifier: UInt32 = 0
    private static let signature: OSType = 0x5854524E // XTRN

    func register(keyCode: UInt32 = 12, modifiers: UInt32 = 2048,
                  handler: @escaping () -> Void) throws {
        if registeredKey == keyCode, registeredModifiers == modifiers, hotkey != nil {
            action = handler
            return
        }
        if eventHandler == nil {
            var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                          eventKind: UInt32(kEventHotKeyPressed))
            let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
                guard let context, let event else { return OSStatus(eventNotHandledErr) }
                let manager = Unmanaged<HotkeyManager>.fromOpaque(context).takeUnretainedValue()
                var identifier = EventHotKeyID()
                let result = GetEventParameter(event, EventParamName(kEventParamDirectObject),
                                               EventParamType(typeEventHotKeyID), nil,
                                               MemoryLayout<EventHotKeyID>.size, nil, &identifier)
                guard result == noErr,
                      identifier.signature == HotkeyManager.signature,
                      identifier.id == manager.activeIdentifier else { return OSStatus(eventNotHandledErr) }
                manager.action?()
                return noErr
            }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
            guard status == noErr else { throw IntegrationError.hotkey(status) }
        }

        let identifier = Self.nextIdentifier
        Self.nextIdentifier &+= 1
        var candidate: EventHotKeyRef?
        let status = RegisterEventHotKey(keyCode, modifiers,
                                         EventHotKeyID(signature: Self.signature, id: identifier),
                                         GetApplicationEventTarget(), 0, &candidate)
        guard status == noErr, let candidate else { throw IntegrationError.hotkey(status) }
        // Keep the previous registration until its replacement succeeds.
        if let previous = hotkey { UnregisterEventHotKey(previous) }
        hotkey = candidate
        activeIdentifier = identifier
        registeredKey = keyCode
        registeredModifiers = modifiers
        action = handler
    }

    func unregister() {
        if let hotkey { UnregisterEventHotKey(hotkey) }
        hotkey = nil
        registeredKey = nil
        registeredModifiers = nil
        activeIdentifier = 0
        action = nil
        if let eventHandler { RemoveEventHandler(eventHandler) }
        eventHandler = nil
    }

    deinit { unregister() }
}

@MainActor
final class MacIntegration {
    private var isPasting = false

    static var accessibilityGranted: Bool { AXIsProcessTrusted() }
    static var canPostEvents: Bool { xt_can_post_events() }
    static var runningApplicationPath: String { Bundle.main.bundlePath }

    static func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    func captureTarget() -> Int32 { xt_capture_target() }

    /// Accessibility uses global screen coordinates, with the origin at the top left.
    func caretRect(pid: Int32) -> CGRect? {
        var values = [Double](repeating: 0, count: 4)
        guard xt_caret_rect(pid, &values), values.allSatisfy(\.isFinite) else { return nil }
        return CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
    }

    func activateTarget(pid: Int32) -> Bool { xt_activate_target(pid) }

    func paste(text: String, pid: Int32, restoreClipboard: Bool,
               hide: @escaping () -> Void) async throws {
        guard !isPasting else { throw IntegrationError.pasteBusy }
        isPasting = true
        // Every failure retains the translation for manual paste.
        defer {
            xt_finish_clipboard(false)
            isPasting = false
        }
        xt_save_clipboard()
        guard xt_write_text(text) else { throw IntegrationError.clipboard }
        guard Self.accessibilityGranted else { throw IntegrationError.accessibility }
        guard Self.canPostEvents else { throw IntegrationError.eventPermission }
        guard !IsSecureEventInputEnabled() else { throw IntegrationError.secureInput }
        guard pid > 0,
              let target = NSRunningApplication(processIdentifier: pid), !target.isTerminated else {
            throw IntegrationError.missingTarget
        }
        try Task.checkCancellation()
        hide()
        guard activateTarget(pid: pid) else { throw IntegrationError.missingTarget }

        // Give the application time to take focus and the user time to release
        // Option/Return. Never send a key until both the app and saved window match.
        // AX queries can block until their own timeout, so cap total elapsed
        // time with a monotonic deadline rather than counting polling attempts.
        let readinessClock = ContinuousClock()
        let readinessDeadline = readinessClock.now.advanced(by: .seconds(2))
        var consecutiveReadyChecks = 0
        while readinessClock.now < readinessDeadline {
            try await Task.sleep(nanoseconds: 40_000_000)
            guard readinessClock.now < readinessDeadline else { break }
            guard xt_clipboard_is_current() else { throw IntegrationError.clipboardChanged }
            let targetReady = xt_target_is_ready(pid) && xt_modifiers_released()
            try Task.checkCancellation()
            guard readinessClock.now < readinessDeadline else { break }
            if targetReady {
                consecutiveReadyChecks += 1
                if consecutiveReadyChecks >= 3 { break }
            } else {
                consecutiveReadyChecks = 0
            }
        }
        guard Self.accessibilityGranted else { throw IntegrationError.accessibility }
        guard Self.canPostEvents else { throw IntegrationError.eventPermission }
        guard !IsSecureEventInputEnabled() else { throw IntegrationError.secureInput }
        guard consecutiveReadyChecks >= 3, xt_paste(pid) else { throw IntegrationError.targetNotReady }
        if restoreClipboard {
            // A successful paste still needs its clipboard while the receiver
            // handles the key event. Cancellation must not shorten that interval.
            await withCheckedContinuation { continuation in
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { continuation.resume() }
            }
            xt_finish_clipboard(true)
        }
    }
}
