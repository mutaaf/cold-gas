// A D1 binding over Node's built-in SQLite (node:sqlite): the same SQL dialect as D1, so the
// Worker's UPSERTs, RETURNING and GROUP BYs run for real in the unit tests.
import { DatabaseSync } from 'node:sqlite';

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    run: async () => exec(sql, args),
    all: async () => exec(sql, args),
    first: async () => exec(sql, args).results[0] ?? null,
  });
  function exec(sql, args) {
    const s = db.prepare(sql);
    if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) return { results: s.all(...args).map((r) => ({ ...r })), success: true };
    s.run(...args);
    return { results: [], success: true };
  }
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { const r = list.map((x) => exec(x.sql, x.args)); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
