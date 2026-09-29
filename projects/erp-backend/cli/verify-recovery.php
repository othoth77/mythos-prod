<?php
// projects/erp-backend/cli/verify-recovery.php
// READ-ONLY verification (§5). Reports which invoice numbers 001..018 are
// represented in the official `mp_invoices` and/or the `mp_invoices_recovery`
// staging collection, how many candidates carry each number (007/008 are
// expected to have TWO), and the total counts. It NEVER writes — source data
// is not modified. Financial totals per record are echoed for spot-checking.
//
// Usage: ERP_DB_DRIVER=sqlite ERP_DB_PATH=/path/erp.db php cli/verify-recovery.php
declare(strict_types=1);
$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';

function coll(string $key): array {
    $st = db()->prepare('SELECT data FROM collections WHERE key = ?');
    $st->execute([$key]);
    $r = $st->fetch();
    if (!$r) return [];
    $d = json_decode($r['data'], true);
    return is_array($d) ? $d : [];
}
// Normalise an invoice number to its 3-digit sequence (007, 018, …), tolerant
// of "2026/007", "DEV-2026/7", "7", etc.
function seq($rec): ?string {
    foreach (['num', 'invoiceNumber', 'number', 'no', 'invoice_no'] as $k) {
        if (!empty($rec[$k])) {
            if (preg_match('/(\d{1,3})\s*$/', (string)$rec[$k], $m)) return str_pad($m[1], 3, '0', STR_PAD_LEFT);
        }
    }
    return null;
}
function amount($rec) {
    foreach (['ttc', 'totalTTC', 'total', 'amount'] as $k) if (isset($rec[$k])) return $rec[$k];
    return null;
}

$official = coll('mp_invoices');
$recovery = coll('mp_invoices_recovery');

$byOfficial = [];  $byRecovery = [];
foreach ($official as $r) { $s = seq($r); if ($s) $byOfficial[$s][] = $r; }
foreach ($recovery as $r) { $s = seq($r); if ($s) $byRecovery[$s][] = $r; }

echo "== Invoice representation (official + recovery) ==\n";
$missing = [];
for ($i = 1; $i <= 18; $i++) {
    $n = str_pad((string)$i, 3, '0', STR_PAD_LEFT);
    $o = count($byOfficial[$n] ?? []);
    $c = count($byRecovery[$n] ?? []);
    $flag = ($o + $c) > 0 ? 'OK ' : 'MISSING';
    if (($o + $c) === 0) $missing[] = $n;
    $note = '';
    if ($n === '007' || $n === '008') $note = ($o + $c) >= 2 ? '  <- both candidates preserved' : '  <- EXPECTED 2 candidates';
    printf("  %-3s  official:%d  recovery:%d  [%s]%s\n", $n, $o, $c, $flag, $note);
}

echo "\n== Totals ==\n";
printf("  official mp_invoices records:          %d\n", count($official));
printf("  recovery mp_invoices_recovery records: %d\n", count($recovery));
$dups = 0; foreach ($recovery as $r) if (!empty($r['duplicateCandidate'])) $dups++;
printf("  recovery records flagged duplicateCandidate: %d\n", $dups);

echo "\n== Provenance & recovery-status integrity (recovery set) ==\n";
$noStatus = 0; $noProv = 0;
foreach ($recovery as $r) {
    if (($r['recoveryStatus'] ?? '') !== 'RECOVERY_REVIEW') $noStatus++;
    if (empty($r['originalId']) && empty($r['source']) && empty($r['provenance'])) $noProv++;
}
printf("  records without recoveryStatus=RECOVERY_REVIEW: %d (want 0)\n", $noStatus);
printf("  records without any provenance link:            %d (want 0)\n", $noProv);

echo "\n== Spot-check: number -> amount(s) ==\n";
foreach (['007', '008'] as $n) {
    foreach (($byRecovery[$n] ?? []) as $r) {
        printf("  %s  amount=%s  source=%s  originalId=%s\n", $n, var_export(amount($r), true),
            var_export($r['source'] ?? null, true), var_export($r['originalId'] ?? null, true));
    }
}

$ok = empty($missing) && $noStatus === 0 && $noProv === 0;
echo "\nVERIFY-RECOVERY: " . ($ok ? "all 001-018 represented; provenance+status intact" : "ATTENTION — missing: " . implode(',', $missing)) . "\n";
exit($ok ? 0 : 1);
