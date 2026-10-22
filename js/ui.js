/* ui.js — page navigation, puzzle input, animated board, playback controls,
 * live search panels, solution summary, comparison table, algorithm info.
 *
 * How playback works: algorithms.js runs the whole search up front and returns
 * a list of "frames" (one per expansion).  This file just replays them.  After
 * the search frames come the solution-path frames, which are generated lazily
 * from result.path so even a 100,000-move DFS path costs no extra memory.
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  var STD_GOAL = Puzzle.STANDARD_GOAL;
  var EX_INITIAL = '283164705'; // example given in the assignment sheet
  var EX_GOAL = '123804765';
  var SPEEDS = [1000, 700, 500, 350, 250, 180, 120, 80, 50, 25]; // ms per step, level 1..10
  var INFORMED = { gbfs: true, astar: true };
  var PAGES = ['home', 'solver', 'compare', 'algorithms'];
  var PATH_SHOW = 60;

  var ALGO_NOTE = {
    bfs: 'Expands the shallowest node first using a FIFO queue. Complete, and optimal for unit step costs.',
    dfs: 'Expands the deepest node first using a LIFO stack. Low memory, but the path it returns can be extremely long.',
    dls: 'Depth-first search that never goes below the depth limit. Returns a solution, a cutoff (limit too small) or failure.',
    iddls: 'Repeats DLS with limit 0, 1, 2, … until the goal is found. Complete and optimal, with DFS-like memory.',
    ucs: 'Expands the node with the lowest path cost g(n). With unit step costs it behaves like BFS.',
    gbfs: 'Expands the node with the smallest heuristic value h(n). Fast, but the solution is not guaranteed to be shortest.',
    astar: 'Expands the node with the smallest f(n) = g(n) + h(n). Optimal with an admissible heuristic.'
  };

  var PHASES = {
    expand: ['Searching', 'primary'],
    cutoff: ['Cutoff: depth limit reached', 'warning'],
    iteration: ['New IDDLS iteration', 'info'],
    truncated: ['Trace shortened', 'secondary'],
    goal: ['Goal reached', 'success'],
    end: ['Search ended: no solution', 'danger'],
    solution: ['Solution path', 'success']
  };

  var App = {
    initial: EX_INITIAL,
    goal: EX_GOAL,
    run: null,        // result of the last algorithm run
    params: null,     // parameters that run used
    tl: null,         // Timeline over run.frames + the solution path
    hfn: null,        // h(n) for the run (informed algorithms only)
    index: 0,
    timer: null,
    running: false,
    revealed: false,  // summary + path strip shown for this run?
    busy: false,
    speed: 4
  };
  var mainBoard;

  /* ===================== small helpers ===================== */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function fmtTime(ms) {
    if (ms < 0.001) return '< 0.001 ms';
    if (ms < 1) return ms.toFixed(3) + ' ms';
    if (ms < 100) return ms.toFixed(2) + ' ms';
    return ms.toFixed(0) + ' ms';
  }
  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
  function compact(s) { return Puzzle.compact(s); }

  /** Static 3x3 mini board as HTML.  Tiles already on their goal square turn green. */
  function mini(state, goal, cls) {
    var h = '<div class="mini ' + (cls || '') + '">';
    for (var i = 0; i < 9; i++) {
      var ch = state[i];
      var blank = ch === '0';
      var ok = goal && !blank && goal[i] === ch;
      h += '<span class="' + (blank ? 'b' : '') + (ok ? ' ok' : '') + '">' + (blank ? '' : ch) + '</span>';
    }
    return h + '</div>';
  }

  function showMsg(text, kind, id) {
    $(id || 'inputMsg').innerHTML = text
      ? '<div class="alert alert-' + kind + ' py-2 mb-0 small" role="alert">' + esc(text) + '</div>'
      : '';
  }

  /* ===================== animated board ===================== */

  /** Nine persistent tile elements; moving a tile just changes its transform,
   *  so CSS transitions animate the blank sliding through the board. */
  function Board(container) {
    container.classList.add('board');
    container.innerHTML = '';
    var tiles = [];
    for (var v = 0; v < 9; v++) {
      var t = document.createElement('div');
      t.className = 'tile' + (v === 0 ? ' blank' : '');
      var s = document.createElement('span');
      s.textContent = v === 0 ? '' : String(v);
      t.appendChild(s);
      container.appendChild(t);
      tiles.push(t);
    }
    return {
      set: function (state, goal) {
        for (var i = 0; i < 9; i++) {
          var v2 = +state[i];
          var el = tiles[v2];
          el.style.transform = 'translate(' + (i % 3) * 100 + '%, ' + Math.floor(i / 3) * 100 + '%)';
          el.classList.toggle('correct', v2 !== 0 && !!goal && goal[i] === state[i]);
        }
      }
    };
  }

  /* ===================== navigation ===================== */

  function route() {
    var name = (location.hash || '#home').slice(1);
    if (PAGES.indexOf(name) < 0) name = 'home';
    PAGES.forEach(function (p) { $('page-' + p).classList.toggle('d-none', p !== name); });
    document.querySelectorAll('[data-page]').forEach(function (a) {
      a.classList.toggle('active', a.dataset.page === name);
    });
    $('navMenu').classList.remove('show');
    $('navToggle').setAttribute('aria-expanded', 'false');
    if (name !== 'solver') pause();
    if (name === 'compare') renderStatic();
    try { window.scrollTo(0, 0); } catch (e) { /* not available in some test environments */ }
  }

  /* ===================== puzzle input ===================== */

  function buildGrid(container, prefix) {
    container.innerHTML = '';
    for (var i = 0; i < 9; i++) {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'numeric';
      inp.maxLength = 1;
      inp.autocomplete = 'off';
      inp.className = 'form-control cell';
      inp.id = prefix + i;
      inp.setAttribute('aria-label', prefix === 'ini' ? 'Initial state cell ' + (i + 1) : 'Goal state cell ' + (i + 1));
      inp.addEventListener('input', function () {
        this.value = this.value.replace(/[^0-8_]/g, '').replace(/0/g, '_');
        resetRun();
      });
      inp.addEventListener('focus', function () { this.select(); });
      container.appendChild(inp);
    }
  }

  function writeGrid(prefix, state) {
    for (var i = 0; i < 9; i++) $(prefix + i).value = state[i] === '0' ? '_' : state[i];
  }

  function readGrid(prefix, label) {
    var cells = [];
    for (var i = 0; i < 9; i++) {
      var v = $(prefix + i).value.trim();
      if (v === '' || v === '_') v = '0';
      if (!/^[0-8]$/.test(v)) throw new Error(label + ': cell ' + (i + 1) + ' must be a digit 1-8, or _ for the blank.');
      cells.push(v);
    }
    var s = cells.join('');
    if (!Puzzle.isValidState(s)) {
      throw new Error(label + ': use each of the digits 1-8 exactly once, plus exactly one blank (_).');
    }
    return s;
  }

  /** Validate the two grids; on success make them the active puzzle. */
  function applyInputs(showOk, msgId) {
    try {
      var ini = readGrid('ini', 'Initial state');
      var goal = readGrid('goal', 'Goal state');
      if (!Puzzle.isSolvable(ini, goal)) {
        throw new Error('This puzzle cannot be solved: the initial and goal states have different inversion parity. Edit a tile or press "Generate Random Puzzle".');
      }
      var changed = ini !== App.initial || goal !== App.goal;
      App.initial = ini;
      App.goal = goal;
      if (changed) resetRun();
      renderStatic();
      showMsg(showOk ? 'Puzzle applied. It is solvable.' : '', 'success', msgId);
      return true;
    } catch (e) {
      showMsg(e.message, 'danger', msgId);
      return false;
    }
  }

  function setPuzzle(ini, goal) {
    App.initial = ini;
    App.goal = goal;
    writeGrid('ini', ini);
    writeGrid('goal', goal);
    resetRun();
    renderStatic();
  }

  function randomPuzzle(msgId) {
    var goal = App.goal;
    var note = '';
    try { goal = readGrid('goal', 'Goal state'); } catch (e) { goal = STD_GOAL; note = ' (the goal grid was invalid, so the standard goal was used)'; }
    var n = clampInt($('scrambleMoves').value, 1, 60, 12);
    $('scrambleMoves').value = n;
    setPuzzle(Puzzle.randomPuzzle(goal, n), goal);
    showMsg('Random solvable puzzle generated by making ' + n + ' random moves from the goal' + note + '.', 'success', msgId);
  }

  function renderStatic() {
    var set = function (id, html) { var el = $(id); if (el) el.innerHTML = html; };
    set('iniMini', mini(App.initial, App.goal, 'mini-lg'));
    set('goalMini', mini(App.goal, null, 'mini-lg'));
    set('cmpIni', mini(App.initial, App.goal, 'mini-lg'));
    set('cmpGoal', mini(App.goal, null, 'mini-lg'));
    if (!App.tl) mainBoard.set(App.initial, App.goal);
  }

  /* ===================== algorithm parameters ===================== */

  function getParams() {
    var alg = $('algoSelect').value;
    var limit = clampInt($('dlsLimit').value, 0, 60, 5);
    var maxDepth = clampInt($('iddlsMax').value, 0, 60, 31);
    $('dlsLimit').value = limit;
    $('iddlsMax').value = maxDepth;
    return { alg: alg, limit: limit, maxDepth: maxDepth, heuristic: $('heuristicSelect').value };
  }

  function onAlgoChange() {
    var alg = $('algoSelect').value;
    $('dlsParam').classList.toggle('d-none', alg !== 'dls');
    $('iddlsParam').classList.toggle('d-none', alg !== 'iddls');
    $('heurParam').classList.toggle('d-none', !INFORMED[alg]);
    $('algoNote').textContent = ALGO_NOTE[alg];
    resetRun();
  }

  function onSpeed() {
    App.speed = clampInt($('speedRange').value, 1, 10, 4);
    var ms = SPEEDS[App.speed - 1];
    $('speedLabel').textContent = 'Level ' + App.speed + ' of 10 · ' + ms + ' ms per step';
    document.documentElement.style.setProperty('--move-ms', Math.min(350, Math.round(ms * 0.8)) + 'ms');
    if (App.running) play(); // restart the timer at the new speed
  }

  /* ===================== timeline ===================== */

  function Timeline(res) {
    this.res = res;
    this.search = res.frames;
    this.length = res.frames.length + (res.found ? res.path.length : 0);
  }
  Timeline.prototype.get = function (i) {
    if (i < this.search.length) return this.search[i];
    var k = i - this.search.length;
    var r = this.res;
    return {
      type: 'solution', step: k, total: r.path.length - 1, state: r.path[k],
      parent: k > 0 ? r.path[k - 1] : null, move: k > 0 ? r.moves[k - 1] : null,
      depth: k, g: k, successors: []
    };
  };

  /* ===================== running & playback ===================== */

  function setBusy(on, text) {
    App.busy = on;
    $('busy').textContent = text || '';
    $('busy').classList.toggle('d-none', !on);
    updateButtons();
  }

  async function ensureRun() {
    if (!applyInputs(false)) return false;
    var p = getParams();
    resetRun();
    setBusy(true, 'Running ' + Algorithms.NAMES[p.alg] + '…');
    await tick(30); // let the browser paint the message before the (synchronous) search
    var res;
    try {
      res = Algorithms.runWithTrace(p.alg, App.initial, App.goal, {
        limit: p.limit, maxDepth: p.maxDepth, heuristic: p.heuristic
      });
    } finally {
      setBusy(false);
    }
    App.run = res;
    App.params = p;
    App.tl = new Timeline(res);
    App.hfn = INFORMED[p.alg] ? Heuristics.make(p.heuristic, App.goal) : null;
    App.index = 0;
    App.revealed = false;
    return true;
  }

  async function onRun() {
    pause();
    if (!(await ensureRun())) return;
    render(0);
    play();
  }

  async function onNext() {
    pause();
    if (!App.tl) {
      if (!(await ensureRun())) return;
      render(0);
      return;
    }
    render(App.index + 1);
  }

  function onPrev() { pause(); if (App.tl) render(App.index - 1); }
  function onReset() { pause(); resetRun(); }
  function onResume() { if (App.tl && App.index < App.tl.length - 1) play(); }

  function jumpToSolution() {
    if (!App.tl) return;
    pause();
    render(App.run.found ? App.tl.search.length : App.tl.length - 1);
  }
  function jumpToEnd() { if (App.tl) { pause(); render(App.tl.length - 1); } }

  function stopTimer() { if (App.timer) { clearInterval(App.timer); App.timer = null; } }

  function play() {
    if (!App.tl) return;
    stopTimer();
    if (App.index >= App.tl.length - 1) { App.running = false; updateButtons(); return; }
    App.running = true;
    App.timer = setInterval(function () {
      if (!App.tl || App.index >= App.tl.length - 1) { pause(); return; }
      render(App.index + 1);
    }, SPEEDS[App.speed - 1]);
    updateButtons();
  }

  function pause() {
    stopTimer();
    App.running = false;
    updateButtons();
  }

  function updateButtons() {
    var has = !!App.tl;
    var atEnd = has && App.index >= App.tl.length - 1;
    $('btnRun').disabled = App.busy;
    $('btnPause').disabled = !App.running;
    $('btnResume').disabled = !has || App.running || atEnd;
    $('btnPrev').disabled = !has || App.index <= 0;
    $('btnNext').disabled = App.busy || atEnd;
    $('btnReset').disabled = App.busy;
    $('btnToSolution').disabled = !has;
    $('btnToEnd').disabled = !has;
    var sc = $('scrubber');
    sc.disabled = !has;
    sc.max = has ? App.tl.length - 1 : 0;
    sc.value = has ? App.index : 0;
  }

  /** Clear the current run and show the initial state again. */
  function resetRun() {
    stopTimer();
    App.running = false;
    App.tl = null;
    App.run = null;
    App.params = null;
    App.hfn = null;
    App.index = 0;
    App.revealed = false;
    mainBoard.set(App.initial, App.goal);
    $('moveLabel').textContent = '';
    $('phaseBadge').className = 'badge text-bg-secondary';
    $('phaseBadge').textContent = 'Ready';
    $('stepLabel').innerHTML = 'Press <b>Run</b> to start, or <b>Next Step</b> to step through manually.';
    $('metrics').innerHTML = '<div class="placeholder">Run an algorithm to see the current node, parent, depth, path cost and node counts here.</div>';
    $('successors').innerHTML = '<div class="succ-msg">The successor states of the node being expanded appear here.</div>';
    $('frontierList').innerHTML = '';
    $('exploredList').innerHTML = '';
    $('frontierCount').textContent = '';
    $('exploredCount').textContent = '';
    $('pathStrip').innerHTML = '';
    $('pathNote').textContent = 'The solution path appears here once the goal is reached.';
    $('summary').innerHTML = '<span class="text-muted">The summary appears when the search finishes.</span>';
    updateButtons();
  }

  /* ===================== rendering one frame ===================== */

  function render(i) {
    var tl = App.tl;
    if (!tl) return;
    i = Math.max(0, Math.min(tl.length - 1, i));
    App.index = i;

    var f = tl.get(i);
    var isSol = f.type === 'solution';
    var informed = !!INFORMED[App.params.alg];
    var lf = isSol ? tl.search[tl.search.length - 1] : f; // frame that carries the lists

    mainBoard.set(f.state, App.goal);

    var ph = PHASES[f.type] || PHASES.expand;
    $('phaseBadge').className = 'badge text-bg-' + ph[1];
    $('phaseBadge').textContent = ph[0];

    var where = isSol
      ? 'Solution step <b>' + f.step + '</b> of ' + f.total
      : 'Search step <b>' + (i + 1) + '</b> of ' + tl.search.length;
    $('stepLabel').innerHTML = 'Frame ' + fmt(i + 1) + ' / ' + fmt(tl.length) + ' · ' + where +
      (f.note ? ' · <i>' + esc(f.note) + '</i>' : '');

    $('moveLabel').textContent = f.move ? 'Blank moved ' + f.move
      : (f.type === 'expand' || f.type === 'goal' || (isSol && f.step === 0)) ? 'Initial state' : '';

    renderMetrics(f, isSol, informed);
    renderSuccessors(f, isSol, informed);
    renderLists(lf, informed);

    if (!App.revealed && (f.type === 'goal' || f.type === 'end' || isSol)) revealResult();
    if (isSol) highlightPath(f.step);

    updateButtons();
    if (i >= tl.length - 1) pause();
  }

  function renderMetrics(f, isSol, informed) {
    var st = App.run.stats;
    var p = App.params;
    var gen = isSol ? st.generated : f.generated;
    var exp = isSol ? st.expanded : f.expanded;
    var lf = isSol ? App.tl.search[App.tl.search.length - 1] : f;
    var h = isSol ? (informed ? App.hfn(f.state) : 0) : f.h;
    var rows = [];
    var row = function (k, v) { rows.push('<div class="row-m"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'); };

    row('Current node' + (f.type === 'expand' ? ' (being expanded)' : ''),
      mini(f.state, App.goal) + '<code>' + compact(f.state) + '</code>');
    row('Parent node', f.parent ? mini(f.parent, App.goal) + '<code>' + compact(f.parent) + '</code>' : '— (root)');
    row('Current search depth', f.depth);
    row('Path cost g(n)', f.g);
    if (informed) {
      row('Heuristic h(n)', h);
      row('Evaluation f(n) = g + h', f.g + h);
    }
    if (p.alg === 'dls') row('Depth limit', p.limit);
    if (p.alg === 'iddls') row('Iteration limit', f.limit !== undefined && f.limit !== null ? f.limit : (isSol ? App.run.limitUsed : '—'));
    row('Nodes generated', fmt(gen));
    row('Nodes expanded', fmt(exp));
    row('Frontier size', fmt(lf.frontierSize));
    row('Explored size', fmt(lf.exploredSize));
    $('metrics').innerHTML = rows.join('');
  }

  function renderSuccessors(f, isSol, informed) {
    var box = $('successors');
    if (isSol) { box.innerHTML = '<div class="succ-msg">Replaying the final solution path (see step 5 below).</div>'; return; }
    if (!f.successors.length) {
      var msg = {
        cutoff: 'This node is at the depth limit (' + f.limit + '), so it is not expanded: cutoff.',
        goal: 'Goal test passed. This node is the goal, so there is nothing left to expand.',
        iteration: 'New iteration: depth limited search restarts from the initial state with limit ' + f.limit + '.',
        truncated: f.note,
        end: 'The search finished without reaching the goal.'
      }[f.type] || 'No successor states were generated.';
      box.innerHTML = '<div class="succ-msg">' + esc(msg) + '</div>';
      return;
    }
    var label = { 'new': 'added to frontier', limit: 'at depth limit', duplicate: 'already seen' };
    box.innerHTML = f.successors.map(function (s) {
      var info = (informed && s.status !== 'duplicate')
        ? '<div class="tiny">g=' + s.g + ' h=' + s.h + ' f=' + s.f + '</div>'
        : (s.status !== 'duplicate' ? '<div class="tiny">g=' + s.g + '</div>' : '');
      return '<div class="succ s-' + s.status + '">' + mini(s.state, App.goal) +
        '<div class="mv">Blank ' + s.move + '</div>' +
        '<span class="badge text-bg-' + (s.status === 'new' ? 'primary' : s.status === 'limit' ? 'warning' : 'secondary') + '">' + label[s.status] + '</span>' +
        info + '</div>';
    }).join('');
  }

  function renderLists(lf, informed) {
    var fr = lf.frontier || [];
    var ex = lf.explored || [];
    $('frontierList').innerHTML = fr.length ? fr.map(function (it, k) {
      return '<span class="chip' + (k === 0 ? ' next' : '') + '" title="' + compact(it.s) + '"><b>' + compact(it.s) + '</b><small>depth ' + it.d +
        (informed ? ' · g' + it.g + ' h' + it.h + ' f' + it.f : '') + '</small></span>';
    }).join('') : '<span class="text-muted small">empty</span>';
    $('exploredList').innerHTML = ex.length ? ex.map(function (s) {
      return '<span class="chip"><b>' + compact(s) + '</b></span>';
    }).join('') : '<span class="text-muted small">empty</span>';
    $('frontierCount').textContent = fmt(lf.frontierSize) + ' nodes' + (fr.length < lf.frontierSize ? ' · next ' + fr.length + ' shown' : '');
    $('exploredCount').textContent = fmt(lf.exploredSize) + ' nodes' + (ex.length < lf.exploredSize ? ' · latest ' + ex.length + ' shown' : '');
  }

  /* ===================== result: path strip + summary ===================== */

  function revealResult() {
    App.revealed = true;
    renderPath();
    renderSummary();
  }

  function renderPath() {
    var run = App.run;
    var strip = $('pathStrip');
    if (!run.found) {
      $('pathNote').textContent = 'No solution path: the goal was not reached.';
      strip.innerHTML = '';
      return;
    }
    var n = run.path.length;
    var seq = run.moves.length <= 40 ? run.moves.join(' → ') : run.moves.slice(0, 40).join(' → ') + ' → …';
    $('pathNote').innerHTML = '<b>' + fmt(run.moves.length) + ' move' + (run.moves.length === 1 ? '' : 's') + '</b>' +
      (run.moves.length ? ' (direction of the blank): ' + esc(seq) : ' — the initial state already is the goal.') +
      (n > PATH_SHOW ? '<br>Showing the first ' + PATH_SHOW + ' and the last of ' + fmt(n) + ' states.' : '');
    var shown = Math.min(n, PATH_SHOW);
    var html = '';
    var step = function (k) {
      return '<div class="path-step" data-k="' + k + '"><div class="lbl">Step ' + k + '</div>' + mini(run.path[k], App.goal) +
        '<div class="mv">' + (k ? '↓ ' + run.moves[k - 1] : 'start') + '</div></div>';
    };
    for (var k = 0; k < shown; k++) {
      html += step(k);
      if (k < shown - 1) html += '<div class="path-arrow">→</div>';
    }
    if (n > shown) html += '<div class="path-arrow">…</div>' + step(n - 1);
    strip.innerHTML = html;
  }

  function highlightPath(k) {
    var strip = $('pathStrip');
    var prev = strip.querySelector('.path-step.active');
    if (prev) prev.classList.remove('active');
    var el = strip.querySelector('[data-k="' + k + '"]');
    if (el) {
      el.classList.add('active');
      strip.scrollLeft = el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2;
    }
  }

  function renderSummary() {
    var r = App.run;
    var st = r.stats;
    var p = App.params;
    var badge;
    var detail = '';
    if (r.status === 'found') {
      badge = ['success', 'Solution Found'];
      if (p.alg === 'dls') detail = 'A solution exists within the depth limit of ' + p.limit + '.';
      if (p.alg === 'iddls') detail = 'Found when the depth limit reached ' + r.limitUsed + '.';
      if (p.alg === 'dfs' && r.moves.length > 40) detail = 'DFS returns the first solution it meets, which is far from the shortest one (not optimal).';
    } else if (r.status === 'cutoff') {
      badge = ['warning', 'Solution Not Found (cutoff)'];
      detail = p.alg === 'dls'
        ? 'The depth limit of ' + p.limit + ' was reached on at least one branch. No solution exists within ' + p.limit + ' moves, but a deeper one may exist: increase the limit.'
        : 'No solution was found with depth limits up to ' + p.maxDepth + '.';
    } else if (r.status === 'failure') {
      badge = ['danger', 'Solution Not Found'];
      detail = 'The whole reachable state space was searched and the goal was not found.';
    } else {
      badge = ['secondary', 'Stopped: node limit'];
      detail = 'The search was stopped after ' + fmt(Algorithms.MAX_EXPANSIONS) + ' node expansions (a safety limit), so the result is inconclusive.';
    }
    var stat = function (label, value, sub) {
      return '<div class="stat"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
    };
    var tiles = [
      stat('Total moves', r.found ? fmt(r.moves.length) : '—'),
      stat('Path cost', r.found ? fmt(r.pathCost) : '—', r.found ? '1 per move' : ''),
      stat('Nodes generated', fmt(st.generated)),
      stat('Nodes expanded', fmt(st.expanded)),
      stat('Maximum search depth', fmt(st.maxDepth)),
      stat('Execution time', fmtTime(r.time)),
      stat('Memory (approx.)', r.memory.label, fmtBytes(r.memory.bytes) + ' · peak ' + fmt(r.memory.nodes) + ' nodes'),
      stat('Duplicates skipped', fmt(st.duplicates))
    ];
    if (p.alg === 'dls') tiles.push(stat('Depth limit', p.limit), stat('Cutoffs hit', fmt(st.cutoffs)));
    if (INFORMED[p.alg]) tiles.push(stat('Heuristic', p.heuristic === 'manhattan' ? 'Manhattan' : 'Misplaced'));
    $('summary').innerHTML =
      '<div class="d-flex flex-wrap align-items-center gap-2 mb-2"><span class="badge fs-6 text-bg-' + badge[0] + '">' + badge[1] + '</span>' +
      '<span class="text-muted">' + esc(Algorithms.NAMES[p.alg]) + '</span></div>' +
      (detail ? '<p class="small text-muted">' + esc(detail) + '</p>' : '') +
      '<div class="stat-grid">' + tiles.join('') + '</div>';
  }

  /* ===================== comparison page ===================== */

  var CMP_ROWS = [
    { key: 'bfs', label: 'BFS' },
    { key: 'dfs', label: 'DFS' },
    { key: 'dls', label: 'DLS' },
    { key: 'iddls', label: 'IDDLS' },
    { key: 'ucs', label: 'UCS' },
    { key: 'gbfs', h: 'misplaced', label: 'GBFS · Misplaced Tiles' },
    { key: 'gbfs', h: 'manhattan', label: 'GBFS · Manhattan' },
    { key: 'astar', h: 'misplaced', label: 'A* · Misplaced Tiles' },
    { key: 'astar', h: 'manhattan', label: 'A* · Manhattan' }
  ];

  async function runAll() {
    var limit = clampInt($('cmpLimit').value, 0, 60, 5);
    var maxDepth = clampInt($('cmpMax').value, 0, 60, 31);
    $('cmpLimit').value = limit;
    $('cmpMax').value = maxDepth;
    showMsg('', 'info', 'cmpMsg');
    pause();
    var btn = $('btnRunAll');
    btn.disabled = true;
    var results = [];
    try {
      for (var i = 0; i < CMP_ROWS.length; i++) {
        var row = CMP_ROWS[i];
        $('cmpProgress').textContent = 'Running ' + row.label + '… (' + (i + 1) + ' of ' + CMP_ROWS.length + ')';
        await tick(25);
        var label = row.label + (row.key === 'dls' ? ' (limit ' + limit + ')' : row.key === 'iddls' ? ' (max ' + maxDepth + ')' : '');
        results.push({ label: label, r: Algorithms.run(row.key, App.initial, App.goal, { limit: limit, maxDepth: maxDepth, heuristic: row.h, timing: true }) });
      }
      renderCompare(results, limit);
      $('cmpProgress').textContent = 'Done. All algorithms ran on the same puzzle.';
    } finally {
      btn.disabled = false;
    }
  }

  function renderCompare(results, limit) {
    var found = results.filter(function (x) { return x.r.found; });
    var minMoves = found.length ? Math.min.apply(null, found.map(function (x) { return x.r.moves.length; })) : null;
    var minExp = found.length ? Math.min.apply(null, found.map(function (x) { return x.r.stats.expanded; })) : null;
    var maxExp = Math.max.apply(null, results.map(function (x) { return x.r.stats.expanded; })) || 1;
    var statusText = { found: 'Yes', cutoff: 'No (cutoff)', failure: 'No', limit: 'No (node limit)' };

    $('cmpBody').innerHTML = results.map(function (x) {
      var r = x.r;
      var best = r.found && r.stats.expanded === minExp;
      var optimal = !r.found ? '—' : (r.moves.length === minMoves ? '<span class="text-success fw-semibold">✔ Yes</span>' : '<span class="text-danger" title="' + fmt(r.moves.length - minMoves) + ' moves longer than the shortest solution">✘ No</span>');
      var bar = '<div class="bar"><i style="width:' + Math.max(2, Math.sqrt(r.stats.expanded / maxExp) * 100).toFixed(1) + '%"></i></div>';
      return '<tr' + (best ? ' class="best"' : '') + '>' +
        '<td class="fw-semibold">' + esc(x.label) + '</td>' +
        '<td>' + (r.found ? '<span class="badge text-bg-success">Yes</span>' : '<span class="badge text-bg-' + (r.status === 'cutoff' ? 'warning' : 'secondary') + '">' + statusText[r.status] + '</span>') + '</td>' +
        '<td class="text-end">' + fmt(r.stats.generated) + '</td>' +
        '<td class="text-end">' + fmt(r.stats.expanded) + bar + '</td>' +
        '<td class="text-end">' + (r.found ? fmt(r.moves.length) : '—') + '</td>' +
        '<td class="text-end">' + fmt(r.stats.maxDepth) + '</td>' +
        '<td class="text-end">' + fmtTime(r.time) + '</td>' +
        '<td>' + r.memory.label + ' <small class="text-muted">· ' + fmtBytes(r.memory.bytes) + '</small></td>' +
        '<td>' + optimal + '</td></tr>';
    }).join('');

    var by = {};
    results.forEach(function (x) { by[x.label] = x.r; });
    var get = function (prefix) {
      for (var k in by) if (k.indexOf(prefix) === 0) return by[k];
      return null;
    };
    var bfs = get('BFS'), dfs = get('DFS'), dls = get('DLS'), idd = get('IDDLS');
    var am = get('A* · Manhattan'), at = get('A* · Misplaced'), gm = get('GBFS · Manhattan');
    var notes = [];
    if (bfs && am && am.found && bfs.found) {
      notes.push('<b>Heuristics pay off:</b> A* with Manhattan distance expanded ' + fmt(am.stats.expanded) + ' nodes versus ' + fmt(bfs.stats.expanded) +
        ' for BFS (' + (bfs.stats.expanded / Math.max(1, am.stats.expanded)).toFixed(1) + '× fewer), and still returned an optimal ' + am.moves.length + '-move solution.');
    }
    if (am && at && am.found && at.found) {
      notes.push('<b>Better heuristic, fewer nodes:</b> Manhattan distance expanded ' + fmt(am.stats.expanded) + ' nodes, Misplaced Tiles ' + fmt(at.stats.expanded) + ' (Manhattan is the stronger heuristic).');
    }
    if (gm && gm.found && bfs && bfs.found && gm.moves.length > minMoves) {
      notes.push('<b>Greedy is not optimal:</b> GBFS found a ' + gm.moves.length + '-move solution, but the shortest has ' + minMoves + ' moves.');
    }
    if (dfs && dfs.found && minMoves !== null && dfs.moves.length > minMoves) {
      notes.push('<b>DFS is not optimal:</b> it returned a ' + fmt(dfs.moves.length) + '-move solution; the shortest has ' + minMoves + ' moves.');
    }
    if (dls) {
      notes.push('<b>DLS with limit ' + limit + ':</b> ' + (dls.found
        ? 'found a solution of ' + dls.moves.length + ' moves' + (minMoves !== null && dls.moves.length > minMoves ? ' (not the shortest: DLS is not optimal)' : '') + '.'
        : dls.status === 'cutoff' ? 'cutoff. No solution within ' + limit + ' moves' + (minMoves !== null ? '; the shortest solution needs ' + minMoves + ' moves, so the limit is too small.' : '.')
          : 'stopped (' + dls.status + ').'));
    }
    if (idd && idd.found && bfs && bfs.found) {
      notes.push('<b>IDDLS</b> found the same optimal length as BFS but re-expanded shallow levels: ' + fmt(idd.stats.expanded) + ' expansions versus ' + fmt(bfs.stats.expanded) + ', using far less memory (peak ' + fmt(idd.memory.nodes) + ' vs ' + fmt(bfs.memory.nodes) + ' nodes).');
    } else if (idd && idd.status === 'limit') {
      notes.push('<b>IDDLS</b> hit the safety limit of ' + fmt(Algorithms.MAX_EXPANSIONS) + ' expansions: iterative deepening repeats work, so it becomes very slow on deep solutions.');
    }
    $('cmpNotes').innerHTML = '<div class="card panel"><div class="card-header">Observations for this puzzle</div><div class="card-body"><ul class="mb-0">' +
      notes.map(function (n) { return '<li class="mb-1">' + n + '</li>'; }).join('') + '</ul>' +
      '<p class="small text-muted mt-3 mb-0">Green marker = fewest nodes expanded among the algorithms that found a solution. Bars show nodes expanded (square-root scale). ' +
      'Memory is estimated from the peak number of nodes held in the frontier plus explored structures.</p></div></div>';
  }

  /* ===================== algorithm info page ===================== */

  function renderInfo() {
    var list = function (items, tag) {
      return '<' + tag + '>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</' + tag + '>';
    };
    $('algoInfo').innerHTML = ALGO_INFO.map(function (a) {
      var mine = a.key === CFG.assignedKey;
      return '<details class="algo-card"' + (mine ? ' open' : '') + '><summary>' +
        '<span class="fw-bold">' + esc(a.name) + '</span>' +
        '<span class="badge text-bg-' + (a.informed ? 'info' : 'secondary') + '">' + (a.informed ? 'Informed' : 'Uninformed') + '</span>' +
        (mine ? '<span class="badge text-bg-success">Assigned algorithm · ' + esc(CFG.regNo) + '</span>' : '') +
        '</summary><div class="algo-body">' +
        '<h3>Description</h3><p class="mb-0">' + esc(a.description) + '</p>' +
        '<h3>Working principle</h3>' + list(a.principle, 'ol') +
        '<div class="row g-3"><div class="col-md-6"><h3>Advantages</h3>' + list(a.advantages, 'ul') + '</div>' +
        '<div class="col-md-6"><h3>Limitations</h3>' + list(a.limitations, 'ul') + '</div></div>' +
        '<h3>Complexity and properties</h3><div class="stat-grid">' +
        '<div class="stat"><span>Time complexity</span><b class="fs-6">' + esc(a.time) + '</b></div>' +
        '<div class="stat"><span>Space complexity</span><b class="fs-6">' + esc(a.space) + '</b></div>' +
        '<div class="stat"><span>Completeness</span><b class="fs-6">' + esc(a.complete) + '</b></div>' +
        '<div class="stat"><span>Optimality</span><b class="fs-6">' + esc(a.optimal) + '</b></div></div>' +
        '</div></details>';
    }).join('');
    $('heurInfo').innerHTML = HEURISTIC_INFO.map(function (h) {
      return '<div class="col-md-6"><div class="card panel h-100"><div class="card-header">' + esc(h.name) + '</div><div class="card-body">' +
        '<p>' + esc(h.text) + '</p><p class="small text-muted mb-0"><b>Example.</b> ' + esc(h.example) + '</p></div></div></div>';
    }).join('');
  }

  /* ===================== start-up ===================== */

  function init() {
    document.querySelectorAll('[data-cfg]').forEach(function (el) { el.textContent = CFG[el.dataset.cfg] || ''; });
    document.title = '8-Puzzle AI Search Visualizer · ' + CFG.regNo;

    $('homeIni').innerHTML = mini(EX_INITIAL, EX_GOAL, 'mini-lg');
    $('homeGoal').innerHTML = mini(EX_GOAL, null, 'mini-lg');

    mainBoard = Board($('mainBoard'));
    buildGrid($('iniGrid'), 'ini');
    buildGrid($('goalGrid'), 'goal');
    renderInfo();

    $('navToggle').addEventListener('click', function () {
      var open = $('navMenu').classList.toggle('show');
      $('navToggle').setAttribute('aria-expanded', String(open));
    });
    window.addEventListener('hashchange', route);
    document.querySelectorAll('#navMenu a, .navbar-brand').forEach(function (a) {
      a.addEventListener('click', function () {
        $('navMenu').classList.remove('show');
        $('navToggle').setAttribute('aria-expanded', 'false');
      });
    });

    $('btnApply').addEventListener('click', function () { applyInputs(true); });
    $('btnRandom').addEventListener('click', function () { randomPuzzle('inputMsg'); });
    $('btnStdGoal').addEventListener('click', function () {
      var ini;
      try { ini = readGrid('ini', 'Initial state'); } catch (e) { ini = App.initial; }
      if (!Puzzle.isSolvable(ini, STD_GOAL)) ini = Puzzle.randomPuzzle(STD_GOAL, 12);
      setPuzzle(ini, STD_GOAL);
      showMsg('Standard goal 1 2 3 / 4 5 6 / 7 8 _ applied.', 'success');
    });
    $('btnExample').addEventListener('click', function () {
      setPuzzle(EX_INITIAL, EX_GOAL);
      showMsg('Example from the assignment loaded (shortest solution: 5 moves).', 'success');
    });

    $('algoSelect').addEventListener('change', onAlgoChange);
    $('dlsLimit').addEventListener('change', resetRun);
    $('iddlsMax').addEventListener('change', resetRun);
    $('heuristicSelect').addEventListener('change', resetRun);
    $('speedRange').addEventListener('input', onSpeed);

    $('btnRun').addEventListener('click', onRun);
    $('btnPause').addEventListener('click', pause);
    $('btnResume').addEventListener('click', onResume);
    $('btnNext').addEventListener('click', onNext);
    $('btnPrev').addEventListener('click', onPrev);
    $('btnReset').addEventListener('click', onReset);
    $('btnToSolution').addEventListener('click', jumpToSolution);
    $('btnToEnd').addEventListener('click', jumpToEnd);
    $('scrubber').addEventListener('input', function () {
      var v = parseInt(this.value, 10); // read first: pause() re-syncs the slider to the current frame
      pause();
      render(v);
    });

    $('btnRunAll').addEventListener('click', runAll);
    $('btnCmpRandom').addEventListener('click', function () { randomPuzzle('cmpMsg'); $('cmpBody').innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">New puzzle ready. Press <b>Run all algorithms</b>.</td></tr>'; $('cmpNotes').innerHTML = ''; $('cmpProgress').textContent = ''; });

    setPuzzle(EX_INITIAL, EX_GOAL);
    onAlgoChange();
    onSpeed();
    route();
  }

  init();
})();
