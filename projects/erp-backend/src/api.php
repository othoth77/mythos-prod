<?php
// ══════════════════════════════════════════════════════════════════════
// Mythos ERP secure backend — collections API (compat with legacy api.php)
// projects/erp-backend/src/api.php
//
// Same request shape the frontend already speaks (GET ?key=, POST {key,data})
// so the UI transitions without a rewrite — but every call is now
// authenticated, authorised server-side, input-validated, transactional,
// version-checked (optimistic concurrency) and audited. The legacy
// traversal hole (mp_rdtpl_../..) is closed: keys must match a strict
// character class.
// ══════════════════════════════════════════════════════════════════════

declare(strict_types=1);

// Fixed collections carried over from the legacy ALLOWED_KEYS, plus the two
// dynamic prefixes — but only with a safe character class (no '.', '/', '..').
const ERP_FIXED_KEYS = [
    'mp_invoices','mp_devis','mp_contracts','mp_clients','mp_oms','mp_collabs',
    'mp_natures','mp_rdvs','mp_representations','mp_suppliers','mp_purchases',
    'mp_expenses','mp_expense_categories','mp_bank_entries','mp_cash_entries',
    'mp_rendez_vous','mp_documents','mp_rddocs_das','mp_rddocs_autres',
    'mp_backup_versions','mp_restore_meta','mp_taches','mp_vehicules',
    'mp_rappels','mp_rappel_types','mp_repertoire_contacts','mp_repertoire_imports',
    'mp_appels','mp_validated_inscriptions','mp_call_script','mp_sheet_webhook_url',
    // Dedicated recovery/staging dataset — separate from official mp_invoices, so
    // recovered candidates never overwrite live invoices (017/018) and stay
    // distinguishable (each carries recoveryStatus RECOVERY_REVIEW).
    'mp_invoices_recovery',
];

function key_valid(string $key): bool {
    // Strict: lower alphanumerics + underscore only. This alone defeats the
    // '..'/'/' traversal that the legacy prefix rule admitted.
    if (!preg_match('/^[a-z0-9_]{1,64}$/', $key)) return false;
    if (in_array($key, ERP_FIXED_KEYS, true)) return true;
    if (str_starts_with($key, 'mp_rdtpl_')) return true;
    if (str_starts_with($key, 'mp_rdent_')) return true;
    return false;
}

function collection_get(array $user, string $key): never {
    require_permission($user, 'read');
    if (!key_valid($key)) fail('invalid or unknown collection key', 400);
    $st = db()->prepare('SELECT data, version, updated_at FROM collections WHERE key = ?');
    $st->execute([$key]);
    $row = $st->fetch();
    if (!$row) respond(['ok' => true, 'data' => json_decode('[]', true), 'version' => 0, 'updatedAt' => null]);
    respond([
        'ok'        => true,
        'data'      => json_decode($row['data'], true),
        'version'   => (int)$row['version'],
        'updatedAt' => $row['updated_at'],
    ]);
}

function collection_meta(array $user): never {
    require_permission($user, 'read');
    $rows = db()->query('SELECT key, version, updated_at FROM collections')->fetchAll();
    $meta = [];
    foreach ($rows as $r) {
        $meta[$r['key']] = ['version' => (int)$r['version'], 'updatedAt' => $r['updated_at']];
    }
    respond(['ok' => true, 'meta' => $meta]);
}

// Body: { key, data, baseVersion? }. If baseVersion is supplied and does not
// match the stored version, the write is refused (409) — optimistic locking.
function collection_write(array $user, array $body): never {
    require_permission($user, 'write');
    if (!csrf_ok($user)) fail('CSRF check failed', 403);

    $key = (string)($body['key'] ?? '');
    if (!key_valid($key)) fail('invalid or unknown collection key', 400);
    if (!array_key_exists('data', $body)) fail('data is required', 400);

    $data = $body['data'];
    if (!is_array($data)) fail('data must be a JSON array or object', 400);
    $encoded = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($encoded === false) fail('data is not serialisable', 400);
    $maxBytes = (int)cfg('ERP_MAX_COLLECTION_BYTES', (string)(8 * 1024 * 1024));
    if (strlen($encoded) > $maxBytes) fail('collection payload too large', 413);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT version FROM collections WHERE key = ?');
        $st->execute([$key]);
        $cur = $st->fetch();
        $curVersion = $cur ? (int)$cur['version'] : 0;

        if (isset($body['baseVersion']) && (int)$body['baseVersion'] !== $curVersion) {
            $pdo->rollBack();
            fail('version conflict', 409, ['currentVersion' => $curVersion]);
        }
        $newVersion = $curVersion + 1;
        if ($cur) {
            $up = $pdo->prepare('UPDATE collections SET data=?, version=?, updated_at=?, updated_by=? WHERE key=?');
            $up->execute([$encoded, $newVersion, now_iso(), $user['id'], $key]);
        } else {
            $ins = $pdo->prepare('INSERT INTO collections (key, data, version, updated_at, updated_by) VALUES (?,?,?,?,?)');
            $ins->execute([$key, $encoded, $newVersion, now_iso(), $user['id']]);
        }
        audit($user, 'write', $key, null, ['version' => $newVersion, 'bytes' => strlen($encoded)]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        fail('write failed', 500);
    }
    respond(['ok' => true, 'key' => $key, 'version' => $newVersion]);
}
