<?php
// projects/erp-backend/cli/import-recovery.php
// Import ALL invoice recovery candidates into the dedicated, SEPARATE staging
// collection `mp_invoices_recovery`. Preserves every field verbatim (original
// id, number, financial values, dates, client, lines, status, source,
// provenance, duplicateCandidate, assessment, …), never deduplicates, never
// deletes, and NEVER touches the official `mp_invoices` collection — so live
// invoices 017/018 are untouched. Each record is tagged so it stays
// distinguishable from an official invoice and remains linked to its source.
//
// The input is schema-tolerant: a JSON array of candidates, or an object with
// a candidates/invoices/records array, or an object keyed by id/number. This
// works with COMPLETE_INVOICE_REVIEW_ASSESSED.json regardless of its exact
// envelope — every field found on each candidate is preserved.
//
// Usage:
//   ERP_DB_DRIVER=sqlite ERP_DB_PATH=/path/erp.db \
//   php cli/import-recovery.php <review.json> [importer-username] [--append]
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';
require $root . '/src/db.php';

$file = $argv[1] ?? '';
$importer = ($argv[2] ?? 'migration');
$append = in_array('--append', $argv, true);
if ($importer === '--append') { $importer = 'migration'; }
if ($file === '' || !is_file($file)) { fwrite(STDERR, "usage: import-recovery.php <review.json> [username] [--append]\n"); exit(2); }

$raw = file_get_contents($file);
$parsed = json_decode((string)$raw, true);
if (!is_array($parsed)) { fwrite(STDERR, "input is not valid JSON\n"); exit(2); }

// Extract the candidate list from whatever envelope the file uses.
function extract_candidates($parsed): array {
    // top-level array of objects
    if (array_is_list($parsed)) return $parsed;
    foreach (['candidates', 'invoices', 'records', 'items', 'data'] as $k) {
        if (isset($parsed[$k]) && is_array($parsed[$k])) {
            return array_is_list($parsed[$k]) ? $parsed[$k] : array_values($parsed[$k]);
        }
    }
    // object keyed by id/number -> take the values that are themselves objects
    $vals = array_values(array_filter($parsed, 'is_array'));
    return $vals;
}
$candidates = extract_candidates($parsed);
if (!$candidates) { fwrite(STDERR, "no candidate records found in the file\n"); exit(1); }

$importId = 'rec_' . gmdate('Ymd\THis\Z') . '_' . bin2hex(random_bytes(3));
$stamped = [];
$dupCount = 0;
foreach ($candidates as $c) {
    if (!is_array($c)) continue;
    // PRESERVE everything: start from the source object verbatim.
    $rec = $c;
    // Ensure a stable original-id link to provenance (never overwrite an existing one).
    if (!isset($rec['originalId'])) {
        $rec['originalId'] = $c['originalId'] ?? $c['id'] ?? $c['_id'] ?? null;
    }
    // Tag as recovery/staging, distinguishable from official invoices.
    if (!isset($rec['recoveryStatus'])) $rec['recoveryStatus'] = 'RECOVERY_REVIEW';
    if (!array_key_exists('reviewDecision', $rec)) $rec['reviewDecision'] = null; // KEEP|DELETE|MERGE, set later
    $rec['importBatch'] = $importId;
    $rec['importedAt'] = now_iso();
    if (!empty($c['duplicateCandidate'])) $dupCount++;
    $stamped[] = $rec;
}

$pdo = db();
migrate();
// Resolve importer id (for updated_by / audit), else null.
$importerId = null;
$st = $pdo->prepare('SELECT id FROM users WHERE username = ?');
$st->execute([$importer]);
if ($row = $st->fetch()) $importerId = (int)$row['id'];

$pdo->beginTransaction();
try {
    $sel = $pdo->prepare('SELECT data, version FROM collections WHERE key = ?');
    $sel->execute(['mp_invoices_recovery']);
    $cur = $sel->fetch();
    $existing = ($append && $cur) ? (json_decode($cur['data'], true) ?: []) : [];
    $final = array_merge($existing, $stamped);
    $encoded = json_encode($final, JSON_UNESCAPED_UNICODE);
    $v = $cur ? (int)$cur['version'] + 1 : 1;
    if ($cur) {
        $pdo->prepare('UPDATE collections SET data=?, version=?, updated_at=?, updated_by=? WHERE key=?')
            ->execute([$encoded, $v, now_iso(), $importerId, 'mp_invoices_recovery']);
    } else {
        $pdo->prepare('INSERT INTO collections (key, data, version, updated_at, updated_by) VALUES (?,?,?,?,?)')
            ->execute(['mp_invoices_recovery', $encoded, $v, now_iso(), $importerId]);
    }
    $pdo->prepare('INSERT INTO audit_log (ts, actor_user_id, actor_username, action, resource, resource_id, meta, ip) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([now_iso(), $importerId, $importer, 'recovery.import', 'mp_invoices_recovery', $importId,
                   json_encode(['candidates' => count($stamped), 'duplicateCandidates' => $dupCount, 'append' => $append, 'version' => $v]), 'cli']);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, "import failed: " . $e->getMessage() . "\n");
    exit(1);
}

fwrite(STDOUT, "recovery import ok: " . count($stamped) . " candidate(s) into mp_invoices_recovery"
    . " (" . $dupCount . " flagged duplicateCandidate), batch $importId"
    . ($append ? " [appended]" : " [replaced]") . "\n");
fwrite(STDOUT, "official mp_invoices was NOT touched.\n");
