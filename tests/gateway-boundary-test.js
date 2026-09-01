'use strict';

// tests/gateway-boundary-test.js — pins the security properties of the MYTHOS
// Gateway as DATA, not as prose in a report.
//
// The gateway is the first MYTHOS surface reachable by a third party. Every
// assertion here is a boundary that must not erode by accident:
//
//   §1 the transport bridge relays and nothing else — it defines no tool,
//      reaches no upstream, and refuses to start without a credential
//   §2 the deployment grants no host authority — no docker socket, no root,
//      no unpinned image, a memory ceiling
//   §3 the admin surfaces are off in the gateway AND blocked at nginx
//   §4 SSRF protection stays on, with exactly one allowed network
//   §5 no secret is committed
//
// Several assertions are NEGATIVE: they require a line to stay absent. Those
// are the ones that catch a well-meant future change.
//
// Fully offline: reads files, opens no socket. It asserts what the repository
// declares, which is why the deployed copies are installed from these files.

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var DIR = path.join(ROOT, 'projects', 'mythos-gateway');
var BRIDGE = fs.readFileSync(path.join(DIR, 'mcp-http-bridge.js'), 'utf8');
var COMPOSE = fs.readFileSync(path.join(DIR, 'docker-compose.yml'), 'utf8');
var NGINX = fs.readFileSync(path.join(DIR, 'nginx', 'gateway-location.conf'), 'utf8');
var UNIT = fs.readFileSync(path.join(DIR, 'systemd', 'mythos-mcp-http.service'), 'utf8');
var ENV_EXAMPLE = fs.readFileSync(path.join(DIR, 'contextforge.env.example'), 'utf8');

// Several assertions below require a string to be ABSENT. The comments in
// these files discuss exactly the things that must not be present — the tool
// names the bridge must not define, the docker socket the compose file must
// not mount. Scanning the raw text would fail on the prose that explains the
// rule, so every absence check runs against code with comments stripped.
function code(src, style) {
  if (style === 'hash') return src.replace(/^\s*#.*$/gm, '');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
var BRIDGE_CODE = code(BRIDGE);
var COMPOSE_CODE = code(COMPOSE, 'hash');

var passed = 0;
var failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// ---------------------------------------------------------------------------
console.log('§1 the bridge is a transport, not a server');

// If this file ever names a MYTHOS tool, it has stopped relaying and started
// deciding. Every tool name below belongs to projects/oth-mcp/server.js.
var OTH_TOOLS = ['knowledge_search', 'knowledge_get', 'project_context', 'capability_registry',
                 'execution_status', 'execution_report', 'budget_status', 'system_health'];
check('the bridge names no MYTHOS tool',
  OTH_TOOLS.every(function (t) { return BRIDGE_CODE.indexOf(t) === -1; }),
  OTH_TOOLS.filter(function (t) { return BRIDGE_CODE.indexOf(t) !== -1; }).join(','));

check('the bridge declares no inputSchema', BRIDGE_CODE.indexOf('inputSchema') === -1);

// It relays to the launcher; it must not reach an upstream itself.
check('the bridge reaches no MYTHOS upstream directly',
  !/127\.0\.0\.1:(8150|8130|3021)|status\.mythosprod\.xyz/.test(BRIDGE_CODE));

check('the bridge spawns the existing launcher, not the server directly',
  /oth-mcp-stdio\.sh/.test(BRIDGE_CODE) && BRIDGE_CODE.indexOf('projects/oth-mcp/server.js') === -1);

check('the bridge refuses to start without a credential',
  /if \(!TOKEN\)/.test(BRIDGE) && /process\.exit\(78\)/.test(BRIDGE));

check('the credential is compared in constant time',
  /timingSafeEqual/.test(BRIDGE));

check('the bridge defaults to loopback',
  /MYTHOS_MCP_HTTP_HOST \|\| '127\.0\.0\.1'/.test(BRIDGE));

// A credential must never be printed, however convenient that is while
// debugging. Naming the VARIABLE in a startup message is fine and useful;
// interpolating its VALUE into a log line is the leak. Only the second form
// is forbidden.
check('the bridge never logs the credential value',
  !/console\.(log|error)\([^)]*(\+\s*TOKEN|\$\{TOKEN\})/.test(BRIDGE_CODE));

check('the bridge bounds the request body', /MAX_BODY_BYTES/.test(BRIDGE) && /413/.test(BRIDGE));
check('the bridge bounds the upstream wait', /CALL_TIMEOUT_MS/.test(BRIDGE));

// ---------------------------------------------------------------------------
console.log('§2 the deployment grants no host authority');

check('no docker socket is mounted',
  COMPOSE_CODE.indexOf('docker.sock') === -1);

check('the gateway image is pinned by digest, not by a moving tag',
  /image:\s*ghcr\.io\/ibm\/mcp-context-forge@sha256:[0-9a-f]{64}/.test(COMPOSE));

check('the gateway runs as a non-root uid',
  /user:\s*"10001:10001"/.test(COMPOSE));

check('both containers drop all capabilities',
  (COMPOSE.match(/cap_drop:\s*\n\s*- ALL/g) || []).length >= 2);

check('both containers set no-new-privileges',
  (COMPOSE.match(/no-new-privileges:true/g) || []).length >= 2);

check('the gateway is published to loopback only',
  /"127\.0\.0\.1:4444:4444"/.test(COMPOSE) && !/^\s*-\s*"?4444:4444/m.test(COMPOSE));

check('the GitHub MCP container publishes no port at all',
  COMPOSE_CODE.indexOf('8082:8082') === -1);

// Memory is the scarce resource on this host. An unbounded gateway would make
// the platform compete with it.
check('every container declares a memory ceiling',
  (COMPOSE.match(/mem_limit:/g) || []).length >= 2);
check('the bridge unit declares a memory ceiling', /MemoryMax=/.test(UNIT));

check('the bridge unit runs as deploy, not root', /User=deploy/.test(UNIT));
check('the bridge unit cannot write to the filesystem',
  /ProtectSystem=strict/.test(UNIT) && /ProtectHome=read-only/.test(UNIT));
check('the bridge unit cannot gain privileges', /NoNewPrivileges=yes/.test(UNIT));

// The GitHub credential belongs in the gateway's encrypted store, never in a
// container environment where `docker inspect` would print it.
check('no GitHub credential is placed in a container environment',
  !/GITHUB_PERSONAL_ACCESS_TOKEN|GITHUB_TOKEN/.test(COMPOSE_CODE));

// ---------------------------------------------------------------------------
console.log('§3 the admin surfaces are off, and blocked again at the edge');

check('the gateway config disables the admin UI',
  /MCPGATEWAY_UI_ENABLED=false/.test(ENV_EXAMPLE));
check('the gateway config disables the admin API',
  /MCPGATEWAY_ADMIN_API_ENABLED=false/.test(ENV_EXAMPLE));
check('the gateway config requires authentication',
  /AUTH_REQUIRED=true/.test(ENV_EXAMPLE) && /MCP_CLIENT_AUTH_ENABLED=true/.test(ENV_EXAMPLE));
check('basic auth is not accepted on the API or the docs',
  /API_ALLOW_BASIC_AUTH=false/.test(ENV_EXAMPLE) && /DOCS_ALLOW_BASIC_AUTH=false/.test(ENV_EXAMPLE));

// Defence in depth: nginx must refuse the admin path even if the setting above
// were ever flipped back on.
check('nginx returns 404 for the admin path',
  /location = \/gateway\/admin \{ return 404; \}/.test(NGINX) &&
  /location \^~ \/gateway\/admin\/ \{ return 404; \}/.test(NGINX));

check('nginx forwards to loopback only',
  /proxy_pass http:\/\/127\.0\.0\.1:4444\//.test(NGINX));

// Streamable HTTP is a streaming transport; buffering it looks like a hang.
check('nginx does not buffer the MCP stream', /proxy_buffering off/.test(NGINX));

// ---------------------------------------------------------------------------
console.log('§4 SSRF protection stays on, with one allowed network');

check('SSRF protection is enabled', /SSRF_PROTECTION_ENABLED=true/.test(ENV_EXAMPLE));
check('private networks are blocked by default',
  /SSRF_ALLOW_PRIVATE_NETWORKS=false/.test(ENV_EXAMPLE));
check('localhost is not reachable from a registered URL',
  /SSRF_ALLOW_LOCALHOST=false/.test(ENV_EXAMPLE));

var allow = /SSRF_ALLOWED_NETWORKS=(\[.*\])/.exec(ENV_EXAMPLE);
check('exactly one network is allowed, and it is the gateway network',
  !!allow && JSON.parse(allow[1]).length === 1 && JSON.parse(allow[1])[0] === '10.0.60.0/24',
  allow && allow[1]);

// ---------------------------------------------------------------------------
console.log('§5 no secret is committed');

// The example file must describe every variable without carrying one value.
// A placeholder is a description; a 32-byte hex string is a leak.
var LEAK = /(JWT_SECRET_KEY|AUTH_ENCRYPTION_SECRET|PLATFORM_ADMIN_PASSWORD|BASIC_AUTH_PASSWORD|MYTHOS_MCP_HTTP_TOKEN)=([^\s#]+)/g;
var leaked = [];
var m;
while ((m = LEAK.exec(ENV_EXAMPLE)) !== null) {
  if (!/^(CHANGE_ME|<|REPLACE)/i.test(m[2])) leaked.push(m[1]);
}
check('the committed example carries no real secret', leaked.length === 0, leaked.join(','));

check('no secret is committed in the compose file',
  !/[0-9a-f]{40,}/.test(COMPOSE.replace(/sha256:[0-9a-f]{64}/g, '')));

check('the runtime env files live outside the worktree',
  /\/home\/deploy\/deployments\/mythos-gateway/.test(UNIT) &&
  !fs.existsSync(path.join(DIR, 'contextforge.env')) &&
  !fs.existsSync(path.join(DIR, 'mcp-http.env')));

console.log('\ngateway-boundary: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
