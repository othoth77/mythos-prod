<?php
// ══════════════════════════════════════════════════════════════════════
// Mythos ERP secure backend — secure document upload
// projects/erp-backend/src/uploads.php
//
// Fixes the legacy upload.php RCE (extension taken from the client filename).
// Here: the file type is decided by the SERVER from the magic bytes (finfo),
// checked against a closed MIME→extension allow-list; the stored filename is
// server-generated random (never the client's); files are written OUTSIDE
// the web root; size is capped; and the nginx config disables PHP execution
// in the storage directory. Client Content-Type and filename are display-only.
// ══════════════════════════════════════════════════════════════════════

declare(strict_types=1);

// Closed allow-list: server-detected MIME → the ONLY extension we will store.
const ERP_UPLOAD_MIME = [
    'application/pdf' => 'pdf',
    'image/jpeg'      => 'jpg',
    'image/png'       => 'png',
    'image/webp'      => 'webp',
    'image/gif'       => 'gif',
    'text/plain'      => 'txt',
    'text/csv'        => 'csv',
];

function upload_document(array $user): never {
    require_permission($user, 'upload');
    if (!csrf_ok($user)) fail('CSRF check failed', 403);

    if (empty($_FILES['file']) || ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        fail('no file or upload error', 400);
    }
    $file = $_FILES['file'];
    $tmp  = $file['tmp_name'];
    if (!is_uploaded_file($tmp)) fail('invalid upload', 400);

    $maxBytes = (int)cfg('ERP_MAX_UPLOAD_BYTES', (string)(10 * 1024 * 1024));
    if (($file['size'] ?? 0) <= 0 || $file['size'] > $maxBytes) fail('file too large or empty', 413);

    // Decide the type from the CONTENT, not the client's Content-Type/name.
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = (string)$finfo->file($tmp);
    if (!isset(ERP_UPLOAD_MIME[$mime])) {
        fail('file type not allowed', 415, ['detected' => $mime]);
    }
    $ext = ERP_UPLOAD_MIME[$mime];

    $dir = cfg('ERP_UPLOAD_DIR');
    if (!$dir || !is_dir($dir) || !is_writable($dir)) fail('storage unavailable', 500);
    // Real path guard: the resolved directory must be exactly the configured
    // storage root — no symlink/traversal escape.
    $realDir = realpath($dir);
    if ($realDir === false) fail('storage unavailable', 500);

    $id       = bin2hex(random_bytes(16));         // server-generated id
    $stored   = $id . '.' . $ext;                  // random name + safe ext
    $destPath = $realDir . DIRECTORY_SEPARATOR . $stored;
    // Final containment check: dest must sit directly under the storage root.
    if (dirname($destPath) !== $realDir) fail('storage path rejected', 500);

    if (!move_uploaded_file($tmp, $destPath)) fail('could not store file', 500);
    @chmod($destPath, 0640);

    $origName = substr((string)($file['name'] ?? ''), 0, 255);
    $category = preg_replace('/[^a-z0-9_\-]/i', '', (string)($_POST['category'] ?? 'general'));

    $st = db()->prepare(
        'INSERT INTO documents (id, orig_name, stored_name, mime, size, category, uploaded_by, uploaded_at)
         VALUES (?,?,?,?,?,?,?,?)'
    );
    $st->execute([$id, $origName, $stored, $mime, (int)$file['size'], $category, $user['id'], now_iso()]);
    audit($user, 'upload', 'document', $id, ['mime' => $mime, 'size' => (int)$file['size']]);

    respond(['ok' => true, 'id' => $id, 'mime' => $mime, 'size' => (int)$file['size']]);
}
