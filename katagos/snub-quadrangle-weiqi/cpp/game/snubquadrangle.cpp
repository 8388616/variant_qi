#include "../game/snubquadrangle.h"

#include <array>
#include <cstdint>
#include <mutex>

namespace SnubQuadrangle {

namespace {

struct SymmetryCache {
  bool built;
  int gridLen;
  int embedTensorLen;
  // [symmetry][row][col] -> image row/col (only meaningful for valid vertices)
  uint8_t symRow[4][MAX_GRID_LEN][MAX_GRID_LEN];
  uint8_t symCol[4][MAX_GRID_LEN][MAX_GRID_LEN];
  // NN spatial index permutation on gridLen x gridLen board indices
  uint16_t nnPosPerm[4][MAX_GRID_LEN * MAX_GRID_LEN];
  // board gridLen embedded in embedTensorLen x embedTensorLen tensor (multisize)
  uint16_t tensorEmbedPerm[4][MAX_GRID_LEN * MAX_GRID_LEN];
};

static int tensorEmbedPos(int tensorPos, int tensorLen, int snubGridLen, const uint16_t* boardPerm) {
  const int y = tensorPos / tensorLen;
  const int x = tensorPos % tensorLen;
  if(x >= snubGridLen || y >= snubGridLen)
    return tensorPos;
  const int boardFlat = y * snubGridLen + x;
  const int boardDstFlat = boardPerm[boardFlat];
  const int dy = boardDstFlat / snubGridLen;
  const int dx = boardDstFlat % snubGridLen;
  return dy * tensorLen + dx;
}

static void buildTensorEmbedPerm(SymmetryCache& cache, int tensorLen, int symmetry) {
  const uint16_t* boardPerm = cache.nnPosPerm[symmetry];
  const int area = tensorLen * tensorLen;
  for(int pos = 0; pos < area; pos++)
    cache.tensorEmbedPerm[symmetry][pos] = (uint16_t)tensorEmbedPos(pos, tensorLen, cache.gridLen, boardPerm);
}

static void ensureTensorEmbedPerm(SymmetryCache& cache, int tensorLen) {
  if(cache.embedTensorLen == tensorLen)
    return;
  cache.embedTensorLen = tensorLen;
  for(int symmetry = 0; symmetry < 4; symmetry++)
    buildTensorEmbedPerm(cache, tensorLen, symmetry);
}

static void applySymmetryRCSlow(int& row, int& col, int gridW, int gridH, int symmetry) {
  if((symmetry & 0x1) != 0) {
    int rows[MAX_GRID_LEN];
    int cnt = 0;
    for(int r = 0; r < gridW; r++) {
      if(isValidVertex(r, col, gridW, gridH))
        rows[cnt++] = r;
    }
    for(int i = 0; i < cnt; i++) {
      if(rows[i] == row) {
        row = rows[cnt - 1 - i];
        break;
      }
    }
  }
  if((symmetry & 0x2) != 0) {
    int cols[MAX_GRID_LEN];
    int cnt = 0;
    for(int c = 0; c < gridH; c++) {
      if(isValidVertex(row, c, gridW, gridH))
        cols[cnt++] = c;
    }
    for(int i = 0; i < cnt; i++) {
      if(cols[i] == col) {
        col = cols[cnt - 1 - i];
        break;
      }
    }
  }
}

static void buildSymmetryCache(SymmetryCache& cache, int gridLen) {
  cache.built = true;
  cache.gridLen = gridLen;
  cache.embedTensorLen = 0;
  for(int symmetry = 0; symmetry < 4; symmetry++) {
    for(int row = 0; row < gridLen; row++) {
      for(int col = 0; col < gridLen; col++) {
        int symRow = row;
        int symCol = col;
        applySymmetryRCSlow(symRow, symCol, gridLen, gridLen, symmetry);
        cache.symRow[symmetry][row][col] = (uint8_t)symRow;
        cache.symCol[symmetry][row][col] = (uint8_t)symCol;
      }
    }
    for(int row = 0; row < gridLen; row++) {
      for(int col = 0; col < gridLen; col++) {
        int srcPos = row * gridLen + col;
        int symRow = cache.symRow[symmetry][row][col];
        int symCol = cache.symCol[symmetry][row][col];
        cache.nnPosPerm[symmetry][srcPos] = (uint16_t)(symRow * gridLen + symCol);
      }
    }
  }
}

// lanes 2..8 -> grid 4,7,10,13,16,19,22
static std::array<SymmetryCache, 7> symmetryCaches = {};
static std::array<std::once_flag, 7> symmetryCacheOnce = {};

static SymmetryCache* getCacheForGridLen(int gridLen) {
  if(!isSnubGridLen(gridLen))
    return NULL;
  int idx = lanesFromGridLen(gridLen) - MIN_LANES;
  std::call_once(symmetryCacheOnce[idx], [&]() {
    buildSymmetryCache(symmetryCaches[idx], gridLen);
  });
  return &symmetryCaches[idx];
}

}  // namespace

void applySymmetryRC(int& row, int& col, int gridW, int gridH, int symmetry) {
  if(gridW != gridH)
    return;
  SymmetryCache* cache = getCacheForGridLen(gridW);
  if(cache != NULL && symmetry >= 0 && symmetry < 4) {
    row = cache->symRow[symmetry][row][col];
    col = cache->symCol[symmetry][row][col];
    return;
  }
  applySymmetryRCSlow(row, col, gridW, gridH, symmetry);
}

const uint16_t* getNNPosPermutation(int gridLen, int symmetry) {
  SymmetryCache* cache = getCacheForGridLen(gridLen);
  if(cache == NULL || symmetry < 0 || symmetry >= 4)
    return NULL;
  return cache->nnPosPerm[symmetry];
}

const uint16_t* getNNTensorPosPermutation(int tensorLen, int snubGridLen, int symmetry) {
  if(tensorLen <= 0 || symmetry < 0 || symmetry >= 4)
    return NULL;
  if(snubGridLen <= 0 || snubGridLen > tensorLen)
    snubGridLen = tensorLen;
  if(snubGridLen == tensorLen)
    return getNNPosPermutation(tensorLen, symmetry);
  SymmetryCache* cache = getCacheForGridLen(snubGridLen);
  if(cache == NULL)
    return NULL;
  ensureTensorEmbedPerm(*cache, tensorLen);
  return cache->tensorEmbedPerm[symmetry];
}

void warmSymmetryCache(int gridLen) {
  getCacheForGridLen(gridLen);
}

void warmSymmetryCacheForTensor(int tensorLen) {
  if(tensorLen <= 0)
    return;
  for(int lanes = MIN_LANES; lanes <= MAX_LANES; lanes++) {
    int gridLen = gridLenFromLanes(lanes);
    if(gridLen > tensorLen)
      continue;
    SymmetryCache* cache = getCacheForGridLen(gridLen);
    if(cache != NULL)
      ensureTensorEmbedPerm(*cache, tensorLen);
  }
  if(isSnubGridLen(tensorLen))
    warmSymmetryCache(tensorLen);
}

}  // namespace SnubQuadrangle
