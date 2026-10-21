// Executable audit of the committed data. CI runs this before every Pages deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {migrate} from '../scratch/migrate-v1-to-v2.ts';
import {KEYS, LOOKUPS, ROOT, V1_PREFIX, V2_PREFIX, loadKeys, loadV2, readParts, setsInOrder, sha256} from './store.ts';
import {scoreSet} from './camelot.js';
import {audit} from './audit.ts';

const workflow = fs.readFileSync(`${ROOT}/.github/workflows/pages.yml`, 'utf8');

test('the v2 store is exactly what the migration makes from the pinned v1 store', {skip: !loadV2().meta.migratedFrom && 'v2 was rebuilt from the corpus'}, () => {
  const v1gz = readParts(V1_PREFIX);
  assert.ok(workflow.includes(sha256(v1gz)), 'v1 sha is pinned in pages.yml');
  const {gz} = migrate(v1gz);
  assert.equal(sha256(gz), sha256(readParts(V2_PREFIX)), 'rerun npm run migrate:v2 and commit the parts');
  assert.ok(workflow.includes(sha256(gz)), 'v2 sha is pinned in pages.yml');
});

test('v1 shows the identity bugs the audit found, and v2 has none of them', () => {
  const v1 = JSON.parse(zlib.gunzipSync(readParts(V1_PREFIX)).toString('utf8'));
  for (const name of ['th Planet', 'bit', '"He$H, Bommer,', 'Svdden Death', 'SVDDEN DEATH']) assert.ok(v1.artists.includes(name), name);
  assert.deepEqual(audit(loadV2()), []);
});

test('the key file matches the current store and lookups', () => {
  const keys = loadKeys();
  assert.ok(keys, 'run npm run keys:build');
  assert.equal(keys.meta.primitivesSha256, sha256(readParts(V2_PREFIX)), 'rerun npm run keys:build');
  assert.equal(keys.meta.lookupsSha256, sha256(fs.readFileSync(LOOKUPS)), 'rerun npm run keys:build');
  const d = loadV2();
  const identities = new Set(d.tracks.map(r => r[6]));
  for (const id of Object.keys(keys.tracks)) assert.ok(identities.has(id), `key row for unknown track ${id}`);
  assert.equal(keys.sets.length, setsInOrder(d).length);
  assert.ok(fs.statSync(KEYS).size < 2_000_000);
});

test("set scores in the key file are reproducible (Squnto's set)", () => {
  const keys = loadKeys()!;
  const d = loadV2();
  const i = keys.sets.findIndex(s => s.label === 'SQUNTO');
  const s = setsInOrder(d)[i];
  const codes = s.tracks.map(t => keys.tracks[d.tracks[t][6]]?.[0] ?? null);
  assert.deepEqual(scoreSet(codes, s.pairs, {iterations: 20000, seed: 7}), keys.sets[i].all);
  assert.ok(keys.sets[i].all.scored >= 51 && keys.sets[i].all.legal >= 13);
});
