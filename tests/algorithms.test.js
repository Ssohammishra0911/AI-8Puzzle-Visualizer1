/* Run with:  node tests/algorithms.test.js
 * Checks the puzzle model, heuristics and all search algorithms.            */
'use strict';
const assert = require('assert');
const Puzzle = require('../js/puzzle');
const Heuristics = require('../js/heuristics');
const Algorithms = require('../js/algorithms');

let passed = 0;
let failed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try {
    fn();
    passed++;
    console.log('  ok   ' + name + '  (' + (Date.now() - t0) + ' ms)');
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

// deterministic random numbers so test runs are repeatable
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A returned solution must be a real chain of legal moves from start to goal.
function assertValidSolution(res, initial, goal) {
  assert.ok(res.found, res.name + ' did not find a solution (status ' + res.status + ')');
  assert.strictEqual(res.path[0], initial);
  assert.strictEqual(res.path[res.path.length - 1], goal);
  assert.strictEqual(res.moves.length, res.path.length - 1);
  for (let i = 0; i < res.path.length - 1; i++) {
    const next = Puzzle.successors(res.path[i]).find((s) => s.state === res.path[i + 1]);
    assert.ok(next, 'illegal move at step ' + i);
    assert.strictEqual(next.move, res.moves[i]);
  }
  assert.strictEqual(res.pathCost, res.moves.length);
}

const EX_I = '283164705';  // example from the assignment sheet
const EX_G = '123804765';
const STD = Puzzle.STANDARD_GOAL;

console.log('Puzzle model');
test('successor counts: corner 2, edge 3, centre 4', () => {
  assert.strictEqual(Puzzle.successors('012345678').length, 2);
  assert.strictEqual(Puzzle.successors('102345678').length, 3);
  assert.strictEqual(Puzzle.successors('123405678').length, 4);
});
test('isSolvable / unsolvable (swap two tiles)', () => {
  assert.ok(Puzzle.isSolvable(EX_I, EX_G));
  assert.ok(!Puzzle.isSolvable('213456780', STD));
  assert.ok(!Puzzle.isSolvable('123456870', STD));
});
test('randomPuzzle is always valid, solvable and not the goal', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 300; i++) {
    const p = Puzzle.randomPuzzle(STD, 1 + (i % 40), rng);
    assert.ok(Puzzle.isValidState(p));
    assert.ok(Puzzle.isSolvable(p, STD));
    assert.notStrictEqual(p, STD);
  }
});
test('heuristics on the textbook example', () => {
  assert.strictEqual(Heuristics.make('misplaced', EX_G)(EX_I), 4);
  assert.strictEqual(Heuristics.make('manhattan', EX_G)(EX_I), 5);
  assert.strictEqual(Heuristics.make('manhattan', EX_G)(EX_G), 0);
});

console.log('Algorithms on the textbook example (optimal = 5 moves)');
test('BFS, UCS, IDDLS, A* (both heuristics) are optimal', () => {
  ['bfs', 'ucs', 'iddls'].forEach((a) => {
    const r = Algorithms.run(a, EX_I, EX_G);
    assertValidSolution(r, EX_I, EX_G);
    assert.strictEqual(r.moves.length, 5, a);
  });
  ['misplaced', 'manhattan'].forEach((h) => {
    const r = Algorithms.run('astar', EX_I, EX_G, { heuristic: h });
    assertValidSolution(r, EX_I, EX_G);
    assert.strictEqual(r.moves.length, 5, 'astar ' + h);
  });
});
test('GBFS and DFS find valid (not necessarily shortest) solutions', () => {
  ['misplaced', 'manhattan'].forEach((h) => {
    const r = Algorithms.run('gbfs', EX_I, EX_G, { heuristic: h });
    assertValidSolution(r, EX_I, EX_G);
    assert.ok(r.moves.length >= 5);
  });
  const d = Algorithms.run('dfs', EX_I, EX_G);
  assertValidSolution(d, EX_I, EX_G);
  assert.ok(d.moves.length >= 5);
});
test('DLS: limit 4 -> cutoff, limit 5 -> found in 5, limit 12 -> found', () => {
  const a = Algorithms.run('dls', EX_I, EX_G, { limit: 4 });
  assert.strictEqual(a.status, 'cutoff');
  assert.ok(!a.found);
  const b = Algorithms.run('dls', EX_I, EX_G, { limit: 5 });
  assertValidSolution(b, EX_I, EX_G);
  assert.strictEqual(b.moves.length, 5);
  const c = Algorithms.run('dls', EX_I, EX_G, { limit: 12 });
  assertValidSolution(c, EX_I, EX_G);
  assert.ok(c.moves.length >= 5 && c.moves.length <= 12);
});
test('DLS edge cases: start == goal, limit 0', () => {
  const same = Algorithms.run('dls', STD, STD, { limit: 0 });
  assert.ok(same.found);
  assert.strictEqual(same.moves.length, 0);
  const cut = Algorithms.run('dls', EX_I, EX_G, { limit: 0 });
  assert.strictEqual(cut.status, 'cutoff');
  assert.strictEqual(cut.stats.expanded, 0);
});
test('DLS never goes deeper than its limit', () => {
  const r = Algorithms.run('dls', STD, '867254301', { limit: 6 });
  assert.ok(r.stats.maxDepth <= 6);
});
test('DLS re-expands a state reached by a shallower path (no missed solutions)', () => {
  // For many puzzles, DLS at the optimal depth must succeed.
  const rng = mulberry32(99);
  for (let i = 0; i < 40; i++) {
    const p = Puzzle.randomPuzzle(STD, 14, rng);
    const opt = Algorithms.run('bfs', p, STD).moves.length;
    const r = Algorithms.run('dls', p, STD, { limit: opt });
    assert.ok(r.found, 'DLS limit=' + opt + ' missed the solution for ' + p);
    assert.strictEqual(r.moves.length, opt);
    if (opt > 0) {
      assert.strictEqual(Algorithms.run('dls', p, STD, { limit: opt - 1 }).status, 'cutoff');
    }
  }
});

console.log('Agreement and statistics');
test('optimal algorithms agree on 60 random puzzles; A* beats BFS on average', () => {
  const rng = mulberry32(2024);
  let bfsExp = 0, aM = 0, aT = 0;
  for (let i = 0; i < 60; i++) {
    // scrambles of 14-24 moves => optimal depth <= 24, which IDDLS can finish within the cap
    const p = Puzzle.randomPuzzle(STD, 14 + (i % 11), rng);
    const b = Algorithms.run('bfs', p, STD);
    const u = Algorithms.run('ucs', p, STD);
    const id = Algorithms.run('iddls', p, STD, { maxDepth: 31 });
    const am = Algorithms.run('astar', p, STD, { heuristic: 'manhattan' });
    const at = Algorithms.run('astar', p, STD, { heuristic: 'misplaced' });
    [b, u, id, am, at].forEach((r) => assertValidSolution(r, p, STD));
    const n = b.moves.length;
    assert.strictEqual(u.moves.length, n);
    assert.strictEqual(id.moves.length, n);
    assert.strictEqual(am.moves.length, n);
    assert.strictEqual(at.moves.length, n);
    const g = Algorithms.run('gbfs', p, STD, { heuristic: 'manhattan' });
    assertValidSolution(g, p, STD);
    assert.ok(g.moves.length >= n);
    bfsExp += b.stats.expanded; aM += am.stats.expanded; aT += at.stats.expanded;
  }
  assert.ok(aM <= aT, 'Manhattan should expand no more than Misplaced overall');
  assert.ok(aT <= bfsExp, 'A* should expand no more than BFS overall');
});
test('hardest 8-puzzle instance needs 31 moves (BFS == A*)', () => {
  const hard = '867254301';
  const b = Algorithms.run('bfs', hard, STD);
  assertValidSolution(b, hard, STD);
  assert.strictEqual(b.moves.length, 31);
  const a = Algorithms.run('astar', hard, STD, { heuristic: 'manhattan' });
  assert.strictEqual(a.moves.length, 31);
  assert.ok(a.stats.expanded < b.stats.expanded);
});
test('node limit stops runaway searches (IDDLS on the hardest puzzle)', () => {
  const r = Algorithms.run('iddls', '867254301', STD, { maxDepth: 31 });
  assert.ok(['limit', 'found'].indexOf(r.status) >= 0);
  assert.ok(r.stats.expanded <= Algorithms.MAX_EXPANSIONS);
});
test('unsolvable puzzle: BFS exhausts the 181,440 reachable states', () => {
  const r = Algorithms.run('bfs', '213456780', STD);
  assert.strictEqual(r.status, 'failure');
  assert.strictEqual(r.stats.expanded, 181440);
});

console.log('Trace recording');
test('recording does not change the search; goal frame is last', () => {
  ['bfs', 'dfs', 'dls', 'iddls', 'ucs', 'gbfs', 'astar'].forEach((a) => {
    const opts = { limit: 8, heuristic: 'manhattan' };
    const plain = Algorithms.run(a, EX_I, EX_G, opts);
    const traced = Algorithms.run(a, EX_I, EX_G, Object.assign({ record: true }, opts));
    assert.deepStrictEqual(traced.stats, plain.stats, a + ' stats differ');
    assert.deepStrictEqual(traced.path, plain.path, a + ' path differs');
    assert.ok(traced.frames.length > 0);
    assert.ok(traced.frames.length <= Algorithms.MAX_FRAMES + 2);
    const last = traced.frames[traced.frames.length - 1];
    assert.strictEqual(last.type, 'goal', a);
    assert.strictEqual(last.state, EX_G);
    traced.frames.forEach((f) => {
      assert.ok(Puzzle.isValidState(f.state));
      assert.ok(f.frontier.length <= Algorithms.PREVIEW);
    });
  });
});
test('long traces are shortened and flagged; end frame for failures', () => {
  const r = Algorithms.run('bfs', '867254301', STD, { record: true });
  assert.ok(r.truncated);
  assert.ok(r.frames.some((f) => f.type === 'truncated'));
  assert.strictEqual(r.frames[r.frames.length - 1].type, 'goal');
  const dls = Algorithms.run('dls', EX_I, EX_G, { limit: 3, record: true });
  assert.strictEqual(dls.status, 'cutoff');
  assert.strictEqual(dls.frames[dls.frames.length - 1].type, 'end');
  assert.ok(dls.frames.some((f) => f.type === 'cutoff'));
});
test('runWithTrace returns timing from the un-recorded run', () => {
  const r = Algorithms.runWithTrace('astar', EX_I, EX_G, { heuristic: 'manhattan' });
  assert.ok(r.frames.length > 0);
  assert.ok(r.time >= 0);
  assert.ok(r.memory.nodes > 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
