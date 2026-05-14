#!/usr/bin/env python3
"""BrowserOS dual-instance deployment verification.
Prod ports: CDP=9104, Server=9110 (fixed, via CLI flags + server_config.json + Local State).
Dev ports:  CDP=9010, Server=9115 (fixed, from .env.development + common.sh).

NOTE: The browser may overwrite server_config.json with WRONG cdp_port.
CLI flags are the authority for CDP. Server port from config is reliable.
"""
import socket, json, subprocess, sys, os, time, hashlib

WORKDIR = "/home/bhd/Documents/Projects/bhd/BrowserOS"
PROD_CONFIG = "/home/bhd/.config/browser-os/.browseros/server_config.json"

# HARDCODED prod ports — the CLI flags are the authority, NOT the browser's config.
# The browser may overwrite server_config.json with wrong cdp_port.
PROD_CDP_FIXED = 9104
PROD_SRV_FIXED = 9110

def get_prod_ports():
    """Return fixed prod ports. CLI flags are the authority."""
    return PROD_CDP_FIXED, PROD_SRV_FIXED

def http_get(port, path, timeout=3):
    try:
        s = socket.socket(); s.settimeout(timeout)
        s.connect(('127.0.0.1', port))
        s.sendall(f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'.encode())
        resp = b''
        while True:
            try:
                chunk = s.recv(65536)
                if not chunk: break
                resp += chunk
            except socket.timeout: break
        s.close()
        parts = resp.split(b'\r\n\r\n', 1)
        if len(parts) < 2: return None, None
        status = parts[0].decode().split('\r\n')[0]
        try: body = json.loads(parts[1].strip())
        except: body = parts[1].decode()[:200]
        return status, body
    except Exception as e:
        return None, str(e)[:80]

def port_up(port):
    try:
        s = socket.socket(); s.settimeout(1)
        s.connect(('127.0.0.1', port)); s.close(); return True
    except: return False

def pid_alive(pidfile):
    try:
        pid = open(pidfile).read().strip()
        if not pid: return False, "empty"
        r = subprocess.run(['kill', '-0', pid], capture_output=True)
        return r.returncode == 0, pid
    except FileNotFoundError:
        return False, "no-file"

def file_sha(path):
    try: return hashlib.sha256(open(path, 'rb').read()).hexdigest()
    except: return None

def run(cmd, timeout=120):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=WORKDIR)

def wait_port(port, want_up=True, secs=25):
    for _ in range(secs):
        if port_up(port) == want_up: return True
        time.sleep(1)
    return False

def verify_all(label="VERIFICATION"):
    prod_cdp, prod_srv = get_prod_ports()
    dev_cdp, dev_srv = 9010, 9115
    
    results = []
    
    # Header with actual ports
    print(f"\n{'='*65}")
    print(f"  {label}")
    print(f"  Prod: CDP={prod_cdp} Srv={prod_srv} | Dev: CDP={dev_cdp} Srv={dev_srv}")
    print(f"{'='*65}")
    
    if prod_cdp is None:
        print("  ✗ Cannot read prod config — skipping prod API checks")
        for lbl in ["PROD CDP version","PROD CDP targets","PROD /health","PROD /agents"]:
            results.append((lbl, False, "no config"))
    else:
        # API checks
        for lbl, port, path in [
            ("PROD CDP version",  prod_cdp, "/json/version"),
            ("PROD CDP targets",  prod_cdp, "/json/list"),
            ("PROD /health",      prod_srv, "/health"),
            ("PROD /agents",      prod_srv, "/agents/adapters"),
            ("PROD /mcp",         prod_srv, "/mcp"),
        ]:
            status, body = http_get(port, path)
            ok = status and '200' in status
            summary = ""
            if isinstance(body, dict):
                if 'status' in body: summary = f"status={body['status']}"
                elif 'Browser' in body: summary = body['Browser'][:40]
                if isinstance(body, dict) and 'adapters' in body: summary = f"{len(body['adapters'])} adapters"
                if isinstance(body, dict) and 'cdpConnected' in body: summary += f" cdp={body['cdpConnected']}"
            elif isinstance(body, list): summary = f"{len(body)} items"
            else: summary = str(body)[:60]
            results.append((lbl, ok, summary))
    
    # Dev API checks
    for lbl, port, path in [
        ("DEV  CDP version",  dev_cdp, "/json/version"),
        ("DEV  CDP targets",  dev_cdp, "/json/list"),
        ("DEV  /health",      dev_srv, "/health"),
        ("DEV  /agents",      dev_srv, "/agents/adapters"),
        ("DEV  /mcp",         dev_srv, "/mcp"),
    ]:
        status, body = http_get(port, path)
        ok = status and '200' in status
        summary = ""
        if isinstance(body, dict):
            if 'status' in body: summary = f"status={body['status']}"
            elif 'Browser' in body: summary = body['Browser'][:40]
            if isinstance(body, dict) and 'adapters' in body: summary = f"{len(body['adapters'])} adapters"
            if isinstance(body, dict) and 'cdpConnected' in body: summary += f" cdp={body['cdpConnected']}"
        elif isinstance(body, list): summary = f"{len(body)} items"
        else: summary = str(body)[:60]
        results.append((lbl, ok, summary))

    # Process checks
    for lbl, pf in [("PROD process", "/home/bhd/.browseros/browser.pid"),
                     ("DEV  process", "/home/bhd/.browseros-dev/browser.pid")]:
        alive, pid = pid_alive(pf)
        results.append((lbl, alive, f"PID={pid}"))

    # Port checks
    port_checks = []
    if prod_cdp: port_checks.append(("PROD CDP", prod_cdp))
    if prod_srv: port_checks.append(("PROD Srv", prod_srv))
    port_checks += [("DEV  CDP", dev_cdp), ("DEV  Srv", dev_srv)]
    for lbl, port in port_checks:
        results.append((lbl, port_up(port), f"port {port}"))

    # Desktop entries
    for lbl, path, wm in [
        ("PROD .desktop", "/home/bhd/.local/share/applications/browseros.desktop", "StartupWMClass=org.chromium.Chromium"),
        ("DEV  .desktop", "/home/bhd/.local/share/applications/browseros-dev.desktop", "StartupWMClass=browseros-dev"),
    ]:
        try:
            ok = wm in open(path).read()
            results.append((lbl, ok, wm))
        except: results.append((lbl, False, "file missing"))

    # Pinned
    r = run("gsettings get org.gnome.shell favorite-apps")
    if r.returncode == 0:
        out = r.stdout
        results.append(("PROD pinned", "browseros.desktop" in out, "browseros.desktop"))
        results.append(("DEV  pinned", "browseros-dev.desktop" in out, "browseros-dev.desktop"))
    else:
        results.append(("Pinned icons", False, "gsettings failed"))

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    for lbl, ok, detail in results:
        print(f"  {'✓' if ok else '✗'} {lbl:25s} {detail}")
    print(f"\n  Result: {passed}/{total} {'PASS ✓' if passed == total else 'FAIL ✗'}")
    
    return passed, total

# ═══════ MAIN ═══════
phase = sys.argv[1] if len(sys.argv) > 1 else "full"

if phase == "check":
    p, t = verify_all()
    sys.exit(0 if p == t else 1)

elif phase == "cycle":
    print("=" * 65)
    print("  LAUNCH → STOP → LAUNCH CYCLE")
    print("=" * 65)

    # 1: Record state
    print("\n[1/6] Recording state...")
    cs_before = {
        'prod': file_sha("/home/bhd/.local/share/applications/browseros.desktop"),
        'dev': file_sha("/home/bhd/.local/share/applications/browseros-dev.desktop"),
    }

    # 2: Stop both
    print("\n[2/6] Stopping...")
    run("bash .mise/tasks/browseros/kill-dev", timeout=30)
    run("bash .mise/tasks/browseros/kill-prod", timeout=30)
    run("pkill -9 -f 'BrowserOS.AppImage' 2>/dev/null || true", timeout=10)
    run("pkill -9 -f 'browseros_server' 2>/dev/null || true", timeout=10)

    # 3: Wait ports free — poll for all known ports
    print("\n[3/6] Waiting for ports to release...")
    time.sleep(3)
    all_ports = [9010, 9115]  # dev ports are fixed
    # Also check whatever ports prod was using
    prod_cdp, prod_srv = get_prod_ports()
    if prod_cdp: all_ports.append(prod_cdp)
    if prod_srv: all_ports.append(prod_srv)
    
    for port in all_ports:
        freed = wait_port(port, want_up=False, secs=20)
        if not freed:
            run(f"fuser -k {port}/tcp 2>/dev/null || true", timeout=5)
            time.sleep(2)
        print(f"  Port {port}: {'FREE ✓' if not port_up(port) else 'STILL UP ✗'}")

    run("rm -f ~/.browseros/browser.pid ~/.browseros/start.lock ~/.browseros-dev/browser.pid ~/.browseros-dev/server.pid ~/.browseros-dev/start.lock", timeout=5)
    time.sleep(2)

    # 4: Relaunch
    print("\n[4/6] Relaunching...")
    run("nohup bash scripts/launch/launch-browseros-prod.sh > /tmp/prod-browser.log 2>&1 &", timeout=5)
    print("  Prod launched, waiting...")
    
    # Wait for prod server_config.json to stabilize
    for i in range(40):
        time.sleep(1)
        prod_cdp, prod_srv = get_prod_ports()
        if prod_cdp and prod_srv and port_up(prod_cdp) and port_up(prod_srv):
            print(f"  Prod ready: CDP={prod_cdp} Srv={prod_srv} ({i+1}s)")
            break
    else:
        print(f"  Prod ports NOT ready after 40s")
    
    run("bash .mise/tasks/browseros/start-dev", timeout=120)
    print("  Dev launched.")
    time.sleep(3)

    # 5: Re-verify
    print("\n[5/6] Post-relaunch verification...")
    p, t = verify_all("POST-RELAUNCH CHECK")

    # 6: Drift check
    print("\n[6/6] Desktop drift check...")
    run("bash scripts/setup-desktop-entries.sh", timeout=30)
    cs_after = {
        'prod': file_sha("/home/bhd/.local/share/applications/browseros.desktop"),
        'dev': file_sha("/home/bhd/.local/share/applications/browseros-dev.desktop"),
    }
    drift = False
    for k in cs_before:
        match = cs_before[k] == cs_after[k]
        print(f"  {'✓' if match else '✗'} {k}: {'NO DRIFT' if match else 'DRIFTED!'}")
        if not match: drift = True

    print(f"\n{'='*65}")
    ok = (p == t) and not drift
    print(f"  {'✅ CYCLE PASSED' if ok else '❌ CYCLE FAILED'} — {p}/{t} checks, drift={'NO' if not drift else 'YES'}")
    print(f"{'='*65}")
    sys.exit(0 if ok else 1)

elif phase == "full":
    p, t = verify_all("INITIAL CHECK")
    if p < t:
        print("\n⚠ Fixing failures before cycle...")
        # Start prod if needed
        prod_cdp, prod_srv = get_prod_ports()
        if not prod_cdp or not port_up(prod_cdp):
            print("  Starting prod...")
            run("nohup bash scripts/launch/launch-browseros-prod.sh > /tmp/prod-browser.log 2>&1 &", timeout=5)
            for i in range(40):
                time.sleep(1)
                pc, ps = get_prod_ports()
                if pc and ps and port_up(pc) and port_up(ps):
                    print(f"  Prod ready: CDP={pc} Srv={ps}")
                    break
        # Start dev if needed
        if not port_up(9010) or not port_up(9115):
            print("  Starting dev...")
            run("bash .mise/tasks/browseros/start-dev", timeout=120)
        time.sleep(3)
        p, t = verify_all("RETRY CHECK")
    
    if p < t:
        print(f"\n❌ Still failing ({p}/{t}). Aborting.")
        sys.exit(1)
    
    print("\n✓ Checks passed. Running LAUNCH→STOP→LAUNCH cycle...")
    # Re-run this script with "cycle" phase
    result = subprocess.run([sys.executable, __file__, "cycle"], cwd=WORKDIR)
    sys.exit(result.returncode)

else:
    print(f"Usage: {sys.argv[0]} [check|cycle|full]")
    sys.exit(1)
