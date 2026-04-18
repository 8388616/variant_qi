(function (global) {
    function qiOpenRoomWebSocket(opts) {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}/qi/ws?game=${encodeURIComponent(opts.gameType)}&room=${encodeURIComponent(opts.roomId)}`;
        const socket = new WebSocket(url);
        socket.onopen = function () {
            socket.send(JSON.stringify({
                type: 'join',
                password: opts.roomPassword != null ? opts.roomPassword : null,
                requestedSlot: null
            }));
        };
        socket.onmessage = function (e) {
            opts.onMessage(JSON.parse(e.data));
        };
        socket.onclose = opts.onClose;
        return socket;
    }

    /**
     * @typedef {object} WeiqiMessageCtx
     * @property {string} roomId
     * @property {string} gameType
     * @property {() => WebSocket} getWs
     * @property {() => number} getBoardSize
     * @property {(n:number)=>void} setBoardSize
     * @property {() => number} getKomi
     * @property {(n:number)=>void} setKomi
     * @property {() => *} getBoard
     * @property {(b:*)=>void} setBoard
     * @property {() => *} getSlots
     * @property {(s:*)=>void} setSlots
     * @property {() => string|null} getMySlot
     * @property {(s:string|null)=>void} setMySlot
     * @property {() => boolean} getGameOver
     * @property {(v:boolean)=>void} setGameOver
     * @property {() => *} getWinner
     * @property {(w:*)=>void} setWinner
     * @property {() => boolean} getReplayMode
     * @property {() => boolean} getShowEstimateActive
     * @property {(v:boolean)=>void} setShowEstimateActive
     * @property {() => boolean} getWaitingScoreConfirm
     * @property {(v:boolean)=>void} setWaitingScoreConfirm
     * @property {() => boolean} getIRejected
     * @property {(v:boolean)=>void} setIRejected
     * @property {HTMLElement} colorStatus
     * @property {HTMLElement} scoreTitle
     * @property {HTMLElement} turnDisplay
     * @property {HTMLElement} labelBlack
     * @property {HTMLElement} labelWhite
     * @property {HTMLInputElement} radioBlack
     * @property {HTMLInputElement} radioWhite
     * @property {(state:any)=>void} syncState
     * @property {()=>void} updateBoardGeometry
     * @property {(n:number)=>*} initBoardArray
     * @property {()=>void} exitReplayMode
     * @property {()=>void} clearEstimate
     * @property {()=>void} hideScoreConfirm
     * @property {()=>void} showEstimate
     * @property {()=>void} clearMobileMovePreview
     * @property {(data:any)=>void} downloadRecord
     * @property {(data:any)=>void} enterReplayMode
     * @property {()=>void} updateTurn
     * @property {(lead:number)=>void} showScoreConfirm
     * @property {(msg:any, prevBoardSize:number)=>void} [onImportSuccessBeforeSync]
     * @property {()=>void} [onNewGameStarted]
     * @property {()=>void} [onRoomReset]
     * @property {(msg:any)=>void} [onBoardSizeChanged]
     */

    function createWeiqiMessageBindings(ctx) {
        function handleMessage(msg) {
            const ws = ctx.getWs();
            switch (msg.type) {
                case 'joined':
                    sessionStorage.removeItem(`roomPassword_${ctx.roomId}`);
                    if (msg.state && msg.state.boardSize && msg.state.boardSize !== ctx.getBoardSize()) {
                        ctx.setBoardSize(msg.state.boardSize);
                        if (msg.state.komi != null && Number.isFinite(msg.state.komi))
                            ctx.setKomi(msg.state.komi);
                        ctx.setBoard(ctx.initBoardArray(ctx.getBoardSize()));
                        ctx.updateBoardGeometry();
                        const boardSizeSelect = document.getElementById('boardSizeSelect');
                        if (boardSizeSelect) 
                            boardSizeSelect.value = ctx.getBoardSize();
                    }
                    if (msg.role === 'player') {
                        ctx.setMySlot(msg.slot);
                        ctx.colorStatus.innerText = `已选择: ${ctx.getMySlot() === 'black' ? '黑方' : '白方'}`;
                        if (msg.state) ctx.syncState(msg.state);
                    } else {
                        ctx.setMySlot(null);
                        ctx.colorStatus.innerText = '观战';
                        if (msg.state) ctx.syncState(msg.state);
                    }
                    updateRadioStyles();
                    // 大厅「导入棋谱」：创建房间并跳转后，在此处发送 importRecord（与房间内选文件导入一致）
                    (function lobbyPendingImportAfterJoin() {
                        const raw = sessionStorage.getItem('qiLobbyPendingImport');
                        if (!raw || !ws || ws.readyState !== WebSocket.OPEN) return;
                        try {
                            const pending = JSON.parse(raw);
                            const rid = String(ctx.roomId);
                            if (
                                pending.record
                                && typeof pending.record === 'object'
                                && pending.expectedRoomId === rid
                                && pending.expectedGameId === ctx.gameType
                                && pending.record.gameId === ctx.gameType
                            ) {
                                sessionStorage.removeItem('qiLobbyPendingImport');
                                ws.send(JSON.stringify({ type: 'importRecord', data: pending.record }));
                            }
                        } catch (e) {
                            sessionStorage.removeItem('qiLobbyPendingImport');
                        }
                    })();
                    break;
                case 'slotOccupied':
                    {
                        const s = ctx.getSlots();
                        if (msg.slot === 'black') s.black = true;
                        else if (msg.slot === 'white') s.white = true;
                    }
                    updateRadioStyles();
                    break;
                case 'slotReleased':
                    {
                        const s = ctx.getSlots();
                        if (msg.slot === 'black') s.black = false;
                        else if (msg.slot === 'white') s.white = false;
                        if (ctx.getMySlot() === msg.slot) {
                            ctx.setMySlot(null);
                            ctx.colorStatus.innerText = '观战';
                        }
                    }
                    updateRadioStyles();
                    break;
                case 'colorAssigned':
                    ctx.setMySlot(msg.color);
                    ctx.colorStatus.innerText = `已选择: ${ctx.getMySlot() === 'black' ? '黑方' : '白方'}`;
                    {
                        const s = ctx.getSlots();
                        if (ctx.getMySlot() === 'black') s.black = true;
                        else s.white = true;
                    }
                    updateRadioStyles();
                    break;
                case 'gameState':
                    ctx.syncState(msg);
                    updateRadioStyles();
                    break;
                case 'broadcast':
                    if (msg.action === 'move' || msg.action === 'pass' || msg.action === 'capture' || msg.action === 'undoAccept' || msg.action === 'drawAgreed' || msg.action === 'resign'
                        || msg.action === 'invisibleReveal' || msg.action === 'endAgreed' || msg.action === 'scoreCountingStarted') {
                        const wasOver = ctx.getGameOver();
                        ctx.syncState(msg);
                        if (msg.gameOver && !wasOver) {
                            if (msg.winner === 'black') alert('黑胜。');
                            else if (msg.winner === 'white') alert('白胜。');
                            else if (msg.winner === 'draw') alert('和棋。');
                        } else if (msg.action === 'drawAgreed' && !wasOver) alert('和棋。');
                        else if (msg.action === 'resign' && !wasOver) alert(`${msg.player === 'black' ? '黑方' : '白方'}认输`);
                    }
                    break;
                case 'newGameStarted':
                    ctx.exitReplayMode();
                    ctx.clearEstimate();
                    ctx.hideScoreConfirm();
                    ctx.setWaitingScoreConfirm(false);
                    ctx.setIRejected(false);
                    ctx.setMySlot(null);
                    ctx.colorStatus.innerText = '观战';
                    ctx.setSlots({ black: false, white: false });
                    ctx.scoreTitle.innerText = '　';
                    if (ctx.onNewGameStarted) ctx.onNewGameStarted();
                    ctx.syncState(msg);
                    updateRadioStyles();
                    break;
                case 'newGameRequest':
                    if (confirm('对方请求开始新的一局，是否同意？')) ws.send(JSON.stringify({ type: 'newGameResponse', accept: true }));
                    else ws.send(JSON.stringify({ type: 'newGameResponse', accept: false }));
                    break;
                case 'undoRequest':
                    if (confirm('对方请求悔棋，是否同意？')) ws.send(JSON.stringify({ type: 'undoResponse', accept: true }));
                    else ws.send(JSON.stringify({ type: 'undoResponse', accept: false }));
                    break;
                case 'drawRequest':
                    if (confirm('对方申请和棋，是否同意？')) ws.send(JSON.stringify({ type: 'drawResponse', accept: true }));
                    else ws.send(JSON.stringify({ type: 'drawResponse', accept: false }));
                    break;
                case 'scoreProposal': {
                    const lead = msg.lead;
                    ctx.clearMobileMovePreview();
                    ctx.setWaitingScoreConfirm(true);
                    ctx.setIRejected(false);
                    if (!ctx.getShowEstimateActive()) {
                        ctx.setShowEstimateActive(true);
                        ctx.showEstimate();
                    } else {
                        ctx.showEstimate();
                    }
                    ctx.showScoreConfirm(lead);
                    break;
                }
                case 'scoreAgreed':
                    ctx.setGameOver(true);
                    ctx.setWinner(msg.winner);
                    {
                        const finalLead = msg.lead;
                        const finalWinnerText = finalLead > 0 ? `黑胜${finalLead.toFixed(1)}点` : (finalLead < 0 ? `白胜${(-finalLead).toFixed(1)}点` : '和棋');
                        ctx.scoreTitle.innerText = finalWinnerText;
                        ctx.turnDisplay.innerText = '对局结束';
                        if (ctx.getShowEstimateActive()) {
                            ctx.setShowEstimateActive(false);
                            ctx.clearEstimate();
                        }
                        ctx.hideScoreConfirm();
                        ctx.setWaitingScoreConfirm(false);
                        ctx.setIRejected(false);
                        ctx.clearMobileMovePreview();
                        ctx.updateTurn();
                    }
                    break;
                case 'scoreRejected':
                    if (ctx.getIRejected()) ctx.setIRejected(false);
                    else alert('对方拒绝数子结果，对局继续');
                    ctx.clearMobileMovePreview();
                    if (ctx.getShowEstimateActive()) {
                        ctx.setShowEstimateActive(false);
                        ctx.clearEstimate();
                    }
                    ctx.hideScoreConfirm();
                    ctx.setWaitingScoreConfirm(false);
                    break;
                case 'requestEnd':
                    if (confirm('对方申请数子，是否同意？')) ws.send(JSON.stringify({ type: 'endResponse', accept: true }));
                    else ws.send(JSON.stringify({ type: 'endResponse', accept: false }));
                    break;
                case 'gameRecord':
                    ctx.downloadRecord(msg.data);
                    break;
                case 'importSuccess': {
                    const importPrevBoardSize = ctx.getBoardSize();
                    if (msg.boardSize && msg.boardSize !== ctx.getBoardSize()) {
                        ctx.setBoardSize(msg.boardSize);
                        if (msg.komi != null && Number.isFinite(msg.komi))
                            ctx.setKomi(msg.komi);
                        ctx.setBoard(ctx.initBoardArray(ctx.getBoardSize()));
                        ctx.updateBoardGeometry();
                        const boardSizeSelect = document.getElementById('boardSizeSelect');
                        if (boardSizeSelect)
                             boardSizeSelect.value = msg.boardSize;
                    }
                    if (ctx.onImportSuccessBeforeSync) ctx.onImportSuccessBeforeSync(msg, importPrevBoardSize);
                    ctx.syncState(msg);
                    ctx.clearEstimate();
                    ctx.hideScoreConfirm();
                    ctx.setWaitingScoreConfirm(false);
                    if (msg.replayData) ctx.enterReplayMode(msg.replayData);
                    updateRadioStyles();
                    break;
                }
                case 'roomReset':
                    ctx.exitReplayMode();
                    if (ctx.onRoomReset) ctx.onRoomReset();
                    ctx.syncState(msg);
                    ctx.clearEstimate();
                    ctx.hideScoreConfirm();
                    ctx.setWaitingScoreConfirm(false);
                    updateRadioStyles();
                    break;
                case 'boardSizeChanged':
                    if (ctx.onBoardSizeChanged) ctx.onBoardSizeChanged(msg);
                    else if (msg.boardSize)
                    {
                        const boardSizeSelect = document.getElementById('boardSizeSelect');
                        if (boardSizeSelect) 
                            boardSizeSelect.value = msg.boardSize;
                    }
                    break;
                case 'error':
                    if (msg.message === '密码错误') {
                        sessionStorage.removeItem(`roomPassword_${ctx.roomId}`);
                        window.location.href = `/qi?game=${ctx.gameType}&room=${ctx.roomId}&needPassword=1`;
                    } else alert(msg.message);
                    break;
                default:
                    console.log('未知消息', msg);
            }
        }

        function updateRecordButtons() {
            const importBtn = document.getElementById('importBtn');
            const exportBtn = document.getElementById('exportBtn');
            if (!importBtn || !exportBtn) return;
            if (ctx.getReplayMode()) {
                importBtn.style.display = 'none';
                exportBtn.style.display = 'none';
            } else {
                const board = ctx.getBoard();
                const hasAnyStone = board.some(row => row.some(v => v !== 0));
                const s = ctx.getSlots();
                const noPlayers = !s.black && !s.white;
                if (noPlayers && !hasAnyStone) {
                    importBtn.style.display = '';
                    exportBtn.style.display = 'none';
                } else {
                    importBtn.style.display = 'none';
                    exportBtn.style.display = '';
                }
            }
        }

        function updateRadioStyles() {
            ctx.labelBlack.classList.remove('self-radio', 'opponent-radio', 'checked-disabled');
            ctx.labelWhite.classList.remove('self-radio', 'opponent-radio', 'checked-disabled');
            const slots = ctx.getSlots();
            const mySlot = ctx.getMySlot();
            if (slots.black) {
                ctx.labelBlack.classList.add(mySlot === 'black' ? 'self-radio' : 'opponent-radio');
                ctx.labelBlack.classList.add('checked-disabled');
                ctx.radioBlack.disabled = true;
                ctx.radioBlack.checked = true;
            } else {
                ctx.radioBlack.disabled = false;
                ctx.radioBlack.checked = false;
            }
            if (slots.white) {
                ctx.labelWhite.classList.add(mySlot === 'white' ? 'self-radio' : 'opponent-radio');
                ctx.labelWhite.classList.add('checked-disabled');
                ctx.radioWhite.disabled = true;
                ctx.radioWhite.checked = true;
            } else {
                ctx.radioWhite.disabled = false;
                ctx.radioWhite.checked = false;
            }
            updateRecordButtons();
        }

        const newGameBtn = document.getElementById('newGameBtn');
        if (newGameBtn !== null) 
        {
            newGameBtn.onclick = () => {
                if (ps.replayMode) {
                    if (!ps.mySlot) {
                        if (ps.slots.black || ps.slots.white) {
                            alert('只有对局者可以开始新局');
                            return;
                        }
                        if (!confirm('确定开始新局吗？')) return;
                        if (ps.ws && ps.ws.readyState === WebSocket.OPEN)
                            ps.ws.send(JSON.stringify({ type: 'resetRoom' }));
                        return;
                    }
                    const opponentSlot = ps.mySlot === 'black' ? 'white' : 'black';
                    const hasOpponent = ps.slots[opponentSlot];
                    if (hasOpponent) {
                        if (confirm('确定向对方申请开始新局吗？')) ps.ws.send(JSON.stringify({ type: 'requestNewGame' }));
                    } else {
                        if (confirm('确定开始新局吗？')) ps.ws.send(JSON.stringify({ type: 'requestNewGame' }));
                    }
                    return;
                }
                if (!ps.mySlot) { alert('只有对局者可以开始新局'); return; }
                const opponentSlot = ps.mySlot === 'black' ? 'white' : 'black';
                const hasOpponent = ps.slots[opponentSlot];
                if (hasOpponent) {
                    if (confirm('确定向对方申请开始新局吗？')) ps.ws.send(JSON.stringify({ type: 'requestNewGame' }));
                } else {
                    if (confirm('确定开始新局吗？')) ps.ws.send(JSON.stringify({ type: 'requestNewGame' }));
                }
            };
        }

        const estimateBtn = document.getElementById('estimateBtn');
        if (estimateBtn !== null) 
        {
            estimateBtn.onclick = () => {
                ps.showEstimateActive = !ps.showEstimateActive;
                if (ps.showEstimateActive) showEstimate();
                else clearEstimate();
            };
        }

        const tryPlayBtn = document.getElementById('tryPlayBtn');
        if (tryPlayBtn !== null) 
        {
            tryPlayBtn.onclick = () => {
                if (ps.tryPlayMode) exitTryPlay();
                else enterTryPlay();
            };
        }

        const passBtn = document.getElementById('passBtn');
        if (passBtn !== null) 
        {
            passBtn.onclick = () => {
                if (!ps.isMyTurn) return;
                ps.ws.send(JSON.stringify({ type: 'pass' }));
            };
        }

        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn !== null) 
        {
            undoBtn.onclick = () => {
                if (!ps.mySlot) { alert('只有对局者可以悔棋'); return; }
                const opponentSlot = ps.mySlot === 'black' ? 'white' : 'black';
                const hasOpponent = ps.slots[opponentSlot];
                if (hasOpponent) {
                    if (confirm('确定向对方申请悔棋吗？')) ps.ws.send(JSON.stringify({ type: 'requestUndo' }));
                } else {
                    if (confirm('确定悔棋吗？')) ps.ws.send(JSON.stringify({ type: 'requestUndo' }));
                }
            };
        }

        const resignBtn = document.getElementById('resignBtn');
        if (resignBtn !== null) 
        {
            resignBtn.onclick = () => {
                if (!ps.mySlot) { alert('只有对局者可以认输'); return; }
                if (confirm('确定认输吗？')) ps.ws.send(JSON.stringify({ type: 'resign' }));
            };
        }

        const drawBtn = document.getElementById('drawBtn');
        if (drawBtn !== null) 
        {
            drawBtn.onclick = () => {
                if (!ps.mySlot) { alert('只有对局者可以申请和棋'); return; }
                const opponentSlot = ps.mySlot === 'black' ? 'white' : 'black';
                const hasOpponent = ps.slots[opponentSlot];
                if (hasOpponent) {
                    if (confirm('确定向对方申请和棋吗？')) ps.ws.send(JSON.stringify({ type: 'requestDraw' }));
                } else {
                    if (confirm('确定和棋吗？')) ps.ws.send(JSON.stringify({ type: 'requestDraw' }));
                }
            };
        }

        const endReqBtn = document.getElementById('endReqBtn');
        if (endReqBtn !== null) 
        {
            endReqBtn.onclick = () => {
                if (!ps.mySlot) { alert('只有对局者可以申请数子'); return; }
                ps.ws.send(JSON.stringify({ type: 'requestEnd' }));
            };
        }

        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn !== null) 
        {
            exportBtn.onclick = () => {
                ps.ws.send(JSON.stringify({ type: 'exportRecord' }));
            };
        }

        const importBtn = document.getElementById('importBtn');
        if (importBtn !== null) 
        {
            importBtn.onclick = () => {
                document.getElementById('importFileInput').click();
            };
        }
    
        const showNumbersCheck = document.getElementById('showNumbersCheck');
        if (showNumbersCheck !== null) 
        {
            showNumbersCheck.onchange = (e) => {
                ps.showMoveNumbers = e.target.checked;
                drawBoard();
            };
        }

        const importFileInput = document.getElementById('importFileInput');
        if (importFileInput !== null) 
            {importFileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const data = JSON.parse(ev.target.result);
                        ps.ws.send(JSON.stringify({ type: 'importRecord', data }));
                    } catch (err) {
                        alert('棋谱文件解析失败');
                    }
                };
                reader.readAsText(file);
                e.target.value = '';
            };
        }

        const boardSizeSelect = document.getElementById('boardSizeSelect');
        if (boardSizeSelect) 
        {
            boardSizeSelect.addEventListener('change', (e) =>
            {
                const newSize = parseInt(e.target.value, 10);
                if (ps.ws && ps.ws.readyState === WebSocket.OPEN)
                    ps.ws.send(JSON.stringify({ type: 'setBoardSize', size: newSize }));
            });
        }

        const backToLobbyBtn = document.getElementById('backToLobbyBtn');
        if (backToLobbyBtn !== null)
            backToLobbyBtn.onclick = () => { window.location.href = '/qi'; };

        ctx.radioBlack.onchange = function () { if (this.checked && !this.disabled) ps.ws.send(JSON.stringify({ type: 'selectColor', color: 'black' })); };
        ctx.radioWhite.onchange = function () { if (this.checked && !this.disabled) ps.ws.send(JSON.stringify({ type: 'selectColor', color: 'white' })); };

        const replayBackBtn = document.getElementById('replayBackBtn');
        if (replayBackBtn !== null)
        {
            replayBackBtn.onclick = () => {
                if (ps.replayMode) {
                    if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep - 1);
                    else setReplayStep(ps.replayStep - 1);
                } else {
                    setLiveViewStep(ps.liveViewStep - 1);
                }
            };
        }
        
        const replayForwardBtn = document.getElementById('replayForwardBtn');
        if (replayForwardBtn !== null)
        {
            replayForwardBtn.onclick = () => {
                if (ps.replayMode) {
                    if (ps.tryPlayMode) setTryPlayStep(ps.tryPlayStep + 1);
                    else setReplayStep(ps.replayStep + 1);
                } else {
                    setLiveViewStep(ps.liveViewStep + 1);
                }
            };
        }

        const replaySlider = document.getElementById('replaySlider');
        if (replaySlider !== null)
        {
            replaySlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                if (ps.replayMode) {
                    if (ps.tryPlayMode) setTryPlayStep(val);
                    else setReplayStep(val);
                } else {
                    setLiveViewStep(val);
                }
            });
        }

        const rulesModal = document.getElementById('rulesModal');
        if (rulesModal !== null)
        {
            const helpBtn = document.getElementById('helpBtn');
            if (helpBtn !== null)
                helpBtn.onclick = () => rulesModal.style.display = 'flex';
            const closeRulesBtn = document.getElementById('closeRulesBtn');
            if (closeRulesBtn !== null)
                closeRulesBtn.onclick = () => rulesModal.style.display = 'none';
            rulesModal.onclick = (e) => { if (e.target === rulesModal) rulesModal.style.display = 'none'; };
        }
        return { handleMessage, updateRecordButtons, updateRadioStyles };
    }

    const QiBoardRoomClient = {
        openRoomWebSocket: qiOpenRoomWebSocket,
        createWeiqiMessageBindings
    };

    global.qiOpenRoomWebSocket = qiOpenRoomWebSocket;
    global.QiBoardRoomClient = QiBoardRoomClient;
})(typeof window !== 'undefined' ? window : global);

/**
 * 方格围棋系页面共用：星位、空棋盘、几何、最近交叉点、形势判断 DOM、拆分的棋盘绘制、标准房间 WebSocket onClose。
 * 依赖本包前半段的 qiOpenRoomWebSocket。三角/六角/扭棱等非方格棋盘请勿使用绘制部分。
 */
(function (global) {
    const DEFAULT_CANVAS_SIZE = 600;

    function getStarPoints(boardSize) {
        const stars = [];
        let cornerOffset = boardSize <= 11 ? 2 : 3;
        const corners = [
            [cornerOffset, cornerOffset],
            [cornerOffset, boardSize - 1 - cornerOffset],
            [boardSize - 1 - cornerOffset, cornerOffset],
            [boardSize - 1 - cornerOffset, boardSize - 1 - cornerOffset]
        ];
        stars.push(...corners);
        if (boardSize >= 9 && boardSize % 2 === 1) {
            const center = Math.floor(boardSize / 2);
            stars.push([center, center]);
        }
        if (boardSize >= 15 && boardSize % 2 === 1) {
            const center = Math.floor(boardSize / 2);
            const sideOffset = 3;
            stars.push([sideOffset, center]);
            stars.push([boardSize - 1 - sideOffset, center]);
            stars.push([center, sideOffset]);
            stars.push([center, boardSize - 1 - sideOffset]);
        }
        return stars;
    }

    function initBoardArray(size) {
        return Array(size).fill().map(() => Array(size).fill(0));
    }

    /**
     * @param {number} boardSize
     * @param {number} [canvasSize=600]
     * @returns {{ padding: number, cellSize: number, canvasSize: number }}
     */
    function computePaddingAndCell(boardSize, canvasSize) {
        const cs = canvasSize != null ? canvasSize : DEFAULT_CANVAS_SIZE;
        const padding = Math.max(20, 63 - 2 * boardSize);
        const cellSize = (cs - 2 * padding) / (boardSize - 1);
        return { padding, cellSize, canvasSize: cs };
    }

    function getClosestIntersection(x, y, boardSize, padding, cellSize) {
        const col = Math.round((x - padding) / cellSize);
        const row = Math.round((y - padding) / cellSize);
        if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return { row: -1, col: -1 };
        return { row, col };
    }

    function canvasCoordsFromClient(clientX, clientY, canvas, logicalSize) {
        const ls = logicalSize != null ? logicalSize : DEFAULT_CANVAS_SIZE;
        const rect = canvas.getBoundingClientRect();
        const scale = ls / rect.width;
        return {
            x: (clientX - rect.left) * scale,
            y: (clientY - rect.top) * scale
        };
    }

    /**
     * 与围棋页「形势判断」面板文案一致（需已算好 live/territory）。
     * @returns {{ cachedLiveBoard: *, cachedTerritory: *, lead: number }}
     */
    function computeWeiqiEstimateCaches(board, removeDeadAndDying, assignTerritoryWithRange, computeScore, komi) {
        const cachedLiveBoard = removeDeadAndDying(board);
        const cachedTerritory = assignTerritoryWithRange(cachedLiveBoard);
        const { blackTotal, whiteTotal } = computeScore(cachedLiveBoard, cachedTerritory);
        const lead = blackTotal - whiteTotal - 2 * komi;
        return { cachedLiveBoard, cachedTerritory, lead, blackTotal, whiteTotal };
    }

    function fillWeiqiEstimatePanel(scoreTitle, scoreBoard, leadInfo, blackTotal, whiteTotal, lead) {
        scoreTitle.innerText = '形势判断';
        scoreBoard.innerText = `黑: ${blackTotal.toFixed(0)}　白: ${whiteTotal.toFixed(0)}`;
        leadInfo.innerText = `黑${lead >= 0 ? '+' : ''}${lead.toFixed(1)}点`;
    }

    function clearWeiqiEstimatePanel(scoreTitle, scoreBoard, leadInfo) {
        scoreTitle.innerText = '　';
        scoreBoard.innerText = '　';
        leadInfo.innerText = '　';
    }

    const draw = {
        clear(ctx, canvasSize) {
            const s = canvasSize != null ? canvasSize : DEFAULT_CANVAS_SIZE;
            ctx.clearRect(0, 0, s, s);
        },

        grid(ctx, boardSize, padding, cellSize, canvasSize) {
            const cs = canvasSize != null ? canvasSize : DEFAULT_CANVAS_SIZE;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#3a281c';
            for (let i = 0; i < boardSize; i++) {
                ctx.beginPath();
                ctx.moveTo(padding + i * cellSize, padding);
                ctx.lineTo(padding + i * cellSize, cs - padding);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(padding, padding + i * cellSize);
                ctx.lineTo(cs - padding, padding + i * cellSize);
                ctx.stroke();
            }
        },

        starPoints(ctx, boardSize, padding, cellSize, starPts) {
            const pts = starPts != null ? starPts : getStarPoints(boardSize);
            ctx.fillStyle = '#3a281c';
            for (let [r, c] of pts) {
                ctx.beginPath();
                ctx.arc(padding + c * cellSize, padding + r * cellSize, cellSize * 0.12, 0, 2 * Math.PI);
                ctx.fill();
            }
        },

        coordLabels(ctx, boardSize, padding, cellSize) {
            ctx.font = `bold ${17 - 0.2 * boardSize}px Arial`;
            ctx.fillStyle = '#3a281c';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let c = 0; c < boardSize; c++) 
            {
                let letter = String.fromCharCode(65 + c);
                if (c >= 26)
                    letter = String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + c % 26);
                const x = padding + c * cellSize;
                const y = 0.6 * padding;
                ctx.fillText(letter, x, y);
            }
            for (let r = 0; r < boardSize; r++) 
                {
                const number = (r + 1).toString();
                const x = padding / 2;
                const y = padding + r * cellSize;
                ctx.fillText(number, x, y);
            }
        },

        /** 显示序号或形势判断时：三角形最后落子标记（在棋子下方） */
        lastMoveMarkersLower(ctx, lastMoveMarkers, padding, cellSize, stoneRadius) {
            for (let { row, col, color } of lastMoveMarkers) {
                const x = padding + col * cellSize;
                const y = padding + row * cellSize;
                ctx.beginPath();
                ctx.moveTo(x + stoneRadius, y + stoneRadius);
                ctx.lineTo(x, y + stoneRadius);
                ctx.lineTo(x + stoneRadius, y);
                ctx.closePath();
                ctx.fillStyle = color === 1 ? '#fff' : '#222';
                ctx.fill();
            }
        },

        stonesBlackWhite(ctx, board, boardSize, padding, cellSize, stoneRadius, showMoveNumbers) {
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = board[r][c];
                    if (val !== 1 && val !== 2) continue;
                    const x = padding + c * cellSize;
                    const y = padding + r * cellSize;
                    const radius = stoneRadius;
                    ctx.save();
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowOffsetY = 2;
                    const grad = ctx.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
                    if (val === 1) {
                        grad.addColorStop(0, '#444');
                        grad.addColorStop(0.6, '#222');
                        grad.addColorStop(1, '#111');
                    } else {
                        grad.addColorStop(0, '#fff');
                        grad.addColorStop(0.5, '#eee');
                        grad.addColorStop(1, '#aaa');
                    }
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, 2 * Math.PI);
                    ctx.fillStyle = grad;
                    ctx.fill();
                    ctx.restore();
                    if (!showMoveNumbers) {
                        ctx.beginPath();
                        ctx.arc(x - 3, y - 3, radius * 0.15, 0, 2 * Math.PI);
                        ctx.fillStyle = val === 1 ? '#444' : '#fff';
                        ctx.fill();
                    }
                }
            }
        },

        /** 直角三角形最后落子标记（棋子之上） */
        lastMoveMarkersUpper(ctx, lastMoveMarkers, padding, cellSize, markLen) {
            for (let { row, col, color } of lastMoveMarkers) {
                const x = padding + col * cellSize;
                const y = padding + row * cellSize;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + markLen, y);
                ctx.lineTo(x, y + markLen);
                ctx.closePath();
                ctx.fillStyle = color === 1 ? '#fff' : '#222';
                ctx.fill();
            }
        },

        userBoardMarks(ctx, userBoardMarksMap, boardSize, padding, cellSize, isVisibleAt) {
            for (const key of Object.keys(userBoardMarksMap)) {
                const [r, c] = key.split(',').map(Number);
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (isVisibleAt && !isVisibleAt(r, c)) continue;
                const ch = userBoardMarksMap[key];
                const x = padding + c * cellSize;
                const y = padding + r * cellSize;
                const markBgR = cellSize * 0.3;
                ctx.beginPath();
                ctx.arc(x, y, markBgR, 0, 2 * Math.PI);
                ctx.fillStyle = '#deb887';
                ctx.fill();
                const fontPx = cellSize * (ch === '🚩' ? 0.6 : 0.66);
                ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, x, y + 1);
            }
        },

        moveNumbersOnStones(ctx, nums, board, boardSize, padding, cellSize) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if (nums[r][c] > 0 && board[r][c] !== 0) {
                        const sx = padding + c * cellSize;
                        const sy = padding + r * cellSize;
                        const numStr = nums[r][c].toString();
                        const fontSize = Math.max(9, Math.floor(cellSize * (numStr.length >= 3 ? 0.308 : 0.396)));
                        ctx.font = `bold ${fontSize}px Arial`;
                        ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#000';
                        ctx.fillText(numStr, sx, sy + 1);
                    }
                }
            }
        },

        hoverPreviewStone(ctx, hoverRow, hoverCol, board, padding, cellSize, options) {
            const { tryPlayMode, tryPlayCurrentPlayer, gameOver, isMyTurn, mySlot } = options;
            const canHover = tryPlayMode || (!gameOver && isMyTurn);
            if (!canHover || hoverRow < 0 || hoverCol < 0 || board[hoverRow][hoverCol] !== 0) return;
            if (!options.isHoverValid) return;
            if (options.hoverCapture) return;
            ctx.globalAlpha = 0.45;
            ctx.beginPath();
            ctx.arc(padding + hoverCol * cellSize, padding + hoverRow * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
            const hoverColor = tryPlayMode
                ? (tryPlayCurrentPlayer === 1 ? '#222' : '#ddd')
                : (mySlot === 'black' ? '#222' : '#ddd');
            ctx.fillStyle = hoverColor;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        },

        hoverCaptureRing(ctx, hoverRow, hoverCol, padding, cellSize, stoneRadius, options) {
            const { tryPlayMode, gameOver, isMyTurn, isHoverValid, hoverCapture } = options;
            const canHover = tryPlayMode || (!gameOver && isMyTurn);
            if (!canHover || !hoverCapture || !isHoverValid || hoverRow < 0 || hoverCol < 0) return;
            const x = padding + hoverCol * cellSize;
            const y = padding + hoverRow * cellSize;
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, stoneRadius + 1, 0, 2 * Math.PI);
            ctx.strokeStyle = '#d62828';
            ctx.lineWidth = cellSize * 0.055;
            ctx.stroke();
            ctx.restore();
        },

        estimateOverlay(ctx, board, boardSize, padding, cellSize, cachedLiveBoard, cachedTerritory) {
            if (!cachedLiveBoard || !cachedTerritory) return;
            const dotRadius = cellSize * 0.18;
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if (board[r][c] !== 0 && cachedLiveBoard[r][c] === 0) {
                        const x = padding + c * cellSize;
                        const y = padding + r * cellSize;
                        ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#222';
                        ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                    } else if (board[r][c] === 0 && cachedTerritory[r][c] === 1) {
                        const x = padding + c * cellSize;
                        const y = padding + r * cellSize;
                        ctx.fillStyle = '#222';
                        ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                    } else if (board[r][c] === 0 && cachedTerritory[r][c] === 2) {
                        const x = padding + c * cellSize;
                        const y = padding + r * cellSize;
                        ctx.fillStyle = '#f0f0f0';
                        ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                    }
                }
            }
        }
    };

    /**
     * @param {object} o
     * @param {Function} o.connectWebSocket — 页面上的重连入口（会赋给 ws）
     * @param {() => any} o.getReconnectTimer
     * @param {(t: any) => void} o.setReconnectTimer
     * @param {HTMLElement} o.colorStatus
     */
    function standardRoomSocketOnClose(o) {
        return function (event) {
            if (event.code === 1008 && event.reason && String(event.reason).includes('房间不存在')) {
                alert('房间不存在，请返回大厅');
                window.location.href = '/qi';
                return;
            }
            o.colorStatus.innerText = '连接断开，重连中...';
            const id = setTimeout(o.connectWebSocket, 2000);
            if (o.setReconnectTimer) o.setReconnectTimer(id);
        };
    }

    /**
     * 与围棋页 connectWebSocket 等价：清 timer、qiOpenRoomWebSocket、标准 onClose。
     * @param {object} opts
     * @param {() => void} [opts.clearReconnectTimer] 若提供则先调用（典型：`if (reconnectTimer) clearTimeout(reconnectTimer)`）
     */
    function connectWeiqiRoomWebSocket(opts) {
        const {
            gameType, roomId, roomPassword,
            onMessage,
            colorStatus,
            connectWebSocket
        } = opts;
        if (opts.clearReconnectTimer) opts.clearReconnectTimer();
        return global.qiOpenRoomWebSocket({
            gameType,
            roomId,
            roomPassword,
            onMessage,
            onClose: standardRoomSocketOnClose({
                connectWebSocket,
                getReconnectTimer: opts.getReconnectTimer,
                setReconnectTimer: opts.setReconnectTimer,
                colorStatus
            })
        });
    }

    function deepCopyBoard(src) {
        return src.map(row => row.slice());
    }

    /**
     * @param {HTMLSelectElement|null} boardMarkSelect
     * @param {string[]} charList
     * @param {string} [defaultSelectedChar='?']
     */
    function initBoardMarkSelectDom(boardMarkSelect, charList, defaultSelectedChar) {
        if (!boardMarkSelect) return;
        const def = defaultSelectedChar != null ? defaultSelectedChar : '?';
        const frag = document.createDocumentFragment();
        const optEmpty = document.createElement('option');
        optEmpty.value = '';
        optEmpty.textContent = '清除';
        frag.appendChild(optEmpty);
        for (const ch of charList) {
            const o = document.createElement('option');
            o.value = ch;
            o.textContent = ch;
            if (ch === def) o.selected = true;
            frag.appendChild(o);
        }
        boardMarkSelect.appendChild(frag);
    }

    function initBoardMarkFoldDom(panel, foldBtn, expandBtn) {
        if (!panel || !foldBtn || !expandBtn) return;
        function setCollapsed(collapsed) {
            panel.hidden = collapsed;
            expandBtn.hidden = !collapsed;
            foldBtn.setAttribute('aria-expanded', String(!collapsed));
            expandBtn.setAttribute('aria-expanded', String(!collapsed));
        }
        foldBtn.onclick = () => setCollapsed(true);
        expandBtn.onclick = () => setCollapsed(false);
        setCollapsed(true);
    }

    /**
     * @param {object} data 棋谱 JSON
     * @param {string} filenamePrefix 文件名前缀（如「围棋」「二气围棋」）
     */
    function downloadWeiqiJsonRecord(data, filenamePrefix) {
        const now = new Date();
        const pad = n => n.toString().padStart(2, '0');
        const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const filename = `${filenamePrefix}_${data.boardSize}路_${dateStr}.json`;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function fillScoreConfirmText(scoreConfirmTextEl, lead) {
        const absLead = Math.abs(lead).toFixed(1);
        const winnerText = lead > 0 ? `黑胜${absLead}点` : (lead < 0 ? `白胜${absLead}点` : '和棋');
        scoreConfirmTextEl.innerText = `${winnerText}，是否同意该结果？`;
    }

    const QiSquareWeiqiCanvas = {
        DEFAULT_CANVAS_SIZE,
        getStarPoints,
        initBoardArray,
        deepCopyBoard,
        computePaddingAndCell,
        getClosestIntersection,
        canvasCoordsFromClient,
        computeWeiqiEstimateCaches,
        fillWeiqiEstimatePanel,
        clearWeiqiEstimatePanel,
        draw,
        standardRoomSocketOnClose,
        connectWeiqiRoomWebSocket,
        initBoardMarkSelectDom,
        initBoardMarkFoldDom,
        downloadWeiqiJsonRecord,
        fillScoreConfirmText
    };

    global.QiSquareWeiqiCanvas = QiSquareWeiqiCanvas;
})(typeof window !== 'undefined' ? window : global);

/**
 * 方格围棋类页面运行时 QiWeiqiSquarePageRuntime：含 create(ps,dom,opts) 与多棋种共用片段（同一对象，非额外模块）。
 * create：绘制、形势、打谱/试下、局面浏览、WebSocket、同步状态等。
 * 另有 holeDrawPit、holeDrawRedBlock、stoneAccent、stoneDanger、fogBlend、
 * invisibleDrawStone、cellWeight、neutralDrawSmallMarker 供三角/六角/洞/易位/迷雾/隐身子/权重等页面复用。
 * 依赖 QiSquareWeiqiCanvas、QiBoardRoomClient。
 *
 * @typedef {Object} SquareWeiqiPageState 由页面持有的可变状态（同一引用贯穿整局）
 * @property {number} BOARD_SIZE
 * @property {number} KOMI
 * @property {number} PADDING
 * @property {number} CELL_SIZE
 * @property {number[][]} board
 * @property {number} numberOfHands
 * @property {number} currentPlayer
 * @property {string|null} mySlot
 * @property {boolean} gameOver
 * @property {string|null} winner
 * @property {Array<{row:number,col:number,color:number}>} lastMoveMarkers
 * @property {boolean} showEstimateActive
 * @property {number[][]|null} cachedLiveBoard
 * @property {number[][]|null} cachedTerritory
 * @property {boolean} waitingScoreConfirm
 * @property {boolean} iRejected
 * @property {WebSocket|null} ws
 * @property {boolean} isMyTurn
 * @property {{black:boolean,white:boolean}} slots
 * @property {ReturnType<typeof setTimeout>|null} reconnectTimer
 * @property {boolean} replayMode
 * @property {number[][][]} replayBoards
 * @property {Array<Array<{row:number,col:number,color:number}>>} replayMarkers
 * @property {number[]} replayStepPlayers
 * @property {number} replayStep
 * @property {number} replayTotalSteps
 * @property {boolean} showMoveNumbers
 * @property {Array<{row:number,col:number}|null>} moveLog
 * @property {boolean} tryPlayMode
 * @property {number} tryPlayBaseStep
 * @property {number[][][]} tryPlayBoards
 * @property {Array<Array<{row:number,col:number,color:number}>>} tryPlayMarkers
 * @property {number} tryPlayCurrentPlayer
 * @property {number} tryPlayStep
 * @property {number} tryPlayTotalSteps
 * @property {number[][][]} liveReplayBoards
 * @property {Array<Array<{row:number,col:number,color:number}>>} liveReplayMarkers
 * @property {number[]} liveReplayStepPlayers
 * @property {number} liveViewStep
 * @property {boolean} liveFollowLatest
 * @property {Record<string,string>} userBoardMarks
 * @property {number} hoverRow
 * @property {number} hoverCol
 * @property {boolean} isHoverValid
 */
(function (global) {
    const C = () => global.QiSquareWeiqiCanvas;
    const R = () => global.QiWeiqiSquarePageRuntime;

    /**
     * @param {Object} ps
     * @param {{
     *   turnDisplay: HTMLElement,
     *   scoreTitle: HTMLElement,
     *   scoreBoard: HTMLElement,
     *   leadInfo: HTMLElement,
     *   scoreConfirmPanel: HTMLElement,
     *   scoreConfirmText: HTMLElement,
     *   komiInfo: HTMLElement,
     *   canvas: HTMLCanvasElement,
     *   ctx: CanvasRenderingContext2D,
     *   boardMarkSelect: HTMLSelectElement|null,
     *   colorStatus: HTMLElement,
     * }} dom
     * @param {{
     *   recordDownloadPrefix: string,
     *   minLib?: number,
     *   maxWeakLiberties?: number,
     *   gameType: string,
     *   roomId: string,
     *   roomPassword: string|null,
     *   isMouseDevice: boolean,
     *   tryPlaceStone?: (boardBefore: number[][], row: number, col: number, playerVal: number) => number[][]|null,
     *   drawBoard?: () => void,
     *   syncState?: (state: any) => void,
     *   setReplayStep?: (step: number) => void,
     *   removeDeadAndDying?: (srcBoard: number[][]) => number[][],
     *   assignTerritoryWithRange?: (liveBoard: number[][]) => number[][],
     * }} opts
     */
    function create(ps, dom, opts) {
        const minLib = opts.minLib != null ? opts.minLib : 1;
        const maxWeakLiberties = opts.maxWeakLiberties != null ? opts.maxWeakLiberties : 2;
        const isMouse = !!opts.isMouseDevice;
        if (ps.hoverCapture === undefined) ps.hoverCapture = false;

        function mobileTwoStepPlacing() {
            return !isMouse && ps.BOARD_SIZE > 9;
        }

        function clearMobileMovePreview() {
            ps.hoverRow = -1;
            ps.hoverCol = -1;
            ps.isHoverValid = false;
            ps.hoverCapture = false;
        }

        function deepCopyBoard(src) {
            return C().deepCopyBoard(src);
        }

        function countGroupLiberties(board, row, col) {
            return R().countGroupLiberties(board, row, col, ps.BOARD_SIZE);
        }

        function removeGroup(board, row, col, color) {
            R().removeGroup(board, row, col, color, ps.BOARD_SIZE);
        }

        function tryPlaceStone(boardBefore, row, col, playerVal) {
            if (opts.tryPlaceStone)
                return opts.tryPlaceStone(boardBefore, row, col, playerVal);
            return R().tryPlaceStoneNLiberty(boardBefore, row, col, playerVal, ps.BOARD_SIZE, deepCopyBoard, minLib);
        }

        function removeDeadAndDying(srcBoard) {
            if (opts.removeDeadAndDying)
                return opts.removeDeadAndDying(srcBoard);
            return R().removeDeadAndDying(srcBoard, ps.BOARD_SIZE, deepCopyBoard, maxWeakLiberties);
        }

        function assignTerritoryWithRange(liveBoard) {
            if (opts.assignTerritoryWithRange)
                return opts.assignTerritoryWithRange(liveBoard);
            return R().assignTerritoryWithRange(liveBoard, ps.BOARD_SIZE);
        }

        function computeScore(liveBoard, territory) {
            return R().computeScore(liveBoard, territory, ps.BOARD_SIZE);
        }

        function computeScoreFromBoard(srcBoard) {
            const liveBoard = removeDeadAndDying(srcBoard);
            const territory = assignTerritoryWithRange(liveBoard);
            return computeScore(liveBoard, territory);
        }

        function computeLead() {
            const { blackTotal, whiteTotal } = computeScoreFromBoard(ps.board);
            return blackTotal - whiteTotal - 2 * ps.KOMI;
        }

        function isUserBoardMarkVisibleAt(r, c) {
            if (ps.showEstimateActive) return false;
            if (r < 0 || r >= ps.BOARD_SIZE || c < 0 || c >= ps.BOARD_SIZE) return false;
            if (ps.board[r][c] !== 0) return false;
            return true;
        }

        function computeStoneNumbers() {
            const nums = Array(ps.BOARD_SIZE).fill().map(() => Array(ps.BOARD_SIZE).fill(0));
            if (ps.replayMode && ps.tryPlayMode) {
                for (let i = 1; i <= ps.tryPlayStep; i++) {
                    const markers = ps.tryPlayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (ps.replayMode) {
                for (let i = 1; i <= ps.replayStep; i++) {
                    const markers = ps.replayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else if (ps.liveReplayBoards.length && ps.liveViewStep < ps.liveReplayBoards.length - 1) {
                for (let i = 1; i <= ps.liveViewStep; i++) {
                    const markers = ps.liveReplayMarkers[i];
                    if (markers && markers.length > 0) {
                        const m = markers[0];
                        if (m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                            nums[m.row][m.col] = i;
                    }
                }
            } else {
                for (let i = 0; i < ps.moveLog.length; i++) {
                    const m = ps.moveLog[i];
                    if (m && m.capture) continue;
                    if (m && m.row != null && m.col != null
                        && m.row < ps.BOARD_SIZE && m.col < ps.BOARD_SIZE && ps.board[m.row][m.col] !== 0)
                        nums[m.row][m.col] = i + 1;
                }
            }
            return nums;
        }

        function drawBoard() {
            if (opts.drawBoard) {
                opts.drawBoard();
                return;
            }
            const d = C().draw;
            const cs = C().DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            d.clear(dom.ctx, cs);
            d.grid(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs);
            d.starPoints(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(dom.ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius);
            }
            d.stonesBlackWhite(dom.ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(dom.ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault);
            }
            d.userBoardMarks(dom.ctx, ps.userBoardMarks, ps.BOARD_SIZE, ps.PADDING, cellSize, isUserBoardMarkVisibleAt);
            if (ps.showMoveNumbers) {
                const nums = computeStoneNumbers();
                d.moveNumbersOnStones(dom.ctx, nums, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize);
            }
            d.hoverPreviewStone(dom.ctx, ps.hoverRow, ps.hoverCol, ps.board, ps.PADDING, cellSize, {
                tryPlayMode: ps.tryPlayMode,
                tryPlayCurrentPlayer: ps.tryPlayCurrentPlayer,
                gameOver: ps.gameOver,
                isMyTurn: ps.isMyTurn,
                mySlot: ps.mySlot,
                isHoverValid: ps.isHoverValid,
                hoverCapture: !!ps.hoverCapture
            });
            if (ps.hoverCapture) {
                d.hoverCaptureRing(dom.ctx, ps.hoverRow, ps.hoverCol, ps.PADDING, cellSize, stoneRadius, {
                    tryPlayMode: ps.tryPlayMode,
                    gameOver: ps.gameOver,
                    isMyTurn: ps.isMyTurn,
                    isHoverValid: ps.isHoverValid,
                    hoverCapture: !!ps.hoverCapture
                });
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(dom.ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
        }

        function updateTurn() {
            if (ps.replayMode) {
                drawBoard();
                return;
            }
            const liveTotal = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
            const browsingLive = ps.liveReplayBoards.length > 0 && ps.liveViewStep < liveTotal;
            if (browsingLive) {
                if (ps.liveViewStep === 0) {
                    dom.turnDisplay.innerText = '初始局面';
                } else {
                    const emoji = ps.liveReplayStepPlayers[ps.liveViewStep] === 1 ? '⚫' : '⚪';
                    dom.turnDisplay.innerText = `${emoji} 第${ps.liveViewStep}手`;
                }
                ps.isMyTurn = false;
                drawBoard();
                return;
            }
            if (ps.gameOver) {
                dom.turnDisplay.innerText = '对局结束';
                if (ps.winner === 'black') dom.scoreTitle.innerText = '黑胜';
                else if (ps.winner === 'white') dom.scoreTitle.innerText = '白胜';
                else if (ps.winner === 'draw') dom.scoreTitle.innerText = '和棋';
                else dom.scoreTitle.innerText = '　';
                ps.isMyTurn = false;
                drawBoard();
                return;
            }
            const total = ps.liveReplayBoards.length > 0 ? ps.liveReplayBoards.length - 1 : 0;
            if (ps.liveReplayBoards.length === 0) {
                const emptyBoard = !ps.board.some(row => row.some(v => v === 1 || v === 2));
                dom.turnDisplay.innerText = emptyBoard ? '初始局面' : `${ps.currentPlayer === 1 ? '⚫' : '⚪'} 第${ps.numberOfHands}手`;
            } else if (total === 0) {
                dom.turnDisplay.innerText = '初始局面';
            } else {
                const p = ps.liveReplayStepPlayers[total];
                dom.turnDisplay.innerText = `${p === 1 ? '⚫' : '⚪'} 第${total}手`;
            }
            ps.isMyTurn = (ps.mySlot !== null) && ((ps.mySlot === 'black' && ps.currentPlayer === 1) || (ps.mySlot === 'white' && ps.currentPlayer === 2));
            drawBoard();
        }

        function showEstimate() {
            if (!ps.showEstimateActive) {
                clearEstimate();
                return;
            }
            const r = C().computeWeiqiEstimateCaches(
                ps.board, removeDeadAndDying, assignTerritoryWithRange, computeScore, ps.KOMI
            );
            ps.cachedLiveBoard = r.cachedLiveBoard;
            ps.cachedTerritory = r.cachedTerritory;
            C().fillWeiqiEstimatePanel(dom.scoreTitle, dom.scoreBoard, dom.leadInfo, r.blackTotal, r.whiteTotal, r.lead);
            drawBoard();
        }

        function clearEstimate() {
            ps.cachedLiveBoard = null;
            ps.cachedTerritory = null;
            C().clearWeiqiEstimatePanel(dom.scoreTitle, dom.scoreBoard, dom.leadInfo);
            drawBoard();
        }

        function downloadRecord(data) {
            C().downloadWeiqiJsonRecord(data, opts.recordDownloadPrefix);
        }

        function showScoreConfirm(lead) {
            C().fillScoreConfirmText(dom.scoreConfirmText, lead);
            dom.scoreConfirmPanel.style.display = 'block';
        }

        function hideScoreConfirm() {
            dom.scoreConfirmPanel.style.display = 'none';
        }

        function enterReplayMode(data) {
            if (opts.enterReplayMode) {
                opts.enterReplayMode(data);
                return;
            }
            const built = buildReplayFromImportData(
                data, tryPlaceStone, deepCopyBoard, () => initBoardArray(ps.BOARD_SIZE)
            );
            ps.replayBoards = built.replayBoards;
            ps.replayMarkers = built.replayMarkers;
            ps.replayStepPlayers = built.replayStepPlayers;
            ps.replayTotalSteps = built.replayTotalSteps;
            ps.replayMode = true;
            const slider = document.getElementById('replaySlider');
            slider.max = ps.replayTotalSteps;
            setReplayStep(ps.replayTotalSteps);
            updateReplayUI();
        }

        function exitReplayMode() {
            if (opts.exitReplayMode) {
                opts.exitReplayMode();
                return;
            }
            clearMobileMovePreview();
            ps.tryPlayMode = false;
            ps.tryPlayBoards = [];
            ps.tryPlayMarkers = [];
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            ps.replayMode = false;
            ps.replayBoards = [];
            ps.replayMarkers = [];
            ps.replayStepPlayers = [];
            ps.replayStep = 0;
            ps.replayTotalSteps = 0;
            if ('tryPlayCaptureStep' in ps) ps.tryPlayCaptureStep = 0;
            updateReplayUI();
        }

        function setReplayStep(step) {
            if (opts.setReplayStep) {
                opts.setReplayStep(step);
                return;
            }
            clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > ps.replayTotalSteps) step = ps.replayTotalSteps;
            ps.replayStep = step;
            ps.board = deepCopyBoard(ps.replayBoards[step]);
            ps.lastMoveMarkers = ps.replayMarkers[step].map(m => ({ ...m }));

            document.getElementById('replaySlider').value = step;
            document.getElementById('replayStepDisplay').innerText = `${step} / ${ps.replayTotalSteps}`;

            if (step === 0) {
                dom.turnDisplay.innerText = '初始局面';
            } else {
                const emoji = ps.replayStepPlayers[step] === 1 ? '⚫' : '⚪';
                dom.turnDisplay.innerText = `${emoji} 第${step}手`;
            }
            ps.isMyTurn = false;

            if (ps.showEstimateActive) showEstimate();
            else drawBoard();
        }

        function updateReplayUI() {
            if (opts.updateReplayUI) {
                opts.updateReplayUI();
                return;
            }
            const gameButtonIds = opts.replayGameButtonIds || ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn'];
            const replayPanel = document.getElementById('replayPanel');
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            if (ps.replayMode) {
                for (const id of gameButtonIds) {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                }
                replayPanel.style.display = '';
                tryPlayBtn.style.display = '';
                tryPlayBtn.innerText = ps.tryPlayMode ? '试下结束' : '试下';
            } else {
                for (const id of gameButtonIds) {
                    const el = document.getElementById(id);
                    if (el) el.style.display = '';
                }
                replayPanel.style.display = '';
                tryPlayBtn.style.display = 'none';
                tryPlayBtn.innerText = '试下';
            }
        }

        function enterTryPlay() {
            if (opts.enterTryPlay) {
                opts.enterTryPlay();
                return;
            }
            clearMobileMovePreview();
            ps.tryPlayMode = true;
            ps.tryPlayBaseStep = ps.replayStep;
            ps.tryPlayBoards = [deepCopyBoard(ps.board)];
            ps.tryPlayMarkers = [ps.lastMoveMarkers.map(m => ({ ...m }))];

            if (ps.replayStep === 0) {
                ps.tryPlayCurrentPlayer = 1;
            } else {
                ps.tryPlayCurrentPlayer = ps.replayStepPlayers[ps.replayStep] === 1 ? 2 : 1;
            }
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            if ('tryPlayCaptureStep' in ps) ps.tryPlayCaptureStep = 0;

            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            updateTryPlayDisplay();
            updateReplayUI();
        }

        function exitTryPlay() {
            if (opts.exitTryPlay) {
                opts.exitTryPlay();
                return;
            }
            clearMobileMovePreview();
            ps.tryPlayMode = false;
            ps.tryPlayBoards = [];
            ps.tryPlayMarkers = [];
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            if ('tryPlayCaptureStep' in ps) ps.tryPlayCaptureStep = 0;

            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = ps.replayTotalSteps;
            setReplayStep(ps.tryPlayBaseStep);
            updateReplayUI();
        }

        function tryPlayMove(row, col) {
            if (opts.tryPlayMove) return opts.tryPlayMove(row, col);
            if (ps.board[row][col] !== 0) return false;
            const playerVal = ps.tryPlayCurrentPlayer;
            const newBoard = tryPlaceStone(ps.board, row, col, playerVal);
            if (!newBoard) return false;

            if (ps.tryPlayStep < ps.tryPlayTotalSteps) {
                ps.tryPlayBoards.length = ps.tryPlayStep + 1;
                ps.tryPlayMarkers.length = ps.tryPlayStep + 1;
            }

            ps.tryPlayBoards.push(deepCopyBoard(newBoard));
            ps.tryPlayMarkers.push([{ row, col, color: playerVal }]);
            ps.tryPlayTotalSteps = ps.tryPlayBoards.length - 1;
            ps.tryPlayStep = ps.tryPlayTotalSteps;
            ps.tryPlayCurrentPlayer = 3 - ps.tryPlayCurrentPlayer;

            ps.board = deepCopyBoard(newBoard);
            ps.lastMoveMarkers = [{ row, col, color: playerVal }];

            const slider = document.getElementById('replaySlider');
            slider.max = ps.tryPlayTotalSteps;
            slider.value = ps.tryPlayStep;
            updateTryPlayDisplay();
            if (ps.showEstimateActive) showEstimate();
            else drawBoard();
            return true;
        }

        function setTryPlayStep(step) {
            if (opts.setTryPlayStep) {
                opts.setTryPlayStep(step);
                return;
            }
            clearMobileMovePreview();
            if (step < 0) step = 0;
            if (step > ps.tryPlayTotalSteps) step = ps.tryPlayTotalSteps;
            ps.tryPlayStep = step;
            ps.board = deepCopyBoard(ps.tryPlayBoards[step]);
            ps.lastMoveMarkers = ps.tryPlayMarkers[step].map(m => ({ ...m }));

            const basePlayer = ps.tryPlayBaseStep === 0 ? 1 : (3 - ps.replayStepPlayers[ps.tryPlayBaseStep]);
            ps.tryPlayCurrentPlayer = step % 2 === 0 ? basePlayer : (3 - basePlayer);

            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplay();
            if (ps.showEstimateActive) showEstimate();
            else drawBoard();
        }

        function updateTryPlayDisplay() {
            if (opts.updateTryPlayDisplay) {
                opts.updateTryPlayDisplay();
                return;
            }
            const stepDisplay = document.getElementById('replayStepDisplay');
            if (ps.tryPlayMode) {
                stepDisplay.innerText = `试下 ${ps.tryPlayStep} / ${ps.tryPlayTotalSteps}`;
                const emoji = ps.tryPlayCurrentPlayer === 1 ? '⚫' : '⚪';
                dom.turnDisplay.innerText = `${emoji} 试下`;
            }
        }

        function rebuildLiveReplayBoard(moveCoords) {
            if (opts.rebuildLiveReplayFromMoveCoords) {
                opts.rebuildLiveReplayFromMoveCoords(moveCoords);
                return;
            }
            const o = R().rebuildLiveReplayFromMoveCoords(
                moveCoords, tryPlaceStone, deepCopyBoard, () => initBoardArray(ps.BOARD_SIZE)
            );
            ps.liveReplayBoards = o.liveReplayBoards;
            ps.liveReplayMarkers = o.liveReplayMarkers;
            ps.liveReplayStepPlayers = o.liveReplayStepPlayers;
        }

        function applyLiveViewBoard() {
            if (!ps.liveReplayBoards.length) {
                ps.board = initBoardArray(ps.BOARD_SIZE);
                ps.lastMoveMarkers = [];
                return;
            }
            if (ps.liveViewStep < 0) ps.liveViewStep = 0;
            if (ps.liveViewStep >= ps.liveReplayBoards.length) ps.liveViewStep = ps.liveReplayBoards.length - 1;
            ps.board = deepCopyBoard(ps.liveReplayBoards[ps.liveViewStep]);
            ps.lastMoveMarkers = ps.liveReplayMarkers[ps.liveViewStep].map(m => ({ ...m }));
        }

        function updateLiveReplayPanelUI() {
            if (ps.replayMode) return;
            const total = Math.max(0, ps.liveReplayBoards.length - 1);
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = total;
            slider.value = ps.liveViewStep;
            document.getElementById('replayStepDisplay').innerText = `${ps.liveViewStep} / ${total}`;
        }

        function setLiveViewStep(step) {
            clearMobileMovePreview();
            if (ps.replayMode) return;
            const total = Math.max(0, ps.liveReplayBoards.length - 1);
            if (step < 0) step = 0;
            if (step > total) step = total;
            ps.liveViewStep = step;
            ps.liveFollowLatest = step >= total;
            applyLiveViewBoard();
            updateLiveReplayPanelUI();
            if (ps.showEstimateActive) showEstimate();
            else updateTurn();
        }

        /** 重连时 setTimeout 会无参调用，故首次传入后缓存 handler */
        let cachedRoomMessageHandler = null;
        function connectWebSocket(onMessage) {
            if (onMessage) cachedRoomMessageHandler = onMessage;
            ps.ws = C().connectWeiqiRoomWebSocket({
                gameType: opts.gameType,
                roomId: opts.roomId,
                roomPassword: opts.roomPassword,
                onMessage: m => {
                    if (cachedRoomMessageHandler) cachedRoomMessageHandler(m);
                },
                clearReconnectTimer: () => {
                    if (ps.reconnectTimer) {
                        clearTimeout(ps.reconnectTimer);
                        ps.reconnectTimer = null;
                    }
                },
                getReconnectTimer: () => ps.reconnectTimer,
                setReconnectTimer: t => {
                    ps.reconnectTimer = t;
                },
                colorStatus: dom.colorStatus,
                connectWebSocket
            });
        }

        function initBoardArray(size) {
            return C().initBoardArray(size);
        }

        function updateBoardGeometry() {
            const g = C().computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            drawBoard();
            if (dom.komiInfo) {
                if (typeof opts.komiInfoText === 'function')
                    dom.komiInfo.innerText = opts.komiInfoText(ps);
                else if (opts.komiInfoText != null)
                    dom.komiInfo.innerText = opts.komiInfoText;
                else
                    dom.komiInfo.innerText = `黑贴白${ps.KOMI}点`;
            }
        }

        function syncState(state) {
            if (opts.syncState) {
                opts.syncState(state);
                return;
            }
            // 勿在每次 gameState 广播时无条件清除触摸预览：桌面端下一帧 mousemove 会重画红圈，
            // 手机端没有 hover，重复同步会导致两步落子/提子的第一次预览立刻消失。
            const incomingMoveLen = (state.moveCoords && state.moveCoords.length) || 0;
            const prevSyncedLen = ps._syncMoveCoordsLen;
            const incomingNH = state.numberOfHands || 1;
            const incomingGO = state.gameOver || false;
            const sizeWillChange = !!(state.boardSize && state.boardSize !== ps.BOARD_SIZE);
            const handsChanged = incomingNH !== ps.numberOfHands;
            const gameOverChanged = incomingGO !== ps.gameOver;
            const playerChanged = state.currentPlayer !== undefined && state.currentPlayer !== ps.currentPlayer;
            const moveListChanged = incomingMoveLen !== (prevSyncedLen !== undefined ? prevSyncedLen : -1);
            if (sizeWillChange || handsChanged || gameOverChanged || playerChanged || moveListChanged)
                clearMobileMovePreview();
            if (state.boardSize && state.boardSize !== ps.BOARD_SIZE) {
                ps.BOARD_SIZE = state.boardSize;
                if (state.komi != null && Number.isFinite(state.komi)) ps.KOMI = state.komi;
                ps.board = initBoardArray(ps.BOARD_SIZE);
                updateBoardGeometry();
                const boardSizeSelect = document.getElementById('boardSizeSelect');
                if (boardSizeSelect) 
                    boardSizeSelect.value = ps.BOARD_SIZE;
            } else if (state.komi != null && Number.isFinite(state.komi) && state.komi !== ps.KOMI) {
                ps.KOMI = state.komi;
                if (dom.komiInfo) updateBoardGeometry();
            }
            ps.numberOfHands = state.numberOfHands || 1;
            ps.currentPlayer = state.currentPlayer;
            ps.gameOver = state.gameOver || false;
            ps.winner = state.winner || null;
            if (state.moveCoords) {
                ps.moveLog = state.moveCoords.map(m =>
                    (m.type === 'move') ? { row: m.row, col: m.col } : null
                );
            }
            if (state.slots)
                ps.slots = state.slots;

            if (!ps.replayMode) {
                const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                rebuildLiveReplayBoard(state.moveCoords || []);
                const newTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                if (newTotal === 0) {
                    ps.liveViewStep = 0;
                    ps.liveFollowLatest = true;
                } else if (wasAtEnd) {
                    ps.liveViewStep = newTotal;
                    ps.liveFollowLatest = true;
                } else {
                    ps.liveViewStep = Math.min(ps.liveViewStep, newTotal);
                    if (ps.liveViewStep === newTotal)
                        ps.liveFollowLatest = true;
                }
                applyLiveViewBoard();
                updateLiveReplayPanelUI();
            } else {
                ps.board = state.board;
                ps.lastMoveMarkers = state.lastMoveMarkers || [];
            }

            const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
            const hasPlayer = ps.slots.black || ps.slots.white;
            const boardSizeSelect = document.getElementById('boardSizeSelect');
            if (boardSizeSelect && ps.liveViewStep === 0 && !hasPlayer && !ps.gameOver && ps.mySlot === null)
                boardSizeSelect.style.display = 'inline-block';
            else
                boardSizeSelect.style.display = 'none';

            if (ps.showEstimateActive) {
                ps.cachedLiveBoard = removeDeadAndDying(ps.board);
                ps.cachedTerritory = assignTerritoryWithRange(ps.cachedLiveBoard);
                showEstimate();
            } else {
                updateTurn();
            }
            updateReplayUI();
            ps._syncMoveCoordsLen = incomingMoveLen;
        }

        function commitMove(row, col) {
            if (ps.gameOver) return false;
            if (!ps.isMyTurn) return false;
            if (ps.board[row][col] !== 0) return false;
            ps.ws.send(JSON.stringify({ type: 'move', row, col }));
            return true;
        }

        function getClosestIntersection(x, y) {
            return C().getClosestIntersection(x, y, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
        }

        function canvasCoordsFromClient(clientX, clientY) {
            return C().canvasCoordsFromClient(clientX, clientY, dom.canvas, C().DEFAULT_CANVAS_SIZE);
        }

        function getSelectedBoardMark() {
            if (!dom.boardMarkSelect) return { clear: false, ch: '?' };
            const v = dom.boardMarkSelect.value;
            if (v === '') return { clear: true, ch: '' };
            return { clear: false, ch: v };
        }

        function applyUserBoardMark(row, col) {
            if (row < 0 || col < 0 || row >= ps.BOARD_SIZE || col >= ps.BOARD_SIZE) return;
            if (ps.board[row][col] !== 0) return;
            const { clear, ch } = getSelectedBoardMark();
            const key = row + ',' + col;
            const existing = ps.userBoardMarks[key];
            if (clear) {
                if (existing !== undefined) {
                    delete ps.userBoardMarks[key];
                    drawBoard();
                }
                return;
            }
            if (existing === undefined) {
                ps.userBoardMarks[key] = ch;
            } else if (existing !== ch) {
                ps.userBoardMarks[key] = ch;
            } else {
                delete ps.userBoardMarks[key];
            }
            drawBoard();
        }

        return {
            mobileTwoStepPlacing,
            clearMobileMovePreview,
            deepCopyBoard,
            countGroupLiberties,
            removeGroup,
            tryPlaceStone,
            removeDeadAndDying,
            assignTerritoryWithRange,
            computeScore,
            computeScoreFromBoard,
            computeLead,
            isUserBoardMarkVisibleAt,
            computeStoneNumbers,
            drawBoard,
            updateTurn,
            showEstimate,
            clearEstimate,
            downloadRecord,
            showScoreConfirm,
            hideScoreConfirm,
            enterReplayMode,
            exitReplayMode,
            setReplayStep,
            updateReplayUI,
            enterTryPlay,
            exitTryPlay,
            tryPlayMove,
            setTryPlayStep,
            updateTryPlayDisplay,
            rebuildLiveReplayFromMoveCoords: rebuildLiveReplayBoard,
            applyLiveViewBoard,
            updateLiveReplayPanelUI,
            setLiveViewStep,
            connectWebSocket,
            initBoardArray,
            updateBoardGeometry,
            syncState,
            commitMove,
            getClosestIntersection,
            canvasCoordsFromClient,
            getSelectedBoardMark,
            applyUserBoardMark
        };
    }

    function countGroupLiberties(board, row, col, boardSize) {
        const color = board[row][col];
        if (color === 0) return 0;
        const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
        const queue = [[row, col]];
        visited[row][col] = true;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const liberties = new Set();
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                if (board[nr][nc] === 0) {
                    liberties.add(nr + ',' + nc);
                } else if (board[nr][nc] === color && !visited[nr][nc]) {
                    visited[nr][nc] = true;
                    queue.push([nr, nc]);
                }
            }
        }
        return liberties.size;
    }

    function hasLiberty(board, row, col, boardSize) {
        return countGroupLiberties(board, row, col, boardSize) > 0;
    }

    function removeGroup(board, row, col, color, boardSize) {
        const queue = [[row, col]];
        board[row][col] = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (queue.length) {
            const [r, c] = queue.shift();
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === color) {
                    board[nr][nc] = 0;
                    queue.push([nr, nc]);
                }
            }
        }
    }

    function tryPlaceStoneNLiberty(boardBefore, row, col, playerVal, boardSize, copyBoardFn, minLib = 1) {
        if (boardBefore[row][col] !== 0) return null;
        const newBoard = copyBoardFn(boardBefore);
        newBoard[row][col] = playerVal;

        const enemyColor = 3 - playerVal;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const checkedEnemy = new Set();

        for (const [dr, dc] of dirs) {
            const nr = row + dr;
            const nc = col + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && newBoard[nr][nc] === enemyColor) {
                const key = `${nr},${nc}`;
                if (!checkedEnemy.has(key)) {
                    checkedEnemy.add(key);
                    if (countGroupLiberties(newBoard, nr, nc, boardSize) < minLib) {
                        removeGroup(newBoard, nr, nc, enemyColor, boardSize);
                    }
                }
            }
        }

        if (countGroupLiberties(newBoard, row, col, boardSize) < minLib) {
            removeGroup(newBoard, row, col, playerVal, boardSize);
        }

        return newBoard;
    }

    function isLibertySurroundedByOpponent(board, libertyRow, libertyCol, opponentColor, boardSize) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
            const nr = libertyRow + dr;
            const nc = libertyCol + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && board[nr][nc] === opponentColor) return true;
        }
        return false;
    }

    function removeDeadAndDying(srcBoard, boardSize, copyBoardFn, maxWeakLiberties = 2) {
        let boardCopy = copyBoardFn(srcBoard);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [dr, dc] of dirs) {
                                const nr = rr + dr;
                                const nc = cc + dc;
                                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                                if (boardCopy[nr][nc] === 0) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= maxWeakLiberties) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, boardSize)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    }

    function assignTerritoryWithRange(liveBoard, boardSize, options = {}) {
        const isPassable = options.isPassable ?? ((v) => v !== -1);
        const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] !== 0) continue;
                const maxDist = (r <= 1 || r >= boardSize - 2 || c <= 1 || c >= boardSize - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [dr, dc] of dirs) {
                        const nr = cr + dr;
                        const nc = cc + dc;
                        if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && isPassable(liveBoard[nr][nc]) && dist[nr][nc] === Infinity) {
                            dist[nr][nc] = d + 1;
                            queue.push([nr, nc]);
                        }
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    }

    function computeScore(liveBoard, territory, boardSize) {
        let blackStones = 0;
        let whiteStones = 0;
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let publicTerritory = 0;
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }

    function removeDeadAndDyingWithHoles(srcBoard, boardSize, copyBoardFn, isHole, maxWeakLiberties = 2) {
        let boardCopy = copyBoardFn(srcBoard);
        const isLibertyCell = (r, c) =>
            r >= 0 && r < boardSize && c >= 0 && c < boardSize &&
            boardCopy[r][c] === 0 && !isHole(r, c);
        let changed = true;
        while (changed) {
            changed = false;
            const visited = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = boardCopy[r][c];
                    if ((val === 1 || val === 2) && !visited[r][c]) {
                        const color = val;
                        const queue = [[r, c]];
                        visited[r][c] = true;
                        const stones = [[r, c]];
                        const liberties = new Set();
                        let idx = 0;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        while (idx < queue.length) {
                            const [rr, cc] = queue[idx++];
                            for (const [dr, dc] of dirs) {
                                const nr = rr + dr;
                                const nc = cc + dc;
                                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                                if (isLibertyCell(nr, nc)) liberties.add(nr + ',' + nc);
                                else if (boardCopy[nr][nc] === color && !visited[nr][nc]) {
                                    visited[nr][nc] = true;
                                    queue.push([nr, nc]);
                                    stones.push([nr, nc]);
                                }
                            }
                        }
                        if (liberties.size === 0) {
                            for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                            changed = true;
                            continue;
                        }
                        if (liberties.size <= maxWeakLiberties) {
                            let allControlled = true;
                            for (const lib of liberties) {
                                const [lr, lc] = lib.split(',').map(Number);
                                if (!isLibertySurroundedByOpponent(boardCopy, lr, lc, 3 - color, boardSize)) {
                                    allControlled = false;
                                    break;
                                }
                            }
                            if (allControlled) {
                                for (const [rr, cc] of stones) boardCopy[rr][cc] = 0;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        return boardCopy;
    }

    function assignTerritoryWithRangeWithHoles(liveBoard, boardSize, isHole) {
        const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] !== 0 || isHole(r, c)) continue;
                const maxDist = (r <= 1 || r >= boardSize - 2 || c <= 1 || c >= boardSize - 2) ? 5 : 4;
                let blackMin = Infinity;
                let whiteMin = Infinity;
                const dist = Array(boardSize).fill().map(() => Array(boardSize).fill(Infinity));
                dist[r][c] = 0;
                const queue = [[r, c]];
                const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let front = 0;
                while (front < queue.length) {
                    const [cr, cc] = queue[front++];
                    const d = dist[cr][cc];
                    if (d > maxDist) continue;
                    if (liveBoard[cr][cc] === 1 && d < blackMin) blackMin = d;
                    if (liveBoard[cr][cc] === 2 && d < whiteMin) whiteMin = d;
                    for (const [dr, dc] of dirs) {
                        const nr = cr + dr;
                        const nc = cc + dc;
                        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                        if (isHole(nr, nc)) continue;
                        if (dist[nr][nc] !== Infinity) continue;
                        dist[nr][nc] = d + 1;
                        queue.push([nr, nc]);
                    }
                }
                if (blackMin <= maxDist && whiteMin <= maxDist) {
                    if (blackMin < whiteMin) territory[r][c] = 1;
                    else if (whiteMin < blackMin) territory[r][c] = 2;
                    else territory[r][c] = 3;
                } else if (blackMin <= maxDist) territory[r][c] = 1;
                else if (whiteMin <= maxDist) territory[r][c] = 2;
                else territory[r][c] = 3;
            }
        }
        return territory;
    }

    function computeScoreWithHoles(liveBoard, territory, boardSize, isHole) {
        let blackStones = 0;
        let whiteStones = 0;
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let publicTerritory = 0;
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (liveBoard[r][c] === 1) blackStones++;
                else if (liveBoard[r][c] === 2) whiteStones++;
                else if (liveBoard[r][c] === 0 && !isHole(r, c)) {
                    if (territory[r][c] === 1) blackTerritory++;
                    else if (territory[r][c] === 2) whiteTerritory++;
                    else if (territory[r][c] === 3) publicTerritory++;
                }
            }
        }
        const blackTotal = blackStones + blackTerritory + publicTerritory / 2;
        const whiteTotal = whiteStones + whiteTerritory + publicTerritory / 2;
        return { blackTotal, whiteTotal };
    }

    function applyInitialPositionCompact(board, boardSize, initialPosition) {
        if (!initialPosition || !Array.isArray(initialPosition)) return;
        for (const s of initialPosition) {
            if (typeof s !== 'string' || s.length < 3) continue;
            const prefix = s[0];
            if (prefix !== 'B' && prefix !== 'W' && prefix !== 'N' && prefix !== 'H') continue;
            const comma = s.indexOf(',');
            if (comma <= 1) continue;
            const r = parseInt(s.slice(1, comma), 10);
            const c = parseInt(s.slice(comma + 1), 10);
            if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
            if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
            if (prefix === 'B') board[r][c] = 1;
            else if (prefix === 'W') board[r][c] = 2;
            else if (prefix === 'N') board[r][c] = 3;
            else if (prefix === 'H') board[r][c] = -1;
        }
    }

    function buildReplayFromImportData(data, tryPlaceStone, deepCopyBoard, createEmptyBoard) {
        let curBoard = createEmptyBoard();
        const boardSize = curBoard.length;
        if (data.initialPosition && Array.isArray(data.initialPosition)) {
            applyInitialPositionCompact(curBoard, boardSize, data.initialPosition);
        }
        const replayBoards = [deepCopyBoard(curBoard)];
        const replayMarkers = [[]];
        const replayStepPlayers = [0];

        for (const move of (data.moves || [])) {
            const playerVal = move.player === 'black' ? 1 : 2;
            replayStepPlayers.push(playerVal);
            if (move.type === 'move') {
                const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                if (newBoard) curBoard = newBoard;
                replayBoards.push(deepCopyBoard(curBoard));
                replayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
            } else if (move.type === 'pass') {
                replayBoards.push(deepCopyBoard(curBoard));
                replayMarkers.push([]);
            }
        }

        return {
            replayBoards,
            replayMarkers,
            replayStepPlayers,
            replayTotalSteps: replayBoards.length - 1
        };
    }

    function rebuildLiveReplayFromMoveCoords(moveCoords, tryPlaceStone, deepCopyBoard, createEmptyBoard) {
        let curBoard = createEmptyBoard();
        const liveReplayBoards = [deepCopyBoard(curBoard)];
        const liveReplayMarkers = [[]];
        const liveReplayStepPlayers = [0];
        for (const move of (moveCoords || [])) {
            const playerVal = move.player === 'black' ? 1 : 2;
            liveReplayStepPlayers.push(playerVal);
            if (move.type === 'move') {
                const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                if (newBoard) curBoard = newBoard;
                liveReplayBoards.push(deepCopyBoard(curBoard));
                liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
            } else if (move.type === 'pass') {
                liveReplayBoards.push(deepCopyBoard(curBoard));
                liveReplayMarkers.push([]);
            }
        }
        return { liveReplayBoards, liveReplayMarkers, liveReplayStepPlayers };
    }

    /** 洞围棋式：单格「坑」底与邻格阴影（isHole 为 (r,c)=>boolean） */
    function holeDrawPit(ctx, row, col, boardSize, padding, cellSize, isHole) {
        const innerLeft = padding + Math.max(col - 0.5, 0) * cellSize;
        const innerTop = padding + Math.max(row - 0.5, 0) * cellSize;
        const innerRight = padding + Math.min(col + 0.5, boardSize - 1) * cellSize;
        const innerBottom = padding + Math.min(row + 0.5, boardSize - 1) * cellSize;
        const innerWidth = innerRight - innerLeft;
        const innerHeight = innerBottom - innerTop;

        ctx.fillStyle = '#d9c8ac';
        ctx.fillRect(innerLeft, innerTop, innerWidth, innerHeight);

        const shadowWidth = Math.max(4, cellSize * 0.2);
        if (!isHole(row - 1, col)) {
            const shadowTop = padding + Math.max(row - 0.5, 0) * cellSize;
            const gradTop = ctx.createLinearGradient(innerLeft, shadowTop, innerLeft, shadowTop + shadowWidth);
            gradTop.addColorStop(0, 'rgba(0,0,0,0.45)');
            gradTop.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradTop;
            ctx.fillRect(innerLeft, shadowTop, innerWidth, shadowWidth);
        }
        if (!isHole(row, col - 1)) {
            const shadowLeft = padding + Math.max(col - 0.5, 0) * cellSize;
            const gradLeft = ctx.createLinearGradient(shadowLeft, innerTop, shadowLeft + shadowWidth, innerTop);
            gradLeft.addColorStop(0, 'rgba(0,0,0,0.3)');
            gradLeft.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradLeft;
            ctx.fillRect(shadowLeft, innerTop, shadowWidth, innerHeight);
        }
        if (!isHole(row, col + 1)) {
            const shadowRight = padding + Math.min(col + 0.5, boardSize - 1) * cellSize;
            const gradRight = ctx.createLinearGradient(shadowRight - shadowWidth, innerTop, shadowRight, innerTop);
            gradRight.addColorStop(0, 'rgba(0,0,0,0)');
            gradRight.addColorStop(1, 'rgba(0,0,0,0.3)');
            ctx.fillStyle = gradRight;
            ctx.fillRect(shadowRight - shadowWidth, innerTop, shadowWidth, innerHeight);
        }
    }

    /** 洞围棋「方块」显示模式下的红色障碍格 */
    function holeDrawRedBlock(ctx, row, col, padding, cellSize) {
        const x = padding + col * cellSize;
        const y = padding + row * cellSize;
        const size = cellSize * 0.8;
        const halfSize = size / 2;
        const left = x - halfSize;
        const top = y - halfSize;

        ctx.save();
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;

        const grad = ctx.createLinearGradient(left, top, left + size, top + size);
        grad.addColorStop(0, '#c02020');
        grad.addColorStop(0.5, '#a00000');
        grad.addColorStop(1, '#880000');
        ctx.fillStyle = grad;
        ctx.fillRect(left, top, size, size);

        const highlightX = left + size * 0.35;
        const highlightY = top + size * 0.35;
        const radius = size * 0.6;
        const radialGrad = ctx.createRadialGradient(highlightX, highlightY, 0, highlightX, highlightY, radius);
        radialGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
        radialGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        radialGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = radialGrad;
        ctx.beginPath();
        ctx.arc(highlightX, highlightY, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    const stoneAccent = {
        BLACK_ORANGE: '#ff9900',
        WHITE_BLUE: '#0099ff',
        drawRing(ctx, cx, cy, radius, strokeColor, lineWidth) {
            ctx.save();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth != null ? lineWidth : 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.restore();
        },
        /** 易位围棋：上一手方棋子描边（黑橙 / 白蓝） */
        drawLastMoveSideRing(ctx, cx, cy, cellSize, lastMovePlayerIsBlack) {
            const strokeColor = lastMovePlayerIsBlack ? stoneAccent.BLACK_ORANGE : stoneAccent.WHITE_BLUE;
            stoneAccent.drawRing(ctx, cx, cy, cellSize * 0.44, strokeColor, 2);
        }
    };

    const stoneDanger = {
        DEFAULT_RED: '#cc2222',
        drawRing(ctx, cx, cy, radius, color, lineWidth) {
            ctx.save();
            ctx.strokeStyle = color || stoneDanger.DEFAULT_RED;
            ctx.lineWidth = lineWidth != null ? lineWidth : 3;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.restore();
        }
    };

    const fogBlend = {
        blendWood(woodRgb, fogAlpha) {
            const t = 1 - fogAlpha;
            const w = x => Math.round(x * t);
            return `rgb(${w(woodRgb[0])},${w(woodRgb[1])},${w(woodRgb[2])})`;
        },
        blendLine(lineRgb, fogAlpha) {
            const t = 1 - fogAlpha;
            const w = x => Math.round(x * t);
            return `rgb(${w(lineRgb[0])},${w(lineRgb[1])},${w(lineRgb[2])})`;
        },
        fillCellFog(ctx, x, y, cellSize, fogAlpha, woodRgb) {
            const rgb = fogBlend.blendWood(woodRgb || [217, 200, 172], fogAlpha);
            ctx.fillStyle = rgb;
            ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
        }
    };

    function invisibleDrawStone(ctx, cx, cy, radius, isBlack, alpha) {
        const a = alpha != null ? alpha : 0.45;
        ctx.save();
        ctx.globalAlpha = a;
        const grad = ctx.createRadialGradient(cx - 3, cy - 3, radius * 0.2, cx, cy, radius * 1.2);
        if (isBlack) {
            grad.addColorStop(0, '#444');
            grad.addColorStop(0.6, '#222');
            grad.addColorStop(1, '#111');
        } else {
            grad.addColorStop(0, '#fff');
            grad.addColorStop(0.5, '#eee');
            grad.addColorStop(1, '#aaa');
        }
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
    }

    const cellWeight = {
        /**
         * 权重围棋 / 三权重：棋子中心在格心，外圈权重数字。
         * @param {CanvasRenderingContext2D} ctx
         * @param {number} cx 格心 x
         * @param {number} cy 格心 y
         * @param {number} cellSize
         * @param {string|number} text
         * @param {string} fillStyle
         */
        drawWeightLabel(ctx, cx, cy, cellSize, text, fillStyle) {
            ctx.save();
            ctx.font = `bold ${Math.floor(cellSize * 0.35)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = fillStyle || '#2c1f15';
            ctx.fillText(String(text), cx, cy);
            ctx.restore();
        }
    };

    function neutralDrawSmallMarker(ctx, cx, cy, radius) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#888';
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    global.QiWeiqiSquarePageRuntime = {
        create,
        countGroupLiberties, 
        hasLiberty, 
        removeGroup, 
        tryPlaceStoneNLiberty, 
        isLibertySurroundedByOpponent, 
        removeDeadAndDying, 
        assignTerritoryWithRange, 
        computeScore, 
        removeDeadAndDyingWithHoles, 
        assignTerritoryWithRangeWithHoles, 
        computeScoreWithHoles, 
        rebuildLiveReplayFromMoveCoords, 
        buildReplayFromImportData, 
        applyInitialPositionCompact,
        holeDrawPit,
        holeDrawRedBlock,
        stoneAccent,
        stoneDanger,
        fogBlend,
        invisibleDrawStone,
        cellWeight,
        neutralDrawSmallMarker,
    };
})(typeof window !== 'undefined' ? window : global);
