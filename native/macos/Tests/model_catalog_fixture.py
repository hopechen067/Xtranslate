"""Loopback-only model catalog tests. Uses fake credentials and no model inference."""
import http.server
import json
import subprocess
import sys
import threading
import time
import urllib.parse


failures = []


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, value, status=200):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        try:
            self.handle_get()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            failures.append(str(error) or repr(error))
            self.send_json({'error': 'fixture assertion failed'}, 500)

    def handle_get(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/anthropic/'):
            assert path == '/anthropic/v1/models', 'wrong Anthropic endpoint'
            assert self.headers.get('x-api-key') == 'fixture-secret', 'missing Anthropic key'
            assert self.headers.get('anthropic-version') == '2023-06-01', 'missing Anthropic version'
            assert self.headers.get('Authorization') is None, 'wrong Anthropic auth header'
            if not parsed.query:
                return self.send_json({'data': [{'id': 'claude-a'}], 'has_more': True, 'last_id': 'claude/&?next'})
            assert urllib.parse.parse_qs(parsed.query) == {'after_id': ['claude/&?next']}, 'unsafe cursor encoding'
            return self.send_json({'data': [{'id': 'claude-b'}, {'id': 'claude-a'}], 'has_more': False})
        if path in ['/openai/models', '/redirect/models', '/cross-origin/models']:
            assert self.headers.get('Authorization') == 'Bearer fixture-secret', 'missing bearer auth: ' + path
            assert self.headers.get('x-api-key') is None, 'unexpected Anthropic auth'
        if path == '/openai/models':
            return self.send_json({'data': [{'id': 'model-10'}, {'id': 'alpha'}, {'id': 'model-2'}, {'id': 'alpha'}]})
        if path == '/anonymous/models':
            assert self.headers.get('Authorization') is None, 'anonymous request carries key'
            return self.send_json({'data': [{'id': 'local-model'}]})
        if path in ['/redirect/models', '/cross-origin/models']:
            self.send_response(302)
            target = '/openai/models' if path.startswith('/redirect') else f'http://localhost:{self.server.server_port}/stolen'
            self.send_header('Location', target)
            self.end_headers()
            return
        if path == '/stolen':
            raise AssertionError('cross-origin request reached destination')
        if path == '/empty/models':
            return self.send_json({'data': []})
        if path == '/bad/models':
            return self.send_json({'data': [{'name': 'bad-id'}]})
        if path == '/error/models':
            return self.send_json({'error': {'message': 'do not expose this'}, 'data': []})
        if path == '/oversized/models':
            self.send_response(200)
            self.send_header('Content-Length', '9000000')
            self.end_headers()
            self.wfile.write(b' ' * 9_000_000)
            return
        if path == '/cycle/models':
            return self.send_json({'data': [{'id': 'cycle'}], 'has_more': True, 'last_id': 'cycle'})
        if path == '/pages/models':
            previous = urllib.parse.parse_qs(parsed.query).get('after_id', ['0'])[0]
            cursor = str(int(previous) + 1)
            assert int(cursor) <= 20, 'pagination not bounded'
            return self.send_json({'data': [{'id': 'model-' + cursor}], 'has_more': True, 'last_id': cursor})
        if path == '/denied/models':
            return self.send_json({'error': 'secret'}, 401)
        if path in ['/unsupported/models', '/v1/models']:
            return self.send_json({'error': 'unsupported'}, 404)
        if path == '/api/tags':
            assert self.headers.get('Authorization') is None, 'local Ollama carries key'
            return self.send_json({'models': [{'name': 'qwen:7b'}]})
        if path == '/cancel/models':
            time.sleep(3)
            return self.send_json({'data': [{'id': 'too-late'}]})
        raise AssertionError('unexpected endpoint: ' + path)


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
result = subprocess.run([sys.argv[1], '--mock-base', f'http://127.0.0.1:{server.server_port}', *sys.argv[2:]])
server.shutdown()
if failures:
    print('Fixture failures:', failures, file=sys.stderr)
sys.exit(result.returncode or (1 if failures else 0))
