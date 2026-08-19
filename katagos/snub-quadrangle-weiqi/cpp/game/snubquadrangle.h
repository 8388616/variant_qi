#ifndef GAME_SNUBQUADRANGLE_H_
#define GAME_SNUBQUADRANGLE_H_

#include <cstdint>

// Snub quadrangle weiqi: embedding on a (3*lanes-2) x (3*lanes-2) grid with holes.
// Vertex validity matches variant_qi 扭棱四角围棋.html / snub-quadrangle-weiqi.js:
//   board[row][col] — row = vertical (0 = top), col = horizontal (0 = left).
// KataGo Board uses Location (x, y) with x = horizontal, y = vertical; use the *BoardXY
// helpers below when calling from getX/getY.
//
// Rectangular grid flips do not map playable vertices to playable vertices. For symmetries
// 0..3 (flipY, flipX, 180°), use applySymmetryRC / applySymmetryBoardXY: within each column,
// flip the order of playable rows; within each row, flip the order of playable columns.
// That bijection preserves the playable set and the snub graph (neighbors).

namespace SnubQuadrangle {

static constexpr int MIN_LANES = 2;
static constexpr int MAX_LANES = 8;
static constexpr int MAX_GRID_LEN = 22;

inline int gridLenFromLanes(int lanes) { return 3 * lanes - 2; }

inline bool isValidVertex(int row, int col, int gridW, int gridH) {
  if(row < 0 || col < 0 || row >= gridW || col >= gridH)
    return false;
  if(row % 3 == 2 && col % 3 == 2)
    return false;
  if(row == gridW - 1 && row % 3 == 0 && col % 3 == 1)
    return false;
  if(col == gridH - 1 && row % 3 == 0 && col % 3 == 0)
    return false;
  return true;
}

inline int lanesFromGridLen(int gridLen) { return (gridLen + 2) / 3; }

inline bool isSnubGridLen(int gridLen) {
  int lanes = lanesFromGridLen(gridLen);
  return gridLen == gridLenFromLanes(lanes) && lanes >= MIN_LANES && lanes <= MAX_LANES;
}

/// KataGo board coords: x = horizontal (col), y = vertical (row).
inline bool isValidVertexBoardXY(int x, int y, int gridW, int gridH) {
  return isValidVertex(y, x, gridW, gridH);
}

// Symmetry bits match SymmetryHelpers: bit0=flipY (column-wise row reversal), bit1=flipX (row-wise col reversal).
// transpose (bit2) must not be set. O(1) via tables built once per snub grid size (see snubquadrangle.cpp).
void applySymmetryRC(int& row, int& col, int gridW, int gridH, int symmetry);

// Flat index permutation for NN tensors (length gridLen*gridLen); NULL if unavailable.
const uint16_t* getNNPosPermutation(int gridLen, int symmetry);

// Board embedded in a larger tensor (e.g. 10x10 snub board in 19x19 NN buffer). O(1) lookup table.
const uint16_t* getNNTensorPosPermutation(int tensorLen, int snubGridLen, int symmetry);

// Pre-build symmetry tables (optional; otherwise built on first use).
void warmSymmetryCache(int gridLen);
// Also pre-build tensor embed perms for tensorLen (e.g. 19) on all snub grid sizes.
void warmSymmetryCacheForTensor(int tensorLen);

inline void applySymmetryBoardXY(int& x, int& y, int gridW, int gridH, int symmetry) {
  applySymmetryRC(y, x, gridW, gridH, symmetry);
}

// Fills outR/outC with valid graph neighbors of (row,col), in fixed order (max 5).
// Same order as forEachNeighborXY / Board::playMoveRecorded capture-bit indexing.
inline int collectNeighborRC(int row, int col, int gridW, int gridH, int* outR, int* outC) {
  int rm = row % 3;
  int cm = col % 3;
  int candR[5];
  int candC[5];
  int n = 0;
  if(rm == 0 && cm == 0) {
    candR[n] = row - 1; candC[n++] = col;
    candR[n] = row - 1; candC[n++] = col + 1;
    candR[n] = row; candC[n++] = col - 1;
    candR[n] = row; candC[n++] = col + 1;
    candR[n] = row + 1; candC[n++] = col;
  }
  else if(rm == 1 && cm == 0) {
    candR[n] = row - 1; candC[n++] = col - 1;
    candR[n] = row - 1; candC[n++] = col;
    candR[n] = row; candC[n++] = col - 1;
    candR[n] = row; candC[n++] = col + 1;
    candR[n] = row + 1; candC[n++] = col;
  }
  else if(rm == 2 && cm == 0) {
    candR[n] = row - 1; candC[n++] = col - 1;
    candR[n] = row - 1; candC[n++] = col;
    candR[n] = row - 1; candC[n++] = col + 1;
    candR[n] = row + 1; candC[n++] = col - 1;
    candR[n] = row + 1; candC[n++] = col;
  }
  else if(rm == 0 && cm == 1) {
    candR[n] = row - 1; candC[n++] = col;
    candR[n] = row; candC[n++] = col - 1;
    candR[n] = row; candC[n++] = col + 1;
    candR[n] = row + 1; candC[n++] = col;
    candR[n] = row + 1; candC[n++] = col + 1;
  }
  else if(rm == 1 && cm == 1) {
    candR[n] = row - 1; candC[n++] = col;
    candR[n] = row; candC[n++] = col - 1;
    candR[n] = row; candC[n++] = col + 1;
    candR[n] = row + 1; candC[n++] = col - 1;
    candR[n] = row + 1; candC[n++] = col;
  }
  else if(rm == 2 && cm == 1) {
    candR[n] = row - 1; candC[n++] = col;
    candR[n] = row - 1; candC[n++] = col + 1;
    candR[n] = row + 1; candC[n++] = col - 1;
    candR[n] = row + 1; candC[n++] = col;
    candR[n] = row + 1; candC[n++] = col + 1;
  }
  else if(rm == 0 && cm == 2) {
    candR[n] = row - 1; candC[n++] = col - 1;
    candR[n] = row - 1; candC[n++] = col + 1;
    candR[n] = row; candC[n++] = col - 1;
    candR[n] = row; candC[n++] = col + 1;
    candR[n] = row + 1; candC[n++] = col + 1;
  }
  else if(rm == 1 && cm == 2) {
    candR[n] = row - 1; candC[n++] = col - 1;
    candR[n] = row; candC[n++] = col - 1;
    candR[n] = row; candC[n++] = col + 1;
    candR[n] = row + 1; candC[n++] = col - 1;
    candR[n] = row + 1; candC[n++] = col + 1;
  }
  else {
    return 0;
  }
  int w = 0;
  for(int i = 0; i < n; i++) {
    if(isValidVertex(candR[i], candC[i], gridW, gridH)) {
      outR[w] = candR[i];
      outC[w] = candC[i];
      w++;
    }
  }
  return w;
}

inline int collectNeighborRCBoardXY(int x, int y, int gridW, int gridH, int* outRow, int* outCol) {
  return collectNeighborRC(y, x, gridW, gridH, outRow, outCol);
}

// Invokes f(nx, ny) for each valid graph neighbor of (row,col), in a fixed order
// (must match undo capture-bit ordering in Board::playMoveRecorded / undo).
template<typename Func>
inline void forEachNeighborXY(int row, int col, int gridW, int gridH, const Func& f) {
  int outR[5];
  int outC[5];
  int w = collectNeighborRC(row, col, gridW, gridH, outR, outC);
  for(int i = 0; i < w; i++)
    f(outR[i], outC[i]);
}

}  // namespace SnubQuadrangle

#endif  // GAME_SNUBQUADRANGLE_H_
