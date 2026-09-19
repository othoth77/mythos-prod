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
// One scope since V2: every resource lives in mythos_wp (`wp`) and carries
// project_id unless it is `global`. Product / vehicle / price / stock data is
// NOT a resource any more: it belongs to the connected Kitchen (kitchen.js),
// read through the project's Kitchen API and never copied here.
//
// Field flags:  required · readonly (server-managed, refused on write) ·
// virtual (joined display column, list-only) · listed (default table
// column) · sortable · section (editor grouping) · ref (foreign key →
// { resource, display }) · createOnly (immutable after create) · hidden
// (never returned by the API nor written to the audit log — password hashes).
//
// Permissions are ROLE NAMES (auth.hasRole): viewer < agent < manager <
// admin < owner. A resource without `write` is read-only for everyone.
// =====================================================

var UID_PATTERN = '^[A-Za-z0-9._:-]{1,64}$';
var ISO3 = '^[A-Z]{3}$';

function ts(name, label, extra) {
  return Object.assign({ name: name, label: label, type: 'timestamp', section: 'audit' }, extra || {});
}
var CREATED = ts('created_at', 'Created', { readonly: true, sortable: true });
var UPDATED = ts('updated_at', 'Updated', { readonly: true, sortable: true, listed: true });
var UPDATED_BY = { name: 'updated_by', label: 'Updated by', type: 'text', readonly: true, section: 'audit' };

var RESOURCES = {

  knowledge: {
    key: 'knowledge', label: 'AI knowledge', singular: 'Knowledge entry', group: 'ai', icon: 'knowledge',
    scope: 'wp', table: 'wp_knowledge', idColumn: 'id', titleField: 'title',
    permissions: { read: 'agent', write: 'manager', delete: 'admin' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now', updated_by: 'actor' },
    search: ['title', 'customer_text', 'product_uid'],
    defaultSort: { field: 'updated_at', dir: 'desc' },
    filters: [
      { name: 'kind', label: 'Kind', field: 'kind', enum: ['product_fact', 'faq', 'policy', 'vehicle_note'] },
      { name: 'status', label: 'Status', field: 'status', enum: ['draft', 'active', 'archived'] },
      { name: 'allowed_for_auto_reply', label: 'Allowed for AI replies', field: 'allowed_for_auto_reply', enum: ['true', 'false'], boolean: true }
    ],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, section: 'identity' },
      { name: 'kind', label: 'Kind', type: 'enum', enum: ['product_fact', 'faq', 'policy', 'vehicle_note'], required: true, defaultValue: 'faq', section: 'identity', listed: true, sortable: true },
      { name: 'title', label: 'Title', type: 'text', required: true, maxLength: 200, section: 'identity', listed: true, sortable: true },
      { name: 'product_uid', label: 'Product UID (optional)', type: 'text', maxLength: 64, pattern: UID_PATTERN, section: 'identity', listed: true, help: 'A Kitchen product uid (e.g. autopart.tn:18469) when the entry is about one product.' },
      { name: 'language', label: 'Language', type: 'enum', enum: ['fr', 'ar', 'en'], required: true, defaultValue: 'fr', section: 'identity', listed: true },
      { name: 'customer_text', label: 'Customer-facing text', type: 'textarea', required: true, maxLength: 4000, section: 'content', help: 'Only what may be sent verbatim to a customer. No price, stock or compatibility claims: those come from the connected Kitchen.' },
      { name: 'allowed_for_auto_reply', label: 'Allowed for AI replies', type: 'boolean', required: true, defaultValue: false, section: 'content', listed: true, sortable: true },
      { name: 'status', label: 'Status', type: 'enum', enum: ['draft', 'active', 'archived'], required: true, defaultValue: 'draft', section: 'content', listed: true, sortable: true },
      { name: 'tags', label: 'Tags', type: 'tags', section: 'content' },
      UPDATED_BY, CREATED, UPDATED
    ],
    sections: { identity: 'Entry', content: 'Content', audit: 'Audit' }
  },

  rules: {
    key: 'rules', label: 'Business rules', singular: 'Business rule', group: 'settings', icon: 'rule',
    scope: 'wp', table: 'wp_business_rules', idColumn: 'id', titleField: 'rule_key',
    permissions: { read: 'manager', write: 'admin', delete: 'admin' },
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
    key: 'handoffs', label: 'Human handoff', singular: 'Handoff', group: 'ai', icon: 'handoff',
    scope: 'wp', table: 'wp_handoffs', idColumn: 'id', titleField: 'reason',
    permissions: { read: 'agent', write: 'agent', delete: 'admin' },
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
      { name: 'related_product_uid', label: 'Related product UID', type: 'text', maxLength: 64, pattern: UID_PATTERN, section: 'resolution', listed: true },
      { name: 'direction', label: 'Direction', type: 'enum', enum: ['ai_to_human', 'human_to_ai'], required: true, defaultValue: 'ai_to_human', section: 'conversation', listed: true, sortable: true },
      { name: 'taken_by', label: 'Taken by', type: 'text', readonly: true, section: 'resolution', listed: true },
      ts('taken_at', 'Taken at', { readonly: true, section: 'resolution' }),
      { name: 'previous_state', label: 'Previous AI state', type: 'json', readonly: true, section: 'conversation' },
      { name: 'conversation_id', label: 'Conversation', type: 'integer', readonly: true, section: 'conversation', listed: true },
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
    key: 'inboxes', label: 'Number ↔ project links', singular: 'Inbox link', group: 'whatsapp', icon: 'auto',
    scope: 'wp', table: 'wp_inboxes', idColumn: 'id', titleField: 'display_name',
    permissions: { read: 'agent', write: 'admin', delete: 'admin' },
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
      { name: 'phone_number_id', label: 'Phone number', type: 'integer', min: 1, section: 'identity', listed: true, help: 'The wp_phone_numbers row this link belongs to (WhatsApp → Numbers).' },
      { name: 'account_mode', label: 'Account mode', type: 'enum', enum: ['dedicated', 'shared'], required: true, defaultValue: 'dedicated', createOnly: true, section: 'identity', listed: true, help: 'shared = the same number serves several projects; routing rules decide the project.' },
      { name: 'ai_mode', label: 'AI mode', type: 'enum', enum: ['inherit', 'off', 'suggest', 'auto'], required: true, defaultValue: 'inherit', section: 'state', listed: true, help: 'inherit = the bound agent decides; off wins over everything.' },
      { name: 'account_ref', label: 'WhatsApp account (digits)', type: 'text', maxLength: 32, pattern: '^[0-9]{6,32}$', readRole: 'admin', section: 'identity', help: 'Digits of the business number. A reserved (notification) account is accepted only in shared mode with the explicit personal-account opt-in.' },
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
        if (!errs.settings && require('./audit').hasSecretKey(st)) errs.settings = 'settings must not carry a credential';
        // the personal-account sharing opt-in is an audited decision taken when the link is created
        // (comms/numbers.link → routing.createSharedInbox); it is never toggled through this form.
        if (!errs.settings && v.settings !== undefined && existing && st && st.allow_personal_account !== (existing.settings || {}).allow_personal_account) errs.settings = 'allow_personal_account is set when the number is linked to the project, not here';
      }
      if (v.account_ref !== undefined && v.account_ref !== null && v.phone_masked === undefined && !(existing && existing.phone_masked)) { /* derive display */ }
      return errs;
    },
    sections: { identity: 'Inbox', state: 'State and switches', audit: 'Audit' }
  },
  inbox_members: {
    key: 'inbox_members', label: 'Inbox members', singular: 'Member', group: 'whatsapp', icon: 'project',
    scope: 'wp', table: 'wp_inbox_members', idColumn: 'id', titleField: 'username', global: true,
    permissions: { read: 'manager', write: 'admin', delete: 'admin' },
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
    permissions: { read: 'manager' },
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
    permissions: { read: 'viewer', write: 'admin', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now' },
    search: ['id', 'display_name', 'domain', 'description'],
    defaultSort: { field: 'id', dir: 'asc' },
    filters: [{ name: 'status', label: 'Status', field: 'status', enum: ['active', 'planned', 'archived'] }],
    fields: [
      { name: 'id', label: 'Project ID', type: 'text', required: true, maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]{1,62}$', createOnly: true, section: 'identity', listed: true, sortable: true, help: 'Stable slug used everywhere (routing, agents, audit). Lowercase, digits and dashes.' },
      { name: 'display_name', label: 'Name', type: 'text', required: true, maxLength: 128, section: 'identity', listed: true, sortable: true },
      { name: 'domain', label: 'Domain', type: 'text', maxLength: 128, section: 'identity', listed: true },
      { name: 'brand_car', label: 'Vehicle brand', type: 'text', maxLength: 64, section: 'identity', help: 'Auto projects only.' },
      { name: 'kind', label: 'Kind', type: 'enum', enum: ['automotive', 'service', 'internal', 'other'], required: true, defaultValue: 'service', section: 'identity', listed: true, sortable: true, help: 'automotive = reads a Kitchen (parts, vehicles, prices); service = any customer-facing service (Dar Hijama…); internal = MYTHOS itself.' },
      { name: 'description', label: 'Description', type: 'textarea', maxLength: 4000, section: 'identity' },
      { name: 'settings', label: 'Advanced settings (JSON, non-secret)', type: 'json', defaultValue: {}, section: 'advanced', help: 'Known keys: kitchen (integration key, e.g. kitchen-mythos-auto), ai_mode (off|suggest|auto|inherit), timezone.' },
      { name: 'status', label: 'Status', type: 'enum', enum: ['active', 'planned', 'archived'], required: true, defaultValue: 'planned', section: 'identity', listed: true, sortable: true },
      { name: 'currency', label: 'Currency', type: 'text', required: true, pattern: ISO3, maxLength: 3, defaultValue: 'TND', section: 'identity' },
      { name: 'catalog_dsn_env', label: 'catalog_dsn_env', type: 'text', maxLength: 64, pattern: '^[A-Z][A-Z0-9_]{2,62}$', hidden: true, readonly: true },
      { name: 'catalog_schema', label: 'catalog_schema', type: 'text', maxLength: 64, pattern: '^[a-z_][a-z0-9_]{0,62}$', hidden: true, readonly: true },
      { name: 'notes', label: 'Internal notes', type: 'textarea', maxLength: 4000, section: 'advanced' },
      CREATED, UPDATED
    ],
    check: function (v, existing) {
      var st = v.settings !== undefined ? v.settings : existing && existing.settings;
      var errs = {};
      if (st !== undefined && st !== null && (typeof st !== 'object' || Array.isArray(st))) errs.settings = 'settings must be an object';
      else if (st && require('./audit').hasSecretKey(st)) errs.settings = 'settings must not carry a credential (reference secrets by env NAME)';
      if (st && st.kitchen !== undefined && st.kitchen !== null && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(st.kitchen))) errs.settings = 'settings.kitchen must be an integration key';
      return errs;
    },
    sections: { identity: 'Project', advanced: 'Advanced', audit: 'Audit' }
  },
  users: {
    key: 'users', label: 'Users', singular: 'User', group: 'settings', icon: 'project', global: true,
    scope: 'wp', table: 'wp_users', idColumn: 'username', idType: 'text', titleField: 'username',
    permissions: { read: 'admin', write: 'admin', delete: 'owner' },
    delete: { kind: 'hard' },
    managed: { updated_at: 'now' },
    search: ['username', 'display_name'],
    defaultSort: { field: 'username', dir: 'asc' },
    filters: [{ name: 'role', label: 'Role', field: 'role', enum: ['owner', 'admin', 'manager', 'agent', 'viewer'] }, { name: 'status', label: 'Status', field: 'status', enum: ['active', 'disabled'] }],
    fields: [
      { name: 'username', label: 'Username', type: 'text', required: true, maxLength: 32, pattern: '^[a-z][a-z0-9._-]{1,31}$', createOnly: true, listed: true, sortable: true },
      { name: 'display_name', label: 'Display name', type: 'text', maxLength: 120, listed: true },
      { name: 'role', label: 'Role', type: 'enum', enum: ['owner', 'admin', 'manager', 'agent', 'viewer'], required: true, defaultValue: 'agent', listed: true, sortable: true, help: 'owner: everything · admin: configuration (WhatsApp, AI, integrations) · manager: operations + templates + health runs · agent: conversations, contacts, notes · viewer: read-only.' },
      { name: 'status', label: 'Status', type: 'enum', enum: ['active', 'disabled'], required: true, defaultValue: 'active', listed: true },
      { name: 'all_projects', label: 'Access to every project', type: 'boolean', required: true, defaultValue: false, listed: true, help: 'Off = only the projects granted in the project-access list. owner/admin always see everything.' },
      { name: 'scrypt', label: 'Password hash', type: 'text', hidden: true, readonly: true },
      ts('last_login_at', 'Last login', { readonly: true, listed: true, sortable: true }),
      { name: 'created_by', label: 'Created by', type: 'text', readonly: true, section: 'audit' },
      CREATED, UPDATED
    ],
    sections: { }
  },
  tags: {
    key: 'tags', label: 'Tags', singular: 'Tag', group: 'settings', icon: 'rule',
    scope: 'wp', table: 'wp_tags', idColumn: 'id', titleField: 'name',
    permissions: { read: 'agent', write: 'manager', delete: 'manager' },
    delete: { kind: 'hard' },
    search: ['name'],
    defaultSort: { field: 'name', dir: 'asc' },
    filters: [{ name: 'applies_to', label: 'Applies to', field: 'applies_to', enum: ['contact', 'conversation', 'both'] }],
    fields: [
      { name: 'id', label: 'ID', type: 'integer', readonly: true, sortable: true },
      { name: 'name', label: 'Name', type: 'text', required: true, maxLength: 48, pattern: '^[a-z0-9][a-z0-9_.-]{0,47}$', listed: true, sortable: true, help: 'Examples: new-lead, vip, price-request, order, complaint, human-required, hot-lead, follow-up.' },
      { name: 'color', label: 'Colour', type: 'text', maxLength: 7, pattern: '^#[0-9a-fA-F]{6}$', listed: true },
      { name: 'applies_to', label: 'Applies to', type: 'enum', enum: ['contact', 'conversation', 'both'], required: true, defaultValue: 'both', listed: true },
      CREATED
    ],
    sections: { }
  }
};

var GROUPS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'ai', label: 'AI' },
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
    fields: r.fields.filter(function (f) { return !f.hidden; }).map(function (f) {
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
