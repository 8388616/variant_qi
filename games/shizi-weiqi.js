const { qiProtocol, squareWuziqiRules, applyInitialPositionCompact } = require('../common');
const { WeiqiRoom } = require('./weiqi');

const WIN_IN_ROW = 10;

class ShiziWeiqiRoom extends WeiqiRoom {
    checkTenInRow(board, row, col, colorVal) {
        return squareWuziqiRules.checkNInRow(board, row, col, colorVal, this.boardSize, WIN_IN_ROW);
    }

    _applyTenInRowWin(slot) {
        this.gameOver = true;
        this.winner = slot;
        this.recordResultText = slot === 'black' ? '黑胜（连成十子）' : '白胜（连成十子）';
        this._stopClockTicker();
    }

    handleMessage(ws, msg) {
        if (msg.type === 'move') {
            const slot = this.room.getSlotByWs(ws);
            if (!this._timeAllowsPlay(slot)) {
                if (slot) ws.send(JSON.stringify({ type: 'error', message: '请先与对手确认限时规则。' }));
                return;
            }
            const before = () => this._drainClockBeforeMove(slot);
            qiProtocol.weiqiMove(this, ws, msg, slot, {
                beforeCommit: before,
                afterPlace: ({ row, col, playerVal, slot: moveSlot }) => {
                    if (this.checkTenInRow(this.board, row, col, playerVal)) {
                        this._applyTenInRowWin(moveSlot);
                        return true;
                    }
                    return false;
                }
            });
            this._syncClockAfterTurnChange();
            return;
        }
        return super.handleMessage(ws, msg);
    }

    exportRecord() {
        const record = super.exportRecord();
        record.gameType = '十子围棋';
        record.gameId = 'shizi-weiqi';
        return record;
    }

    importRecord(data, requesterWs) {
        if (!data || (data.gameId !== 'shizi-weiqi' && data.gameId !== 'weiqi')) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱格式不匹配（需要十子围棋棋谱）。' }));
            return;
        }
        const newSize = data.boardSize || 19;
        if (!Number.isInteger(newSize) || newSize > 99) {
            requesterWs.send(JSON.stringify({ type: 'error', message: '棋谱中棋盘大小无效' }));
            return;
        }

        this.boardSize = newSize;
        this.resetToEmpty();

        applyInitialPositionCompact(this.board, this.boardSize, data.initialPosition);

        const rawMoves = data.moves || [];
        const moves = rawMoves.map(WeiqiRoom.parseMove);
        let wonByTen = false;
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const slot = move.player;
            const playerVal = slot === 'black' ? 1 : 2;
            if (move.type === 'move') {
                const { row, col } = move;
                if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手坐标越界` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoard = this.tryPlaceStone(this.board, row, col, playerVal);
                if (!newBoard) {
                    this.resetToEmpty();
                    requesterWs.send(JSON.stringify({ type: 'error', message: `棋谱回放失败：第${i + 1}手无法落子` }));
                    this.broadcast({ type: 'roomReset', ...this.getState() });
                    return;
                }
                const newBoardStr = this.boardToString(newBoard);
                this.historyBoards.push(this.copyBoard(newBoard));
                this.historyBoardSet.add(newBoardStr);
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'move', player: slot, row, col });
                this.board = newBoard;
                this.lastMoveMarkers = [{ row, col, color: playerVal }];
                this.passCounter = 0;
                if (this.checkTenInRow(this.board, row, col, playerVal)) {
                    this.gameOver = true;
                    this.winner = slot;
                    this.recordResultText = slot === 'black' ? '黑胜（连成十子）' : '白胜（连成十子）';
                    wonByTen = true;
                    break;
                }
                this.currentPlayer = 3 - this.currentPlayer;
            } else if (move.type === 'pass') {
                this.historyBoards.push(this.copyBoard(this.board));
                this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
                this.moveHistory.push(slot);
                this.moveCoords.push({ type: 'pass', player: slot });
                this.currentPlayer = 3 - this.currentPlayer;
                this.passCounter++;
                this.lastMoveMarkers = [];
            }
        }

        if (data.timeControl && typeof data.timeControl === 'object') {
            const tc = data.timeControl;
            if (tc.enabled === true) {
                this.tcSettings = {
                    timed: true,
                    mainMinutes: parseInt(String(tc.mainMinutes ?? 0), 10) || 0,
                    byoyomiSeconds: parseInt(String(tc.byoyomiSeconds ?? 0), 10) || 0,
                    maxTimeouts: parseInt(String(tc.maxTimeouts ?? 0), 10) || 0
                };
            } else if (tc.enabled === false) {
                this.tcSettings = { timed: false };
            }
            this.matchStarted = true;
        }

        if (!wonByTen && (data.result || data.resultText)) {
            this.gameOver = true;
            const importedResultText = data.resultText != null ? String(data.resultText) : String(data.result);
            this.recordResultText = importedResultText;
            this.winner = WeiqiRoom.parseResultTextToWinner(importedResultText);
            if (!this.winner && (data.result === 'black' || data.result === 'white' || data.result === 'draw'))
                this.winner = data.result;
        }

        this.broadcast({
            type: 'importSuccess',
            ...this.getState(),
            replayData: {
                initialPosition: data.initialPosition || [],
                moves: this.moveCoords.map(m => ({ ...m }))
            }
        });
    }
}

module.exports = {
    initRoom(room) {
        room.gameLogic = new ShiziWeiqiRoom(room);
        room.maxPlayers = 2;
        if (typeof qiProtocol.installStandardEditBoard === 'function') {
            qiProtocol.installStandardEditBoard(room.gameLogic);
        }
    }
};
