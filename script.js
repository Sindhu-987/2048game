/**
 * 2048 — Premium Edition · script.js
 * Pure vanilla JS — no frameworks, no dependencies.
 * Architecture: State object → render diff → DOM tiles
 */

/* ============================================================
   CONSTANTS
   ============================================================ */
const GRID_SIZE   = 4;
const WIN_VALUE   = 2048;
const LS_BEST_KEY = '2048_best_score';

/* ============================================================
   STATE
   ============================================================ */
const state = {
  grid:        [],   // 4×4 matrix of values (0 = empty)
  score:       0,
  bestScore:   parseInt(localStorage.getItem(LS_BEST_KEY) || '0', 10),
  moves:       0,
  timerSecs:   0,
  timerHandle: null,
  won:         false,    // has the player reached 2048?
  continuePlay: false,   // did they choose to keep going?
  gameOver:    false,
};

/* ============================================================
   DOM REFS
   ============================================================ */
const dom = {
  scoreDisplay: document.getElementById('score-display'),
  bestDisplay:  document.getElementById('best-display'),
  movesDisplay: document.getElementById('moves-display'),
  timerDisplay: document.getElementById('timer-display'),
  tileLayer:    document.getElementById('tile-layer'),
  btnNew:       document.getElementById('btn-new-game'),
  modalWin:     document.getElementById('modal-win'),
  modalLose:    document.getElementById('modal-lose'),
  winScore:     document.getElementById('win-score'),
  loseScore:    document.getElementById('lose-score'),
  btnContinue:  document.getElementById('btn-continue'),
  btnWinNew:    document.getElementById('btn-win-new'),
  btnTryAgain:  document.getElementById('btn-try-again'),
  btnLoseNew:   document.getElementById('btn-lose-new'),
  statScore:    document.getElementById('stat-score'),
};

/* ============================================================
   GRID UTILITIES
   ============================================================ */

/** Create an empty 4×4 grid of zeros. */
function createGrid() {
  return Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(0));
}

/** Deep-clone a grid. */
function cloneGrid(g) {
  return g.map(row => [...row]);
}

/** Return all empty cell positions as [{r, c}]. */
function emptyCells(grid) {
  const cells = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] === 0) cells.push({ r, c });
    }
  }
  return cells;
}

/** Place a new tile (90% chance = 2, 10% chance = 4) at a random empty cell. */
function spawnTile(grid) {
  const empty = emptyCells(grid);
  if (empty.length === 0) return null;
  const { r, c } = empty[Math.floor(Math.random() * empty.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  return { r, c, value: grid[r][c] };
}

/* ============================================================
   MOVE LOGIC
   ============================================================ */

/**
 * Slide & merge a single row to the left.
 * Returns { row, score, merged: [indices that merged] }.
 */
function slideRowLeft(row) {
  const nums   = row.filter(v => v !== 0);
  let gained   = 0;
  const merged = new Set();

  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i] === nums[i + 1]) {
      nums[i]    *= 2;
      gained     += nums[i];
      nums[i + 1] = 0;
      merged.add(i);
      i++; // skip next — already merged
    }
  }

  const result = nums.filter(v => v !== 0);
  while (result.length < GRID_SIZE) result.push(0);

  return { row: result, score: gained, merged };
}

/**
 * Apply a move in one of four directions.
 * Returns { newGrid, scoreDelta, moved, mergedCells }
 *   mergedCells: array of {r, c} in the NEW grid positions.
 */
function applyMove(grid, direction) {
  let newGrid    = cloneGrid(grid);
  let scoreDelta = 0;
  let moved      = false;
  const mergedCells = [];

  /**
   * Helper: extract a "row" of values along a traverse direction,
   * slide it, and write it back.
   */
  const processLine = (getVal, setVal, positions) => {
    const row = positions.map(getVal);
    const { row: newRow, score, merged } = slideRowLeft(row);
    if (newRow.some((v, i) => v !== row[i])) moved = true;
    scoreDelta += score;
    positions.forEach((pos, i) => {
      setVal(pos, newRow[i]);
      if (merged.has(i) && newRow[i] !== 0) {
        mergedCells.push(pos);
      }
    });
  };

  if (direction === 'left' || direction === 'right') {
    for (let r = 0; r < GRID_SIZE; r++) {
      const cols = direction === 'left'
        ? [0, 1, 2, 3]
        : [3, 2, 1, 0];
      const positions = cols.map(c => ({ r, c }));
      processLine(
        pos => newGrid[pos.r][pos.c],
        (pos, v) => { newGrid[pos.r][pos.c] = v; },
        positions
      );
    }
  } else {
    // up / down
    for (let c = 0; c < GRID_SIZE; c++) {
      const rows = direction === 'up'
        ? [0, 1, 2, 3]
        : [3, 2, 1, 0];
      const positions = rows.map(r => ({ r, c }));
      processLine(
        pos => newGrid[pos.r][pos.c],
        (pos, v) => { newGrid[pos.r][pos.c] = v; },
        positions
      );
    }
  }

  return { newGrid, scoreDelta, moved, mergedCells };
}

/** Check whether any valid move exists for the current grid. */
function hasMovesLeft(grid) {
  if (emptyCells(grid).length > 0) return true;
  for (const dir of ['left', 'right', 'up', 'down']) {
    const { moved } = applyMove(grid, dir);
    if (moved) return true;
  }
  return false;
}

/* ============================================================
   RENDERING
   ============================================================ */

/**
 * Tile DOM pool: we reuse tile elements keyed by a unique tile ID
 * to enable CSS transition-based movement.
 */
const tileMap = new Map(); // tileId → DOM element
let nextTileId = 0;

// We track a "logical grid" of tile IDs (null = empty)
let idGrid = createGrid().map(row => row.map(() => null));

/**
 * Render a full game state to DOM.
 * @param {object} opts
 *   newTile   - {r, c, value}  tile just spawned
 *   merged    - [{r,c}]        positions that merged (for pop anim)
 */
function render({ newTile = null, merged = [] } = {}) {
  // --- Stats ---
  updateStat(dom.scoreDisplay, state.score);
  updateStat(dom.bestDisplay,  state.bestScore);
  dom.movesDisplay.textContent = state.moves;

  // --- Tiles ---
  // 1. For each position, check if tile ID still maps to the same value;
  //    reuse or recreate elements.
  // Build a flat list of {r, c, value, id} we expect to see.
  const expected = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const val = state.grid[r][c];
      if (val !== 0) expected.push({ r, c, val });
    }
  }

  // Remove all tile elements and rebuild — simple, flicker-free approach
  // with CSS transitions handling the animation.
  // We keep track of which IDs are "alive" this frame.

  // Move approach: we maintain idGrid across moves.
  // After applyMove the idGrid is rebuilt by the move handler (handleMove).
  // Here we just sync DOM to idGrid.

  // Sync every tile in tileMap to its position in idGrid
  // (positions were already updated by handleMove).
  tileMap.forEach((el, id) => {
    const pos = findIdInGrid(id);
    if (pos) {
      el.style.setProperty('--c', pos.c);
      el.style.setProperty('--r', pos.r);
    }
  });

  // Apply merge animation
  merged.forEach(({ r, c }) => {
    const id = idGrid[r][c];
    if (id !== null && tileMap.has(id)) {
      const el = tileMap.get(id);
      el.classList.remove('tile-merge');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('tile-merge');
    }
  });
}

/** Find where a tile ID is in idGrid. Returns {r,c} or null. */
function findIdInGrid(id) {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (idGrid[r][c] === id) return { r, c };
    }
  }
  return null;
}

/** Update a stat display with bump animation if value changed. */
function updateStat(el, newVal) {
  const current = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
  const formatted = newVal.toLocaleString();
  if (current !== newVal) {
    el.textContent = formatted;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

/** Create a new tile DOM element. */
function createTileEl(value, r, c) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.value = value;
  el.setAttribute('aria-label', `Tile ${value}`);
  el.textContent = value;
  el.style.setProperty('--c', c);
  el.style.setProperty('--r', r);
  dom.tileLayer.appendChild(el);
  return el;
}

/* ============================================================
   MOVE HANDLER
   ============================================================ */

/**
 * Process a direction input.
 * Updates state, rebuilds idGrid, spawns new tile, renders.
 */
function handleMove(direction) {
  if (state.gameOver) return;

  const { newGrid, scoreDelta, moved, mergedCells } = applyMove(state.grid, direction);
  if (!moved) return;

  // ── Update idGrid to follow tile movements ──
  // Build a mapping: old positions → new positions.
  // Strategy: simulate the same slide on idGrid.
  idGrid = slideIdGrid(idGrid, direction, state.grid, newGrid);

  // Update state
  state.grid    = newGrid;
  state.score  += scoreDelta;
  state.moves  += 1;

  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    localStorage.setItem(LS_BEST_KEY, state.bestScore);
  }

  // Update merged tile DOM values (after merge, value doubled)
  mergedCells.forEach(({ r, c }) => {
    const id = idGrid[r][c];
    if (id !== null && tileMap.has(id)) {
      const el = tileMap.get(id);
      el.dataset.value = state.grid[r][c];
      el.textContent   = state.grid[r][c];
    }
  });

  // Render movements via CSS transitions
  render({ merged: mergedCells });

  // Show floating score pop
  if (scoreDelta > 0) spawnScorePop(scoreDelta);

  // After movement animation, spawn new tile
  setTimeout(() => {
    const spawnedPos = spawnTile(state.grid);
    if (spawnedPos) {
      const id = nextTileId++;
      idGrid[spawnedPos.r][spawnedPos.c] = id;
      const el = createTileEl(spawnedPos.value, spawnedPos.r, spawnedPos.c);
      el.classList.add('tile-new');
      tileMap.set(id, el);
    }

    // Check win (only fire once unless they chose to continue)
    if (!state.won && !state.continuePlay) {
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          if (state.grid[r][c] >= WIN_VALUE) {
            state.won = true;
            showWinModal();
            return;
          }
        }
      }
    }

    // Check lose
    if (!hasMovesLeft(state.grid)) {
      state.gameOver = true;
      stopTimer();
      showLoseModal();
    }
  }, 105); // slightly after CSS transition
}

/**
 * Slide idGrid to mirror how the value grid slid.
 * Handles merges: when two values merge, keep the id of the "survivor"
 * (the one that stays) and remove the id of the absorbed tile.
 */
function slideIdGrid(iGrid, direction, oldGrid, newGrid) {
  const out = createGrid().map(row => row.map(() => null));

  const processIdLine = (getOldVal, getId, setOut, positions) => {
    // Extract ids along this line
    const lineIds = positions.map(getId);
    const lineVals = positions.map(getOldVal);

    // Filter non-zero pairs
    const pairs = lineIds
      .map((id, i) => ({ id, val: lineVals[i] }))
      .filter(p => p.val !== 0);

    // Slide and merge ids
    const merged = [];
    for (let i = 0; i < pairs.length - 1; i++) {
      if (pairs[i].val === pairs[i + 1].val) {
        // Merge: keep first id as survivor, remove second
        merged.push({ survivorId: pairs[i].id, absorbedId: pairs[i + 1].id });
        pairs.splice(i + 1, 1);
        i--; // recheck — but we incremented in outer loop so net 0
      }
    }

    // Remove absorbed tile elements
    merged.forEach(({ absorbedId }) => {
      if (tileMap.has(absorbedId)) {
        // Delay removal until after animation
        const el = tileMap.get(absorbedId);
        setTimeout(() => el.remove(), 110);
        tileMap.delete(absorbedId);
      }
    });

    // Write survivors to output positions
    pairs.forEach((p, i) => setOut(positions[i], p.id));
  };

  if (direction === 'left' || direction === 'right') {
    for (let r = 0; r < GRID_SIZE; r++) {
      const cols = direction === 'left' ? [0,1,2,3] : [3,2,1,0];
      const positions = cols.map(c => ({ r, c }));
      processIdLine(
        pos => oldGrid[pos.r][pos.c],
        pos => iGrid[pos.r][pos.c],
        (pos, id) => { out[pos.r][pos.c] = id; },
        positions
      );
    }
  } else {
    for (let c = 0; c < GRID_SIZE; c++) {
      const rows = direction === 'up' ? [0,1,2,3] : [3,2,1,0];
      const positions = rows.map(r => ({ r, c }));
      processIdLine(
        pos => oldGrid[pos.r][pos.c],
        pos => iGrid[pos.r][pos.c],
        (pos, id) => { out[pos.r][pos.c] = id; },
        positions
      );
    }
  }

  return out;
}

/* ============================================================
   SCORE POP
   ============================================================ */
function spawnScorePop(amount) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.textContent = `+${amount.toLocaleString()}`;
  // Position near score stat
  const rect = dom.statScore.getBoundingClientRect();
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top  = `${rect.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

/* ============================================================
   TIMER
   ============================================================ */
function startTimer() {
  stopTimer();
  state.timerSecs = 0;
  dom.timerDisplay.textContent = '00:00';
  state.timerHandle = setInterval(() => {
    state.timerSecs++;
    dom.timerDisplay.textContent = formatTime(state.timerSecs);
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerHandle);
  state.timerHandle = null;
}

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ============================================================
   MODALS
   ============================================================ */
function showWinModal() {
  stopTimer();
  dom.winScore.textContent = state.score.toLocaleString();
  dom.modalWin.removeAttribute('hidden');
}

function hideWinModal() {
  dom.modalWin.setAttribute('hidden', '');
}

function showLoseModal() {
  dom.loseScore.textContent = state.score.toLocaleString();
  dom.modalLose.removeAttribute('hidden');
}

function hideLoseModal() {
  dom.modalLose.setAttribute('hidden', '');
}

/* ============================================================
   NEW GAME
   ============================================================ */
function newGame() {
  // Reset state
  state.score       = 0;
  state.moves       = 0;
  state.won         = false;
  state.continuePlay = false;
  state.gameOver    = false;
  state.grid        = createGrid();

  // Clear tiles
  tileMap.forEach(el => el.remove());
  tileMap.clear();
  idGrid = createGrid().map(row => row.map(() => null));
  nextTileId = 0;

  // Hide modals
  hideWinModal();
  hideLoseModal();

  // Update stats display immediately
  dom.scoreDisplay.textContent = '0';
  dom.movesDisplay.textContent = '0';

  // Spawn two starting tiles
  for (let i = 0; i < 2; i++) {
    const pos = spawnTile(state.grid);
    if (pos) {
      const id = nextTileId++;
      idGrid[pos.r][pos.c] = id;
      const el = createTileEl(pos.value, pos.r, pos.c);
      el.classList.add('tile-new');
      tileMap.set(id, el);
    }
  }

  // Start timer
  startTimer();

  // Initial render
  render();

  // Update best display
  dom.bestDisplay.textContent = state.bestScore.toLocaleString();
}

/* ============================================================
   INPUT: KEYBOARD
   ============================================================ */
const KEY_MAP = {
  ArrowUp:    'up',
  ArrowDown:  'down',
  ArrowLeft:  'left',
  ArrowRight: 'right',
  w: 'up', W: 'up',
  s: 'down', S: 'down',
  a: 'left', A: 'left',
  d: 'right', D: 'right',
};

document.addEventListener('keydown', e => {
  const dir = KEY_MAP[e.key];
  if (!dir) return;
  e.preventDefault();
  handleMove(dir);
});

/* ============================================================
   INPUT: TOUCH / SWIPE
   ============================================================ */
let touchStartX = 0;
let touchStartY = 0;
const SWIPE_THRESHOLD = 30; // px

document.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;

  if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

  if (Math.abs(dx) > Math.abs(dy)) {
    handleMove(dx > 0 ? 'right' : 'left');
  } else {
    handleMove(dy > 0 ? 'down' : 'up');
  }
}, { passive: true });

/* ============================================================
   BUTTON HANDLERS
   ============================================================ */
dom.btnNew.addEventListener('click', newGame);

dom.btnContinue.addEventListener('click', () => {
  state.continuePlay = true;
  hideWinModal();
  startTimer(); // resume timer
});

dom.btnWinNew.addEventListener('click', newGame);
dom.btnTryAgain.addEventListener('click', newGame);
dom.btnLoseNew.addEventListener('click', newGame);

// Close modal on overlay click (outside card)
dom.modalWin.addEventListener('click', e => {
  if (e.target === dom.modalWin) {
    state.continuePlay = true;
    hideWinModal();
    startTimer();
  }
});

dom.modalLose.addEventListener('click', e => {
  if (e.target === dom.modalLose) newGame();
});

/* ============================================================
   BOOT
   ============================================================ */
newGame();
