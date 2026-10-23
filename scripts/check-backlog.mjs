#!/usr/bin/env node
// Validates docs/backlog/NNNN-*.md tickets: frontmatter shape, unique ids, required
// sections. CI and every agent run this. Exit 1 with a list of problems on failure.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'docs/backlog';
const ENUMS = {
  status: ['proposed', 'ready', 'in-progress', 'shipped', 'dropped'],
  priority: ['P0', 'P1', 'P2'],
  size: ['S', 'M', 'L'],
  lens: ['player-feel', 'content', 'authenticity', 'performance', 'accessibility', 'tech-health', 'platform'],
};
const SECTIONS = ['## Why', '## What', '## Acceptance criteria', '## Test plan'];

const problems = [];
const ids = new Map();
const files = readdirSync(DIR).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();

for (const file of files) {
  const text = readFileSync(join(DIR, file), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) { problems.push(`${file}: missing frontmatter`); continue; }
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*?)\s*(#.*)?$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  const id = fm.id;
  if (!/^\d{4}$/.test(id || '')) problems.push(`${file}: id must be 4 digits`);
  else if (!file.startsWith(id + '-')) problems.push(`${file}: filename must start with id ${id}`);
  if (ids.has(id)) problems.push(`${file}: duplicate id ${id} (also ${ids.get(id)})`);
  ids.set(id, file);
  if (!fm.title) problems.push(`${file}: title required`);
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(fm[k])) problems.push(`${file}: ${k} must be one of ${allowed.join('|')} (got "${fm[k] ?? ''}")`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.created || '')) problems.push(`${file}: created must be YYYY-MM-DD`);
  if (fm.status === 'shipped' && !/^#?\d+$/.test(fm.pr || '')) problems.push(`${file}: shipped tickets need pr: <number>`);
  if (fm.by && !['scout', 'critic', 'operator', 'builder'].includes(fm.by)) problems.push(`${file}: by must be scout|critic|operator|builder (got "${fm.by}")`);
  for (const s of SECTIONS) if (!text.includes(s)) problems.push(`${file}: missing section "${s}"`);
  if (fm.status === 'ready' && !/- \[[ x]\] /.test(text)) problems.push(`${file}: ready tickets need checkbox acceptance criteria`);
}

if (problems.length) {
  console.error(`check-backlog: ${problems.length} problem(s)\n  ` + problems.join('\n  '));
  process.exit(1);
}
const ready = files.filter((f) => /\nstatus:\s*ready/.test(readFileSync(join(DIR, f), 'utf8'))).length;
console.log(`check-backlog: ${files.length} tickets OK (${ready} ready)`);
