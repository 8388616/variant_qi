window.RoomPlugins = window.RoomPlugins || {};
window.RoomPlugins['compound-stone-weiqi'] = {
    shell: {
        title: '复合子围棋', recordDownloadPrefix: '复合子围棋', defaultKomiText: '黑贴白3.25点',
        boardSizeMin: 7, boardSizeMax: 21, defaultBoardSize: 19, minLib: 1,
        standardWeiqiMatchTime: true, useBenson: true,
        rulesHtml: '基本规则同围棋。可以下普通单子，也可以使用背包内数量有限的复合子。<br /><br />点击复合子选中，再点一次取消；单击右键旋转、长按右键翻折，滚轮切换形状，也可使用旋转和翻折按钮。<br /><br />棋子不允许重叠或超出棋盘。<br /><br />双方连续两手虚着进入数点。',
        features: { handicap: true, showEstimate: true, woodTexture: true, editBoard: true,
            quoridorBags: true, zoomScroll: false },
        editTools: [{value:'empty',label:'空'},{value:'black',label:'黑子'},{value:'white',label:'白子'}],
        boardMarkTitle: 'Ctrl+右键放置标记；普通右键旋转，长按右键翻折'
    },
    mount(roomContext) {
        'use strict';
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
        const C=QiSquareWeiqiCanvas, R=QiWeiqiSquarePageRuntime;
        const copy=Rules.clone, canvas=document.getElementById('goBoard'), painter=canvas.getContext('2d');
        const mouse=window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const ps={BOARD_SIZE:19,KOMI:3.25,...{PADDING:C.computePaddingAndCell(19).padding,CELL_SIZE:C.computePaddingAndCell(19).cellSize},
            board:C.initBoardArray(19),currentPlayer:1,numberOfHands:1,mySlot:null,gameOver:false,winner:null,
            slots:{player1:false,player2:false},lastMoveMarkers:[],waitingScoreConfirm:false,iRejected:false,
            ws:null,isMyTurn:false,reconnectTimer:null,showEstimateActive:false,cachedLiveBoard:null,cachedTerritory:null,
            replayMode:false,replayBoards:[],replayMarkers:[],replayStepPlayers:[],replayStep:0,replayTotalSteps:0,
            tryPlayMode:false,tryPlayBoards:[],tryPlayMarkers:[],tryPlayCurrentPlayer:1,tryPlayStep:0,tryPlayTotalSteps:0,
            liveReplayBoards:[],liveReplayMarkers:[],liveReplayStepPlayers:[],liveViewStep:0,liveFollowLatest:true,
            hoverRow:-1,hoverCol:-1,isHoverValid:false,showMoveNumbers:false,moveLog:[],userBoardMarks:Object.create(null)};
        let pieces=Rules.defaults(),selected=null,rotation=0,flipped=false,page=null;
        let liveStocks=[],replayStocks=[],trialStocks=[],liveMoves=[],replayMoves=[],trialMoves=[],liveCache=null;
        let trialBaseStock=null,trialPrefixKeys=[],liveDefinitionKey='';
        const dom={canvas,ctx:painter};
        for(const id of ['turnDisplay','colorStatus','scoreTitle','scoreBoard','leadInfo','scoreConfirmPanel','scoreConfirmText','komiInfo','boardMarkSelect'])
            dom[id]=document.getElementById(id);
        C.initBoardMarkSelectDom(dom.boardMarkSelect,['?','!','△','▽','♡','○','◇','□','☆','×','🚩',...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']);
        C.initBoardMarkFoldDom(document.getElementById('boardMarkPanel'),document.getElementById('boardMarkFoldBtn'),document.getElementById('boardMarkExpandBtn'));
        const bags=document.getElementById('quoridorBagsPalette');
        bags.classList.add('compound-stone-bags');document.body.classList.add('qi-room-compound-stone');
        const controls=document.querySelector('#bottomPalette .transform-buttons');
        if(controls)bags.appendChild(controls);
        const buttons={player1:[],player2:[]};
        function stockAtView() {
            return (ps.tryPlayMode?trialStocks[ps.tryPlayStep]:ps.replayMode?replayStocks[ps.replayStep]:liveStocks[ps.liveViewStep])||Rules.inventory(pieces);
        }
        function sideToMove() {
            if(ps.tryPlayMode)return ps.tryPlayCurrentPlayer;
            const step=ps.replayMode?ps.replayStep:ps.liveViewStep;
            const sides=ps.replayMode?ps.replayStepPlayers:ps.liveReplayStepPlayers;
            if(ps.replayMode || !ps.liveFollowLatest)return step>0?3-sides[step]
                :(window.__qiTsumego && window.QiTsumego?.getFirstPlayer()==='white'?2:1);
            return ps.currentPlayer;
        }
        function editableAnswer() {return !!window.QiTsumego?.authoring || document.getElementById('addRecordVariationBtn')?.textContent==='结束添加';}
        function canSelect() {return !ps.editModeEnabled && (ps.tryPlayMode || editableAnswer() || (!ps.replayMode && !ps.gameOver && ps.isMyTurn));}
        function selectionMove(row,col) {
            return {type:'move',row,col,...(selected===null?{}:{shapeId:selected,rotation,flipped})};
        }
        function buildBags() {
            for(const [slot,id] of [['player1','blackWallsRow'],['player2','whiteWallsRow']]){
                const row=document.getElementById(id);row.replaceChildren();buttons[slot]=[];
                pieces.forEach((piece,index)=>{
                    const button=document.createElement('button');button.type='button';button.className='compound-bag-piece';
                    button.dataset.shapeId=piece.id;button.dataset.player=slot;
                    const shape=document.createElement('span');shape.className='compound-bag-shape';shape.setAttribute('aria-hidden','true');
                    const radius=Math.max(1,...piece.offsets.flat().map(Math.abs));
                    for(const [r,c] of piece.offsets){
                        const stone=document.createElement('i');stone.className='compound-bag-stone';
                        stone.style.left=(50+c*30/radius)+'%';stone.style.top=(50-r*30/radius)+'%';shape.appendChild(stone);
                    }
                    const count=document.createElement('span');count.className='compound-bag-count';
                    button.append(shape,count);button.onclick=()=>{
                        if(button.disabled)return;
                        selected=selected===piece.id?null:piece.id;rotation=0;flipped=false;
                        refreshHover();draw();
                    };row.appendChild(button);buttons[slot].push({button,count,index});
                });
            }
        }
        function renderBags() {
            const stock=stockAtView(),side=sideToMove()===2?'player2':'player1';
            if(selected!==null && stock[side][pieces.findIndex(p=>p.id===selected)]<=0)selected=null;
            for(const slot of ['player1','player2'])for(const {button,count,index} of buttons[slot]){
                const remaining=stock[slot][index]||0;count.textContent='×'+remaining;
                button.disabled=!canSelect() || slot!==side || remaining===0;
                button.classList.toggle('active',slot===side && selected===pieces[index].id);
                button.setAttribute('aria-pressed',String(slot===side && selected===pieces[index].id));
                button.title=(slot==='player1'?'黑方':'白方')+' · 第'+(index+1)+'种复合子 · 剩余'+remaining+'个';
                button.setAttribute('aria-label',button.title);
            }
            for(const id of ['rotateBtn','flipBtn']){
                const button=document.getElementById(id);if(button)button.disabled=selected===null || !canSelect();
            }
        }
        function refreshHover() {
            const points=Rules.coords(selectionMove(ps.hoverRow,ps.hoverCol),pieces);
            ps.isHoverValid=Rules.geometryValid(ps.board,points);
        }
        function moveNumbers() {
            const numbers=C.initBoardArray(ps.BOARD_SIZE);
            const moves=ps.tryPlayMode?trialMoves.slice(0,ps.tryPlayStep):ps.replayMode?replayMoves.slice(0,ps.replayStep):liveMoves.slice(0,ps.liveViewStep);
            moves.forEach((move,i)=>{if(move.type==='move')for(const [r,c] of Rules.coords(move,pieces)||[])
                if(ps.board[r]?.[c]===(move.player==='player1'?1:2))numbers[r][c]=i+1;});
            return numbers;
        }
        function draw() {
            renderBags();
            const d=C.draw,cell=ps.CELL_SIZE,radius=cell*.44;
            d.clear(painter,600);C.drawSquareBoardBase(painter,ps.BOARD_SIZE,ps.PADDING,cell,600,1,300,300);
            d.stonesBlackWhite(painter,ps.board,ps.BOARD_SIZE,ps.PADDING,cell,radius,ps.showMoveNumbers);
            d.lastMoveMarkersUpper(painter,ps.lastMoveMarkers,ps.PADDING,cell,cell*.352,ps.BOARD_SIZE);
            d.userBoardMarks(painter,ps.userBoardMarks,ps.BOARD_SIZE,ps.PADDING,cell,()=>true,
                {board:ps.board,stoneMarks:ps.userStoneMarks,live:C.boardMarksLiveLatest(ps)});
            if(ps.showMoveNumbers)d.moveNumbersOnStones(painter,moveNumbers(),ps.board,ps.BOARD_SIZE,ps.PADDING,cell);
            if(ps.editModeEnabled)d.hoverPreviewStone(painter,ps.hoverRow,ps.hoverCol,ps.board,ps.PADDING,cell,
                {pageState:ps,editModeEnabled:true,editTool:ps.editTool,isHoverValid:ps.isHoverValid,boardSize:ps.BOARD_SIZE});
            else if(canSelect() && !ps.waitingScoreConfirm && ps.hoverRow>=0 && ps.hoverCol>=0){
                const points=Rules.coords(selectionMove(ps.hoverRow,ps.hoverCol),pieces);
                if(points && Rules.geometryValid(ps.board,points)){
                    painter.save();painter.globalAlpha=.45;painter.fillStyle=sideToMove()===1?'#222':'#fff';
                    for(const [r,c] of points){painter.beginPath();painter.arc(ps.PADDING+c*cell,ps.PADDING+(ps.BOARD_SIZE-1-r)*cell,radius,0,Math.PI*2);painter.fill();}
                    painter.restore();
                }
            }
            if(ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory)
                d.estimateOverlay(painter,ps.board,ps.BOARD_SIZE,ps.PADDING,cell,ps.cachedLiveBoard,ps.cachedTerritory);
        }
        function buildHistory(moves,opening) {
            let board=copy(opening||C.initBoardArray(ps.BOARD_SIZE)),stock=Rules.inventory(pieces);
            const result={boards:[copy(board)],markers:[[]],players:[0],stocks:[copy(stock)]};
            for(const entry of moves){
                const move=Rules.parseMove(entry),color=move.player==='player1'?1:2;
                const points=move.type==='move'?Rules.coords(move,pieces):[];
                if(move.type==='move')board=Rules.apply(board,points,color)||board;
                stock=Rules.spend(stock,pieces,move,move.player)||stock;
                result.boards.push(copy(board));result.stocks.push(copy(stock));result.players.push(color);
                result.markers.push(points.map(([row,col])=>({row,col,color})));
            }
            return result;
        }
        function syncState(state) {
            if(state.compoundStones && JSON.stringify(state.compoundStones)!==JSON.stringify(pieces)){
                pieces=Rules.definitions(state.compoundStones);selected=null;buildBags();liveCache=null;
            }
            if(state.slots)ps.slots=state.slots;
            if(ps.tryPlayMode)return;
            if(state.boardSize && state.boardSize!==ps.BOARD_SIZE){ps.BOARD_SIZE=state.boardSize;page.updateBoardGeometry();liveCache=null;}
            if(state.komi!=null && state.komi!==ps.KOMI){ps.KOMI=state.komi;page.updateBoardGeometry();}
            ps.currentPlayer=state.currentPlayer||1;ps.numberOfHands=state.numberOfHands||1;ps.gameOver=!!state.gameOver;ps.winner=state.winner||null;
            ps.gameStarted=ps.numberOfHands>1;
            if(state.firstPlayer)ps.firstPlayer=state.firstPlayer;
            liveMoves=copy(state.moveCoords||[]);
            const opening=state.initialBoard||ps.liveOpeningBoard||C.initBoardArray(ps.BOARD_SIZE);
            const key=JSON.stringify([ps.BOARD_SIZE,pieces,opening,liveMoves]);
            if(key!==liveCache){
                const built=buildHistory(liveMoves,opening);
                ps.liveReplayBoards=built.boards;ps.liveReplayMarkers=built.markers;ps.liveReplayStepPlayers=built.players;liveStocks=built.stocks;liveCache=key;liveDefinitionKey=JSON.stringify(pieces);
            }
            if(!ps.replayMode){
                ps.liveViewStep=ps.liveFollowLatest?liveMoves.length:Math.min(ps.liveViewStep,liveMoves.length);
                page.applyLiveViewBoard();page.updateLiveReplayPanelUI();
            }
            page.updateTurn();
        }
        function enterReplay(data) {
            if(data.compoundStones){pieces=Rules.definitions(data.compoundStones);buildBags();}
            const opening=C.initBoardArray(ps.BOARD_SIZE);R.applyInitialPositionCompact(opening,ps.BOARD_SIZE,data.initialPosition||[]);
            replayMoves=(data.moves||[]).map(Rules.parseMove);
            const reusable=liveDefinitionKey===JSON.stringify(pieces) && JSON.stringify(replayMoves)===JSON.stringify(liveMoves)
                && JSON.stringify(opening)===JSON.stringify(ps.liveReplayBoards[0]);
            const built=reusable?{boards:ps.liveReplayBoards.slice(),markers:ps.liveReplayMarkers.slice(),players:ps.liveReplayStepPlayers.slice(),stocks:liveStocks.slice()}
                :buildHistory(replayMoves,opening);
            ps.replayBoards=built.boards;ps.replayMarkers=built.markers;ps.replayStepPlayers=built.players;replayStocks=built.stocks;
            ps.replayTotalSteps=replayMoves.length;ps.replayMode=true;
            document.getElementById('replaySlider').max=ps.replayTotalSteps;page.setReplayStep(ps.replayTotalSteps);page.updateReplayUI();
        }
        function enterTrial() {
            trialBaseStock=copy(stockAtView());
            const step=ps.replayMode?ps.replayStep:ps.liveViewStep;
            const boards=ps.replayMode?ps.replayBoards:ps.liveReplayBoards,stocks=ps.replayMode?replayStocks:liveStocks;
            trialPrefixKeys=boards.slice(0,step+1).map((board,i)=>Rules.key(board,stocks[i]||Rules.inventory(pieces)));
            page.enterTryPlay();
        }
        function setTrialStep(step) {
            ps.tryPlayStep=Math.max(0,Math.min(step,ps.tryPlayTotalSteps));
            ps.board=copy(ps.tryPlayBoards[ps.tryPlayStep]);ps.lastMoveMarkers=copy(ps.tryPlayMarkers[ps.tryPlayStep]);
            ps.tryPlayCurrentPlayer=ps.tryPlayStep%2?3-ps.tryPlayBasePlayer:ps.tryPlayBasePlayer;
            document.getElementById('replaySlider').value=ps.tryPlayStep;page.updateTryPlayDisplay();draw();
        }
        function trialMove(move) {
            const color=ps.tryPlayCurrentPlayer,slot=color===1?'player1':'player2';
            const stock=Rules.spend(stockAtView(),pieces,move,slot);
            const points=move.type==='move'?Rules.coords(move,pieces):[];
            const next=move.type==='move'?Rules.apply(ps.board,points,color):copy(ps.board);
            if(!stock || !next)return false;
            const key=Rules.key(next,stock);
            if(move.type==='move' && (trialPrefixKeys.includes(key)||ps.tryPlayBoards.slice(0,ps.tryPlayStep+1).some((b,i)=>Rules.key(b,trialStocks[i])===key)))return false;
            const length=ps.tryPlayStep+1;
            ps.tryPlayBoards.length=length;ps.tryPlayMarkers.length=length;trialStocks.length=length;trialMoves.length=length-1;
            ps.tryPlayBoards.push(copy(next));ps.tryPlayMarkers.push(points.map(([row,col])=>({row,col,color})));
            trialStocks.push(stock);trialMoves.push({...move,player:slot});ps.tryPlayTotalSteps=length;
            document.getElementById('replaySlider').max=length;setTrialStep(length);return true;
        }
        buildBags();
        page=R.create(ps,dom,{gameType:roomContext.gameType,roomId:roomContext.roomId,roomPassword:roomContext.roomPassword,
            enableEditBoard:true,minLib:1,recordDownloadPrefix:'复合子围棋',isMouseDevice:mouse,
            ...R.weiqiScoringHooks(true,{boardSize:()=>ps.BOARD_SIZE,maxWeakLiberties:2}),
            drawBoard:draw,syncState,enterReplayMode:enterReplay,
            tryPlayMove:(row,col)=>trialMove(selectionMove(row,col)),setTryPlayStep:setTrialStep,
            onEnterTryPlay(){trialStocks=[copy(trialBaseStock||Rules.inventory(pieces))];trialMoves=[];draw();},
            onExitTryPlay(){trialStocks=[];trialMoves=[];selected=null;draw();}
        });
        const bindings=QiBoardRoomClient.createWeiqiMessageBindings({
            roomId:roomContext.roomId,gameType:roomContext.gameType,pageState:ps,
            ...Object.fromEntries(['drawBoard','exitTryPlay','setTryPlayStep','setReplayStep','setLiveViewStep','updateBoardGeometry','initBoardArray',
                'exitReplayMode','clearEstimate','hideScoreConfirm','showEstimate','clearMobileMovePreview','downloadRecord','enterReplayMode',
                'updateTurn','updateReplayUI','showScoreConfirm','syncState'].map(key=>[key,page[key]])),
            enterTryPlay:enterTrial,tryPlayPass:()=>trialMove({type:'pass'}),tryPlayUndo:()=>{if(ps.tryPlayStep>0){setTrialStep(ps.tryPlayStep-1);return true;}return false;},
            getWs:()=>ps.ws,getBoardSize:()=>ps.BOARD_SIZE,setBoardSize:n=>ps.BOARD_SIZE=n,
            getKomi:()=>ps.KOMI,setKomi:k=>ps.KOMI=k,getBoard:()=>ps.board,setBoard:b=>ps.board=b,
            getSlots:()=>ps.slots,setSlots:s=>ps.slots=s,getMySlot:()=>ps.mySlot,setMySlot:s=>ps.mySlot=s,
            getGameOver:()=>ps.gameOver,setGameOver:g=>ps.gameOver=g,getWinner:()=>ps.winner,setWinner:w=>ps.winner=w,
            getReplayMode:()=>ps.replayMode,getShowEstimateActive:()=>ps.showEstimateActive,setShowEstimateActive:v=>ps.showEstimateActive=v,
            getWaitingScoreConfirm:()=>ps.waitingScoreConfirm,setWaitingScoreConfirm:v=>ps.waitingScoreConfirm=v,
            getIRejected:()=>ps.iRejected,setIRejected:v=>ps.iRejected=v,
            colorStatus:dom.colorStatus,scoreTitle:dom.scoreTitle,turnDisplay:dom.turnDisplay,
            isMouseDevice:mouse,standardWeiqiMatchTime:true,boardSeatOverlay:true,
            recordMoveFromPoint:point=>selectionMove(point.row,point.col),
            onNewGameStarted(){selected=null;rotation=0;flipped=false;page.clearEditModeUi();},
            onRoomReset(){selected=null;rotation=0;flipped=false;}
        });
        const pick=event=>{const {x,y}=page.canvasCoordsFromClient(event.clientX,event.clientY);return page.getClosestIntersection(x,y);};
        canvas.addEventListener('mousemove',event=>{const {row,col}=pick(event);ps.hoverRow=row;ps.hoverCol=col;refreshHover();draw();});
        canvas.addEventListener('mouseleave',()=>{page.clearMobileMovePreview();draw();});
        canvas.addEventListener('click',event=>{
            if(ps.editModeEnabled || (!ps.tryPlayMode && !ps.isMyTurn) || ps.waitingScoreConfirm)return;
            const {row,col}=pick(event),move=selectionMove(row,col),points=Rules.coords(move,pieces);
            if(!Rules.geometryValid(ps.board,points))return;
            if(page.mobileTwoStepPlacing() && !(ps.hoverRow===row && ps.hoverCol===col && ps.isHoverValid)){
                ps.hoverRow=row;ps.hoverCol=col;refreshHover();draw();return;
            }
            if(ps.tryPlayMode)trialMove(move);
            else if(ps.ws?.readyState===1)ps.ws.send(JSON.stringify(move));
            page.clearMobileMovePreview();draw();
        });
        function transform(kind){if(selected===null || !canSelect())return;if(kind==='rotate')rotation=(rotation+1)%4;else flipped=!flipped;refreshHover();draw();}
        document.getElementById('rotateBtn').onclick=()=>transform('rotate');
        document.getElementById('flipBtn').onclick=()=>transform('flip');
        let rightTimer=null,longRight=false;
        canvas.addEventListener('contextmenu',event=>{event.preventDefault();if(event.ctrlKey||event.metaKey){const {row,col}=pick(event);page.applyUserBoardMark(row,col);}});
        canvas.addEventListener('mousedown',event=>{if(event.button!==2||event.ctrlKey||event.metaKey)return;longRight=false;rightTimer=setTimeout(()=>{longRight=true;rightTimer=null;transform('flip');},500);});
        window.addEventListener('mouseup',event=>{if(event.button!==2)return;if(rightTimer){clearTimeout(rightTimer);rightTimer=null;if(!longRight && canvas.contains(event.target))transform('rotate');}});
        canvas.addEventListener('wheel',event=>{
            if(!canSelect())return;event.preventDefault();const choices=[null,...pieces.filter((piece,i)=>stockAtView()[sideToMove()===1?'player1':'player2'][i]>0).map(p=>p.id)];
            selected=choices[(choices.indexOf(selected)+(event.deltaY>0?1:-1)+choices.length)%choices.length];rotation=0;flipped=false;refreshHover();draw();
        },{passive:false});
        document.getElementById('scoreConfirmYes').onclick=()=>{ps.ws?.send(JSON.stringify({type:'scoreResponse',accept:true}));page.hideScoreConfirm();};
        document.getElementById('scoreConfirmNo').onclick=()=>{ps.iRejected=true;ps.ws?.send(JSON.stringify({type:'scoreResponse',accept:false}));ps.waitingScoreConfirm=false;ps.showEstimateActive=false;page.clearEstimate();page.hideScoreConfirm();};
        page.connectWebSocket(message=>{bindings.handleMessage(message);renderBags();});
    }
};
