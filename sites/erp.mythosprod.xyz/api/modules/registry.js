'use strict';

/* Module definitions.
 *
 * Each entry declares the table, the columns the API may read, the fields it
 * may write, and how it is searched and sorted. Everything else — tenant
 * isolation, authorization, audit, soft delete, pagination — comes from
 * lib/resource.js, so a new module cannot forget them.
 *
 * The column lists are also the API's output contract: a column absent here is
 * not returned, which is how internal fields stay internal by default rather
 * than by remembering to strip them.
 */

var BASE = ['id', 'created_at', 'updated_at'];

function def(o) {
  return {
    table: o.table,
    module: o.module,
    label: o.label || 'name',
    columns: BASE.concat(o.columns),
    fields: o.fields,
    required: o.required || [],
    searchable: o.searchable || [],
    sortable: (o.sortable || []).concat(['created_at', 'updated_at']),
    defaultSort: o.defaultSort || 'created_at',
    filters: o.filters || [],
    check: o.check || null,
    enums: o.enums || {},
    range: o.range || null
  };
}

/* Shared shape checks. Kept small and explicit: a validation layer nobody can
   read is a validation layer nobody maintains. */
function isDate(v) { return v === null || v === undefined || v === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(v)); }
function isNum(v)  { return v === null || v === undefined || v === '' || !isNaN(Number(v)); }
function oneOf(list) {
  return function (v) { return v === undefined || v === null || v === '' || list.indexOf(String(v)) >= 0; };
}

var STATUS_INVOICE = ['draft', 'sent', 'part_paid', 'paid', 'cancelled'];
var STATUS_QUOTE   = ['draft', 'sent', 'accepted', 'refused', 'expired'];
var STATUS_PROSPECT = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
var ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
var ACCOUNT_SYSTEM_KEYS = ['receivable', 'payable', 'bank', 'cash', 'vat_collected', 'vat_deductible', 'sales', 'purchases'];
var JOURNAL_KINDS = ['sales', 'purchases', 'bank', 'cash', 'general'];
var ENTRY_STATUSES = ['draft', 'posted', 'reversed', 'void'];
var AGENDA_KINDS = ['event', 'task', 'reminder'];
var AGENDA_STATUSES = ['scheduled', 'done', 'cancelled'];
var AGENDA_PRIORITIES = ['low', 'normal', 'high'];

var DEFS = {
  clients: def({
    module: 'clients', table: 'clients',
    columns: ['legacy_id', 'name', 'tax_id', 'email', 'phone', 'address', 'city', 'postal_code', 'notes', 'deleted_at'],
    fields: ['name', 'tax_id', 'email', 'phone', 'address', 'city', 'postal_code', 'notes', 'legacy_id'],
    required: ['name'],
    searchable: ['name', 'email', 'phone', 'tax_id'],
    sortable: ['name'], defaultSort: 'name',
    check: function (v) {
      if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v.email))) return 'email is not a valid address';
      return null;
    }
  }),

  contacts: def({
    module: 'clients', table: 'contacts',
    columns: ['legacy_id', 'client_id', 'full_name', 'email', 'phone', 'role_label', 'source', 'deleted_at'],
    fields: ['client_id', 'full_name', 'email', 'phone', 'role_label', 'source', 'legacy_id'],
    required: ['full_name'], searchable: ['full_name', 'email', 'phone'],
    sortable: ['full_name'], defaultSort: 'full_name', filters: ['client_id'], label: 'full_name'
  }),

  suppliers: def({
    module: 'inventory', table: 'suppliers',
    columns: ['legacy_id', 'name', 'tax_id', 'email', 'phone', 'address', 'notes', 'deleted_at'],
    fields: ['name', 'tax_id', 'email', 'phone', 'address', 'notes', 'legacy_id'],
    required: ['name'], searchable: ['name', 'email'], sortable: ['name'], defaultSort: 'name'
  }),

  collaborators: def({
    module: 'production', table: 'collaborators',
    columns: ['legacy_id', 'user_id', 'full_name', 'email', 'phone', 'role_label', 'deleted_at'],
    fields: ['full_name', 'email', 'phone', 'role_label', 'legacy_id'],
    required: ['full_name'], searchable: ['full_name', 'role_label', 'email'],
    sortable: ['full_name'], defaultSort: 'full_name', label: 'full_name'
  }),

  projects: def({
    module: 'projects', table: 'projects',
    columns: ['legacy_id', 'reference', 'title', 'client_id', 'nature_id', 'status', 'starts_on', 'ends_on', 'notes', 'deleted_at'],
    fields: ['reference', 'title', 'client_id', 'nature_id', 'status', 'starts_on', 'ends_on', 'notes', 'legacy_id'],
    required: ['title'], searchable: ['title', 'reference'], sortable: ['title', 'starts_on'],
    defaultSort: 'starts_on', filters: ['client_id', 'status'], label: 'title',
    check: function (v) {
      if (!isDate(v.starts_on) || !isDate(v.ends_on)) return 'dates must be YYYY-MM-DD';
      if (v.starts_on && v.ends_on && String(v.ends_on) < String(v.starts_on)) return 'ends_on precedes starts_on';
      return null;
    }
  }),

  appointments: def({
    module: 'planning', table: 'appointments',
    columns: ['legacy_id', 'title', 'client_id', 'project_id', 'starts_at', 'ends_at', 'location', 'notes', 'deleted_at'],
    fields: ['title', 'client_id', 'project_id', 'starts_at', 'ends_at', 'location', 'notes', 'legacy_id'],
    required: ['title', 'starts_at'], searchable: ['title', 'location'],
    sortable: ['starts_at', 'title'], defaultSort: 'starts_at',
    filters: ['client_id', 'project_id'], label: 'title'
  }),

  representations: def({
    module: 'production', table: 'representations',
    columns: ['legacy_id', 'project_id', 'title', 'venue', 'starts_at', 'capacity', 'deleted_at'],
    fields: ['project_id', 'title', 'venue', 'starts_at', 'capacity', 'legacy_id'],
    required: ['title'], searchable: ['title', 'venue'], sortable: ['starts_at', 'title'],
    defaultSort: 'starts_at', filters: ['project_id'], label: 'title'
  }),

  contracts: def({
    module: 'projects', table: 'contracts',
    columns: ['legacy_id', 'project_id', 'client_id', 'reference', 'status', 'signed_on', 'amount_ttc', 'deleted_at'],
    fields: ['project_id', 'client_id', 'reference', 'status', 'signed_on', 'amount_ttc', 'legacy_id'],
    required: [], searchable: ['reference'], sortable: ['signed_on', 'reference'],
    defaultSort: 'signed_on', filters: ['project_id', 'client_id', 'status'], label: 'reference',
    check: function (v) { return isNum(v.amount_ttc) ? null : 'amount_ttc must be numeric'; }
  }),

  // quotes: MVP gap closed — moved to a dedicated module (modules/quotes.js,
  // routed directly in server.js) with real quote_lines support and
  // server-computed totals, the same shape as invoices. The generic CRUD
  // this DEF used to drive was header-only: it could create a quote number
  // but had no way to say what was being quoted. Removed from DEFS rather
  // than left registered, so the generic loop in server.js cannot also
  // register a second, conflicting set of routes for the same paths.

  purchases: def({
    module: 'finance', table: 'purchases',
    columns: ['legacy_id', 'supplier_id', 'reference', 'purchased_on', 'amount_ht', 'vat_rate', 'notes', 'deleted_at'],
    fields: ['supplier_id', 'reference', 'purchased_on', 'amount_ht', 'vat_rate', 'notes', 'legacy_id'],
    required: [], searchable: ['reference', 'notes'], sortable: ['purchased_on'],
    defaultSort: 'purchased_on', filters: ['supplier_id'], label: 'reference',
    check: function (v) { return isNum(v.amount_ht) ? null : 'amount_ht must be numeric'; }
  }),

  expenses: def({
    module: 'finance', table: 'expenses',
    columns: ['legacy_id', 'category_id', 'project_id', 'spent_on', 'amount', 'description', 'deleted_at'],
    fields: ['category_id', 'project_id', 'spent_on', 'amount', 'description', 'legacy_id'],
    required: ['description'], searchable: ['description'], sortable: ['spent_on'],
    defaultSort: 'spent_on', filters: ['category_id', 'project_id'], label: 'description',
    check: function (v) { return isNum(v.amount) ? null : 'amount must be numeric'; }
  }),

  documents: def({
    module: 'documents', table: 'documents',
    columns: ['legacy_id', 'storage_key', 'original_name', 'mime_type', 'byte_size', 'sha256', 'category', 'client_id', 'project_id', 'uploaded_by', 'deleted_at'],
    // storage_key, sha256 and byte_size are set by the upload path, never by a
    // client: accepting them would let a caller point a document row at
    // someone else's blob.
    fields: ['client_id', 'project_id', 'category', 'legacy_id'],
    required: [], searchable: ['original_name', 'category'], sortable: ['created_at'],
    defaultSort: 'created_at', filters: ['client_id', 'project_id'], label: 'original_name'
  }),

  inventory_items: def({
    module: 'inventory', table: 'inventory_items',
    columns: ['sku', 'label', 'unit', 'min_quantity', 'deleted_at'],
    fields: ['sku', 'label', 'unit', 'min_quantity'],
    required: ['label'], searchable: ['sku', 'label'], sortable: ['label', 'sku'], defaultSort: 'label', label: 'label',
    check: function (v) { return isNum(v.min_quantity) ? null : 'min_quantity must be numeric'; }
  }),

  natures: def({
    module: 'settings', table: 'natures',
    columns: ['legacy_id', 'label', 'kind', 'deleted_at'],
    fields: ['label', 'kind', 'legacy_id'], required: ['label'], searchable: ['label'],
    sortable: ['label'], defaultSort: 'label', label: 'label'
  }),

  expense_categories: def({
    module: 'settings', table: 'expense_categories',
    columns: ['legacy_id', 'label', 'deleted_at'],
    fields: ['label', 'legacy_id'], required: ['label'], searchable: ['label'],
    sortable: ['label'], defaultSort: 'label', label: 'label'
  }),

  /* Agenda (0006-agenda.sql): events, tasks and reminders, one kind field.
     Calendar range queries use def.range (lib/resource.js): ?from&?to filter
     on starts_at. */
  agenda_events: def({
    module: 'agenda', table: 'agenda_events',
    columns: ['legacy_id', 'kind', 'title', 'description', 'starts_at', 'ends_at', 'all_day', 'location',
              'status', 'priority', 'client_id', 'project_id', 'prospect_id', 'invoice_id', 'quote_id',
              'assigned_to', 'remind_at', 'deleted_at'],
    fields: ['kind', 'title', 'description', 'starts_at', 'ends_at', 'all_day', 'location', 'status', 'priority',
             'client_id', 'project_id', 'prospect_id', 'invoice_id', 'quote_id', 'assigned_to', 'remind_at', 'legacy_id'],
    required: ['title', 'starts_at'], searchable: ['title', 'location', 'description'],
    sortable: ['starts_at', 'title', 'priority', 'status'], defaultSort: 'starts_at', range: 'starts_at',
    filters: ['kind', 'status', 'priority', 'client_id', 'project_id', 'assigned_to'], label: 'title',
    enums: { kind: AGENDA_KINDS, status: AGENDA_STATUSES, priority: AGENDA_PRIORITIES },
    check: function (v) {
      if (!oneOf(AGENDA_KINDS)(v.kind)) return 'kind must be one of ' + AGENDA_KINDS.join('|');
      if (!oneOf(AGENDA_STATUSES)(v.status)) return 'status must be one of ' + AGENDA_STATUSES.join('|');
      if (!oneOf(AGENDA_PRIORITIES)(v.priority)) return 'priority must be one of ' + AGENDA_PRIORITIES.join('|');
      if (v.ends_at && v.starts_at && String(v.ends_at) < String(v.starts_at)) return 'ends_at precedes starts_at';
      return null;
    }
  }),

  bank_accounts: def({
    module: 'finance', table: 'bank_accounts',
    columns: ['label', 'iban', 'currency', 'deleted_at'],
    fields: ['label', 'iban', 'currency'],
    required: ['label'], searchable: ['label'], sortable: ['label'],
    defaultSort: 'label', label: 'label'
  }),

  /* Prospects (0004-prospects.sql). converted_client_id / converted_at are
     READ-ONLY here: they are written only by POST /prospects/:id/convert
     (modules/prospects.js), which is what keeps "won" and "has a client" the
     same fact. `won` is therefore not settable through PATCH either. */
  prospects: def({
    module: 'prospects', table: 'prospects',
    columns: ['legacy_id', 'name', 'contact_name', 'email', 'phone', 'city', 'source', 'status', 'score',
              'expected_value', 'next_action_on', 'notes', 'converted_client_id', 'converted_at', 'deleted_at'],
    fields: ['name', 'contact_name', 'email', 'phone', 'city', 'source', 'status', 'score',
             'expected_value', 'next_action_on', 'notes', 'legacy_id'],
    required: ['name'], searchable: ['name', 'contact_name', 'email', 'city'],
    sortable: ['name', 'status', 'next_action_on', 'expected_value', 'score'],
    defaultSort: 'created_at', filters: ['status', 'source'], label: 'name',
    check: function (v) {
      if (!oneOf(STATUS_PROSPECT)(v.status)) return 'status must be one of ' + STATUS_PROSPECT.join('|');
      if (String(v.status) === 'won') return 'won is reached by converting the prospect, not by setting the status';
      if (!isDate(v.next_action_on)) return 'next_action_on must be YYYY-MM-DD';
      if (!isNum(v.score) || (v.score !== undefined && v.score !== null && v.score !== '' && (Number(v.score) < 0 || Number(v.score) > 100))) return 'score must be 0..100';
      if (!isNum(v.expected_value) || (v.expected_value && Number(v.expected_value) < 0)) return 'expected_value must be a non-negative number';
      return null;
    }
  }),

  /* Accounting reference data (0005-accounting.sql). Entries, periods and
     reports are NOT generic resources: modules/accounting.js owns them. */
  accounts: def({
    module: 'accounting', table: 'accounts',
    columns: ['code', 'label', 'type', 'parent_code', 'system_key', 'is_active', 'deleted_at'],
    fields: ['code', 'label', 'type', 'parent_code', 'system_key', 'is_active'],
    required: ['code', 'label', 'type'], searchable: ['code', 'label'], sortable: ['code', 'label', 'type'],
    defaultSort: 'code', filters: ['type', 'system_key'], label: 'code',
    enums: { type: ACCOUNT_TYPES, system_key: ACCOUNT_SYSTEM_KEYS },
    check: function (v) {
      if (v.code !== undefined && !/^[0-9]{1,10}$/.test(String(v.code))) return 'code must be 1 to 10 digits';
      if (!oneOf(ACCOUNT_TYPES)(v.type)) return 'type must be one of ' + ACCOUNT_TYPES.join('|');
      if (!oneOf(ACCOUNT_SYSTEM_KEYS)(v.system_key)) return 'system_key must be one of ' + ACCOUNT_SYSTEM_KEYS.join('|');
      return null;
    }
  }),
  journals: def({
    module: 'accounting', table: 'journals',
    columns: ['code', 'label', 'kind', 'is_active', 'deleted_at'],
    fields: ['code', 'label', 'kind', 'is_active'],
    required: ['code', 'label', 'kind'], searchable: ['code', 'label'], sortable: ['code', 'label'],
    defaultSort: 'code', filters: ['kind'], label: 'code',
    enums: { kind: JOURNAL_KINDS },
    check: function (v) { return oneOf(JOURNAL_KINDS)(v.kind) ? null : 'kind must be one of ' + JOURNAL_KINDS.join('|'); }
  }),
};


/* Public metadata for the frontend: what each resource is called, which module
   gates it, which fields may be written, which are required, which filters and
   sorts exist, and the closed status vocabularies. The browser builds its
   forms and tables from this, so the UI cannot drift from the API contract. */
function publicMeta() {
  var out = {};
  Object.keys(DEFS).forEach(function (name) {
    var d = DEFS[name];
    out[name] = {
      module: d.module, label: d.label, columns: d.columns, fields: d.fields,
      required: d.required, searchable: d.searchable, sortable: d.sortable,
      defaultSort: d.defaultSort, filters: d.filters, enums: d.enums,
      createable: name !== 'documents'
    };
  });
  return {
    resources: out,
    statuses: { invoice: STATUS_INVOICE, quote: STATUS_QUOTE, prospect: STATUS_PROSPECT, project: ['planned', 'active', 'closed'], entry: ENTRY_STATUSES, agenda: AGENDA_STATUSES, agenda_kind: AGENDA_KINDS, agenda_priority: AGENDA_PRIORITIES },
    invoice_user_settable: ['draft', 'sent', 'cancelled']
  };
}

module.exports = {
  publicMeta: publicMeta, DEFS: DEFS, def: def, STATUS_INVOICE: STATUS_INVOICE, STATUS_QUOTE: STATUS_QUOTE, STATUS_PROSPECT: STATUS_PROSPECT };
