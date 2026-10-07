import Foundation

enum ModelCatalogError: LocalizedError {
    case invalidEndpoint, missingKey, malformed, empty, tooLarge, pagination, timeout, network, redirect
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .invalidEndpoint: return "接口地址无效：请使用 HTTPS 地址，本机服务可使用 HTTP，地址中不要包含密钥或查询参数。"
        case .missingKey: return "请先填写该服务的 API Key，再获取模型列表。"
        case .malformed: return "服务没有返回可识别的模型列表，可手动填写模型名称。"
        case .empty: return "该服务未返回可用模型，可手动填写模型名称。"
        case .tooLarge: return "模型列表过大，获取已停止；可手动填写模型名称。"
        case .pagination: return "服务返回的模型分页异常，获取已停止；可手动填写模型名称。"
        case .timeout: return "获取模型列表超时，请检查网络后重试，或手动填写模型名称。"
        case .network: return "无法连接模型服务，请检查接口地址、网络或本机服务。也可手动填写模型名称。"
        case .redirect: return "模型接口发生了不安全的跳转，已停止请求；请检查接口地址。"
        case .http(let status):
            switch status {
            case 401, 403: return "无法获取模型：API Key 无效或没有访问权限，请检查密钥。"
            case 404, 405, 501: return "该接口不支持获取模型列表，请手动填写模型名称。"
            case 429: return "获取模型过于频繁，请稍后重试。"
            case 500...599: return "模型服务暂时不可用，请稍后重试，或手动填写模型名称。"
            default: return "获取模型失败（HTTP \(status)），可手动填写模型名称。"
            }
        }
    }
}

private final class ModelCatalogRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.originalRequest?.url, let target = request.url,
              ModelCatalogService.allowsRedirect(from: original, to: target) else {
            completionHandler(nil)
            return
        }
        var redirected = request
        // Foundation can drop Authorization even on a same-origin redirect.
        for header in ["Authorization", "x-api-key", "anthropic-version"] {
            redirected.setValue(task.originalRequest?.value(forHTTPHeaderField: header), forHTTPHeaderField: header)
        }
        completionHandler(redirected)
    }
}

actor ModelCatalogService {
    struct Page: Sendable {
        let models: [String]
        let nextCursor: String?
    }

    private let session: URLSession
    private static let maximumBytes = 8_000_000
    private static let maximumModels = 10_000
    private static let maximumPages = 20

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        session = URLSession(configuration: configuration, delegate: ModelCatalogRedirectDelegate(), delegateQueue: nil)
    }

    func listModels(settings: AppSettings, apiKey: String) async throws -> [String] {
        do {
            try Task.checkCancellation()
            // Race the complete operation against a deadline, including all pages.
            return try await withThrowingTaskGroup(of: [String].self) { group in
                group.addTask { try await self.loadModels(settings: settings, apiKey: apiKey) }
                group.addTask {
                    try await Task.sleep(nanoseconds: 45_000_000_000)
                    throw ModelCatalogError.timeout
                }
                defer { group.cancelAll() }
                return try await group.next()!
            }
        } catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled {
                throw CancellationError()
            }
            if error is ModelCatalogError { throw error }
            if (error as? URLError)?.code == .timedOut { throw ModelCatalogError.timeout }
            throw ModelCatalogError.network
        }
    }

    nonisolated private static func validatedBase(_ base: String) throws -> URLComponents {
        guard var parts = URLComponents(string: base.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.scheme == "https" || (parts.scheme == "http" && isLoopback(host)) else {
            throw ModelCatalogError.invalidEndpoint
        }
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard parts.url != nil else { throw ModelCatalogError.invalidEndpoint }
        return parts
    }

    nonisolated private static func isLoopback(_ host: String) -> Bool {
        ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host.lowercased())
    }

    nonisolated static func endpoint(base: String, anthropic: Bool) throws -> URL {
        var parts = try validatedBase(base)
        if parts.path.hasSuffix("/chat/completions") { parts.path.removeLast("/chat/completions".count) }
        if anthropic && parts.path.hasSuffix("/messages") { parts.path.removeLast("/messages".count) }
        if !parts.path.hasSuffix("/models") {
            if anthropic && !parts.path.hasSuffix("/v1") { parts.path += "/v1" }
            parts.path += "/models"
        }
        guard let url = parts.url else { throw ModelCatalogError.invalidEndpoint }
        return url
    }

    nonisolated static func allowsUnauthenticated(settings: AppSettings) -> Bool {
        guard let endpoint = try? endpoint(base: settings.baseURL, anthropic: settings.apiStyle == "anthropic") else { return false }
        if isPublicOpenRouter(endpoint) { return true }
        return ["custom", "ollama"].contains(settings.providerID)
    }

    nonisolated private static func isPublicOpenRouter(_ endpoint: URL) -> Bool {
        endpoint.scheme == "https" && endpoint.host?.lowercased() == "openrouter.ai" &&
            (endpoint.port == nil || endpoint.port == 443) && endpoint.path == "/api/v1/models"
    }

    nonisolated static func allowsRedirect(from origin: URL, to target: URL) -> Bool {
        func port(_ url: URL) -> Int { url.port ?? (url.scheme == "https" ? 443 : 80) }
        return origin.scheme == target.scheme && origin.host?.lowercased() == target.host?.lowercased() &&
            port(origin) == port(target) && target.user == nil && target.password == nil && target.fragment == nil
    }

    // Only the configured local Ollama service may fall back to its native API.
    nonisolated static func ollamaFallback(settings: AppSettings) -> URL? {
        guard settings.providerID == "ollama", settings.apiStyle != "anthropic",
              var parts = try? validatedBase(settings.baseURL), isLoopback(parts.host ?? ""),
              ["", "/v1", "/v1/chat/completions", "/v1/models"].contains(parts.path) else { return nil }
        parts.path = "/api/tags"
        return parts.url
    }

    nonisolated static func parsePage(_ data: Data, ollama: Bool = false) throws -> Page {
        guard data.count <= maximumBytes,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], object["error"] == nil,
              let entries = object[ollama ? "models" : "data"] as? [[String: Any]] else {
            throw ModelCatalogError.malformed
        }
        guard entries.count <= maximumModels else { throw ModelCatalogError.tooLarge }
        var models = Set<String>()
        for entry in entries {
            guard let raw = (ollama ? (entry["name"] ?? entry["model"]) : entry["id"]) as? String else {
                throw ModelCatalogError.malformed
            }
            let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, name.utf8.count <= 1024,
                  !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
                throw ModelCatalogError.malformed
            }
            models.insert(name)
        }
        let hasMore = object["has_more"] as? Bool ?? false
        var nextCursor: String?
        if hasMore {
            guard let cursor = object["last_id"] as? String, !cursor.isEmpty, cursor.utf8.count <= 1024,
                  !models.isEmpty else { throw ModelCatalogError.pagination }
            nextCursor = cursor
        }
        return Page(models: models.sorted { $0.localizedStandardCompare($1) == .orderedAscending }, nextCursor: nextCursor)
    }

    private func loadModels(settings: AppSettings, apiKey: String) async throws -> [String] {
        let originalEndpoint = try Self.endpoint(base: settings.baseURL, anthropic: settings.apiStyle == "anthropic")
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty || Self.allowsUnauthenticated(settings: settings) else { throw ModelCatalogError.missingKey }
        var endpoint = originalEndpoint
        var models = Set<String>(), cursors = Set<String>()
        for _ in 0..<Self.maximumPages {
            try Task.checkCancellation()
            var request = URLRequest(url: endpoint, timeoutInterval: 15)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            // The public OpenRouter catalog does not need a credential.
            if settings.apiStyle == "anthropic" {
                if !key.isEmpty { request.setValue(key, forHTTPHeaderField: "x-api-key") }
                request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            } else if !key.isEmpty && !Self.isPublicOpenRouter(originalEndpoint) {
                request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            }
            let page: Page
            do { page = try Self.parsePage(await fetch(request)) }
            catch ModelCatalogError.http(let status) where [404, 405, 501].contains(status) && endpoint == originalEndpoint {
                guard let fallback = Self.ollamaFallback(settings: settings) else { throw ModelCatalogError.http(status) }
                // Keep any configured auth, but retain the same scheme, host and port.
                request.url = fallback
                let native = try Self.parsePage(await fetch(request), ollama: true)
                guard !native.models.isEmpty else { throw ModelCatalogError.empty }
                return native.models
            }
            models.formUnion(page.models)
            guard models.count <= Self.maximumModels else { throw ModelCatalogError.tooLarge }
            guard let cursor = page.nextCursor else {
                guard !models.isEmpty else { throw ModelCatalogError.empty }
                return models.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            }
            guard cursors.insert(cursor).inserted else { throw ModelCatalogError.pagination }
            // Never follow a server-supplied URL or move credentials to a new origin.
            var parts = URLComponents(url: originalEndpoint, resolvingAgainstBaseURL: false)!
            parts.queryItems = [URLQueryItem(name: "after_id", value: cursor)]
            endpoint = parts.url!
        }
        throw ModelCatalogError.pagination
    }

    private func fetch(_ request: URLRequest) async throws -> Data {
        try Task.checkCancellation()
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let response = response as? HTTPURLResponse else { throw ModelCatalogError.malformed }
        if (300...399).contains(response.statusCode) { throw ModelCatalogError.redirect }
        guard (200...299).contains(response.statusCode) else { throw ModelCatalogError.http(response.statusCode) }
        guard response.expectedContentLength <= Self.maximumBytes else { throw ModelCatalogError.tooLarge }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < Self.maximumBytes else { throw ModelCatalogError.tooLarge }
            data.append(byte)
        }
        try Task.checkCancellation()
        return data
    }
}
