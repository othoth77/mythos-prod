'use strict';
// MYTHOS WP — in-process event bus for the Communication Core (SSE feed).
// One emitter per process; events: { type, project_id, conversation_id, at, ... } — never message text.
var EventEmitter = require('events');
var bus = new EventEmitter();
bus.setMaxListeners(200);
function publish(ev) { try { bus.emit('comms', Object.assign({ at: new Date().toISOString() }, ev)); } catch (e) { /* listeners must not break producers */ } }
module.exports = { bus: bus, publish: publish };
