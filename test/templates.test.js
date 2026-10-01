import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll } from '../src/lib/storage.js';
import {
  loadTemplates,
  saveTemplates,
  builtInTemplates,
  duplicateTemplate,
  updateTemplate,
  removeTemplate,
} from '../src/lib/templates.js';

test('loadTemplates seeds the built-in presets on first run', async () => {
  await clearAll();
  const templates = await loadTemplates();
  assert.equal(templates.length, builtInTemplates().length);
  assert.ok(templates.some((t) => t.id === 'debate-panel'));
  assert.ok(templates.every((t) => t.builtIn));
});

test('loadTemplates returns previously saved templates without reseeding', async () => {
  await clearAll();
  const custom = [{ id: 'custom-1', name: 'Mine', roles: ['A'], builtIn: false }];
  await saveTemplates(custom);
  const loaded = await loadTemplates();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'Mine');
});

test('duplicateTemplate creates a non-built-in copy with a new id', () => {
  const [debate] = builtInTemplates();
  const copy = duplicateTemplate(debate);
  assert.notEqual(copy.id, debate.id);
  assert.equal(copy.builtIn, false);
  assert.equal(copy.roles.length, debate.roles.length);
  assert.ok(copy.name.includes('copy'));
});

test('duplicateTemplate honors a custom name', () => {
  const [debate] = builtInTemplates();
  const copy = duplicateTemplate(debate, 'My debate');
  assert.equal(copy.name, 'My debate');
});

test('updateTemplate patches fields and demotes builtIn to false', () => {
  const templates = builtInTemplates();
  const updated = updateTemplate(templates, 'debate-panel', { topic: 'Resolved: cats > dogs' });
  const debate = updated.find((t) => t.id === 'debate-panel');
  assert.equal(debate.topic, 'Resolved: cats > dogs');
  assert.equal(debate.builtIn, false);
  // Other templates are untouched.
  const interview = updated.find((t) => t.id === 'interview');
  assert.equal(interview.builtIn, true);
});

test('removeTemplate drops the matching template only', () => {
  const templates = builtInTemplates();
  const remaining = removeTemplate(templates, 'debate-panel');
  assert.equal(remaining.length, templates.length - 1);
  assert.ok(!remaining.some((t) => t.id === 'debate-panel'));
});
