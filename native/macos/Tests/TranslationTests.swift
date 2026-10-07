import Foundation

@main struct TranslationTests {
    static var passed = 0
    static func check(_ condition: @autoclosure () throws -> Bool, _ label: String) throws {
        guard try condition() else { throw NSError(domain: "TranslationTests", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
        passed += 1
    }
    static func rejects(_ label: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { passed += 1; return }
        throw NSError(domain: "TranslationTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Did not reject: \(label)"])
    }
    static func main() async throws {
        try check(TranslationService.detectDirection("我明天有个 meeting") == .zh2en, "mixed direction")
        try check(TranslationService.detectDirection("Hello, how are you?") == .en2zh, "English direction")
        try check(TranslationService.detectDirection("你好世界") == .zh2en, "Chinese direction")
        try check(TranslationService.detectDirection("123 🙂") == .zh2en, "symbol direction")
        try check(TranslationService.detectDirection("𠀀") == .zh2en, "extended Chinese direction")
        try check(TranslationService.cleanOutput(" <text>\nTranslation: “Hello!”\n</text> ") == "Hello!", "wrapper removal")
        try check(TranslationService.cleanOutput("他说：“你好”") == "他说：“你好”", "internal quotes unchanged")
        try check(TranslationService.cleanOutput("\"one\" and \"two\"") == "\"one\" and \"two\"", "distinct quotations unchanged")
        try check(TranslationService.cleanOutput("第一行\n第二行") == "第一行\n第二行", "line breaks unchanged")
        let auth = try TranslationService.parseBingAuth("var params_AbusePreventionHelper = [12345,\"test-token\",3600000]; IG:\"ABC012\"; data-iid=\"translator.123\"", now: Date(timeIntervalSince1970: 100))
        try check(auth.key == "12345" && auth.token == "test-token" && auth.ig == "ABC012" && auth.iid == "translator.123", "Bing token fields")
        try check(auth.expiry.timeIntervalSince1970 == 3640, "Bing token expiry margin")
        try rejects("missing Bing auth") { _ = try TranslationService.parseBingAuth("captcha") }
        try check(TranslationService.parseMicrosoft([["translations": [["text": "Hello"]]]]) == "Hello", "Bing response")
        try rejects("expired Bing token") { _ = try TranslationService.parseMicrosoft(["statusCode": 205]) }
        try rejects("malformed Bing response") { _ = try TranslationService.parseMicrosoft(["hello": true]) }
        try check(TranslationService.parseGoogle([[["one", "一"], ["two", "二"]]]) == "onetwo", "Google segments")
        try rejects("empty Google response") { _ = try TranslationService.parseGoogle([[]]) }
        try check(TranslationService.parseTencent(["auto_translation": ["a", "b"]]) == "a\nb", "Tencent lines")
        try rejects("malformed Tencent response") { _ = try TranslationService.parseTencent(["auto_translation": [3]]) }
        try check(String(data: TranslationService.formEncoded([("text", "a+b & 你好\n")]), encoding: .utf8) == "text=a%2Bb%20%26%20%E4%BD%A0%E5%A5%BD%0A", "form encoding")
        try check(TranslationService.endpoint(base: "https://example.com/v1/", anthropic: false).absoluteString == "https://example.com/v1/chat/completions", "OpenAI endpoint")
        try check(TranslationService.endpoint(base: "https://example.com/v1/chat/completions", anthropic: false).absoluteString == "https://example.com/v1/chat/completions", "complete endpoint")
        try check(TranslationService.endpoint(base: "https://example.com/v1", anthropic: true).absoluteString == "https://example.com/v1/messages", "Anthropic no duplicate v1")
        try check(TranslationService.endpoint(base: "https://example.com", anthropic: true).absoluteString == "https://example.com/v1/messages", "Anthropic endpoint")
        try check(TranslationService.endpoint(base: "http://localhost:11434/v1", anthropic: false).host == "localhost", "local HTTP permitted")
        try rejects("remote cleartext endpoint") { _ = try TranslationService.endpoint(base: "http://example.com/v1", anthropic: false) }
        try rejects("URL embedded credentials") { _ = try TranslationService.endpoint(base: "https://name:secret@example.com", anthropic: false) }
        try rejects("URL query") { _ = try TranslationService.endpoint(base: "https://example.com?key=secret", anthropic: false) }
        try check(TranslationService.parseStreamPiece("[DONE]", anthropic: false).done, "stream completion")
        let openAI = try TranslationService.parseStreamPiece(#"{"choices":[{"delta":{"content":"你好","reasoning_content":"hidden"}}]}"#, anthropic: false)
        try check(openAI.text == "你好" && openAI.reasoning == "hidden", "OpenAI reasoning separated")
        let anthropic = try TranslationService.parseStreamPiece(#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}"#, anthropic: true)
        try check(anthropic.text == "Hello", "Anthropic text delta")
        try check(TranslationService.parseStreamPiece(#"{"type":"message_stop"}"#, anthropic: true).done, "Anthropic completion")
        try check(TranslationService.parseStreamPiece(#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#, anthropic: false).truncated, "truncated response")
        try rejects("malformed stream") { _ = try TranslationService.parseStreamPiece("invalid", anthropic: false) }
        try rejects("stream error") { _ = try TranslationService.parseStreamPiece(#"{"error":{"message":"secret"}}"#, anthropic: false) }

        let service = TranslationService()
        do { _ = try await service.translate(text: " ", direction: .auto, settings: AppSettings(), apiKey: "", onPartial: { _ in }); throw NSError(domain: "Test", code: 1) }
        catch TranslationError.emptyInput { passed += 1 }
        do { _ = try await service.translate(text: String(repeating: "字", count: 10001), direction: .auto, settings: AppSettings(), apiKey: "", onPartial: { _ in }); throw NSError(domain: "Test", code: 1) }
        catch TranslationError.inputTooLong { passed += 1 }

        if let flag = CommandLine.arguments.firstIndex(of: "--mock-base"), CommandLine.arguments.count > flag + 1 {
            let base = CommandLine.arguments[flag + 1]
            var settings = AppSettings()
            settings.engine = "llm"
            settings.providerID = "custom"
            settings.baseURL = base + "/openai"
            settings.model = "fixture"
            // Deliberately fake; sent only to the local test fixture.
            let fixtureKey = "fixture-key-not-a-real-credential"
            let result = try await service.translate(text: "test", direction: .en2zh, settings: settings, apiKey: fixtureKey, onPartial: { _ in })
            try check(result == "你好 🌍", "OpenAI real UTF8 SSE with CRLF")
            settings.baseURL = base + "/anthropic"
            settings.apiStyle = "anthropic"
            let anthropicResult = try await service.translate(text: "test", direction: .en2zh, settings: settings, apiKey: fixtureKey, onPartial: { _ in })
            try check(anthropicResult == "你好", "Anthropic real SSE")
            settings.baseURL = base + "/redirect-anthropic"
            let redirectedAnthropic = try await service.translate(text: "test", direction: .en2zh, settings: settings, apiKey: fixtureKey, onPartial: { _ in })
            try check(redirectedAnthropic == "你好", "Anthropic same-origin redirect keeps authentication")
            settings.baseURL = base + "/cross-anthropic"
            do { _ = try await service.translate(text: "test", direction: .auto, settings: settings, apiKey: fixtureKey, onPartial: { _ in }); throw NSError(domain: "Test", code: 1) }
            catch TranslationError.http(307, _) { passed += 1 }
            settings.baseURL = base + "/redirect-openai"
            settings.apiStyle = "openai"
            let redirectedOpenAI = try await service.translate(text: "test", direction: .en2zh, settings: settings, apiKey: fixtureKey, onPartial: { _ in })
            try check(redirectedOpenAI == "你好 🌍", "OpenAI same-origin redirect keeps authentication")
            settings.baseURL = base + "/cross-openai"
            do { _ = try await service.translate(text: "test", direction: .auto, settings: settings, apiKey: fixtureKey, onPartial: { _ in }); throw NSError(domain: "Test", code: 1) }
            catch TranslationError.http(307, _) { passed += 1 }
            settings.baseURL = base + "/truncated"
            settings.apiStyle = "openai"
            do { _ = try await service.translate(text: "test", direction: .auto, settings: settings, apiKey: fixtureKey, onPartial: { _ in }); throw NSError(domain: "Test", code: 1) }
            catch TranslationError.interrupted { passed += 1 }
            settings.baseURL = base + "/cancel"
            let cancellationSettings = settings
            let task = Task { try await service.translate(text: "test", direction: .auto, settings: cancellationSettings, apiKey: fixtureKey, onPartial: { _ in }) }
            try await Task.sleep(nanoseconds: 100_000_000)
            task.cancel()
            do { _ = try await task.value; throw NSError(domain: "Test", code: 1) }
            catch is CancellationError { passed += 1 }
        }

        if CommandLine.arguments.contains("--live") {
            let english = try await service.translate(text: "你好，明天见！", direction: .zh2en, settings: AppSettings(), apiKey: "", onPartial: { _ in })
            try check(english.lowercased().contains("tomorrow"), "Microsoft live Chinese to English")
            let chinese = try await service.translate(text: "See you tomorrow!", direction: .en2zh, settings: AppSettings(), apiKey: "", onPartial: { _ in })
            try check(chinese.contains("明天"), "Microsoft live English to Chinese cached session")
            print("Microsoft live: \(english) / \(chinese)")
        }
        print("PASS: \(passed) translation checks")
    }
}
