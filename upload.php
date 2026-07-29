<?php
// upload.php — Mythos Prod
// Reçoit un fichier, le sauvegarde dans /documents/{cat}/

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── UPLOAD ────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $cat     = preg_replace('/[^a-z\-]/', '', $_POST['cat'] ?? 'mythos');
    $docId   = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_POST['doc_id'] ?? ('doc_' . time()));
    $allowed = [
        'image/jpeg','image/png','image/gif','image/webp',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv','text/plain','application/csv'
    ];

    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        echo json_encode(['ok'=>false,'error'=>'Aucun fichier reçu']);
        exit;
    }

    $file = $_FILES['file'];
    if (!in_array($file['type'], $allowed)) {
        echo json_encode(['ok'=>false,'error'=>'Type de fichier non autorisé']);
        exit;
    }

    // Taille max 10 Mo
    if ($file['size'] > 10 * 1024 * 1024) {
        echo json_encode(['ok'=>false,'error'=>'Fichier trop grand (max 10 Mo)']);
        exit;
    }

    // Créer le dossier si nécessaire
    $dir = __DIR__ . '/documents/' . $cat . '/';
    if (!is_dir($dir)) mkdir($dir, 0755, true);

    // Extension — garder celle du fichier original
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    // Fallback si extension manquante
    if (!$ext) {
        $extMap = [
            'application/pdf' => 'pdf',
            'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp',
            'application/msword' => 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
            'application/vnd.ms-excel' => 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
            'text/csv' => 'csv', 'application/csv' => 'csv',
        ];
        $ext = $extMap[$file['type']] ?? 'bin';
    }

    $filename = $docId . '_' . time() . '.' . $ext;
    $dest     = $dir . $filename;

    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        echo json_encode(['ok'=>false,'error'=>'Erreur lors de la sauvegarde']);
        exit;
    }

    $url = '/documents/' . $cat . '/' . $filename;
    $fileType = 'file';
    if (in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'], true)) $fileType = 'image';
    if ($ext === 'pdf') $fileType = 'pdf';
    if (in_array($ext, ['doc', 'docx'], true)) $fileType = 'word';
    if (in_array($ext, ['xls', 'xlsx'], true)) $fileType = 'excel';
    if ($ext === 'csv') $fileType = 'csv';
    if ($ext === 'txt') $fileType = 'text';
    echo json_encode(['ok'=>true,'url'=>$url,'fileType'=>$fileType,'ext'=>$ext]);
    exit;
}

// ── DELETE ────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    parse_str(file_get_contents('php://input'), $data);
    $url = $data['url'] ?? '';

    // Sécurité : autoriser uniquement les fichiers dans /documents/
    if (!preg_match('#^/documents/[a-z\-]+/[a-zA-Z0-9_\-\.]+$#', $url)) {
        echo json_encode(['ok'=>false,'error'=>'Chemin invalide']);
        exit;
    }

    $path = __DIR__ . $url;
    if (file_exists($path)) {
        unlink($path);
        echo json_encode(['ok'=>true]);
    } else {
        echo json_encode(['ok'=>false,'error'=>'Fichier introuvable']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['ok'=>false,'error'=>'Méthode non autorisée']);
