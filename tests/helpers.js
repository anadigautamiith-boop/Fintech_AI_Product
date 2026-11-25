// Shared loader for the suite test files. Not a test file itself (no .test.js suffix).
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSuite, suiteFiles } from '../public/js/core/suites.js';

const DIR = new URL('../public/data/tests/', import.meta.url);

export function loadFiles() {
  const files = {};
  for (const name of suiteFiles()) files[name] = JSON.parse(readFileSync(new URL(`${name}.json`, DIR), 'utf8'));
  return files;
}

/** Run one labelled suite and register one node:test per case. */
export async function registerSuite(id) {
  const suite = await runSuite(id, loadFiles());
  for (const r of suite.results) {
    test(`${suite.title} · ${r.id} ${r.title}`, () => {
      assert.deepStrictEqual(r.actual, r.expected, r.detail);
    });
  }
}
