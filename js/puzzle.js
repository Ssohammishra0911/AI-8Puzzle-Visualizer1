/* puzzle.js — 8-puzzle state model.
 *
 * A state is a 9-character string read row by row, e.g. "283164705".
 * The character '0' is the blank.  Moves are named after the direction the
 * BLANK travels (Up / Down / Left / Right).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Puzzle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STANDARD_GOAL = '123456780';

  /** True if s is a 9-char string containing each of 0..8 exactly once. */
  function isValidState(s) {
    return typeof s === 'string' && /^[0-8]{9}$/.test(s) && new Set(s).size === 9;
  }

  /** Swap the characters at positions i and j. */
  function swap(s, i, j) {
    if (i > j) { var t = i; i = j; j = t; }
    return s.slice(0, i) + s[j] + s.slice(i + 1, j) + s[i] + s.slice(j + 1);
  }

  /**
   * Successor function: every state reachable by sliding one tile into the
   * blank.  Returns [{ state, move }] in the fixed order Up, Down, Left, Right.
   */
  function successors(s) {
    var b = s.indexOf('0');
    var r = (b / 3) | 0;
    var c = b % 3;
    var out = [];
    if (r > 0) out.push({ state: swap(s, b, b - 3), move: 'Up' });
    if (r < 2) out.push({ state: swap(s, b, b + 3), move: 'Down' });
    if (c > 0) out.push({ state: swap(s, b, b - 1), move: 'Left' });
    if (c < 2) out.push({ state: swap(s, b, b + 1), move: 'Right' });
    return out;
  }

  /** Number of inversions (pairs of tiles in the wrong order), blank ignored. */
  function inversions(s) {
    var inv = 0;
    for (var i = 0; i < 9; i++) {
      if (s[i] === '0') continue;
      for (var j = i + 1; j < 9; j++) {
        if (s[j] !== '0' && s[j] < s[i]) inv++;
      }
    }
    return inv;
  }

  /**
   * On a 3x3 board, goal b is reachable from a exactly when both states have
   * the same inversion parity.
   */
  function isSolvable(a, b) {
    return inversions(a) % 2 === inversions(b) % 2;
  }

  /**
   * Random solvable puzzle: start at the goal and make `moves` random legal
   * moves (never immediately undoing the previous one).  Because every move is
   * reversible, the result is always solvable.
   */
  function randomPuzzle(goal, moves, rng) {
    rng = rng || Math.random;
    moves = Math.max(1, moves | 0);
    for (var attempt = 0; attempt < 50; attempt++) {
      var cur = goal;
      var prev = null;
      for (var k = 0; k < moves; k++) {
        var options = successors(cur).filter(function (x) { return x.state !== prev; });
        var pick = options[Math.floor(rng() * options.length)];
        prev = cur;
        cur = pick.state;
      }
      if (cur !== goal) return cur;
    }
    return successors(goal)[0].state; // extremely unlikely fallback
  }

  /** "283164705" -> "283/164/7_5" (compact, human readable). */
  function compact(s) {
    return s.replace('0', '_').replace(/(.{3})(.{3})(.{3})/, '$1/$2/$3');
  }

  return {
    STANDARD_GOAL: STANDARD_GOAL,
    isValidState: isValidState,
    successors: successors,
    inversions: inversions,
    isSolvable: isSolvable,
    randomPuzzle: randomPuzzle,
    compact: compact,
    swap: swap
  };
});
