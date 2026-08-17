'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — seed loader
// projects/command-center/seed/load.js
//
// Loads seed/library.json into an initialised database.
//
// IDEMPOTENT AND NON-DESTRUCTIVE. Re-running it never deletes a command,
// never resets a usage counter, and never overwrites an edit the owner made
// in the UI. A command whose slug already exists is SKIPPED, not updated —
// because the owner's edited version is the more valuable one, and a
// loader that silently reverts hand edits is a data-loss bug wearing a
// convenience costume.
//
// Pass --force-update to overwrite existing commands from the seed file.
// That is an explicit choice with a visible flag, not a default.
//
// RUN
//   env MCC_DB_HOST=... MCC_DB_PORT=... MCC_DB_USER=... MCC_DB_PASSWORD=... \
//       MCC_DB_NAME=... node projects/command-center/seed/load.js
// =====================================================

var fs = require('fs');
var path = require('path');
var db = require('../reference/db.js');
var secrets = require('../reference/secrets.js');

var FORCE_UPDATE = process.argv.indexOf('--force-update') !== -1;
var LIBRARY_PATH = path.join(__dirname, 'library.json');

function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function main() {
  var library = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
  var summary = {
    categories: 0, projects: 0, tags: 0,
    commands_inserted: 0, commands_skipped: 0, commands_updated: 0,
    relations: 0, workflows: 0, notes: 0
  };

  // The seed must satisfy the same secret gate as any API write. If a
  // credential ever reaches the seed file, the loader refuses rather than
  // becoming the one path into the database that skips the check.
  library.commands.forEach(function (command) {
    var report = secrets.scan({ body: command.body, explanation: command.explanation });
    if (report.blocked) {
      throw new Error('seed refused: command "' + command.slug + '" matches a credential format (' +
                      report.findings.map(function (f) { return f.rule; }).join(', ') + ')');
    }
  });

  await db.transaction(async function (exec) {
    // ── Categories ────────────────────────────────────────────────────
    for (var i = 0; i < library.categories.length; i++) {
      var category = library.categories[i];
      var result = await exec(
        'INSERT INTO mcc_categories (slug, name_en, name_fr, name_ar, description, color, sort_order) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (slug) DO NOTHING',
        [category.slug, category.name_en, category.name_fr, category.name_ar || null,
         category.description || '', category.color || 'slate', category.sort_order || 1000]
      );
      summary.categories += result.rowCount;
    }

    // ── Projects ──────────────────────────────────────────────────────
    for (var p = 0; p < library.projects.length; p++) {
      var project = library.projects[p];
      var projectResult = await exec(
        'INSERT INTO mcc_projects (slug, name, description, sort_order) VALUES ($1,$2,$3,$4) ' +
        'ON CONFLICT (slug) DO NOTHING',
        [project.slug, project.name, project.description || '', project.sort_order || 1000]
      );
      summary.projects += projectResult.rowCount;
    }

    // ── Commands ──────────────────────────────────────────────────────
    for (var c = 0; c < library.commands.length; c++) {
      var command = library.commands[c];
      var existing = await exec('SELECT id FROM mcc_commands WHERE slug = $1', [command.slug]);

      if (existing.rows.length && !FORCE_UPDATE) {
        summary.commands_skipped++;
        continue;
      }

      var categoryId = null;
      if (command.category) {
        var cat = await exec('SELECT id FROM mcc_categories WHERE slug = $1', [command.category]);
        if (!cat.rows.length) throw new Error('seed: unknown category "' + command.category + '" on ' + command.slug);
        categoryId = cat.rows[0].id;
      }
      var projectId = null;
      if (command.project) {
        var proj = await exec('SELECT id FROM mcc_projects WHERE slug = $1', [command.project]);
        if (!proj.rows.length) throw new Error('seed: unknown project "' + command.project + '" on ' + command.slug);
        projectId = proj.rows[0].id;
      }

      var values = [
        command.slug, command.title, categoryId, projectId,
        command.description || '', command.body,
        command.when_to_use || '', command.explanation || '',
        command.best_practices || '', command.warnings || '',
        command.difficulty || 'INTERMEDIATE', command.safety_level || 'SAFE',
        command.status || 'ACTIVE', command.version || '1.0',
        command.author || 'Mythos canon', command.source || '',
        JSON.stringify(command.variables || [])
      ];

      var commandId;
      if (existing.rows.length) {
        await exec(
          'UPDATE mcc_commands SET title=$2, category_id=$3, project_id=$4, description=$5, body=$6, ' +
          'when_to_use=$7, explanation=$8, best_practices=$9, warnings=$10, difficulty=$11, ' +
          'safety_level=$12, status=$13, version=$14, author=$15, source=$16, variables=$17, ' +
          'updated_at = now() WHERE slug = $1',
          values
        );
        commandId = existing.rows[0].id;
        summary.commands_updated++;
      } else {
        var inserted = await exec(
          'INSERT INTO mcc_commands (slug, title, category_id, project_id, description, body, when_to_use, ' +
          'explanation, best_practices, warnings, difficulty, safety_level, status, version, author, source, variables) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id',
          values
        );
        commandId = inserted.rows[0].id;
        summary.commands_inserted++;

        await exec(
          'INSERT INTO mcc_command_versions (command_id, version, snapshot, change_note) VALUES ($1,$2,$3,$4)',
          [commandId, command.version || '1.0',
           JSON.stringify({ title: command.title, body: command.body, version: command.version || '1.0' }),
           'seeded from library.json']
        );
      }

      // Tags are dynamic — an unseen tag is created, matching the API's
      // behaviour rather than requiring a separate tag manifest.
      var tags = Array.isArray(command.tags) ? command.tags : [];
      for (var t = 0; t < tags.length; t++) {
        var tagSlug = slugify(tags[t]);
        if (!tagSlug) continue;
        var tagRow = await exec(
          'INSERT INTO mcc_tags (slug, label) VALUES ($1,$2) ON CONFLICT (slug) DO UPDATE SET label = mcc_tags.label RETURNING id',
          [tagSlug, tags[t]]
        );
        summary.tags++;
        await exec(
          'INSERT INTO mcc_command_tags (command_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [commandId, tagRow.rows[0].id]
        );
      }
    }

    // ── Relations ─────────────────────────────────────────────────────
    // After all commands exist, so forward references resolve.
    for (var r = 0; r < (library.relations || []).length; r++) {
      var relation = library.relations[r];
      var from = await exec('SELECT id FROM mcc_commands WHERE slug = $1', [relation.command]);
      var to = await exec('SELECT id FROM mcc_commands WHERE slug = $1', [relation.related]);
      if (!from.rows.length || !to.rows.length) {
        throw new Error('seed: relation references a missing command: ' + relation.command + ' -> ' + relation.related);
      }
      var relationResult = await exec(
        'INSERT INTO mcc_command_relations (command_id, related_command_id, relation_type) ' +
        'VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [from.rows[0].id, to.rows[0].id, relation.relation_type || 'RELATED']
      );
      summary.relations += relationResult.rowCount;
    }

    // ── Workflows ─────────────────────────────────────────────────────
    for (var w = 0; w < (library.workflows || []).length; w++) {
      var workflow = library.workflows[w];
      var workflowProjectId = null;
      if (workflow.project) {
        var wp = await exec('SELECT id FROM mcc_projects WHERE slug = $1', [workflow.project]);
        workflowProjectId = wp.rows.length ? wp.rows[0].id : null;
      }
      var workflowRow = await exec(
        'INSERT INTO mcc_workflows (slug, title, description, project_id) VALUES ($1,$2,$3,$4) ' +
        'ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description RETURNING id',
        [workflow.slug, workflow.title, workflow.description || '', workflowProjectId]
      );
      var workflowId = workflowRow.rows[0].id;
      summary.workflows++;

      for (var s = 0; s < workflow.steps.length; s++) {
        var step = workflow.steps[s];
        var stepCommand = await exec('SELECT id FROM mcc_commands WHERE slug = $1', [step.command]);
        if (!stepCommand.rows.length) {
          throw new Error('seed: workflow "' + workflow.slug + '" step references missing command ' + step.command);
        }
        await exec(
          'INSERT INTO mcc_workflow_commands (workflow_id, command_id, position, note) VALUES ($1,$2,$3,$4) ' +
          'ON CONFLICT (workflow_id, position) DO UPDATE SET command_id = EXCLUDED.command_id, note = EXCLUDED.note',
          [workflowId, stepCommand.rows[0].id, step.position, step.note || '']
        );
      }
    }

    // ── Notes ─────────────────────────────────────────────────────────
    // Matched on title so re-running does not duplicate them.
    for (var n = 0; n < (library.notes || []).length; n++) {
      var note = library.notes[n];
      var noteCommandId = null;
      if (note.command) {
        var noteCommand = await exec('SELECT id FROM mcc_commands WHERE slug = $1', [note.command]);
        noteCommandId = noteCommand.rows.length ? noteCommand.rows[0].id : null;
      }
      var duplicate = await exec('SELECT id FROM mcc_notes WHERE title = $1', [note.title]);
      if (duplicate.rows.length) continue;
      await exec(
        'INSERT INTO mcc_notes (title, content, scope, command_id, tags) VALUES ($1,$2,$3,$4,$5)',
        [note.title, note.content || '', note.scope || 'GENERAL', noteCommandId, note.tags || []]
      );
      summary.notes++;
    }
  });

  console.log('Seed complete:');
  Object.keys(summary).forEach(function (key) {
    console.log('  ' + key + ': ' + summary[key]);
  });
  if (summary.commands_skipped > 0 && !FORCE_UPDATE) {
    console.log('\n  ' + summary.commands_skipped + ' command(s) already existed and were left untouched.');
    console.log('  Re-run with --force-update to overwrite them from library.json.');
  }
  await db.closePool();
}

main().catch(function (err) {
  console.error('SEED FAILED: ' + err.message);
  db.closePool().then(function () { process.exit(1); }).catch(function () { process.exit(1); });
});
