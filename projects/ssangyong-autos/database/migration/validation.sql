-- =============================================================================
-- SSANGYONG.AUTOS Stage 4 — post-import validation (READ-ONLY)
-- STATUS: DRY-RUN ARTIFACT — NOT EXECUTED — NOT DEPLOYED.
-- Every query must return the expected value; any deviation aborts Stage 5.
-- =============================================================================
SELECT 'products'            AS check, count(*) = 346 AS pass FROM sya_products
UNION ALL SELECT 'vehicle_models',       count(*) = 17  FROM sya_vehicle_models
UNION ALL SELECT 'vehicle_motorizations',count(*) = 63  FROM sya_vehicle_motorizations
UNION ALL SELECT 'compatibility',        count(*) = 782  FROM sya_product_vehicle_compatibility
UNION ALL SELECT 'images',               count(*) = 311  FROM sya_product_images
UNION ALL SELECT 'compat_motor_fk_set',  count(*) = 782 FROM sya_product_vehicle_compatibility WHERE vehicle_motorization_id IS NOT NULL
UNION ALL SELECT 'dup_product_url',      count(*) = 0 FROM (SELECT product_url FROM sya_products GROUP BY 1 HAVING count(*) > 1) d
UNION ALL SELECT 'dup_business_identity',count(*) = 0 FROM (SELECT source, product_brand, canonical_reference FROM sya_products GROUP BY 1,2,3 HAVING count(*) > 1) d
UNION ALL SELECT 'dup_compatibility',    count(*) = 0 FROM (SELECT product_id, vehicle_model_id, motorisation, year_from, year_to FROM sya_product_vehicle_compatibility GROUP BY 1,2,3,4,5 HAVING count(*) > 1) d
UNION ALL SELECT 'dup_product_image',    count(*) = 0 FROM (SELECT product_id, image_url FROM sya_product_images GROUP BY 1,2 HAVING count(*) > 1) d
UNION ALL SELECT 'orphan_compat_product',count(*) = 0 FROM sya_product_vehicle_compatibility c LEFT JOIN sya_products p ON p.id = c.product_id WHERE p.id IS NULL
UNION ALL SELECT 'orphan_compat_model',  count(*) = 0 FROM sya_product_vehicle_compatibility c LEFT JOIN sya_vehicle_models m ON m.id = c.vehicle_model_id WHERE m.id IS NULL
UNION ALL SELECT 'orphan_compat_motor',  count(*) = 0 FROM sya_product_vehicle_compatibility c LEFT JOIN sya_vehicle_motorizations t ON t.id = c.vehicle_motorization_id WHERE c.vehicle_motorization_id IS NOT NULL AND t.id IS NULL
UNION ALL SELECT 'orphan_image_product', count(*) = 0 FROM sya_product_images i LEFT JOIN sya_products p ON p.id = i.product_id WHERE p.id IS NULL
UNION ALL SELECT 'orphan_motor_model',   count(*) = 0 FROM sya_vehicle_motorizations t LEFT JOIN sya_vehicle_models m ON m.id = t.vehicle_model_id WHERE m.id IS NULL
UNION ALL SELECT 'products_without_images', count(*) = 35 FROM sya_products p WHERE NOT EXISTS (SELECT 1 FROM sya_product_images i WHERE i.product_id = p.id)
UNION ALL SELECT 'datelike_motorisation', count(*) = 0 FROM sya_product_vehicle_compatibility WHERE motorisation ~ '^\d{4}-\d{2}-\d{2}'
UNION ALL SELECT 'price_range',          bool_and(price_tnd BETWEEN 10.40 AND 1885.50) FROM sya_products;
