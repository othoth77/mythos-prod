#!/usr/bin/env python3
"""MYTHOS MCP OAuth bridge — headless end-to-end test of the Claude Web path.

Walks exactly what a Claude custom connector does: RFC 9728 discovery ->
RFC 8414 metadata -> RFC 7591 dynamic registration -> /authorize (PKCE S256,
state, resource) -> proxy consent page -> Dex login -> /callback -> /token ->
MCP initialize / tools/list / tools/call(system_health) over Streamable HTTP,
then the negative cases (bad token, no token, redirect_uri abuse, PKCE
mismatch, code replay, refresh rotation).

Credentials come from files, never from arguments:
  --login-file  a file with "email: ..." and "password: ..." lines (0600)
Nothing secret is printed; tokens are shown only as lengths.
"""
import argparse, base64, hashlib, html, json, os, re, secrets, sys, urllib.parse
import http.cookiejar, urllib.request, urllib.error

BASE = "https://mythosprod.xyz"
MOUNT = "/mcp"
RESULTS = []

def ok(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (("  " + detail) if detail else ""))
    return cond

class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj), NoRedirect())
    def req(self, method, url, data=None, headers=None, form=None):
        h = {"User-Agent": "mythos-oauth-e2e/1"}
        if headers: h.update(headers)
        body = None
        if form is not None:
            body = urllib.parse.urlencode(form).encode(); h.setdefault("Content-Type", "application/x-www-form-urlencoded")
        elif data is not None:
            body = json.dumps(data).encode(); h.setdefault("Content-Type", "application/json")
        r = urllib.request.Request(url, data=body, headers=h, method=method)
        try:
            resp = self.opener.open(r, timeout=30)
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

def pkce():
    v = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    c = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()
    return v, c

def parse_sse_or_json(body):
    t = body.decode(errors="replace")
    if t.startswith("event:") or "\ndata:" in t or t.startswith("data:"):
        for line in t.splitlines():
            if line.startswith("data:"):
                return json.loads(line[5:].strip())
    return json.loads(t)

def mcp(c, token, payload, session=None, extra=None):
    h = {"Accept": "application/json, text/event-stream"}
    if token: h["Authorization"] = "Bearer " + token
    if session: h["Mcp-Session-Id"] = session
    if extra: h.update(extra)
    st, hd, body = c.req("POST", BASE + MOUNT, data=payload, headers=h)
    return st, hd, body

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--login-file", required=True); a = ap.parse_args()
    creds = {}
    for line in open(a.login_file):
        m = re.match(r"\s*(email|password):\s*(\S+)", line)
        if m: creds[m.group(1)] = m.group(2)
    assert "email" in creds and "password" in creds, "login file needs email: and password:"
    c = Client()

    # 1-3 discovery
    st, hd, b = c.req("GET", BASE + "/.well-known/oauth-protected-resource" + MOUNT)
    prm = json.loads(b); ok("PRM per-resource 200", st == 200 and prm.get("resource") == BASE + MOUNT, prm.get("resource", ""))
    asu = prm["authorization_servers"][0]
    st, hd, b = c.req("GET", asu.rstrip("/") + "/.well-known/oauth-authorization-server")
    asm = json.loads(b); ok("AS metadata 200", st == 200 and asm.get("issuer") == BASE, "issuer=" + asm.get("issuer", ""))
    ok("PKCE S256 advertised", "S256" in asm.get("code_challenge_methods_supported", []))
    ok("DCR endpoint advertised", "registration_endpoint" in asm)

    # 4 unauthenticated rejection
    st, hd, b = mcp(c, None, {"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    ok("no token -> 401 + WWW-Authenticate", st == 401 and "resource_metadata" in hd.get("www-authenticate", ""), hd.get("www-authenticate", "")[:120])
    st, hd, b = mcp(c, "not-a-token." + secrets.token_urlsafe(40), {"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    ok("garbage token -> 401", st == 401)

    # 5 DCR like Claude
    redirect = "https://claude.ai/api/mcp/auth_callback"
    st, hd, b = c.req("POST", asm["registration_endpoint"], data={"client_name": "Claude", "redirect_uris": [redirect], "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"], "token_endpoint_auth_method": "none"})
    reg = json.loads(b); ok("DCR 201", st == 201 and "client_id" in reg, "client_id len=%d" % len(reg.get("client_id", "")))
    cid = reg["client_id"]

    # 6 authorize (PKCE + state + resource)
    v, ch = pkce(); state = secrets.token_urlsafe(24)
    q = dict(response_type="code", client_id=cid, redirect_uri=redirect, code_challenge=ch, code_challenge_method="S256", state=state, resource=BASE + MOUNT, scope="")
    st, hd, b = c.req("GET", asm["authorization_endpoint"] + "?" + urllib.parse.urlencode(q), headers={"Accept": "text/html"})
    page = b.decode(errors="replace")
    m = re.search(r'name="consent_token"\s+value="([^"]+)"', page) or re.search(r'value="([^"]+)"\s+name="consent_token"', page)
    ok("authorize -> consent page 200", st == 200 and m is not None)
    fields = dict(re.findall(r'<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"', page))
    fields = {k: html.unescape(v) for k, v in fields.items()}
    fields["action"] = "approve"
    st, hd, b = c.req("POST", BASE + "/consent", form=fields)
    loc = hd.get("location") or re.search(r'url=([^"\']+)', b.decode(errors="replace")).group(1)
    loc = html.unescape(loc)
    ok("consent approve -> IdP redirect", loc.startswith(BASE + "/dex/auth"), loc[:60])

    # 7 Dex login (password DB). Follow: /dex/auth -> (local connector) login form -> POST -> /dex/approval? -> callback
    nxt = loc; st, hd, b = c.req("GET", nxt); hops = 0
    while st in (302, 303) and hd.get("location") and hops < 6:
        nxt = urllib.parse.urljoin(nxt, hd["location"]); st, hd, b = c.req("GET", nxt); hops += 1
    page = b.decode(errors="replace")
    m = re.search(r'<form[^>]+action="([^"]+)"', page)
    ok("Dex login form", st == 200 and m is not None and "login" in page.lower())
    action = urllib.parse.urljoin(nxt, html.unescape(m.group(1)))
    st, hd, b = c.req("POST", action, form={"login": creds["email"], "password": creds["password"]})
    hops = 0
    while st in (302, 303) and hops < 6:
        nxt = urllib.parse.urljoin(action, hd["location"])
        if nxt.startswith(redirect): break
        st, hd, b = c.req("GET", nxt); action = nxt; hops += 1
    ok("Dex login -> redirect back to Claude callback", st in (302, 303) and nxt.startswith(redirect), nxt.split("?")[0])
    cbq = urllib.parse.parse_qs(urllib.parse.urlparse(nxt).query)
    ok("state round-trips", cbq.get("state", [""])[0] == state)
    code = cbq.get("code", [""])[0]; ok("authorization code issued", bool(code))

    # 8 token: wrong verifier first (must fail), then right
    st, hd, b = c.req("POST", asm["token_endpoint"], form=dict(grant_type="authorization_code", code=code, redirect_uri=redirect, client_id=cid, code_verifier="wrong-" + v[:40], resource=BASE + MOUNT))
    ok("token with wrong PKCE verifier -> 4xx", 400 <= st < 500, "status=%d" % st)
    st, hd, b = c.req("POST", asm["token_endpoint"], form=dict(grant_type="authorization_code", code=code, redirect_uri=redirect, client_id=cid, code_verifier=v, resource=BASE + MOUNT))
    tok = json.loads(b) if b else {}
    got = st == 200 and "access_token" in tok
    ok("token exchange 200", got, "status=%d err=%s" % (st, tok.get("error", "")))
    if not got:
        # a wrong-verifier attempt may have burned the single-use code; redo the flow once for the positive path
        print("  (re-running authorize to obtain a fresh code — single-use code consumed by the negative test)")
        v, ch = pkce(); state = secrets.token_urlsafe(24)
        q.update(code_challenge=ch, state=state)
        st, hd, b = c.req("GET", asm["authorization_endpoint"] + "?" + urllib.parse.urlencode(q), headers={"Accept": "text/html"})
        page = b.decode(errors="replace"); fields = {k: html.unescape(x) for k, x in re.findall(r'<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"', page)}; fields["action"] = "approve"
        st, hd, b = c.req("POST", BASE + "/consent", form=fields)
        loc = html.unescape(hd.get("location") or re.search(r'url=([^"\']+)', b.decode(errors="replace")).group(1))
        st, hd, b = c.req("GET", loc); hops = 0
        while st in (302, 303) and hops < 8:
            nxt = urllib.parse.urljoin(loc, hd["location"])
            if nxt.startswith(redirect): break
            st, hd, b = c.req("GET", nxt); loc = nxt; hops += 1
        code = urllib.parse.parse_qs(urllib.parse.urlparse(nxt).query).get("code", [""])[0]
        st, hd, b = c.req("POST", asm["token_endpoint"], form=dict(grant_type="authorization_code", code=code, redirect_uri=redirect, client_id=cid, code_verifier=v, resource=BASE + MOUNT))
        tok = json.loads(b) if b else {}
        ok("token exchange 200 (fresh code, SSO session)", st == 200 and "access_token" in tok, "status=%d" % st)
    at = tok.get("access_token", ""); rt = tok.get("refresh_token", "")
    print("  access_token len=%d refresh_token len=%d expires_in=%s" % (len(at), len(rt), tok.get("expires_in")))

    # 9 MCP over Streamable HTTP
    st, hd, b = mcp(c, at, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "mythos-oauth-e2e", "version": "1"}}})
    init = parse_sse_or_json(b) if st == 200 else {}
    sess = hd.get("mcp-session-id")
    ok("MCP initialize 200", st == 200 and "result" in init, "server=%s session=%s" % (init.get("result", {}).get("serverInfo", {}).get("name"), "yes" if sess else "no"))
    mcp(c, at, {"jsonrpc": "2.0", "method": "notifications/initialized"}, sess)
    st, hd, b = mcp(c, at, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, sess)
    tl = parse_sse_or_json(b) if st == 200 else {}
    tools = [t["name"] for t in tl.get("result", {}).get("tools", [])]
    ok("tools/list 200", st == 200 and len(tools) > 0, "%d tools: %s" % (len(tools), ", ".join(tools)[:200]))
    health = next((t for t in tools if "system-health" in t or "system_health" in t), None)
    st, hd, b = mcp(c, at, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": health, "arguments": {}}}, sess)
    call = parse_sse_or_json(b) if st == 200 else {}
    txt = json.dumps(call.get("result", {}))[:160]
    ok("tools/call %s 200" % health, st == 200 and "result" in call and not call.get("result", {}).get("isError"), txt)

    # 10 refresh rotation + old refresh reuse
    st, hd, b = c.req("POST", asm["token_endpoint"], form=dict(grant_type="refresh_token", refresh_token=rt, client_id=cid, resource=BASE + MOUNT))
    tok2 = json.loads(b) if b else {}
    ok("refresh -> new tokens", st == 200 and tok2.get("access_token") and tok2.get("refresh_token") != rt, "status=%d %s %s" % (st, tok2.get("error", ""), tok2.get("error_description", "")[:120]))
    st, hd, b = c.req("POST", asm["token_endpoint"], form=dict(grant_type="refresh_token", refresh_token=rt, client_id=cid, resource=BASE + MOUNT))
    ok("old refresh reuse -> rejected", st >= 400, "status=%d" % st)
    st, hd, b = mcp(c, tok2.get("access_token", ""), {"jsonrpc": "2.0", "id": 4, "method": "tools/list"}, sess)
    ok("new access token works", st == 200)

    # 10b code replay AFTER refresh: must be rejected and must revoke the family
    st, hd, b = c.req("POST", asm["token_endpoint"], form=dict(grant_type="authorization_code", code=code, redirect_uri=redirect, client_id=cid, code_verifier=v, resource=BASE + MOUNT))
    ok("code replay -> rejected", st >= 400, "status=%d" % st)
    st, hd, b = c.req("POST", asm["token_endpoint"], form=dict(grant_type="refresh_token", refresh_token=tok2.get("refresh_token", ""), client_id=cid, resource=BASE + MOUNT))
    ok("code replay revoked the refresh family (OAuth 2.1 s4.1.2)", st >= 400, "status=%d %s" % (st, (json.loads(b) if b else {}).get("error_description", "")[:60]))

    # 11 tampered / foreign tokens
    st, hd, b = mcp(c, at[:-6] + "AAAAAA", {"jsonrpc": "2.0", "id": 5, "method": "tools/list"})
    ok("tampered token -> 401", st == 401)

    # 12 redirect_uri abuse: registered client, different redirect
    q2 = dict(q); q2["redirect_uri"] = "https://evil.example/cb"; q2["state"] = "x" * 20
    st, hd, b = c.req("GET", asm["authorization_endpoint"] + "?" + urllib.parse.urlencode(q2), headers={"Accept": "text/html"})
    body = b.decode(errors="replace")
    ok("unregistered redirect_uri -> refused (no redirect to it)", st == 400 and "evil.example" not in hd.get("Location", ""), "status=%d" % st)
    q3 = dict(q); q3.pop("code_challenge"); q3.pop("code_challenge_method"); q3["state"] = "y" * 20
    st, hd, b = c.req("GET", asm["authorization_endpoint"] + "?" + urllib.parse.urlencode(q3), headers={"Accept": "text/html"})
    ok("authorize without PKCE -> refused", st != 200 or "consent_token" not in b.decode(errors="replace"), "status=%d" % st)
    q4 = dict(q); q4.pop("state")
    st, hd, b = c.req("GET", asm["authorization_endpoint"] + "?" + urllib.parse.urlencode(q4), headers={"Accept": "text/html"})
    ok("authorize without state -> refused", st != 200 or "consent_token" not in b.decode(errors="replace"), "status=%d" % st)

    # 13 upstream credential never leaks; existing door unchanged
    st, hd, b = c.req("POST", BASE + "/gateway/mcp", data={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    ok("existing /gateway/mcp still 401 without its own token", st == 401)
    st, hd, b = c.req("POST", BASE + "/gateway/mcp", data={"jsonrpc": "2.0", "id": 1, "method": "initialize"}, headers={"Authorization": "Bearer " + at})
    ok("proxy access token is NOT valid on /gateway/mcp", st == 401, "status=%d" % st)

    fails = [r for r in RESULTS if not r[1]]
    print("\n%d checks, %d failed" % (len(RESULTS), len(fails)))
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
