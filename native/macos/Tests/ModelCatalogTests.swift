import Foundation

@main struct ModelCatalogTests {
    static var passed = 0
    static func check(_ condition: @autoclosure () throws -> Bool, _ label: String) throws {
        guard try condition() else { throw UserError("Test failed: \(label)") }
        passed += 1
    }
    static func rejects(_ label: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { passed += 1; return }
        throw UserError("Did not reject: \(label)")
    }
    static func json(_ value: String) -> Data { Data(value.utf8) }
    static func main() async throws {
        try check(ModelCatalogService.endpoint(base: "https://example.com/v1/", anthropic: false).absoluteString == "https://example.com/v1/models", "compatible endpoint")
        try check(ModelCatalogService.endpoint(base: "https://example.com/v1/chat/completions", anthropic: false).path == "/v1/models", "full completion endpoint")
        try check(ModelCatalogService.endpoint(base: "https://example.com", anthropic: false).path == "/models", "unversioned compatible endpoint")
        try check(ModelCatalogService.endpoint(base: "https://example.com", anthropic: true).path == "/v1/models", "Anthropic endpoint")
        try check(ModelCatalogService.endpoint(base: "https://example.com/v1/", anthropic: true).path == "/v1/models", "Anthropic v1 not duplicated")
        try check(ModelCatalogService.endpoint(base: "https://example.com/v1/messages", anthropic: true).path == "/v1/models", "Anthropic full endpoint")
        try check(ModelCatalogService.endpoint(base: "https://generativelanguage.googleapis.com/v1beta/openai/", anthropic: false).path == "/v1beta/openai/models", "Gemini compatible endpoint")
        try check(ModelCatalogService.endpoint(base: "http://[::1]:11434/v1", anthropic: false).path == "/v1/models", "IPv6 loopback")
        for base in ["http://example.com/v1", "https://user:key@example.com", "https://example.com?key=secret", "https://example.com#fragment", "not a URL"] {
            try rejects("invalid endpoint") { _ = try ModelCatalogService.endpoint(base: base, anthropic: false) }
        }
        var settings = AppSettings()
        settings.providerID = "openrouter"
        settings.baseURL = "https://openrouter.ai/api/v1"
        try check(ModelCatalogService.allowsUnauthenticated(settings: settings), "public OpenRouter")
        settings.baseURL = "https://openrouter.ai.example.com/api/v1"
        try check(!ModelCatalogService.allowsUnauthenticated(settings: settings), "spoofed OpenRouter host")
        settings.baseURL = "https://openrouter.ai:8443/api/v1"
        try check(!ModelCatalogService.allowsUnauthenticated(settings: settings), "noncanonical OpenRouter port")
        settings.baseURL = "https://openrouter.ai/custom/v1"
        try check(!ModelCatalogService.allowsUnauthenticated(settings: settings), "noncanonical OpenRouter path")
        settings.providerID = "custom"
        settings.baseURL = "http://localhost:12345/v1"
        try check(ModelCatalogService.allowsUnauthenticated(settings: settings), "local custom anonymous")
        settings.providerID = "ollama"
        try check(ModelCatalogService.ollamaFallback(settings: settings)?.absoluteString == "http://localhost:12345/api/tags", "Ollama fallback retains origin")
        settings.baseURL = "https://example.com/v1"
        try check(ModelCatalogService.allowsUnauthenticated(settings: settings), "remote Ollama can request anonymously")
        try check(ModelCatalogService.ollamaFallback(settings: settings) == nil, "remote fallback forbidden")
        settings.baseURL = "http://localhost:12345/proxy/v1"
        try check(ModelCatalogService.ollamaFallback(settings: settings) == nil, "custom local path not rewritten")
        let origin = URL(string: "https://example.com/v1/models")!
        try check(ModelCatalogService.allowsRedirect(from: origin, to: URL(string: "https://EXAMPLE.com:443/catalog")!), "equivalent origin redirects")
        for target in ["http://example.com/models", "https://evil.example/models", "https://example.com:8443/models", "https://user:key@example.com/models"] {
            try check(!ModelCatalogService.allowsRedirect(from: origin, to: URL(string: target)!), "unsafe redirects forbidden")
        }
        let page = try ModelCatalogService.parsePage(json(#"{"data":[{"id":"model-10"},{"id":"model-2"},{"id":"model-2"}]}"#))
        try check(page.models == ["model-2", "model-10"] && page.nextCursor == nil, "model IDs deduplicated and naturally sorted")
        let nextPage = try ModelCatalogService.parsePage(json(#"{"data":[{"id":"claude-1"}],"has_more":true,"last_id":"claude-1"}"#))
        try check(nextPage.nextCursor == "claude-1", "Anthropic pagination")
        try check(ModelCatalogService.parsePage(json(#"{"models":[{"name":"qwen:7b"},{"model":"gemma:4b"}]}"#), ollama: true).models == ["gemma:4b", "qwen:7b"], "Ollama native names")
        for input in ["<html>error</html>", #"{"data":[{"name":"not-an-id"}]}"#, #"{"data":[{"id":""}]}"#, #"{"data":[{"id":"a\nb"}]}"#, #"{"data":[],"error":{"message":"secret"}}"#, #"{"data":[],"has_more":true,"last_id":"bad"}"#] {
            try rejects("malformed model response") { _ = try ModelCatalogService.parsePage(json(input)) }
        }
        let service = ModelCatalogService()
        settings.providerID = "openai"
        settings.baseURL = "https://api.openai.com/v1"
        do { _ = try await service.listModels(settings: settings, apiKey: ""); throw UserError("Missing key accepted") }
        catch ModelCatalogError.missingKey { passed += 1 }

        if let flag = CommandLine.arguments.firstIndex(of: "--mock-base") {
            let base = CommandLine.arguments[flag + 1]
            settings.providerID = "custom"
            settings.baseURL = base + "/openai"
            let models = try await service.listModels(settings: settings, apiKey: "fixture-secret")
            try check(models == ["alpha", "model-2", "model-10"], "authenticated compatible GET")
            settings.baseURL = base + "/anonymous"
            let anonymous = try await service.listModels(settings: settings, apiKey: "")
            try check(anonymous == ["local-model"], "anonymous local GET")
            settings.baseURL = base + "/anthropic"
            settings.apiStyle = "anthropic"
            let claude = try await service.listModels(settings: settings, apiKey: "fixture-secret")
            try check(claude == ["claude-a", "claude-b"], "Anthropic headers and all pages")
            settings.apiStyle = "openai"
            settings.baseURL = base + "/redirect"
            let redirected = try await service.listModels(settings: settings, apiKey: "fixture-secret")
            try check(redirected == models, "same-origin redirect retains authentication")
            settings.baseURL = base + "/cross-origin"
            do { _ = try await service.listModels(settings: settings, apiKey: "fixture-secret"); throw UserError("Cross-origin redirect accepted") }
            catch ModelCatalogError.redirect { passed += 1 }
            for (path, expected) in [("empty", "empty"), ("bad", "malformed"), ("error", "malformed"), ("oversized", "size"), ("cycle", "pagination"), ("pages", "pagination"), ("denied", "http"), ("unsupported", "http")] {
                settings.baseURL = base + "/" + path
                do { _ = try await service.listModels(settings: settings, apiKey: "fixture-secret"); throw UserError("Response unexpectedly accepted: \(path)") }
                catch let error as ModelCatalogError {
                    switch (expected, error) {
                    case ("empty", .empty), ("malformed", .malformed), ("size", .tooLarge), ("pagination", .pagination), ("http", .http): passed += 1
                    default: throw UserError("Wrong error for \(path): \(error)")
                    }
                }
            }
            settings.providerID = "ollama"
            settings.baseURL = base + "/v1"
            let ollama = try await service.listModels(settings: settings, apiKey: "")
            try check(ollama == ["qwen:7b"], "local Ollama native fallback")
            settings.providerID = "custom"
            settings.baseURL = base + "/cancel"
            let cancellationSettings = settings
            let task = Task { try await service.listModels(settings: cancellationSettings, apiKey: "") }
            try await Task.sleep(nanoseconds: 100_000_000)
            task.cancel()
            do { _ = try await task.value; throw UserError("Cancellation ignored") }
            catch is CancellationError { passed += 1 }
        }
        if CommandLine.arguments.contains("--live") {
            settings.providerID = "openrouter"
            settings.baseURL = "https://openrouter.ai/api/v1"
            settings.apiStyle = "openai"
            let models = try await service.listModels(settings: settings, apiKey: "")
            try check(!models.isEmpty && models.contains(where: { $0.contains("/") }), "public OpenRouter live catalog")
            print("Public OpenRouter catalog: \(models.count) models")
        }
        print("Model catalog: \(passed) checks passed")
    }
}
