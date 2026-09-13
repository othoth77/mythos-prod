<?php
// ══════════════════════════════════════════════════════════════════════
// Mythos ERP secure backend — authentication & sessions
// projects/erp-backend/src/auth.php
//
// Server-side sessions (OTHMODE pattern): a 256-bit random session id is set
// as an __Host- HttpOnly; Secure; SameSite=Strict cookie; only its sha-256
// hash is stored. Passwords are argon2id (OWASP-recommended, PHP-native).
// Login is constant-time against a dummy hash to prevent user enumeration,
// and rate-limited. Session id is regenerated on login (fixation defence).
// ══════════════════════════════════════════════════════════════════════

declare(strict_types=1);

function hash_password(string $plain): string {
    return password_hash($plain, PASSWORD_ARGON2ID);
}

// A VALID argon2id hash of a random string, generated once per process and
// verified when a user does not exist, so the response time matches a real
// verify and does not reveal whether the username is valid (anti-enumeration).
function dummy_hash(): string {
    static $h = null;
    if ($h === null) $h = password_hash(bin2hex(random_bytes(16)), PASSWORD_ARGON2ID);
    return $h;
}

function sha256(string $v): string { return hash('sha256', $v); }

function set_session_cookie(string $sessionId, int $ttlDays): void {
    $secure = cfg('ERP_COOKIE_SECURE', '1') !== '0';
    setcookie(session_cookie_name(), $sessionId, [
        'expires'  => time() + $ttlDays * 86400,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}
function clear_session_cookie(): void {
    $secure = cfg('ERP_COOKIE_SECURE', '1') !== '0';
    setcookie(session_cookie_name(), '', [
        'expires' => time() - 3600, 'path' => '/',
        'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict',
    ]);
}

// ── Login throttle ────────────────────────────────────────────────────
function throttled(string $username, string $ip): bool {
    $since = gmdate('Y-m-d\TH:i:s\Z', time() - 900); // 15-minute window
    $st = db()->prepare(
        'SELECT COUNT(*) c FROM login_attempts WHERE ok = 0 AND ts > ? AND (username = ? OR ip = ?)'
    );
    $st->execute([$since, $username, $ip]);
    return (int)$st->fetch()['c'] >= 10;
}
function record_attempt(string $username, string $ip, bool $ok): void {
    $st = db()->prepare('INSERT INTO login_attempts (username, ip, ts, ok) VALUES (?,?,?,?)');
    $st->execute([$username, $ip, now_iso(), $ok ? 1 : 0]);
}

// ── Login / logout ────────────────────────────────────────────────────
// Returns the created session's [sessionId, user] or null on failure.
function login(string $username, string $password): ?array {
    $ip = client_ip();
    if ($username === '' || $password === '') return null;
    if (throttled($username, $ip)) return null;

    $st = db()->prepare('SELECT * FROM users WHERE username = ? AND active = 1');
    $st->execute([$username]);
    $user = $st->fetch();

    // Constant-time: always run a verify, even for a missing user.
    $hash = $user ? $user['password_hash'] : dummy_hash();
    $ok = password_verify($password, $hash);

    record_attempt($username, $ip, (bool)($ok && $user));
    if (!$ok || !$user) return null;

    // Fresh session id on every login (fixation defence).
    $sessionId = bin2hex(random_bytes(32));
    $csrf      = bin2hex(random_bytes(32));
    $ttlDays   = (int)cfg('ERP_SESSION_TTL_DAYS', '7');
    $st = db()->prepare(
        'INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, expires_at, last_seen, ip, user_agent)
         VALUES (?,?,?,?,?,?,?,?)'
    );
    $st->execute([
        sha256($sessionId), $user['id'], $csrf, now_iso(),
        gmdate('Y-m-d\TH:i:s\Z', time() + $ttlDays * 86400), now_iso(),
        $ip, substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
    ]);
    set_session_cookie($sessionId, $ttlDays);
    return [$sessionId, $user, $csrf];
}

function logout(): void {
    $sid = $_COOKIE[session_cookie_name()] ?? '';
    if ($sid !== '') {
        $st = db()->prepare('DELETE FROM sessions WHERE id_hash = ?');
        $st->execute([sha256($sid)]);
    }
    clear_session_cookie();
}

// ── Current user (from the session cookie) ────────────────────────────
// Returns ['id','username','display_name','roles'=>[...],'csrf'] or null.
function current_user(): ?array {
    $sid = $_COOKIE[session_cookie_name()] ?? '';
    if ($sid === '') return null;
    $st = db()->prepare('SELECT * FROM sessions WHERE id_hash = ?');
    $st->execute([sha256($sid)]);
    $sess = $st->fetch();
    if (!$sess) return null;
    if (strcmp($sess['expires_at'], now_iso()) < 0) {         // expired
        $d = db()->prepare('DELETE FROM sessions WHERE id_hash = ?');
        $d->execute([$sess['id_hash']]);
        return null;
    }
    $u = db()->prepare('SELECT id, username, display_name, active FROM users WHERE id = ?');
    $u->execute([$sess['user_id']]);
    $user = $u->fetch();
    if (!$user || (int)$user['active'] !== 1) return null;

    $touch = db()->prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?');
    $touch->execute([now_iso(), $sess['id_hash']]);

    $user['roles'] = user_roles((int)$user['id']);
    $user['csrf']  = $sess['csrf_token'];
    return $user;
}

function user_roles(int $userId): array {
    $st = db()->prepare(
        'SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?'
    );
    $st->execute([$userId]);
    return array_map(fn($r) => $r['name'], $st->fetchAll());
}

// ── CSRF: session-bound double-submit for cookie-authenticated writes ──
function csrf_ok(array $user): bool {
    $sent = $_SERVER['HTTP_' . str_replace('-', '_', strtoupper(ERP_CSRF_HEADER))] ?? '';
    if ($sent === '' || empty($user['csrf'])) return false;
    if (!hash_equals($user['csrf'], $sent)) return false;
    // Defence in depth: same-origin check when an allow-list is configured.
    $allowed = cfg('ERP_ALLOWED_ORIGIN');
    $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($allowed && $origin && !hash_equals($allowed, $origin)) return false;
    return true;
}
