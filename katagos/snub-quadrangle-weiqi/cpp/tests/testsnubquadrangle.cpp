#include "../tests/tests.h"

#include <set>
#include <vector>

#include "../game/snubquadrangle.h"
#include "../neuralnet/nninputs.h"

using namespace std;

static int countValidVertices(int gridLen) {
  int n = 0;
  for(int row = 0; row < gridLen; row++) {
    for(int col = 0; col < gridLen; col++) {
      if(SnubQuadrangle::isValidVertex(row, col, gridLen, gridLen))
        n++;
    }
  }
  return n;
}

static bool snubSymmetryPreservesValidSet(int gridLen, int symmetry) {
  for(int row = 0; row < gridLen; row++) {
    for(int col = 0; col < gridLen; col++) {
      bool wasValid = SnubQuadrangle::isValidVertex(row, col, gridLen, gridLen);
      int symRow = row;
      int symCol = col;
      SnubQuadrangle::applySymmetryRC(symRow, symCol, gridLen, gridLen, symmetry);
      bool symValid = SnubQuadrangle::isValidVertex(symRow, symCol, gridLen, gridLen);
      if(wasValid != symValid)
        return false;
    }
  }
  return true;
}

static bool snubSymmetryBijectionOnValid(int gridLen, int symmetry) {
  vector<pair<int, int>> valid;
  for(int row = 0; row < gridLen; row++) {
    for(int col = 0; col < gridLen; col++) {
      if(SnubQuadrangle::isValidVertex(row, col, gridLen, gridLen))
        valid.push_back(make_pair(row, col));
    }
  }
  set<pair<int, int>> image;
  for(const pair<int, int>& rc : valid) {
    int symRow = rc.first;
    int symCol = rc.second;
    SnubQuadrangle::applySymmetryRC(symRow, symCol, gridLen, gridLen, symmetry);
    if(!SnubQuadrangle::isValidVertex(symRow, symCol, gridLen, gridLen))
      return false;
    image.insert(make_pair(symRow, symCol));
  }
  return image.size() == valid.size();
}

static bool getSymLocMatchesApplyRC(int gridLen, int symmetry) {
  for(int row = 0; row < gridLen; row++) {
    for(int col = 0; col < gridLen; col++) {
      if(!SnubQuadrangle::isValidVertex(row, col, gridLen, gridLen))
        continue;
      int x = col;
      int y = row;
      Loc symLoc = SymmetryHelpers::getSymLoc(x, y, gridLen, gridLen, symmetry, true);
      int symRow = Location::getY(symLoc, gridLen);
      int symCol = Location::getX(symLoc, gridLen);
      int expectedRow = row;
      int expectedCol = col;
      SnubQuadrangle::applySymmetryRC(expectedRow, expectedCol, gridLen, gridLen, symmetry);
      if(symRow != expectedRow || symCol != expectedCol)
        return false;
    }
  }
  return true;
}

void Tests::runSnubQuadrangleSymmetryTests() {
  cout << "Running snub quadrangle symmetry tests" << endl;

  testAssert(countValidVertices(4) == 12);
  testAssert(countValidVertices(19) == 312);

  for(int lanes = 2; lanes <= 8; lanes++) {
    int gridLen = SnubQuadrangle::gridLenFromLanes(lanes);
    testAssert(SnubQuadrangle::isSnubGridLen(gridLen));
    for(int symmetry = 0; symmetry < SymmetryHelpers::NUM_SYMMETRIES_WITHOUT_TRANSPOSE; symmetry++) {
      testAssert(snubSymmetryPreservesValidSet(gridLen, symmetry));
      testAssert(snubSymmetryBijectionOnValid(gridLen, symmetry));
      testAssert(getSymLocMatchesApplyRC(gridLen, symmetry));
    }
  }

  // Policy index roundtrip: tensor embed perm matches getSymLoc on valid vertices.
  for(int lanes = 2; lanes <= 7; lanes++) {
    const int gridLen = SnubQuadrangle::gridLenFromLanes(lanes);
    const int tensorLen = 19;
    for(int symmetry = 0; symmetry < SymmetryHelpers::NUM_SYMMETRIES_WITHOUT_TRANSPOSE; symmetry++) {
      const uint16_t* perm = SnubQuadrangle::getNNTensorPosPermutation(tensorLen, gridLen, symmetry);
      testAssert(perm != NULL);
      for(int row = 0; row < gridLen; row++) {
        for(int col = 0; col < gridLen; col++) {
          if(!SnubQuadrangle::isValidVertex(row, col, gridLen, gridLen))
            continue;
          const int srcPos = row * tensorLen + col;
          const int dstPos = perm[srcPos];
          const int dstRow = dstPos / tensorLen;
          const int dstCol = dstPos % tensorLen;
          Loc srcLoc = SymmetryHelpers::getSymLoc(col, row, gridLen, gridLen, symmetry, true);
          int symCol = Location::getX(srcLoc, gridLen);
          int symRow = Location::getY(srcLoc, gridLen);
          testAssert(symRow == dstRow);
          testAssert(symCol == dstCol);
        }
      }
    }
  }

  // Multisize: 10x10 snub board in 19x19 tensor must use embed permutation, not 19x19 board perm.
  {
    const int tensorLen = 19;
    const int snubGridLen = 10;
    const int y = 1;
    const int x = 2;
    const int tensorPos = y * tensorLen + x;
    const uint16_t* tensorPerm = SnubQuadrangle::getNNTensorPosPermutation(tensorLen, snubGridLen, 1);
    testAssert(tensorPerm != NULL);
    const uint16_t* wrongPerm = SnubQuadrangle::getNNPosPermutation(tensorLen, 1);
    testAssert(wrongPerm != NULL);
    testAssert(tensorPerm[tensorPos] != wrongPerm[tensorPos]);
    const uint16_t* sameLenPerm = SnubQuadrangle::getNNTensorPosPermutation(tensorLen, tensorLen, 1);
    testAssert(sameLenPerm == wrongPerm);
  }

  cout << "Snub quadrangle symmetry tests passed" << endl;
}
