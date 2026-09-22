<?php
// ══════════════════════════════════════════════════════════════════════
// Mythos ERP secure backend — role-based access control
// projects/erp-backend/src/rbac.php
//
// Deliberately simple (per DEPLOYMENT §5: no over-built permission engine):
// three roles map to a small, closed set of actions. Authorization is always
// evaluated SERVER-SIDE from the authenticated session's roles — never from
// anything the client sends.
//
//   viewer : read
//   editor : read, write, upload
//   admin  : read, write, upload, admin (user management, read audit)
// ══════════════════════════════════════════════════════════════════════

declare(strict_types=1);

const ERP_ROLE_ACTIONS = [
    'viewer' => ['read'],
    'editor' => ['read', 'write', 'upload'],
    'admin'  => ['read', 'write', 'upload', 'admin'],
];

function can(?array $user, string $action): bool {
    if (!$user || empty($user['roles'])) return false;
    foreach ($user['roles'] as $role) {
        $actions = ERP_ROLE_ACTIONS[$role] ?? [];
        if (in_array($action, $actions, true)) return true;
    }
    return false;
}

// Guard: require an authenticated session; 401 if absent. Returns the user.
function require_auth(): array {
    $user = current_user();
    if (!$user) fail('authentication required', 401);
    return $user;
}

// Guard: require a permission; 403 if the authenticated user lacks it.
function require_permission(array $user, string $action): void {
    if (!can($user, $action)) fail('forbidden', 403, ['need' => $action]);
}
