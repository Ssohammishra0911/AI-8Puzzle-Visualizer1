/* info.js — text for the "Algorithm Information" page.
 * b = branching factor (about 2.67 on average for the 8-puzzle, at most 4),
 * d = depth of the shallowest solution, m = maximum depth of the search tree,
 * l = depth limit, C* = optimal path cost, ε = smallest step cost.            */
window.ALGO_INFO = [
  {
    key: 'bfs',
    name: 'Breadth First Search (BFS)',
    informed: false,
    description:
      'An uninformed strategy that expands the shallowest unexpanded node first, so the search spreads out level by level from the start state.',
    principle: [
      'Put the start state in a FIFO queue (the frontier).',
      'Remove the node at the front. If it is the goal, stop and rebuild the path through the parent links.',
      'Otherwise expand it: generate its successors and append every state not seen before to the back of the queue.',
      'Repeat until the goal is found or the queue is empty.'
    ],
    advantages: [
      'Complete: always finds a solution if one exists.',
      'Optimal when every move costs the same, as in the 8-puzzle: it returns the fewest-move solution.'
    ],
    limitations: [
      'Needs memory proportional to the whole frontier, which grows exponentially.',
      'Explores in all directions, so it is slow when the solution is deep.'
    ],
    time: 'O(b^d)',
    space: 'O(b^d)',
    complete: 'Yes (b is finite)',
    optimal: 'Yes (uniform step cost)'
  },
  {
    key: 'dfs',
    name: 'Depth First Search (DFS)',
    informed: false,
    description:
      'An uninformed strategy that always expands the deepest node in the frontier, following one branch as far as it goes before backtracking.',
    principle: [
      'Put the start state on a LIFO stack.',
      'Pop the top node. If it is the goal, stop.',
      'If its state has not been expanded yet, expand it and push the unseen successors (the first move is tried first).',
      'Repeat. A visited set stops the search from cycling between the same states.'
    ],
    advantages: [
      'Very small memory in tree form: only the current branch and its siblings, O(b·m).',
      'Can reach a solution quickly if it happens to pick the right branch.'
    ],
    limitations: [
      'Not optimal: it returns the first solution it meets, which can be extremely long (on the 8-puzzle it can return paths of tens of thousands of moves).',
      'Without a visited check it can loop forever or dive down an endless branch.',
      'With the visited set used here, memory grows with the number of states seen.'
    ],
    time: 'O(b^m)',
    space: 'O(b·m) as a tree search; O(number of states) with a visited set',
    complete: 'No in general; yes in a finite space when repeated states are checked (this implementation)',
    optimal: 'No'
  },
  {
    key: 'dls',
    name: 'Depth Limited Search (DLS)',
    informed: false,
    description:
      'Depth First Search with a fixed depth limit l. Nodes at depth l are treated as if they had no successors, which stops the search from descending forever.',
    principle: [
      'Run depth-first search from the start state, but never expand a node whose depth equals the limit l.',
      'If the goal is reached, return the path (a solution).',
      'If the search ends because some branch was cut off at depth l, return cutoff: no solution within l moves, but a deeper one may exist.',
      'If every branch ended naturally with no cutoff, return failure: the goal is not reachable at all.',
      'This implementation re-expands a state when it is reached again by a shallower path, because it then has more depth left to explore.'
    ],
    advantages: [
      'Memory stays small, O(b·l), like DFS.',
      'Cannot get lost in an infinitely deep branch.',
      'Finds a solution whenever one exists within the limit.'
    ],
    limitations: [
      'Incomplete when l < d: it reports cutoff and misses the solution.',
      'Not optimal: with l > d it may return a path longer than the shortest one.',
      'A good limit has to be guessed (every 8-puzzle can be solved in at most 31 moves).'
    ],
    time: 'O(b^l)',
    space: 'O(b·l)',
    complete: 'No (only if l ≥ d)',
    optimal: 'No'
  },
  {
    key: 'iddls',
    name: 'Iterative Deepening Depth Limited Search (IDDLS)',
    informed: false,
    description:
      'Runs Depth Limited Search again and again with limit 0, 1, 2, 3, … until the goal is found. It combines the memory economy of DFS with the completeness and optimality of BFS.',
    principle: [
      'Set the limit L = 0.',
      'Run DLS with limit L from the start state.',
      'If a solution is found, return it. If the result is a cutoff, increase L by one and repeat.',
      'Because L grows one step at a time, the first solution found is a shallowest one.'
    ],
    advantages: [
      'Complete, and optimal for uniform step cost.',
      'Memory is only O(b·d).',
      'The repeated work is modest because most nodes are in the deepest level.'
    ],
    limitations: [
      'Re-generates the upper levels on every iteration, so it is slower than BFS by a constant factor, and on the 8-puzzle (where states repeat a lot) the cost grows about 1.5× per extra move of solution depth.',
      'Uses no heuristic knowledge.'
    ],
    time: 'O(b^d)',
    space: 'O(b·d)',
    complete: 'Yes (b is finite)',
    optimal: 'Yes (uniform step cost)'
  },
  {
    key: 'ucs',
    name: 'Uniform Cost Search (UCS)',
    informed: false,
    description:
      'Expands the node with the lowest path cost g(n) so far, using a priority queue. It is the cost-aware version of BFS.',
    principle: [
      'Keep the frontier in a priority queue ordered by g(n).',
      'Pop the cheapest node; if it is the goal, stop.',
      'Expand it and insert the successors with their new path costs (a cheaper route to a known state replaces the old one).',
      'In the 8-puzzle every move costs 1, so UCS behaves like BFS.'
    ],
    advantages: [
      'Complete and optimal for any positive step costs.'
    ],
    limitations: [
      'Explores every cheaper path first, so it has the same memory and time problems as BFS.',
      'Uses no knowledge about where the goal is.'
    ],
    time: 'O(b^(1+⌊C*/ε⌋))',
    space: 'O(b^(1+⌊C*/ε⌋))',
    complete: 'Yes (if ε > 0)',
    optimal: 'Yes'
  },
  {
    key: 'gbfs',
    name: 'Greedy Best First Search (GBFS)',
    informed: true,
    description:
      'An informed strategy that always expands the node that looks closest to the goal according to the heuristic h(n), ignoring the cost already paid.',
    principle: [
      'Keep the frontier in a priority queue ordered by h(n) only (f(n) = h(n)).',
      'Pop the node with the smallest h; if it is the goal, stop.',
      'Expand it, compute h for each new successor and add it to the queue.',
      'Repeat. A closed set prevents the search from revisiting states.'
    ],
    advantages: [
      'Often very fast and expands few nodes when the heuristic is good.',
      'Simple to implement.'
    ],
    limitations: [
      'Not optimal: it can return a longer path than necessary.',
      'Can be misled by a heuristic that points into a dead end.',
      'In the worst case it behaves like DFS.'
    ],
    time: 'O(b^m) worst case, usually far better',
    space: 'O(b^m) worst case',
    complete: 'No in tree search; yes in a finite space with a closed set (this implementation)',
    optimal: 'No'
  },
  {
    key: 'astar',
    name: 'A* Search',
    informed: true,
    description:
      'An informed strategy that expands the node with the lowest estimated total cost f(n) = g(n) + h(n): the cost paid so far plus the heuristic estimate of the cost remaining.',
    principle: [
      'Keep the frontier in a priority queue ordered by f(n) = g(n) + h(n); ties go to the smaller h.',
      'Pop the node with the lowest f; if it is the goal, stop.',
      'Expand it, compute g, h and f for each successor, and insert it (or replace a worse entry for the same state).',
      'With an admissible and consistent heuristic the first time the goal is popped its path is optimal.'
    ],
    advantages: [
      'Complete and optimal with an admissible (and, for graph search, consistent) heuristic. Both heuristics used here qualify.',
      'Expands far fewer nodes than uninformed search; a stronger heuristic (Manhattan) prunes more.'
    ],
    limitations: [
      'Keeps all generated nodes in memory, which is its main drawback.',
      'Its running time depends heavily on the quality of the heuristic.'
    ],
    time: 'O(b^d) worst case; exponential in the heuristic error',
    space: 'O(b^d): all nodes are kept in memory',
    complete: 'Yes',
    optimal: 'Yes (admissible and consistent heuristic)'
  }
];

window.HEURISTIC_INFO = [
  {
    key: 'misplaced',
    name: 'Misplaced Tiles  (h₁)',
    text:
      'Counts the tiles (the blank is not counted) that are not on their goal square. It is admissible because every misplaced tile needs at least one move. It is cheap to compute but gives a weak estimate.',
    example: 'For 2 8 3 / 1 6 4 / 7 _ 5 with goal 1 2 3 / 8 _ 4 / 7 6 5: tiles 2, 8, 1 and 6 are misplaced, so h₁ = 4.'
  },
  {
    key: 'manhattan',
    name: 'Manhattan Distance  (h₂)',
    text:
      'Sums, over all tiles, the number of rows plus the number of columns each tile is away from its goal square. It is admissible and consistent, and it always satisfies h₂ ≥ h₁ (it dominates Misplaced Tiles), so A* with it expands fewer nodes.',
    example: 'For the same puzzle: tile 2 is 1 move away, tile 8 is 2 away, tile 1 is 1 away, tile 6 is 1 away and the rest are in place, so h₂ = 1 + 2 + 1 + 1 = 5.'
  }
];
