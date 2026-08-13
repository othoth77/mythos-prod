// =====================================================
// Mythos Personal Intelligence — psql test driver (SCRATCH TESTING ONLY)
// projects/personal-intelligence/persistence/testing/psql-driver.js
//
// Satisfies the driver contract expected by ../client.js:
//     driver.query({ text, values }) -> Promise<{ rows }>
// by driving a persistent `psql` session over stdin.
//
// WHY THIS EXISTS. The scratch container runs with `--network none`, so no TCP
// driver can reach it, and this repository intentionally has no package.json and
// no node_modules. This keeps the scratch environment fully isolated while still
// executing every statement against a REAL PostgreSQL, so real foreign keys,
// CHECK constraints and append-only triggers decide the outcomes — nothing is
// faked or stubbed.
//
// NOT FOR PRODUCTION. Production must inject a real `pg` Pool, which speaks the
// wire protocol and binds parameters properly. The literal encoder below is a
// test-harness convenience and is deliberately strict: it accepts only the types
// the suite uses and throws on anything else rather than guessing.
// =====================================================
'use strict';

const { spawn } = require('child_process');

const EOQ = '__EOQ__';
// psql with VERBOSITY verbose prefixes the SQLSTATE, e.g. "ERROR:  23505: ...".
const ERROR_RE = /ERROR:\s+([0-9A-Z]{5}):\s*([\s\S]*)/;

function encodeLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!isFinite(v)) throw new Error('psql-driver: non-finite number');
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return "'" + v.toISOString() + "'::timestamptz";
  if (Array.isArray(v)) return 'ARRAY[' + v.map(encodeLiteral).join(',') + ']';
  if (typeof v === 'string') return "'" + v.replace(/'/g, "''") + "'";
  throw new Error('psql-driver: unsupported parameter type ' + typeof v);
}

// $1..$n substitution. Longest-index-first so $10 is not eaten by $1.
function inline(text, values) {
  if (!values || !values.length) return text;
  let out = text;
  for (let i = values.length; i >= 1; i--) {
    out = out.split('$' + i).join(encodeLiteral(values[i - 1]));
  }
  return out;
}

function isControl(text) {
  return /^\s*(BEGIN|COMMIT|ROLLBACK|SET|RESET|START\s+TRANSACTION)\b/i.test(text);
}
function returnsRows(text) {
  // SHOW is deliberately excluded: it cannot appear inside a CTE, so wrapping
  // it would produce invalid SQL. Use SELECT current_setting(...) instead.
  return /^\s*(SELECT|WITH)\b/i.test(text) || /\bRETURNING\b/i.test(text);
}

function createPsqlDriver(opts) {
  const args = ['docker', 'exec', '-i', opts.container, 'sh', '-c',
    'psql -U postgres -d ' + opts.database + ' -q -A -t -X 2>&1'];
  const child = spawn('sudo', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  let buffer = '';
  const waiters = [];
  child.stdout.on('data', function (chunk) {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf(EOQ)) !== -1) {
      const payload = buffer.slice(0, idx);
      buffer = buffer.slice(idx + EOQ.length);
      const waiter = waiters.shift();
      if (waiter) waiter(payload);
    }
  });

  function send(sql) {
    return new Promise(function (resolve) {
      waiters.push(resolve);
      child.stdin.write(sql + '\n\\echo ' + EOQ + '\n');
    });
  }

  let ready = send('\\set VERBOSITY verbose');

  return {
    async query(q) {
      await ready;
      const text = inline(q.text, q.values);
      const wrap = !isControl(text) && returnsRows(text);
      const sql = wrap
        ? 'WITH __q AS (' + text.replace(/;\s*$/, '') +
          ") SELECT COALESCE(json_agg(row_to_json(__q)),'[]'::json) FROM __q;"
        : text.replace(/;\s*$/, '') + ';';

      const raw = (await send(sql)).trim();
      const m = raw.match(ERROR_RE);
      if (m) {
        const err = new Error(m[2].split('\n')[0].trim());
        err.code = m[1]; // real SQLSTATE, so client.js classifies exactly as with pg
        throw err;
      }
      if (!wrap) return { rows: [] };
      const line = raw.split('\n').filter(function (l) { return l.trim() !== ''; }).pop();
      if (!line) return { rows: [] };
      try {
        return { rows: JSON.parse(line) || [] };
      } catch (_) {
        return { rows: [] };
      }
    },
    async end() {
      child.stdin.end();
      return new Promise(function (resolve) { child.on('close', resolve); });
    }
  };
}

module.exports = { createPsqlDriver: createPsqlDriver, encodeLiteral: encodeLiteral, inline: inline };
