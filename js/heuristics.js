/* heuristics.js — heuristic functions h(n) for the 8-puzzle.
 *
 * Both heuristics are admissible (never overestimate the true cost) and
 * consistent, so A* with either one returns an optimal solution.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Heuristics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NAMES = {
    misplaced: 'Misplaced Tiles',
    manhattan: 'Manhattan Distance'
  };

  /**
   * Build h(state) for a given goal.
   *  - 'misplaced' : number of tiles (blank excluded) that are not on their goal square.
   *  - 'manhattan' : sum over tiles of |row difference| + |column difference| to the goal square.
   */
  function make(name, goal) {
    var goalPos = new Array(9);
    for (var i = 0; i < 9; i++) goalPos[+goal[i]] = i;

    if (name === 'misplaced') {
      return function (s) {
        var n = 0;
        for (var i = 0; i < 9; i++) {
          if (s[i] !== '0' && s[i] !== goal[i]) n++;
        }
        return n;
      };
    }
    if (name === 'manhattan') {
      return function (s) {
        var d = 0;
        for (var i = 0; i < 9; i++) {
          var t = s.charCodeAt(i) - 48;
          if (t === 0) continue;
          var g = goalPos[t];
          d += Math.abs(((i / 3) | 0) - ((g / 3) | 0)) + Math.abs((i % 3) - (g % 3));
        }
        return d;
      };
    }
    throw new Error('Unknown heuristic: ' + name);
  }

  return { NAMES: NAMES, make: make };
});
