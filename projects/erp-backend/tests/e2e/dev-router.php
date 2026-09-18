<?php
// TEST-ONLY router (never deployed). Serves the harness page and the frontend
// secure client from the SAME origin as the backend, then delegates every
// other request to the real backend front controller.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$here = __DIR__;
$repo = dirname($here, 4);
if ($path === '/favicon.ico') { http_response_code(204); exit; }
if ($path === '/secure-client.js') {
    header('Content-Type: application/javascript');
    readfile($repo . '/js/core/secure-client.js');
    exit;
}
if ($path === '/' || $path === '/harness.html') {
    header('Content-Type: text/html; charset=utf-8');
    readfile($here . '/harness.html');
    exit;
}
require dirname($here, 2) . '/public/index.php';
