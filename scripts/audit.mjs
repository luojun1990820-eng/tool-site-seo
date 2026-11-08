#!/usr/bin/env node
/**
 * tool-site-seo — offline gate audit
 *
 * Scans a build-output directory of static HTML and reports the automatable
 * gates from checks/gates.md. Zero dependencies, Node 18+.
 *
 *   node scripts/audit.mjs <dir> [--json] [--quiet]
 *
 * Exit: 0 = no failing auto gate, 1 = at least one fail, 2 = usage/IO error.
 *
 * Design rule: anything that cannot be measured is `not_assessed`.
 * It is never reported as `pass`.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';

// ---------------------------------------------------------------- thresholds
// Keep in sync with checks/gates.md. Display width: CJK = 2, latin = 1.
const THRESHOLDS = {
  words: { fail: 50, warn: 150 }, // G2
  title: { min: 30, max: 60 }, // G5
  description: { min: 120, max: 160 }, // G5
  templated: { fail: 0.3, warn: 0.1 }, // G4
  inlinks: { fail: 0, warn: 3 }, // G11
  sitemap: { maxUrls: 50000, maxBytes: 50 * 1024 * 1024 }, // site
  maxPageBytes: 2 * 1024 * 1024,
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp', '.next', '.cache', 'dist-server']);
const STOCK_CTAS = [
  'try it free', 'try free', 'start free', 'start now', 'learn more', 'get started',
  'sign up now', 'free now', 'get it now', 'discover more',
];

// ------------------------------------------------------------------- helpers
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function width(s) {
  let w = 0;
  for (const ch of s) w += CJK.test(ch) ? 2 : 1;
  return w;
}

function stripTags(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return cjk + latin;
}

function decodeAttr(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function getMeta(html, name) {
  const re = new RegExp(`<meta\\b[^>]*name=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re);
  if (!tag) return null;
  const c = tag[0].match(/content=["']([\s\S]*?)["']/i);
  return c ? decodeAttr(c[1]) : '';
}

function collectJsonLd(types, node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => collectJsonLd(types, n)); return; }
  const t = node['@type'];
  if (typeof t === 'string') types.add(t);
  else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
  if (node['@graph']) collectJsonLd(types, node['@graph']);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') {
      if (entry.isDirectory()) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.toLowerCase().endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

// --------------------------------------------------------------- page parse
function parsePage(file, root) {
  const bytes = statSync(file).size;
  if (bytes > THRESHOLDS.maxPageBytes) {
    return { file, tooLarge: true };
  }
  const html = readFileSync(file, 'utf8');

  const titleRaw = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const title = stripTags(titleRaw);
  const desc = getMeta(html, 'description');
  const robots = getMeta(html, 'robots') || '';
  const canonical =
    (html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [])[0]?.match(/href=["']([^"']+)["']/i)?.[1] || null;

  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1]));
  const text = stripTags(html);
  const words = countWords(text);

  const jsonldTypes = new Set();
  let jsonldError = null;
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectJsonLd(jsonldTypes, JSON.parse(m[1].trim()));
    } catch (e) {
      jsonldError = String(e.message || e).slice(0, 80);
    }
  }

  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["']/gi)) {
    const href = decodeAttr(m[1]);
    if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel|javascript):/i.test(href)) continue;
    links.push(href.split('#')[0].split('?')[0]);
  }

  return {
    file,
    rel: relative(root, file).split(sep).join('/'),
    title, desc, robots, canonical,
    titleWidth: width(title),
    descWidth: width(desc || ''),
    h1Count: h1s.length,
    h1: h1s[0] || '',
    words,
    hasScript: /<script\b(?![^>]*application\/ld\+json)/i.test(html) || /id=["'](root|app|__next)["']/i.test(html),
    jsonldTypes: [...jsonldTypes],
    jsonldError,
    links,
    tooLarge: false,
  };
}

function resolveTarget(root, page, href) {
  let p = href.startsWith('/') ? join(root, href) : resolve(dirname(page.file), href);
  if (href.endsWith('/') || (existsSync(p) && statSync(p).isDirectory())) {
    p = join(p, 'index.html');
  }
  if (!existsSync(p) && existsSync(p + '.html')) p += '.html';
  return p;
}

// ------------------------------------------------------------------ sitemaps
function findSitemaps(root) {
  const found = [];
  const visit = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        visit(join(dir, e.name));
      } else if (/^sitemap.*\.xml$/i.test(e.name)) {
        found.push(join(dir, e.name));
      }
    }
  };
  visit(root);
  return found;
}

function readSitemaps(root, files) {
  const locs = [];
  const lastmods = [];
  let bytes = 0;
  for (const f of files) {
    const xml = readFileSync(f, 'utf8');
    bytes += Buffer.byteLength(xml);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) locs.push(m[1].trim());
    for (const m of xml.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)) lastmods.push(m[1].trim());
  }
  return { locs, lastmods, bytes };
}

function locToPath(root, loc) {
  try {
    const u = new URL(loc);
    let p = join(root, decodeURIComponent(u.pathname));
    if (u.pathname.endsWith('/')) p = join(p, 'index.html');
    if (!existsSync(p) && existsSync(p + '.html')) p += '.html';
    return p;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- checks
const VERDICT_RANK = { fail: 3, warn: 2, pass: 1, not_assessed: 0 };
const worst = (list) => list.reduce((a, b) => (VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a), 'pass');

function g2(pages) {
  if (!pages.length) return { verdict: 'not_assessed', evidence: 'no pages' };
  const scored = pages.filter((p) => !p.tooLarge).map((p) => {
    if (p.words < THRESHOLDS.words.fail && p.hasScript) return { p, v: 'fail' };
    if (p.words < THRESHOLDS.words.warn) return { p, v: 'warn' };
    return { p, v: 'pass' };
  });
  if (!scored.length) return { verdict: 'not_assessed', evidence: 'all pages skipped (too large)' };
  const v = worst(scored.map((s) => s.v));
  const min = scored.reduce((a, b) => (b.p.words < a.p.words ? b : a));
  return {
    verdict: v,
    evidence: `min ${min.p.words} words on ${min.p.rel} (pass ≥${THRESHOLDS.words.warn}, fail <${THRESHOLDS.words.fail} with script shell)`,
    findings: scored.filter((s) => s.v !== 'pass'),
  };
}

function g4(pages) {
  const usable = pages.filter((p) => !p.tooLarge && p.descWidth > 0);
  if (usable.length < 3) return { verdict: 'not_assessed', evidence: 'fewer than 3 comparable pages' };
  const norm = (s) => s.toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();
  let echo = 0;
  let templated = 0;
  const offenders = [];
  for (const p of usable) {
    const t = norm(p.title);
    const d = norm(p.desc);
    // Short titles ("Merge PDF") legitimately open a sentence, so require the
    // description to be materially longer than the title before calling it an echo.
    const opens = t.length >= 8 && d.startsWith(t) && d.length >= t.length + 10;
    const cta = STOCK_CTAS.some((c) => d.endsWith(c) || d.includes(c + '.'));
    if (opens) echo++;
    if (opens && cta) { templated++; offenders.push(p.rel); }
  }
  const high = templated / usable.length;
  const low = echo / usable.length;
  let v = 'pass';
  if (high > THRESHOLDS.templated.fail) v = 'fail';
  else if (low > THRESHOLDS.templated.warn) v = 'warn';
  return {
    verdict: v,
    evidence: `templated ${templated}/${usable.length} (${(high * 100).toFixed(0)}%), echo ${echo}/${usable.length} (${(low * 100).toFixed(0)}%)`,
    offenders: offenders.slice(0, 10),
  };
}

function g5(pages) {
  const usable = pages.filter((p) => !p.tooLarge);
  if (!usable.length) return { verdict: 'not_assessed', evidence: 'no pages' };
  const bad = usable.filter(
    (p) =>
      !p.title ||
      p.titleWidth < THRESHOLDS.title.min ||
      p.titleWidth > THRESHOLDS.title.max ||
      !p.desc ||
      p.descWidth < THRESHOLDS.description.min ||
      p.descWidth > THRESHOLDS.description.max,
  );
  return {
    verdict: bad.length ? 'warn' : 'pass',
    evidence: `${bad.length}/${usable.length} outside title ${THRESHOLDS.title.min}-${THRESHOLDS.title.max} / desc ${THRESHOLDS.description.min}-${THRESHOLDS.description.max}`,
    findings: bad.map((p) => ({ rel: p.rel, titleWidth: p.titleWidth, descWidth: p.descWidth })),
  };
}

function g6(pages) {
  const usable = pages.filter((p) => !p.tooLarge);
  if (!usable.length) return { verdict: 'not_assessed', evidence: 'no pages' };
  const none = usable.filter((p) => p.h1Count === 0);
  const many = usable.filter((p) => p.h1Count > 1);
  const v = none.length ? 'fail' : many.length ? 'warn' : 'pass';
  return {
    verdict: v,
    evidence: `h1=0 on ${none.length}, h1>1 on ${many.length}, ok ${usable.length - none.length - many.length}`,
    findings: [...none.map((p) => ({ rel: p.rel, issue: 'no h1' })), ...many.map((p) => ({ rel: p.rel, issue: `${p.h1Count} h1` }))].slice(0, 20),
  };
}

function g7(pages) {
  const usable = pages.filter((p) => !p.tooLarge);
  if (!usable.length) return { verdict: 'not_assessed', evidence: 'no pages' };
  const invalid = usable.filter((p) => p.jsonldError);
  const withType = usable.filter((p) => p.jsonldTypes.length);
  const v = invalid.length ? 'fail' : withType.length === 0 ? 'warn' : 'pass';
  const types = [...new Set(usable.flatMap((p) => p.jsonldTypes))].slice(0, 12);
  return {
    verdict: v,
    evidence: `pages with JSON-LD ${withType.length}/${usable.length}; parse errors ${invalid.length}; types: ${types.join(', ') || 'none'}`,
    findings: invalid.map((p) => ({ rel: p.rel, error: p.jsonldError })),
  };
}

function g11(pages, root) {
  const usable = pages.filter((p) => !p.tooLarge);
  if (!usable.length) return { verdict: 'not_assessed', evidence: 'no pages' };
  const counts = new Map(usable.map((p) => [p.file, 0]));
  for (const p of usable) {
    for (const href of p.links) {
      const target = resolveTarget(root, p, href);
      if (counts.has(target)) counts.set(target, counts.get(target) + 1);
    }
  }
  const zero = usable.filter((p) => counts.get(p.file) === 0);
  const low = usable.filter((p) => counts.get(p.file) > 0 && counts.get(p.file) < THRESHOLDS.inlinks.warn);
  const v = zero.length ? 'fail' : low.length ? 'warn' : 'pass';
  const min = Math.min(...[...counts.values()]);
  return {
    verdict: v,
    evidence: `inlinks min ${min} (need ≥${THRESHOLDS.inlinks.warn}); zero ${zero.length}, <${THRESHOLDS.inlinks.warn} ${low.length}`,
    findings: [...zero.map((p) => ({ rel: p.rel, inlinks: 0 })), ...low.map((p) => ({ rel: p.rel, inlinks: counts.get(p.file) }))].slice(0, 20),
  };
}

function sitemapCheck(root) {
  const files = findSitemaps(root);
  if (!files.length) {
    return { verdict: 'warn', evidence: 'no sitemap*.xml found', facts: {} };
  }
  const { locs, lastmods, bytes } = readSitemaps(root, files);
  const uniq = new Set(locs);
  const missing = locs.map((l) => locToPath(root, l)).filter((p) => p && !existsSync(p));
  const overUrls = locs.length > THRESHOLDS.sitemap.maxUrls;
  const overBytes = bytes > THRESHOLDS.sitemap.maxBytes;
  const uniform = lastmods.length > 1 && new Set(lastmods).size === 1;
  let v = 'pass';
  if (overUrls || overBytes) v = 'fail';
  else if (uniq.size !== locs.length || missing.length || uniform) v = 'warn';
  return {
    verdict: v,
    evidence: `${files.length} file(s), ${locs.length} urls, dup ${locs.length - uniq.size}, unresolved ${missing.length}, bytes ${bytes}`,
    facts: { uniformLastmod: uniform, missing: missing.slice(0, 10).map((p) => relative(root, p)) },
  };
}

// --------------------------------------------------------------------- report
function fmtTable(rows) {
  const head = ['GATE', 'VERDICT', 'EVIDENCE'];
  const widths = [6, 13, 0];
  const line = (a, b, c) =>
    `${a.padEnd(widths[0])}  ${b.padEnd(widths[1])}  ${c}`;
  return [line(...head), line('-'.repeat(6), '-'.repeat(13), '-'.repeat(40)), ...rows.map((r) => line(...r))].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => !a.startsWith('--'));
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');

  if (!dirArg) {
    console.error('usage: node scripts/audit.mjs <dir> [--json] [--quiet]');
    process.exit(2);
  }
  const root = resolve(dirArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`not a directory: ${root}`);
    process.exit(2);
  }

  let files;
  try {
    files = walk(root);
  } catch (e) {
    console.error(`cannot read ${root}: ${e.message}`);
    process.exit(2);
  }
  if (!files.length) {
    console.error(`no .html files under ${root}`);
    process.exit(2);
  }

  const pages = files.map((f) => parsePage(f, root)).sort((a, b) => a.rel.localeCompare(b.rel));

  const gates = {};
  gates.G1 = {
    verdict: 'not_assessed',
    evidence: `needs HTTP + GSC. offline signal: noindex ${pages.filter((p) => /noindex/i.test(p.robots)).length}, missing canonical ${pages.filter((p) => !p.canonical).length}`,
  };
  gates.G2 = g2(pages);
  gates.G3 = { verdict: 'not_assessed', evidence: 'needs semantic comparison against the nearest sibling page' };
  gates.G4 = g4(pages);
  gates.G5 = g5(pages);
  gates.G6 = g6(pages);
  gates.G7 = g7(pages);
  gates.G8 = { verdict: 'not_assessed', evidence: 'needs lab/field CWV; offline signal: JS shell present on ' + pages.filter((p) => p.hasScript).length + '/' + pages.length + ' pages' };
  gates.G9 = { verdict: 'not_assessed', evidence: 'needs DOM/browser audit: labels, 24x24 targets, persistent result' };
  gates.G10 = { verdict: 'not_assessed', evidence: 'needs HTTP: empty combinations must return 404/410' };
  gates.G11 = g11(pages, root);
  gates.G12 = { verdict: 'not_assessed', evidence: 'needs GSC/GA4 access' };

  const sm = sitemapCheck(root);

  const counts = { pass: 0, warn: 0, fail: 0, not_assessed: 0 };
  for (const g of Object.values(gates)) counts[g.verdict]++;

  const result = {
    tool: 'tool-site-seo audit',
    version: '1.0.0',
    root,
    generatedAt: new Date().toISOString(),
    pages: pages.length,
    sitemap: { files: findSitemaps(root).length, urls: sm.evidence.match(/(\d+) urls/)?.[1] ? Number(sm.evidence.match(/(\d+) urls/)[1]) : 0, verdict: sm.verdict, evidence: sm.evidence, facts: sm.facts },
    gates: Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, { verdict: v.verdict, evidence: v.evidence }])),
    counts,
    findings: collectFindings(gates, pages),
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!quiet) {
    console.log(`tool-site-seo audit — ${root}`);
    console.log(`pages: ${pages.length}   sitemap: ${sm.evidence}`);
    console.log('');
    console.log(
      fmtTable([
        ['G1', gates.G1.verdict, gates.G1.evidence],
        ['G2', gates.G2.verdict, gates.G2.evidence],
        ['G3', gates.G3.verdict, gates.G3.evidence],
        ['G4', gates.G4.verdict, gates.G4.evidence],
        ['G5', gates.G5.verdict, gates.G5.evidence],
        ['G6', gates.G6.verdict, gates.G6.evidence],
        ['G7', gates.G7.verdict, gates.G7.evidence],
        ['G8', gates.G8.verdict, gates.G8.evidence],
        ['G9', gates.G9.verdict, gates.G9.evidence],
        ['G10', gates.G10.verdict, gates.G10.evidence],
        ['G11', gates.G11.verdict, gates.G11.evidence],
        ['G12', gates.G12.verdict, gates.G12.evidence],
      ]),
    );
    console.log('');
    console.log(
      `summary: pass ${counts.pass} / warn ${counts.warn} / fail ${counts.fail} / not_assessed ${counts.not_assessed}`,
    );
    console.log(`INCOMPLETE: ${counts.not_assessed} gate(s) need a human. pass here does not mean the site is ready.`);

    const findings = result.findings;
    if (findings.length) {
      console.log('');
      console.log('FINDINGS');
      for (const f of findings.slice(0, 40)) console.log(`  [${f.gate}] ${f.rel} — ${f.detail}`);
      if (findings.length > 40) console.log(`  … ${findings.length - 40} more`);
    }
  }

  process.exit(counts.fail > 0 ? 1 : 0);
}

function collectFindings(gates, pages) {
  const out = [];
  const push = (gate, rel, detail) => out.push({ gate, rel, detail });

  for (const f of gates.G5.findings || []) push('G5', f.rel, `title ${f.titleWidth}, desc ${f.descWidth}`);
  for (const f of gates.G6.findings || []) push('G6', f.rel, f.issue);
  for (const f of gates.G7.findings || []) push('G7', f.rel, `JSON-LD parse error: ${f.error}`);
  for (const f of gates.G11.findings || []) push('G11', f.rel, `${f.inlinks} internal inlinks`);
  for (const s of gates.G2.findings || []) push('G2', s.p.rel, `${s.p.words} visible words`);
  for (const rel of gates.G4.offenders || []) push('G4', rel, 'description opens with title + stock CTA');
  return out;
}

main();
