'use strict';
const { WeiqiRoom } = require('./weiqi');
// 复合子规则在服务端和前端插件各保留一份，修改时请同步另一份。
const Rules = (() => {
    'use strict';
    const defaults = [
        { id: 'corners', offsets: [[-1,-1],[-1,1],[1,-1],[1,1]], count: 1 },
        { id: 'cross', offsets: [[-1,0],[0,1],[1,0],[0,-1]], count: 1 },
        { id: 'opposite', offsets: [[-1,0],[1,0]], count: 4 },
        { id: 'corner', offsets: [[0,1],[1,0]], count: 4 },
        { id: 'skew', offsets: [[-1,1],[1,0]], count: 4 },
        { id: 'diagonal', offsets: [[-1,1],[1,-1]], count: 4 }
    ];
    const clone = value => JSON.parse(JSON.stringify(value));
    function definitions(value) {
        const list = value === undefined ? defaults : value;
        if (!Array.isArray(list) || !list.length || list.length > 32) throw new Error('compoundStones 必须包含 1～32 种复合子');
        const ids = new Set();
        return list.map(piece => {
            if (!piece || typeof piece.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(piece.id) || ids.has(piece.id))
                throw new Error('复合子 id 无效或重复');
            ids.add(piece.id);
            if (!Number.isInteger(piece.count) || piece.count < 0 || piece.count > 1000) throw new Error('复合子数量须为 0～1000 的整数');
            if (!Array.isArray(piece.offsets) || piece.offsets.length < 2 || piece.offsets.length > 32) throw new Error('复合子形状须包含 2～32 个坐标');
            const points = new Set();
            const offsets = piece.offsets.map(point => {
                if (!Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isInteger(v) || Math.abs(v) > 32))
                    throw new Error('复合子相对坐标无效');
                const key = point.join(',');
                if (points.has(key)) throw new Error('复合子不能包含重复坐标');
                points.add(key);
                return point.slice();
            });
            return { id: piece.id, offsets, count: piece.count };
        });
    }
    function inventory(pieces) {
        return { player1: pieces.map(p => p.count), player2: pieces.map(p => p.count) };
    }
    function coords(move, pieces) {
        if (!move || !Number.isInteger(move.row) || !Number.isInteger(move.col)) return null;
        if (move.shapeId == null) return [[move.row, move.col]];
        const piece = pieces.find(p => p.id === move.shapeId);
        const rotation = move.rotation ?? 0, flipped = move.flipped ?? false;
        if (!piece || !Number.isInteger(rotation) || rotation < 0 || rotation > 3 || typeof flipped !== 'boolean') return null;
        return piece.offsets.map(([dr, dc]) => {
            let r = dr, c = dc;
            for (let i = 0; i < rotation; i++) [r, c] = [-c, r];
            if (flipped) c = -c;
            return [move.row + r, move.col + c];
        });
    }
    function geometryValid(board, points) {
        return Array.isArray(points) && points.length > 0 && points.every(([r,c]) =>
            Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < board.length && c < board.length && board[r][c] === 0);
    }
    function group(board, r, c) {
        const color = board[r][c], stones = [[r,c]], seen = new Set([r+','+c]);
        let liberty = false;
        for (let head = 0; head < stones.length; head++) {
            const [row,col] = stones[head];
            for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const nr=row+dr, nc=col+dc;
                if (nr<0 || nc<0 || nr>=board.length || nc>=board.length) continue;
                if (board[nr][nc]===0) liberty=true;
                else if (board[nr][nc]===color && !seen.has(nr+','+nc)) {seen.add(nr+','+nc);stones.push([nr,nc]);}
            }
        }
        return {stones,liberty};
    }
    function apply(board, points, color) {
        if ((color !== 1 && color !== 2) || !geometryValid(board,points)) return null;
        const next = board.map(row=>row.slice());
        for (const [r,c] of points) next[r][c]=color;
        // 整体放下，再先提对方，最后提己方；复合子中的各颗子不逐颗结算。
        for (const [r,c] of points) for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr=r+dr,nc=c+dc;
            if (nr<0 || nc<0 || nr>=next.length || nc>=next.length || next[nr][nc]!==3-color) continue;
            const chain=group(next,nr,nc);
            if (!chain.liberty) for (const [rr,cc] of chain.stones) next[rr][cc]=0;
        }
        for (const [r,c] of points) if (next[r][c]===color) {
            const chain=group(next,r,c);
            if (!chain.liberty) for (const [rr,cc] of chain.stones) next[rr][cc]=0;
        }
        return next;
    }
    function parseMove(entry) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) return clone(entry);
        if (typeof entry !== 'string' || !/^[BW](p|\d+,\d+)$/.test(entry)) throw new Error('复合子围棋着法格式无效');
        const player = entry[0] === 'B' ? 'player1' : 'player2';
        if (entry.slice(1) === 'p') return {type:'pass',player};
        const [row,col]=entry.slice(1).split(',').map(Number);
        return {type:'move',player,row,col};
    }
    function spend(remaining, pieces, move, slot) {
        const next=clone(remaining);
        if (move.type==='move' && move.shapeId != null) {
            const index=pieces.findIndex(p=>p.id===move.shapeId);
            if (index<0 || !next[slot] || next[slot][index]<=0) return null;
            next[slot][index]--;
        }
        return next;
    }
    function key(board, remaining) { return JSON.stringify([board,remaining.player1,remaining.player2]); }
    return {defaults:()=>clone(defaults),definitions,inventory,coords,geometryValid,apply,parseMove,spend,key,clone};
})();
const { qiProtocol, qiBoardSeatOverlay, qiApplyRecordKomi, normalizeQiRecordForImport, applyInitialPositionCompact } = require('../common');

class CompoundStoneWeiqiRoom extends WeiqiRoom {
    constructor(room) {
        super(room);
        this.resetInventory();
        this.historyBoardSet.add(this.superKoSeedKey());
    }
    resetInventory(pieces) {
        this.compoundStones = Rules.definitions(pieces);
        this.compoundRemaining = Rules.inventory(this.compoundStones);
        this.historyInventories = [];
    }
    getState() {
        return { ...super.getState(), compoundStones: Rules.clone(this.compoundStones),
            compoundRemaining: Rules.clone(this.compoundRemaining) };
    }
    // 库存会改变下一手能下的形状，因此禁全同包含双方库存（与乌克兰围棋的形状状态同理）。
    superKoSeedKey() { return Rules.key(this.board, this.compoundRemaining); }
    applyRecordedMove(move) {
        const slot=move.player;
        if (slot !== (this.currentPlayer===1?'player1':'player2')) throw new Error('行棋方不一致');
        if (move.type !== 'move' && move.type !== 'pass') throw new Error('着法类型无效');
        const remaining=Rules.spend(this.compoundRemaining,this.compoundStones,move,slot);
        if (!remaining) throw new Error('该复合子已用完');
        const points=move.type==='move'?Rules.coords(move,this.compoundStones):[];
        const next=move.type==='move'?Rules.apply(this.board,points,this.currentPlayer):this.copyBoard(this.board);
        if (!next) throw new Error('落点重叠、越界或坐标无效');
        const key=Rules.key(next,remaining);
        if (move.type==='move' && this.historyBoardSet.has(key)) throw new Error('禁全同');
        if (move.type==='move') this.historyBoardSet.add(key);
        this.historyBoards.push(this.copyBoard(next));
        this.historyMarkers.push(this.copyMarkers(this.lastMoveMarkers));
        this.historyInventories.push(Rules.clone(remaining));
        this.moveHistory.push(slot);
        const normalized={type:move.type,player:slot};
        if (move.type==='move') Object.assign(normalized,{row:move.row,col:move.col,stones:points},
            move.shapeId==null?{}:{shapeId:move.shapeId,rotation:move.rotation??0,flipped:move.flipped??false});
        this.moveCoords.push(normalized);
        this.lastMoveMarkers=points.map(([row,col])=>({row,col,color:this.currentPlayer}));
        this.board=next;
        this.compoundRemaining=remaining;
        this.currentPlayer=3-this.currentPlayer;
        this.passCounter=move.type==='pass'?this.passCounter+1:0;
    }
    handleMessage(ws,msg) {
        if (msg.type !== 'move' && msg.type !== 'pass') return super.handleMessage(ws,msg);
        const slot=this.room.getSlotByWs(ws);
        if (!slot || this.gameOver || slot!==(this.currentPlayer===1?'player1':'player2') || !this._timeAllowsPlay(slot)) return;
        // 非法着法不能扣库存或消耗回合；正式提交前才结算用时。
        const move={...msg,player:slot};
        const remaining=Rules.spend(this.compoundRemaining,this.compoundStones,move,slot);
        const next=msg.type==='pass'?this.board:Rules.apply(this.board,Rules.coords(move,this.compoundStones),this.currentPlayer);
        if (!remaining || !next) return;
        if (msg.type==='move' && this.historyBoardSet.has(Rules.key(next,remaining))) {
            ws.send(JSON.stringify({type:'error',message:'禁全同。'}));return;
        }
        if (!this._drainClockBeforeMove(slot)) return;
        this.applyRecordedMove(move);
        this.broadcast({type:'broadcast',action:msg.type,...this.getState()});
        if (this.passCounter>=2) {
            const black=this.room.getPlayerBySlot('player1'),white=this.room.getPlayerBySlot('player2');
            if (black && white) this.startScoreCounting(black,white);
        }
        this._syncClockAfterTurnChange();
    }
    performUndo(steps) {
        if (!Number.isInteger(steps) || steps<=0 || steps>this.moveHistory.length) return;
        for (let i=0;i<steps;i++) {
            this.historyBoards.pop();this.historyInventories.pop();this.moveHistory.pop();this.moveCoords.pop();
            this.lastMoveMarkers=this.historyMarkers.pop()||[];this.currentPlayer=3-this.currentPlayer;
        }
        this.board=this.copyBoard(this.historyBoards.at(-1)||this.openingBoard);
        this.compoundRemaining=Rules.clone(this.historyInventories.at(-1)||Rules.inventory(this.compoundStones));
        this.historyBoardSet=new Set([Rules.key(this.openingBoard,Rules.inventory(this.compoundStones))]);
        this.moveCoords.forEach((move,i)=>{if(move.type==='move')this.historyBoardSet.add(Rules.key(this.historyBoards[i],this.historyInventories[i]));});
        this.passCounter=0;
        for(let i=this.moveCoords.length-1;i>=0 && this.moveCoords[i].type==='pass';i--)this.passCounter++;
        this.broadcast({type:'broadcast',action:'undoAccept',...this.getState()});
        this._syncClockAfterTurnChange();
    }
    resetGame() {
        this.resetInventory();
        super.resetGame();
        this.openingBoard=this.copyBoard(this.board);
        this.historyBoardSet.add(this.superKoSeedKey());
    }
    resetToEmpty() {
        this.resetInventory();
        super.resetToEmpty();
        this.openingBoard=this.copyBoard(this.board);
        this.historyBoardSet.add(this.superKoSeedKey());
    }
    exportRecord() {
        return {...super.exportRecord(),gameId:'compound-stone-weiqi',gameType:'复合子围棋',
            compoundStones:Rules.clone(this.compoundStones),moves:this.moveCoords.map(move=>{
                const prefix=move.player==='player1'?'B':'W';
                if(move.type==='pass')return prefix+'p';
                if(move.shapeId==null)return prefix+move.row+','+move.col;
                return {type:'move',player:move.player,row:move.row,col:move.col,
                    shapeId:move.shapeId,rotation:move.rotation,flipped:move.flipped};
            })};
    }
    static parseMove(entry) { return Rules.parseMove(entry); }
    importRecord(data,client) {
        try {
            if (!data || data.gameId!=='compound-stone-weiqi') throw new Error('需要复合子围棋棋谱');
            const size=data.boardSize??19;
            if (!Number.isInteger(size)||size<7||size>21) throw new Error('棋盘大小无效');
            const pieces=Rules.definitions(data.compoundStones);
            if (!Array.isArray(data.moves)) throw new Error('moves 必须是数组');
            const moves=data.moves.map(Rules.parseMove);
            this.boardSize=size;this.resetToEmpty();this.resetInventory(pieces);
            applyInitialPositionCompact(this.board,size,data.initialPosition);
            this.openingBoard=this.copyBoard(this.board);
            this.historyBoardSet=new Set([this.superKoSeedKey()]);
            moves.forEach((move,i)=>{try{this.applyRecordedMove(move);}catch(error){throw new Error('第'+(i+1)+'手：'+error.message);}});
            const normalized=normalizeQiRecordForImport(this,data);
            if(normalized.timeControl){
                const tc=normalized.timeControl;
                this.tcSettings=tc.enabled?{timed:true,mainMinutes:tc.mainMinutes,byoyomiSeconds:tc.byoyomiSeconds,maxTimeouts:tc.maxTimeouts}:{timed:false};
                this.matchStarted=true;
            }
            if(normalized.result||normalized.resultText){this.gameOver=true;this.winner=normalized.result;this.recordResultText=normalized.resultText||'';}
            qiApplyRecordKomi(this,data);
            this.broadcast({type:'importSuccess',...this.getState(),replayData:{
                initialPosition:data.initialPosition||[],compoundStones:Rules.clone(this.compoundStones),moves:Rules.clone(this.moveCoords)}});
        }catch(error){
            this.resetToEmpty();client.send(JSON.stringify({type:'error',message:'棋谱回放失败：'+error.message}));
            this.broadcast({type:'roomReset',...this.getState()});
        }
    }
}
module.exports={CompoundStoneWeiqiRoom,initRoom(room){
    room.gameLogic=new CompoundStoneWeiqiRoom(room);room.maxPlayers=2;
    qiBoardSeatOverlay.install(room.gameLogic);qiProtocol.installStandardEditBoard(room.gameLogic);
}};
