# Design notes

## Architecture

```
puzzle.js ─┐
heuristics.js ─┼─> algorithms.js ──> result + trace frames ──> ui.js ──> index.html / style.css
config.js, info.js ───────────────────────────────────────────┘
```

- `puzzle.js`, `heuristics.js` and `algorithms.js` have no DOM dependency, so they run unchanged in Node for testing (`tests/algorithms.test.js`).
- `ui.js` never runs a search step by step. Each algorithm **runs to completion** and returns a result plus a list of *frames*. The UI replays the frames, which makes Pause, Resume, Next Step, Previous Step, the position slider and the speed control simple and exact.

## Search node

`{ state, parent, depth, g, h, f, move }` where `state` is a 9-character string, `parent` links back to the previous node (used to rebuild the solution path) and `move` is the direction the blank travelled.

## Trace frame (one per node expansion)

`type` (`expand`, `cutoff`, `iteration`, `goal`, `end`, `truncated`), current `state`, `parent`, `depth`, `g/h/f`, cumulative `generated` / `expanded`, `frontier` and `explored` previews (25 entries) with their full sizes, and the `successors` generated with a status (`new`, `duplicate`, `limit`).

To keep the browser responsive:

- at most 3,000 frames are stored (a marker frame is inserted if a search is longer; the search itself still runs to completion);
- the solution-path frames are produced on demand from `result.path`, so even a 100,000-move DFS path costs no extra memory;
- every search is run twice: once without recording (accurate execution time; very fast searches are repeated and averaged because browsers round `performance.now()`), and once with recording for the animation.

## Depth Limited Search (assigned algorithm)

```
DLS(initial, limit):
  stack = [root];  expandedAt = {}
  while stack not empty:
    node = pop
    if goal(node)                         -> return SOLUTION
    if expandedAt[node.state] <= node.depth  -> skip     (already explored with at least as much depth left)
    if node.depth == limit                -> cutoffOccurred = true; continue   (not expanded)
    expandedAt[node.state] = node.depth
    push successors (not already expanded at same-or-shallower depth)
  return cutoffOccurred ? CUTOFF : FAILURE
```

Why `expandedAt` stores a depth instead of using a plain visited set: if a state is first reached through a long path it has little depth budget left; reaching it later through a shorter path must expand it again, otherwise a solution that fits inside the limit can be missed. The test suite checks this: for 40 random puzzles, DLS with `limit = optimal depth` always finds a solution and with `limit = optimal − 1` always reports a cutoff.

Complexity: time O(b^l), space O(b·l) in tree form; incomplete when l < d; not optimal.

## Other algorithms

| Algorithm | Frontier ordering | Duplicate handling |
|---|---|---|
| BFS | FIFO | `seen` set (queued or expanded) |
| DFS | LIFO (first move explored first) | expanded once |
| IDDLS | DLS with limit 0,1,2,… (statistics accumulate across iterations) | as DLS |
| UCS | g(n), ties by insertion order | best-g map, closed set |
| GBFS | h(n), ties by insertion order | state generated at most once |
| A\* | f(n), ties → smaller h(n), then insertion order | best-g map, closed set |

All use the goal test **when a node is removed from the frontier**. "Nodes generated" counts every successor produced (including discarded duplicates) plus the root; "maximum depth" is the deepest node generated.

Memory is approximated as `peak (frontier + explored) nodes × 72 bytes`, labelled Low (< 1,000 nodes), Medium (< 20,000) or High.

## Things worth knowing for the viva

- Unbounded DFS on the 8-puzzle can return a path with tens of thousands of moves, because it follows the first branch deeply and only stops at the goal. This is expected behaviour and shows why DFS is not optimal.
- IDDLS repeats upper levels, and on the 8-puzzle (many repeated states) its cost grows about 1.5× for each extra move of solution depth; the 1,000,000-expansion safety limit covers solutions up to roughly 24 moves.
- Of the 9! = 362,880 arrangements only 181,440 are reachable from a given state; the maximum optimal solution length is 31.
- A\* with Manhattan distance expands no more nodes than A\* with Misplaced Tiles on average, because h₂ ≥ h₁ and both are admissible.
