<?php
// projects/erp-backend/cli/migrate.php — apply the schema (idempotent).
// Usage: ERP_DB_DRIVER=sqlite ERP_DB_PATH=/path/erp.db php cli/migrate.php
declare(strict_types=1);
$root = dirname(__DIR__);
require $root . '/src/bootstrap.php';
require $root . '/src/db.php';
migrate();
fwrite(STDOUT, "migrated\n");
