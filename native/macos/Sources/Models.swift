import Foundation
import Security

enum TranslationDirection: String, Codable, Sendable, CaseIterable {
    case auto, zh2en, en2zh
    var title: String { switch self { case .auto: return "自动识别"; case .zh2en: return "中 → 英"; case .en2zh: return "英 → 中" } }
}

struct AppSettings: Codable, Sendable {
    var engine = "free"
    var freeProvider = "microsoft"
    var providerID = "zhipu"
    var baseURL = "https://open.bigmodel.cn/api/paas/v4"
    var model = "glm-4-flash-250414"
    var apiStyle = "openai"
    var livePreview = true
    var previewDelayMs = 300
    var restoreClipboard = true
    var launchAtLogin = false
    var hotkeyKeyCode: UInt32 = 12
    var hotkeyModifiers: UInt32 = 2048
    var hotkeyDisplay = "⌥Q"
}

struct UserError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

@MainActor final class SettingsStore {
    private let url: URL
    private(set) var value: AppSettings
    init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("XtranslateNative", isDirectory: true)
        url = folder.appendingPathComponent("settings.json")
        value = (try? JSONDecoder().decode(AppSettings.self, from: Data(contentsOf: url))) ?? AppSettings()
    }
    func save(_ next: AppSettings) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(next).write(to: url, options: .atomic)
        value = next
    }
}

enum KeychainStore {
    private static func query(_ settings: AppSettings) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.xtranslate.native.api",
         kSecAttrAccount as String: settings.providerID + "|" + settings.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)]
    }
    static func read(_ settings: AppSettings) throws -> String {
        var q = query(settings)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return "" }
        guard status == errSecSuccess, let data = result as? Data else { throw UserError("无法读取钥匙串中的 API Key，请在设置中重新保存。") }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func save(_ key: String, settings: AppSettings) throws {
        guard !key.isEmpty else { return }
        let q = query(settings)
        let values = [kSecValueData as String: Data(key.utf8)]
        var status = SecItemUpdate(q as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            var insert = q.merging(values) { _, new in new }
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw UserError("API Key 未能保存到系统钥匙串，请重试。") }
    }
}
