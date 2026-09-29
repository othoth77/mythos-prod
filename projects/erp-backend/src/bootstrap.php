<?php
// ══════════════════════════════════════════════════════════════════════
// Mythos ERP secure backend — bootstrap (config, DB, security headers)
// projects/erp-backend/src/bootstrap.php
//
// All configuration comes from the environment. NO secret is ever hard-coded
// here (the whole reason the legacy client-side hash was insecure). Fail
// closed: a missing database configuration aborts with 500, never an open
// door.
// ══════════════════════════════════════════════════════════════════════

declare(strict_types=1);

// ── Configuration from the environment ────────────────────────────────
function cfg(string $key, ?string $default = null): ?string {
    $v = getenv($key);
    if ($v === false || $v === '') return $default;
    return $v;
}

const ERP_CSRF_HEADER = 'X-CSRF-Token';

// The __Host- prefix binds the cookie to host + HTTPS + Path=/ (strongest),
// but the browser/curl ONLY accept it when the cookie is also Secure. Over
// HTTPS (production, the default) we use it; when Secure is disabled for a
// local HTTP dev/test run we fall back to a plain name so the flow still works.
function session_cookie_name(): string {
    $secure = cfg('ERP_COOKIE_SECURE', '1') !== '0';
    return $secure ? '__Host-erpsess' : 'erpsess';
}

// ── Security response headers (always) ────────────────────────────────
function send_security_headers(): void {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Cache-Control: no-store');
    header_remove('X-Powered-By');

    // CORS is closed by default. If an origin is explicitly allow-listed and
    // matches the request, echo it (never '*') and allow credentials.
    $allowed = cfg('ERP_ALLOWED_ORIGIN');
    $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($allowed && $origin && hash_equals($allowed, $origin)) {
        header('Access-Control-Allow-Origin: ' . $allowed);
        header('Vary: Origin');
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Headers: Content-Type, ' . ERP_CSRF_HEADER);
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    }
}

// ── JSON response helpers ─────────────────────────────────────────────
function respond(array $payload, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $error, int $code = 400, array $extra = []): never {
    respond(array_merge(['ok' => false, 'error' => $error], $extra), $code);
}

// ── Database (PDO) — SQLite reference or MySQL/MariaDB ─────────────────
function db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $driver = cfg('ERP_DB_DRIVER', 'sqlite');
    try {
        if ($driver === 'sqlite') {
            $path = cfg('ERP_DB_PATH');
            if (!$path) { http_response_code(500); die('ERP_DB_PATH not configured'); }
            $pdo = new PDO('sqlite:' . $path);
            $pdo->exec('PRAGMA journal_mode = WAL;');   // concurrency: many readers, one writer
            $pdo->exec('PRAGMA foreign_keys = ON;');
            $pdo->exec('PRAGMA busy_timeout = 5000;');
        } elseif ($driver === 'mysql') {
            $dsn  = cfg('ERP_DB_DSN');   // e.g. mysql:host=localhost;dbname=erp;charset=utf8mb4
            $user = cfg('ERP_DB_USER');
            $pass = cfg('ERP_DB_PASS');
            if (!$dsn) { http_response_code(500); die('ERP_DB_DSN not configured'); }
            $pdo = new PDO($dsn, $user, $pass);
        } else {
            http_response_code(500); die('unknown ERP_DB_DRIVER');
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        http_response_code(500);
        // Never leak connection details to the client.
        die('database unavailable');
    }
    return $pdo;
}

function now_iso(): string { return gmdate('Y-m-d\TH:i:s\Z'); }

function client_ip(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? '');
}
