"""Local, credential-free SSE fixture for the native translation tests."""
import http.server
import json
import subprocess
import sys
import threading
import time


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert body['stream'] is True
        assert body['model'] == 'fixture'
        fixture_key = 'fixture-key-not-a-real-credential'
        anthropic = self.path.startswith(('/anthropic/', '/redirect-anthropic/', '/cross-anthropic/'))
        if anthropic:
            assert self.headers.get('Authorization') is None
            assert self.headers.get('x-api-key') == fixture_key
            assert self.headers.get('anthropic-version') == '2023-06-01'
        else:
            assert self.headers.get('Authorization') == 'Bearer ' + fixture_key
            assert self.headers.get('x-api-key') is None
        if self.path.startswith(('/redirect-', '/cross-')):
            if self.path.startswith('/cross-'):
                target = self.server.cross_origin_target
            else:
                target = '/anthropic/v1/messages' if anthropic else '/openai/chat/completions'
            self.send_response(307)
            self.send_header('Location', target)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if self.path.startswith('/cancel/'):
            time.sleep(5)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        if self.path.startswith('/anthropic/'):
            assert self.path == '/anthropic/v1/messages'
            assert self.headers['anthropic-version'] == '2023-06-01'
            events = [
                {'type': 'content_block_delta', 'delta': {'thinking': 'hidden'}},
                {'type': 'content_block_delta', 'delta': {'text': '你好'}},
                {'type': 'message_stop'},
            ]
        else:
            assert self.path.endswith('/chat/completions')
            events = [
                {'choices': [{'delta': {'reasoning_content': 'hidden'}}]},
                {'choices': [{'delta': {'content': '你好 '}}]},
                {'choices': [{'delta': {'content': '🌍'}}]},
            ]
            if not self.path.startswith('/truncated/'):
                events.append('[DONE]')
        try:
            self.wfile.write(b': comment\r\n\r\n')
            for event in events:
                payload = event if isinstance(event, str) else json.dumps(event, ensure_ascii=False)
                frame = ('data: ' + payload + '\r\n\r\n').encode()
                # Deliberately split Unicode codepoints across network writes.
                for byte in frame:
                    self.wfile.write(bytes([byte]))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


class ForbiddenRedirectHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        self.server.received_requests += 1
        self.send_response(418)
        self.send_header('Content-Length', '0')
        self.end_headers()


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
cross_origin = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ForbiddenRedirectHandler)
cross_origin.received_requests = 0
server.cross_origin_target = f'http://127.0.0.1:{cross_origin.server_port}/forbidden'
for fixture in (server, cross_origin):
    threading.Thread(target=fixture.serve_forever, daemon=True).start()
try:
    result = subprocess.run([sys.argv[1], '--mock-base', f'http://127.0.0.1:{server.server_port}', *sys.argv[2:]])
finally:
    for fixture in (server, cross_origin):
        fixture.shutdown()
        fixture.server_close()
assert cross_origin.received_requests == 0, 'Credential-bearing redirect reached another origin'
sys.exit(result.returncode)
