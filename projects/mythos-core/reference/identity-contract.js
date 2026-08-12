'use strict';
// =====================================================
// MYTHOS OS — Identity Core contract module
// projects/mythos-core/reference/identity-contract.js
//
// The thin, shared, internal library specified by
// docs/MYTHOS_IDENTITY_ARCHITECTURE.md §4 (BOUNDARY_DECISION):
// "a contract plus a thin resolution library" — deliberately NOT a service
// and NOT a shared server component, because zero deployed consumers exist.
//
// This module is intentionally tiny. It provides the architecture-level
// primitives every Mythos product needs in order to agree on what an
// identity IS, and nothing beyond that. Everything excluded from it is
// excluded on purpose and is enumerated in the binding decision's §7
// non-scope list — do not add any of it here without a new decision.
//
// Properties this module deliberately keeps:
//   - dependency-light  (Node's crypto only; no third-party package)
//   - deterministic     (validators are pure functions)
//   - framework-free    (no server, no router, no I/O, no network)
//   - stateless         (no stored state of any kind)
//
// Canonical forms (§2):
//   user     usr_<uuidv7>    e.g. usr_0193f4a2-7c31-7890-b4e2-1a2b3c4d5e6f
//   org      org_<uuidv7>    e.g. org_0193f4a2-8d55-7123-9c01-5f6a7b8c9d0e
//   service  svc_<name>      e.g. svc_idauto-api
// All stored as VARCHAR(64). Format enforcement lives in mythos_core only;
// consuming products keep these as opaque values.
// =====================================================

var crypto = require('crypto');

var MAX_ID_LENGTH = 64;

// Anchored, lowercase-only, version-7 and RFC-variant enforcing.
// The version nibble must be 7 and the variant nibble must be 8/9/a/b, so a
// v4 identifier or a malformed variant is rejected rather than silently kept.
var UUIDV7 = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
var RE_USER    = new RegExp('^usr_' + UUIDV7 + '$');
var RE_ORG     = new RegExp('^org_' + UUIDV7 + '$');
var RE_SERVICE = /^svc_[a-z0-9][a-z0-9._-]{0,40}$/;

// Organisation-scope roles — copied verbatim from the LIVE
// idauto_user_roles CHECK constraint so ID Auto's semantics carry over
// without translation. Order is meaningful only for display.
var ORG_ROLES = ['owner', 'admin', 'member', 'readonly'];

// The single platform-scope role. There is no second one by design.
var PLATFORM_ROLE = 'mythos_super_admin';

// Adopted verbatim from the LIVE idauto_audit_log CHECK constraint.
var ACTOR_TYPES = ['system', 'contributor', 'professional_user', 'admin', 'anonymous'];

// ---------------------------------------------------------------------
// Identifier generation
// ---------------------------------------------------------------------

// Builds a UUIDv7: 48-bit big-endian millisecond timestamp, 4-bit version,
// 2-bit variant, remaining bits random. Time-ordering gives B-tree locality
// while the random tail keeps the value non-enumerable — both required by
// the decision (§2 reasons 3 and 6).
function uuidv7() {
  var bytes = crypto.randomBytes(16);
  var ms = Date.now();

  // 48-bit timestamp, most significant byte first.
  bytes[0] = Math.floor(ms / 1099511627776) & 0xff; // ms >> 40
  bytes[1] = Math.floor(ms / 4294967296) & 0xff;    // ms >> 32
  bytes[2] = Math.floor(ms / 16777216) & 0xff;      // ms >> 24
  bytes[3] = Math.floor(ms / 65536) & 0xff;         // ms >> 16
  bytes[4] = Math.floor(ms / 256) & 0xff;           // ms >> 8
  bytes[5] = ms & 0xff;

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant (10xx)

  var hex = bytes.toString('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) +
         '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function newUserId() { return 'usr_' + uuidv7(); }
function newOrganizationId() { return 'org_' + uuidv7(); }

// ---------------------------------------------------------------------
// Validation — pure, total, and safe on any input type
// ---------------------------------------------------------------------

function isString(v) { return typeof v === 'string'; }

// Length is checked before the pattern so an oversized value can never be
// accepted by a pattern that happens to match a prefix, and so a caller
// cannot store something a VARCHAR(64) column would silently truncate.
function matches(re, v) {
  return isString(v) && v.length <= MAX_ID_LENGTH && re.test(v);
}

function isValidUserId(v)         { return matches(RE_USER, v); }
function isValidOrganizationId(v) { return matches(RE_ORG, v); }
function isValidServiceId(v)      { return matches(RE_SERVICE, v); }

// An audit actor reference is a user, a service, or NULL for an
// unauthenticated caller. An organisation is never an actor.
function isValidActorRef(v) {
  if (v === null || v === undefined) return true;
  return isValidUserId(v) || isValidServiceId(v);
}

function isValidOrgRole(v)   { return isString(v) && ORG_ROLES.indexOf(v) !== -1; }
function isValidActorType(v) { return isString(v) && ACTOR_TYPES.indexOf(v) !== -1; }
function isPlatformRole(v)   { return v === PLATFORM_ROLE; }

// Classifies any canonical identifier. Returns 'user' | 'organization' |
// 'service' | null. Useful when reading a bare reference out of an audit
// row, where the prefix is the only thing that says what the value is.
function classify(v) {
  if (isValidUserId(v)) return 'user';
  if (isValidOrganizationId(v)) return 'organization';
  if (isValidServiceId(v)) return 'service';
  return null;
}

// ---------------------------------------------------------------------
// Resolver contract (interface definition, not an implementation)
// ---------------------------------------------------------------------
//
// Any component that turns a caller-supplied credential into an identity
// MUST satisfy this shape:
//
//   resolveActor(credential) -> { mythos_user_id, actor_type } | null
//
// projects/idauto/reference/identity.js is the first adapter expected to
// satisfy it; see projects/idauto/reference/IDENTITY_ADAPTER.md. This module
// deliberately ships NO implementation — credential handling is out of scope
// for this stage (binding decision §7).
//
// assertResolvedActor() lets an adapter self-check its output shape without
// this module ever seeing the credential itself.
function assertResolvedActor(result) {
  if (result === null || result === undefined) return true;
  if (typeof result !== 'object') return false;
  if (!isValidUserId(result.mythos_user_id)) return false;
  if (!isValidActorType(result.actor_type)) return false;
  return true;
}

module.exports = {
  MAX_ID_LENGTH: MAX_ID_LENGTH,
  ORG_ROLES: ORG_ROLES,
  PLATFORM_ROLE: PLATFORM_ROLE,
  ACTOR_TYPES: ACTOR_TYPES,
  uuidv7: uuidv7,
  newUserId: newUserId,
  newOrganizationId: newOrganizationId,
  isValidUserId: isValidUserId,
  isValidOrganizationId: isValidOrganizationId,
  isValidServiceId: isValidServiceId,
  isValidActorRef: isValidActorRef,
  isValidOrgRole: isValidOrgRole,
  isValidActorType: isValidActorType,
  isPlatformRole: isPlatformRole,
  classify: classify,
  assertResolvedActor: assertResolvedActor
};
