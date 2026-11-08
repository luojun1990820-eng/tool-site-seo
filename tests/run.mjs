#!/usr/bin/env node
/**
 * Regression suite for scripts/audit.mjs.
 *
 *   node tests/run.mjs
 *
 * Each fixture pins the verdicts the audit must produce. When a threshold or a
 * rule changes, this fails loudly instead of silently changing behaviour.
 * Exit 0 = all assertions pass, 1 = at least one failed.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const audit = join(here, '..', 'scripts', 'audit.mjs');

const CASES = [
  {
    name: 'site-bad (thin shell, templated metadata, weak links)',
    dir: join(here, 'fixtures', 'site-bad'),
    exit: 1,
    gates: { G2: 'fail', G4: 'warn', G5: 'warn', G6: 'warn', G7: 'pass', G11: 'warn' },
  },
  {
    name: 'site-good (compliant pages, no false positives)',
    dir: join(here, 'fixtures', 'site-good'),
    exit: 0,
    gates: { G2: 'pass', G4: 'pass', G5: 'warn', G6: 'pass', G7: 'pass', G11: 'pass' },
  },
];

let failed = 0;

for (const c of CASES) {
  const r = spawnSync(process.execPath, [audit, c.dir, '--json', '--quiet'], { encoding: 'utf8' });
  const problems = [];

  if (r.status !== c.exit) problems.push(`exit ${r.status}, expected ${c.exit}`);

  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    problems.push(`stdout is not JSON: ${(r.stdout || r.stderr).slice(0, 120)}`);
  }

  if (out) {
    for (const [gate, want] of Object.entries(c.gates)) {
      const got = out.gates?.[gate]?.verdict;
      if (got !== want) problems.push(`${gate} = ${got}, expected ${want}`);
    }
    if (typeof out.counts?.not_assessed !== 'number') problems.push('counts.not_assessed missing');
    if (out.counts && out.counts.not_assessed < 6) {
      problems.push(`not_assessed dropped to ${out.counts.not_assessed}; manual gates must stay unmeasured`);
    }
  }

  if (problems.length) {
    failed++;
    console.log(`FAIL ${c.name}`);
    for (const p of problems) console.log(`     ${p}`);
  } else {
    console.log(`ok   ${c.name}`);
  }
}

console.log(failed ? `\n${failed} case(s) failed` : `\nall ${CASES.length} cases passed`);
process.exit(failed ? 1 : 0);
