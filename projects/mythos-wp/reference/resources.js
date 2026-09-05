'use strict';
// =====================================================
// MYTHOS WP — resource registry (the headless CRUD contract)
// projects/mythos-wp/reference/resources.js
//
// The pattern is Refine's `resources` + `dataProvider`, without the
// framework: ONE declarative registry drives the generic API (crud.js), the
// generic table and the generic editor in the browser (served through
// /api/meta with the SQL-facing parts removed). Adding a business table
// means adding an entry here — no new route, no new view.
//
// Two scopes:
//   catalog  lives in the PROJECT's catalogue database (sya_* tables of
//            projects/ssangyong-autos/database/schema.sql). The same
//            definitions serve piece.autos / casse.autos once they have a
//            catalogue with the same shape; nothing here names SsangYong.
//   wp       lives in mythos_wp and carries project_id.
//
// Field flags:  required · readonly (server-managed, refused on write) ·
// virtual (joined display column, list-only) · listed (default table
// column) · sortable · section (editor grouping) · ref (foreign key →
// { resource, display }) · createOnly (immutable after create).
//
// Permissions are ROLE NAMES (auth.hasRole): 'operator' also admits 'owner'.
// A resource without `write` is read-only for everyone.
// =====================================================

var UID_PATTERN = '^[A-Za-z0-9._:-]{1,64}$';
var ISO3 = '^[A-Z]{3}$';
var AVAILABILITY_CATALOG = ['En Stock', 'Sur Commande', 'Indisponible'];
var PRODUCT_STATUS = ['active', 'updated', 'inactive', 'delisted'];

function ts(name, label, extra) {
  return Object.assign({ name: name, label: label, type: 'timestamp', section: 'audit' }, extra || {});
}
var CREATED = ts('created_at', 'Created', { readonly: true, sortable: true });
var UPDATED = ts('updated_at', 'Updated', { readonly: true, sortable: true, listed: true });
var UPDATED_BY = { name: 'updated_by', label: 'Updated by', type: 'text', readonly: true, section: 'audit' };

var RESOURCES = {

  // ---------------------------------------------------------------- catalogue
  products: {
    key: 'products', label: 'Products / Parts', singular: 'Part', group: 'catalogue', icon: 'part',
    scope: 'catalog', table: 'sya_products', idColumn: 'id', uidColumn: 'product_uid', titleField: 'product_title',
    permissions: { read: 'operator', write: 'operator', delete: 'owner' },
    delete: { kind: 'soft', field: 'status', value: 'delisted', label: 'Delist' },
    managed: { updated_at: 'now' },
    search: ['canonical_reference', 'product_title', 'oem_reference', 'product_brand', 'product_uid', 'pair_reference'],
    defaultSort: { field: 'updated_at', dir: 'desc' },
    filters: [
      { name: 'status', label: 'Status', field: 'status', enum: PRODUCT_STATUS },
      { name: 'availability', label: 'Catalogue availability', field: 'availability', enum: AVAILABILITY_CATALOG },
      { name: 'brand', label: 'Brand', field: 'product_brand' },
      { name: 'missing_oem', label: 'Missing OEM reference', kind: 'flag', sql: "(t.oem_reference IS NULL OR t.oem_reference = '')" }
    ],
    fields: [
      { name: 'id', label: 'Internal ID', type: 'integer', readonly: true, section: 'identity', sortable: true },
      { name: 'product_uid', label: 'SKU / UID', type: 'text', required: true, maxLength: 64, pattern: UID_PATTERN, createOnly: true, section: 'identity', listed: true, sortable: true, help: 'Stable external identifier. Catalogue imports use "autopart.tn:<id>"; manual parts use "wp:<your-code>".' },
      { name: 'canonical_reference', label: 'Reference', type: 'text', required: true, maxLength: 64, section: 'identity', listed: true, sortable: true, help: 'Manufacturer reference, leading zeros preserved.' },
      { name: 'oem_reference', label: 'OEM reference', type: 'text', maxLength: 500, section: 'identity', listed: true },
      { name: 'pair_reference', label: 'Pair reference', type: 'text', maxLength: 64, section: 'identity' },
      { name: 'product_brand', label: 'Brand', type: 'text', required: true, maxLength: 128, section: 'product', listed: true, sortable: true },
      { name: 'product_title', label: 'Title', type: 'text', required: true, maxLength: 500, section: 'product', listed: true, sortable: true },
      { name: 'criteria_text', label: 'Description / criteria', type: 'textarea', maxLength: 4000, section: 'product' },
      { name: 'technical_specs', label: 'Technical specs (JSON)', type: 'json', section: 'product' },
      { name: 'source', label: 'Source', type: 'text', required: true, maxLength: 64, defaultValue: 'mythos-wp', section: 'identity', sortable: true },
      { name: 'product_url', label: 'Source URL', type: 'url', required: true, section: 'product', help: 'https:// only (schema constraint).' },
      { name: 'price_tnd', label: 'Catalogue price', type: 'number', required: true, min: 0.01, max: 999999.99, scale: 2, section: 'commercial', listed: true, sortable: true, help: 'The catalogue (market) price as collected. Not the customer price: set that in the Commercial layer.' },
      { name: 'currency', label: 'Currency', type: 'text', required: true, pattern: ISO3, maxLength: 3, defaultValue: 'TND', section: 'commercial' },
      { name: 'availability', label: 'Catalogue availability', type: 'enum', enum: AVAILABILITY_CATALOG, required: true, defaultValue: 'En Stock', section: 'commercial', listed: true, sortable: true },
      { name: 'delivery_note', label: 'Delivery note', type: 'text', maxLength: 500, section: 'commercial' },
      { name: 'status', label: 'Status', type: 'enum', enum: PRODUCT_STATUS, required: true, defaultValue: 'active', section: 'identity', listed: true, sortable: true },
      ts('collected_at', 'Collected at', { required: true, defaultValue: 'now', section: 'audit' }),
      ts('last_checked_at', 'Last checked at', { required: true, defaultValue: 'now', section: 'audit' }),
      CREATED, UPDATED
    ],
    check: function (v, existing) {
      var c = v.collected_at || (existing && existing.collected_at);
      var l = v.last_checked_at || (existing && existing.last_checked_at);
      if (c && l && new Date(l) < new Date(c)) return { last_checked_at: 'before_collected' };
      return null;
    },
    sections: { identity: 'Identity', product: 'Product', commercial: 'Commercial (catalogue)', audit: 'Audit' }
  },

  vehicle_models: {
    key: 'vehicle_models', label: 'Vehicle models', singular: 'Vehicle model', group: 'catalogue', icon: 'vehicle',
    scope: 'catalog', table: 'sya_vehicle_models', idColumn: 'id', titleField: 'model_name',
    permissions: { read: 'operator', write: 'operator', delete: 'owner' },
    delete: { kind: 'hard' },
    search: ['model_name', 'generation_code', 'brand_car'],
    defaultSort: { field: 'model_name', dir: 'asc' },
    filters: [{ name: 'brand_car', label: 'Vehicle brand', field: 'brand_car' }],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity', sortable: true },
      { name: 'brand_car', label: 'Vehicle brand', type: 'text', required: true, maxLength: 64, section: 'identity', listed: true, sortable: true },
      { name: 'model_name', label: 'Model', type: 'text', required: true, maxLength: 128, section: 'identity', listed: true, sortable: true },
      { name: 'generation_code', label: 'Generation', type: 'text', maxLength: 32, section: 'identity', listed: true },
      { name: 'year_from', label: 'Year from', type: 'integer', min: 1950, max: 2100, section: 'identity', listed: true, sortable: true },
      { name: 'year_to', label: 'Year to', type: 'integer', min: 1950, max: 2100, section: 'identity', listed: true, help: 'Empty = still in production.' },
      { name: 'source', label: 'Source', type: 'text', required: true, maxLength: 64, defaultValue: 'mythos-wp', section: 'audit' },
      { name: 'model_url', label: 'Source URL', type: 'url', required: true, section: 'audit' },
      ts('collected_at', 'Collected at', { required: true, defaultValue: 'now' }),
      CREATED
    ],
    check: function (v, e) {
      var f = v.year_from !== undefined ? v.year_from : (e && e.year_from);
      var t = v.year_to !== undefined ? v.year_to : (e && e.year_to);
      if (f && t && t < f) return { year_to: 'before_year_from' };
      return null;
    },
    sections: { identity: 'Vehicle', audit: 'Provenance' }
  },

  motorizations: {
    key: 'motorizations', label: 'Motorizations', singular: 'Motorization', group: 'catalogue', icon: 'engine',
    scope: 'catalog', table: 'sya_vehicle_motorizations', idColumn: 'id', titleField: 'motorisation',
    permissions: { read: 'operator', write: 'operator', delete: 'owner' },
    delete: { kind: 'hard' },
    joins: [{ alias: 'm', sql: 'LEFT JOIN sya_vehicle_models m ON m.id = t.vehicle_model_id' }],
    search: ['motorisation', 'fuel', 'm.model_name'],
    defaultSort: { field: 'model_name', dir: 'asc' },
    filters: [{ name: 'vehicle_model_id', label: 'Model', field: 'vehicle_model_id', ref: 'vehicle_models' }, { name: 'fuel', label: 'Fuel', field: 'fuel' }],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity', sortable: true },
      { name: 'model_name', label: 'Model', type: 'text', virtual: true, sql: 'm.model_name', listed: true, sortable: true },
      { name: 'vehicle_model_id', label: 'Vehicle model', type: 'integer', required: true, min: 1, ref: { resource: 'vehicle_models', display: 'model_name' }, section: 'identity' },
      { name: 'motorisation', label: 'Motorization', type: 'text', required: true, maxLength: 64, pattern: '^(?!\\d{4}-\\d{2}-\\d{2}).+', section: 'identity', listed: true, sortable: true },
      { name: 'power', label: 'Power', type: 'text', maxLength: 64, section: 'identity', listed: true },
      { name: 'fuel', label: 'Fuel', type: 'text', maxLength: 32, section: 'identity', listed: true },
      { name: 'year_from', label: 'Year from', type: 'integer', min: 1950, max: 2100, section: 'identity', listed: true },
      { name: 'year_to', label: 'Year to', type: 'integer', min: 1950, max: 2100, section: 'identity', listed: true },
      { name: 'motorisation_url', label: 'Source URL', type: 'url', required: true, section: 'audit' },
      ts('collected_at', 'Collected at', { required: true, defaultValue: 'now' }),
      CREATED
    ],
    sections: { identity: 'Motorization', audit: 'Provenance' }
  },

  compatibility: {
    key: 'compatibility', label: 'Compatibility', singular: 'Compatibility', group: 'catalogue', icon: 'link',
    scope: 'catalog', table: 'sya_product_vehicle_compatibility', idColumn: 'id', titleField: 'motorisation',
    permissions: { read: 'operator', write: 'operator', delete: 'owner' },
    delete: { kind: 'hard' },
    joins: [
      { alias: 'p', sql: 'LEFT JOIN sya_products p ON p.id = t.product_id' },
      { alias: 'm', sql: 'LEFT JOIN sya_vehicle_models m ON m.id = t.vehicle_model_id' }
    ],
    search: ['p.canonical_reference', 'p.product_title', 'm.model_name', 'motorisation'],
    defaultSort: { field: 'id', dir: 'desc' },
    filters: [
      { name: 'product_id', label: 'Part', field: 'product_id', ref: 'products' },
      { name: 'vehicle_model_id', label: 'Model', field: 'vehicle_model_id', ref: 'vehicle_models' }
    ],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity', sortable: true },
      { name: 'product_reference', label: 'Part reference', type: 'text', virtual: true, sql: 'p.canonical_reference', listed: true, sortable: true },
      { name: 'product_title', label: 'Part', type: 'text', virtual: true, sql: 'p.product_title', listed: true },
      { name: 'model_name', label: 'Model', type: 'text', virtual: true, sql: 'm.model_name', listed: true, sortable: true },
      { name: 'product_id', label: 'Part', type: 'integer', required: true, min: 1, ref: { resource: 'products', display: 'canonical_reference' }, section: 'identity' },
      { name: 'vehicle_model_id', label: 'Vehicle model', type: 'integer', required: true, min: 1, ref: { resource: 'vehicle_models', display: 'model_name' }, section: 'identity' },
      { name: 'vehicle_motorization_id', label: 'Motorization (resolved)', type: 'integer', min: 1, ref: { resource: 'motorizations', display: 'motorisation' }, section: 'identity' },
      { name: 'motorisation', label: 'Motorization label', type: 'text', required: true, maxLength: 64, pattern: '^(?!\\d{4}-\\d{2}-\\d{2}).+', section: 'identity', listed: true },
      { name: 'year_from', label: 'Year from', type: 'integer', min: 1950, max: 2100, section: 'identity', listed: true },
      { name: 'year_to', label: 'Year to', type: 'integer', min: 1950, max: 2100, section: 'identity', listed: true },
      { name: 'category_url', label: 'Evidence URL', type: 'url', required: true, section: 'audit' },
      CREATED
    ],
    sections: { identity: 'Fitment', audit: 'Provenance' }
  },

  images: {
    key: 'images', label: 'Media', singular: 'Image', group: 'catalogue', icon: 'image',
    scope: 'catalog', table: 'sya_product_images', idColumn: 'id', titleField: 'image_filename',
    permissions: { read: 'operator', write: 'operator', delete: 'operator' },
    delete: { kind: 'hard' },
    joins: [{ alias: 'p', sql: 'LEFT JOIN sya_products p ON p.id = t.product_id' }],
    search: ['p.canonical_reference', 'p.product_title', 'image_filename', 'image_alt'],
    defaultSort: { field: 'id', dir: 'desc' },
    filters: [{ name: 'product_id', label: 'Part', field: 'product_id', ref: 'products' }],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity', sortable: true },
      { name: 'product_reference', label: 'Part reference', type: 'text', virtual: true, sql: 'p.canonical_reference', listed: true, sortable: true },
      { name: 'product_id', label: 'Part', type: 'integer', required: true, min: 1, ref: { resource: 'products', display: 'canonical_reference' }, section: 'identity' },
      { name: 'image_url', label: 'Image URL', type: 'url', required: true, section: 'identity', listed: true, render: 'image' },
      { name: 'image_alt', label: 'Alt text', type: 'text', maxLength: 500, section: 'identity', listed: true },
      { name: 'image_filename', label: 'File name', type: 'text', maxLength: 255, section: 'identity' },
      { name: 'position', label: 'Position', type: 'integer', required: true, min: 1, max: 99, defaultValue: 1, section: 'identity', listed: true, sortable: true },
      CREATED
    ],
    sections: { identity: 'Image' }
  },

  // ------------------------------------------------------------------- panel
  commercial: {
    key: 'commercial', label: 'Commercial layer', singular: 'Commercial record', group: 'commercial', icon: 'price',
    scope: 'wp', table: 'wp_product_commercial', idColumn: 'id', uidColumn: 'product_uid', titleField: 'product_uid',
    permissions: { read: 'operator', write: 'operator', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now', updated_by: 'actor' },
    search: ['product_uid', 'price_note'],
    defaultSort: { field: 'updated_at', dir: 'desc' },
    filters: [{ name: 'missing_selling', label: 'No selling price', kind: 'flag', sql: '(t.selling_price IS NULL)' }],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity' },
      { name: 'product_uid', label: 'Part UID', type: 'text', required: true, maxLength: 64, pattern: UID_PATTERN, createOnly: true, section: 'identity', listed: true, sortable: true, ref: { resource: 'products', display: 'product_uid', by: 'product_uid' } },
      { name: 'purchase_price', label: 'Purchase price', type: 'number', min: 0, max: 99999999.99, scale: 2, section: 'commercial', listed: true, sortable: true },
      { name: 'selling_price', label: 'Selling price', type: 'number', min: 0.01, max: 99999999.99, scale: 2, section: 'commercial', listed: true, sortable: true, help: 'The VERIFIED customer price. Empty = unknown: the auto-reply hands price questions to a human.' },
      { name: 'currency', label: 'Currency', type: 'text', required: true, pattern: ISO3, maxLength: 3, defaultValue: 'TND', section: 'commercial', listed: true },
      { name: 'price_note', label: 'Note', type: 'textarea', maxLength: 2000, section: 'commercial' },
      UPDATED_BY, CREATED, UPDATED
    ],
    sections: { identity: 'Part', commercial: 'Prices', audit: 'Audit' }
  },

  stock: {
    key: 'stock', label: 'Stock', singular: 'Stock record', group: 'commercial', icon: 'stock',
    scope: 'wp', table: 'wp_stock', idColumn: 'id', uidColumn: 'product_uid', titleField: 'product_uid',
    permissions: { read: 'operator', write: 'operator', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now', updated_by: 'actor' },
    search: ['product_uid', 'location', 'note'],
    defaultSort: { field: 'updated_at', dir: 'desc' },
    filters: [
      { name: 'availability', label: 'Availability', field: 'availability', enum: ['in_stock', 'on_order', 'unavailable', 'unknown'] },
      { name: 'low', label: 'Low stock', kind: 'flag', sql: "(t.quantity <= t.min_quantity AND t.availability <> 'unavailable')" }
    ],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity' },
      { name: 'product_uid', label: 'Part UID', type: 'text', required: true, maxLength: 64, pattern: UID_PATTERN, createOnly: true, section: 'identity', listed: true, sortable: true, ref: { resource: 'products', display: 'product_uid', by: 'product_uid' } },
      { name: 'quantity', label: 'Quantity', type: 'integer', required: true, min: 0, max: 1000000, defaultValue: 0, section: 'stock', listed: true, sortable: true },
      { name: 'min_quantity', label: 'Minimum', type: 'integer', required: true, min: 0, max: 1000000, defaultValue: 0, section: 'stock', listed: true },
      { name: 'availability', label: 'Availability', type: 'enum', enum: ['in_stock', 'on_order', 'unavailable', 'unknown'], required: true, defaultValue: 'unknown', section: 'stock', listed: true, sortable: true, help: '"unknown" is never quoted to a customer.' },
      { name: 'location', label: 'Location', type: 'text', maxLength: 128, section: 'stock', listed: true },
      { name: 'lead_time_days', label: 'Lead time (days)', type: 'integer', min: 0, max: 365, section: 'stock' },
      { name: 'note', label: 'Note', type: 'textarea', maxLength: 2000, section: 'stock' },
      UPDATED_BY, CREATED, UPDATED
    ],
    sections: { identity: 'Part', stock: 'Stock', audit: 'Audit' }
  },

  knowledge: {
    key: 'knowledge', label: 'Auto-Reply knowledge', singular: 'Knowledge entry', group: 'auto', icon: 'knowledge',
    scope: 'wp', table: 'wp_knowledge', idColumn: 'id', titleField: 'title',
    permissions: { read: 'operator', write: 'operator', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now', updated_by: 'actor' },
    search: ['title', 'customer_text', 'product_uid'],
    defaultSort: { field: 'updated_at', dir: 'desc' },
    filters: [
      { name: 'kind', label: 'Kind', field: 'kind', enum: ['product_fact', 'faq', 'policy', 'vehicle_note'] },
      { name: 'status', label: 'Status', field: 'status', enum: ['draft', 'active', 'archived'] },
      { name: 'allowed_for_auto_reply', label: 'Allowed for auto-reply', field: 'allowed_for_auto_reply', enum: ['true', 'false'], boolean: true }
    ],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity' },
      { name: 'kind', label: 'Kind', type: 'enum', enum: ['product_fact', 'faq', 'policy', 'vehicle_note'], required: true, defaultValue: 'faq', section: 'identity', listed: true, sortable: true },
      { name: 'title', label: 'Title', type: 'text', required: true, maxLength: 200, section: 'identity', listed: true, sortable: true },
      { name: 'product_uid', label: 'Part UID (optional)', type: 'text', maxLength: 64, pattern: UID_PATTERN, section: 'identity', listed: true, ref: { resource: 'products', display: 'product_uid', by: 'product_uid' } },
      { name: 'language', label: 'Language', type: 'enum', enum: ['fr', 'ar', 'en'], required: true, defaultValue: 'fr', section: 'identity', listed: true },
      { name: 'customer_text', label: 'Customer-facing text', type: 'textarea', required: true, maxLength: 4000, section: 'content', help: 'Only what may be sent verbatim to a customer. No price, stock or compatibility claims unless they are verified in the data layers.' },
      { name: 'allowed_for_auto_reply', label: 'Allowed for auto-reply', type: 'boolean', required: true, defaultValue: false, section: 'content', listed: true, sortable: true },
      { name: 'status', label: 'Status', type: 'enum', enum: ['draft', 'active', 'archived'], required: true, defaultValue: 'draft', section: 'content', listed: true, sortable: true },
      { name: 'tags', label: 'Tags', type: 'tags', section: 'content' },
      UPDATED_BY, CREATED, UPDATED
    ],
    sections: { identity: 'Entry', content: 'Content', audit: 'Audit' }
  },

  rules: {
    key: 'rules', label: 'Business rules', singular: 'Business rule', group: 'settings', icon: 'rule',
    scope: 'wp', table: 'wp_business_rules', idColumn: 'id', titleField: 'rule_key',
    permissions: { read: 'operator', write: 'owner', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now', updated_by: 'actor' },
    search: ['rule_key', 'description'],
    defaultSort: { field: 'rule_key', dir: 'asc' },
    filters: [{ name: 'enabled', label: 'Enabled', field: 'enabled', enum: ['true', 'false'], boolean: true }],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity' },
      { name: 'rule_key', label: 'Key', type: 'text', required: true, maxLength: 64, pattern: '^[a-z][a-z0-9_]{1,62}$', createOnly: true, section: 'identity', listed: true, sortable: true },
      { name: 'description', label: 'Description', type: 'text', maxLength: 500, section: 'identity', listed: true },
      { name: 'value_json', label: 'Value (JSON)', type: 'json', required: true, defaultValue: {}, section: 'identity' },
      { name: 'enabled', label: 'Enabled', type: 'boolean', required: true, defaultValue: true, section: 'identity', listed: true },
      UPDATED_BY, CREATED, UPDATED
    ],
    sections: { identity: 'Rule', audit: 'Audit' }
  },

  handoffs: {
    key: 'handoffs', label: 'Human handoff', singular: 'Handoff', group: 'auto', icon: 'handoff',
    scope: 'wp', table: 'wp_handoffs', idColumn: 'id', titleField: 'reason',
    permissions: { read: 'operator', write: 'operator', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now' },
    search: ['reason', 'intent', 'customer_ref_masked', 'notes', 'related_product_uid'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    filters: [
      { name: 'status', label: 'Status', field: 'status', enum: ['NEW', 'REQUIRES_HUMAN', 'IN_PROGRESS', 'RESOLVED'] },
      { name: 'intent', label: 'Intent', field: 'intent' }
    ],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'conversation', listed: true, sortable: true },
      { name: 'status', label: 'Status', type: 'enum', enum: ['NEW', 'REQUIRES_HUMAN', 'IN_PROGRESS', 'RESOLVED'], required: true, defaultValue: 'NEW', section: 'resolution', listed: true, sortable: true },
      { name: 'channel', label: 'Channel', type: 'text', required: true, maxLength: 24, defaultValue: 'whatsapp', section: 'conversation', listed: true },
      { name: 'customer_ref_masked', label: 'Customer (masked)', type: 'text', maxLength: 32, pattern: '^\\*{3}[0-9]{1,6}$', section: 'conversation', listed: true, help: 'Only the masked form the engine records: *** + last digits.' },
      { name: 'reason', label: 'Reason', type: 'text', required: true, maxLength: 64, pattern: '^[A-Z][A-Z0-9_:]{2,63}$', defaultValue: 'REQUIRES_HUMAN', section: 'conversation', listed: true, sortable: true },
      { name: 'intent', label: 'Detected intent', type: 'text', maxLength: 40, section: 'conversation', listed: true },
      { name: 'language', label: 'Language', type: 'enum', enum: ['fr', 'ar', 'en'], section: 'conversation' },
      { name: 'entities', label: 'What the customer wrote (entities)', type: 'json', section: 'conversation' },
      { name: 'facts', label: 'Facts required / available / missing', type: 'json', section: 'conversation' },
      { name: 'related_product_uid', label: 'Related part UID', type: 'text', maxLength: 64, pattern: UID_PATTERN, section: 'resolution', listed: true, ref: { resource: 'products', display: 'product_uid', by: 'product_uid' } },
      { name: 'suggested', label: 'Suggested information', type: 'json', section: 'resolution' },
      { name: 'assigned_to', label: 'Assigned to', type: 'text', maxLength: 64, section: 'resolution', listed: true },
      { name: 'notes', label: 'Notes', type: 'textarea', maxLength: 4000, section: 'resolution' },
      { name: 'resolution', label: 'Resolution', type: 'textarea', maxLength: 4000, section: 'resolution' },
      { name: 'event_id', label: 'Engine event', type: 'text', readonly: true, section: 'conversation' },
      { name: 'conversation_key', label: 'Conversation key', type: 'text', readonly: true, section: 'conversation' },
      { name: 'resolved_by', label: 'Resolved by', type: 'text', readonly: true, section: 'resolution' },
      ts('resolved_at', 'Resolved at', { readonly: true, section: 'resolution' }),
      CREATED, UPDATED
    ],
    sections: { conversation: 'Conversation', resolution: 'Resolution', audit: 'Audit' }
  },

  inboxes: {
    key: 'inboxes', label: 'WhatsApp inboxes', singular: 'Inbox', group: 'whatsapp', icon: 'auto',
    scope: 'wp', table: 'wp_inboxes', idColumn: 'id', titleField: 'display_name',
    permissions: { read: 'operator', write: 'owner', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now' },
    search: ['instance', 'display_name'],
    defaultSort: { field: 'created_at', dir: 'asc' },
    filters: [
      { name: 'status', label: 'Status', field: 'status', enum: ['inactive', 'pairing', 'open', 'closed', 'error'] },
      { name: 'provider', label: 'Provider', field: 'provider', enum: ['evolution', 'meta_cloud'] }
    ],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity', listed: true, sortable: true },
      { name: 'provider', label: 'Provider', type: 'enum', enum: ['evolution', 'meta_cloud'], required: true, defaultValue: 'evolution', createOnly: true, section: 'identity', listed: true },
      { name: 'instance', label: 'Provider instance', type: 'text', required: true, maxLength: 64, pattern: '^(?!mythos-bridge$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', createOnly: true, section: 'identity', listed: true, sortable: true, help: 'Evolution instance name. mythos-bridge is the notification instance and can never be an inbox.' },
      { name: 'display_name', label: 'Name', type: 'text', required: true, maxLength: 120, section: 'identity', listed: true, sortable: true },
      { name: 'account_ref', label: 'WhatsApp account (digits)', type: 'text', maxLength: 32, pattern: '^[0-9]{6,32}$', section: 'identity', help: 'The business number this inbox is linked to. One account per inbox; the MYTHOS notification account is reserved and always refused.' },
      { name: 'phone_masked', label: 'Business number (masked)', type: 'text', maxLength: 32, pattern: '^\\*{3}[0-9]{1,6}$', section: 'identity', listed: true, help: 'Display only: *** + last digits.' },
      { name: 'status', label: 'Status', type: 'enum', enum: ['inactive', 'pairing', 'open', 'closed', 'error'], readonly: true, section: 'state', listed: true, sortable: true, help: 'Set by the receiver from connection.update events.' },
      { name: 'inbound_enabled', label: 'Persist inbound messages', type: 'boolean', defaultValue: false, section: 'state', listed: true, help: 'Off = dry-run: deliveries are validated and ledgered, nothing is stored.' },
      { name: 'outbound_enabled', label: 'Allow human replies', type: 'boolean', defaultValue: false, section: 'state', listed: true },
      { name: 'last_event_at', label: 'Last event', type: 'timestamp', readonly: true, section: 'state', listed: true },
      { name: 'last_error', label: 'Last error', type: 'text', readonly: true, section: 'state' },
      { name: 'settings', label: 'Settings (non-secret)', type: 'json', section: 'state', help: 'Known keys (booleans): ai_suggest — run the assistant on every inbound; auto_reply — allow policy-gated automatic replies (COMMS-9); allow_personal_account — this inbox may share a WhatsApp account already used by another inbox (personal / internal accounts only).' },
      CREATED, UPDATED
    ],
    check: function (v, existing) {
      var errs = {};
      var st = v.settings !== undefined ? v.settings : existing && existing.settings;
      if (st !== undefined && st !== null) {
        if (typeof st !== 'object' || Array.isArray(st)) errs.settings = 'settings must be an object';
        else ['ai_suggest', 'auto_reply', 'allow_personal_account'].forEach(function (k) { if (st[k] !== undefined && typeof st[k] !== 'boolean') errs.settings = k + ' must be true or false'; });
      }
      if (v.account_ref !== undefined && v.account_ref !== null && v.phone_masked === undefined && !(existing && existing.phone_masked)) { /* derive display */ }
      return errs;
    },
    sections: { identity: 'Inbox', state: 'State and switches', audit: 'Audit' }
  },
  inbox_members: {
    key: 'inbox_members', label: 'Inbox members', singular: 'Member', group: 'whatsapp', icon: 'project',
    scope: 'wp', table: 'wp_inbox_members', idColumn: 'id', titleField: 'username', global: true,
    permissions: { read: 'operator', write: 'owner', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now', added_by: 'actor' },
    search: ['username', 'team'],
    defaultSort: { field: 'created_at', dir: 'asc' },
    filters: [{ name: 'role', label: 'Role', field: 'role', enum: ['agent', 'lead', 'viewer'] }],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, listed: true, sortable: true },
      { name: 'inbox_id', label: 'Inbox', type: 'integer', required: true, createOnly: true, listed: true, ref: { resource: 'inboxes', display: 'display_name' } },
      { name: 'username', label: 'Username', type: 'text', required: true, maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]{1,63}$', createOnly: true, listed: true, sortable: true, help: 'Panel account name (users file).' },
      { name: 'role', label: 'Role', type: 'enum', enum: ['agent', 'lead', 'viewer'], required: true, defaultValue: 'agent', listed: true, help: 'agent handles conversations; lead also assigns; viewer reads only. A user with at least one membership sees only member inboxes.' },
      { name: 'team', label: 'Team', type: 'text', maxLength: 64, listed: true },
      { name: 'added_by', label: 'Added by', type: 'text', readonly: true, section: 'audit' },
      CREATED, UPDATED
    ],
    sections: { }
  },
  audit: {
    key: 'audit', label: 'Audit log', singular: 'Audit event', group: 'system', icon: 'audit',
    scope: 'wp', table: 'wp_audit_events', idColumn: 'id', titleField: 'action', projectOptional: true,
    permissions: { read: 'operator' },
    search: ['actor', 'resource', 'record_id', 'action'],
    defaultSort: { field: 'at', dir: 'desc' },
    filters: [
      { name: 'action', label: 'Action', field: 'action' },
      { name: 'resource', label: 'Resource', field: 'resource' },
      { name: 'actor', label: 'Actor', field: 'actor' },
      { name: 'record_id', label: 'Record', field: 'record_id' }
    ],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, sortable: true },
      ts('at', 'When', { readonly: true, listed: true, sortable: true }),
      { name: 'actor', label: 'Actor', type: 'text', readonly: true, listed: true, sortable: true },
      { name: 'actor_role', label: 'Role', type: 'text', readonly: true, listed: true },
      { name: 'action', label: 'Action', type: 'text', readonly: true, listed: true, sortable: true },
      { name: 'resource', label: 'Resource', type: 'text', readonly: true, listed: true, sortable: true },
      { name: 'record_id', label: 'Record', type: 'text', readonly: true, listed: true },
      { name: 'project_id', label: 'Project', type: 'text', readonly: true, listed: true },
      { name: 'changed_fields', label: 'Changed fields', type: 'tags', readonly: true, listed: true },
      { name: 'previous', label: 'Previous', type: 'json', readonly: true },
      { name: 'next', label: 'New', type: 'json', readonly: true },
      { name: 'request_id', label: 'Request', type: 'text', readonly: true },
      { name: 'client', label: 'Client', type: 'text', readonly: true }
    ],
    sections: { }
  },

  projects: {
    key: 'projects', label: 'Projects', singular: 'Project', group: 'projects', icon: 'project', global: true,
    scope: 'wp', table: 'wp_projects', idColumn: 'id', idType: 'text', titleField: 'display_name',
    permissions: { read: 'operator', write: 'owner', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now' },
    search: ['id', 'display_name', 'domain'],
    defaultSort: { field: 'id', dir: 'asc' },
    filters: [{ name: 'status', label: 'Status', field: 'status', enum: ['active', 'planned', 'archived'] }],
    fields: [
      { name: 'id', label: 'Project ID', type: 'text', required: true, maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]{1,62}$', createOnly: true, section: 'identity', listed: true, sortable: true, help: 'Must equal the project id in the MYTHOS AUTO comms configuration (e.g. ssangyong-autos).' },
      { name: 'display_name', label: 'Name', type: 'text', required: true, maxLength: 128, section: 'identity', listed: true, sortable: true },
      { name: 'domain', label: 'Domain', type: 'text', maxLength: 128, section: 'identity', listed: true },
      { name: 'brand_car', label: 'Vehicle brand', type: 'text', maxLength: 64, section: 'identity', listed: true },
      { name: 'kind', label: 'Kind', type: 'enum', enum: ['automotive', 'service', 'internal'], required: true, defaultValue: 'service', section: 'identity', listed: true, sortable: true, help: 'automotive = parts catalogue project (catalogue connection required); service = any customer-facing service (Dar Hijama…); internal = MYTHOS itself.' },
      { name: 'status', label: 'Status', type: 'enum', enum: ['active', 'planned', 'archived'], required: true, defaultValue: 'planned', section: 'identity', listed: true, sortable: true },
      { name: 'currency', label: 'Currency', type: 'text', required: true, pattern: ISO3, maxLength: 3, defaultValue: 'TND', section: 'identity' },
      { name: 'catalog_dsn_env', label: 'Catalogue connection (env var NAME)', type: 'text', maxLength: 64, pattern: '^[A-Z][A-Z0-9_]{2,62}$', section: 'catalog', listed: true, help: 'Name of the environment variable holding the catalogue URL — never the value.' },
      { name: 'catalog_schema', label: 'Catalogue schema', type: 'text', maxLength: 64, pattern: '^[a-z_][a-z0-9_]{0,62}$', section: 'catalog', help: 'Required for automotive projects only.' },
      { name: 'notes', label: 'Notes', type: 'textarea', maxLength: 4000, section: 'identity' },
      CREATED, UPDATED
    ],
    check: function (v, existing) {
      var kind = v.kind !== undefined ? v.kind : (existing && existing.kind) || 'automotive';
      var env = v.catalog_dsn_env !== undefined ? v.catalog_dsn_env : existing && existing.catalog_dsn_env;
      var schema = v.catalog_schema !== undefined ? v.catalog_schema : existing && existing.catalog_schema;
      var errs = {};
      if (kind === 'automotive' && !env) errs.catalog_dsn_env = 'an automotive project needs its catalogue connection';
      if (kind === 'automotive' && !schema) errs.catalog_schema = 'an automotive project needs its catalogue schema';
      return errs;
    },
    sections: { identity: 'Project', catalog: 'Catalogue connection (automotive only)', audit: 'Audit' }
  }
};

var GROUPS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'auto', label: 'MYTHOS AUTO' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'projects', label: 'Projects' },
  { key: 'system', label: 'System' },
  { key: 'settings', label: 'Settings' }
];

function get(key) { return Object.prototype.hasOwnProperty.call(RESOURCES, key) ? RESOURCES[key] : null; }
function keys() { return Object.keys(RESOURCES); }

// What the browser receives: everything except SQL fragments and hooks.
function publicShape(r) {
  return {
    key: r.key, label: r.label, singular: r.singular, group: r.group, icon: r.icon, scope: r.scope, global: !!r.global,
    projectOptional: !!r.projectOptional,
    idColumn: r.idColumn, idType: r.idType || 'integer', uidColumn: r.uidColumn || null, titleField: r.titleField,
    permissions: r.permissions,
    delete: r.delete ? { kind: r.delete.kind, label: r.delete.label || 'Delete' } : null,
    search: r.search.map(function (s) { return s.replace(/^[a-z]+\./, ''); }),
    defaultSort: r.defaultSort,
    filters: r.filters.map(function (f) { return { name: f.name, label: f.label, enum: f.enum || null, kind: f.kind || 'value', ref: f.ref || null, boolean: !!f.boolean }; }),
    fields: r.fields.map(function (f) {
      var o = {};
      Object.keys(f).forEach(function (k) { if (k !== 'sql') o[k] = f[k]; });
      return o;
    }),
    sections: r.sections
  };
}

function publicAll() {
  var out = {};
  keys().forEach(function (k) { out[k] = publicShape(RESOURCES[k]); });
  return out;
}

module.exports = { RESOURCES: RESOURCES, GROUPS: GROUPS, get: get, keys: keys, publicShape: publicShape, publicAll: publicAll };
