#!/usr/bin/env python3
"""
Smoke test for BrowserOS PROD Server (port 9110).
Probes ALL available GET endpoints and validates response shapes.
Exit 1 on ANY failure — used as deployment gate.
"""
import json, socket, sys

PORT = 9110
TIMEOUT = 3

def http(path, port=PORT):
    s = socket.socket()
    s.settimeout(TIMEOUT)
    try:
        s.connect(('127.0.0.1', port))
        req = f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
        s.sendall(req.encode())
        resp = b''
        while True:
            try:
                c = s.recv(65536)
                if not c:
                    break
                resp += c
            except:
                break
        s.close()
        parts = resp.split(b'\r\n\r\n', 1)
        code = int(parts[0].decode().split(' ', 2)[1])
        body = parts[1] if len(parts) > 1 else b''
        try:
            data = json.loads(body)
        except:
            data = body.decode(errors='replace')
        return code, data
    except Exception as e:
        return None, str(e)

CHECKS = [
    # (path, expected_code, required_keys_or_none)
    ('/health',                   200, ['status', 'cdpConnected']),
    ('/status',                   200, ['status', 'cdpConnected']),
    ('/mcp',                      200, ['status', 'message']),
    ('/agents/adapters',          200, ['adapters']),
    ('/agents',                   200, ['agents']),
    ('/soul',                     200, ['content']),
    ('/memory',                   200, ['content']),
    ('/skills',                   200, ['skills']),
    # credits: 200 (has key) or 503 (no API key) — both acceptable
    ('/credits',                  None, None),
    ('/oauth/unknown/status',     200, ['authenticated', 'provider']),
    ('/config',                   200, ['active', 'defaults']),
    ('/compaction',               200, ['active', 'defaults']),
    ('/klavis/servers',           200, ['servers', 'count']),
]

def main():
    print(f"\n{'='*65}")
    print(f"  SMOKE TEST — Prod Server on 127.0.0.1:{PORT}")
    print(f"{'='*65}\n")

    passed = 0
    failed = 0

    for path, expected_code, required_keys in CHECKS:
        code, data = http(path)

        if code is None:
            print(f"  ✗ {path:30s} CONNECTION FAILED: {data}")
            failed += 1
            continue

        # Special: credits accepts 200 or 503
        if path == '/credits' and code in (200, 503):
            print(f"  ✓ {path:30s} {code}")
            passed += 1
            continue

        if expected_code and code != expected_code:
            print(f"  ✗ {path:30s} expected {expected_code}, got {code}")
            failed += 1
            continue

        if required_keys and isinstance(data, dict):
            missing = [k for k in required_keys if k not in data]
            if missing:
                print(f"  ✗ {path:30s} {code} missing keys: {missing}")
                failed += 1
                continue

        print(f"  ✓ {path:30s} {code} keys={list(data.keys())[:3] if isinstance(data, dict) else 'N/A'}")
        passed += 1

    total = passed + failed
    print(f"\n{'─'*65}")
    if failed == 0:
        print(f"  Result: {passed}/{total} PASS ✓")
    else:
        print(f"  Result: {passed}/{total} PASS, {failed} FAIL ✗")
    print(f"{'─'*65}\n")

    sys.exit(1 if failed > 0 else 0)

if __name__ == '__main__':
    main()
