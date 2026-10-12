// Study templates (study/templates/): the answer-file schema must describe exactly what the review page downloads, and
// the CSV templates must be empty, anonymous forms: one header row, a code to identify people, no names or contacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerFile, KIND } from '../study/review.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'study', 'templates');
const data = JSON.parse(readFileSync(join(ROOT, 'study', 'positions-2026-10-12.json'), 'utf8'));

test('the answer-file schema lists exactly the fields the review page downloads, in review and in test mode', () => {
  const schema = JSON.parse(readFileSync(join(DIR, 'answers.schema.json'), 'utf8'));
  const item = schema.properties.answers.items;
  const review = answerFile({ data, code: 'R01', answers: { P01: { choice: 1, acceptable: [10] } }, synthetic: true, note: 'SYNTHETIC test' });
  const form = answerFile({ data, code: 'B01', answers: { P01: { choice: 1 } }, form: 'A' });
  for (const file of [review, form]) {
    assert.deepEqual(Object.keys(file).filter(k => !(k in schema.properties)), [], 'every downloaded field is described');
    assert.deepEqual(schema.required.filter(k => !(k in file)), [], 'every required field is downloaded');
    assert.deepEqual(Object.keys(file.answers[0]).sort(), [...item.required].sort(), 'answer fields');
  }
  assert.deepEqual(Object.keys(item.properties).sort(), [...item.required].sort());
  assert.deepEqual(Object.keys(schema.properties).filter(k => !schema.required.includes(k)), ['note'], 'only the synthetic note is optional');
  assert.equal(schema.properties.kind.const, KIND);
  assert.deepEqual([...schema.properties.study.enum].sort(), [form.study, review.study].sort());
  assert.deepEqual(schema.properties.form.enum, [null, ...Object.keys(data.learningForms)]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(item.additionalProperties, false);
});

test('the CSV templates are empty, anonymous forms: one header row, a code first, no names or contact details', () => {
  const csvs = readdirSync(DIR).filter(f => f.endsWith('.csv')).sort();
  assert.deepEqual(csvs, ['expert-reviewers.csv', 'learning-participants.csv', 'learning-questionnaire.csv', 'learning-tasks.csv', 'learning-test-answers.csv']);
  for (const name of csvs) {
    const lines = readFileSync(join(DIR, name), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `${name}: a header row and no data`);
    const cols = lines[0].split(',');
    assert.equal(new Set(cols).size, cols.length, `${name}: no repeated column`);
    assert.ok(cols.every(c => /^[a-z0-9_]+$/.test(c)), `${name}: plain column names`);
    assert.match(cols[0], /^(reviewer|participant)_code$/, `${name}: the first column is the code`);
    const words = cols.flatMap(c => c.split('_'));
    for (const w of ['name', 'email', 'phone', 'address', 'birth', 'age', 'ip']) assert.ok(!words.includes(w), `${name}: no ${w} column`);
  }
});
