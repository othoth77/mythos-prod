<?php
// ══════════════════════════════════════════════════════════════════════
// Mythos ERP secure backend — append-only audit trail
// projects/erp-backend/src/audit.php
//
// Every state-changing action records who did what to which resource, when.
// No API path ever UPDATEs or DELETEs audit_log rows — it is append-only,
// so an ordinary (or even admin) user cannot silently rewrite history
// through the application. Retention/rotation is an operator DB task.
// ══════════════════════════════════════════════════════════════════════

declare(strict_types=1);

function audit(?array $actor, string $action, ?string $resource = null,
               ?string $resourceId = null, array $meta = []): void {
    $st = db()->prepare(
        'INSERT INTO audit_log (ts, actor_user_id, actor_username, action, resource, resource_id, meta, ip)
         VALUES (?,?,?,?,?,?,?,?)'
    );
    $st->execute([
        now_iso(),
        $actor['id'] ?? null,
        $actor['username'] ?? null,
        $action,
        $resource,
        $resourceId,
        $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null,
        client_ip(),
    ]);
}
