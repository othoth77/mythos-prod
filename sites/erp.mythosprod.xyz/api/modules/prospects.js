'use strict';

/* Prospects: the one operation the declarative resource cannot express —
 * conversion into a client.
 *
 *   POST /api/v1/prospects/:id/convert
 *
 * Runs inside the tenant transaction the pipeline opened, so:
 *   - the prospect is only visible if it belongs to the active tenant (RLS):
 *     another tenant's id is a plain 404, leaking nothing;
 *   - the client INSERT carries the same tenant_id and is CHECKed by RLS;
 *   - both writes and both audit rows commit or roll back together.
 *
 * Authorization: the route is gated by the pipeline on prospects.write (POST on
 * the prospects module). Creating a client is a bigger step than editing a
 * prospect, so the handler additionally requires prospects.convert and audits
 * the refusal exactly like the pipeline does.
 */

var authz = require('../lib/authz');
var audit = require('../lib/audit');

function convert(ctx, client) {
  return authz.has(client, ctx.user.id, ctx.tenantId, 'prospects.convert').then(function (allowed) {
    if (!allowed) {
      return audit.write(client, {
        actor_id: ctx.user.id, actor_label: ctx.user.email, action: 'permission.denied',
        entity_table: 'prospects', entity_id: ctx.id, outcome: 'denied',
        detail: { reason: 'missing_permission', required: 'prospects.convert' }, ip: ctx.ip, tenant_id: ctx.tenantId
      }).then(function () {
        return { status: 403, body: { error: 'forbidden', required: 'prospects.convert' } };
      });
    }
    return client.query(
      'SELECT id, name, contact_name, email, phone, city, notes, legacy_id, status, converted_client_id' +
      ' FROM prospects WHERE id = $1 AND deleted_at IS NULL', [ctx.id]
    ).then(function (r) {
      var p = (r.rows || [])[0];
      if (!p) return { status: 404, body: { error: 'not_found' } };
      if (p.converted_client_id) {
        return { status: 409, body: { error: 'already_converted', client_id: p.converted_client_id } };
      }
      if (p.status === 'lost') {
        return { status: 409, body: { error: 'prospect is lost; reopen it (status) before converting' } };
      }
      // The client takes the prospect's identity fields; the contact person
      // goes to notes rather than a guessed contacts row (a contact needs a
      // role and a source the prospect does not carry).
      var notes = [p.notes, p.contact_name ? 'Contact : ' + p.contact_name : null,
                   'Converti depuis le prospect ' + p.id].filter(Boolean).join('\n');
      return client.query(
        'INSERT INTO clients (tenant_id, name, email, phone, city, notes)' +
        ' VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, phone, city',
        [ctx.tenantId, p.name, p.email || null, p.phone || null, p.city || null, notes]
      ).then(function (c) {
        var cl = c.rows[0];
        return client.query(
          "UPDATE prospects SET status = 'won', converted_client_id = $2, converted_at = now()" +
          ' WHERE id = $1 RETURNING id, status, converted_client_id, converted_at',
          [p.id, cl.id]
        ).then(function (u) {
          // The pipeline writes the prospect's audit row from the descriptor
          // below; the client's creation is a second fact and gets its own row.
          return audit.write(client, {
            actor_id: ctx.user.id, actor_label: ctx.user.email, action: 'record.created',
            entity_table: 'clients', entity_id: cl.id, outcome: 'ok',
            detail: { label: cl.name, from_prospect: p.id }, ip: ctx.ip, tenant_id: ctx.tenantId
          }).then(function () {
            return {
              status: 201,
              body: { prospect: u.rows[0], client: cl },
              audit: { action: 'record.updated', entity_table: 'prospects', entity_id: p.id,
                       detail: { converted: true, client_id: cl.id, status: 'won' } }
            };
          });
        });
      });
    });
  });
}

module.exports = { convert: convert };
