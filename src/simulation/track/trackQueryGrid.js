import { clamp } from '../simMath.js';
import { ensureQueryScratch, ensureScratchArray, nextScratchEpoch } from './trackQueryScratch.js';

export function createSpatialGrid(bounds, cellSize) {
  const columns = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellSize));
  return {
    bounds,
    cellSize,
    columns,
    rows,
    cells: new Array(columns * rows),
  };
}

export function insertIdIntoGridBounds(grid, id, bounds) {
  const minCell = gridCellForPoint(grid, { x: bounds.minX, y: bounds.minY }, true);
  const maxCell = gridCellForPoint(grid, { x: bounds.maxX, y: bounds.maxY }, true);
  for (let row = minCell.row; row <= maxCell.row; row += 1) {
    for (let column = minCell.column; column <= maxCell.column; column += 1) {
      const cellIndex = row * grid.columns + column;
      const cell = grid.cells[cellIndex];
      if (cell) cell.push(id);
      else grid.cells[cellIndex] = [id];
    }
  }
}

export function candidateIdsFromGrid(index, grid, position, neighborLimit) {
  const center = gridCellForPoint(grid, position, false);
  if (!center) return [];
  const scratch = ensureQueryScratch(index);
  const maxId = Math.max(index.centerline.segmentCount, index.pit?.roadSegments?.length ?? 0, index.pit?.boxCandidates?.length ?? 0);
  const idMarks = ensureScratchArray(scratch, 'candidateMarks', maxId);
  const ids = [];
  for (let radius = 0; radius <= neighborLimit; radius += 1) {
    const candidateEpoch = nextScratchEpoch(scratch, 'candidateEpoch', idMarks);
    ids.length = 0;
    for (let row = center.row - radius; row <= center.row + radius; row += 1) {
      for (let column = center.column - radius; column <= center.column + radius; column += 1) {
        if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue;
        const cell = grid.cells[row * grid.columns + column];
        if (!cell) continue;
        for (const id of cell) {
          if (idMarks[id] === candidateEpoch) continue;
          idMarks[id] = candidateEpoch;
          ids.push(id);
        }
      }
    }
    if (ids.length) return ids.slice();
  }
  return [];
}

export function candidateIdsFromGridBounds(index, grid, bounds) {
  if (
    bounds.maxX < grid.bounds.minX ||
    bounds.minX > grid.bounds.maxX ||
    bounds.maxY < grid.bounds.minY ||
    bounds.minY > grid.bounds.maxY
  ) return [];
  const minPoint = { x: bounds.minX, y: bounds.minY };
  const maxPoint = { x: bounds.maxX, y: bounds.maxY };
  const minCell = gridCellForPoint(grid, minPoint, true);
  const maxCell = gridCellForPoint(grid, maxPoint, true);
  const scratch = ensureQueryScratch(index);
  const maxId = Math.max(index.centerline.segmentCount, index.pit?.roadSegments?.length ?? 0, index.pit?.boxCandidates?.length ?? 0);
  const idMarks = ensureScratchArray(scratch, 'candidateMarks', maxId);
  const candidateEpoch = nextScratchEpoch(scratch, 'candidateEpoch', idMarks);
  const ids = [];
  for (let row = minCell.row; row <= maxCell.row; row += 1) {
    for (let column = minCell.column; column <= maxCell.column; column += 1) {
      const cell = grid.cells[row * grid.columns + column];
      if (!cell) continue;
      for (const id of cell) {
        if (idMarks[id] === candidateEpoch) continue;
        idMarks[id] = candidateEpoch;
        ids.push(id);
      }
    }
  }
  return ids;
}

export function gridCellForPoint(grid, point, clampToGrid) {
  const column = Math.floor((point.x - grid.bounds.minX) / grid.cellSize);
  const row = Math.floor((point.y - grid.bounds.minY) / grid.cellSize);
  if (!clampToGrid && (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows)) return null;
  return {
    column: clampToGrid ? clamp(column, 0, grid.columns - 1) : column,
    row: clampToGrid ? clamp(row, 0, grid.rows - 1) : row,
  };
}
