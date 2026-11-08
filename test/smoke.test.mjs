import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, NAME } from '../dist/version.js';

test('version is semver-like and product name is stable', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
  assert.equal(NAME, 'ts-dsh');
});
