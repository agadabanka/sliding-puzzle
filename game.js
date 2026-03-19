/**
 * Sliding Puzzle (15-Puzzle) — TypeScript IL game spec using @engine SDK.
 *
 * 4x4 grid with numbers 1-15 and one empty space.
 * Slide tiles into the empty space to sort them in order.
 *   - AI 1: Solves using Manhattan distance heuristic (greedy best-first)
 *   - AI 2: Random valid moves
 * Player uses arrow keys to slide tiles into the empty space.
 */

import { defineGame } from '@engine/core';
import { pickBestMove, pickRandomMove } from '@engine/ai';
import { consumeAction } from '@engine/input';
import {
  clearCanvas, drawBorder, drawRoundedRect,
  drawTextCell, drawLabel, drawHUD, drawGameOver,
} from '@engine/render';
import { drawTouchOverlay } from '@engine/touch';

// ── Constants ───────────────────────────────────────────────────────

const SIZE = 4;
const TOTAL = SIZE * SIZE;
const CELL = 80;
const MARGIN = 20;
const BOARD_PX = SIZE * CELL;
const GAP = 3;

const CANVAS_W = BOARD_PX + MARGIN * 2 + 180;
const CANVAS_H = BOARD_PX + MARGIN * 2 + 50;

// ── Game Definition ─────────────────────────────────────────────────

const game = defineGame({
  display: {
    type: 'custom',
    width: SIZE,
    height: SIZE,
    cellSize: CELL,
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    offsetX: MARGIN,
    offsetY: MARGIN + 30,
    background: '#1a1a2e',
  },
  input: {
    up:      { keys: ['ArrowUp', 'w'] },
    down:    { keys: ['ArrowDown', 's'] },
    left:    { keys: ['ArrowLeft', 'a'] },
    right:   { keys: ['ArrowRight', 'd'] },
    select:  { keys: [' ', 'Enter'] },
    restart: { keys: ['r', 'R'] },
  },
});

// ── Resources ───────────────────────────────────────────────────────

game.resource('state', {
  score: 0,
  gameOver: false,
  won: false,
  moveCount: 0,
  message: 'Slide tiles to sort them!',
  currentTurn: 'solver', // 'solver' | 'random' in aiVsAi
});

game.resource('board', {
  tiles: [],       // flat array of SIZE*SIZE, 0 = empty space
  emptyR: 0,
  emptyC: 0,
  initialized: false,
  lastMove: null,  // { r, c } tile that was moved
});

game.resource('_cursor', { r: 0, c: 0 });
game.resource('_aiTimer', { elapsed: 0 });
game.resource('_aiSolver', {
  path: [],        // precomputed sequence of moves
  pathIndex: 0,
  computed: false,
});

// ── Puzzle Generation ───────────────────────────────────────────────

function generateSolvablePuzzle() {
  // Start from solved state and make random moves
  const tiles = [];
  for (let i = 1; i < TOTAL; i++) tiles.push(i);
  tiles.push(0);

  let emptyIdx = TOTAL - 1;
  const moves = 200 + Math.floor(Math.random() * 100);

  for (let m = 0; m < moves; m++) {
    const er = Math.floor(emptyIdx / SIZE);
    const ec = emptyIdx % SIZE;
    const neighbors = [];

    if (er > 0) neighbors.push(emptyIdx - SIZE);
    if (er < SIZE - 1) neighbors.push(emptyIdx + SIZE);
    if (ec > 0) neighbors.push(emptyIdx - 1);
    if (ec < SIZE - 1) neighbors.push(emptyIdx + 1);

    const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
    tiles[emptyIdx] = tiles[pick];
    tiles[pick] = 0;
    emptyIdx = pick;
  }

  return { tiles, emptyR: Math.floor(emptyIdx / SIZE), emptyC: emptyIdx % SIZE };
}

function isSolved(tiles) {
  for (let i = 0; i < TOTAL - 1; i++) {
    if (tiles[i] !== i + 1) return false;
  }
  return tiles[TOTAL - 1] === 0;
}

function manhattanDistance(tiles) {
  let dist = 0;
  for (let i = 0; i < TOTAL; i++) {
    const val = tiles[i];
    if (val === 0) continue;
    const goalR = Math.floor((val - 1) / SIZE);
    const goalC = (val - 1) % SIZE;
    const curR = Math.floor(i / SIZE);
    const curC = i % SIZE;
    dist += Math.abs(goalR - curR) + Math.abs(goalC - curC);
  }
  return dist;
}

function tileAt(tiles, r, c) {
  return tiles[r * SIZE + c];
}

function swapTile(tiles, emptyR, emptyC, tileR, tileC) {
  const ei = emptyR * SIZE + emptyC;
  const ti = tileR * SIZE + tileC;
  tiles[ei] = tiles[ti];
  tiles[ti] = 0;
}

// ── Init System ─────────────────────────────────────────────────────

game.system('init', function initSystem(world, _dt) {
  const board = world.getResource('board');
  if (board.initialized) return;
  board.initialized = true;

  const puzzle = generateSolvablePuzzle();
  board.tiles = puzzle.tiles;
  board.emptyR = puzzle.emptyR;
  board.emptyC = puzzle.emptyC;
});

// ── Player Input System ─────────────────────────────────────────────

game.system('playerInput', function playerInputSystem(world, _dt) {
  const gm = world.getResource('gameMode');
  if (!gm || gm.mode !== 'playerVsAi') return;

  const state = world.getResource('state');
  if (state.gameOver) return;

  const input = world.getResource('input');
  const board = world.getResource('board');

  // Arrow keys slide the tile adjacent to empty INTO the empty space
  // Up arrow: tile below empty moves up
  let dr = 0, dc = 0;

  if (consumeAction(input, 'up')) { dr = 1; dc = 0; }
  else if (consumeAction(input, 'down')) { dr = -1; dc = 0; }
  else if (consumeAction(input, 'left')) { dr = 0; dc = 1; }
  else if (consumeAction(input, 'right')) { dr = 0; dc = -1; }

  if (dr !== 0 || dc !== 0) {
    const tr = board.emptyR + dr;
    const tc = board.emptyC + dc;

    if (tr >= 0 && tr < SIZE && tc >= 0 && tc < SIZE) {
      swapTile(board.tiles, board.emptyR, board.emptyC, tr, tc);
      board.lastMove = { r: board.emptyR, c: board.emptyC };
      board.emptyR = tr;
      board.emptyC = tc;
      state.moveCount++;
      state.score = Math.max(0, state.score - 1);

      if (isSolved(board.tiles)) {
        state.gameOver = true;
        state.won = true;
        state.message = 'Puzzle solved!';
        state.score += 200;
      } else {
        const dist = manhattanDistance(board.tiles);
        state.message = `Moves: ${state.moveCount} | Distance: ${dist}`;
      }
    }
  }
});

// ── AI System ───────────────────────────────────────────────────────

const AI_DELAY = 300;

game.system('ai', function aiSystem(world, dt) {
  const state = world.getResource('state');
  if (state.gameOver) return;

  const gm = world.getResource('gameMode');
  if (gm && gm.mode === 'playerVsAi') return;

  const timer = world.getResource('_aiTimer');
  timer.elapsed += dt;
  if (timer.elapsed < AI_DELAY) return;
  timer.elapsed = 0;

  const board = world.getResource('board');

  if (state.currentTurn === 'solver') {
    // Greedy best-first: pick the neighbor move that minimizes Manhattan distance
    aiGreedyMove(board, state);
  } else {
    // Random mover
    aiRandomMove(board, state);
  }

  state.moveCount++;

  if (isSolved(board.tiles)) {
    state.gameOver = true;
    state.won = true;
    state.message = `Solved in ${state.moveCount} moves!`;
    state.score += 200;
    return;
  }

  // Alternate turns in aiVsAi
  state.currentTurn = state.currentTurn === 'solver' ? 'random' : 'solver';
  const dist = manhattanDistance(board.tiles);
  state.message = `Move ${state.moveCount} | Distance: ${dist}`;
});

function getNeighborMoves(emptyR, emptyC) {
  const moves = [];
  if (emptyR > 0) moves.push({ r: emptyR - 1, c: emptyC });
  if (emptyR < SIZE - 1) moves.push({ r: emptyR + 1, c: emptyC });
  if (emptyC > 0) moves.push({ r: emptyR, c: emptyC - 1 });
  if (emptyC < SIZE - 1) moves.push({ r: emptyR, c: emptyC + 1 });
  return moves;
}

function aiGreedyMove(board, state) {
  const moves = getNeighborMoves(board.emptyR, board.emptyC);

  // Evaluate each possible move
  const scoredMoves = moves.map(m => {
    const testTiles = [...board.tiles];
    const ei = board.emptyR * SIZE + board.emptyC;
    const ti = m.r * SIZE + m.c;
    testTiles[ei] = testTiles[ti];
    testTiles[ti] = 0;
    const dist = manhattanDistance(testTiles);
    // Add small random factor to prevent infinite loops
    return { ...m, score: -dist + Math.random() * 0.5 };
  });

  const best = pickBestMove(scoredMoves, m => m.score);
  swapTile(board.tiles, board.emptyR, board.emptyC, best.r, best.c);
  board.lastMove = { r: board.emptyR, c: board.emptyC };
  board.emptyR = best.r;
  board.emptyC = best.c;
}

function aiRandomMove(board, state) {
  const moves = getNeighborMoves(board.emptyR, board.emptyC);
  const pick = pickRandomMove(moves);
  swapTile(board.tiles, board.emptyR, board.emptyC, pick.r, pick.c);
  board.lastMove = { r: board.emptyR, c: board.emptyC };
  board.emptyR = pick.r;
  board.emptyC = pick.c;
}

// ── Render System ───────────────────────────────────────────────────

const TILE_COLORS = [
  '#e53935', '#d81b60', '#8e24aa', '#5c6bc0',
  '#1e88e5', '#039be5', '#00acc1', '#00897b',
  '#43a047', '#7cb342', '#c0ca33', '#fdd835',
  '#ffb300', '#fb8c00', '#f4511e',
];

game.system('render', function renderSystem(world, _dt) {
  const renderer = world.getResource('renderer');
  if (!renderer) return;

  const { ctx } = renderer;
  const state = world.getResource('state');
  const board = world.getResource('board');
  const ox = MARGIN;
  const oy = MARGIN + 30;

  clearCanvas(ctx, '#1a1a2e');

  // Title
  drawLabel(ctx, '15 PUZZLE', ox, oy - 10, { color: '#e0e0e0', fontSize: 18 });

  // Board background
  drawRoundedRect(ctx, ox - 4, oy - 4, BOARD_PX + 8, BOARD_PX + 8, 10, '#111122', {
    strokeColor: '#333355', strokeWidth: 2,
  });

  // Draw tiles
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const val = tileAt(board.tiles, r, c);
      const px = ox + c * CELL;
      const py = oy + r * CELL;

      if (val === 0) {
        // Empty space
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(px + GAP, py + GAP, CELL - GAP * 2, CELL - GAP * 2);
        continue;
      }

      const colorIdx = (val - 1) % TILE_COLORS.length;
      const isCorrectPos = val === r * SIZE + c + 1;

      // Tile background
      const tileColor = isCorrectPos ? '#2e7d32' : TILE_COLORS[colorIdx];
      drawRoundedRect(ctx, px + GAP, py + GAP, CELL - GAP * 2, CELL - GAP * 2, 6, tileColor, {
        strokeColor: isCorrectPos ? '#4caf50' : 'rgba(255,255,255,0.2)',
        strokeWidth: isCorrectPos ? 2 : 1,
      });

      // Tile number
      drawTextCell(ctx, String(val), px, py, CELL, CELL, {
        color: '#fff',
        fontSize: 24,
        fontWeight: 'bold',
      });

      // Highlight last moved tile
      if (board.lastMove && board.lastMove.r === r && board.lastMove.c === c) {
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + GAP + 1, py + GAP + 1, CELL - GAP * 2 - 2, CELL - GAP * 2 - 2);
      }
    }
  }

  drawBorder(ctx, ox - 4, oy - 4, BOARD_PX + 8, BOARD_PX + 8, '#333355');

  // HUD
  const hudX = ox + BOARD_PX + 20;
  const gm = world.getResource('gameMode');
  const isPlayerMode = gm && gm.mode === 'playerVsAi';

  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = '#e0e0e0';
  ctx.fillText(state.message, hudX, oy + 20);

  ctx.font = '12px monospace';
  ctx.fillStyle = '#888';
  ctx.fillText(`Moves: ${state.moveCount}`, hudX, oy + 50);

  const dist = manhattanDistance(board.tiles);
  ctx.fillText(`Manhattan: ${dist}`, hudX, oy + 68);
  ctx.fillText(`Score: ${state.score}`, hudX, oy + 86);

  // Count correct tiles
  let correct = 0;
  for (let i = 0; i < TOTAL - 1; i++) {
    if (board.tiles[i] === i + 1) correct++;
  }
  ctx.fillText(`Correct: ${correct}/${TOTAL - 1}`, hudX, oy + 104);

  // Progress bar
  const barW = 140;
  const barH = 8;
  const barY = oy + 118;
  ctx.fillStyle = '#333';
  ctx.fillRect(hudX, barY, barW, barH);
  ctx.fillStyle = '#4caf50';
  ctx.fillRect(hudX, barY, barW * (correct / (TOTAL - 1)), barH);

  // Mode info
  ctx.font = '11px monospace';
  ctx.fillStyle = '#666';
  if (isPlayerMode) {
    ctx.fillText('Arrow keys to slide', hudX, oy + 155);
    ctx.fillText('tiles into empty space', hudX, oy + 170);
    ctx.fillText('R to restart', hudX, oy + 185);
  } else {
    ctx.fillText('Solver (Greedy)', hudX, oy + 155);
    ctx.fillStyle = '#4caf50';
    ctx.fillText(state.currentTurn === 'solver' ? '> active' : '  waiting', hudX + 100, oy + 155);
    ctx.fillStyle = '#666';
    ctx.fillText('Random Mover', hudX, oy + 173);
    ctx.fillStyle = '#ff9800';
    ctx.fillText(state.currentTurn === 'random' ? '> active' : '  waiting', hudX + 100, oy + 173);
  }

  // Visual grid of goal state
  ctx.font = '10px monospace';
  ctx.fillStyle = '#555';
  ctx.fillText('Goal:', hudX, oy + 210);
  const miniCell = 18;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const val = r * SIZE + c + 1;
      const px = hudX + c * miniCell;
      const py = oy + 218 + r * miniCell;
      if (val < TOTAL) {
        ctx.fillStyle = '#334';
        ctx.fillRect(px, py, miniCell - 1, miniCell - 1);
        ctx.fillStyle = '#888';
        ctx.font = '8px monospace';
        ctx.fillText(String(val), px + 3, py + 12);
      }
    }
  }

  if (state.gameOver) {
    drawGameOver(ctx, ox - 4, oy - 4, BOARD_PX + 8, BOARD_PX + 8, {
      title: 'SOLVED!',
      titleColor: '#4caf50',
      subtitle: `${state.moveCount} moves | Score: ${state.score} | Press R`,
    });
  }

  drawTouchOverlay(ctx, ctx.canvas.width, ctx.canvas.height);
});

export default game;
