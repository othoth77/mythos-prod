#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — production build
// projects/mythos-trading-control-center/bin/build.js
//
//   node bin/build.js [--out dist] [--commit <sha>]
//
// There is no bundler and no dependency. The "build" does the three things a
// production web directory needs and nothing else:
//
//  1. CHECKS every script parses. A syntax error fails the build here, not in
//     an operator's browser.
//  2. FINGERPRINTS every asset — name.<sha256-prefix>.ext — and rewrites the
//     references in the HTML and CSS. The server then serves those files as
//     immutable, and a deploy can never leave a browser running new HTML
//     against an old script.
//  3. RECORDS what it built in build.json: the commit, a digest of the
//     sources, and the name map. /api/system reports it.
//
// The output is deterministic: the same sources produce the same dist/,
// byte for byte. There is no timestamp in it.
//
// The unbuilt web/ directory is fully servable as it is; the server uses
// dist/ when it exists and web/ otherwise.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function walk(dir, prefix, out) {
  fs.readdirSync(dir, { withFileTypes: true }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (e) {
    if (e.name[0] === '.') return;
    var p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, prefix + e.name + '/', out);
    else out.push({ rel: prefix + e.name, abs: p });
  });
  return out;
}

function hashedName(rel, digest) {
  var ext = path.extname(rel);
  return rel.slice(0, rel.length - ext.length) + '.' + digest.slice(0, 12) + ext;
}

/**
 * @param {object} [opts] { src, out, commit }
 * @returns {object} the build manifest
 */
function build(opts) {
  var o = opts || {};
  var src = o.src || path.join(ROOT, 'web');
  var out = o.out || path.join(ROOT, 'dist');
  var files = walk(src, '', []);

  // 1. every script must parse
  files.filter(function (f) { return /\.js$/.test(f.rel); }).forEach(function (f) {
    try { new vm.Script(fs.readFileSync(f.abs, 'utf8'), { filename: f.rel }); }
    catch (e) { throw new Error('build: ' + f.rel + ' does not parse: ' + e.message); }
  });

  var map = {};          // 'assets/x.css' → 'assets/x.<hash>.css'
  var contents = {};     // rel → Buffer (possibly rewritten)
  files.forEach(function (f) { contents[f.rel] = fs.readFileSync(f.abs); });

  function isAsset(rel) { return rel.indexOf('assets/') === 0; }

  // 2a. leaves first: fonts and images, which reference nothing
  files.filter(function (f) { return isAsset(f.rel) && /\.(woff2|svg|png|ico)$/.test(f.rel); }).forEach(function (f) {
    map[f.rel] = hashedName(f.rel, sha(contents[f.rel]));
  });

  // 2b. CSS: rewrite url(...) to hashed leaves, then hash
  files.filter(function (f) { return isAsset(f.rel) && /\.css$/.test(f.rel); }).forEach(function (f) {
    var dir = path.posix.dirname(f.rel);
    var text = contents[f.rel].toString('utf8').replace(/url\((['"]?)([^'")]+)\1\)/g, function (m, q, ref) {
      if (/^(data:|https?:)/.test(ref)) return m;
      var target = path.posix.normalize(path.posix.join(dir, ref));
      if (!map[target]) throw new Error('build: ' + f.rel + ' references ' + ref + ', which is not a built asset');
      return 'url(' + q + path.posix.relative(dir, map[target]) + q + ')';
    });
    contents[f.rel] = Buffer.from(text, 'utf8');
    map[f.rel] = hashedName(f.rel, sha(contents[f.rel]));
  });

  // 2c. scripts
  files.filter(function (f) { return isAsset(f.rel) && /\.js$/.test(f.rel); }).forEach(function (f) {
    map[f.rel] = hashedName(f.rel, sha(contents[f.rel]));
  });

  // 2d. HTML: rewrite every /assets/ reference
  var unresolved = [];
  files.filter(function (f) { return /\.html$/.test(f.rel); }).forEach(function (f) {
    var text = contents[f.rel].toString('utf8').replace(/(href|src)="\/(assets\/[^"]+)"/g, function (m, attr, ref) {
      if (!map[ref]) { unresolved.push(f.rel + ' → ' + ref); return m; }
      return attr + '="/' + map[ref] + '"';
    });
    contents[f.rel] = Buffer.from(text, 'utf8');
  });
  if (unresolved.length) throw new Error('build: unresolved asset reference(s): ' + unresolved.join(', '));

  // 3. write
  fs.rmSync(out, { recursive: true, force: true });
  var written = [];
  files.forEach(function (f) {
    var target = map[f.rel] || f.rel;
    var p = path.join(out, target);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents[f.rel]);
    written.push(target);
  });

  var sourceDigest = sha(Buffer.from(files.map(function (f) { return f.rel + ':' + sha(fs.readFileSync(f.abs)); }).join('\n')));
  var manifest = {
    built: true,
    commit: o.commit || null,
    sourceDigest: sourceDigest,
    files: written.length,
    assets: map
  };
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function main() {
  var args = process.argv.slice(2);
  var opts = {};
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--out') opts.out = path.resolve(args[++i]);
    else if (args[i] === '--commit') opts.commit = args[++i];
    else if (args[i] === '--src') opts.src = path.resolve(args[++i]);
  }
  try {
    var m = build(opts);
    process.stdout.write('built ' + m.files + ' files, ' + Object.keys(m.assets).length + ' fingerprinted, source ' +
      m.sourceDigest.slice(0, 12) + (m.commit ? ', commit ' + m.commit.slice(0, 12) : '') + '\n');
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { build: build };
