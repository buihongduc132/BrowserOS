#!/usr/bin/env python3
"""BrowserOS Dev Server Smoke Test.
Hits ALL GET endpoints on the dev server and validates response shapes.
Fails FAST on any broken endpoint.

Usage:
  python3 scripts/verify/smoke-dev.py          # default port 9115
  python3 scripts/verify/smoke-dev.py 9120     # custom port
"""
import socket, json, sys

HOST = '127.0.0.1'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9115
TIMEOUT = 5

def http_get(port, path, timeout=TIMEOUT):
    """Raw HTTP GET — no curl, no context-mode interference."""
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect((HOST, port))
    except Exception as e:
        return None, None, f"CONNECT FAIL: {e}"
    req = f'GET {path} HTTP/1.1\r\nHost: {HOST}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n'
    s.sendall(req.encode())
    resp = b''
    while True:
        try:
            c = s.recv(65536)
            if not c: break
            resp += c
        except: break
    s.close()
    if not resp:
        return None, None, "EMPTY RESPONSE"
    parts = resp.split(b'\r\n\r\n', 1)
    status_line = parts[0].decode().split('\r\n')[0] if parts else ''
    code = int(status_line.split(' ', 2)[1]) if ' ' in status_line else 0
    body = parts[1] if len(parts) > 1 else b''
    try:
        data = json.loads(body)
    except:
        data = body.decode()[:200]
    return code, data, status_line


def validate(test_name, code, data, expect_code, shape_rules):
    """Validate status code + response shape."""
    errors = []
    if code != expect_code:
        errors.append(f"expected {expect_code}, got {code}")
    if isinstance(data, dict) and isinstance(shape_rules, dict):
        for key, expected_type in shape_rules.items():
            if key not in data:
                errors.append(f"missing key '{key}'")
            elif expected_type == bool and not isinstance(data[key], bool):
                errors.append(f"'{key}' should be bool, got {type(data[key]).__name__}")
            elif expected_type == str and not isinstance(data[key], str):
                errors.append(f"'{key}' should be str, got {type(data[key]).__name__}")
            elif expected_type == int and not isinstance(data[key], int):
                errors.append(f"'{key}' should be int, got {type(data[key]).__name__}")
            elif expected_type == list and not isinstance(data[key], list):
                errors.append(f"'{key}' should be list, got {type(data[key]).__name__}")
            elif expected_type == dict and not isinstance(data[key], dict):
                errors.append(f"'{key}' should be dict, got {type(data[key]).__name__}")
    return errors


# ── Test definitions: (name, path, expected_code, shape_rules) ──
TESTS = [
    # Core health
    ("/health",                  "/health",                200, {"status": str, "cdpConnected": bool}),
    ("/status",                  "/status",                200, {"status": str, "cdpConnected": bool}),

    # MCP
    ("/mcp GET",                 "/mcp",                   200, {"status": str}),

    # Agents
    ("/agents/adapters",         "/agents/adapters",       200, None),  # array of adapter objects
    ("/agents",                  "/agents",                200, None),  # array of agent definitions

    # Soul (system prompt)
    ("/soul",                    "/soul",                  200, {"content": str}),

    # Memory (core memory)
    ("/memory",                  "/memory",                200, {"content": str}),

    # Skills
    ("/skills",                  "/skills",                200, {"skills": list}),

    # Credits (may 503 if not configured — that's OK)
    ("/credits",                 "/credits",               None, None),  # accept 200 or 503

    # OAuth status (per-provider)
    ("/oauth/:provider/status",  "/oauth/unknown/status",  200, {"authenticated": bool, "provider": str}),

    # Config (advanced config store)
    ("/config",                    "/config",               200, {"active": dict, "defaults": dict, "schema": dict}),

    # Compaction strategy
    ("/compaction",                "/compaction",           200, {"active": type(None), "defaults": dict}),

    # Klavis
    ("/klavis/servers",          "/klavis/servers",        200, {"servers": list, "count": int}),
    ("/klavis/oauth-urls",       "/klavis/oauth-urls",     200, None),
]


def main():
    print(f"\n{'='*65}")
    print(f"  SMOKE TEST — Dev Server on {HOST}:{PORT}")
    print(f"{'='*65}\n")

    # First: basic connectivity
    code, data, meta = http_get(PORT, "/health")
    if code is None:
        print(f"  ✗ FATAL: Cannot connect to {HOST}:{PORT}")
        print(f"    {meta}")
        sys.exit(1)

    passed = 0
    failed = 0
    skipped = 0

    for name, path, expect_code, shape in TESTS:
        code, data, meta = http_get(PORT, path)

        # Special: credits may be 503 (not configured) — that's acceptable
        if name == "/credits" and code in (200, 503):
            print(f"  ✓ {name:30s} {code} {('(not configured)' if code == 503 else '')}")
            passed += 1
            continue

        # Determine expected code
        ec = expect_code or 200

        # Validate
        errs = validate(name, code, data, ec, shape)

        # Special: /agents endpoints return arrays, not dicts
        if name in ("/agents/adapters", "/agents") and isinstance(data, list) and code == 200:
            errs = []  # array response is valid

        if errs:
            failed += 1
            detail = ', '.join(errs)
            body_preview = json.dumps(data)[:100] if isinstance(data, (dict, list)) else str(data)[:100]
            print(f"  ✗ {name:30s} {code} — {detail}")
            print(f"    body: {body_preview}")
        else:
            passed += 1
            extra = ''
            if isinstance(data, dict):
                keys = list(data.keys())[:5]
                extra = f'keys={keys}'
            elif isinstance(data, list):
                extra = f'items={len(data)}'
            print(f"  ✓ {name:30s} {code} {extra}")

    print(f"\n{'─'*65}")
    total = passed + failed
    print(f"  Result: {passed}/{total} PASS", end="")
    if failed:
        print(f"  ✗ {failed} FAILED")
    else:
        print(" ✓")
    print(f"{'─'*65}\n")

    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
