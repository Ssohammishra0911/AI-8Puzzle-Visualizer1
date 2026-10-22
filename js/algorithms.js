/* algorithms.js — search algorithms for the 8-puzzle, written from scratch.
 *
 *   bfs    Breadth First Search            (FIFO queue)
 *   dfs    Depth First Search              (LIFO stack, visited set)
 *   dls    Depth Limited Search            (DFS that never goes below `limit`)
 *   iddls  Iterative Deepening DLS         (DLS with limit 0, 1, 2, ...)
 *   ucs    Uniform Cost Search             (priority queue on g)
 *   gbfs   Greedy Best First Search        (priority queue on h)
 *   astar  A* Search                       (priority queue on f = g + h)
 *
 * Every algorithm runs to completion and (optionally) records a TRACE: an array
 * of "frames", one per node expansion, holding exactly what the UI needs to
 * replay the search (current node, successors, frontier, explored list, ...).
 * The UI then just steps through the frames, which gives Run / Pause / Resume /
 * Next / Previous / Reset for free.
 *
 * Conventions
 *   - Every move costs 1, so g(n) = depth(n) = number of moves from the start.
 *   - The goal test is applied when a node is taken off the frontier (at
 *     expansion time), for all algorithms.
 *   - "Generated" counts every successor the successor function produces
 *     (including duplicates that are then discarded) plus the root.
 *   - Result status: 'found' | 'cutoff' | 'failure' | 'limit'
 *       cutoff  : DLS/IDDLS hit its depth limit without finding the goal, so a
 *                 deeper solution may still exist
 *       failure : the reachable state space was exhausted (no solution exists)
 *       limit   : stopped after MAX_EXPANSIONS expansions (safety cap)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./puzzle'), require('./heuristics'));
  } else {
    root.Algorithms = factory(root.Puzzle, root.Heuristics);
  }
})(typeof self !== 'undefined' ? self : this, function (Puzzle, Heuristics) {
  'use strict';

  // Safety cap.  Graph-search algorithms (BFS, DFS, UCS, GBFS, A*) can never reach it
  // because the 8-puzzle has only 181,440 reachable states; it only matters for
  // DLS/IDDLS, which re-expand states.  IDDLS needs ~1.5x more expansions per extra
  // solution depth, so 1,000,000 covers solutions up to roughly 24 moves deep.
  var MAX_EXPANSIONS = 1000000;
  var MAX_FRAMES = 3000;       // trace frames kept for the animation
  var PREVIEW = 25;            // frontier / explored entries stored per frame
  var BYTES_PER_NODE = 72;     // rough size of one stored node, for the memory estimate

  var NAMES = {
    bfs: 'Breadth First Search (BFS)',
    dfs: 'Depth First Search (DFS)',
    dls: 'Depth Limited Search (DLS)',
    iddls: 'Iterative Deepening DLS (IDDLS)',
    ucs: 'Uniform Cost Search (UCS)',
    gbfs: 'Greedy Best First Search (GBFS)',
    astar: 'A* Search'
  };

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function mkNode(state, parent, depth, g, h, move) {
    return { state: state, parent: parent, depth: depth, g: g, h: h, f: g + h, move: move };
  }

  function entry(n) {
    return { s: n.state, d: n.depth, g: n.g, h: n.h, f: n.f };
  }

  /** Follow parent pointers back to the root. */
  function extractPath(node) {
    var path = [];
    var moves = [];
    for (var n = node; n; n = n.parent) {
      path.push(n.state);
      if (n.move) moves.push(n.move);
    }
    path.reverse();
    moves.reverse();
    return { path: path, moves: moves };
  }

  function newStats() {
    return { generated: 0, expanded: 0, maxDepth: 0, peakStored: 0, duplicates: 0, cutoffs: 0 };
  }

  /** Binary min-heap ordered by (k1, k2, insertion order). */
  function MinHeap() {
    this.a = [];
    this.seq = 0;
  }
  MinHeap.less = function (x, y) {
    if (x.k1 !== y.k1) return x.k1 < y.k1;
    if (x.k2 !== y.k2) return x.k2 < y.k2;
    return x.seq < y.seq;
  };
  Object.defineProperty(MinHeap.prototype, 'size', { get: function () { return this.a.length; } });
  MinHeap.prototype.push = function (node, k1, k2) {
    var item = { k1: k1, k2: k2 || 0, seq: this.seq++, node: node };
    var a = this.a;
    var i = a.length;
    a.push(item);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (MinHeap.less(item, a[p])) { a[i] = a[p]; i = p; } else break;
    }
    a[i] = item;
  };
  MinHeap.prototype.pop = function () {
    var a = this.a;
    var top = a[0];
    var last = a.pop();
    if (a.length) {
      var i = 0;
      var n = a.length;
      for (;;) {
        var l = 2 * i + 1;
        if (l >= n) break;
        var r = l + 1;
        var m = (r < n && MinHeap.less(a[r], a[l])) ? r : l;
        if (MinHeap.less(a[m], last)) { a[i] = a[m]; i = m; } else break;
      }
      a[i] = last;
    }
    return top;
  };
  /** The k highest-priority items, in order, without removing them. */
  MinHeap.prototype.smallest = function (k) {
    var a = this.a;
    var n = a.length;
    var out = [];
    if (!n) return out;
    var cand = [0];
    while (out.length < k && cand.length) {
      var bi = 0;
      for (var i = 1; i < cand.length; i++) {
        if (MinHeap.less(a[cand[i]], a[cand[bi]])) bi = i;
      }
      var idx = cand.splice(bi, 1)[0];
      out.push(a[idx]);
      var l = 2 * idx + 1;
      if (l < n) cand.push(l);
      if (l + 1 < n) cand.push(l + 1);
    }
    return out;
  };

  /** Collects trace frames, bounded to MAX_FRAMES. */
  function makeRecorder(record) {
    var frames = [];
    var truncated = false;
    return {
      record: record,
      frames: frames,
      get truncated() { return truncated; },
      /** Cheap check so callers skip building a frame that would be dropped. */
      wants: function () { return record && !truncated; },
      add: function (frame) {
        if (!record) return;
        if (frames.length < MAX_FRAMES) { frames.push(frame); return; }
        if (!truncated) {
          truncated = true;
          frames.push(Object.assign({}, frame, {
            type: 'truncated',
            successors: [],
            note: 'Trace shortened: only the first ' + MAX_FRAMES +
              ' steps are animated. The search itself ran to completion.'
          }));
        }
      },
      /** Always kept (goal frame, end frame). */
      force: function (frame) { if (record) frames.push(frame); }
    };
  }

  function frameOf(type, node, stats, fr, ex, succ, extra) {
    return Object.assign({
      type: type,
      state: node.state,
      parent: node.parent ? node.parent.state : null,
      move: node.move || null,
      depth: node.depth, g: node.g, h: node.h, f: node.f,
      generated: stats.generated, expanded: stats.expanded, duplicates: stats.duplicates,
      frontierSize: fr.size, frontier: fr.items,
      exploredSize: ex.size, explored: ex.items,
      successors: succ || []
    }, extra || {});
  }

  function finish(status, node, stats, rec, initial, extra) {
    var path = [];
    var moves = [];
    if (node) {
      var p = extractPath(node);
      path = p.path;
      moves = p.moves;
    }
    if (status !== 'found' && rec.record) {
      var last = rec.frames[rec.frames.length - 1];
      rec.force({
        type: 'end', status: status, state: initial, parent: null, move: null,
        depth: 0, g: 0, h: 0, f: 0,
        generated: stats.generated, expanded: stats.expanded, duplicates: stats.duplicates,
        frontierSize: last ? last.frontierSize : 0, frontier: last ? last.frontier : [],
        exploredSize: last ? last.exploredSize : 0, explored: last ? last.explored : [],
        successors: []
      });
    }
    return Object.assign({
      status: status,
      found: status === 'found',
      path: path,
      moves: moves,
      pathCost: node ? node.g : null,
      stats: stats,
      frames: rec.frames,
      truncated: rec.truncated
    }, extra || {});
  }

  /* ------------------------------------------------------------------ */
  /* Breadth First Search                                                */
  /* ------------------------------------------------------------------ */

  function bfs(initial, goal, opts, rec) {
    var stats = newStats();
    var queue = [mkNode(initial, null, 0, 0, 0, null)];
    var head = 0;
    var seen = new Set([initial]); // states in the queue or already expanded
    var order = [];                // expansion order = explored list
    stats.generated = 1;
    stats.peakStored = 1;

    function fview() { return { size: queue.length - head, items: queue.slice(head, head + PREVIEW).map(entry) }; }
    function eview() { return { size: order.length, items: order.slice(-PREVIEW) }; }

    while (head < queue.length) {
      var node = queue[head++];
      if (node.state === goal) {
        if (rec.record) rec.force(frameOf('goal', node, stats, fview(), eview(), []));
        return finish('found', node, stats, rec, initial);
      }
      if (stats.expanded >= opts.maxExpansions) return finish('limit', null, stats, rec, initial);
      stats.expanded++;
      order.push(node.state);

      var succ = [];
      var succs = Puzzle.successors(node.state);
      for (var k = 0; k < succs.length; k++) {
        var s = succs[k];
        var cd = node.depth + 1;
        stats.generated++;
        if (seen.has(s.state)) {
          stats.duplicates++;
          succ.push({ state: s.state, move: s.move, status: 'duplicate' });
          continue;
        }
        seen.add(s.state);
        queue.push(mkNode(s.state, node, cd, cd, 0, s.move));
        if (cd > stats.maxDepth) stats.maxDepth = cd;
        succ.push({ state: s.state, move: s.move, status: 'new', g: cd, h: 0, f: cd });
      }
      var stored = (queue.length - head) + order.length;
      if (stored > stats.peakStored) stats.peakStored = stored;
      if (rec.wants()) rec.add(frameOf('expand', node, stats, fview(), eview(), succ));
    }
    return finish('failure', null, stats, rec, initial);
  }

  /* ------------------------------------------------------------------ */
  /* Depth-first family: DFS, DLS, IDDLS share one engine                */
  /* ------------------------------------------------------------------ */

  /**
   * One depth-first pass.
   *   mode 'graph' : classic DFS with a visited set — a state is expanded once.
   *   mode 'depth' : depth-limited search.  A state is skipped only if it was
   *                  already expanded at the same or a SHALLOWER depth; reaching
   *                  it again via a shorter path re-expands it, because it then
   *                  has more depth budget left.  (A plain visited set would
   *                  wrongly miss solutions here.)
   * Nodes at depth == limit are tested for the goal but never expanded; if one
   * is hit the pass reports 'cutoff' instead of 'failure'.
   */
  function depthLimited(initial, goal, limit, opts, rec, stats, mode) {
    var stack = [mkNode(initial, null, 0, 0, 0, null)];
    var expandedAt = new Map(); // state -> depth at which it was expanded
    var order = [];
    var cutoff = false;
    var lim = isFinite(limit) ? limit : null;
    stats.generated += 1; // the root
    if (stats.peakStored < 1) stats.peakStored = 1;

    function fview() { return { size: stack.length, items: stack.slice(-PREVIEW).reverse().map(entry) }; }
    function eview() { return { size: order.length, items: order.slice(-PREVIEW) }; }

    while (stack.length) {
      var node = stack.pop();

      if (node.state === goal) {
        if (rec.record) rec.force(frameOf('goal', node, stats, fview(), eview(), [], { limit: lim }));
        return { outcome: 'found', node: node };
      }

      var prevDepth = expandedAt.get(node.state);
      if (prevDepth !== undefined && (mode === 'graph' || prevDepth <= node.depth)) {
        stats.duplicates++;
        continue;
      }

      if (node.depth >= limit) {
        cutoff = true;
        stats.cutoffs++;
        if (rec.wants()) rec.add(frameOf('cutoff', node, stats, fview(), eview(), [], { limit: lim }));
        continue;
      }

      if (stats.expanded >= opts.maxExpansions) return { outcome: 'limit', node: null };
      stats.expanded++;
      expandedAt.set(node.state, node.depth);
      order.push(node.state);

      var succ = [];
      var kids = [];
      var succs = Puzzle.successors(node.state);
      var cd = node.depth + 1;
      for (var k = 0; k < succs.length; k++) {
        var s = succs[k];
        stats.generated++;
        var bd = expandedAt.get(s.state);
        if (bd !== undefined && (mode === 'graph' || bd <= cd)) {
          stats.duplicates++;
          succ.push({ state: s.state, move: s.move, status: 'duplicate' });
          continue;
        }
        kids.push(mkNode(s.state, node, cd, cd, 0, s.move));
        if (cd > stats.maxDepth) stats.maxDepth = cd;
        succ.push({ state: s.state, move: s.move, status: cd >= limit ? 'limit' : 'new', g: cd, h: 0, f: cd });
      }
      // push in reverse so the first move (Up) is explored first
      for (var j = kids.length - 1; j >= 0; j--) stack.push(kids[j]);

      var stored = stack.length + expandedAt.size;
      if (stored > stats.peakStored) stats.peakStored = stored;
      if (rec.wants()) rec.add(frameOf('expand', node, stats, fview(), eview(), succ, { limit: lim }));
    }
    return { outcome: cutoff ? 'cutoff' : 'failure', node: null };
  }

  function dfs(initial, goal, opts, rec) {
    var stats = newStats();
    var r = depthLimited(initial, goal, Infinity, opts, rec, stats, 'graph');
    return finish(r.outcome, r.node, stats, rec, initial);
  }

  function dls(initial, goal, opts, rec) {
    var stats = newStats();
    var r = depthLimited(initial, goal, opts.limit, opts, rec, stats, 'depth');
    return finish(r.outcome, r.node, stats, rec, initial, { limitUsed: opts.limit });
  }

  function iddls(initial, goal, opts, rec) {
    var stats = newStats();
    for (var L = 0; L <= opts.maxDepth; L++) {
      if (rec.wants()) {
        rec.add({
          type: 'iteration', limit: L, state: initial, parent: null, move: null,
          depth: 0, g: 0, h: 0, f: 0,
          generated: stats.generated, expanded: stats.expanded, duplicates: stats.duplicates,
          frontierSize: 1, frontier: [{ s: initial, d: 0, g: 0, h: 0, f: 0 }],
          exploredSize: 0, explored: [], successors: []
        });
      }
      var r = depthLimited(initial, goal, L, opts, rec, stats, 'depth');
      if (r.outcome === 'found') return finish('found', r.node, stats, rec, initial, { limitUsed: L });
      if (r.outcome === 'limit') return finish('limit', null, stats, rec, initial, { limitUsed: L });
      if (r.outcome === 'failure') return finish('failure', null, stats, rec, initial, { limitUsed: L });
      // outcome 'cutoff' -> try the next limit
    }
    return finish('cutoff', null, stats, rec, initial, { limitUsed: opts.maxDepth });
  }

  /* ------------------------------------------------------------------ */
  /* Best-first family: UCS, GBFS, A*                                    */
  /* ------------------------------------------------------------------ */

  function bestFirst(kind, initial, goal, opts, rec) {
    var stats = newStats();
    var h = kind === 'ucs' ? function () { return 0; } : Heuristics.make(opts.heuristic, goal);
    var heap = new MinHeap();
    var bestG = new Map();   // cheapest g seen for each generated state
    var closed = new Set();  // expanded states
    var order = [];

    function push(node) {
      if (kind === 'ucs') heap.push(node, node.g, 0);
      else if (kind === 'gbfs') heap.push(node, node.h, 0);
      else heap.push(node, node.f, node.h); // A*: lowest f, ties -> lowest h
    }
    function fview() {
      var items = heap.smallest(PREVIEW)
        .filter(function (it) { return !closed.has(it.node.state); })
        .map(function (it) { return entry(it.node); });
      return { size: heap.size, items: items };
    }
    function eview() { return { size: order.length, items: order.slice(-PREVIEW) }; }

    var root = mkNode(initial, null, 0, 0, h(initial), null);
    push(root);
    bestG.set(initial, 0);
    stats.generated = 1;
    stats.peakStored = 1;

    while (heap.size) {
      var node = heap.pop().node;
      if (closed.has(node.state)) continue; // stale duplicate entry

      if (node.state === goal) {
        if (rec.record) rec.force(frameOf('goal', node, stats, fview(), eview(), []));
        return finish('found', node, stats, rec, initial);
      }
      if (stats.expanded >= opts.maxExpansions) return finish('limit', null, stats, rec, initial);

      closed.add(node.state);
      stats.expanded++;
      order.push(node.state);

      var succ = [];
      var succs = Puzzle.successors(node.state);
      for (var k = 0; k < succs.length; k++) {
        var s = succs[k];
        var g2 = node.g + 1;
        stats.generated++;
        var known = bestG.get(s.state);
        if (closed.has(s.state) || (known !== undefined && (kind === 'gbfs' || g2 >= known))) {
          stats.duplicates++;
          succ.push({ state: s.state, move: s.move, status: 'duplicate' });
          continue;
        }
        bestG.set(s.state, g2);
        var hv = h(s.state);
        var child = mkNode(s.state, node, g2, g2, hv, s.move);
        push(child);
        if (g2 > stats.maxDepth) stats.maxDepth = g2;
        succ.push({ state: s.state, move: s.move, status: 'new', g: g2, h: hv, f: g2 + hv });
      }
      var stored = heap.size + closed.size;
      if (stored > stats.peakStored) stats.peakStored = stored;
      if (rec.wants()) rec.add(frameOf('expand', node, stats, fview(), eview(), succ));
    }
    return finish('failure', null, stats, rec, initial);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  function memoryEstimate(stats) {
    var nodes = stats.peakStored;
    return {
      nodes: nodes,
      bytes: nodes * BYTES_PER_NODE,
      label: nodes < 1000 ? 'Low' : nodes < 20000 ? 'Medium' : 'High'
    };
  }

  function execute(name, initial, goal, opts, rec) {
    switch (name) {
      case 'bfs': return bfs(initial, goal, opts, rec);
      case 'dfs': return dfs(initial, goal, opts, rec);
      case 'dls': return dls(initial, goal, opts, rec);
      case 'iddls': return iddls(initial, goal, opts, rec);
      case 'ucs': return bestFirst('ucs', initial, goal, opts, rec);
      case 'gbfs': return bestFirst('gbfs', initial, goal, opts, rec);
      case 'astar': return bestFirst('astar', initial, goal, opts, rec);
      default: throw new Error('Unknown algorithm: ' + name);
    }
  }

  /**
   * Run one algorithm.
   * options: { limit (DLS), maxDepth (IDDLS), heuristic ('misplaced'|'manhattan'),
   *            maxExpansions, record (build the animation trace),
   *            timing (repeat very fast searches and report the average time,
   *                    because browsers round performance.now() to ~0.1 ms) }
   */
  function run(name, initial, goal, options) {
    var opts = Object.assign(
      { limit: 5, maxDepth: 31, heuristic: 'manhattan', maxExpansions: MAX_EXPANSIONS, record: false, timing: false },
      options || {}
    );
    opts.limit = Number(opts.limit);
    if (!isFinite(opts.limit) || opts.limit < 0) opts.limit = 5;
    opts.limit = Math.floor(opts.limit);
    opts.maxDepth = Math.max(0, Math.floor(Number(opts.maxDepth)) || 0);

    var t0 = now();
    var res = execute(name, initial, goal, opts, makeRecorder(!!opts.record));
    res.time = now() - t0;
    if (opts.timing && !opts.record && res.time < 5) {
      var total = res.time;
      var runs = 1;
      while (total < 20 && runs < 2000) {
        var t1 = now();
        execute(name, initial, goal, opts, makeRecorder(false));
        total += now() - t1;
        runs++;
      }
      res.time = total / runs;
    }
    res.name = name;
    res.initial = initial;
    res.goal = goal;
    res.params = { limit: opts.limit, maxDepth: opts.maxDepth, heuristic: opts.heuristic };
    res.memory = memoryEstimate(res.stats);
    return res;
  }

  /**
   * Run twice: once without recording (accurate timing) and once with recording
   * (animation frames).  The search is deterministic, so both runs are identical.
   */
  function runWithTrace(name, initial, goal, options) {
    var timed = run(name, initial, goal, Object.assign({}, options, { record: false, timing: true }));
    var traced = run(name, initial, goal, Object.assign({}, options, { record: true }));
    traced.time = timed.time;
    return traced;
  }

  return {
    NAMES: NAMES,
    MAX_EXPANSIONS: MAX_EXPANSIONS,
    MAX_FRAMES: MAX_FRAMES,
    PREVIEW: PREVIEW,
    run: run,
    runWithTrace: runWithTrace
  };
});
