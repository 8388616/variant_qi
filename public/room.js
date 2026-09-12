/**
 * 统一房间页脚本
 * 1. 消息框（房间页样式）
 * 2. 房间 WebSocket / 消息绑定 / 限时（QiBoardRoomClient）
 * 3. 方格棋盘绘制与几何（QiSquareWeiqiCanvas）
 * 4. 方格页运行时（QiWeiqiSquarePageRuntime）
 * 5. 房间壳 boot（棋种配置在各 *-room.js 的 shell 字段）
 */

/* ========== 1. 消息框 ========== */
(function () {
    'use strict';

    const DEFAULTS = {
        alertTitle: '提示',
        confirmTitle: '确认',
        okText: '确认',
        cancelText: '取消',
        yesText: '是',
        noText: '否'
    };
    const queue = [];
    let active = false;
    let ui = null;

    function normalize(type, message, options) {
        const o = options || {};
        const useYesNo = o.buttons === 'yesNo' || o.choice === 'yesNo';
        return {
            type: type === 'confirm' ? 'confirm' : 'alert',
            title: o.title || (type === 'confirm' ? DEFAULTS.confirmTitle : DEFAULTS.alertTitle),
            message: message == null ? '' : String(message),
            okText: o.okText || o.confirmText || (useYesNo ? DEFAULTS.yesText : DEFAULTS.okText),
            cancelText: o.cancelText || o.noText || (useYesNo ? DEFAULTS.noText : DEFAULTS.cancelText)
        };
    }

    function ensureUi() {
        if (ui) return ui;
        document.querySelectorAll('.qi-message-modal').forEach((el) => {
            el.style.display = 'none';
            el.setAttribute('aria-hidden', 'true');
        });
        const wrap = document.createElement('div');
        wrap.className = 'qi-room-msg-modal';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.display = 'none';
        wrap.innerHTML =
            '<div class="qi-room-msg-dialog" role="dialog" aria-modal="true" aria-labelledby="qiRoomMsgTitle">' +
            '<h3 class="qi-room-msg-title" id="qiRoomMsgTitle"></h3>' +
            '<div class="qi-room-msg-text" id="qiRoomMsgText"></div>' +
            '<div class="qi-room-msg-footer">' +
            '<button type="button" class="qi-room-msg-btn" id="qiRoomMsgOk"></button>' +
            '<button type="button" class="qi-room-msg-btn" id="qiRoomMsgCancel"></button>' +
            '</div></div>';
        document.body.appendChild(wrap);
        ui = {
            wrap,
            title: wrap.querySelector('#qiRoomMsgTitle'),
            text: wrap.querySelector('#qiRoomMsgText'),
            ok: wrap.querySelector('#qiRoomMsgOk'),
            cancel: wrap.querySelector('#qiRoomMsgCancel')
        };
        return ui;
    }

    function closeCurrent(result) {
        const item = queue.shift();
        const box = ensureUi();
        box.wrap.classList.remove('is-open');
        box.wrap.style.display = 'none';
        box.wrap.setAttribute('aria-hidden', 'true');
        active = false;
        if (item) item.resolve(!!result);
        setTimeout(showNext, 0);
    }

    function showNext() {
        if (active || queue.length === 0) return;
        active = true;
        const item = queue[0];
        const box = ensureUi();
        box.title.textContent = item.title;
        box.text.textContent = item.message;
        box.ok.textContent = item.okText;
        box.cancel.textContent = item.cancelText;
        box.cancel.style.display = item.type === 'confirm' ? '' : 'none';
        box.wrap.classList.add('is-open');
        box.wrap.style.display = 'flex';
        box.wrap.setAttribute('aria-hidden', 'false');
        box.ok.onclick = () => closeCurrent(true);
        box.cancel.onclick = () => closeCurrent(false);
        box.wrap.onclick = (e) => {
            if (e.target === box.wrap && item.type === 'confirm') closeCurrent(false);
        };
        box.wrap.onkeydown = (e) => {
            if (e.key === 'Escape') closeCurrent(item.type !== 'confirm');
            if (e.key === 'Enter') closeCurrent(true);
        };
        setTimeout(() => box.ok.focus(), 0);
    }

    function showMessage(type, message, options) {
        if (!document.body) return Promise.resolve(type !== 'confirm');
        const item = normalize(type, message, options);
        return new Promise((resolve) => {
            queue.push({ ...item, resolve });
            showNext();
        });
    }

    const api = {
        qiAlert(message, options) { return showMessage('alert', message, options); },
        confirm(message, options) { return showMessage('confirm', message, options); },
        ask(message, options) {
            return showMessage('confirm', message, { ...(options || {}), buttons: 'yesNo' });
        }
    };
    window.QiMessageBox = api;
    window.qiAlert = api.qiAlert;
    window.qiConfirm = api.confirm;
    window.qiAsk = api.ask;
})();

/* ========== 2. 房间客户端（QiBoardRoomClient） ========== */
(function (global) {
    /** 房间页活跃 WebSocket；离开时统一 leave/close，避免服务端仍占座 */
    const activeRoomSockets = new Set();

    function setQiRoomLeaving(v) {
        const on = !!v;
        if (typeof window !== 'undefined') window.__qiRoomLeaving = on;
    }

    function qiRegisterRoomSocket(socket) {
        if (!socket) return socket;
        activeRoomSockets.add(socket);
        const drop = () => { activeRoomSockets.delete(socket); };
        socket.addEventListener('close', drop);
        socket.addEventListener('error', drop);
        return socket;
    }

    /** 主动离开房间：通知服务端并关闭连接；禁止随后自动重连 */
    function qiLeaveRoomIntentionally() {
        setQiRoomLeaving(true);
        const sockets = Array.from(activeRoomSockets);
        for (const s of sockets) {
            try {
                if (s.readyState === WebSocket.OPEN) {
                    s.send(JSON.stringify({ type: 'leave' }));
                }
            } catch (_) { /* ignore */ }
            try { s.close(); } catch (_) { /* ignore */ }
            activeRoomSockets.delete(s);
        }
    }

    function qiLeaveRoomAndGoLobby() {
        qiLeaveRoomIntentionally();
        window.location.href = '/qi';
    }

    function qiOpenRoomWebSocket(opts) {
        // 新连接表示仍在房间内（含断线重连），允许再次自动重连
        setQiRoomLeaving(false);
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}/qi/ws?game=${encodeURIComponent(opts.gameType)}&room=${encodeURIComponent(opts.roomId)}`;
        const socket = new WebSocket(url);
        qiRegisterRoomSocket(socket);
        socket.onopen = function () {
            socket.send(JSON.stringify({
                type: 'join',
                password: opts.roomPassword != null ? opts.roomPassword : null,
                requestedSlot: null
            }));
        };
        socket.onmessage = function (e) {
            const msg = JSON.parse(e.data);
            if (global.RoomChat && typeof global.RoomChat.consumeIncoming === 'function'
                && global.RoomChat.consumeIncoming(msg)) {
                return;
            }
            opts.onMessage(msg);
        };
        socket.onclose = opts.onClose;
        if (global.RoomChat && typeof global.RoomChat.setSocket === 'function') {
            global.RoomChat.setSocket(socket);
        }
        return socket;
    }

    /**
     * @typedef {object} WeiqiMessageCtx
     * @property {object} pageState 页面状态对象（如围棋页的 ps），供控制按钮与棋盘回调读写
     * @property {() => void} drawBoard
     * @property {() => void} exitTryPlay
     * @property {() => void} enterTryPlay
     * @property {(n:number) => void} setTryPlayStep
     * @property {(n:number) => void} setReplayStep
     * @property {(n:number) => void} setLiveViewStep
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
     * @property {boolean} [standardWeiqiMatchTime] 标准围棋房间：限时协商与计时面板
     * @property {number} [timeControlMainByoScale] 仅主时间/步时倍率（超时次数不受影响）
     */

    function qiCreateStandardWeiqiMatchTimeController(ctx) {
        const S = ctx.pageState;
        let ui = null;
        let rafId = 0;
        let adjustMode = false;

        function getDefaultTimeControlByBoardSize(boardSize) {
            if (typeof ctx.getTimeControlDefaults === 'function') {
                const custom = ctx.getTimeControlDefaults(boardSize);
                if (custom && typeof custom === 'object') {
                    return {
                        mainMinutes: Number(custom.mainMinutes) || 5,
                        byoyomiSeconds: Number(custom.byoyomiSeconds) || 30,
                        maxTimeouts: Number(custom.maxTimeouts) || 3
                    };
                }
            }
            if (ctx.timeControlDefaults && typeof ctx.timeControlDefaults === 'object') {
                return {
                    mainMinutes: Number(ctx.timeControlDefaults.mainMinutes) || 5,
                    byoyomiSeconds: Number(ctx.timeControlDefaults.byoyomiSeconds) || 30,
                    maxTimeouts: Number(ctx.timeControlDefaults.maxTimeouts) || 3
                };
            }
            const n = Number.isFinite(boardSize) && boardSize > 0 ? boardSize : 19;
            // 物理总点数优先走各棋种的 ctx.getTotalPoints 接口（总点数表/闭式，桥/全家福等按各自定义）；
            // 接口缺失时再从客户端棋盘数组（ctx.pageState.board）现数（旧口径，多数棋种与接口一致）：
            // flat 数组取长度（六角/五边形），二维数组按行求和并排除无效格（-1，开罗/扭棱/洞）。
            // 开局前棋盘已随游戏状态同步；取不到时退回方形 n²。
            let points = n * n;
            let viaInterface = false;
            if (typeof ctx.getTotalPoints === 'function') {
                const t = ctx.getTotalPoints();
                if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
                    points = t;
                    viaInterface = true;
                }
            }
            const board = ctx.pageState && ctx.pageState.board;
            if (!viaInterface && Array.isArray(board)) {
                if (Array.isArray(board[0])) {
                    let cnt = 0;
                    for (const row of board) {
                        if (!Array.isArray(row)) continue;
                        for (const v of row) if (v !== -1) cnt++;
                    }
                    if (cnt > 0) points = cnt;
                } else if (board.length > 0) {
                    points = board.length;
                }
            }
            const scaleRaw = Number(ctx.timeControlMainByoScale);
            const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
            // 主用时系数：默认围棋口径 0.013，个别棋种可经 ctx.timeControlMainCoef 覆盖（读秒/次数不变）
            const coefRaw = Number(ctx.timeControlMainCoef);
            const mainCoef = Number.isFinite(coefRaw) && coefRaw > 0 ? coefRaw : 0.013;
            const baseMain = Math.ceil(mainCoef * points);
            const baseByo = Math.ceil(0.24 * Math.pow(points, 0.75));
            return {
                mainMinutes: Math.ceil(baseMain * scale),
                byoyomiSeconds: Math.ceil(baseByo * scale),
                maxTimeouts: Math.ceil(0.6 * Math.pow(points, 0.25))
            };
        }

        function fmtRuleLine(mainMin, byoSec, maxT) {
            const m = Math.max(0, parseInt(mainMin, 10) || 0);
            const h = Math.floor(m / 60);
            const mm = m % 60;
            const head = h > 0 ? `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00` : `${String(mm).padStart(2, '0')}:00`;
            return `${head} ${byoSec}秒${maxT}次`;
        }

        function ensureModal() {
            if (ui) return ui;
            const wrap = document.createElement('div');
            wrap.className = 'qi-time-control-modal';
            wrap.innerHTML = `
<div class="qi-time-control-dialog" role="dialog" aria-modal="true">
  <button type="button" class="qi-time-control-close" id="qiTcBtnClose" aria-label="关闭并离座">&times;</button>
  <h3 class="qi-time-control-title">对局设置</h3>
  <div class="qi-time-control-row qi-time-control-radio-row">
    <label class="qi-time-control-radio"><input type="radio" name="qiTimedMode" value="limited" checked> 限时</label>
    <label class="qi-time-control-radio"><input type="radio" name="qiTimedMode" value="unlimited"> 不限时</label>
  </div>
  <div class="qi-time-control-fields">
    <label class="qi-time-control-field"><span>基本用时(分)</span><input type="number" id="qiTcMainMin" min="1" max="20000" value=""></label>
    <label class="qi-time-control-field"><span>步时(秒)</span><input type="number" id="qiTcByoSec" min="0" max="2000" value=""></label>
    <label class="qi-time-control-field"><span>超时次数</span><input type="number" id="qiTcMaxT" min="0" max="100" value=""></label>
  </div>
  <div class="qi-time-control-row qi-time-control-color-row" id="qiTcColorRow" style="display:none;">
    <label class="qi-time-control-radio"><input type="radio" name="qiColorChoice" value="player1" checked> 执先手</label>
    <label class="qi-time-control-radio"><input type="radio" name="qiColorChoice" value="player2"> 执后手</label>
    <label class="qi-time-control-radio"><input type="radio" name="qiColorChoice" value="random"> 猜先</label>
  </div>
  <p class="qi-time-control-hint" id="qiTcHint"></p>
  <div class="qi-time-control-footer" id="qiTcFooterPropose">
    <button type="button" class="qi-time-control-primary" id="qiTcBtnProposeOk">确认</button>
  </div>
  <div class="qi-time-control-footer" id="qiTcFooterRespond" style="display:none;">
    <button type="button" class="qi-time-control-primary" id="qiTcBtnAccept">确认</button>
    <button type="button" class="qi-time-control-secondary" id="qiTcBtnAdjust">调整</button>
  </div>
  <div class="qi-time-control-wait" id="qiTcWaitText" style="display:none;"></div>
</div>`;
            document.body.appendChild(wrap);
            const mainIn = wrap.querySelector('#qiTcMainMin');
            const byoIn = wrap.querySelector('#qiTcByoSec');
            const maxTIn = wrap.querySelector('#qiTcMaxT');
            const hint = wrap.querySelector('#qiTcHint');
            const footProp = wrap.querySelector('#qiTcFooterPropose');
            const footResp = wrap.querySelector('#qiTcFooterRespond');
            const waitEl = wrap.querySelector('#qiTcWaitText');
            const btnProposeOk = wrap.querySelector('#qiTcBtnProposeOk');
            const btnAccept = wrap.querySelector('#qiTcBtnAccept');
            const btnAdjust = wrap.querySelector('#qiTcBtnAdjust');
            const btnClose = wrap.querySelector('#qiTcBtnClose');
            const colorRow = wrap.querySelector('#qiTcColorRow');
            const radios = Array.from(wrap.querySelectorAll('input[name="qiTimedMode"]'));
            const colorRadios = Array.from(wrap.querySelectorAll('input[name="qiColorChoice"]'));
            const lowerControls = [mainIn, byoIn, maxTIn];

            function leaveSeatAndClose() {
                const w = ctx.getWs && ctx.getWs();
                const my = ctx.getMySlot && ctx.getMySlot();
                closeModal();
                if (my && ctx.setMySlot) {
                    ctx.setMySlot(null);
                    const slots = ctx.getSlots && ctx.getSlots();
                    if (slots) {
                        if (my === 'black') slots.player1 = false;
                        else if (my === 'white') slots.player2 = false;
                    }
                }
                if (ctx.colorStatus) ctx.colorStatus.innerText = '观战';
                if (typeof ctx.onLeaveSeatLocal === 'function') ctx.onLeaveSeatLocal();
                else if (typeof ctx.updateTurn === 'function') ctx.updateTurn();
                if (w && w.readyState === WebSocket.OPEN) {
                    w.send(JSON.stringify({ type: 'leaveSeat' }));
                }
            }
            if (btnClose) btnClose.onclick = leaveSeatAndClose;

            function readPayloadFromInputs() {
                const unlimited = wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').checked;
                const payload = unlimited
                    ? { timed: false, unlimited: true }
                    : {
                        timed: true,
                        mainMinutes: parseInt(mainIn.value, 10),
                        byoyomiSeconds: parseInt(byoIn.value, 10),
                        maxTimeouts: parseInt(maxTIn.value, 10)
                    };
                if (ctx.boardSeatOverlay || (colorRow && colorRow.style.display !== 'none')) {
                    // player1/player2/random：座位，服务端按座位交换（左=先手）
                    const c = wrap.querySelector('input[name="qiColorChoice"]:checked');
                    let v = c ? c.value : 'player1';
                    if (v === 'hostBlack') v = 'player1';
                    if (v === 'hostWhite') v = 'player2';
                    if (v !== 'player1' && v !== 'player2' && v !== 'random') v = 'player1';
                    payload.colorChoice = v;
                }
                return payload;
            }

            function setLimitedDisabled(dis) {
                mainIn.disabled = dis;
                byoIn.disabled = dis;
                maxTIn.disabled = dis;
            }

            function setLowerDisabled(dis) {
                lowerControls.forEach((el) => { if (el) el.disabled = dis; });
            }

            function setDialogReadonly(dis) {
                radios.forEach((r) => { r.disabled = dis; });
                setLowerDisabled(dis);
                colorRadios.forEach((r) => { r.disabled = dis; });
                wrap.classList.toggle('qi-time-control-readonly', !!dis);
            }

            function setColorRowVisible(vis, readonly) {
                if (!colorRow) return;
                colorRow.style.display = vis ? 'flex' : 'none';
                colorRadios.forEach((r) => { r.disabled = !!readonly; });
            }

            function normalizeColorChoice(val) {
                if (val === 'player2' || val === 'white' || val === 'hostWhite') return 'player2';
                if (val === 'random') return 'random';
                return 'player1';
            }

            function setColorChoice(val) {
                const v = normalizeColorChoice(val);
                const el = wrap.querySelector(`input[name="qiColorChoice"][value="${v}"]`);
                if (el) el.checked = true;
            }

            /** 该座位的执方名（执红/执黑/执白/执黑蓝…） */
            function seatChoiceText(slot, prefix) {
                const ui = (ctx.slotUi && ctx.slotUi[slot]) || null;
                if (prefix && ui && ui.youText) return ui.youText;
                if (ui && ui.choiceText) return prefix ? '您' + String(ui.choiceText).replace(/^执/, '执') : ui.choiceText;
                const S2 = (ctx.pageState) || {};
                const name = (S2.sideLabels && S2.sideLabels[slot]) || (ctx.sideLabels && ctx.sideLabels[slot]) || '';
                if (name) return (prefix ? '您执' : '执') + String(name).replace(/方$/, '');
                return (prefix ? '您执' : '执') + (slot === 'player1' ? '先手' : '后手');
            }

            /** 选项相对己方：直接显示您执X / 猜先 */
            function colorChoiceLabel(cc) {
                const v = normalizeColorChoice(cc);
                if (v === 'random') return '猜先';
                return seatChoiceText(v, true);
            }

            function applySlotUiColorLabels() {
                [['player1', '执先手'], ['player2', '执后手']].forEach(([slot, fallback]) => {
                    const input = wrap.querySelector(`input[name="qiColorChoice"][value="${slot}"]`);
                    if (!input || !input.parentElement) return;
                    const has = (ctx.slotUi && ctx.slotUi[slot]) || (ctx.pageState && ctx.pageState.sideLabels && ctx.pageState.sideLabels[slot]);
                    const label = has ? seatChoiceText(slot, false) : fallback;
                    const lab = input.parentElement;
                    lab.textContent = '';
                    lab.appendChild(input);
                    lab.appendChild(document.createTextNode(' ' + label));
                });
            }
            applySlotUiColorLabels();
            S._refreshTcColorLabels = applySlotUiColorLabels;   // 状态到达后再刷新一次（sideLabels 可能晚到）

            function currentColorChoice() {
                const c = wrap.querySelector('input[name="qiColorChoice"]:checked');
                return normalizeColorChoice(c ? c.value : 'player1');
            }

            /**
             * 将提议中的执子（相对选择者）换算成当前页面己方执子，供只读展示。
             * proposal.colorChoice: black|white|random；colorChooserSlot: 选择者座位。
             */
            function selfColorFromProposal(pr) {
                if (!pr) return 'player1';
                const raw = normalizeColorChoice(pr.colorChoice || 'player1');
                if (raw === 'random') return 'random';
                const chooser = pr.colorChooserSlot;
                const my = ctx.getMySlot && ctx.getMySlot();
                if (!chooser || !my || my === chooser) return raw;
                return raw === 'player2' ? 'player1' : 'player2';
            }

            function refreshRespondHint(proposal) {
                const showColor = !!(ctx.boardSeatOverlay || (colorRow && colorRow.style.display !== 'none'));
                const pr = proposal !== undefined ? proposal : lastRespondProposal;
                if (!pr) {
                    hint.textContent = showColor ? colorChoiceLabel(currentColorChoice()) : '';
                    return;
                }
                const base = pr.timed
                    ? `对方提议：${fmtRuleLine(pr.mainMinutes, pr.byoyomiSeconds, pr.maxTimeouts)}`
                    : '对方提议：不限时';
                if (!showColor) {
                    hint.textContent = base;
                    return;
                }
                const cc = adjustMode ? currentColorChoice() : selfColorFromProposal(pr);
                hint.textContent = `${base}；${colorChoiceLabel(cc)}`;
            }

            let lastRespondProposal = null;

            function clearProposalHintState() {
                lastRespondProposal = null;
                hint.textContent = '';
            }

            function onRadioChange() {
                const un = wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').checked;
                // 选“不限时”后，radio 下方控件整体不可用（灰态）；选“限时”恢复。
                setLowerDisabled(un);
                setLimitedDisabled(un);
            }
            radios.forEach(r => r.addEventListener('change', onRadioChange));
            colorRadios.forEach(r => r.addEventListener('change', () => {
                if (colorRow && colorRow.style.display !== 'none')
                    refreshRespondHint(lastRespondProposal);
            }));

            btnProposeOk.onclick = () => {
                const w = ctx.getWs();
                if (!w || w.readyState !== WebSocket.OPEN) return;
                const p = readPayloadFromInputs();
                if (ui && ui.vsComputerMode) {
                    ui._vsComputerStarting = true;
                    w.send(JSON.stringify({
                        type: 'startVsComputer',
                        colorChoice: p.colorChoice || 'black'
                    }));
                    setDialogReadonly(true);
                    btnProposeOk.disabled = true;
                    return;
                }
                if (p.timed !== false) {
                    if (!Number.isFinite(p.mainMinutes) || !Number.isFinite(p.byoyomiSeconds) || !Number.isFinite(p.maxTimeouts)) {
                        qiAlert('请填写主时间、读秒与超时次数。');
                        return;
                    }
                }
                w.send(JSON.stringify(Object.assign({ type: 'timeControlSubmit' }, p)));
                // 等服务端 timeControlWaitPeer，避免提交失败后卡在本地等待态
                setDialogReadonly(true);
                btnProposeOk.disabled = true;
            };

            btnAccept.onclick = () => {
                const w = ctx.getWs();
                if (!w || w.readyState !== WebSocket.OPEN) return;
                if (adjustMode) {
                    const p = readPayloadFromInputs();
                    if (p.timed !== false) {
                        if (!Number.isFinite(p.mainMinutes) || !Number.isFinite(p.byoyomiSeconds) || !Number.isFinite(p.maxTimeouts)) {
                            qiAlert('请填写主时间、读秒与超时次数。');
                            return;
                        }
                    }
                    w.send(JSON.stringify(Object.assign({ type: 'timeControlSubmit' }, p)));
                    adjustMode = false;
                    setDialogReadonly(true);
                    btnAccept.disabled = true;
                    btnAdjust.disabled = true;
                    return;
                }
                w.send(JSON.stringify({ type: 'timeControlAccept' }));
                setDialogReadonly(true);
                btnAccept.disabled = true;
                btnAdjust.disabled = true;
            };

            btnAdjust.onclick = () => {
                adjustMode = true;
                setLimitedDisabled(false);
                radios.forEach((r) => { r.disabled = false; });
                if (colorRow && colorRow.style.display !== 'none')
                    colorRadios.forEach((r) => { r.disabled = false; });
                const un = wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').checked;
                setLowerDisabled(un);
                btnAdjust.style.display = 'none';
                refreshRespondHint(lastRespondProposal);
            };

            ui = {
                wrap, mainIn, byoIn, maxTIn, hint, footProp, footResp, waitEl,
                btnProposeOk, btnAccept, btnAdjust, btnClose, colorRow, colorRadios,
                vsComputerMode: false,
                _vsComputerStarting: false,
                leaveSeatAndClose,
                setLimitedDisabled, readPayloadFromInputs, setColorRowVisible, setColorChoice, colorChoiceLabel,
                selfColorFromProposal, refreshRespondHint, clearProposalHintState,
                getLastRespondProposal: () => lastRespondProposal,
                setLastRespondProposal: (p) => { lastRespondProposal = p; },
                restoreAfterError() {
                    if (!ui || !ui.wrap || ui.wrap.style.display === 'none') return;
                    ui.wrap.classList.remove('qi-time-control-readonly');
                    ui.waitEl.style.display = 'none';
                    if (ui.vsComputerMode) {
                        // 开局失败：可重试，保留已预热进程；关掉窗口时再 cancel
                        ui._vsComputerStarting = false;
                        ui.footProp.style.display = 'flex';
                        ui.footResp.style.display = 'none';
                        ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').checked = true;
                        ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').checked = false;
                        ui.setLimitedDisabled(true);
                        ui.mainIn.disabled = true;
                        ui.byoIn.disabled = true;
                        ui.maxTIn.disabled = true;
                        ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').disabled = true;
                        ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').disabled = true;
                        ui.setColorRowVisible(true, false);
                        ui.btnProposeOk.disabled = false;
                        ui.colorRadios.forEach((r) => { r.disabled = false; });
                        return;
                    }
                    if (lastRespondProposal) {
                        ui.footProp.style.display = 'none';
                        ui.footResp.style.display = 'flex';
                        ui.btnAdjust.style.display = '';
                        adjustMode = false;
                        ui.setColorRowVisible(!!ctx.boardSeatOverlay, true);
                        ui.setColorChoice(selfColorFromProposal(lastRespondProposal));
                        ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').disabled = true;
                        ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').disabled = true;
                        ui.setLimitedDisabled(true);
                        ui.btnAccept.disabled = false;
                        ui.btnAdjust.disabled = false;
                        refreshRespondHint(lastRespondProposal);
                    } else {
                        clearProposalHintState();
                        ui.footProp.style.display = 'flex';
                        ui.footResp.style.display = 'none';
                        ui.setColorRowVisible(!!ctx.boardSeatOverlay, false);
                        ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').disabled = false;
                        ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').disabled = false;
                        ui.setLimitedDisabled(false);
                        ui.btnProposeOk.disabled = false;
                        ui.setColorChoice('black');
                    }
                }
            };
            return ui;
        }

        function closeModal() {
            if (!ui) return;
            const wasVsComputer = !!ui.vsComputerMode;
            const startingVsComputer = !!ui._vsComputerStarting;
            ui.wrap.style.display = 'none';
            adjustMode = false;
            ui.vsComputerMode = false;
            ui._vsComputerStarting = false;
            ui.footProp.style.display = 'none';
            ui.footResp.style.display = 'none';
            ui.waitEl.style.display = 'none';
            ui.btnAdjust.style.display = '';
            ui.wrap.classList.remove('qi-time-control-readonly');
            ui.wrap.querySelectorAll('input, button').forEach((el) => { el.disabled = false; });
            ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').disabled = false;
            if (typeof ui.clearProposalHintState === 'function') ui.clearProposalHintState();
            else if (ui.hint) ui.hint.textContent = '';
            // 打开人机设置后取消：归还预热进程；确认开局则不取消（由 startVsComputer 接手）
            if (wasVsComputer && !startingVsComputer) {
                const w = ctx.getWs && ctx.getWs();
                if (w && w.readyState === WebSocket.OPEN) {
                    w.send(JSON.stringify({ type: 'cancelVsComputerPrepare' }));
                }
            }
        }

        function openVsComputerSetup() {
            ensureModal();
            ui.vsComputerMode = true;
            ui._vsComputerStarting = false;
            ui.wrap.style.display = 'flex';
            ui.waitEl.style.display = 'none';
            if (typeof ui.clearProposalHintState === 'function') ui.clearProposalHintState();
            else ui.hint.textContent = '';
            ui.footProp.style.display = 'flex';
            ui.footResp.style.display = 'none';
            ui.wrap.classList.remove('qi-time-control-readonly');
            ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').checked = true;
            ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').checked = false;
            ui.setLimitedDisabled(true);
            ui.mainIn.disabled = true;
            ui.byoIn.disabled = true;
            ui.maxTIn.disabled = true;
            ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').disabled = true;
            ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').disabled = true;
            ui.btnProposeOk.disabled = false;
            ui.setColorRowVisible(true, false);
            ui.setColorChoice('black');
            // 与设置并行：预热/复用 KataGo 进程
            {
                const w = ctx.getWs && ctx.getWs();
                if (w && w.readyState === WebSocket.OPEN) {
                    w.send(JSON.stringify({ type: 'prepareVsComputer' }));
                }
            }
            if (ui.hint) ui.hint.textContent = ui.colorChoiceLabel('black');
            ui.colorRadios.forEach((r) => {
                r.disabled = false;
                r.onchange = () => {
                    if (ui.hint) ui.hint.textContent = ui.colorChoiceLabel(
                        (ui.wrap.querySelector('input[name="qiColorChoice"]:checked') || {}).value || 'player1'
                    );
                };
            });
        }

        function openNegotiation(msg) {
            ensureModal();
            ui.vsComputerMode = false;
            ui.wrap.style.display = 'flex';
            ui.waitEl.style.display = 'none';
            // 每次打开先清空上一局/上一轮的「对方提议」，再按本次 mode 写入
            if (typeof ui.clearProposalHintState === 'function') ui.clearProposalHintState();
            else ui.hint.textContent = '';
            const showColor = !!(msg.boardSeatOverlay || ctx.boardSeatOverlay);
            if (msg.mode === 'propose') {
                const d = getDefaultTimeControlByBoardSize(ctx.getBoardSize());
                ui.wrap.classList.remove('qi-time-control-readonly');
                ui.footProp.style.display = 'flex';
                ui.footResp.style.display = 'none';
                ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').checked = true;
                ui.mainIn.value = d.mainMinutes;
                ui.byoIn.value = d.byoyomiSeconds;
                ui.maxTIn.value = d.maxTimeouts;
                ui.setLimitedDisabled(false);
                ui.mainIn.disabled = false;
                ui.byoIn.disabled = false;
                ui.maxTIn.disabled = false;
                ui.btnProposeOk.disabled = false;
                ui.btnAccept.disabled = false;
                ui.btnAdjust.disabled = false;
                ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').disabled = false;
                ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').disabled = false;
                ui.setColorRowVisible(showColor, false);
                if (showColor) ui.setColorChoice('black');
            } else if (msg.mode === 'respond' && msg.proposal) {
                ui.wrap.classList.remove('qi-time-control-readonly');
                ui.footProp.style.display = 'none';
                ui.footResp.style.display = 'flex';
                adjustMode = false;
                ui.btnAdjust.style.display = '';
                const pr = msg.proposal;
                if (ui.setLastRespondProposal) ui.setLastRespondProposal(pr);
                if (!pr.timed) {
                    ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').checked = true;
                    ui.setLimitedDisabled(true);
                } else {
                    ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').checked = true;
                    ui.mainIn.value = pr.mainMinutes;
                    ui.byoIn.value = pr.byoyomiSeconds;
                    ui.maxTIn.value = pr.maxTimeouts;
                    ui.setLimitedDisabled(true);
                }
                ui.wrap.querySelector('input[name="qiTimedMode"][value="unlimited"]').disabled = true;
                ui.wrap.querySelector('input[name="qiTimedMode"][value="limited"]').disabled = true;
                ui.btnAccept.disabled = false;
                ui.btnAdjust.disabled = false;
                ui.setColorRowVisible(showColor, true);
                // 只读展示换算成「您」的执子
                if (showColor) {
                    const mine = ui.selfColorFromProposal ? ui.selfColorFromProposal(pr) : (pr.colorChoice || 'black');
                    ui.setColorChoice(mine);
                }
                if (ui.refreshRespondHint) ui.refreshRespondHint(pr);
                else {
                    const colorHint = showColor ? `；${ui.colorChoiceLabel(pr.colorChoice || 'black')}` : '';
                    ui.hint.textContent = (pr.timed ? `对方提议：${fmtRuleLine(pr.mainMinutes, pr.byoyomiSeconds, pr.maxTimeouts)}` : '对方提议：不限时') + colorHint;
                }
            }
        }

        function formatHMS(ms) {
            if (!Number.isFinite(ms) || ms < 0) ms = 0;
            const t = Math.floor(ms / 1000);
            const h = Math.floor(t / 3600);
            const m = Math.floor((t % 3600) / 60);
            const s = t % 60;
            if (h > 0)
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;              
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        function updateTimerPanel() {
            const panel = document.getElementById('goTimerPanel');
            if (!panel) return;
            const mt = S.matchTime;
            if (!mt || !mt.settings) {
                // 对局已开始但有人退出：时间框保持可见，把「已退出」写进 goTimerBlackTitle/goTimerWhiteTitle（与围棋一致）
                const slotsNow = (ctx.getSlots && ctx.getSlots()) || S.slots || {};
                const startedNow = !!(S.matchStarted || (mt && mt.settings));
                const absentNow = startedNow && (!slotsNow.player1 || !slotsNow.player2);
                if (absentNow && S._timerPanelUsed) {
                    panel.hidden = false;
                    ['black', 'white'].forEach((slot) => {
                        const el = panel.querySelector('[data-go-timer="' + slot + '"]');
                        if (!el) return;
                        const left = !slotsNow[slot];
                        const titleEl = el.querySelector('.go-timer-title');
                        if (titleEl) {
                            const ui = (ctx.slotUi && ctx.slotUi[slot]) || null;
                            const base = ui
                                ? `${ui.emoji || ''} ${ui.name || ''}`.trim()
                                : (slot === 'player1' ? '⚫ 黑方' : '⚪ 白方');
                            titleEl.textContent = left ? `${base}(已退出)` : base;
                        }
                        el.classList.toggle('is-player-left', left);
                    });
                } else {
                    panel.hidden = true;
                }
                updateSeatAbsentNotice();
                return;
            }
            panel.hidden = false;
            const rule = mt.clock && mt.clock.ruleLine
                ? `${mt.clock.ruleLine}`
                : (mt.settings.timed === false ? '不限时' : '');
            S._timerPanelUsed = true;   // 本局确实用过分边时间框
            const slots = (ctx.getSlots && ctx.getSlots()) || S.slots || {};
            const matchStarted = !!(S.matchStarted || mt.settings);
            const absentBlack = !!(matchStarted && !slots.player1);
            const absentWhite = !!(matchStarted && !slots.player2);

            function line(slot) {
                const isTimed = mt.settings && mt.settings.timed;
                const clk = mt.clock;
                let countdown = '—';
                let ox = '—';
                if (isTimed && clk && clk.player1 && clk.player2) {
                    const serverSkew = (clk.serverNow != null) ? (Date.now() - clk.serverNow) : 0;
                    const p = slot === 'player1' ? clk.player1 : clk.player2;
                    let ms = 0;
                    if (clk.display && clk.display.syncMode) {
                        const live = slot === 'player1' ? clk.display.player1Live : clk.display.player2Live;
                        if (live) {
                            const base = slot === 'player1' ? clk.display.player1CountdownMs : clk.display.player2CountdownMs;
                            ms = Math.max(0, (base || 0) - serverSkew);
                        } else {
                            ms = p.inByo ? p.byoMs : p.mainMs;
                        }
                    } else {
                        const active = clk.activeSlot === slot;
                        if (active && clk.display && clk.display.slot === slot) {
                            ms = Math.max(0, (clk.display.countdownMs || 0) - serverSkew);
                        } else if (p) {
                            ms = p.inByo ? p.byoMs : p.mainMs;
                        }
                    }
                    countdown = formatHMS(ms);
                    const rem = Math.max(0, (mt.settings.maxTimeouts || 0) - (p.timeoutsUsed || 0));
                    const tot = mt.settings.maxTimeouts || 0;
                    ox = `${rem}/${tot}`;
                }
                const el = panel.querySelector('[data-go-timer="' + slot + '"]');
                if (el) {
                    el.querySelector('.go-timer-count').textContent = countdown;
                    el.querySelector('.go-timer-over').textContent = ox;
                    let activeClass = false;
                    if (mt.settings && mt.settings.timed && mt.clock) {
                        if (mt.clock.display && mt.clock.display.syncMode)
                            activeClass = (slot === 'player1' ? mt.clock.display.player1Live : mt.clock.display.player2Live);
                        else
                            activeClass = mt.clock.activeSlot === slot;
                    }
                    if (activeClass)
                        el.classList.add('is-active');
                    else
                        el.classList.remove('is-active');
                    const ruleEl = el.querySelector('.go-timer-rule');
                    if (ruleEl) ruleEl.textContent = rule;
                    const titleEl = el.querySelector('.go-timer-title');
                    if (titleEl) {
                        const ui = (ctx.slotUi && ctx.slotUi[slot]) || null;
                        const base = ui
                            ? `${ui.emoji || ''} ${ui.name || ''}`.trim()
                            : (slot === 'player1' ? '⚫ 黑方' : '⚪ 白方');
                        const left = slot === 'player1' ? absentBlack : absentWhite;
                        titleEl.textContent = left ? `${base}(已退出)` : base;
                    }
                    el.classList.toggle('is-player-left', slot === 'player1' ? absentBlack : absentWhite);
                }
            }
            line('player1');
            line('player2');
            updateSeatAbsentNotice();
        }

        function updateSeatAbsentNotice() {
            let notice = document.getElementById('qiSeatAbsentNotice');
            const panel = document.getElementById('goTimerPanel');
            const parent = panel && panel.parentElement;
            if (!parent) return;
            if (!notice) {
                notice = document.createElement('div');
                notice.id = 'qiSeatAbsentNotice';
                notice.className = 'qi-seat-absent-notice';
                parent.insertBefore(notice, panel.nextSibling);
            }
            const slots = (ctx.getSlots && ctx.getSlots()) || S.slots || {};
            const matchStarted = !!(S.matchStarted || (S.matchTime && S.matchTime.settings));
            const absentBlack = !!(matchStarted && !slots.player1);
            const absentWhite = !!(matchStarted && !slots.player2);
            const panelVisible = panel && !panel.hidden;
            // 有分边时间框时用红框+(已退出)；无时间框或需补充文案时写在下方
            if (!matchStarted || (!absentBlack && !absentWhite)) {
                notice.hidden = true;
                notice.textContent = '';
                return;
            }
            if (panelVisible || (panel && S._timerPanelUsed)) {
                // 分边时间框已能显示「已退出」时不再用提示条
                notice.hidden = true;
                notice.textContent = '';
                return;
            }
            const parts = [];
            if (absentBlack) parts.push(((ctx.slotUi && ctx.slotUi.player1 && ctx.slotUi.player1.absentText) || '黑方已退出'));
            if (absentWhite) parts.push(((ctx.slotUi && ctx.slotUi.player2 && ctx.slotUi.player2.absentText) || '白方已退出'));
            notice.textContent = parts.join('　');
            notice.hidden = !parts.length;
        }

        function resetTimerPanelToInitial() {
            const panel = document.getElementById('goTimerPanel');
            if (!panel) return;
            const blocks = panel.querySelectorAll('.go-timer-block');
            blocks.forEach((el) => {
                const c = el.querySelector('.go-timer-count');
                const o = el.querySelector('.go-timer-over');
                const r = el.querySelector('.go-timer-rule');
                const t = el.querySelector('.go-timer-title');
                if (c) c.textContent = '—';
                if (o) o.textContent = '—';
                if (r) r.textContent = '　';
                if (t) {
                    const slot = el.getAttribute('data-go-timer');
                    const ui = (ctx.slotUi && ctx.slotUi[slot]) || null;
                    t.textContent = ui
                        ? `${ui.emoji || ''} ${ui.name || ''}`.trim()
                        : (slot === 'player2' ? '⚪ 白方' : '⚫ 黑方');
                }
                el.classList.remove('is-active', 'is-player-left');
            });
            panel.hidden = true;
            updateSeatAbsentNotice();
        }

        function tickRaf() {
            cancelAnimationFrame(rafId);
            function frame() {
                updateTimerPanel();
                const mt = S.matchTime;
                if (mt && mt.settings && mt.settings.timed && !S.gameOver) rafId = requestAnimationFrame(frame);
            }
            rafId = requestAnimationFrame(frame);
        }

        function applyMatchTimeFromState(msg) {
            if (msg.matchTime === undefined) return;
            S.matchTime = msg.matchTime;
            const nego = msg.matchTime && msg.matchTime.negotiation;
            const my = ctx.getMySlot();
            if (nego && my) {
                const showingWait = !!(ui && ui.wrap && ui.wrap.style.display !== 'none'
                    && ui.waitEl && ui.waitEl.style.display !== 'none');
                if (nego.waitingSlot === my && nego.phase === 'propose') {
                    // 已在等待对方确认时不要被 gameState 重置回提议表单
                    if (!showingWait)
                        openNegotiation({ mode: 'propose', boardSeatOverlay: !!ctx.boardSeatOverlay });
                } else if (nego.waitingSlot === my && nego.phase === 'respond' && nego.proposal
                    && (nego.proposal.ok === true || nego.proposal.timed === false || nego.proposal.timed === true)) {
                    openNegotiation({ mode: 'respond', proposal: nego.proposal, boardSeatOverlay: !!ctx.boardSeatOverlay });
                } else if (nego.waitingSlot !== my && nego.lastProposerSlot === my) {
                    ensureModal();
                    if (typeof ui.clearProposalHintState === 'function') ui.clearProposalHintState();
                    else if (ui.hint) ui.hint.textContent = '';
                    ui.footProp.style.display = 'none';
                    ui.footResp.style.display = 'none';
                    ui.waitEl.style.display = 'block';
                    ui.waitEl.textContent = '等待对方确认...';
                    ui.wrap.style.display = 'flex';
                    ui.wrap.classList.add('qi-time-control-readonly');
                    ui.wrap.querySelectorAll('input, button').forEach((el) => {
                        if (el && el.classList && el.classList.contains('qi-time-control-close')) return;
                        el.disabled = true;
                    });
                    ui.btnAdjust.disabled = false;
                    if (ui.btnClose) ui.btnClose.disabled = false;
                }
            }
            if (msg.matchTime && msg.matchTime.settings) {
                updateTimerPanel();
                tickRaf();
            } else {
                const panel = document.getElementById('goTimerPanel');
                if (panel) panel.hidden = true;
            }
        }

        function stop() {
            cancelAnimationFrame(rafId);
            rafId = 0;
            closeModal();
            S.matchTime = null;
            resetTimerPanelToInitial();
        }

        function restoreAfterError() {
            ensureModal();
            if (ui && typeof ui.restoreAfterError === 'function')
                ui.restoreAfterError();
        }

        return {
            openVsComputerSetup,
            handleMessage(msg) {
                switch (msg.type) {
                    case 'timeControlNegotiation':
                        openNegotiation(msg);
                        break;
                    case 'timeControlWaitPeer':
                        ensureModal();
                        if (typeof ui.clearProposalHintState === 'function') ui.clearProposalHintState();
                        else if (ui.hint) ui.hint.textContent = '';
                        ui.footProp.style.display = 'none';
                        ui.footResp.style.display = 'none';
                        ui.waitEl.style.display = 'block';
                        ui.waitEl.textContent = msg.text || '请稍候…';
                        ui.wrap.style.display = 'flex';
                        ui.wrap.classList.add('qi-time-control-readonly');
                        ui.wrap.querySelectorAll('input, button').forEach((el) => {
                            if (el && el.classList && el.classList.contains('qi-time-control-close')) return;
                            el.disabled = true;
                        });
                        ui.btnAdjust.disabled = false;
                        if (ui.btnClose) ui.btnClose.disabled = false;
                        break;
                    case 'timeControlAgreed':
                        closeModal();
                        S.matchTime = S.matchTime || {};
                        S.matchTime.settings = msg.settings;
                        S.matchTime.clock = msg.clock;
                        S.matchTime.negotiation = null;
                        S.matchStarted = true;
                        S.matchStartedOnce = true;
                        updateTimerPanel();
                        tickRaf();
                        ctx.updateTurn();
                        if (typeof ctx.updateReplayUI === 'function') ctx.updateReplayUI();
                        {
                            const edit = document.getElementById('editControls');
                            if (edit && edit.dataset.qiEditFeature === '1') edit.hidden = true;
                        }
                        if (typeof ctx.updateEditModeUI === 'function') ctx.updateEditModeUI();
                        break;
                    case 'timeControlReset':
                        stop();
                        S.matchStarted = false;
                        if (S.matchTime) {
                            S.matchTime.negotiation = null;
                            S.matchTime.settings = null;
                            S.matchTime.clock = null;
                        }
                        updateTimerPanel();
                        ctx.updateTurn();
                        if (typeof ctx.updateReplayUI === 'function') ctx.updateReplayUI();
                        {
                            const edit = document.getElementById('editControls');
                            if (edit && edit.dataset.qiEditFeature === '1') edit.hidden = false;
                        }
                        if (typeof ctx.updateEditModeUI === 'function') ctx.updateEditModeUI();
                        break;
                    case 'clockUpdate':
                        if (S.matchTime) S.matchTime.clock = msg.clock;
                        updateTimerPanel();
                        break;
                    default:
                        break;
                }
            },
            applyMatchTimeFromState,
            updateTimerPanel,
            stop,
            restoreAfterError,
            closeDialog: closeModal
        };
    }

    /**
     * 试下模式的「虚着 / 悔棋」：实现在公共绘制模块里（QiWeiqiSquarePageRuntime），
     * 这里只做转发——room.js 由多个 IIFE 组成，跨块调用必须走 global。
     */
    function qiRoomRuntime() {
        return (typeof window !== 'undefined' ? window : global).QiWeiqiSquarePageRuntime;
    }
    function qiSyncTryPlayActionButtons(pageState) {
        const rt = qiRoomRuntime();
        if (rt && typeof rt.syncTryPlayActionButtons === 'function') rt.syncTryPlayActionButtons(pageState);
    }
    function qiTryPlayPassDefault(ctx) {
        const rt = qiRoomRuntime();
        return !!(rt && typeof rt.tryPlayPassDefault === 'function' && rt.tryPlayPassDefault(ctx));
    }
    function qiTryPlayUndoDefault(ctx) {
        const rt = qiRoomRuntime();
        return !!(rt && typeof rt.tryPlayUndoDefault === 'function' && rt.tryPlayUndoDefault(ctx));
    }

    /**
     * 试下模式的「虚着 / 悔棋」按钮接管（在 createWeiqiMessageBindings 里统一安装）：
     * - 显隐：进入试下给 body 加 qi-tryplay（CSS 用 !important 覆盖各棋种自己写的 display），退出即移除。
     *   各棋种进入/退出试下的路径五花八门（还有 seatOverlayOnly 短路、自绘棋种自定义按钮），
     *   所以这里用观察器跟随「试下 / 试下结束」按钮与步数显示的变化。
     * - 点击：用 document 捕获阶段拦截，避免各棋种自己的对局处理器（如悔棋要给对手发申请）在试下里生效。
     */
    function qiInstallTryPlayActionControls(opts) {
        if (typeof document === 'undefined') return;
        const state = opts.pageState;
        const inTryPlay = () => !!(state && state.tryPlayMode);
        let lastTryPlayOn = null;
        const syncTryPlayUi = () => {
            const on = inTryPlay();
            qiSyncTryPlayActionButtons(state);
            if (on === lastTryPlayOn) return;
            lastTryPlayOn = on;
            // 试下要让出棋盘：座位浮层（qi-seat-overlay）会盖住棋盘、吃掉落子/悬停点击。
            // 用公共「试下」按钮进入的棋种会自己设置这个标志，自带按钮的棋种（黑白棋/路墙棋等）不会。
            state.seatOverlayForceHide = on;
            if (typeof opts.refreshSeatOverlay === 'function') opts.refreshSeatOverlay();
        };
        syncTryPlayUi();
        if (typeof MutationObserver !== 'undefined' && !state._qiTryPlayObserver) {
            const observed = { attributes: true, attributeFilter: ['style', 'class'], childList: true, subtree: true, characterData: true };
            const observer = new MutationObserver(syncTryPlayUi);
            for (const id of ['tryPlayBtn', 'replayStepDisplay']) {
                const el = document.getElementById(id);
                if (el) observer.observe(el, observed);
            }
            state._qiTryPlayObserver = observer;
        }
        if (state._qiTryPlayClickHooked) return;
        state._qiTryPlayClickHooked = true;
        document.addEventListener('click', (e) => {
            if (!inTryPlay()) return;
            const target = e.target && e.target.closest ? e.target.closest('#passBtn, #undoBtn') : null;
            if (!target) return;
            // 拦下棋种自己的处理器：试下里虚着/悔棋直接生效，不需要对方同意，也不发任何消息
            e.stopImmediatePropagation();
            e.preventDefault();
            if (target.id === 'passBtn') opts.runPass();
            else opts.runUndo();
        }, true);
    }

    function createWeiqiMessageBindings(ctx) {
        const S = ctx.pageState;
        if (!S) throw new Error('createWeiqiMessageBindings requires ctx.pageState (page state object, e.g. ps)');
        let lastBusyAlertAt = 0;
        let mtCtl = ctx.standardWeiqiMatchTime ? qiCreateStandardWeiqiMatchTimeController(ctx) : null;
        function runTryPlayPass() {
            if (typeof ctx.tryPlayPass === 'function') return ctx.tryPlayPass();
            return qiTryPlayPassDefault(ctx);
        }
        function runTryPlayUndo() {
            if (typeof ctx.tryPlayUndo === 'function') return ctx.tryPlayUndo();
            return qiTryPlayUndoDefault(ctx);
        }
        // 试下模式的虚着/悔棋：装在函数最前面，seatOverlayOnly 的棋种（黑白棋/路墙棋等）也会生效
        qiInstallTryPlayActionControls({
            pageState: S,
            runPass: runTryPlayPass,
            runUndo: runTryPlayUndo,
            refreshSeatOverlay: () => { if (typeof updateSeatOverlay === 'function') updateSeatOverlay(); }
        });
        function ensureMatchTimeCtl() {
            if (!mtCtl) mtCtl = qiCreateStandardWeiqiMatchTimeController(ctx);
            return mtCtl;
        }
        if (S.seatOverlayLocalHide === undefined) S.seatOverlayLocalHide = false;
        if (S.seatOverlayForceHide === undefined) S.seatOverlayForceHide = false;
        if (S._prevSeatVacant === undefined) S._prevSeatVacant = null;
        if (S.katagoAvailable === undefined) S.katagoAvailable = false;
        if (S.computerSlot === undefined) S.computerSlot = null;

        const vsComputerBtn = document.getElementById('vsComputerBtn');
        function updateVsComputerBtn() {
            if (!vsComputerBtn) return;
            const slots = (ctx.getSlots && ctx.getSlots()) || S.slots || {};
            const mySlot = ctx.getMySlot ? ctx.getMySlot() : S.mySlot;
            const seatedCount = (slots.player1 ? 1 : 0) + (slots.player2 ? 1 : 0);
            const matchStarted = !!(S.matchStarted || (S.matchTime && S.matchTime.settings));
            const canShow = !!S.katagoAvailable
                && !matchStarted
                && !S.computerSlot
                && !S.gameOver
                && !S.replayMode
                && !S.waitingScoreConfirm
                && (seatedCount === 0 || (seatedCount === 1 && mySlot));
            vsComputerBtn.style.display = canShow ? '' : 'none';
        }
        if (vsComputerBtn) {
            vsComputerBtn.onclick = () => {
                if (!S.ws || S.ws.readyState !== WebSocket.OPEN) return;
                if (!S.katagoAvailable || S.computerSlot || S.matchStarted) return;
                // 尽早预热（openVsComputerSetup 内也会再发，服务端幂等）
                S.ws.send(JSON.stringify({ type: 'prepareVsComputer' }));
                const ctl = ensureMatchTimeCtl();
                if (ctl && typeof ctl.openVsComputerSetup === 'function') ctl.openVsComputerSetup();
            };
        }

        if (global.RoomChat && typeof global.RoomChat.bindSlotContext === 'function') {
            global.RoomChat.bindSlotContext({
                slotUi: ctx.slotUi || null,
                getWs: typeof ctx.getWs === 'function' ? ctx.getWs : null
            });
        }

        function vacantCount(slots) {
            let n = 0;
            if (!slots || !slots.player1) n++;
            if (!slots || !slots.player2) n++;
            return n;
        }

        /** 新局 / 房间重置：清除本地编辑开局缓存与勾选 UI，并重新显示编辑选项 */
        function clearLocalEditCachesForNewGame() {
            S.liveOpeningBoard = null;
            S._editCommitSnapshot = null;
            S._editCommitPending = false;
            S._editLocalBoard = null;
            S.editDirty = false;
            S.editModeEnabled = false;
            if (S.userBoardMarks && typeof S.userBoardMarks === 'object') {
                for (const k of Object.keys(S.userBoardMarks)) delete S.userBoardMarks[k];
            }
            if (global.QiBoardMarks && typeof global.QiBoardMarks.clear === 'function') {
                try { global.QiBoardMarks.clear(); } catch (e) { /* ignore */ }
            }
            if (global.QiBoardEditUi && typeof global.QiBoardEditUi.clear === 'function') {
                try { global.QiBoardEditUi.clear(); } catch (e) { /* ignore */ }
            }
            const editModeCheckbox = document.getElementById('editModeCheckbox');
            const editToolSelect = document.getElementById('editToolSelect');
            const clearBoardBtn = document.getElementById('clearBoardBtn');
            const editControls = document.getElementById('editControls');
            S._suppressEditCheckboxChange = true;
            if (editModeCheckbox) {
                editModeCheckbox.checked = false;
                editModeCheckbox.disabled = false;
            }
            S._suppressEditCheckboxChange = false;
            if (editToolSelect) editToolSelect.classList.add('hidden');
            if (clearBoardBtn) clearBoardBtn.classList.add('hidden');
            if (editControls && editControls.dataset.qiEditFeature === '1') editControls.hidden = false;
            if (typeof ctx.updateEditModeUI === 'function') {
                try { ctx.updateEditModeUI(); } catch (e) { /* ignore */ }
            }
        }

        function noteSeatVacancyChange() {
            const slots = ctx.getSlots();
            const v = vacantCount(slots);
            if (S._prevSeatVacant != null && v > S._prevSeatVacant)
                S.seatOverlayLocalHide = false;
            S._prevSeatVacant = v;
        }

        function refreshColorStatus() {
            if (!ctx.colorStatus) return;
            const mySlot = ctx.getMySlot();
            const matchStarted = !!(S.matchStarted || (S.matchTime && S.matchTime.settings));
            if (!mySlot) {
                ctx.colorStatus.innerText = '观战';
                return;
            }
            if (ctx.boardSeatOverlay && !matchStarted)
                ctx.colorStatus.innerText = '已落座';
            else {
                const ui = (ctx.slotUi && ctx.slotUi[mySlot]) || null;
                const name = (ui && (ui.statusText || ui.name)) || (mySlot === 'player1' ? '黑方' : '白方');
                ctx.colorStatus.innerText = `已选择: ${name}`;
            }
        }

        function getSeatOverlayMounts() {
            if (ctx.seatOverlayDualBoards) {
                const wraps = document.querySelectorAll('.dual-boards .board-wrap');
                if (wraps.length) return Array.from(wraps);
            }
            const sel = ctx.seatOverlayContainer || '.board-container';
            const c = document.querySelector(sel);
            return c ? [c] : [];
        }

        /** 600×600 画布坐标下的伪外框顶点（与三角/六角绘制一致） */
        function defaultSeatOverlayVertices(shape) {
            if (shape === 'triangle') {
                return [
                    { x: 300, y: 38.49364905389035 },
                    { x: 11.02885682970026, y: 539.0063509461097 },
                    { x: 588.9711431702997, y: 539.0063509461097 }
                ];
            }
            if (shape === 'hexagon') {
                const pts = [];
                for (let i = 0; i < 6; i++) {
                    const a = (i * 60) * Math.PI / 180;
                    pts.push({ x: 300 + 280 * Math.cos(a), y: 300 + 280 * Math.sin(a) });
                }
                return pts;
            }
            return null;
        }

        function defaultSeatOverlayCornerRadius(shape) {
            if (shape === 'triangle') return 3;
            if (shape === 'hexagon') return 12;
            if (shape === 'rhombus') return 4;
            return 0;
        }

        /**
         * 与棋盘外框完全同一套 canvas arcTo 路径（三角/六角/菱三角 drawRounded*）。
         */
        function traceRoundedPolygon(ctx2d, vertices, radius) {
            const n = vertices && vertices.length;
            if (!n || n < 3) return;
            const startPoints = [];
            const endPoints = [];
            for (let i = 0; i < n; i++) {
                const curr = vertices[i];
                const prev = vertices[(i - 1 + n) % n];
                const next = vertices[(i + 1) % n];
                const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
                const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                const len1 = Math.hypot(v1.x, v1.y) || 1;
                const len2 = Math.hypot(v2.x, v2.y) || 1;
                const dx1 = v1.x / len1;
                const dy1 = v1.y / len1;
                const dx2 = v2.x / len2;
                const dy2 = v2.y / len2;
                startPoints.push({ x: curr.x + dx1 * radius, y: curr.y + dy1 * radius });
                endPoints.push({ x: curr.x + dx2 * radius, y: curr.y + dy2 * radius });
            }
            ctx2d.beginPath();
            ctx2d.moveTo(endPoints[n - 1].x, endPoints[n - 1].y);
            for (let i = 0; i < n; i++) {
                ctx2d.arcTo(vertices[i].x, vertices[i].y, endPoints[i].x, endPoints[i].y, radius);
            }
            ctx2d.closePath();
        }

        function resolveSeatOverlayShapeGeom() {
            let vertices = null;
            let radius = null;
            if (typeof ctx.getSeatOverlayVertices === 'function') {
                try {
                    const v = ctx.getSeatOverlayVertices();
                    if (Array.isArray(v) && v.length >= 3) vertices = v;
                } catch (e) { /* ignore */ }
            }
            if (typeof ctx.seatOverlayCornerRadius === 'number' && ctx.seatOverlayCornerRadius >= 0)
                radius = ctx.seatOverlayCornerRadius;
            if (!vertices && typeof ctx.getSeatOverlayPolygonPoints === 'function') {
                try {
                    const custom = ctx.getSeatOverlayPolygonPoints();
                    if (custom && typeof custom === 'string') {
                        vertices = custom.trim().split(/\s+/).map((pair) => {
                            const [x, y] = pair.split(',').map(Number);
                            return { x, y };
                        }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
                    }
                } catch (e) { /* ignore */ }
            }
            if (!vertices)
                vertices = defaultSeatOverlayVertices(ctx.seatOverlayShape);
            if (radius == null)
                radius = defaultSeatOverlayCornerRadius(ctx.seatOverlayShape);
            if (!vertices || vertices.length < 3) return null;
            return { vertices, radius: radius || 0 };
        }

        function layoutSeatOverlayToCanvas(container, overlay) {
            // 蒙版一律对齐主棋盘 canvas（跳过蒙版自身的 shape canvas）：木色画布=棋盘外观，
            // 与其它棋类一致。画布可能小于容器（象棋画布居中留边），因此不能用容器 inset。
            const boardCanvas = Array.from(container.querySelectorAll('canvas')).find(
                (c) => !c.classList.contains('qi-seat-overlay-shape-canvas')
            ) || null;
            const target = boardCanvas;
            if (!target) {
                overlay.style.left = '';
                overlay.style.top = '';
                overlay.style.width = '';
                overlay.style.height = '';
                overlay.style.right = '';
                overlay.style.bottom = '';
                overlay.style.inset = '';
                return null;
            }
            const cRect = target.getBoundingClientRect();
            const pRect = container.getBoundingClientRect();
            if (!cRect.width || !pRect.width) return target;
            overlay.style.inset = 'auto';
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
            overlay.style.left = `${cRect.left - pRect.left}px`;
            overlay.style.top = `${cRect.top - pRect.top}px`;
            overlay.style.width = `${cRect.width}px`;
            overlay.style.height = `${cRect.height}px`;
            return target;
        }

        function applySeatOverlayShape(overlay, container) {
            overlay.classList.remove(
                'qi-seat-overlay--shaped',
                'qi-seat-overlay--triangle',
                'qi-seat-overlay--hexagon',
                'qi-seat-overlay--rhombus'
            );
            const geom = resolveSeatOverlayShapeGeom();
            const oldSvg = overlay.querySelector(':scope > .qi-seat-overlay-shape-svg');
            if (oldSvg) oldSvg.remove();
            let shapeCanvas = overlay.querySelector(':scope > .qi-seat-overlay-shape-canvas');
            if (!geom) {
                if (shapeCanvas) shapeCanvas.remove();
                layoutSeatOverlayToCanvas(container, overlay);
                return;
            }
            overlay.classList.add('qi-seat-overlay--shaped');
            if (ctx.seatOverlayShape === 'triangle')
                overlay.classList.add('qi-seat-overlay--triangle');
            else if (ctx.seatOverlayShape === 'hexagon')
                overlay.classList.add('qi-seat-overlay--hexagon');
            else if (ctx.seatOverlayShape === 'rhombus')
                overlay.classList.add('qi-seat-overlay--rhombus');
            if (!shapeCanvas) {
                shapeCanvas = document.createElement('canvas');
                shapeCanvas.className = 'qi-seat-overlay-shape-canvas';
                shapeCanvas.setAttribute('aria-hidden', 'true');
                // 内联压过全局 canvas 木纹/阴影，避免正方形框盖住棋盘
                shapeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;aspect-ratio:auto;background:transparent;border:none;border-radius:0;box-shadow:none;pointer-events:none;z-index:0;display:block;margin:0;padding:0;';
                overlay.insertBefore(shapeCanvas, overlay.firstChild);
            } else {
                shapeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;aspect-ratio:auto;background:transparent;border:none;border-radius:0;box-shadow:none;pointer-events:none;z-index:0;display:block;margin:0;padding:0;';
            }
            layoutSeatOverlayToCanvas(container, overlay);
            // 蒙版多边形顶点坐标以 600×600 逻辑画布为基准（默认顶点与各插件的 seatOverlayShape 顶点均为 600 基准）。
            // 棋盘 canvas 物理尺寸会被 dpr 放大（600×dpr），不能用作 viewSize，否则 dpr>1 时蒙版形状只覆盖棋盘左上角。
            const viewSize = Number(ctx.seatOverlayViewSize) > 0 ? Number(ctx.seatOverlayViewSize) : 600;
            if (shapeCanvas.width !== viewSize) shapeCanvas.width = viewSize;
            if (shapeCanvas.height !== viewSize) shapeCanvas.height = viewSize;
            const sctx = shapeCanvas.getContext('2d');
            sctx.setTransform(1, 0, 0, 1, 0, 0);
            sctx.clearRect(0, 0, viewSize, viewSize);
            sctx.fillStyle = 'rgba(70, 70, 70, 0.75)';
            traceRoundedPolygon(sctx, geom.vertices, geom.radius);
            sctx.fill();
        }

        function setAllSeatOverlaysHidden(hidden) {
            getSeatOverlayMounts().forEach((container) => {
                const o = container.querySelector(':scope > .qi-seat-overlay');
                if (o) o.hidden = hidden;
            });
        }

        function ensureSeatOverlay() {
            const mounts = getSeatOverlayMounts();
            if (!mounts.length) return null;
            let primary = null;
            mounts.forEach((container, idx) => {
                let overlay = container.querySelector(':scope > .qi-seat-overlay');
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.className = 'qi-seat-overlay';
                    if (idx === 0) {
                        const contB = (ctx.slotUi && ctx.slotUi.player1 && ctx.slotUi.player1.continueText) || '继续执黑';
                        const contW = (ctx.slotUi && ctx.slotUi.player2 && ctx.slotUi.player2.continueText) || '继续执白';
                        overlay.innerHTML =
                            '<div class="qi-seat-overlay-inner">' +
                            '<button type="button" class="qi-seat-overlay-btn" data-seat-action="sit">落座</button>' +
                            `<button type="button" class="qi-seat-overlay-btn" data-seat-action="continue-player1">${contB}</button>` +
                            `<button type="button" class="qi-seat-overlay-btn" data-seat-action="continue-player2">${contW}</button>` +
                            '<button type="button" class="qi-seat-overlay-btn qi-seat-overlay-btn--secondary" data-seat-action="cancel">取消</button>' +
                            '</div>';
                        overlay.addEventListener('click', (e) => {
                            const btn = e.target.closest('[data-seat-action]');
                            if (!btn || btn.disabled) return;
                            const action = btn.getAttribute('data-seat-action');
                            const w = ctx.getWs();
                            if (action === 'cancel') {
                                S.seatOverlayLocalHide = true;
                                updateSeatOverlay();
                                return;
                            }
                            if (!w || w.readyState !== WebSocket.OPEN) return;
                            const slots = ctx.getSlots();
                            if (action === 'sit') {
                                if (slots.player1 && slots.player2) return;
                                const color = !slots.player1 ? 'player1' : (!slots.player2 ? 'player2' : null);
                                if (!color) return;
                                // takeSeat：新协议由服务端分配；selectColor：兼容旧服务端
                                w.send(JSON.stringify({ type: 'takeSeat' }));
                                w.send(JSON.stringify({ type: 'selectColor', color }));
                                S._optimisticSeat = color;
                                S._seatRetryOther = true;
                                ctx.setMySlot(color);
                                slots[color] = true;
                                refreshColorStatus();
                                updateSeatOverlay();
                                if (typeof ctx.updateTurn === 'function') ctx.updateTurn();
                            } else if (action === 'continue-player1') {
                                w.send(JSON.stringify({ type: 'takeSeat', color: 'player1' }));
                                w.send(JSON.stringify({ type: 'selectColor', color: 'player1' }));
                                S._optimisticSeat = 'player1';
                                S._seatRetryOther = false;
                                ctx.setMySlot('player1');
                                slots.player1 = true;
                                refreshColorStatus();
                                updateSeatOverlay();
                                if (typeof ctx.updateTurn === 'function') ctx.updateTurn();
                            } else if (action === 'continue-player2') {
                                w.send(JSON.stringify({ type: 'takeSeat', color: 'player2' }));
                                w.send(JSON.stringify({ type: 'selectColor', color: 'player2' }));
                                S._optimisticSeat = 'player2';
                                S._seatRetryOther = false;
                                ctx.setMySlot('player2');
                                slots.player2 = true;
                                refreshColorStatus();
                                updateSeatOverlay();
                                if (typeof ctx.updateTurn === 'function') ctx.updateTurn();
                            }
                        });
                    } else {
                        overlay.classList.add('qi-seat-overlay--mute');
                    }
                    container.appendChild(overlay);
                    if (!S._seatOverlayResizeBound) {
                        S._seatOverlayResizeBound = true;
                        window.addEventListener('resize', () => {
                            if (!ctx.boardSeatOverlay) return;
                            getSeatOverlayMounts().forEach((c) => {
                                const o = c.querySelector(':scope > .qi-seat-overlay');
                                if (o) applySeatOverlayShape(o, c);
                            });
                        });
                    }
                }
                applySeatOverlayShape(overlay, container);
                if (idx === 0) primary = overlay;
            });
            return primary;
        }

        function notifySeatOverlayVisibility() {
            let visible = false;
            getSeatOverlayMounts().forEach((c) => {
                const o = c.querySelector(':scope > .qi-seat-overlay');
                if (o && !o.hidden) visible = true;
            });
            if (typeof ctx.onSeatOverlayUpdated === 'function') {
                try { ctx.onSeatOverlayUpdated({ visible }); } catch (e) { /* ignore */ }
            }
        }

        function updateSeatOverlay() {
            if (!ctx.boardSeatOverlay) return;
            noteSeatVacancyChange();
            const overlay = ensureSeatOverlay();
            if (!overlay) {
                notifySeatOverlayVisibility();
                return;
            }

            const slots = ctx.getSlots();
            const mySlot = ctx.getMySlot();
            const matchStarted = !!(S.matchStarted || (S.matchTime && S.matchTime.settings));
            const btnSit = overlay.querySelector('[data-seat-action="sit"]');
            const btnCB = overlay.querySelector('[data-seat-action="continue-player1"]');
            const btnCW = overlay.querySelector('[data-seat-action="continue-player2"]');
            const btnCancel = overlay.querySelector('[data-seat-action="cancel"]');

            const gameOver = typeof ctx.getGameOver === 'function' && !!ctx.getGameOver();
            const forceHide = !!(S.seatOverlayForceHide || S.tryPlayMode || (S.replayMode && !matchStarted));
            if (forceHide || S.seatOverlayLocalHide || gameOver) {
                /* 对局已结束：不再提供续坐蒙版，进入者直接观战 */
                setAllSeatOverlaysHidden(true);
                refreshColorStatus();
                updatePlayerLeftIndicators();
                notifySeatOverlayVisibility();
                return;
            }

            if (matchStarted && mySlot) {
                setAllSeatOverlaysHidden(true);
                refreshColorStatus();
                updatePlayerLeftIndicators();
                notifySeatOverlayVisibility();
                return;
            }

            if (!matchStarted) {
                if (mySlot) {
                    setAllSeatOverlaysHidden(true);
                    refreshColorStatus();
                    updatePlayerLeftIndicators();
                    notifySeatOverlayVisibility();
                    return;
                }
                const bothFull = !!(slots.player1 && slots.player2);
                if (btnSit) {
                    btnSit.hidden = false;
                    btnSit.disabled = bothFull;
                }
                if (btnCB) btnCB.hidden = true;
                if (btnCW) btnCW.hidden = true;
                if (btnCancel) btnCancel.hidden = false;
                setAllSeatOverlaysHidden(false);
                refreshColorStatus();
                updatePlayerLeftIndicators();
                notifySeatOverlayVisibility();
                return;
            }

            const needPlayer1 = !slots.player1;
            const needPlayer2 = !slots.player2;
            if (!needPlayer1 && !needPlayer2) {
                setAllSeatOverlaysHidden(true);
                refreshColorStatus();
                updatePlayerLeftIndicators();
                notifySeatOverlayVisibility();
                return;
            }
            if (btnSit) btnSit.hidden = true;
            if (btnCB) {
                btnCB.hidden = !needPlayer1;
                btnCB.disabled = false;
            }
            if (btnCW) {
                btnCW.hidden = !needPlayer2;
                btnCW.disabled = false;
            }
            if (btnCancel) btnCancel.hidden = false;
            setAllSeatOverlaysHidden(false);
            refreshColorStatus();
            updatePlayerLeftIndicators();
            notifySeatOverlayVisibility();
        }

        function updateRadioStylesForSeatOverlay() {
            updateSeatOverlay();
        }

        function handleSeatOverlayMessage(msg) {
            if (!ctx.boardSeatOverlay || !msg) return false;
            switch (msg.type) {
                case 'joined':
                    S.seatOverlayLocalHide = false;
                    S.seatOverlayForceHide = false;
                    if (msg.state && msg.state.boardSeatOverlay) ctx.boardSeatOverlay = true;
                    if (msg.state && msg.state.hostSlot !== undefined) {
                        S.hostSlot = msg.state.hostSlot;
                        if (ctx.getMySlot()) S.isHost = ctx.getMySlot() === msg.state.hostSlot;
                    }
                    updateSeatOverlay();
                    return true;
                case 'slotOccupied':
                case 'slotReleased':
                case 'playerLeft':
                    updateSeatOverlay();
                    return true;
                case 'colorAssigned':
                    S._optimisticSeat = null;
                    S._seatRetryOther = false;
                    if (msg.isHost != null) S.isHost = !!msg.isHost;
                    if (msg.isHost) S.hostSlot = msg.color;
                    updateSeatOverlay();
                    return true;
                case 'colorsFinalized':
                    if (msg.slots) ctx.setSlots(msg.slots);
                    if (msg.hostSlot !== undefined) {
                        S.hostSlot = msg.hostSlot;
                        S.isHost = ctx.getMySlot() === msg.hostSlot;
                    }
                    updateSeatOverlay();
                    return true;
                case 'gameState':
                case 'roomReset':
                case 'editBoardAccepted':
                    if (msg.boardSeatOverlay) ctx.boardSeatOverlay = true;
                    if (msg.hostSlot !== undefined) S.hostSlot = msg.hostSlot;
                    if (msg.type === 'roomReset') {
                        S.seatOverlayLocalHide = false;
                        S.seatOverlayForceHide = false;
                        S.matchStarted = false;
                        S.matchTime = null;
                    }
                    updateSeatOverlay();
                    return true;
                case 'timeControlAgreed':
                    if (msg.slots) ctx.setSlots(msg.slots);
                    if (msg.hostSlot !== undefined) S.hostSlot = msg.hostSlot;
                    S.matchStarted = true;
                    updateSeatOverlay();
                    return true;
                case 'timeControlReset':
                    S.matchStarted = false;
                    updateSeatOverlay();
                    return true;
                case 'newGameStarted':
                    S.seatOverlayLocalHide = false;
                    S.seatOverlayForceHide = false;
                    S.matchStarted = false;
                    S.matchTime = null;
                    updateSeatOverlay();
                    return true;
                case 'importSuccess':
                    S.seatOverlayForceHide = true;
                    S.seatOverlayLocalHide = true;
                    updateSeatOverlay();
                    return true;
                default:
                    return false;
            }
        }

        if (ctx.seatOverlayOnly) {
            if (ctx.boardSeatOverlay) updateRadioStylesForSeatOverlay();
            return {
                updateSeatOverlay,
                updateRadioStyles: updateRadioStylesForSeatOverlay,
                refreshColorStatus,
                handleSeatOverlayMessage,
                matchTimeCtl: mtCtl
            };
        }

        function updatePlayerLeftIndicators() {
            const panel = document.getElementById('goTimerPanel');
            const slots = ctx.getSlots();
            const matchStarted = !!(S.matchStarted || (S.matchTime && S.matchTime.settings));
            const absentBlack = !!(matchStarted && !slots.player1);
            const absentWhite = !!(matchStarted && !slots.player2);
            const showAbsence = matchStarted && (absentBlack || absentWhite);
            if (S.matchTime && S.matchTime.settings) S._timerPanelUsed = true;
            // 有分边时间框的棋种（围棋/象棋类/跳棋等）：有人退出时让时间框保持可见，
            // 「已退出」显示在 goTimerBlackTitle / goTimerWhiteTitle 里（与围棋一致），
            // 不再另出「黑方已退出」提示条。
            if (panel && showAbsence && S._timerPanelUsed) panel.hidden = false;
            if (panel && !panel.hidden) {
                ['black', 'white'].forEach((slot) => {
                    const el = panel.querySelector('[data-go-timer="' + slot + '"]');
                    if (!el) return;
                    const left = slot === 'player1' ? absentBlack : absentWhite;
                    const titleEl = el.querySelector('.go-timer-title');
                    if (titleEl) {
                        const ui = (ctx.slotUi && ctx.slotUi[slot]) || null;
                        const base = ui
                            ? `${ui.emoji || ''} ${ui.name || ''}`.trim()
                            : (slot === 'player1' ? '⚫ 黑方' : '⚪ 白方');
                        titleEl.textContent = left ? `${base}(已退出)` : base;
                    }
                    el.classList.toggle('is-player-left', left);
                });
            }
            // 独立提示条只在「没有可用的分边时间框」时兜底
            let notice = document.getElementById('qiSeatAbsentNotice');
            const parent = panel && panel.parentElement;
            if (parent) {
                if (!notice) {
                    notice = document.createElement('div');
                    notice.id = 'qiSeatAbsentNotice';
                    notice.className = 'qi-seat-absent-notice';
                    parent.insertBefore(notice, panel.nextSibling);
                }
                if (!showAbsence || (panel && !panel.hidden)) {
                    notice.hidden = true;
                    notice.textContent = '';
                } else {
                    const parts = [];
                    if (absentBlack) parts.push(((ctx.slotUi && ctx.slotUi.player1 && ctx.slotUi.player1.absentText) || '黑方已退出'));
                    if (absentWhite) parts.push(((ctx.slotUi && ctx.slotUi.player2 && ctx.slotUi.player2.absentText) || '白方已退出'));
                    notice.textContent = parts.join('　');
                    notice.hidden = !parts.length;
                }
            }
        }

        function syncStateWithMatch(msg) {
            if (msg && msg.sideLabels) S.sideLabels = msg.sideLabels;
            if (typeof applySeatRadioText === 'function') applySeatRadioText();
            if (typeof S._refreshTcColorLabels === 'function') { try { S._refreshTcColorLabels(); } catch (_) {} }
            ctx.syncState(msg);
            if (Object.prototype.hasOwnProperty.call(msg, 'katagoAvailable'))
                S.katagoAvailable = !!msg.katagoAvailable;
            if (Object.prototype.hasOwnProperty.call(msg, 'computerSlot'))
                S.computerSlot = msg.computerSlot || null;
            if (mtCtl && msg.matchTime !== undefined) mtCtl.applyMatchTimeFromState(msg);
            if (msg.hostSlot !== undefined) {
                S.hostSlot = msg.hostSlot;
                if (ctx.getMySlot()) S.isHost = ctx.getMySlot() === msg.hostSlot;
            }
            if (msg.boardSeatOverlay) ctx.boardSeatOverlay = true;
            updateVsComputerBtn();
        }
        function handleMessage(msg) {
            if (global.RoomChat && typeof global.RoomChat.consumeIncoming === 'function'
                && global.RoomChat.consumeIncoming(msg)) {
                return;
            }
            const ws = ctx.getWs();
            if (mtCtl && (msg.type === 'timeControlNegotiation' || msg.type === 'timeControlWaitPeer'
                || msg.type === 'timeControlAgreed' || msg.type === 'timeControlReset' || msg.type === 'clockUpdate')) {
                mtCtl.handleMessage(msg);
                if (msg.type === 'timeControlAgreed') {
                    if (msg.slots) ctx.setSlots(msg.slots);
                    if (msg.hostSlot !== undefined) S.hostSlot = msg.hostSlot;
                    if (Object.prototype.hasOwnProperty.call(msg, 'computerSlot'))
                        S.computerSlot = msg.computerSlot || null;
                    if (Object.prototype.hasOwnProperty.call(msg, 'katagoAvailable'))
                        S.katagoAvailable = !!msg.katagoAvailable;
                    refreshColorStatus();
                    // 选点等棋种会在约定限时时带上 candidates；勿等下一包 gameState 才画选点
                    // 人机开局也会带完整局面
                    if (msg.board != null || (msg.candidates && msg.candidates.length) || msg.moveCoords || msg.moveLog
                        || msg.computerSlot)
                        syncStateWithMatch(msg);
                    updateVsComputerBtn();
                }
                if (msg.type === 'timeControlReset') {
                    if (Object.prototype.hasOwnProperty.call(msg, 'computerSlot'))
                        S.computerSlot = msg.computerSlot || null;
                    updateVsComputerBtn();
                }
                if (typeof ctx.updateReplayUI === 'function') ctx.updateReplayUI();
                updateSeatOverlay();
                return;
            }
            switch (msg.type) {
                case 'joined':
                    sessionStorage.removeItem(`roomPassword_${ctx.roomId}`);
                    S.seatOverlayLocalHide = false;
                    S.seatOverlayForceHide = false;
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
                    if (msg.state && msg.state.boardSeatOverlay) ctx.boardSeatOverlay = true;
                    if (msg.role === 'player') {
                        ctx.setMySlot(msg.slot);
                        if (msg.state) syncStateWithMatch(msg.state);
                        refreshColorStatus();
                    } else {
                        ctx.setMySlot(null);
                        if (msg.state) syncStateWithMatch(msg.state);
                        refreshColorStatus();
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
                        if (msg.slot === 'player1') s.player1 = true;
                        else if (msg.slot === 'player2') s.player2 = true;
                    }
                    updateRadioStyles();
                    ctx.updateTurn();
                    break;
                case 'slotReleased':
                    {
                        const s = ctx.getSlots();
                        if (msg.slot === 'player1') s.player1 = false;
                        else if (msg.slot === 'player2') s.player2 = false;
                        if (ctx.getMySlot() === msg.slot) {
                            ctx.setMySlot(null);
                            refreshColorStatus();
                        }
                    }
                    updateRadioStyles();
                    ctx.updateTurn();
                    break;
                case 'playerLeft':
                    {
                        const s = ctx.getSlots();
                        if (msg.slot === 'player1') s.player1 = false;
                        else if (msg.slot === 'player2') s.player2 = false;
                        if (ctx.getMySlot() === msg.slot) {
                            ctx.setMySlot(null);
                            refreshColorStatus();
                        }
                        if (msg.matchStarted || S.matchStarted)
                            S.seatOverlayLocalHide = false;
                    }
                    updateRadioStyles();
                    ctx.updateTurn();
                    break;
                case 'colorAssigned':
                    S._optimisticSeat = null;
                    S._seatRetryOther = false;
                    ctx.setMySlot(msg.color);
                    if (msg.isHost != null) S.isHost = !!msg.isHost;
                    {
                        const s = ctx.getSlots();
                        if (ctx.getMySlot() === 'player1') s.player1 = true;
                        else s.player2 = true;
                    }
                    if (msg.isHost) S.hostSlot = msg.color;
                    refreshColorStatus();
                    updateRadioStyles();
                    ctx.updateTurn();
                    break;
                case 'seatLeft':
                    S._optimisticSeat = null;
                    S._seatRetryOther = false;
                    ctx.setMySlot(null);
                    if (msg.hostSlot !== undefined) {
                        S.hostSlot = msg.hostSlot;
                        S.isHost = false;
                    }
                    if (mtCtl) mtCtl.stop();
                    S.matchTime = null;
                    S.matchStarted = false;
                    syncStateWithMatch(msg);
                    refreshColorStatus();
                    updateRadioStyles();
                    ctx.updateTurn();
                    if (typeof updateVsComputerBtn === 'function') updateVsComputerBtn();
                    break;
                case 'colorsFinalized':
                    if (msg.slots) ctx.setSlots(msg.slots);
                    if (msg.hostSlot !== undefined) {
                        S.hostSlot = msg.hostSlot;
                        S.isHost = ctx.getMySlot() === msg.hostSlot;
                    }
                    refreshColorStatus();
                    updateRadioStyles();
                    break;
                case 'gameState':
                    syncStateWithMatch(msg);
                    updateRadioStyles();
                    break;
                case 'editBoardAccepted':
                    syncStateWithMatch(msg);
                    updateRadioStyles();
                    break;
                case 'broadcast':
                    if (msg.action === 'move' || msg.action === 'clearMine' || msg.action === 'guess' || msg.action === 'pass' || msg.action === 'drop' || msg.action === 'capture' || msg.action === 'undoAccept' || msg.action === 'drawAgreed' || msg.action === 'resign'
                        || msg.action === 'invisibleReveal' || msg.action === 'endAgreed' || msg.action === 'scoreCountingStarted' || msg.action === 'mineHit' || msg.action === 'timeLoss'
                        || msg.action === 'setupSwap' || msg.action === 'setupDone'
                        || msg.action === 'buryClick' || msg.action === 'buryDone' || msg.action === 'buryDoneAll' || msg.action === 'buryPhase') {
                        const wasOver = ctx.getGameOver();
                        syncStateWithMatch(msg);
                        if (msg.gameOver && !wasOver) {
                            const slotName = (slot) =>
                                (ctx.slotUi && ctx.slotUi[slot] && ctx.slotUi[slot].name)
                                || (slot === 'player1' ? '黑方' : '白方');
                            if (msg.action === 'timeLoss') {
                                const loser = slotName(msg.player);
                                const winText = msg.winner === 'draw' ? '和棋' : `${slotName(msg.winner)}胜`;
                                qiAlert(`${loser}超时，${winText}。`);
                            }
                            else if (msg.recordResultText) qiAlert(msg.recordResultText);
                            else if (msg.winner === 'player1') qiAlert(`${slotName('black')}胜。`);
                            else if (msg.winner === 'player2') qiAlert(`${slotName('white')}胜。`);
                            else if (msg.winner === 'draw') qiAlert('和棋');
                        } else if (msg.action === 'drawAgreed' && !wasOver) qiAlert('和棋');
                        else if (msg.action === 'resign' && !wasOver) {
                            const slotName = (slot) =>
                                (ctx.slotUi && ctx.slotUi[slot] && ctx.slotUi[slot].name)
                                || (slot === 'player1' ? '黑方' : '白方');
                            qiAlert(`${slotName(msg.player)}认输`);
                        }
                    }
                    break;
                case 'newGameStarted':
                    if (mtCtl) mtCtl.stop();
                    ctx.exitReplayMode();
                    ctx.clearEstimate();
                    ctx.hideScoreConfirm();
                    ctx.setWaitingScoreConfirm(false);
                    ctx.setIRejected(false);
                    ctx.setMySlot(null);
                    S.computerSlot = null;
                    S.seatOverlayLocalHide = false;
                    S.seatOverlayForceHide = false;
                    refreshColorStatus();
                    ctx.setSlots({ black: false, white: false });
                    ctx.scoreTitle.innerText = '　';
                    S.matchTime = null;
                    S.matchStarted = false;
                    S.matchStartedOnce = false;
                    clearLocalEditCachesForNewGame();
                    if (ctx.onNewGameStarted) ctx.onNewGameStarted();
                    syncStateWithMatch(msg);
                    updateRadioStyles();
                    updateVsComputerBtn();
                    break;
                case 'newGameRequest':
                    qiConfirm('对方请求开始新的一局，是否同意？').then(ok => { ws.send(JSON.stringify({ type: 'newGameResponse', accept: !!ok })); });
                    break;
                case 'undoRequest':
                    qiConfirm('对方请求悔棋，是否同意？').then(ok => { ws.send(JSON.stringify({ type: 'undoResponse', accept: !!ok })); });
                    break;
                case 'drawRequest':
                    qiConfirm('对方申请和棋，是否同意？').then(ok => { ws.send(JSON.stringify({ type: 'drawResponse', accept: !!ok })); });
                    break;
                case 'scoreProposal': {
                    if (msg.board) syncStateWithMatch(msg);
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
                    if (msg.board) syncStateWithMatch(msg);
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
                    if (msg.board) syncStateWithMatch(msg);
                    if (ctx.getIRejected()) ctx.setIRejected(false);
                    else qiAlert('对方拒绝数点结果，对局继续');
                    ctx.clearMobileMovePreview();
                    if (ctx.getShowEstimateActive()) {
                        ctx.setShowEstimateActive(false);
                        ctx.clearEstimate();
                    }
                    ctx.hideScoreConfirm();
                    ctx.setWaitingScoreConfirm(false);
                    break;
                case 'requestEnd':
                    qiConfirm('对方申请数点，是否同意？').then(ok => { ws.send(JSON.stringify({ type: 'endResponse', accept: !!ok })); });
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
                    syncStateWithMatch(msg);
                    ctx.clearEstimate();
                    ctx.hideScoreConfirm();
                    ctx.setWaitingScoreConfirm(false);
                    if (msg.replayData) ctx.enterReplayMode(msg.replayData);
                    S.seatOverlayForceHide = true;
                    S.seatOverlayLocalHide = true;
                    updateRadioStyles();
                    break;
                }
                case 'roomReset':
                    if (mtCtl) mtCtl.stop();
                    ctx.exitReplayMode();
                    S.matchTime = null;
                    S.matchStarted = false;
                    S.matchStartedOnce = false;
                    S.computerSlot = null;
                    S.seatOverlayLocalHide = false;
                    S.seatOverlayForceHide = false;
                    clearLocalEditCachesForNewGame();
                    if (ctx.onRoomReset) ctx.onRoomReset();
                    syncStateWithMatch(msg);
                    ctx.clearEstimate();
                    ctx.hideScoreConfirm();
                    ctx.setWaitingScoreConfirm(false);
                    updateRadioStyles();
                    updateVsComputerBtn();
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
                    if (S._optimisticSeat) {
                        const s = ctx.getSlots();
                        const c = S._optimisticSeat;
                        const occupied = msg.message && /(颜色|座位)已被占用/.test(msg.message);
                        const seatsFull = msg.message && /双方均已落座/.test(msg.message);
                        // 开局落座抢座：自动改试另一色，不弹旧提示
                        if (occupied && S._seatRetryOther && (c === 'black' || c === 'white')) {
                            const other = c === 'player1' ? 'player2' : 'player1';
                            S._seatRetryOther = false;
                            if (ctx.getMySlot() === c) ctx.setMySlot(null);
                            s[c] = false;
                            if (!s[other]) {
                                const w2 = ctx.getWs();
                                S._optimisticSeat = other;
                                ctx.setMySlot(other);
                                s[other] = true;
                                if (w2 && w2.readyState === WebSocket.OPEN) {
                                    w2.send(JSON.stringify({ type: 'takeSeat', color: other }));
                                    w2.send(JSON.stringify({ type: 'selectColor', color: other }));
                                }
                                refreshColorStatus();
                                updateRadioStyles();
                                if (typeof ctx.updateTurn === 'function') ctx.updateTurn();
                                break;
                            }
                        }
                        if (ctx.getMySlot() === c) ctx.setMySlot(null);
                        if (c === 'player1') s.player1 = false;
                        else if (c === 'player2') s.player2 = false;
                        S._optimisticSeat = null;
                        S._seatRetryOther = false;
                        S.seatOverlayLocalHide = false;
                        refreshColorStatus();
                        updateRadioStyles();
                        if (typeof ctx.updateTurn === 'function') ctx.updateTurn();
                        if (ctx.boardSeatOverlay && (occupied || seatsFull))
                            break;
                    }
                    if (msg.message === '密码错误') {
                        sessionStorage.removeItem(`roomPassword_${ctx.roomId}`);
                        window.location.href = `/qi?game=${ctx.gameType}&room=${ctx.roomId}&needPassword=1`;
                    } else if (ctx.boardSeatOverlay && msg.message && /双方均已落座/.test(msg.message)) {
                        // 座位已满时点击落座：静默忽略
                        break;
                    } else if (ctx.boardSeatOverlay && msg.message && /请选择继续执/.test(msg.message)) {
                        // 终局观战等场景：不再弹续坐提示
                        break;
                    } else {
                        const isBusy = msg.message && msg.message.indexOf('服务器繁忙') >= 0;
                        if (isBusy) {
                            // 引擎进程已满：关闭人机/限时设置窗，回到点击前状态；
                            // 预取与开局两条失败路径的重复提示 3 秒内去重，只弹一次
                            if (mtCtl && typeof mtCtl.closeDialog === 'function')
                                mtCtl.closeDialog();
                            const now = Date.now();
                            if (now - lastBusyAlertAt >= 3000) {
                                lastBusyAlertAt = now;
                                qiAlert(msg.message);
                            }
                        } else {
                            if (mtCtl && typeof mtCtl.restoreAfterError === 'function')
                                mtCtl.restoreAfterError();
                            qiAlert(msg.message);
                        }
                    }
                    break;
                default:
                    console.log('未知消息', msg);
            }
        }

        function isQiLobbyFreshCatalogRoom() {
            try {
                const raw = sessionStorage.getItem('qiLobbyFreshRoom');
                if (!raw) return false;
                const o = JSON.parse(raw);
                return !!(o && String(o.roomId) === String(ctx.roomId) && o.gameId === ctx.gameType);
            } catch (e) {
                return false;
            }
        }

        function updateRecordButtons() {
            const importBtn = document.getElementById('importBtn');
            const exportBtn = document.getElementById('exportBtn');
            if (!importBtn || !exportBtn) return;
            const board = ctx.getBoard();
            // 围棋等用 0 表示空；象棋等用 '' 表示空；异形一维棋盘直接扫元素
            const hasAnyStone = Array.isArray(board) && (
                Array.isArray(board[0])
                    ? board.some(row => Array.isArray(row) && row.some(v => v !== 0 && v !== '' && v != null))
                    : board.some(v => v !== 0 && v !== '' && v != null)
            );
            const s = ctx.getSlots();
            const noPlayers = !s.player1 && !s.player2;
            const matchStarted = !!(S.matchStarted || (S.matchTime && S.matchTime.settings));
            const freshCatalog = isQiLobbyFreshCatalogRoom();
            if (ctx.getReplayMode()) {
                importBtn.style.display = 'none';
                exportBtn.style.display = '';
                return;
            }
            if (!matchStarted && noPlayers && !hasAnyStone) {
                importBtn.style.display = '';
                exportBtn.style.display = 'none';
                return;
            }
            if (freshCatalog && noPlayers && !hasAnyStone) {
                importBtn.style.display = '';
                exportBtn.style.display = 'none';
                return;
            }
            importBtn.style.display = 'none';
            exportBtn.style.display = '';
        }

        function updateRadioStyles() {
            if (ctx.boardSeatOverlay) {
                updateRecordButtons();
                updateSeatOverlay();
                updateVsComputerBtn();
                return;
            }
            if (!ctx.labelBlack || !ctx.labelWhite || !ctx.radioBlack || !ctx.radioWhite) {
                updateRecordButtons();
                updateVsComputerBtn();
                return;
            }
            ctx.labelBlack.classList.remove('self-radio', 'opponent-radio', 'checked-disabled');
            ctx.labelWhite.classList.remove('self-radio', 'opponent-radio', 'checked-disabled');
            const slots = ctx.getSlots();
            const mySlot = ctx.getMySlot();
            if (slots.player1) {
                ctx.labelBlack.classList.add(mySlot === 'player1' ? 'self-radio' : 'opponent-radio');
                ctx.labelBlack.classList.add('checked-disabled');
                ctx.radioBlack.disabled = true;
                ctx.radioBlack.checked = true;
            } else {
                ctx.radioBlack.disabled = false;
                ctx.radioBlack.checked = false;
            }
            if (slots.player2) {
                ctx.labelWhite.classList.add(mySlot === 'player2' ? 'self-radio' : 'opponent-radio');
                ctx.labelWhite.classList.add('checked-disabled');
                ctx.radioWhite.disabled = true;
                ctx.radioWhite.checked = true;
            } else {
                ctx.radioWhite.disabled = false;
                ctx.radioWhite.checked = false;
            }
            updateRecordButtons();
            updateVsComputerBtn();
        }

        ctx.onLeaveSeatLocal = function () {
            refreshColorStatus();
            updateRadioStyles();
            updateVsComputerBtn();
            if (typeof ctx.updateTurn === 'function') ctx.updateTurn();
        };

        const newGameBtn = document.getElementById('newGameBtn');
        if (newGameBtn !== null) 
        {
            newGameBtn.onclick = () => {
                if (!S.mySlot) {
                    if ((S.slots.player1 || S.slots.player2) && !S.computerSlot) {
                        qiAlert('只有对局者可以开始新局。');
                        return;
                    }
                    qiConfirm('确定开始新局吗？').then(ok => {
                        if (ok) S.ws.send(JSON.stringify({ type: 'requestNewGame' }));
                    });
                    return;
                }
                const opponentSlot = S.mySlot === 'player1' ? 'player2' : 'player1';
                const hasHumanOpponent = S.slots[opponentSlot] && S.computerSlot !== opponentSlot;
                if (hasHumanOpponent) {
                    qiConfirm('确定向对方申请开始新局吗？').then(ok => { if (ok) S.ws.send(JSON.stringify({ type: 'requestNewGame' })); });
                } else {
                    qiConfirm('确定开始新局吗？').then(ok => { if (ok) S.ws.send(JSON.stringify({ type: 'requestNewGame' })); });
                }
                return;
            };
        }

        const estimateBtn = document.getElementById('estimateBtn');
        if (estimateBtn !== null) 
        {
            estimateBtn.onclick = () => {
                S.showEstimateActive = !S.showEstimateActive;
                if (S.showEstimateActive) ctx.showEstimate();
                else ctx.clearEstimate();
            };
        }

        const tryPlayBtn = document.getElementById('tryPlayBtn');
        if (tryPlayBtn !== null) 
        {
            tryPlayBtn.onclick = () => {
                if (S.tryPlayMode) {
                    ctx.exitTryPlay();
                    S.seatOverlayForceHide = false;
                    updateSeatOverlay();
                } else {
                    ctx.enterTryPlay();
                    S.seatOverlayForceHide = true;
                    updateSeatOverlay();
                }
                qiSyncTryPlayActionButtons(S);
            };
        }

        const passBtn = document.getElementById('passBtn');
        if (passBtn !== null)
        {
            passBtn.onclick = () => {
                // 试下中：直接走一步虚着（不用对方确认，也不发消息；捕获阶段的接管见 qiInstallTryPlayActionControls）
                if (S.tryPlayMode) { runTryPlayPass(); return; }
                if (!S.isMyTurn) return;
                S.ws.send(JSON.stringify({ type: 'pass' }));
            };
        }

        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn !== null)
        {
            undoBtn.onclick = () => {
                // 试下中：直接退回上一手（不用对方确认，也不发消息）
                if (S.tryPlayMode) { runTryPlayUndo(); return; }
                if (!S.mySlot) { qiAlert('只有对局者可以悔棋'); return; }
                const opponentSlot = S.mySlot === 'player1' ? 'player2' : 'player1';
                const hasOpponent = S.slots[opponentSlot];
                if (hasOpponent) {
                    qiConfirm('确定向对方申请悔棋吗？').then(ok => { if (ok) S.ws.send(JSON.stringify({ type: 'requestUndo' })); });
                } else {
                    qiConfirm('确定悔棋吗？').then(ok => { if (ok) S.ws.send(JSON.stringify({ type: 'requestUndo' })); });
                }
            };
        }

        const resignBtn = document.getElementById('resignBtn');
        if (resignBtn !== null) 
        {
            resignBtn.onclick = () => {
                if (!S.mySlot) { qiAlert('只有对局者可以认输'); return; }
                qiConfirm('确定认输吗？').then(ok => { if (ok) S.ws.send(JSON.stringify({ type: 'resign' })); });
            };
        }

        const drawBtn = document.getElementById('drawBtn');
        if (drawBtn !== null) 
        {
            drawBtn.onclick = () => {
                if (!S.mySlot) { qiAlert('只有对局者可以申请和棋'); return; }
                const opponentSlot = S.mySlot === 'player1' ? 'player2' : 'player1';
                const hasOpponent = S.slots[opponentSlot];
                if (hasOpponent) {
                    qiConfirm('确定向对方申请和棋吗？').then(ok => { if (ok) S.ws.send(JSON.stringify({ type: 'requestDraw' })); });
                } else {
                    qiConfirm('确定和棋吗？').then(ok => { if (ok) S.ws.send(JSON.stringify({ type: 'requestDraw' })); });
                }
            };
        }

        const endReqBtn = document.getElementById('endReqBtn');
        if (endReqBtn !== null) 
        {
            endReqBtn.onclick = () => {
                if (!S.mySlot) { qiAlert('只有对局者可以申请数点'); return; }
                S.ws.send(JSON.stringify({ type: 'requestEnd' }));
            };
        }

        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn !== null) 
        {
            exportBtn.onclick = () => {
                S.ws.send(JSON.stringify({ type: 'exportRecord' }));
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
                S.showMoveNumbers = e.target.checked;
                ctx.drawBoard();
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
                        S.ws.send(JSON.stringify({ type: 'importRecord', data }));
                    } catch (err) {
                        qiAlert('棋谱文件解析失败');
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
                if (S.ws && S.ws.readyState === WebSocket.OPEN)
                    S.ws.send(JSON.stringify({ type: 'setBoardSize', size: newSize }));
            });
        }

        const backToLobbyBtn = document.getElementById('backToLobbyBtn');
        if (backToLobbyBtn !== null)
            backToLobbyBtn.onclick = () => { qiLeaveRoomAndGoLobby(); };

        // 执子单选文字（左=player1、右=player2，按棋种执方命名）——放在块外，状态刷新时也能更新
        const applySeatRadioText = () => {
            const seatLabel = (slot) => {
                const ui = ctx.slotUi && ctx.slotUi[slot];
                if (ui && ui.choiceText) return ui.choiceText;
                const name = (S.sideLabels && S.sideLabels[slot]) || (ctx.sideLabels && ctx.sideLabels[slot]) || '';
                if (name) return '执' + String(name).replace(/方$/, '');
                return slot === 'player1' ? '执先手' : '执后手';
            };
            const seatEmoji = (slot) => {
                const ui = ctx.slotUi && ctx.slotUi[slot];
                return (ui && ui.emoji) || '';
            };
            [['player1', ctx.radioBlack, 'labelBlack'], ['player2', ctx.radioWhite, 'labelWhite']].forEach(([slot, radio, labelId]) => {
                const label = document.getElementById(labelId) || (radio && radio.parentElement);
                if (!label) return;
                const text = ' ' + [seatEmoji(slot), seatLabel(slot)].filter(Boolean).join(' ');
                for (const node of label.childNodes) {
                    if (node.nodeType === 3 && node.textContent.trim()) node.textContent = text;
                }
            });
        };
        applySeatRadioText();
        if (!ctx.boardSeatOverlay) {
            if (ctx.radioBlack)
                ctx.radioBlack.onchange = function () { if (this.checked && !this.disabled) S.ws.send(JSON.stringify({ type: 'selectColor', color: 'player1' })); };
            if (ctx.radioWhite)
                ctx.radioWhite.onchange = function () { if (this.checked && !this.disabled) S.ws.send(JSON.stringify({ type: 'selectColor', color: 'player2' })); };
        }

        if (ctx.boardSeatOverlay)
            updateSeatOverlay();
        if (typeof applySeatRadioText === 'function') applySeatRadioText();

        const replayBackBtn = document.getElementById('replayBackBtn');
        if (replayBackBtn !== null)
        {
            replayBackBtn.onclick = () => {
                if (S.replayMode) {
                    if (S.tryPlayMode) ctx.setTryPlayStep(S.tryPlayStep - 1);
                    else ctx.setReplayStep(S.replayStep - 1);
                } else {
                    ctx.setLiveViewStep(S.liveViewStep - 1);
                }
            };
        }
        
        const replayForwardBtn = document.getElementById('replayForwardBtn');
        if (replayForwardBtn !== null)
        {
            replayForwardBtn.onclick = () => {
                if (S.replayMode) {
                    if (S.tryPlayMode) ctx.setTryPlayStep(S.tryPlayStep + 1);
                    else ctx.setReplayStep(S.replayStep + 1);
                } else {
                    ctx.setLiveViewStep(S.liveViewStep + 1);
                }
            };
        }

        const replaySlider = document.getElementById('replaySlider');
        if (replaySlider !== null)
        {
            replaySlider.addEventListener('input', (e) => {
                if (S._suppressReplaySliderInput) return;
                const val = parseInt(e.target.value, 10);
                if (S.replayMode) {
                    if (S.tryPlayMode) ctx.setTryPlayStep(val);
                    else ctx.setReplayStep(val);
                } else {
                    ctx.setLiveViewStep(val);
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
        return { handleMessage, updateRecordButtons, updateRadioStyles, updateSeatOverlay, updateVsComputerBtn };
    }

    const QiBoardRoomClient = {
        openRoomWebSocket: qiOpenRoomWebSocket,
        registerRoomSocket: qiRegisterRoomSocket,
        leaveRoomIntentionally: qiLeaveRoomIntentionally,
        leaveRoomAndGoLobby: qiLeaveRoomAndGoLobby,
        createWeiqiMessageBindings,
        createStandardWeiqiMatchTimeController: qiCreateStandardWeiqiMatchTimeController
    };

    global.qiOpenRoomWebSocket = qiOpenRoomWebSocket;
    global.qiRegisterRoomSocket = qiRegisterRoomSocket;
    global.qiLeaveRoomIntentionally = qiLeaveRoomIntentionally;
    global.qiLeaveRoomAndGoLobby = qiLeaveRoomAndGoLobby;
    global.QiBoardRoomClient = QiBoardRoomClient;

    // 捕获期拦截「返回大厅」，覆盖各插件自行绑定的 location.href
    if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            const btn = t.closest('#backToLobbyBtn');
            if (!btn) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            qiLeaveRoomAndGoLobby();
        }, true);
        window.addEventListener('pagehide', () => { qiLeaveRoomIntentionally(); });
        window.addEventListener('beforeunload', () => { qiLeaveRoomIntentionally(); });
    }
})(typeof window !== 'undefined' ? window : global);

/* ========== 3. 方格棋盘（QiSquareWeiqiCanvas） ==========
 * 星位、空棋盘、几何、形势判断 DOM、棋盘绘制、标准房间 WebSocket。
 * 三角/六角/扭棱等非方格棋盘请勿使用绘制部分。
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
        const padding = 475 / boardSize;
        const cellSize = (cs - 2 * padding) / (boardSize - 1);
        return { padding, cellSize, canvasSize: cs };
    }

    function getClosestIntersection(x, y, boardSize, padding, cellSize) {
        const col = Math.round((x - padding) / cellSize);
        // 画布顶部 = 大行号(row=boardSize-1),底部 = row 0(小号在下)
        const row = boardSize - 1 - Math.round((y - padding) / cellSize);
        if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return { row: -1, col: -1 };
        return { row, col };
    }

    /** 落在格内的棋盘（权重围棋等）：命中最近的格子（按格心距离） */
    function getClosestCell(x, y, boardSize, padding, cellSize) {
        let bestRow = -1;
        let bestCol = -1;
        let bestDist = Infinity;
        for (let r = 0; r < boardSize; r++) {
            const cy = padding + (boardSize - 1 - r) * cellSize + cellSize / 2;
            for (let c = 0; c < boardSize; c++) {
                const cx = padding + c * cellSize + cellSize / 2;
                const d = Math.hypot(x - cx, y - cy);
                if (d < bestDist) { bestDist = d; bestRow = r; bestCol = c; }
            }
        }
        return { row: bestRow, col: bestCol };
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
        scoreBoard.innerText = `黑: ${Number(blackTotal.toFixed(2))}　白: ${Number(whiteTotal.toFixed(2))}`;
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

        grid(ctx, boardSize, padding, cellSize, canvasSize, strokeInvScale) {
            const cs = canvasSize != null ? canvasSize : DEFAULT_CANVAS_SIZE;
            ctx.strokeStyle = '#3a281c';
            let lw = 1.5;
            if (strokeInvScale != null && strokeInvScale > 0 && strokeInvScale < 1)
                lw = Math.max(0.5, 28 / boardSize * strokeInvScale);
            ctx.lineWidth = lw;
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
                ctx.arc(padding + c * cellSize, padding + (boardSize - 1 - r) * cellSize, cellSize * 0.12, 0, 2 * Math.PI);
                ctx.fill();
            }
        },

        coordLabels(ctx, boardSize, padding, cellSize) {
            ctx.font = `bold ${250 / boardSize}px Arial`;
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
                // 行号从上到下从大到小（GTP 惯例：顶部 = 路数）
                const number = (boardSize - r).toString();
                const x = padding / 2;
                const y = padding + r * cellSize;
                ctx.fillText(number, x, y);
            }
        },

        /** 显示序号或形势判断时：三角形最后落子标记（在棋子下方） */
        lastMoveMarkersLower(ctx, lastMoveMarkers, padding, cellSize, stoneRadius, boardSize) {
            for (let { row, col, color } of lastMoveMarkers) {
                const x = padding + col * cellSize;
                const y = padding + (boardSize - 1 - row) * cellSize;
                ctx.beginPath();
                ctx.moveTo(x + stoneRadius, y + stoneRadius);
                ctx.lineTo(x, y + stoneRadius);
                ctx.lineTo(x + stoneRadius, y);
                ctx.closePath();
                ctx.fillStyle = color === 2 ? '#222' : '#fff';
                ctx.fill();
            }
        },

        stonesBlackWhite(ctx, board, boardSize, padding, cellSize, stoneRadius, showMoveNumbers, shadowInvScale) {
            const shInv = shadowInvScale != null && shadowInvScale > 0 ? shadowInvScale : 1;
            const glossOffset = 3 * shInv;
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const val = board[r][c];
                    if (val !== 1 && val !== 2) continue;
                    const x = padding + c * cellSize;
                    const y = padding + (boardSize - 1 - r) * cellSize;
                    const radius = stoneRadius;
                    ctx.save();
                    ctx.shadowBlur = 6 * shInv;
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowOffsetY = 2 * shInv;
                    const grad = ctx.createRadialGradient(x - glossOffset, y - glossOffset, radius * 0.2, x, y, radius * 1.2);
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
                        ctx.arc(x - glossOffset, y - glossOffset, radius * 0.15, 0, 2 * Math.PI);
                        ctx.fillStyle = val === 1 ? '#444' : '#fff';
                        ctx.fill();
                    }
                }
            }
        },

        /** 直角三角形最后落子标记（棋子之上） */
        lastMoveMarkersUpper(ctx, lastMoveMarkers, padding, cellSize, markLen, boardSize) {
            for (let { row, col, color } of lastMoveMarkers) {
                const x = padding + col * cellSize;
                const y = padding + (boardSize - 1 - row) * cellSize;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + markLen, y);
                ctx.lineTo(x, y + markLen);
                ctx.closePath();
                ctx.fillStyle = color === 2 ? '#222' : '#fff';
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
                const y = padding + (boardSize - 1 - r) * cellSize;
                const markBgR = cellSize * 0.3;
                ctx.beginPath();
                ctx.arc(x, y, markBgR, 0, 2 * Math.PI);
                ctx.fillStyle = '#fdcc90';
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
                        const sy = padding + (boardSize - 1 - r) * cellSize;
                        const numStr = nums[r][c].toString();
                        const fontSize = Math.max(9, Math.floor(cellSize * (numStr.length >= 3 ? 0.34 : 0.44)));
                        ctx.font = `bold ${fontSize}px Arial`;
                        ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#000';
                        ctx.fillText(numStr, sx, sy + 1);
                    }
                }
            }
        },

        hoverPreviewStone(ctx, hoverRow, hoverCol, board, padding, cellSize, options) {
            const { tryPlayMode, tryPlayCurrentPlayer, gameOver, isMyTurn, mySlot } = options;
            const ps = options.pageState;
            const editCb = typeof document !== 'undefined' ? document.getElementById('editModeCheckbox') : null;
            const editSel = typeof document !== 'undefined' ? document.getElementById('editToolSelect') : null;
            const editMode = !!(options.editModeEnabled != null
                ? options.editModeEnabled
                : ((ps && ps.editModeEnabled) || (editCb && editCb.checked)));
            const canHover = editMode || tryPlayMode || (!gameOver && isMyTurn);
            if (!canHover || hoverRow < 0 || hoverCol < 0) return;
            if (!options.isHoverValid) return;
            if (!editMode && board[hoverRow][hoverCol] !== 0) return;
            if (!editMode && options.hoverCapture) return;

            if (editMode) {
                const RT = global.QiWeiqiSquarePageRuntime;
                const tool = (options.editTool != null
                    ? options.editTool
                    : ((ps && ps.editTool) || (editSel && editSel.value))) || 'empty';
                const defaults = (RT && RT.DEFAULT_EDIT_CELL_BY_TOOL) || {
                    empty: 0, black: 1, white: 2, hole: -1, bridge: -2, mine: -3, neutral: 10000
                };
                const valueMap = Object.assign({}, defaults, options.editToolValues || null);
                const cellVal = (RT && typeof RT.resolveEditToolCellValue === 'function')
                    ? RT.resolveEditToolCellValue(tool, valueMap)
                    : (Object.prototype.hasOwnProperty.call(valueMap, tool) ? valueMap[tool] : 0);
                const boardSize = options.boardSize
                    || (ps && (ps.BOARD_SIZE || ps.boardSize))
                    || (board && board.length)
                    || 19;
                const holeStyle = options.holeDisplayStyle
                    || (ps && ps.holeDisplayStyle)
                    || 'block';
                // 空：无悬停预览
                if (cellVal === 0 || tool === 'empty') return;
                const x = padding + hoverCol * cellSize;
                const y = padding + (boardSize - 1 - hoverRow) * cellSize;
                ctx.save();
                ctx.globalAlpha = 0.45;
                if (cellVal === 1 || cellVal === 2) {
                    ctx.beginPath();
                    ctx.arc(x, y, cellSize * 0.44, 0, 2 * Math.PI);
                    ctx.fillStyle = cellVal === 1 ? '#222' : '#fff';
                    ctx.fill();
                } else if (cellVal === -1 && RT) {
                    if (holeStyle === 'void' && RT.drawVoidHole)
                        RT.drawVoidHole(hoverRow, hoverCol, ctx, padding, cellSize, boardSize);
                    else if (holeStyle === 'hole' && RT.drawPitHole)
                        RT.drawPitHole(hoverRow, hoverCol, ctx, padding, cellSize, boardSize, () => true);
                    else if (RT.drawRedBlockHole)
                        RT.drawRedBlockHole(hoverRow, hoverCol, ctx, padding, cellSize, boardSize);
                } else if (cellVal === -2 && RT && RT.drawBridge) {
                    RT.drawBridge(hoverRow, hoverCol, ctx, padding, cellSize, boardSize);
                } else if (cellVal === -3 && RT && typeof RT.drawMine === 'function') {
                    RT.drawMine(hoverRow, hoverCol, ctx, padding, cellSize, boardSize);
                } else if (cellVal === -3) {
                    const r = cellSize * 0.28;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, 2 * Math.PI);
                    ctx.fillStyle = '#222';
                    ctx.fill();
                } else if ((cellVal === 10000 || tool === 'neutral') && RT) {
                    if (typeof RT.drawNeutralStone === 'function')
                        RT.drawNeutralStone(hoverRow, hoverCol, ctx, padding, cellSize, boardSize);
                    else if (typeof RT.neutralDrawSmallMarker === 'function')
                        RT.neutralDrawSmallMarker(ctx, x, y, cellSize * 0.36);
                }
                ctx.restore();
                return;
            }

            ctx.globalAlpha = 0.45;
            const bsHover = (board && board.length) || 19;
            ctx.beginPath();
            ctx.arc(padding + hoverCol * cellSize, padding + (bsHover - 1 - hoverRow) * cellSize, cellSize * 0.44, 0, 2 * Math.PI);
            const hoverColor = tryPlayMode
                ? (tryPlayCurrentPlayer === 1 ? '#222' : '#fff')
                : (mySlot === 'player1' ? '#222' : '#fff');
            ctx.fillStyle = hoverColor;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        },

        hoverCaptureRing(ctx, hoverRow, hoverCol, padding, cellSize, stoneRadius, options) {
            const { tryPlayMode, gameOver, isMyTurn, isHoverValid, hoverCapture } = options;
            const strokeInv = options && options.strokeInvScale != null && options.strokeInvScale > 0
                ? options.strokeInvScale
                : 1;
            const canHover = tryPlayMode || (!gameOver && isMyTurn);
            if (!canHover || !hoverCapture || !isHoverValid || hoverRow < 0 || hoverCol < 0) return;
            const x = padding + hoverCol * cellSize;
            const y = padding + ((options.boardSize || 19) - 1 - hoverRow) * cellSize;
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, stoneRadius + 1, 0, 2 * Math.PI);
            ctx.strokeStyle = '#d62828';
            ctx.lineWidth = cellSize * 0.055 * strokeInv;
            ctx.stroke();
            ctx.restore();
        },

        estimateOverlay(ctx, board, boardSize, padding, cellSize, cachedLiveBoard, cachedTerritory) {
            if (!cachedLiveBoard || !cachedTerritory) return;
            const dotRadius = cellSize * 0.18;
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if ((board[r][c] === 1 || board[r][c] === 2) && cachedLiveBoard[r][c] === 0) {
                        const x = padding + c * cellSize;
                        const y = padding + (boardSize - 1 - r) * cellSize;
                        ctx.fillStyle = board[r][c] === 1 ? '#fff' : '#222';
                        ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                    } else if (board[r][c] === 0 && cachedTerritory[r][c] === 1) {
                        const x = padding + c * cellSize;
                        const y = padding + (boardSize - 1 - r) * cellSize;
                        ctx.fillStyle = '#222';
                        ctx.fillRect(x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
                    } else if (board[r][c] === 0 && cachedTerritory[r][c] === 2) {
                        const x = padding + c * cellSize;
                        const y = padding + (boardSize - 1 - r) * cellSize;
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
                qiAlert('房间不存在，请返回大厅');
                window.location.href = '/qi';
                return;
            }
            // 返回大厅 / 关页主动 leave 后不再重连，避免幽灵占座
            if (typeof window !== 'undefined' && window.__qiRoomLeaving) return;
            if (o.colorStatus) o.colorStatus.innerText = '连接断开，重连中...';
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

    /**
     * HiDPI：按 CSS 显示尺寸与 devicePixelRatio 设置 backing store，
     * 并把变换设为逻辑坐标（logicalSize × logicalSize，默认 600）。
     */
    function setupHiDpiCanvas(canvas, logicalSize) {
        if (!canvas) return null;
        const logical = logicalSize > 0 ? logicalSize : DEFAULT_CANVAS_SIZE;
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const rect = canvas.getBoundingClientRect();
        const css = (rect && rect.width > 0) ? rect.width : logical;
        const backing = Math.max(1, Math.round(css * dpr));
        if (canvas.width !== backing || canvas.height !== backing) {
            canvas.width = backing;
            canvas.height = backing;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const scale = backing / logical;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.imageSmoothingEnabled = true;
        return ctx;
    }

    /* ===== 棋盘木纹（程序化生成，不用图片素材） =====
     * 做法：1D 不规则「线剖面」(线心位置/间距/深浅/宽度全部随机) + 2D 弯曲场采样
     *       + 沿线淡出(线在长度方向时隐时现) + 纤维层 + 明暗块 + 细颗粒。
     * 关键点：
     *   - 线距不规则、深浅偏态(多数淡、少数深)、且沿线淡出 → 不会出现"代码条纹"的规整感；
     *   - 弯曲场的波长远大于线距 → 线条是长直纹+缓弯，而不是同步摆动；
     *   - 纹理只贡献「相对底色的偏离」，幅度归一化到参考贴图的 std，因此底色均值不变。
     * 生成一次后按 (底色,尺寸,预设,强度) 缓存，同一会话内复用。
     */
    const WOOD_TEXTURE_PRESET = 'liuguan';     // 用哪套木纹预设（'liuguan' 竖直 / 'chengshuang' 水平浅色）
    const WOOD_CELL_REF = 512;                 // 预设中的格点数以此尺寸为基准，生成时按比例缩放
    const WOOD_PRESETS = {
        // 竖直木纹（橡木/白蜡风格，中等对比）
        liuguan: {
            seed: 7, vertical: true, profScale: 4, blur: 0,
            spacing: 9.0, depth: 0.62, lineW: 1.8, drift: 0.35,
            bundle: 2, bundleGap: 1.5,
            fiberSpacing: 1.1, fiber: 0.70, fiberW: 0.55,
            warpCells: [1.0, 1.0], warpOct: 1, warpCycles: 0.5,   // 缓慢起伏：大体直、小弯小曲
            wobbleCells: [4.0, 3.0], wobble: 0.02,
            deepSkew: 6.0,                  // 深线稀有度：越大深线越少
            compressCells: [2.5, 3.0], compress: 0,   // 压缩场会沿纹理方向推移线条 → 造成波形感，不用
            densCells: [5.0, 1.5], densZ0: -0.8, densZ1: 0.3, fiberFloor: 0.30,
            groupSize: 4, groupCellsV: 5, groupJitter: 0.20,
            fadeCells: [3.0, 4.0], fadeMin: 0.12,
            toneCells: [3.0, 3.5], tone: 0.14,
            speckCells: [240, 240], speck: 0.15,
            // 全局幅度：参考图为 7.05，这里调低以压低"深色比例"
            targetStd: 5.6, chRatio: [0.94, 1.04, 1.09],
        },
        // 水平浅色木纹（北欧白木风格，细横纹、低对比）
        chengshuang: {
            seed: 21, vertical: false, profScale: 4, blur: 0,
            spacing: 7.0, depth: 0.48, lineW: 1.5, drift: 0.30,
            bundle: 2, bundleGap: 1.4,
            fiberSpacing: 1.6, fiber: 0.28, fiberW: 0.5,
            warpCells: [1.1, 1.1], warpOct: 1, warpCycles: 0.4,
            wobbleCells: [5.0, 4.0], wobble: 0.02,
            deepSkew: 6.0,
            compressCells: [2.5, 3.0], compress: 0,
            densCells: [4.0, 1.2], densZ0: -0.5, densZ1: 0.6, fiberFloor: 0.30,
            groupSize: 5, groupCellsV: 4, groupJitter: 0.16,
            fadeCells: [5.0, 6.0], fadeMin: 0.40,
            toneCells: [2.5, 3.0], tone: 0.14,
            speckCells: [230, 230], speck: 0.10,
            targetStd: 3.9, chRatio: [0.85, 1.06, 1.28],
        },
    };
    const woodTextureCache = Object.create(null);

    function parseCssRgb(str) {
        const t = (str || '').trim();
        const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(t);
        if (m) return [+m[1], +m[2], +m[3]];
        const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
        if (hex) {
            const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        }
        return null;
    }

    /** 棋盘木色的来源：CSS 变量 --qi-room-board（改主题色时木纹自动跟随） */
    function boardBaseColor() {
        return parseCssRgb(getComputedStyle(document.body).getPropertyValue('--qi-room-board'))
            || parseCssRgb(getComputedStyle(document.body).getPropertyValue('--qi-room-board-fallback'))
            || [253, 204, 144];
    }

    /** 画布级随机种子：同一块画布复用，换房间/刷新重掷 */
    function woodSeedFor(canvasEl) {
        if (!canvasEl) return (Math.random() * 0x7fffffff) | 0;
        let seed = canvasEl.__qiWoodSeed;
        if (seed == null) {
            seed = (Math.random() * 0x7fffffff) | 0;
            canvasEl.__qiWoodSeed = seed;
        }
        return seed;
    }

    function woodRng(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function woodValueNoise(nx, ny, rnd) {
        const g = new Float32Array(nx * ny);
        for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1;
        return function (u, v) {
            const gx = u * nx, gy = v * ny;
            const ix = gx | 0, iy = gy | 0;
            const fx0 = gx - ix, fy0 = gy - iy;
            const fx = fx0 * fx0 * (3 - 2 * fx0), fy = fy0 * fy0 * (3 - 2 * fy0);
            const x0 = Math.min(ix, nx - 1), y0 = Math.min(iy, ny - 1);
            const x1 = Math.min(ix + 1, nx - 1), y1 = Math.min(iy + 1, ny - 1);
            const a = g[y0 * nx + x0], b = g[y0 * nx + x1], c = g[y1 * nx + x0], d = g[y1 * nx + x1];
            const top = a + (b - a) * fx, bot = c + (d - c) * fx;
            return top + (bot - top) * fy;
        };
    }

    // 低频场：在粗网格上算 fbm 再双线性放大；cellsU/cellsV = 场在 x/y 方向的格点数
    function woodField(res, rnd, cellsU, cellsV, octaves, gain) {
        const layers = [];
        let tot = 0;
        for (let i = 0; i < octaves; i++) {
            const f = Math.pow(2, i), w = Math.pow(gain, i);
            layers.push([woodValueNoise(Math.max(2, Math.round(cellsU * f)), Math.max(2, Math.round(cellsV * f)), rnd), w]);
            tot += w;
        }
        const c = new Float32Array(res * res);
        for (let y = 0; y < res; y++) {
            const v = y / res;
            for (let x = 0; x < res; x++) {
                const u = x / res;
                let s = 0;
                for (let i = 0; i < layers.length; i++) s += layers[i][0](u, v) * layers[i][1];
                c[y * res + x] = s / tot;
            }
        }
        let m = 0; for (let i = 0; i < c.length; i++) m += c[i]; m /= c.length;
        let sq = 0; for (let i = 0; i < c.length; i++) { const d = c[i] - m; sq += d * d; }
        const fn = function (u, v) {                 // 双线性放大
            const gx = u * (res - 1), gy = v * (res - 1);
            const ix = Math.min(res - 2, gx | 0), iy = Math.min(res - 2, gy | 0);
            const fx = gx - ix, fy = gy - iy;
            const a = c[iy * res + ix], b = c[iy * res + ix + 1];
            const d = c[(iy + 1) * res + ix], e = c[(iy + 1) * res + ix + 1];
            const top = a + (b - a) * fx, bot = d + (e - d) * fx;
            return top + (bot - top) * fy;
        };
        fn.mean = m; fn.std = Math.sqrt(sq / c.length) || 1;   // 供按 z 值做阈值映射
        return fn;
    }

    // 往剖面里画一条线（中心深、两侧渐淡的不对称剖面）
    function woodAddLine(out, n, center, d, wd) {
        const lo = Math.max(0, Math.floor(center - wd * 3));
        const hi = Math.min(n - 1, Math.ceil(center + wd * 4));
        for (let i = lo; i <= hi; i++) {
            const t = (i - center) / wd;
            out[i] += d * (t < 0 ? 0.65 * Math.exp(-(t / 0.7) * (t / 0.7))
                                 : 0.35 * Math.exp(-(t / 1.5) * (t / 1.5)));
        }
    }

    // 1D 线剖面：不规则间距 + 偏态深浅 + 不定宽度 + 成束(1~bundle 条紧挨的线)
    // 真实木纹的线是成束出现的，束内几条细线、束间留白，这是"丰富不单调"的关键
    function woodBuildProfile(out, n, rnd, spacing, depthMean, widthMean, drift, jitter, bundle, bundleGap, deepSkew) {
        const skew = deepSkew || 6.0;
        let center = rnd() * spacing;
        let dens = 0;
        const bg = bundleGap || 2.2;
        while (center < n) {
            dens += (rnd() * 2 - 1) * 0.18;
            if (dens > drift) dens = drift; else if (dens < -drift) dens = -drift;
            const jit = jitter ? (0.35 + 1.5 * Math.pow(rnd(), 1.6)) : 1;
            const step = spacing * (1 + dens) * jit;
            const strong = Math.pow(rnd(), 1.6);                  // 少数束很深
            const m = 1 + Math.floor(Math.pow(rnd(), 1.3) * (bundle - 1 + 1e-6));
            let c = center;
            for (let k = 0; k < m; k++) {
                const d0 = depthMean * (0.04 + 1.7 * Math.pow(strong, skew)) * (k === 0 ? 1 : 0.3 + 0.5 * rnd());
                const wd0 = widthMean * (0.35 + 2.8 * Math.pow(rnd(), 1.6)) * (k === 0 ? 1 : 0.6);
                woodAddLine(out, n, c, d0, wd0);
                c += bg * (0.8 + 1.6 * rnd());
            }
            center += step;
        }
    }

    // 可分离箱式模糊(迭代 3 次近似高斯)，边缘钳位；radius 单位=像素
    function woodBlur(val, size, radius) {
        const r = Math.max(1, Math.round(radius));
        const passes = radius < 1.5 ? 1 : 3;   // 小半径只做 1 次(3 次会把 1~2px 的纤维抹平)
        let src = val, dst = new Float32Array(val.length);
        for (let pass = 0; pass < passes; pass++) {
            for (let y = 0; y < size; y++) {
                const row = y * size;
                let sum = 0;
                for (let x = -r; x <= r; x++) sum += src[row + Math.min(size - 1, Math.max(0, x))];
                for (let x = 0; x < size; x++) {
                    dst[row + x] = sum / (2 * r + 1);
                    const o = row + Math.min(size - 1, Math.max(0, x - r));
                    const i = row + Math.min(size - 1, Math.max(0, x + r + 1));
                    sum += src[i] - src[o];
                }
            }
            let t = src; src = dst; dst = t;
            for (let x = 0; x < size; x++) {
                let sum = 0;
                for (let y = -r; y <= r; y++) sum += src[Math.min(size - 1, Math.max(0, y)) * size + x];
                for (let y = 0; y < size; y++) {
                    dst[y * size + x] = sum / (2 * r + 1);
                    const o = Math.min(size - 1, Math.max(0, y - r)) * size + x;
                    const i = Math.min(size - 1, Math.max(0, y + r + 1)) * size + x;
                    sum += src[i] - src[o];
                }
            }
            const t2 = src; src = dst; dst = t2;
        }
        return src;
    }

    function woodSampleProfile(prof, pos) {
        const n = prof.length;
        let p = pos % n; if (p < 0) p += n;
        const i0 = p | 0, f = p - i0;
        const i1 = i0 + 1 >= n ? 0 : i0 + 1;
        return prof[i0] * (1 - f) + prof[i1] * f;
    }

    /** 生成 size×size 木纹画布：底色 base 均值不变，只叠木纹偏离 */
    function makeWoodTextureCanvas(size, base, presetName, opt) {
        const P = Object.assign({}, WOOD_PRESETS[presetName] || WOOD_PRESETS.liuguan, opt || {});
        const S = size / WOOD_CELL_REF;          // 尺度无关：生成尺寸变化时观感一致
        const rnd = woodRng(P.seed);
        const n = size * P.profScale;
        const prof = new Float32Array(n);
        woodBuildProfile(prof, n, rnd, P.spacing * S * P.profScale, P.depth, P.lineW * S * P.profScale, P.drift, true,
                         P.bundle || 1, (P.bundleGap || 2.2) * S * P.profScale, P.deepSkew);
        const fprof = new Float32Array(n);
        woodBuildProfile(fprof, n, rnd, P.fiberSpacing * S * P.profScale, P.fiber, P.fiberW * S * P.profScale, P.drift, false, 1, 0, 3.0);

        const period = P.spacing * S * P.profScale;
        const RES = Math.max(64, Math.min(256, size >> 2));
        const warp = woodField(RES, rnd, P.warpCells[0] * S, P.warpCells[1] * S, P.warpOct, 0.5);
        const wobble = woodField(RES, rnd, P.wobbleCells[0] * S, P.wobbleCells[1] * S, 2, 0.5);
        const tone = woodField(RES, rnd, P.toneCells[0] * S, P.toneCells[1] * S, 2, 0.5);
        const fade = woodField(RES, rnd, P.fadeCells[0] * S, P.fadeCells[1] * S, 2, 0.5);
        const spk = woodField(size, rnd, P.speckCells[0] * S, P.speckCells[1] * S, 2, 0.5);
        // 局部密度：有的区域线挤紧、有的舒展（真实木料绝非均匀分布）
        const compress = woodField(RES, rnd, P.compressCells[0] * S, P.compressCells[1] * S, 2, 0.5);
        // 成组弯曲：按「组号」取噪声 → 一组线整体弯向同一方向、组内互相平行，组间弯度方向各异
        // （真实木纹就是这样成束出现的，而不是每条线各自乱弯、也不是全盘一起摆）
        const lineCount = Math.max(8, Math.round(n / period));
        const groupSize = Math.max(1, P.groupSize || 4);
        const groupCells = Math.max(2, Math.round(lineCount / groupSize));
        const groupJit = woodField(Math.max(64, groupCells), rnd, groupCells, P.groupCellsV || 5, 2, 0.5);
        // 疏密场：竖条带状，低处线完全消失(最稀疏处为 0)、高处满密度
        const densF = woodField(RES, rnd, P.densCells[0] * S, P.densCells[1] * S, 2, 0.5);

        const val = new Float32Array(size * size);
        for (let y = 0; y < size; y++) {
            const v = y / size;
            for (let x = 0; x < size; x++) {
                const u = x / size;
                const U = P.vertical ? u : v, V = P.vertical ? v : u;
                let pos = U * n * (1 + compress(U, V) * P.compress)
                        + (warp(U, V) * P.warpCycles + wobble(U, V) * P.wobble) * period;
                if (P.groupJitter > 0) {
                    let li = Math.floor(pos / period) % lineCount;
                    if (li < 0) li += lineCount;
                    pos += P.groupJitter * period * groupJit(li / lineCount, V);
                }
                // 疏密：按疏密场的 z 值映射，最稀疏处为 0(完全无线条)，最密处为 1
                const z = (densF(U, V) - densF.mean) / densF.std;
                let presence = (z - P.densZ0) / (P.densZ1 - P.densZ0);
                presence = presence < 0 ? 0 : presence > 1 ? 1 : presence;
                const fd = P.fadeMin + (1 - P.fadeMin) * (fade(U, V) * 0.5 + 0.5);
                val[y * size + x] = 1 - woodSampleProfile(prof, pos) * fd * presence
                    - woodSampleProfile(fprof, pos) * (0.55 + 0.45 * fd)
                      * (P.fiberFloor + (1 - P.fiberFloor) * presence)
                    + tone(U, V) * P.tone + spk(U, V) * P.speck;
            }
        }
        // 柔化：木纹是拍出来的，边缘要软，不能像矢量线
        const field = P.blur > 0 ? woodBlur(val, size, P.blur * S) : val;
        // 幅度归一化到目标 std，再叠到底色 → 纹理平均色 = 底色，颜色不变
        let sum = 0; for (let i = 0; i < field.length; i++) sum += field[i];
        const mean = sum / field.length;
        let sq = 0; for (let i = 0; i < field.length; i++) { const d = field[i] - mean; sq += d * d; }
        const k = (P.targetStd * (P.strength != null ? P.strength : 1)) / (Math.sqrt(sq / field.length) || 1);
        const cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        const cctx = cv.getContext('2d');
        const img = cctx.createImageData(size, size);
        const data = img.data;
        for (let i = 0; i < field.length; i++) {
            const d = (field[i] - mean) * k;
            for (let c = 0; c < 3; c++) {
                const col = base[c] + d * P.chRatio[c];
                data[i * 4 + c] = col < 0 ? 0 : col > 255 ? 255 : col;
            }
            data[i * 4 + 3] = 255;
        }
        cctx.putImageData(img, 0, 0);
        return cv;
    }

    /**
     * 异形棋盘（三角/六角/扭棱/扭曲空间等「画布自绘木色」的棋种）用：
     * 返回铺满整块逻辑画布的木纹图案，直接拿来当 fillStyle 填自己的棋盘形状即可。
     * 图案只铺一次(no-repeat)、边长＝逻辑画布尺寸，所以不会被平铺重复。
     * @param {CanvasRenderingContext2D} ctx
     * @param {HTMLCanvasElement} canvasEl 用于绑定随机种子（同一块画布木纹稳定）
     * @param {number} [logicalSize=600] 逻辑画布边长
     */
    function getWoodFill(ctx, canvasEl, logicalSize) {
        const ls = logicalSize > 0 ? logicalSize : DEFAULT_CANVAS_SIZE;
        const base = boardBaseColor();
        const key = 'fill|' + base.join(',') + '|' + ls + '|' + WOOD_TEXTURE_PRESET + '|' + woodSeedFor(canvasEl);
        let pat = woodTextureCache[key];
        if (!pat) {
            const src = makeWoodTextureCanvas(ls, base, WOOD_TEXTURE_PRESET, { seed: woodSeedFor(canvasEl) });
            pat = ctx.createPattern(src, 'no-repeat');
            woodTextureCache[key] = pat;
        }
        return pat;
    }

    /**
     * 给棋盘 canvas 铺木纹（CSS 背景层，绘制层保持透明，格线/棋子照常叠在上面）。
     * 底色取元素自身的 background-color → 改主题色自动跟随，且纹理不改变该底色。
     * @param {HTMLCanvasElement} canvasEl
     * @param {{preset?:string, base?:number[], strength?:number, longSide?:number}} [opts]
     */
    function applyBoardWoodTexture(canvasEl, opts) {
        if (!canvasEl || typeof document === 'undefined') return false;
        const o = opts || {};
        const preset = o.preset || WOOD_TEXTURE_PRESET;
        const base = o.base || parseCssRgb(getComputedStyle(canvasEl).backgroundColor) || boardBaseColor();
        if (!base) return false;
        const seed = o.seed != null ? o.seed : woodSeedFor(canvasEl);   // 每块画布一个随机种子
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const rect = canvasEl.getBoundingClientRect();
        const cssSize = Math.max(rect && rect.width ? rect.width : 0, rect && rect.height ? rect.height : 0, 256);
        // 生成尺寸：够清晰即可，过大只是徒增耗时(纹理尺度与生成尺寸无关)
        const size = Math.min(o.longSide || 768, Math.max(512, Math.round(cssSize * Math.min(dpr, 2))));
        // 缓存键必须包含全部参数覆盖，否则不同参数会命中同一张纹理
        const key = base.map((v) => Math.round(v)).join(',') + '|' + size + '|' + preset
            + '|' + JSON.stringify(Object.keys(o).sort().reduce((acc, k) => (acc[k] = o[k], acc), {}));
        let url = woodTextureCache[key];
        if (!url) {
            url = makeWoodTextureCanvas(size, base, preset, Object.assign({}, o, { seed })).toDataURL('image/png');
            woodTextureCache[key] = url;
        }
        canvasEl.style.backgroundImage = 'url("' + url + '")';
        canvasEl.style.backgroundSize = '100% 100%';
        canvasEl.style.backgroundRepeat = 'no-repeat';
        canvasEl.style.backgroundPosition = 'center';
        return true;
    }

    /**
     * 棋盘放大/平移时，让铺在 CSS 背景层的木纹同步缩放、平移。
     * 画布内容是靠 ctx 变换缩放的（逻辑坐标 600），而木纹是 CSS 背景层，
     * 两者必须手动对齐，否则会出现「格线放大了、木纹没动」。
     * @param {HTMLCanvasElement} canvasEl
     * @param {number} z 缩放倍数（1 = 原始大小）
     * @param {number} vcx 视图中心（逻辑坐标）
     * @param {number} vcy 视图中心（逻辑坐标）
     * @param {number} [logicalSize=600] 逻辑画布边长
     */
    function syncBoardWoodView(canvasEl, z, vcx, vcy, logicalSize) {
        if (!canvasEl || !canvasEl.style || !canvasEl.style.backgroundImage) return;
        if (!(z > 1)) {                                  // 未缩放：木纹铺满整块画布
            if (canvasEl.__qiWoodView !== 'fit') {
                canvasEl.__qiWoodView = 'fit';
                canvasEl.style.backgroundSize = '100% 100%';
                canvasEl.style.backgroundPosition = 'center';
            }
            return;
        }
        const cs = logicalSize > 0 ? logicalSize : DEFAULT_CANVAS_SIZE;
        const rect = canvasEl.getBoundingClientRect();
        const w = rect.width || cs, h = rect.height || cs;
        const key = z + '|' + vcx + '|' + vcy + '|' + Math.round(w) + 'x' + Math.round(h);
        if (canvasEl.__qiWoodView === key) return;       // 视图没变就不重复写样式
        canvasEl.__qiWoodView = key;
        // 逻辑点 (vcx,vcy) 要落在画布中心；缩放后每逻辑单位 = z * 画布尺寸 / 逻辑边长
        canvasEl.style.backgroundSize = (z * 100) + '% ' + (z * 100) + '%';
        canvasEl.style.backgroundPosition =
            (w / 2 - vcx * z * w / cs) + 'px ' + (h / 2 - vcy * z * h / cs) + 'px';
    }

    const QiSquareWeiqiCanvas = {
        DEFAULT_CANVAS_SIZE,
        getStarPoints,
        initBoardArray,
        deepCopyBoard,
        computePaddingAndCell,
        getClosestIntersection,
        getClosestCell,
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
        fillScoreConfirmText,
        setupHiDpiCanvas,
        applyBoardWoodTexture,
        syncBoardWoodView,
        getWoodFill,
        WOOD_TEXTURE_PRESET
    };

    global.QiSquareWeiqiCanvas = QiSquareWeiqiCanvas;
})(typeof window !== 'undefined' ? window : global);

/* ========== 4. 方格页运行时（QiWeiqiSquarePageRuntime） ==========
 * create(ps,dom,opts)：绘制、形势、打谱/试下、局面浏览、WebSocket、同步状态等。
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

    /** 开局前 turnDisplay 文案：入座人数 / 等待对手 / 确认规则（各棋种共用） */
    function waitingSeatTurnText(slots, mySlot) {
        const bothSelected = !!(slots && slots.player1 && slots.player2);
        if (bothSelected) return '等待双方确认规则';
        const seated = (slots && slots.player1 ? 1 : 0) + (slots && slots.player2 ? 1 : 0);
        if (seated === 1 && mySlot) return '等待对手入座(1/2)';
        return `等待双方入座(${seated}/2)`;
    }

    /**
     * 象棋类/国际跳棋/路墙棋统一的回合文本（显示在 turnDisplay，不再写 scoreBoard）：
     * 显示**刚下完这手棋**的一方与当前回合数，未走子时显示「初始局面」。
     * @param {number} moveCount 当前显示局面已走的手数
     * @param {string} sideLabel 该方在本棋种中的称呼（'⚪'/'⚫'/'红方'/'黑方'…）
     */
    function roundTurnText(moveCount, sideLabel) {
        const n = moveCount | 0;
        if (n <= 0) return '初始局面';
        return `${sideLabel} 第${Math.ceil(n / 2)}回合`;
    }

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
     *   afterDrawBoard?: () => void,
     *   syncState?: (state: any) => void,
     *   setReplayStep?: (step: number) => void,
     *   removeDeadAndDying?: (srcBoard: number[][]) => number[][],
     *   assignTerritoryWithRange?: (liveBoard: number[][]) => number[][],
     *   komiInfoText?: string | ((ps: any) => string),   // 自定义贴点条全文（含「无贴点/无禁手/无贴目」类）；缺省走 totalScorePoints
     *   totalPoints?: (ps: any) => number,               // 物理总点数接口（格点/顶点/面积点数，限时默认等用）；缺省 N²
     *   totalScorePoints?: (ps: any) => number,          // 计分总点数接口（和棋线 yyy 用；带权棋种=权重和）；缺省 = totalPoints
     * }} opts
     */
    /**
     * 编辑工具 → 棋盘格取值。默认仅空/黑/白；桥/洞/雷/中立子等为约定名，
     * 也可通过 opts.editToolValues 或 editTools[].cellValue 覆盖/扩展。
     */
    const DEFAULT_EDIT_CELL_BY_TOOL = Object.freeze({
        empty: 0,
        black: 1,
        white: 2,
        hole: -1,
        bridge: -2,
        mine: -3,
        neutral: 10000
    });

    function buildEditToolValueMap(opts) {
        const map = Object.assign({}, DEFAULT_EDIT_CELL_BY_TOOL);
        const putValue = (key, v) => {
            if (v === '') { map[key] = ''; return; }
            const n = Number(v);
            map[key] = Number.isFinite(n) ? n : v;
        };
        const extra = opts && opts.editToolValues;
        if (extra && typeof extra === 'object') {
            for (const k of Object.keys(extra)) putValue(k, extra[k]);
        }
        const tools = opts && opts.editTools;
        if (Array.isArray(tools)) {
            for (const t of tools) {
                if (!t || t.value == null || t.cellValue == null) continue;
                putValue(String(t.value), t.cellValue);
            }
        }
        return map;
    }

    function resolveEditToolCellValue(tool, valueMap) {
        if (tool == null || tool === '') return 0;
        const key = String(tool);
        if (Object.prototype.hasOwnProperty.call(valueMap, key)) return valueMap[key];
        return 0;
    }

    /** 统计棋盘上黑白子数量（支持二维 / 一维 flat） */
    function countBoardPlayerStones(bd) {
        if (!bd) return 0;
        let n = 0;
        if (Array.isArray(bd[0])) {
            for (let r = 0; r < bd.length; r++) {
                const row = bd[r];
                if (!row) continue;
                for (let c = 0; c < row.length; c++) {
                    const v = row[c];
                    if (v === 1 || v === 2) n++;
                }
            }
        } else {
            for (let i = 0; i < bd.length; i++) {
                const v = bd[i];
                if (v === 1 || v === 2) n++;
            }
        }
        return n;
    }

    /**
     * 在多个棋盘候选中选「有子更多」的；全 0 盘分数更低。
     * 勿用 `initialBoard || board`：空 initialBoard 在 JS 里仍为真，会盖住有子的 board。
     */
    function pickRichestBoard() {
        let best = null;
        let bestScore = -1;
        for (let i = 0; i < arguments.length; i++) {
            const bd = arguments[i];
            if (!bd) continue;
            const score = countBoardPlayerStones(bd);
            if (score > bestScore) {
                best = bd;
                bestScore = score;
            }
        }
        return best;
    }

    function clearUserBoardMarksMap(map) {
        if (!map || typeof map !== 'object') return;
        for (const k of Object.keys(map)) delete map[k];
    }

    /** 独立棋类本地 userBoardMarks：注册后新局/重置可一并清空 */
    function bindActiveUserBoardMarks(map) {
        if (!map || typeof map !== 'object') return;
        global.QiBoardMarks = global.QiBoardMarks || {};
        global.QiBoardMarks._active = map;
        global.QiBoardMarks.clear = function () {
            clearUserBoardMarksMap(global.QiBoardMarks._active);
        };
    }

    /**
     * 贴点显示文本：黑贴白xxx点。
     * TODO(用户考虑中): 是否追加「(黑yyy点和棋)」，yyy = 计分总点数/2 + 贴目（totalScorePoints 参数保留备用）。
     */
    function formatKomiInfoText(komi, totalScorePoints) {
        void totalScorePoints;
        return `黑贴白${komi}点`;
    }

    /** 公共写入口：把贴点文本写入 komiInfo 元素；元素缺失则 no-op */
    function writeKomiInfoText(el, komi, totalScorePoints) {
        if (!el) return false;
        el.innerText = formatKomiInfoText(komi, totalScorePoints);
        return true;
    }

    /**
     * 方格 N×N 棋盘的默认物理总点数（N = ps.BOARD_SIZE）。
     * 物理总点数（totalPoints）与计分总点数（totalScorePoints）在大多数棋种相等；
     * 仅权重/三权重围棋等计分带权的棋种不同（物理=N²，计分=权重和）。
     */
    function defaultKomiTotalPoints(ps) {
        return ps.BOARD_SIZE * ps.BOARD_SIZE;
    }

    function create(ps, dom, opts) {
        const minLib = opts.minLib != null ? opts.minLib : 1;
        const maxWeakLiberties = opts.maxWeakLiberties != null ? opts.maxWeakLiberties : 2;
        const isMouse = !!opts.isMouseDevice;
        const enableEditBoard = !!opts.enableEditBoard;
        let editApi = null;
        if (ps.hoverCapture === undefined) ps.hoverCapture = false;
        if (!ps.userBoardMarks) ps.userBoardMarks = Object.create(null);
        bindActiveUserBoardMarks(ps.userBoardMarks);
        if (enableEditBoard) {
            if (ps.editModeEnabled === undefined) ps.editModeEnabled = false;
            if (ps.editTool === undefined) ps.editTool = 'empty';
            if (ps.gameStarted === undefined) ps.gameStarted = false;
            if (ps.liveOpeningBoard === undefined) ps.liveOpeningBoard = null;
        }

        // 高清渲染：棋盘物理分辨率对齐 CSS 尺寸 × devicePixelRatio（绘制逻辑坐标恒为 600）。
        // 自绘棋类不调用本 create，不受影响；窗口尺寸变化时重新对齐并重绘。
        let hiDpiInitialized = false;
        function applyHiDpiCanvas() {
            if (!dom.canvas || !C().setupHiDpiCanvas) return;
            hiDpiInitialized = true;
            C().setupHiDpiCanvas(dom.canvas, C().DEFAULT_CANVAS_SIZE);
            if (typeof drawBoard === 'function') drawBoard();
        }
        applyHiDpiCanvas();
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
            window.requestAnimationFrame(applyHiDpiCanvas);
        }
        window.addEventListener('resize', () => {
            if (hiDpiInitialized) applyHiDpiCanvas();
        });

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

        /**
         * 可选棋盘局部缩放（由页面在 ps 上设置 viewZoom / viewCenterX / viewCenterY）。
         * 逻辑坐标仍为 DEFAULT_CANVAS_SIZE；仅绘制与 canvasCoordsFromClient 做视口变换。
         */
        function getBoardViewTransform() {
            const cs = C().DEFAULT_CANVAS_SIZE;
            const zRaw = ps.viewZoom;
            const z = typeof zRaw === 'number' && zRaw >= 1 ? Math.min(10, zRaw) : 1;
            const vcx = typeof ps.viewCenterX === 'number' ? ps.viewCenterX : cs / 2;
            const vcy = typeof ps.viewCenterY === 'number' ? ps.viewCenterY : cs / 2;
            return { z, vcx, vcy, cs };
        }

        function boardScreenToWorld(sx, sy) {
            const { z, vcx, vcy, cs } = getBoardViewTransform();
            if (z <= 1) return { x: sx, y: sy };
            return {
                x: (sx - cs / 2) / z + vcx,
                y: (sy - cs / 2) / z + vcy
            };
        }

        function boardScreenPointFromClient(clientX, clientY) {
            return C().canvasCoordsFromClient(clientX, clientY, dom.canvas, C().DEFAULT_CANVAS_SIZE);
        }

        function drawBoard() {
            if (opts.drawBoard) {
                opts.drawBoard();
                // 自绘棋种（如乌克兰/俄罗斯围棋）：画完后同样同步木纹的缩放与平移
                const vt = getBoardViewTransform();
                C().syncBoardWoodView(dom.canvas, vt.z, vt.vcx, vt.vcy, vt.cs);
                return;
            }
            const d = C().draw;
            const cs = C().DEFAULT_CANVAS_SIZE;
            const cellSize = ps.CELL_SIZE;
            const { z, vcx, vcy } = getBoardViewTransform();
            d.clear(dom.ctx, cs);
            const useView = z > 1;
            const invZ = useView ? 1 / z : 1;
            if (useView) {
                dom.ctx.save();
                dom.ctx.translate(cs / 2, cs / 2);
                dom.ctx.scale(z, z);
                dom.ctx.translate(-vcx, -vcy);
            }
            d.grid(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize, cs, useView ? invZ : undefined);
            d.starPoints(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            d.coordLabels(dom.ctx, ps.BOARD_SIZE, ps.PADDING, cellSize);
            const stoneRadius = cellSize * 0.44;
            const markLenDefault = cellSize * 0.352;
            const lowerLastMoveMarker = ps.showMoveNumbers || ps.showEstimateActive;
            if (lowerLastMoveMarker) {
                d.lastMoveMarkersLower(dom.ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, stoneRadius, ps.BOARD_SIZE);
            }
            d.stonesBlackWhite(dom.ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, stoneRadius, ps.showMoveNumbers, invZ);
            if (!lowerLastMoveMarker) {
                d.lastMoveMarkersUpper(dom.ctx, ps.lastMoveMarkers, ps.PADDING, cellSize, markLenDefault, ps.BOARD_SIZE);
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
                hoverCapture: !!ps.hoverCapture,
                pageState: ps,
                editModeEnabled: !!ps.editModeEnabled,
                editTool: ps.editTool,
                holeDisplayStyle: ps.holeDisplayStyle,
                boardSize: ps.BOARD_SIZE
            });
            if (ps.hoverCapture) {
                d.hoverCaptureRing(dom.ctx, ps.hoverRow, ps.hoverCol, ps.PADDING, cellSize, stoneRadius, {
                    tryPlayMode: ps.tryPlayMode,
                    gameOver: ps.gameOver,
                    isMyTurn: ps.isMyTurn || !!ps.editModeEnabled,
                    isHoverValid: ps.isHoverValid,
                    hoverCapture: !!ps.hoverCapture,
                    strokeInvScale: invZ,
                    boardSize: ps.BOARD_SIZE
                });
            }
            if (ps.showEstimateActive && ps.cachedLiveBoard && ps.cachedTerritory) {
                d.estimateOverlay(dom.ctx, ps.board, ps.BOARD_SIZE, ps.PADDING, cellSize, ps.cachedLiveBoard, ps.cachedTerritory);
            }
            if (useView) dom.ctx.restore();
            // 木纹（CSS 背景层）跟随缩放/平移，避免格线与木纹脱节
            C().syncBoardWoodView(dom.canvas, z, vcx, vcy, cs);
            if (typeof opts.afterDrawBoard === 'function') opts.afterDrawBoard();
        }

        function updateTurn() {
            if (ps.replayMode) {
                drawBoard();
                return;
            }
            if (ps.matchStartedOnce === undefined) ps.matchStartedOnce = false;
            if (ps.matchStarted) ps.matchStartedOnce = true;
            const bothSelected = !!(ps.slots && ps.slots.player1 && ps.slots.player2);
            const matchReady = !!(ps.matchTime && ps.matchTime.settings);
            if (bothSelected && matchReady) ps.matchStartedOnce = true;
            /** 对局已开始后因离座等只剩一方时，slots 不全为 true；用盘面/手数保持「已开局」以免误判为等待入座、禁止落子 */
            const hasStoneOnBoard = ps.board && ps.board.some(row => row.some(v => v === 1 || v === 2));
            if (ps.numberOfHands > 1 || hasStoneOnBoard) ps.matchStartedOnce = true;
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
                if (ps.winner === 'player1') dom.scoreTitle.innerText = '黑胜';
                else if (ps.winner === 'player2') dom.scoreTitle.innerText = '白胜';
                else if (ps.winner === 'draw') dom.scoreTitle.innerText = '和棋';
                else dom.scoreTitle.innerText = '　';
                ps.isMyTurn = false;
                drawBoard();
                return;
            }
            if (!ps.matchStarted) {
                dom.turnDisplay.innerText = waitingSeatTurnText(ps.slots, ps.mySlot);
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
            ps.isMyTurn = !!(ps.matchStarted && (ps.mySlot !== null)
                && ((ps.mySlot === 'player1' && ps.currentPlayer === 1) || (ps.mySlot === 'player2' && ps.currentPlayer === 2)));
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
            if (!dom.scoreConfirmPanel || !dom.scoreConfirmText) return;
            C().fillScoreConfirmText(dom.scoreConfirmText, lead);
            if (dom.scoreConfirmPanel.classList && dom.scoreConfirmPanel.classList.contains('score-confirm-modal'))
                dom.scoreConfirmPanel.style.display = 'flex';
            else
            dom.scoreConfirmPanel.style.display = 'block';
        }

        function hideScoreConfirm() {
            if (!dom.scoreConfirmPanel) return;
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
            syncTryPlayActionButtons(ps);
            if (opts.updateReplayUI) {
                opts.updateReplayUI();
                return;
            }
            const gameButtonIds = opts.replayGameButtonIds || ['passBtn', 'undoBtn', 'resignBtn', 'drawBtn', 'endReqBtn'];
            const replayPanel = document.getElementById('replayPanel');
            const tryPlayBtn = document.getElementById('tryPlayBtn');
            const isPlayer = !!ps.mySlot;
            const matchStarted = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
            const showMatchControlButtons = isPlayer && matchStarted && !ps.replayMode;
            const showTryPlayButton = !showMatchControlButtons;
            for (const id of gameButtonIds) {
                const el = document.getElementById(id);
                if (el) el.style.display = showMatchControlButtons ? '' : 'none';
            }
            if (replayPanel) replayPanel.style.display = '';
            if (tryPlayBtn) {
                tryPlayBtn.style.display = showTryPlayButton ? '' : 'none';
                tryPlayBtn.innerText = ps.tryPlayMode ? '试下结束' : '试下';
            }
        }

        function enterTryPlay() {
            if (opts.enterTryPlay) {
                opts.enterTryPlay();
                syncTryPlayActionButtons(ps);
                return;
            }
            clearMobileMovePreview();
            const fromLive = !ps.replayMode;
            let startPlayer = null;
            if (typeof opts.resolveTryPlayStartPlayer === 'function') {
                const resolved = opts.resolveTryPlayStartPlayer({ fromLive, ps });
                if (resolved === 1 || resolved === 2) startPlayer = resolved;
            }
            if (startPlayer == null) {
                startPlayer = R().resolveTryPlaySideToMove({
                    fromLive,
                    replayStep: ps.replayStep,
                    replayStepPlayers: ps.replayStepPlayers,
                    replayBoardsLength: (ps.replayBoards && ps.replayBoards.length) || 0,
                    liveViewStep: ps.liveViewStep,
                    liveReplayStepPlayers: ps.liveReplayStepPlayers,
                    liveReplayBoardsLength: (ps.liveReplayBoards && ps.liveReplayBoards.length) || 0,
                    currentPlayer: ps.currentPlayer
                });
            }
            if (fromLive) {
                ps.tryPlayFromLive = true;
                ps.tryPlayFromLiveStep = ps.liveViewStep || 0;
                ps.replayMode = true;
                ps.replayBoards = [deepCopyBoard(ps.board)];
                ps.replayMarkers = [(ps.lastMoveMarkers || []).map(m => ({ ...m }))];
                ps.replayStepPlayers = [startPlayer === 1 ? 2 : 1];
                ps.replayStep = 0;
                ps.replayTotalSteps = 0;
            } else {
                ps.tryPlayFromLive = false;
            }
            ps.tryPlayMode = true;
            ps.tryPlayBaseStep = ps.replayStep;
            ps.tryPlayBasePlayer = startPlayer;
            ps.tryPlayBoards = [deepCopyBoard(ps.board)];
            ps.tryPlayMarkers = [ps.lastMoveMarkers.map(m => ({ ...m }))];
            ps.tryPlayCurrentPlayer = startPlayer;
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            if ('tryPlayCaptureStep' in ps) ps.tryPlayCaptureStep = 0;

            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            slider.max = 0;
            slider.value = 0;
            updateTryPlayDisplay();
            updateReplayUI();
            // 可选钩子：自定义棋种（如易位围棋）在此补专属试下状态（高亮/易位计数/选中子等）
            if (typeof opts.onEnterTryPlay === 'function') opts.onEnterTryPlay();
        }

        function exitTryPlay() {
            if (opts.exitTryPlay) {
                opts.exitTryPlay();
                syncTryPlayActionButtons(ps);
                return;
            }
            clearMobileMovePreview();
            const fromLive = !!ps.tryPlayFromLive;
            const savedLiveStep = ps.tryPlayFromLiveStep != null ? ps.tryPlayFromLiveStep : ps.liveViewStep;
            const snapBoard = fromLive && ps.tryPlayBoards.length > 0 ? deepCopyBoard(ps.tryPlayBoards[0]) : null;
            const snapMarkers = fromLive && ps.tryPlayMarkers.length > 0 && ps.tryPlayMarkers[0]
                ? ps.tryPlayMarkers[0].map(m => ({ ...m }))
                : [];
            ps.tryPlayMode = false;
            ps.tryPlayFromLive = false;
            if ('tryPlayFromLiveStep' in ps) ps.tryPlayFromLiveStep = null;
            if ('tryPlayBasePlayer' in ps) ps.tryPlayBasePlayer = null;
            ps.tryPlayBoards = [];
            ps.tryPlayMarkers = [];
            ps.tryPlayStep = 0;
            ps.tryPlayTotalSteps = 0;
            if ('tryPlayCaptureStep' in ps) ps.tryPlayCaptureStep = 0;
            const slider = document.getElementById('replaySlider');
            slider.min = 0;
            if (fromLive) {
                ps.replayMode = false;
                ps.replayBoards = [];
                ps.replayMarkers = [];
                ps.replayStepPlayers = [];
                ps.replayStep = 0;
                ps.replayTotalSteps = 0;
                if (snapBoard) {
                    ps.board = snapBoard;
                    ps.lastMoveMarkers = snapMarkers.map(m => ({ ...m }));
                    if (ps.liveReplayBoards.length > 0) {
                        const step = Math.min(Math.max(0, savedLiveStep), ps.liveReplayBoards.length - 1);
                        ps.liveReplayBoards[step] = deepCopyBoard(snapBoard);
                        if (!ps.liveReplayMarkers[step]) ps.liveReplayMarkers[step] = [];
                        ps.liveReplayMarkers[step] = snapMarkers.map(m => ({ ...m }));
                        ps.liveViewStep = step;
                    } else {
                        ps.liveReplayBoards = [deepCopyBoard(snapBoard)];
                        ps.liveReplayMarkers = [snapMarkers.map(m => ({ ...m }))];
                        ps.liveReplayStepPlayers = [0];
                        ps.liveViewStep = 0;
                    }
                } else {
                    applyLiveViewBoard();
                }
                updateLiveReplayPanelUI();
                if (ps.showEstimateActive) showEstimate();
                else updateTurn();
            } else {
                slider.max = ps.replayTotalSteps;
                setReplayStep(ps.tryPlayBaseStep);
            }
            // 可选钩子：自定义棋种在此清掉 onEnterTryPlay 里补的专属试下状态
            if (typeof opts.onExitTryPlay === 'function') opts.onExitTryPlay();
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

            const basePlayer = (ps.tryPlayBasePlayer === 1 || ps.tryPlayBasePlayer === 2)
                ? ps.tryPlayBasePlayer
                : (ps.tryPlayBaseStep === 0 ? 1 : (3 - ps.replayStepPlayers[ps.tryPlayBaseStep]));
            ps.tryPlayCurrentPlayer = step % 2 === 0 ? basePlayer : (3 - basePlayer);

            document.getElementById('replaySlider').value = step;
            updateTryPlayDisplay();
            if (ps.showEstimateActive) showEstimate();
            else drawBoard();
        }

        function updateTryPlayDisplay() {
            syncTryPlayActionButtons(ps);
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

        function rebuildLiveReplayBoard(moveCoords, openingBoard) {
            if (opts.rebuildLiveReplayFromMoveCoords) {
                opts.rebuildLiveReplayFromMoveCoords(moveCoords, openingBoard);
                return;
            }
            // 增量（仅公共路径；自定义棋类各自处理）：已同步到 startLen 手时只对新的一手本地计算提子
            const mcs = moveCoords || [];
            const syncedLen = ps.liveReplayBoards.length - 1;
            if (syncedLen >= 0 && mcs.length > syncedLen) {
                const inc = R().applyLiveReplayIncrementalBoards(
                    ps.liveReplayBoards, ps.liveReplayMarkers, ps.liveReplayStepPlayers,
                    mcs, tryPlaceStone, deepCopyBoard);
                if (inc.ok) return;
            }
            const o = R().rebuildLiveReplayFromMoveCoords(
                mcs,
                tryPlaceStone,
                deepCopyBoard,
                () => {
                    // 起始棋盘必须与当前棋盘同尺寸：尺寸变化后旧开局盘（state.initialBoard/
                    // liveOpeningBoard 缓存）维度不匹配，重放序列越界（drawBoard board[r] undefined）
                    const empty = initBoardArray(ps.BOARD_SIZE);
                    const sameDim = (b) => b && Array.isArray(b) && Array.isArray(b[0])
                        && b.length === empty.length && b[0].length === empty[0].length;
                    if (sameDim(openingBoard)) return deepCopyBoard(openingBoard);
                    if (sameDim(ps.liveOpeningBoard)) return deepCopyBoard(ps.liveOpeningBoard);
                    return empty;
                }
            );
            ps.liveReplayBoards = o.liveReplayBoards;
            ps.liveReplayMarkers = o.liveReplayMarkers;
            ps.liveReplayStepPlayers = o.liveReplayStepPlayers;
        }

        function applyLiveViewBoard() {
            if (opts.applyLiveViewBoard) {
                opts.applyLiveViewBoard();
                return;
            }
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
            ps._suppressReplaySliderInput = true;
            slider.min = 0;
            slider.max = total;
            slider.value = ps.liveViewStep;
            ps._suppressReplaySliderInput = false;
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
            if (global.RoomChat && typeof global.RoomChat.bindSlotContext === 'function') {
                global.RoomChat.bindSlotContext({ getWs: () => ps.ws });
            }
        }

        function initBoardArray(size) {
            return C().initBoardArray(size);
        }

        /**
         * 状态同步后刷新贴点条：贴目以服务器下发的 state.komi 为准（变体棋种的贴目随变体变化），
         * 各棋种不必自己刷新贴目文本。
         */
        function syncKomiInfoFromState(state) {
            if (state && Number.isFinite(state.komi)) ps.KOMI = state.komi;
            if (dom.komiInfo) dom.komiInfo.innerText = resolveKomiInfoText();
        }

        /** 贴点条文本解析：komiInfoText（函数/常量）优先；否则取计分总点数
         *  （opts.totalScorePoints，缺省 = opts.totalPoints 物理总点数，再缺省 N²）
         *  输出「黑贴白xxx点」（双段格式待定，见 formatKomiInfoText）。 */
        function resolveKomiInfoText() {
            if (typeof opts.komiInfoText === 'function') return opts.komiInfoText(ps);
            if (opts.komiInfoText != null) return opts.komiInfoText;
            const totalScorePoints = (typeof opts.totalScorePoints === 'function')
                ? opts.totalScorePoints(ps)
                : ((typeof opts.totalPoints === 'function')
                    ? opts.totalPoints(ps)
                    : defaultKomiTotalPoints(ps));
            if (typeof totalScorePoints === 'number' && Number.isFinite(totalScorePoints) && totalScorePoints > 0)
                return formatKomiInfoText(ps.KOMI, totalScorePoints);
            return `黑贴白${ps.KOMI}点`;
        }

        function updateBoardGeometry() {
            const g = C().computePaddingAndCell(ps.BOARD_SIZE);
            ps.PADDING = g.padding;
            ps.CELL_SIZE = g.cellSize;
            if (typeof ps.viewZoom === 'number' && ps.viewZoom > 1) {
                const cs = C().DEFAULT_CANVAS_SIZE;
                ps.viewZoom = 1;
                ps.viewCenterX = cs / 2;
                ps.viewCenterY = cs / 2;
            }
            drawBoard();
            if (dom.komiInfo) dom.komiInfo.innerText = resolveKomiInfoText();
        }

        function updateEditModeUI() {
            if (editApi) editApi.updateEditModeUI();
        }

        function clearEditModeUi() {
            if (editApi) editApi.clearEditModeUi();
        }

        function boardPlayerStoneCount(bd) {
            return countBoardPlayerStones(bd);
        }

        function pickRichestOpening() {
            return pickRichestBoard.apply(null, arguments);
        }

        function applyOpeningBoardIfRicher(state) {
            if (ps.editModeEnabled || ps.replayMode) return;
            const moves = (state && state.moveCoords) || [];
            if (moves.length) return;
            // 只接受与当前棋盘同尺寸的候选开局盘（尺寸变化后旧尺寸棋盘必须丢弃）
            const sameDim = (b) => b && Array.isArray(b) && Array.isArray(b[0])
                && b.length === ps.board.length && b[0].length === ps.board[0].length;
            const opening = pickRichestOpening(
                sameDim(ps._editCommitSnapshot) ? ps._editCommitSnapshot : null,
                sameDim(ps.liveOpeningBoard) ? ps.liveOpeningBoard : null,
                sameDim(state && state.initialBoard) ? state.initialBoard : null,
                sameDim(state && state.board) ? state.board : null,
                ps.board
            );
            if (!opening) return;
            if (boardPlayerStoneCount(opening) < boardPlayerStoneCount(ps.board)) return;
            ps.liveOpeningBoard = deepCopyBoard(opening);
            ps.liveReplayBoards = [deepCopyBoard(opening)];
            ps.liveReplayMarkers = [[]];
            ps.liveReplayStepPlayers = [0];
            ps.liveViewStep = 0;
            ps.liveFollowLatest = true;
            applyLiveViewBoard();
            updateLiveReplayPanelUI();
        }

        function syncState(state) {
            if (enableEditBoard && state && !ps.editModeEnabled) {
                // 尺寸变化时旧尺寸开局盘（initialBoard/liveOpeningBoard）不能用作 opening：
                // 以其为起点重放会产生维度不匹配的棋盘，drawBoard 越界。按新尺寸过滤
                const openingSize = (state.boardSize && Number.isFinite(state.boardSize))
                    ? state.boardSize : ps.BOARD_SIZE;
                const emptyRef = initBoardArray(openingSize);
                const sameDim = (b) => b && Array.isArray(b) && Array.isArray(b[0])
                    && b.length === emptyRef.length && b[0].length === emptyRef[0].length;
                const opening = pickRichestOpening(
                    ps._editCommitSnapshot,
                    sameDim(state.initialBoard) ? state.initialBoard : null,
                    (!(state.moveCoords && state.moveCoords.length) ? state.board : null),
                    sameDim(ps.liveOpeningBoard) ? ps.liveOpeningBoard : null
                );
                if (opening) ps.liveOpeningBoard = deepCopyBoard(opening);
                ps.gameStarted = (state.numberOfHands || 1) > 1;
            } else if (enableEditBoard && state && ps.editModeEnabled) {
                // 编辑中：只更新开局标记，不覆盖本地正在编辑的棋盘
                ps.gameStarted = (state.numberOfHands || 1) > 1;
            }
            if (opts.syncState) {
                // 与下方全量同步一致：matchTime/matchStarted 必须在自定义 syncState 之外同步，
                // 否则对局中途重新进入房间的玩家 ps.matchStarted 恒为 undefined，isMyTurn 永远 false 无法落子
                if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
                if (state.matchStarted !== undefined) ps.matchStarted = !!state.matchStarted;
                opts.syncState(state);
                // 自定义 sync 常从空盘 rebuild，会丢掉 editBoard 写入的 opening / initialBoard
                applyOpeningBoardIfRicher(state);
                // 选点类：opening/编辑补丁之后若仍在直播末手，补回服务器本回合候选点
                if (Array.isArray(ps.serverCandidatesSnapshot) && !ps.replayMode && !ps.tryPlayMode) {
                    const tip = Math.max(0, ps.liveReplayBoards.length - 1);
                    if (ps.liveViewStep >= tip)
                        ps.candidates = ps.serverCandidatesSnapshot.map(c => ({ row: c.row, col: c.col }));
                }
                updateEditModeUI();
                if (editApi) editApi.restoreLocalEditAfterSync();
                if (editApi) editApi.ensureCommitSnapshotVisible();
                if (editApi && state && state.type === 'editBoardAccepted')
                    editApi.noteEditBoardAccepted(state);
                return;
            }
            if (ps.editModeEnabled) {
                // 编辑中跳过棋盘全量同步，仅刷新座位/用时等元数据与编辑锁
                if (state.slots) ps.slots = state.slots;
                if (state.matchTime !== undefined) ps.matchTime = state.matchTime;
                if (state.matchStarted !== undefined) ps.matchStarted = !!state.matchStarted;
                if (state.mySlot !== undefined) ps.mySlot = state.mySlot;
                updateEditModeUI();
                if (editApi) editApi.restoreLocalEditAfterSync();
                return;
            }
            const prevMatchStarted = !!ps.matchStarted;
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
                // 尺寸变化后旧尺寸直播重放序列不可再用（增量扩展会越界），强制全量重建
                ps.liveReplayBoards = [];
                ps.liveReplayMarkers = [];
                ps.liveReplayStepPlayers = [];
                ps.liveViewStep = 0;
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
            if (state.matchTime !== undefined)
                ps.matchTime = state.matchTime;
            if (state.matchStarted !== undefined)
                ps.matchStarted = !!state.matchStarted;
            if (
                ps.numberOfHands <= 1
                && !ps.gameOver
                && !(ps.slots && ps.slots.player1 && ps.slots.player2)
                && !(ps.matchTime && ps.matchTime.settings)
            ) {
                ps.matchStarted = false;
                ps.matchStartedOnce = false;
            }

            if (!ps.replayMode) {
                const prevTotal = Math.max(0, ps.liveReplayBoards.length - 1);
                const wasAtEnd = ps.liveFollowLatest || ps.liveViewStep >= prevTotal;
                const moves = state.moveCoords || [];
                if (!moves.length) {
                    // 尺寸变化后旧尺寸开局盘不可用（重放序列维度不匹配会越界），只接受同尺寸候选
                    const sameDim = (b) => b && Array.isArray(b) && Array.isArray(b[0])
                        && b.length === ps.board.length && b[0].length === ps.board[0].length;
                    const opening = pickRichestOpening(
                        sameDim(ps._editCommitSnapshot) ? ps._editCommitSnapshot : null,
                        sameDim(ps.liveOpeningBoard) ? ps.liveOpeningBoard : null,
                        sameDim(state.initialBoard) ? state.initialBoard : null,
                        sameDim(state.board) ? state.board : null
                    );
                    if (opening) {
                        ps.liveOpeningBoard = deepCopyBoard(opening);
                        ps.liveReplayBoards = [deepCopyBoard(opening)];
                        ps.liveReplayMarkers = [[]];
                        ps.liveReplayStepPlayers = [0];
                    } else {
                        rebuildLiveReplayBoard(moves);
                    }
                } else {
                    rebuildLiveReplayBoard(moves);
                }
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
                // 试下中只更新后台直播历史，不刷新展示盘面
                if (!ps.tryPlayMode) {
                    applyLiveViewBoard();
                    updateLiveReplayPanelUI();
                    if (editApi) editApi.ensureCommitSnapshotVisible();
                }
            } else if (!ps.tryPlayMode) {
                ps.board = state.board;
                ps.lastMoveMarkers = state.lastMoveMarkers || [];
            }

            const hasAnyStone = ps.board.some(row => row.some(v => v !== 0));
            const hasPlayer = ps.slots.player1 || ps.slots.player2;
            const boardSizeSelect = document.getElementById('boardSizeSelect');
            if (boardSizeSelect && ps.liveViewStep === 0 && !hasPlayer && !ps.gameOver && ps.mySlot === null)
                boardSizeSelect.style.display = 'inline-block';
            else
                boardSizeSelect.style.display = 'none';

            if (ps.showEstimateActive) {
                showEstimate();
            }
            const nowMatchStarted = !!ps.matchStarted;
            const shouldForceEndTryPlay = !!(ps.tryPlayMode && ps.mySlot && nowMatchStarted);
            if (!prevMatchStarted && shouldForceEndTryPlay) {
                exitTryPlay();
            }
            // 形势判断开启时也要更新 turnDisplay / isMyTurn（仅 showEstimate 会漏掉）
            updateTurn();
            updateReplayUI();
            ps._syncMoveCoordsLen = incomingMoveLen;
            updateEditModeUI();
            if (editApi) editApi.restoreLocalEditAfterSync();
            if (editApi && state && state.type === 'editBoardAccepted')
                editApi.noteEditBoardAccepted(state);
            // 贴目随状态刷新（重新进入房间/切换变体后不再残留默认贴目）
            syncKomiInfoFromState(state);
        }

        if (enableEditBoard && dom.canvas) {
            editApi = installBoardEditUI({
                ps,
                canvas: dom.canvas,
                mode: 'grid2d',
                editTools: opts.editTools,
                editToolValues: opts.editToolValues,
                deepCopyBoard,
                drawBoard: () => drawBoard(),
                emptyBoard: () => initBoardArray(ps.BOARD_SIZE),
                pickAtClient(clientX, clientY) {
                    const { x, y } = canvasCoordsFromClient(clientX, clientY);
                    // 棋子落在格内的棋种（opts.editPickCell，如权重围棋）：按格子命中，否则按交叉点
                    return opts.editPickCell ? getClosestCell(x, y) : getClosestIntersection(x, y);
                },
                syncLiveOpening: true
            });
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

        /** 落在格内的棋种（权重围棋等）：命中最近格心 */
        function getClosestCell(x, y) {
            return C().getClosestCell(x, y, ps.BOARD_SIZE, ps.PADDING, ps.CELL_SIZE);
        }

        function canvasCoordsFromClient(clientX, clientY) {
            const p = C().canvasCoordsFromClient(clientX, clientY, dom.canvas, C().DEFAULT_CANVAS_SIZE);
            return boardScreenToWorld(p.x, p.y);
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
            if (!ps.userBoardMarks) ps.userBoardMarks = Object.create(null);
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
            // 扫雷围棋：选中 🚩 时右键循环 空→旗→×→清除；其它标记仍为放置/替换/同号取消
            if (opts.boardMarkMode === 'minesweeper' && ch === '🚩') {
                if (existing === undefined) ps.userBoardMarks[key] = '🚩';
                else if (existing === '🚩') ps.userBoardMarks[key] = '×';
                else if (existing === '×') delete ps.userBoardMarks[key];
                else ps.userBoardMarks[key] = '🚩';
                drawBoard();
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

        // 挂载即写贴点条：入房时尺寸/贴目与默认一致的话几何路径可能永不触发，
        // 公共默认文本（shell defaultKomiText）就会一直停留在旧格式；这里与 applyShellChrome 同 tick 覆盖。
        if (dom.komiInfo) dom.komiInfo.innerText = resolveKomiInfoText();

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
            applyLiveReplayIncrementalBoards,
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
            boardScreenPointFromClient,
            getSelectedBoardMark,
            applyUserBoardMark,
            updateEditModeUI,
            clearEditModeUi,
            applyEditChange: (board) => {
                if (editApi) editApi.applyEditChange(board);
            },
            commitEditToServer: (force) => {
                if (editApi) editApi.commitEditToServer(force);
            },
            ensureCommitSnapshotVisible: () => {
                if (editApi) editApi.ensureCommitSnapshotVisible();
            }
        };
    }

    /**
     * 非 Runtime.create 的棋种：安装空/黑/白编辑 UI 与 capture 点击。
     * opts: { ps, canvas, pickAtClient(clientX,clientY)->{row,col}|{index}|null,
     *   drawBoard, deepCopyBoard?, emptyBoard?, isEditableCell?(row,col)|isEditableIndex?(i),
     *   mode:'grid2d'|'flat', getBoard(), setBoard(b), sendBoard(b) }
     */
    /**
     * 统一棋盘编辑 UI（勾选框 / 工具下拉 / 清空 / 点击落子右键清空）。
     * 编辑过程中只改本地；关闭「编辑」勾选（或因开局被强制退出）时再一次性提交服务器。
     * @param {object} opts
     * @param {object} opts.ps
     * @param {HTMLCanvasElement} opts.canvas
     * @param {'grid2d'|'flat'} [opts.mode='grid2d']
     * @param {Array<{value:string,label:string,cellValue?:number}>} [opts.editTools]
     * @param {Record<string, number>} [opts.editToolValues] 覆盖/扩展默认工具取值
     * @param {boolean} [opts.syncLiveOpening=false] 方格页：同步 liveOpeningBoard / liveReplayBoards
     */
    function installBoardEditUI(opts) {
        const ps = opts.ps;
        const canvas = opts.canvas;
        if (!ps || !canvas) return null;
        if (ps.editModeEnabled === undefined) ps.editModeEnabled = false;
        if (ps.editTool === undefined) ps.editTool = 'empty';
        if (ps.gameStarted === undefined) ps.gameStarted = false;
        if (ps.editDirty === undefined) ps.editDirty = false;
        if (ps._editPreState === undefined) ps._editPreState = null;

        const deepCopy = opts.deepCopyBoard || ((b) => {
            if (!b) return b;
            if (Array.isArray(b[0])) return b.map((r) => r.slice());
            return b.slice();
        });
        const mode = opts.mode || 'grid2d';
        const toolValueMap = buildEditToolValueMap(opts);
        const syncLiveOpening = !!opts.syncLiveOpening;

        function currentBoard() {
            return opts.getBoard ? opts.getBoard() : ps.board;
        }

        function writeBoard(newBoard) {
            if (typeof opts.setBoard === 'function') opts.setBoard(newBoard);
            else ps.board = newBoard;
        }

        function countPlayerStones(bd) {
            if (!bd) return 0;
            let n = 0;
            if (Array.isArray(bd[0])) {
                for (let r = 0; r < bd.length; r++) {
                    const row = bd[r];
                    if (!row) continue;
                    for (let c = 0; c < row.length; c++) {
                        const v = row[c];
                        if (v === 1 || v === 2 || (typeof v === 'string' && v !== '')) n++;
                    }
                }
            } else {
                for (let i = 0; i < bd.length; i++) {
                    const v = bd[i];
                    if (v === 1 || v === 2 || (typeof v === 'string' && v !== '')) n++;
                }
            }
            return n;
        }

        function updateEditModeUI() {
            const editModeCheckbox = document.getElementById('editModeCheckbox');
            const editToolSelect = document.getElementById('editToolSelect');
            const clearBoardBtn = document.getElementById('clearBoardBtn');
            const editControls = document.getElementById('editControls');
            const canEdit = !ps.gameOver && !ps.gameStarted && !ps.matchStarted
                && !(ps.matchTime && ps.matchTime.settings);
            // 开局后隐藏整块编辑区；新局可编辑时再显示（仅本棋种支持编辑时）
            if (editControls && editControls.dataset.qiEditFeature === '1') {
                editControls.hidden = !canEdit;
            }
            if (editModeCheckbox) editModeCheckbox.disabled = !canEdit;
            if (!canEdit && ps.editModeEnabled) {
                const lockedByMatch = !!(ps.matchStarted || (ps.matchTime && ps.matchTime.settings));
                // 已正式开局则勿再提交（服务器会拒绝）；本地脏编辑直接丢弃
                if (!lockedByMatch) commitEditToServer(true);
                else {
                    ps.editDirty = false;
                    ps._editCommitPending = false;
                    ps._editCommitSnapshot = null;
                    ps._editLocalBoard = null;
                    ps._editPreState = null;
                }
                ps.editModeEnabled = false;
                // 避免设定 checked=false 再次触发 change（会二次 commit / 清脏标记）
                ps._suppressEditCheckboxChange = true;
                if (editModeCheckbox) editModeCheckbox.checked = false;
                ps._suppressEditCheckboxChange = false;
                if (editToolSelect) editToolSelect.classList.add('hidden');
                if (clearBoardBtn) clearBoardBtn.classList.add('hidden');
            }
        }

        function syncOpeningCaches(board) {
            if (!syncLiveOpening || ps.replayMode) return;
            const preGame = !ps.gameStarted && (ps.numberOfHands || 1) <= 1;
            if (preGame) {
                ps.liveOpeningBoard = deepCopy(board);
                if (!Array.isArray(ps.liveReplayBoards) || ps.liveReplayBoards.length === 0) {
                    ps.liveReplayBoards = [deepCopy(board)];
                    ps.liveReplayMarkers = [[]];
                    ps.liveReplayStepPlayers = [0];
                    ps.liveViewStep = 0;
                } else {
                    const i = Math.min(ps.liveViewStep, ps.liveReplayBoards.length - 1);
                    ps.liveReplayBoards[i] = deepCopy(board);
                }
            } else if (Array.isArray(ps.liveReplayBoards) && ps.liveReplayBoards.length > 0) {
                const i = Math.min(ps.liveViewStep, ps.liveReplayBoards.length - 1);
                ps.liveReplayBoards[i] = deepCopy(board);
            }
        }

        function resolveEditWs() {
            if (typeof opts.getWs === 'function') {
                try {
                    const w = opts.getWs();
                    if (w && w.readyState === 1) return w;
                } catch (e) { /* ignore */ }
            }
            if (ps && ps.ws && ps.ws.readyState === 1) return ps.ws;
            return null;
        }

        function sendEditBoardToServer(board) {
            const locked = !!(ps.gameOver || ps.gameStarted || ps.matchStarted
                || (ps.matchTime && ps.matchTime.settings));
            if (locked) return false;
            if (typeof opts.sendBoard === 'function') {
                opts.sendBoard(board);
                return true;
            }
            const w = resolveEditWs();
            if (!w) return false;
            w.send(JSON.stringify({ type: 'editBoard', board }));
            return true;
        }

        /**
         * 将本地编辑一次性提交服务器（供其它客户端同步）。
         * @param {boolean} [force=false] 结束编辑时强制提交当前棋盘（不依赖 editDirty）
         */
        function commitEditToServer(force) {
            if (!force && !ps.editDirty) return;
            let board = deepCopy(currentBoard());
            // 编辑缓存比当前盘更完整时以缓存为准（同步曾冲掉 ps.board）
            if (ps._editLocalBoard != null
                && countPlayerStones(ps._editLocalBoard) > countPlayerStones(board)) {
                board = deepCopy(ps._editLocalBoard);
            }
            writeBoard(board);
            ps.liveOpeningBoard = deepCopy(board);
            ps.liveReplayBoards = [deepCopy(board)];
            ps.liveReplayMarkers = [[]];
            ps.liveReplayStepPlayers = [0];
            ps.liveViewStep = 0;
            ps.liveFollowLatest = true;
            ps._editCommitSnapshot = deepCopy(board);
            ps._editCommitPending = true;
            if (typeof opts.onCommitEdit === 'function') {
                try { opts.onCommitEdit(deepCopy(board)); } catch (e) { /* ignore */ }
            }
            sendEditBoardToServer(board);
            ps.editDirty = false;
            ps._editLocalBoard = deepCopy(board);
            if (typeof opts.drawBoard === 'function') opts.drawBoard();
        }

        /** 同步后若提交快照比当前盘更「有子」，恢复本地显示；远端已跟上则丢弃快照 */
        function ensureCommitSnapshotVisible() {
            const snap = ps._editCommitSnapshot;
            if (!snap || ps.editModeEnabled) return;
            const snapN = countPlayerStones(snap);
            const cur = currentBoard();
            const curN = countPlayerStones(cur);
            if (snapN > curN) {
                writeBoard(deepCopy(snap));
                ps.liveOpeningBoard = deepCopy(snap);
                ps.liveReplayBoards = [deepCopy(snap)];
                ps.liveReplayMarkers = [[]];
                ps.liveReplayStepPlayers = [0];
                ps.liveViewStep = 0;
                ps.liveFollowLatest = true;
                if (typeof opts.onCommitEdit === 'function') {
                    try { opts.onCommitEdit(deepCopy(snap)); } catch (e) { /* ignore */ }
                }
                if (typeof opts.drawBoard === 'function') opts.drawBoard();
                return;
            }
            if (snapN > 0 && curN >= snapN) {
                ps._editCommitPending = false;
                ps._editCommitSnapshot = null;
            }
        }

        /** 收到 editBoardAccepted：远端局面已带上提交的子则清除本地快照 */
        function noteEditBoardAccepted(state) {
            const remote = pickRichestBoard(state && state.initialBoard, state && state.board);
            const remoteN = countPlayerStones(remote);
            const snapN = countPlayerStones(ps._editCommitSnapshot);
            if (remoteN >= snapN) {
                ps._editCommitPending = false;
                ps._editCommitSnapshot = null;
            }
        }

        function applyEditChange(newBoard) {
            writeBoard(newBoard);
            const board = currentBoard();
            ps._editLocalBoard = deepCopy(board);
            ps.editDirty = true;
            syncOpeningCaches(board);
            if (typeof opts.onEditApplied === 'function') opts.onEditApplied(board);
            if (typeof opts.drawBoard === 'function') opts.drawBoard();
            // 编辑中不同步服务器；关闭编辑勾选时再 commitEditToServer
        }

        function toolValue() {
            return resolveEditToolCellValue(ps.editTool, toolValueMap);
        }

        /** 远程 sync 后若仍在编辑，恢复本地未提交局面，避免闪一下被冲掉 */
        function restoreLocalEditAfterSync() {
            if (!ps.editModeEnabled || ps._editLocalBoard == null) return;
            writeBoard(deepCopy(ps._editLocalBoard));
            syncOpeningCaches(ps._editLocalBoard);
            if (typeof opts.drawBoard === 'function') opts.drawBoard();
        }

        const editModeCheckbox = document.getElementById('editModeCheckbox');
        const editToolSelect = document.getElementById('editToolSelect');
        const clearBoardBtn = document.getElementById('clearBoardBtn');
        if (editModeCheckbox) {
            editModeCheckbox.addEventListener('change', () => {
                if (ps._suppressEditCheckboxChange) return;
                const on = !!editModeCheckbox.checked;
                if (on) {
                    ps.editModeEnabled = true;
                    ps.editDirty = false;
                    ps._editLocalBoard = deepCopy(currentBoard());
                    // 编辑前的状态快照，供「取消」按钮还原
                    ps._editPreState = deepCopy(currentBoard());
                    if (editToolSelect) editToolSelect.classList.remove('hidden');
                    if (clearBoardBtn) clearBoardBtn.classList.remove('hidden');
                } else {
                    // 关闭编辑 = 编辑完成 → 强制提交当前棋盘（即使 dirty 标记丢失）
                    commitEditToServer(true);
                    ps.editModeEnabled = false;
                    if (editToolSelect) editToolSelect.classList.add('hidden');
                    if (clearBoardBtn) clearBoardBtn.classList.add('hidden');
                }
            });
        }
        if (editToolSelect) {
            editToolSelect.addEventListener('change', () => {
                ps.editTool = editToolSelect.value;
                if (typeof opts.drawBoard === 'function') opts.drawBoard();
            });
        }
        // 编辑中未入座/非己方回合时，公共 hoverPreview 也要能画：同步 hover 坐标并重绘
        canvas.addEventListener('mousemove', (e) => {
            if (!ps.editModeEnabled || typeof opts.pickAtClient !== 'function') return;
            const hit = opts.pickAtClient(e.clientX, e.clientY);
            if (!hit) {
                if (ps.hoverRow >= 0 || ps.isHoverValid) {
                    ps.hoverRow = -1;
                    ps.hoverCol = -1;
                    ps.isHoverValid = false;
                    if (typeof opts.drawBoard === 'function') opts.drawBoard();
                }
                return;
            }
            if (mode === 'flat') {
                const i = hit.index != null ? hit.index : hit.v;
                if (i == null || i < 0) return;
                if (opts.isEditableIndex && !opts.isEditableIndex(i)) return;
                // flat 棋盘用 hoverRow 存 index，供自绘插件使用；方格盘仍用 row/col
                if (ps.hoverRow !== i || !ps.isHoverValid) {
                    ps.hoverRow = i;
                    ps.hoverCol = 0;
                    ps.isHoverValid = true;
                    if (typeof opts.drawBoard === 'function') opts.drawBoard();
                }
                return;
            }
            const { row, col } = hit;
            if (row == null || col == null || row < 0 || col < 0) return;
            if (opts.isEditableCell && !opts.isEditableCell(row, col)) return;
            if (ps.hoverRow !== row || ps.hoverCol !== col || !ps.isHoverValid) {
                ps.hoverRow = row;
                ps.hoverCol = col;
                ps.isHoverValid = true;
                if (typeof opts.drawBoard === 'function') opts.drawBoard();
            }
        });
        canvas.addEventListener('mouseleave', () => {
            if (!ps.editModeEnabled) return;
            if (ps.hoverRow < 0 && !ps.isHoverValid) return;
            ps.hoverRow = -1;
            ps.hoverCol = -1;
            ps.isHoverValid = false;
            if (typeof opts.drawBoard === 'function') opts.drawBoard();
        });
        if (clearBoardBtn) {
            clearBoardBtn.addEventListener('click', () => {
                const emptyVal = Object.prototype.hasOwnProperty.call(toolValueMap, 'empty')
                    ? toolValueMap['empty'] : 0;
                if (typeof opts.emptyBoard === 'function') applyEditChange(opts.emptyBoard());
                else if (mode === 'flat') {
                    const n = currentBoard().length;
                    applyEditChange(Array(n).fill(emptyVal));
                } else {
                    const n = ps.BOARD_SIZE || ps.boardSize || currentBoard().length;
                    applyEditChange(Array(n).fill(null).map(() => Array(n).fill(emptyVal)));
                }
            });
        }

        // 确定/取消按钮：仅在编辑开启时显示（显隐跟随清空按钮，覆盖各棋类插件的所有显隐点）
        const confirmEditBtn = document.getElementById('confirmEditBtn');
        const cancelEditBtn = document.getElementById('cancelEditBtn');
        const syncEditActionBtns = () => {
            if (!clearBoardBtn) return;
            const hidden = clearBoardBtn.classList.contains('hidden');
            if (confirmEditBtn) confirmEditBtn.classList.toggle('hidden', hidden);
            if (cancelEditBtn) cancelEditBtn.classList.toggle('hidden', hidden);
        };
        syncEditActionBtns();
        if (typeof MutationObserver !== 'undefined' && clearBoardBtn) {
            new MutationObserver(syncEditActionBtns).observe(clearBoardBtn, { attributes: true, attributeFilter: ['class'] });
        }
        if (confirmEditBtn) {
            confirmEditBtn.addEventListener('click', () => {
                if (!editModeCheckbox || !editModeCheckbox.checked) return;
                // 与取消勾选编辑框一致：提交当前编辑并退出编辑
                editModeCheckbox.checked = false;
                editModeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }
        if (cancelEditBtn) {
            cancelEditBtn.addEventListener('click', () => {
                if (!editModeCheckbox || !editModeCheckbox.checked) return;
                // 取消本次编辑：还原为编辑前的状态，再走退出提交（提交的即还原后的盘）
                const restore = ps._editPreState != null ? deepCopy(ps._editPreState) : deepCopy(currentBoard());
                writeBoard(restore);
                ps._editLocalBoard = deepCopy(restore);
                syncOpeningCaches(restore);
                if (typeof opts.drawBoard === 'function') opts.drawBoard();
                editModeCheckbox.checked = false;
                editModeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }

        canvas.addEventListener('click', (e) => {
            if (!ps.editModeEnabled) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            const hit = opts.pickAtClient(e.clientX, e.clientY);
            if (!hit) return;
            const board = currentBoard();
            const nb = deepCopy(board);
            const v = toolValue();
            if (mode === 'flat') {
                const i = hit.index != null ? hit.index : hit.v;
                if (i == null || i < 0) return;
                if (opts.isEditableIndex && !opts.isEditableIndex(i)) return;
                if (nb[i] === v) return;
                nb[i] = v;
            } else {
                const { row, col } = hit;
                if (row == null || col == null || row < 0 || col < 0) return;
                if (opts.isEditableCell && !opts.isEditableCell(row, col)) return;
                if (nb[row][col] === v) return;
                nb[row][col] = v;
            }
            applyEditChange(nb);
        }, true);

        canvas.addEventListener('contextmenu', (e) => {
            if (!ps.editModeEnabled) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            const hit = opts.pickAtClient(e.clientX, e.clientY);
            if (!hit) return;
            // 右键清除：写入「空」工具值（围棋 0；字符串棋盘（象棋）为 ''）
            const emptyVal = Object.prototype.hasOwnProperty.call(toolValueMap, 'empty')
                ? toolValueMap['empty'] : 0;
            const board = currentBoard();
            const nb = deepCopy(board);
            if (mode === 'flat') {
                const i = hit.index != null ? hit.index : hit.v;
                if (i == null || i < 0 || nb[i] === emptyVal) return;
                nb[i] = emptyVal;
            } else {
                const { row, col } = hit;
                if (row == null || col == null || row < 0 || col < 0 || nb[row][col] === emptyVal) return;
                nb[row][col] = emptyVal;
            }
            applyEditChange(nb);
        }, true);

        const api = {
            updateEditModeUI,
            isEditModeActive: () => !!ps.editModeEnabled,
            applyEditChange,
            commitEditToServer,
            restoreLocalEditAfterSync,
            ensureCommitSnapshotVisible,
            noteEditBoardAccepted,
            clearEditModeUi() {
                // 强制退出不提交（新局等）
                ps.editModeEnabled = false;
                ps.editDirty = false;
                ps._editLocalBoard = null;
                ps._editPreState = null;
                ps._editCommitSnapshot = null;
                ps._editCommitPending = false;
                ps.liveOpeningBoard = null;
                ps._suppressEditCheckboxChange = true;
                if (editModeCheckbox) editModeCheckbox.checked = false;
                ps._suppressEditCheckboxChange = false;
                if (editToolSelect) editToolSelect.classList.add('hidden');
                if (clearBoardBtn) clearBoardBtn.classList.add('hidden');
            },
            toolValueMap
        };
        // 供 newGameStarted / roomReset 统一清空（含独立 _editPs 的异形棋插件）
        global.QiBoardEditUi = global.QiBoardEditUi || {};
        global.QiBoardEditUi.clear = () => api.clearEditModeUi();
        return api;
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

    /**
     * Benson 无条件活（pass-alive）判定：四邻方格。
     * @returns {{ alive: boolean[][], territory: number[][] }}
     *   alive[r][c]=true 表示该子属于无条件活棋链；
     *   territory[r][c]∈{0,1,2} 表示该空点所在的"确定领地"归属（0=不定）。
     */
    function bensonAlive(board, boardSize) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        // 1) 棋链
        const chainOf = Array(boardSize).fill().map(() => Array(boardSize).fill(-1));
        const chains = [];
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                const v = board[r][c];
                if ((v !== 1 && v !== 2) || chainOf[r][c] >= 0) continue;
                const id = chains.length;
                const stones = [[r, c]];
                chainOf[r][c] = id;
                const queue = [[r, c]];
                for (let qi = 0; qi < queue.length; qi++) {
                    const [rr, cc] = queue[qi];
                    for (const [dr, dc] of dirs) {
                        const nr = rr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                        if (board[nr][nc] === v && chainOf[nr][nc] < 0) {
                            chainOf[nr][nc] = id;
                            stones.push([nr, nc]);
                            queue.push([nr, nc]);
                        }
                    }
                }
                chains.push({ color: v, stones });
            }
        }
        // 2) 空点区域与其邻接棋链
        const regionOf = Array(boardSize).fill().map(() => Array(boardSize).fill(-1));
        const regions = [];
        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                if (board[r][c] !== 0 || regionOf[r][c] >= 0) continue;
                const id = regions.length;
                const points = [[r, c]];
                const adj = new Set();
                regionOf[r][c] = id;
                const queue = [[r, c]];
                for (let qi = 0; qi < queue.length; qi++) {
                    const [rr, cc] = queue[qi];
                    for (const [dr, dc] of dirs) {
                        const nr = rr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
                        const nv = board[nr][nc];
                        if (nv === 0) {
                            if (regionOf[nr][nc] < 0) {
                                regionOf[nr][nc] = id;
                                points.push([nr, nc]);
                                queue.push([nr, nc]);
                            }
                        } else if (chainOf[nr][nc] >= 0) {
                            adj.add(chainOf[nr][nc]);
                        }
                    }
                }
                regions.push({ points, adj });
            }
        }
        const chainRegions = chains.map(() => new Set());
        regions.forEach((reg, ri) => { reg.adj.forEach((ci) => chainRegions[ci].add(ri)); });
        // 3) 最大不动点：先假设全部链存活，反复剔除"不足两个要害区域"的链
        //    （要害区域 = 其邻接的所有链当前均存活且同色）
        const alive = new Array(chains.length).fill(true);
        let changed = true;
        while (changed) {
            changed = false;
            for (let ci = 0; ci < chains.length; ci++) {
                if (!alive[ci]) continue;
                const color = chains[ci].color;
                let vital = 0;
                for (const ri of chainRegions[ci]) {
                    let ok = true;
                    for (const aj of regions[ri].adj) {
                        if (!alive[aj] || chains[aj].color !== color) { ok = false; break; }
                    }
                    if (ok && ++vital >= 2) break;
                }
                if (vital < 2) { alive[ci] = false; changed = true; }
            }
        }
        // 4) 输出：活棋格与确定领地
        const aliveGrid = Array(boardSize).fill().map(() => Array(boardSize).fill(false));
        chains.forEach((ch, ci) => {
            if (!alive[ci]) return;
            for (const [r, c] of ch.stones) aliveGrid[r][c] = true;
        });
        const territory = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
        for (const reg of regions) {
            if (!reg.adj.size) continue;
            let owner = 0;
            let ok = true;
            for (const aj of reg.adj) {
                if (!alive[aj]) { ok = false; break; }
                const c = chains[aj].color;
                if (owner === 0) owner = c;
                else if (owner !== c) { ok = false; break; }
            }
            if (ok && owner) {
                for (const [r, c] of reg.points) territory[r][c] = owner;
            }
        }
        return { alive: aliveGrid, territory };
    }

function bensonCoreGrid(opts) {
    const width = opts.width, height = opts.height;
    const getNeighbors = opts.getNeighbors, isValid = opts.isValid, get = opts.get;
    const nb = Array(height).fill().map(() => Array(width).fill(null));
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!isValid(r, c)) continue;
            nb[r][c] = getNeighbors(r, c).filter((p) =>
                p[0] >= 0 && p[0] < height && p[1] >= 0 && p[1] < width && isValid(p[0], p[1]));
        }
    }
    const chainOf = Array(height).fill().map(() => Array(width).fill(-1));
    const chains = [];
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!nb[r][c]) continue;
            const v = get(r, c);
            if ((v !== 1 && v !== 2) || chainOf[r][c] >= 0) continue;
            const id = chains.length;
            const stones = [[r, c]];
            chainOf[r][c] = id;
            const queue = [[r, c]];
            for (let qi = 0; qi < queue.length; qi++) {
                const rr = queue[qi][0], cc = queue[qi][1];
                for (const p of nb[rr][cc]) {
                    const nr = p[0], nc = p[1];
                    if (get(nr, nc) === v && chainOf[nr][nc] < 0) {
                        chainOf[nr][nc] = id;
                        stones.push([nr, nc]);
                        queue.push([nr, nc]);
                    }
                }
            }
            chains.push({ color: v, stones });
        }
    }
    const regionOf = Array(height).fill().map(() => Array(width).fill(-1));
    const regions = [];
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!nb[r][c] || get(r, c) !== 0 || regionOf[r][c] >= 0) continue;
            const id = regions.length;
            const points = [[r, c]];
            const adj = new Set();
            regionOf[r][c] = id;
            const queue = [[r, c]];
            for (let qi = 0; qi < queue.length; qi++) {
                const rr = queue[qi][0], cc = queue[qi][1];
                for (const p of nb[rr][cc]) {
                    const nr = p[0], nc = p[1];
                    const nv = get(nr, nc);
                    if (nv === 0) {
                        if (regionOf[nr][nc] < 0) {
                            regionOf[nr][nc] = id;
                            points.push([nr, nc]);
                            queue.push([nr, nc]);
                        }
                    } else if (chainOf[nr][nc] >= 0) {
                        adj.add(chainOf[nr][nc]);
                    }
                }
            }
            regions.push({ points, adj });
        }
    }
    const chainRegions = chains.map(() => new Set());
    regions.forEach((reg, ri) => { reg.adj.forEach((ci) => chainRegions[ci].add(ri)); });
    // 最大不动点：先全部存活，反复剔除不足两个要害区域（邻接链均存活且同色）的链
    const alive = new Array(chains.length).fill(true);
    let changed = true;
    while (changed) {
        changed = false;
        for (let ci = 0; ci < chains.length; ci++) {
            if (!alive[ci]) continue;
            const color = chains[ci].color;
            let vital = 0;
            for (const ri of chainRegions[ci]) {
                let ok = true;
                for (const aj of regions[ri].adj) {
                    if (!alive[aj] || chains[aj].color !== color) { ok = false; break; }
                }
                if (ok && ++vital >= 2) break;
            }
            if (vital < 2) { alive[ci] = false; changed = true; }
        }
    }
    const aliveGrid = Array(height).fill().map(() => Array(width).fill(false));
    chains.forEach((ch, ci) => {
        if (!alive[ci]) return;
        for (const p of ch.stones) aliveGrid[p[0]][p[1]] = true;
    });
    const territory = Array(height).fill().map(() => Array(width).fill(0));
    for (const reg of regions) {
        if (!reg.adj.size) continue;
        let owner = 0;
        let ok = true;
        for (const aj of reg.adj) {
            if (!alive[aj]) { ok = false; break; }
            const cc2 = chains[aj].color;
            if (owner === 0) owner = cc2;
            else if (owner !== cc2) { ok = false; break; }
        }
        if (ok && owner) {
            for (const p of reg.points) territory[p[0]][p[1]] = owner;
        }
    }
    return { alive: aliveGrid, territory };
}

/**
 * Benson 无条件活（通用扁平图版）。
 * opts: { n, neighbors(id)->number[], get(id)->0/1/2 }
 * @returns {{ alive: boolean[], territory: number[] }}
 */
function bensonCoreGraph(opts) {
    const n = opts.n, neighbors = opts.neighbors, get = opts.get;
    const nb = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        nb[i] = (neighbors(i) || []).filter((j) => Number.isInteger(j) && j >= 0 && j < n);
    }
    const chainOf = new Array(n).fill(-1);
    const chains = [];
    for (let i = 0; i < n; i++) {
        const v = get(i);
        if ((v !== 1 && v !== 2) || chainOf[i] >= 0) continue;
        const id = chains.length;
        const stones = [i];
        chainOf[i] = id;
        const queue = [i];
        for (let qi = 0; qi < queue.length; qi++) {
            for (const j of nb[queue[qi]]) {
                if (get(j) === v && chainOf[j] < 0) {
                    chainOf[j] = id;
                    stones.push(j);
                    queue.push(j);
                }
            }
        }
        chains.push({ color: v, stones });
    }
    const regionOf = new Array(n).fill(-1);
    const regions = [];
    for (let i = 0; i < n; i++) {
        if (get(i) !== 0 || regionOf[i] >= 0) continue;
        const id = regions.length;
        const points = [i];
        const adj = new Set();
        regionOf[i] = id;
        const queue = [i];
        for (let qi = 0; qi < queue.length; qi++) {
            for (const j of nb[queue[qi]]) {
                const nv = get(j);
                if (nv === 0) {
                    if (regionOf[j] < 0) {
                        regionOf[j] = id;
                        points.push(j);
                        queue.push(j);
                    }
                } else if (chainOf[j] >= 0) {
                    adj.add(chainOf[j]);
                }
            }
        }
        regions.push({ points, adj });
    }
    const chainRegions = chains.map(() => new Set());
    regions.forEach((reg, ri) => { reg.adj.forEach((ci) => chainRegions[ci].add(ri)); });
    const alive = new Array(chains.length).fill(true);
    let changed = true;
    while (changed) {
        changed = false;
        for (let ci = 0; ci < chains.length; ci++) {
            if (!alive[ci]) continue;
            const color = chains[ci].color;
            let vital = 0;
            for (const ri of chainRegions[ci]) {
                let ok = true;
                for (const aj of regions[ri].adj) {
                    if (!alive[aj] || chains[aj].color !== color) { ok = false; break; }
                }
                if (ok && ++vital >= 2) break;
            }
            if (vital < 2) { alive[ci] = false; changed = true; }
        }
    }
    const aliveArr = new Array(n).fill(false);
    chains.forEach((ch, ci) => { if (alive[ci]) for (const i of ch.stones) aliveArr[i] = true; });
    const territory = new Array(n).fill(0);
    for (const reg of regions) {
        if (!reg.adj.size) continue;
        let owner = 0;
        let ok = true;
        for (const aj of reg.adj) {
            if (!alive[aj]) { ok = false; break; }
            const cc2 = chains[aj].color;
            if (owner === 0) owner = cc2;
            else if (owner !== cc2) { ok = false; break; }
        }
        if (ok && owner) for (const i of reg.points) territory[i] = owner;
    }
    return { alive: aliveArr, territory };
}

    /** 通用入口：供插件传入自定义邻接/有效点（网格图、带洞、桥等） */
    function bensonAliveGrid(opts) {
        return bensonCoreGrid(opts);
    }

    /** 通用入口：扁平顶点图 */
    function bensonAliveGraph(opts) {
        return bensonCoreGraph(opts);
    }

    /** Benson 无条件活（带洞方格版） */
    function bensonAliveWithHoles(board, boardSize, isHole) {
        return bensonCoreGrid({
            width: boardSize,
            height: boardSize,
            getNeighbors: function (r, c) { return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]; },
            isValid: function (r, c) { return !isHole(r, c); },
            get: function (r, c) { return board[r][c]; }
        });
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
            if (prefix !== 'B' && prefix !== 'W' && prefix !== 'N' && prefix !== 'H' && prefix !== 'I' && prefix !== 'M') continue;
            const comma = s.indexOf(',');
            if (comma <= 1) continue;
            const r = parseInt(s.slice(1, comma), 10);
            const c = parseInt(s.slice(comma + 1), 10);
            if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
            if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
            if (prefix === 'B') board[r][c] = 1;
            else if (prefix === 'W') board[r][c] = 2;
            else if (prefix === 'N') board[r][c] = 10000;
            else if (prefix === 'H') board[r][c] = -1;
            else if (prefix === 'I') board[r][c] = -2;
            else if (prefix === 'M') board[r][c] = -3;
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
            const playerVal = slotColorValue(null, move.player);
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

    /**
     * 座位 → 棋子颜色值（1 黑 / 2 白）。
     * 默认约定 player1 执黑；白先棋种（国际象棋等）在 opts.slotColor 里给出自己的换算。
     */
    function slotColorValue(opts, slot) {
        if (opts && typeof opts.slotColor === 'function') {
            try {
                const v = opts.slotColor(slot);
                if (v === 1 || v === 2) return v;
            } catch (_) { /* ignore */ }
        }
        return slot === 'player1' ? 1 : 2;
    }

    function rebuildLiveReplayFromMoveCoords(moveCoords, tryPlaceStone, deepCopyBoard, createEmptyBoard) {
        let curBoard = createEmptyBoard();
        const liveReplayBoards = [deepCopyBoard(curBoard)];
        const liveReplayMarkers = [[]];
        const liveReplayStepPlayers = [0];
        for (const move of (moveCoords || [])) {
            const playerVal = slotColorValue(null, move.player);
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

    /**
     * 增量版：liveReplayBoards 已同步到 startLen 手时，只对新的一手本地计算落子/提子。
     * 遇到不认识的着法类型返回 { ok: false }，调用方回退全量重建。
     */
    function applyLiveReplayIncrementalBoards(liveReplayBoards, liveReplayMarkers, liveReplayStepPlayers, moveCoords, tryPlaceStone, deepCopyBoard) {
        const startLen = liveReplayBoards.length - 1;
        const mcs = moveCoords || [];
        if (mcs.length <= startLen) return { ok: true };
        let curBoard = deepCopyBoard(liveReplayBoards[liveReplayBoards.length - 1]);
        for (let i = startLen; i < mcs.length; i++) {
            const move = mcs[i];
            const playerVal = slotColorValue(null, move.player);
            liveReplayStepPlayers.push(playerVal);
            if (move.type === 'move') {
                const newBoard = tryPlaceStone(curBoard, move.row, move.col, playerVal);
                if (newBoard) curBoard = newBoard;
                liveReplayBoards.push(deepCopyBoard(curBoard));
                liveReplayMarkers.push([{ row: move.row, col: move.col, color: playerVal }]);
            } else if (move.type === 'pass') {
                liveReplayBoards.push(deepCopyBoard(curBoard));
                liveReplayMarkers.push([]);
            } else {
                return { ok: false };
            }
        }
        return { ok: true };
    }

    /**
     * 试下开始时的行棋方：直播/回放当前局面的下一手，而非一律黑棋。
     * stepPlayers[step] 表示该步落子方；下一手为 3 - stepPlayers[step]。
     */
    function resolveTryPlaySideToMove(opts) {
        const fromLive = !!opts.fromLive;
        const currentPlayer = opts.currentPlayer;
        const stepPlayers = fromLive ? opts.liveReplayStepPlayers : opts.replayStepPlayers;
        const step = fromLive ? (opts.liveViewStep || 0) : (opts.replayStep || 0);
        const boardsLen = fromLive
            ? (opts.liveReplayBoardsLength || 0)
            : (opts.replayBoardsLength || 0);
        const total = Math.max(0, boardsLen - 1);
        if (step > 0 && stepPlayers && (stepPlayers[step] === 1 || stepPlayers[step] === 2)) {
            return 3 - stepPlayers[step];
        }
        // 直播跟最新的初始/当前局面：用服务器 currentPlayer（含白先等）
        if (fromLive && (currentPlayer === 1 || currentPlayer === 2) && step >= total) {
            return currentPlayer;
        }
        return 1;
    }

    function drawPitHole(row, col, ctx, padding, cellSize, boardSize, isHole)
    {
        const innerLeft = padding + Math.max(col - 0.5, 0) * cellSize;
        const innerTop = padding + Math.max(boardSize - 1 - row - 0.5, 0) * cellSize;
        const innerRight = padding + Math.min(col + 0.5, boardSize - 1) * cellSize;
        const innerBottom = padding + Math.min(boardSize - 1 - row + 0.5, boardSize - 1) * cellSize;
        const innerWidth = innerRight - innerLeft;
        const innerHeight = innerBottom - innerTop;

        ctx.fillStyle = '#d9c8ac';
        ctx.fillRect(innerLeft, innerTop, innerWidth, innerHeight);

        const shadowWidth = Math.max(4, cellSize * 0.2);
        if (!isHole(row - 1, col)) {
            const shadowTop = padding + Math.max(boardSize - 1 - row - 0.5, 0) * cellSize;
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
    function drawRedBlockHole(row, col, ctx, padding, cellSize, boardSize)
    {
        const x = padding + col * cellSize;
        const y = padding + (boardSize - 1 - row) * cellSize;
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

    function drawVoidHole(row, col, ctx, padding, cellSize, boardSize)
    {
        const strip = Math.max(4, cellSize * 0.3);
        const halfStrip = strip / 2;
        ctx.fillStyle = '#deb887';

        const x = padding + col * cellSize;
        const y = padding + (boardSize - 1 - row) * cellSize;
        // 上下相邻格(行号相邻即相邻,方向语义无关)
        if (row > 0)
            ctx.fillRect(x - halfStrip, y + halfStrip, strip, cellSize - 1);
        if (row < boardSize - 1)
            ctx.fillRect(x - halfStrip, 1 + padding + (boardSize - 1 - row - 1) * cellSize, strip, cellSize - 1);
        if (col > 0)
            ctx.fillRect(1 + padding + (col - 1) * cellSize, y - halfStrip, cellSize - 1, strip);
        if (col < boardSize - 1)
            ctx.fillRect(x, y - halfStrip, cellSize - 1, strip);
        ctx.restore();
    }

    function drawBridge(row, col, ctx, padding, cellSize, boardSize)
    {
        const x = padding + col * cellSize;
        const y = padding + (boardSize - 1 - row) * cellSize;
        const deckLength = cellSize * 0.76;
        const deckWidth = cellSize * 0.24;
        ctx.save();
        ctx.lineWidth = Math.max(1.4, cellSize * 0.065);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#174584';

        const verticalGrad = ctx.createLinearGradient(x - deckWidth, y, x + deckWidth, y);
        verticalGrad.addColorStop(0, '#5e9aca');
        verticalGrad.addColorStop(0.45, '#5d9ed8');
        verticalGrad.addColorStop(1, '#5e90cf');
        ctx.fillStyle = verticalGrad;
        // 底边(row=0)的桥朝上延展、顶边(row=boardSize-1)的桥朝下延展
        if (row == 0)
        {
            ctx.fillRect(x - deckWidth / 2, y - deckLength / 2, deckWidth, deckLength / 2 + deckWidth / 2);
            ctx.beginPath();
            ctx.moveTo(x - deckWidth / 2, y - deckLength / 2);
            ctx.lineTo(x - deckWidth / 2, y + deckWidth / 2);
            ctx.moveTo(x + deckWidth / 2, y - deckLength / 2);
            ctx.lineTo(x + deckWidth / 2, y + deckWidth / 2);
        }
        else if (row == boardSize - 1)
        {
            ctx.fillRect(x - deckWidth / 2, y - deckWidth / 2, deckWidth, deckLength / 2 + deckWidth / 2);
            ctx.beginPath();
            ctx.moveTo(x - deckWidth / 2, y - deckWidth / 2);
            ctx.lineTo(x - deckWidth / 2, y + deckLength / 2);
            ctx.moveTo(x + deckWidth / 2, y - deckWidth / 2);
            ctx.lineTo(x + deckWidth / 2, y + deckLength / 2);
        }
        else
        {
            ctx.fillRect(x - deckWidth / 2, y - deckLength / 2, deckWidth, deckLength);
            ctx.beginPath();
            ctx.moveTo(x - deckWidth / 2, y - deckLength / 2);
            ctx.lineTo(x - deckWidth / 2, y + deckLength / 2);
            ctx.moveTo(x + deckWidth / 2, y - deckLength / 2);
            ctx.lineTo(x + deckWidth / 2, y + deckLength / 2);
        }
        ctx.stroke();

        const horizontalGrad = ctx.createLinearGradient(x, y - deckWidth, x, y + deckWidth);
        horizontalGrad.addColorStop(0, '#5e9aca');
        horizontalGrad.addColorStop(0.45, '#5d9ed8');
        horizontalGrad.addColorStop(1, '#5e90cf');
        ctx.fillStyle = horizontalGrad;
        if (col == 0)
        {
            ctx.fillRect(x - deckWidth / 2 + ctx.lineWidth, y - deckWidth / 2, deckLength / 2 + deckWidth / 2 - ctx.lineWidth, deckWidth);
            ctx.beginPath();
            ctx.moveTo(x - deckWidth / 2, y - deckWidth / 2);
            ctx.lineTo(x + deckLength / 2, y - deckWidth / 2);
            ctx.moveTo(x - deckWidth / 2, y + deckWidth / 2);
            ctx.lineTo(x + deckLength / 2, y + deckWidth / 2);   
        }
        else if (col == boardSize - 1)
        {
            ctx.fillRect(x - deckLength / 2, y - deckWidth / 2, deckLength / 2 + deckWidth / 2 - ctx.lineWidth, deckWidth);
            ctx.beginPath();
            ctx.moveTo(x - deckLength / 2, y - deckWidth / 2);
            ctx.lineTo(x + deckWidth / 2, y - deckWidth / 2);
            ctx.moveTo(x - deckLength / 2, y + deckWidth / 2);
            ctx.lineTo(x + deckWidth / 2, y + deckWidth / 2);
        }
        else
        {
            ctx.fillRect(x - deckLength / 2, y - deckWidth / 2, deckLength, deckWidth);
            ctx.beginPath();
            ctx.moveTo(x - deckLength / 2, y - deckWidth / 2);
            ctx.lineTo(x + deckLength / 2, y - deckWidth / 2);
            ctx.moveTo(x - deckLength / 2, y + deckWidth / 2);
            ctx.lineTo(x + deckLength / 2, y + deckWidth / 2);
        }
        ctx.stroke();

        ctx.restore();
    }

    function drawNeutralStone(row, col, ctx, padding, cellSize, boardSize)
    {
        const radius = 0.44 * cellSize;
        const x = padding + col * cellSize, y = padding + (boardSize - 1 - row) * cellSize;
        ctx.save();
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowOffsetY = 2;
        const grad = ctx.createRadialGradient(x - 3, y - 3, radius * 0.2, x, y, radius * 1.2);
        grad.addColorStop(0, '#70b080');
        grad.addColorStop(0.5, '#509060');
        grad.addColorStop(1, '#307040');
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
    }

    function drawMine(row, col, ctx, padding, cellSize, boardSize)
    {
        const cx = padding + col * cellSize;
        const cy = padding + (boardSize - 1 - row) * cellSize;
        const spikeOuter = cellSize * 0.43, spikeInner = cellSize * 0.26, bodyRadius = cellSize * 0.24;
        ctx.save();
        ctx.shadowBlur = Math.max(4, cellSize * 0.1);
        ctx.shadowColor = 'rgba(10,10,10,0.45)';
        ctx.shadowOffsetY = Math.max(1, cellSize * 0.04);
        ctx.fillStyle = '#303030';
        for (let i = 0; i < 8; i++) {
            const a = (Math.PI / 4) * i;
            const ax = Math.cos(a), ay = Math.sin(a);
            const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(cx + ax * spikeOuter, cy + ay * spikeOuter);
            ctx.lineTo(cx + ax * spikeInner + px * cellSize * 0.05, cy + ay * spikeInner + py * cellSize * 0.05);
            ctx.lineTo(cx + ax * spikeInner - px * cellSize * 0.05, cy + ay * spikeInner - py * cellSize * 0.05);
            ctx.closePath();
            ctx.fill();
        }
        const bodyGrad = ctx.createRadialGradient(cx - bodyRadius * 0.35, cy - bodyRadius * 0.35, bodyRadius * 0.2, cx, cy, bodyRadius * 1.15);
        bodyGrad.addColorStop(0, '#6c6c6c');
        bodyGrad.addColorStop(0.45, '#4e4e4e');
        bodyGrad.addColorStop(1, '#252525');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(cx - bodyRadius * 0.38, cy - bodyRadius * 0.45, bodyRadius * 0.23, 0, Math.PI * 2);
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

    function checkWuziqiFiveInRow(board, row, col, colorVal, boardSize) {
        if (board[row][col] !== colorVal) return false;
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < 5; step++) {
                const nr = row + dx * step, nc = col + dy * step;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize || board[nr][nc] !== colorVal) break;
                count++;
            }
            for (let step = 1; step < 5; step++) {
                const nr = row - dx * step, nc = col - dy * step;
                if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize || board[nr][nc] !== colorVal) break;
                count++;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    function checkDiagonalFour(board, row, col, colorVal, boardSize) {
        if (board[row][col] !== colorVal) return false;
        const dirs = [[1, 1], [1, -1]];
        for (const [dr, dc] of dirs) {
            for (let start = -3; start <= 0; start++) {
                let ok = true;
                for (let i = 0; i < 4; i++) {
                    const r = row + (start + i) * dr;
                    const c = col + (start + i) * dc;
                    if (r < 0 || r >= boardSize || c < 0 || c >= boardSize || board[r][c] !== colorVal) {
                        ok = false;
                        break;
                    }
                }
                if (ok) return true;
            }
        }
        return false;
    }

    function checkSquareFour(board, row, col, colorVal, boardSize) {
        if (board[row][col] !== colorVal) return false;
        const origins = [
            [row, col],
            [row - 1, col],
            [row, col - 1],
            [row - 1, col - 1]
        ];
        for (const [a, b] of origins) {
            if (a < 0 || b < 0 || a + 1 >= boardSize || b + 1 >= boardSize) continue;
            if (
                board[a][b] === colorVal &&
                board[a + 1][b] === colorVal &&
                board[a][b + 1] === colorVal &&
                board[a + 1][b + 1] === colorVal
            ) {
                return true;
            }
        }
        return false;
    }

    /** @returns {'win'|'lose'|null} 斜四负优先于方四胜 */
    function evaluateSquareDiagonalFour(board, row, col, colorVal, boardSize) {
        if (checkDiagonalFour(board, row, col, colorVal, boardSize)) return 'lose';
        if (checkSquareFour(board, row, col, colorVal, boardSize)) return 'win';
        return null;
    }

    function isWuziqiBoardFull(board, boardSize) {
        for (let r = 0; r < boardSize; r++)
            for (let c = 0; c < boardSize; c++)
                if (board[r][c] === 0) return false;
        return true;
    }

    function tryPlaceStoneWuziqi(boardBefore, row, col, playerVal, boardSize, copyBoardFn) {
        if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return null;
        if (boardBefore[row][col] !== 0) return null;
        const nb = copyBoardFn(boardBefore);
        nb[row][col] = playerVal;
        return nb;
    }

    function parseWuziqiRecordMoveEntry(entry) {
        if (typeof entry === 'string') {
            const ch = entry[0];
            if (ch !== 'B' && ch !== 'W') return null;
            const player = ch === 'B' ? 'player1' : 'player2';
            if (entry.length >= 2 && entry[1] === 'p') return { type: 'pass', player };
            const coords = entry.substring(1).split(',').map(Number);
            if (coords.length < 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return null;
            return { type: 'move', player, row: coords[0], col: coords[1] };
        }
        if (entry && entry.type === 'pass' && entry.player)
            return { type: 'pass', player: entry.player };
        if (entry && entry.player && Number.isFinite(entry.row) && Number.isFinite(entry.col))
            return { type: 'move', player: entry.player, row: entry.row, col: entry.col };
        return null;
    }

    /**
     * @param {boolean} reverseWin 反五子棋：连成五子的一方判负
     */
    function buildWuziqiReplaySnapshotsFromMoves(moves, boardSize, reverseWin, initBoardArray, deepCopyBoard) {
        const history = [];
        for (const raw of moves || []) {
            const p = parseWuziqiRecordMoveEntry(raw);
            if (!p) return null;
            history.push(p);
        }
        const snaps = [];
        let b = initBoardArray(boardSize);
        let cur = 1;
        let trailingPass = 0;
        snaps.push({
            board: deepCopyBoard(b),
            lastMoveMarkers: [],
            currentPlayer: 1,
            gameOver: false,
            winner: null
        });
        for (const m of history) {
            let go = false;
            let win = null;
            let nextCur = cur;
            let markers = [];
            if (m.type === 'pass') {
                trailingPass++;
                markers = [];
                nextCur = cur === 1 ? 2 : 1;
                if (trailingPass >= 2) {
                    go = true;
                    win = 'draw';
                    nextCur = cur;
                }
            } else {
                trailingPass = 0;
                const pv = slotColorValue(null, m.player);
                b[m.row][m.col] = pv;
                markers = [{ row: m.row, col: m.col, color: pv }];
                if (checkWuziqiFiveInRow(b, m.row, m.col, pv, boardSize)) {
                    go = true;
                    win = reverseWin ? (m.player === 'player1' ? 'player2' : 'player1') : m.player;
                    nextCur = cur;
                } else if (isWuziqiBoardFull(b, boardSize)) {
                    go = true;
                    win = 'draw';
                    nextCur = cur === 1 ? 2 : 1;
                } else {
                    nextCur = cur === 1 ? 2 : 1;
                }
            }
            snaps.push({
                board: deepCopyBoard(b),
                lastMoveMarkers: markers.map(x => ({ ...x })),
                currentPlayer: nextCur,
                gameOver: go,
                winner: go ? win : null
            });
            cur = nextCur;
            if (go) break;
        }
        return snaps;
    }

    function buildSquareDiagonalFourReplaySnapshotsFromMoves(moves, boardSize, initBoardArray, deepCopyBoard) {
        const history = [];
        for (const raw of moves || []) {
            const p = parseWuziqiRecordMoveEntry(raw);
            if (!p) return null;
            history.push(p);
        }
        const snaps = [];
        let b = initBoardArray(boardSize);
        let cur = 1;
        let trailingPass = 0;
        snaps.push({
            board: deepCopyBoard(b),
            lastMoveMarkers: [],
            currentPlayer: 1,
            gameOver: false,
            winner: null
        });
        for (const m of history) {
            let go = false;
            let win = null;
            let nextCur = cur;
            let markers = [];
            if (m.type === 'pass') {
                trailingPass++;
                markers = [];
                nextCur = cur === 1 ? 2 : 1;
                if (trailingPass >= 2) {
                    go = true;
                    win = 'draw';
                    nextCur = cur;
                }
            } else {
                trailingPass = 0;
                const pv = slotColorValue(null, m.player);
                b[m.row][m.col] = pv;
                markers = [{ row: m.row, col: m.col, color: pv }];
                const outcome = evaluateSquareDiagonalFour(b, m.row, m.col, pv, boardSize);
                if (outcome === 'lose') {
                    go = true;
                    win = m.player === 'player1' ? 'player2' : 'player1';
                    nextCur = cur;
                } else if (outcome === 'win') {
                    go = true;
                    win = m.player;
                    nextCur = cur;
                } else if (isWuziqiBoardFull(b, boardSize)) {
                    go = true;
                    win = 'draw';
                    nextCur = cur === 1 ? 2 : 1;
                } else {
                    nextCur = cur === 1 ? 2 : 1;
                }
            }
            snaps.push({
                board: deepCopyBoard(b),
                lastMoveMarkers: markers.map(x => ({ ...x })),
                currentPlayer: nextCur,
                gameOver: go,
                winner: go ? win : null
            });
            cur = nextCur;
            if (go) break;
        }
        return snaps;
    }

    /**
     * 试下模式的「虚着 / 悔棋」公共实现（所有棋类共用，按钮绑定见 createWeiqiMessageBindings）。
     * - 进入试下时给 body 加 qi-tryplay 类：CSS 用它强制显示 #passBtn / #undoBtn（平时这两个按钮
     *   被各棋类按对局状态藏起来）；退出试下时移除类，按钮立刻回到各棋类自己设置的显隐。
     * - 虚着：直接推进一手（棋盘不变、本步无落子标记），不需要对方确认。
     * - 悔棋：直接退回上一手，同样不需要对方确认。
     * 特殊棋类可在 bindings 的 ctx 里传 tryPlayPass / tryPlayUndo 覆盖默认实现。
     */
    function syncTryPlayActionButtons(pageState) {
        if (typeof document === 'undefined' || !document.body) return;
        document.body.classList.toggle('qi-tryplay', !!(pageState && pageState.tryPlayMode));
    }

    /** 深拷贝一步状态：只处理按步数据里会出现的普通对象/数组/Set/Map */
    function copyTryPlayStepValue(v) {
        if (Array.isArray(v)) return v.map((x) => copyTryPlayStepValue(x));
        if (v instanceof Set) return new Set(Array.from(v, (x) => copyTryPlayStepValue(x)));
        if (v instanceof Map) return new Map(Array.from(v, ([k, x]) => [k, copyTryPlayStepValue(x)]));
        if (v && typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v)) out[k] = copyTryPlayStepValue(v[k]);
            return out;
        }
        return v;
    }

    /** 快照型棋类：找「另一方」的取值（'red'↔'black'、'white'↔'black' 等） */
    function findTryPlayOppositeSide(ctx, S, curSide) {
        if (typeof ctx.tryPlayOppositeSide === 'function') {
            const v = ctx.tryPlayOppositeSide(curSide);
            if (v != null && v !== curSide) return v;
        }
        // 各棋类的历史快照里两侧都出现过，取一个与当前方不同的值即可
        const pools = [S.tryPlaySnapshots, S.liveSnapshots, S.replaySnapshots, S.tryPlaySnaps, S.liveSnaps];
        for (const pool of pools) {
            if (!Array.isArray(pool)) continue;
            for (const s of pool) {
                if (!s || typeof s !== 'object') continue;
                const v = s.sideToMove != null ? s.sideToMove : (s.side != null ? s.side : null);
                if (v != null && v !== curSide) return v;
            }
        }
        return null;
    }

    /** 虚着默认实现：棋子型（tryPlayBoards）与快照型（tryPlaySnapshots）都能直接推进一手 */
    function tryPlayPassDefault(ctx) {
        const S = ctx.pageState;
        if (!S || !S.tryPlayMode) return false;
        const step = S.tryPlayStep | 0;
        const total = S.tryPlayTotalSteps | 0;
        // 在分支中段虚着：先砍掉后面的分支（只截断长度与总步数一致的按步数组）
        for (const key of Object.keys(S)) {
            if (!/^tryPlay[A-Z]/.test(key)) continue;
            const arr = S[key];
            if (Array.isArray(arr) && arr.length === total + 1 && arr.length > step + 1) arr.length = step + 1;
        }
        // 其余按步数据原样复制一步：虚着不改变它们（如易位/提子计数/不稳信息/镜像轴等）
        const copyOtherSteps = (skipKeys) => {
            for (const key of Object.keys(S)) {
                if (!/^tryPlay[A-Z]/.test(key) || skipKeys.indexOf(key) >= 0) continue;
                const arr = S[key];
                if (!Array.isArray(arr) || arr.length !== step + 1) continue;
                arr.push(copyTryPlayStepValue(arr[step]));
            }
        };

        let totalSteps;
        if (Array.isArray(S.tryPlayBoards) && S.tryPlayBoards.length > step) {
            // 棋子型（围棋/五子棋/黑白棋等）：棋盘不变、本步没有落子标记
            const playerNow = (Array.isArray(S.tryPlayCurrentPlayers) && S.tryPlayCurrentPlayers[step] != null)
                ? S.tryPlayCurrentPlayers[step]
                : ((S.tryPlayCurrentPlayer === 1 || S.tryPlayCurrentPlayer === 2) ? S.tryPlayCurrentPlayer : null);
            S.tryPlayBoards.push(copyTryPlayStepValue(S.tryPlayBoards[step]));
            if (Array.isArray(S.tryPlayMarkers)) S.tryPlayMarkers.push([]);
            copyOtherSteps(['tryPlayBoards', 'tryPlayMarkers', 'tryPlayStepPlayers', 'tryPlayCurrentPlayers']);
            if (playerNow != null) {
                if (Array.isArray(S.tryPlayStepPlayers)) S.tryPlayStepPlayers.push(playerNow);
                if (Array.isArray(S.tryPlayCurrentPlayers)) S.tryPlayCurrentPlayers.push(3 - playerNow);
            }
            totalSteps = S.tryPlayBoards.length - 1;
        } else if (Array.isArray(S.tryPlaySnapshots) && S.tryPlaySnapshots.length > step) {
            // 快照型（象棋/国际象棋/将棋/韩国将棋等）：复制当前快照、交换行棋方、清掉上一手痕迹
            const cur = S.tryPlaySnapshots[step];
            if (!cur || typeof cur !== 'object') return false;
            const next = copyTryPlayStepValue(cur);
            let flipped = false;
            if (next.currentPlayer === 1 || next.currentPlayer === 2) {
                next.currentPlayer = 3 - next.currentPlayer;
                flipped = true;
            } else {
                const field = ('sideToMove' in next) ? 'sideToMove' : (('side' in next) ? 'side' : null);
                if (field) {
                    const opp = findTryPlayOppositeSide(ctx, S, next[field]);
                    if (opp != null) { next[field] = opp; flipped = true; }
                }
            }
            if (!flipped) return false;
            if ('lastFrom' in next) next.lastFrom = null;
            if ('lastTo' in next) next.lastTo = null;
            if ('enPassant' in next) next.enPassant = null;
            S.tryPlaySnapshots.push(next);
            copyOtherSteps(['tryPlaySnapshots']);
            totalSteps = S.tryPlaySnapshots.length - 1;
        } else {
            return false;
        }

        S.tryPlayTotalSteps = totalSteps;
        if (typeof ctx.setTryPlayStep === 'function') ctx.setTryPlayStep(totalSteps);
        // 部分棋类的 setTryPlayStep 只同步滑块 value、不同步 max，这里补齐（否则拉不到新的一手）
        const slider = document.getElementById('replaySlider');
        if (slider) {
            slider.max = String(totalSteps);
            slider.value = String(totalSteps);
        }
        // 也有棋种的步进函数只动滑块（不刷新步数显示/棋盘），补一次；各棋种自己的显示函数优先
        if (typeof ctx.updateTryPlayDisplay === 'function') ctx.updateTryPlayDisplay();
        if (typeof ctx.drawBoard === 'function') ctx.drawBoard();
        syncTryPlayActionButtons(S);
        return true;
    }

    /** 悔棋默认实现：直接退回上一手 */
    function tryPlayUndoDefault(ctx) {
        const S = ctx.pageState;
        if (!S || !S.tryPlayMode || typeof ctx.setTryPlayStep !== 'function') return false;
        const step = S.tryPlayStep | 0;
        if (step <= 0) return false;
        ctx.setTryPlayStep(step - 1);
        // 少数棋类的 setTryPlayStep 不更新滑块/显示，这里补一次（与虚着保持一致）。
        // 注意：闭包型棋种（试下状态在插件局部变量里）的 pageState 上没有这两个字段，此时不要动滑块，
        // 否则会把 max 写成 0、把滑块夹回去。
        const slider = document.getElementById('replaySlider');
        if (slider && typeof S.tryPlayStep === 'number' && typeof S.tryPlayTotalSteps === 'number') {
            slider.max = String(S.tryPlayTotalSteps);
            slider.value = String(S.tryPlayStep);
        }
        if (typeof ctx.updateTryPlayDisplay === 'function') ctx.updateTryPlayDisplay();
        if (typeof ctx.drawBoard === 'function') ctx.drawBoard();
        return true;
    }

    global.QiWeiqiSquarePageRuntime = {
        create,
        syncTryPlayActionButtons,
        tryPlayPassDefault,
        tryPlayUndoDefault,
        setupHiDpiCanvas: global.QiSquareWeiqiCanvas.setupHiDpiCanvas,
        applyBoardWoodTexture: global.QiSquareWeiqiCanvas.applyBoardWoodTexture,
        getWoodFill: global.QiSquareWeiqiCanvas.getWoodFill,
        clearUserBoardMarksMap,
        bindActiveUserBoardMarks,
        waitingSeatTurnText,
        roundTurnText,
        countGroupLiberties, 
        hasLiberty, 
        removeGroup, 
        tryPlaceStoneNLiberty, 
        isLibertySurroundedByOpponent, 
        removeDeadAndDying, 
        bensonAlive, 
        bensonAliveWithHoles, 
        bensonAliveGrid, 
        bensonAliveGraph, 
        assignTerritoryWithRange, 
        computeScore, 
        removeDeadAndDyingWithHoles, 
        assignTerritoryWithRangeWithHoles, 
        computeScoreWithHoles, 
        rebuildLiveReplayFromMoveCoords, 
        applyLiveReplayIncrementalBoards, 
        buildReplayFromImportData,
        resolveTryPlaySideToMove,
        applyInitialPositionCompact,
        installBoardEditUI,
        DEFAULT_EDIT_CELL_BY_TOOL,
        buildEditToolValueMap,
        resolveEditToolCellValue,
        formatKomiInfoText,
        writeKomiInfoText,
        defaultKomiTotalPoints,
        countBoardPlayerStones,
        pickRichestBoard,
        drawPitHole,
        drawRedBlockHole,
        drawVoidHole,
        drawBridge,
        drawNeutralStone,
        drawMine,
        stoneAccent,
        stoneDanger,
        invisibleDrawStone,
        cellWeight,
        neutralDrawSmallMarker,
        checkWuziqiFiveInRow,
        isWuziqiBoardFull,
        tryPlaceStoneWuziqi,
        parseWuziqiRecordMoveEntry,
        buildWuziqiReplaySnapshotsFromMoves,
        evaluateSquareDiagonalFour,
        checkDiagonalFour,
        checkSquareFour,
        buildSquareDiagonalFourReplaySnapshotsFromMoves,
    };
})(typeof window !== 'undefined' ? window : global);

/* ========== 5. 房间壳 boot ========== */
(function () {
    'use strict';

    function parseRoomFromPath() {
        const pathMatch = window.location.pathname.match(/^\/qi\/([^/]+)\/(\d+)$/);
        if (!pathMatch) return null;
        return { gameType: pathMatch[1], roomId: pathMatch[2] };
    }

    function fillBoardSizeSelect(select, config) {
        if (!select) return;
        select.innerHTML = '';
        const values = Array.isArray(config.boardSizeValues) && config.boardSizeValues.length
            ? config.boardSizeValues.slice()
            : null;
        const min = config.boardSizeMin;
        const max = config.boardSizeMax;
        const step = config.boardSizeStep > 1 ? config.boardSizeStep : 1;
        const selected = config.defaultBoardSize;
        const labelIsPrefix = !!config.sizeLabelIsPrefix;
        const label = config.sizeLabel || '路';
        const nums = values || (() => {
            const a = [];
            for (let n = min; n <= max; n += step) a.push(n);
            return a;
        })();
        for (const n of nums) {
            const opt = document.createElement('option');
            opt.value = String(n);
            opt.textContent = labelIsPrefix ? (label + n) : (n + label);
            if (n === selected) opt.selected = true;
            select.appendChild(opt);
        }
    }

    /**
     * 编辑工具图标的文字颜色：优先取工具自带 color（国际象棋等自定色）；否则按棋盘值默认：
     * 围棋黑子黑、白子深灰；象棋红方 #932c13、黑方 #222
     */
    function editToolGlyphColor(t) {
        if (t && t.color) return t.color;
        const v = t && t.cellValue;
        if (v === 1) return '#222';
        if (v === 2) return '#444';
        if (typeof v === 'string') {
            if (v.charAt(0) === 'r') return '#932c13';
            if (v.charAt(0) === 'w') return '#333';
            if (v.charAt(0) === 'b') return '#222';
        }
        return 'var(--qi-room-ink)';
    }

    /**
     * 自定义编辑工具选择器：原生 select 的 option 无法按棋子着色，改用 HTML 文字（矢量渲染、红黑分色）。
     * 列数按单边子力数计算（象棋 7、国际象棋 6），「空」独占一行；glyphSize 可指定当前框字号（国际象棋 26）。
     */
    function createEditToolPicker(select, tools, glyphSize) {
        if (!select || !select.parentNode) return;
        const list = Array.isArray(tools) && tools.length
            ? tools
            : [
                { value: 'empty', label: '空' },
                { value: 'black', label: '黑子' },
                { value: 'white', label: '白子' }
            ];
        if (list.length < 2) return;
        const wrap = document.createElement('div');
        wrap.className = 'qi-edit-tool-picker hidden';
        const current = document.createElement('button');
        current.type = 'button';
        current.className = 'qi-edit-tool-current';
        const curSpan = document.createElement('span');
        curSpan.className = 'qi-edit-tool-glyph';
        current.appendChild(curSpan);
        // 编辑框字号：棋子字符用配置字号（国际象棋 26px）；文字（黑、白、空等）用 CSS 默认（16px）
        const isPieceGlyph = (t) => {
            const v = t && t.cellValue;
            return typeof v === 'string' && v.length > 1;
        };
        // 字号规则（下拉框）：棋子字符（車馬/♕♖♘ 等）用新字号，默认 26px；
        // 非棋子文字（空、黑子、白子等）用原本字号 16px
        const pieceFontSize = () => ((glyphSize || 26)) + 'px';
        const TEXT_GLYPH_SIZE = '16px';
        const labelFontSize = (t) => (isPieceGlyph(t) ? pieceFontSize() : TEXT_GLYPH_SIZE);
        // 编辑框本框字号：整体为下拉框的 70%（长度、宽度、字号等一并缩小）
        const curFontSize = (t) => ((isPieceGlyph(t) ? (glyphSize || 26) : 16) * 0.7) + 'px';
        const panel = document.createElement('div');
        panel.className = 'qi-edit-tool-panel hidden';
        // 列数 = 单边子力数（象棋 7、国际象棋 6、围棋空/黑/白则每行一个）
        let cols = 1;
        {
            const sideCounts = new Map();
            for (const t of list) {
                const v = t && t.cellValue;
                if (v == null || v === '' || v === 0 || (t && t.value === 'empty')) continue;
                const c = String(v).charAt(0);
                sideCounts.set(c, (sideCounts.get(c) || 0) + 1);
            }
            for (const n of sideCounts.values()) cols = Math.max(cols, n);
        }
        panel.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        const applyGlyphStyle = (span, t) => {
            span.style.color = editToolGlyphColor(t);
            // 浅色棋子（如国际象棋黑方在白底反白）加同色描边，保证白底可见
            span.style.textShadow = (t && t.stroke)
                ? `1px 1px 0 ${t.stroke}, -1px -1px 0 ${t.stroke}, 1px -1px 0 ${t.stroke}, -1px 1px 0 ${t.stroke}`
                : '';
            // 倒置棋子（如古印度象棋的象与士）旋转 180° 并向上偏移对齐（与棋盘绘制比例一致：0.1×字号）
            // 切换工具时先清除残留 transform/display，否则选过倒置棋子后正常棋子也一直倒置显示
            span.style.display = '';
            span.style.transform = '';
            if (t && t.upsideDown) {
                span.style.display = 'inline-block';
                span.style.transform = 'rotate(180deg) translateY(0.1em)';
            }
            // 叠加棋子（如国际象棋的相/亚）：同一位置上下叠加，上层=label[0]（马）靠上、下层=label[1]（车/后）靠下，各 0.9×，总高一致
            span.style.position = '';
            span.style.width = '';
            span.style.height = '';
            if (t && t.stack && typeof t.label === 'string' && t.label.length >= 2) {
                span.style.position = 'relative';
                span.style.display = 'inline-block';
                span.style.width = '1em';
                span.style.height = '1em';
                span.innerHTML = ''
                    + '<i style="position:absolute;top:0;left:0;right:0;text-align:center;font-style:normal;font-size:0.9em;line-height:1.1">' + t.label.charAt(0) + '</i>'
                    + '<i style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-style:normal;font-size:0.9em;line-height:1.1">' + t.label.charAt(1) + '</i>';
            }
        };
        for (const t of list) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'qi-edit-tool-item' + (t.value === 'empty' ? ' is-empty' : '');
            const span = document.createElement('span');
            span.className = 'qi-edit-tool-glyph' + (t.value === 'empty' ? ' is-empty' : '');
            span.textContent = t.label;
            applyGlyphStyle(span, t);
            span.style.fontSize = labelFontSize(t);
            b.appendChild(span);
            b.title = t.label;
            b.addEventListener('click', () => {
                select.value = t.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                panel.classList.add('hidden');
                curSpan.textContent = t.label;
                applyGlyphStyle(curSpan, t);
                curSpan.style.fontSize = curFontSize(t);
                curSpan.classList.toggle('is-empty', t.value === 'empty');
            });
            panel.appendChild(b);
        }
        current.addEventListener('click', () => {
            if (panel.classList.contains('hidden')) {
                // 挂到 body + fixed 定位，脱离编辑控件父链的层叠上下文，避免被棋盘/蒙版遮挡
                const r = current.getBoundingClientRect();
                panel.style.left = `${Math.max(4, r.left)}px`;
                panel.style.top = `${r.bottom + 4}px`;
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
        });
        const cur = list.find((t) => t.value === select.value) || list[0];
        curSpan.textContent = cur.label;
        applyGlyphStyle(curSpan, cur);
        curSpan.style.fontSize = curFontSize(cur);
        curSpan.classList.toggle('is-empty', cur.value === 'empty');
        wrap.appendChild(current);
        select.parentNode.insertBefore(wrap, select.nextSibling);
        // 面板挂到 body（fixed 定位在根层叠上下文，z-index 9999 高于棋盘/蒙版）
        document.body.appendChild(panel);
        // 原生 select 恒隐藏（picker 替代）；显示/隐藏跟随 select 的 hidden class（installBoardEditUI 控制）
        select.style.display = 'none';
        const syncHidden = () => wrap.classList.toggle('hidden', select.classList.contains('hidden'));
        syncHidden();
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(syncHidden).observe(select, { attributes: true, attributeFilter: ['class'] });
        }
        select.addEventListener('change', () => {
            const t = list.find((x) => x.value === select.value);
            if (t) {
                curSpan.textContent = t.label;
                applyGlyphStyle(curSpan, t);
                curSpan.style.fontSize = curFontSize(t);
                curSpan.classList.toggle('is-empty', t.value === 'empty');
            }
        });
    }

    function fillEditToolSelect(select, tools, glyphSize) {
        if (!select) return;
        const list = Array.isArray(tools) && tools.length
            ? tools
            : [
                { value: 'empty', label: '空' },
                { value: 'black', label: '黑子' },
                { value: 'white', label: '白子' }
            ];
        select.innerHTML = '';
        for (const t of list) {
            const opt = document.createElement('option');
            opt.value = t.value;
            opt.textContent = t.label;
            select.appendChild(opt);
        }
        createEditToolPicker(select, list, glyphSize);
    }

    function applyShellChrome(config) {
        const features = config.features || {};
        document.title = config.title;
        const titleEl = document.getElementById('gameTitleInfo');
        if (titleEl) titleEl.textContent = config.title;
        const komiInfo = document.getElementById('komiInfo');
        if (komiInfo) komiInfo.textContent = config.defaultKomiText;
        const rulesTitle = document.getElementById('rulesTitle');
        if (rulesTitle) rulesTitle.textContent = config.title;
        const rulesBody = document.getElementById('rulesBody');
        if (rulesBody) rulesBody.innerHTML = config.rulesHtml;

        const sizeSel = document.getElementById('boardSizeSelect');
        fillBoardSizeSelect(sizeSel, config);
        if (sizeSel) {
            sizeSel.style.display = features.hideBoardSize ? 'none' : sizeSel.style.display;
            if (features.hideBoardSize) sizeSel.hidden = true;
        }

        const edit = document.getElementById('editControls');
        if (edit) {
            if (features.editBoard) edit.dataset.qiEditFeature = '1';
            else delete edit.dataset.qiEditFeature;
            edit.hidden = !features.editBoard;
        }
        fillEditToolSelect(document.getElementById('editToolSelect'), config.editTools, config.editToolGlyphSize);

        const styleSelect = document.getElementById('styleSelect');
        if (styleSelect) styleSelect.hidden = !features.holeStyle;

        const setHidden = (id, on) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.hidden = !on;
            if (!on && el.style) {
                if (id === 'replayMinesRow' || id === 'replayPerspectiveRow') el.style.display = 'none';
            }
        };
        setHidden('replayMinesRow', !!features.replayMines);
        setHidden('replayPerspectiveRow', !!features.replayPerspective);
        setHidden('showLibertyStonesLabel', !!features.nogridExtras);
        setHidden('showAdjacentLinesLabel', !!features.nogridExtras);
        setHidden('showLibertyLabel', !!features.continuousExtras);
        setHidden('showGridLabel', !!features.continuousExtras);
        setHidden('sideSelect', !!features.versusMinesweeper);
        setHidden('scoreCompoundRow', !!features.russianCompound);

        const titleEl2 = document.getElementById('gameTitleInfo');
        const komiEl = document.getElementById('komiInfo');
        if (features.versusMinesweeper) {
            if (titleEl2) titleEl2.hidden = true;
            if (komiEl) komiEl.hidden = true;
        }

        const palette = document.getElementById('bottomPalette');
        const vlBags = document.getElementById('vlBagsPalette');
        const qdBags = document.getElementById('quoridorBagsPalette');
        const dyeingBags = document.getElementById('dyeingBagsPalette');
        const boardAndInfo = document.getElementById('boardAndInfo');
        const useCompound = !!features.compoundPalette;
        const useVlBags = !!features.vlBags;
        const useQdBags = !!features.quoridorBags;
        const useDyeingBags = !!features.dyeingBags;
        const useRussian = !!features.russianCompound;
        const useShogiBags = !!features.shogiBags;

        if (palette) palette.hidden = !useCompound;
        if (vlBags) vlBags.hidden = !useVlBags;
        if (qdBags) qdBags.hidden = !useQdBags;
        if (dyeingBags) dyeingBags.hidden = !useDyeingBags;

        if (useRussian) {
            const host = document.getElementById('compoundTransformButtons');
            const transforms = palette && palette.querySelector('.transform-buttons');
            const pieceRow = document.getElementById('shapeSelector');
            if (host && transforms && transforms.parentElement !== host) host.appendChild(transforms);
            if (pieceRow) pieceRow.hidden = true;
            if (palette) palette.hidden = true;
        } else {
            const host = document.getElementById('compoundTransformButtons');
            const transforms = host && host.querySelector('.transform-buttons');
            if (palette && transforms && transforms.parentElement !== palette) {
                palette.appendChild(transforms);
            }
            const pieceRow = document.getElementById('shapeSelector');
            if (pieceRow) pieceRow.hidden = false;
        }

        if (useCompound || useVlBags || useQdBags || useDyeingBags) {
            if (boardAndInfo) boardAndInfo.classList.add('board-and-info--palette-stack');
        } else if (boardAndInfo) {
            boardAndInfo.classList.remove('board-and-info--palette-stack');
        }

        document.body.classList.toggle('qi-room-has-palette', useCompound || useRussian);
        document.body.classList.toggle('qi-room-has-vl-bags', useVlBags);
        document.body.classList.toggle('qi-room-has-qd-bags', useQdBags);
        document.body.classList.toggle('qi-room-has-dyeing-bags', useDyeingBags);
        document.body.classList.toggle('qi-room-shogi-bags', useShogiBags);
        document.body.classList.toggle('qi-room-transparent-canvas', !!features.transparentCanvas);
        document.body.classList.toggle('qi-room-circular-chess', !!features.circularChess);
        document.body.classList.toggle('qi-room-xiangqi', !!features.xiangqi);
        document.body.classList.toggle('qi-room-chess', !!features.chess);
        document.body.classList.toggle('qi-room-simulated-makruk', !!features.simulatedMakruk);
        document.body.classList.toggle('qi-room-simulated-shogi', !!features.simulatedShogi);
        document.body.classList.toggle('qi-room-janggi', !!features.janggi);
        document.body.classList.toggle('qi-room-hexagon-xiangqi', !!features.hexagonXiangqi);
        document.body.classList.toggle('qi-room-dual-boards', !!features.dualBoards);
        document.body.classList.toggle('qi-room-versus-ms', !!features.versusMinesweeper);

        const boardViewStack = document.getElementById('boardViewStack');
        const dual = document.getElementById('dualBoardsContainer');
        const msWrap = document.getElementById('msBoardWrap');
        if (boardViewStack) boardViewStack.hidden = !!(features.dualBoards || features.versusMinesweeper);
        if (dual) dual.hidden = !features.dualBoards;
        if (msWrap) msWrap.hidden = !features.versusMinesweeper;

        const boardContainer = document.getElementById('boardContainer');
        if (boardContainer) {
            boardContainer.classList.toggle('xiangqi-board-wrap', !!features.xiangqi);
        }

        if (features.xiangqi) {
            const blackTitle = document.getElementById('goTimerBlackTitle');
            const whiteTitle = document.getElementById('goTimerWhiteTitle');
            const sideDot = (color) =>
                `<span class="qi-side-dot qi-side-dot--${color}" aria-hidden="true"></span>`;
            if (features.dyeingBags) {
                if (blackTitle) blackTitle.innerHTML = sideDot('red') + '红方';
                if (whiteTitle) whiteTitle.innerHTML = sideDot('green') + '绿方';
            } else if (features.chess) {
                if (blackTitle) blackTitle.innerHTML = sideDot('white') + '白方';
                if (whiteTitle) whiteTitle.innerHTML = sideDot('black') + '黑方';
            } else if (features.janggi) {
                if (blackTitle) blackTitle.innerHTML = sideDot('blue') + '蓝方';
                if (whiteTitle) whiteTitle.innerHTML = sideDot('red') + '红方';
        } else {
                if (blackTitle) blackTitle.innerHTML = sideDot('red') + '红方';
                if (whiteTitle) whiteTitle.innerHTML = sideDot('black') + '黑方';
            }
            const hideIds = features.janggi
                ? ['estimateBtn', 'endReqBtn']
                : ['estimateBtn', 'passBtn', 'endReqBtn'];
            hideIds.forEach((id) => {
                const b = document.getElementById(id);
                if (b) b.style.display = 'none';
            });
            const showNum = document.querySelector('.show-numbers-label');
            if (showNum) showNum.hidden = true;
            const komiEl = document.getElementById('komiInfo');
            if (komiEl) komiEl.hidden = true;
        }

        if (features.versusMinesweeper) {
            ['estimateBtn', 'tryPlayBtn', 'passBtn', 'undoBtn', 'drawBtn', 'endReqBtn', 'importBtn', 'exportBtn'].forEach((id) => {
                const b = document.getElementById(id);
                if (b) b.style.display = 'none';
            });
            const showNum = document.querySelector('.show-numbers-label');
            if (showNum) showNum.hidden = true;
            const blackBlk = document.getElementById('goTimerBlack');
            const whiteBlk = document.getElementById('goTimerWhite');
            if (blackBlk) blackBlk.hidden = true;
            if (whiteBlk) whiteBlk.hidden = true;
        }

        /* WxD / 路墙棋：用公共限时弹窗，无形势判断与数点 */
        if (features.customTimeControl) {
            ['estimateBtn', 'passBtn', 'endReqBtn'].forEach((id) => {
                const b = document.getElementById(id);
                if (b) b.style.display = 'none';
            });
        }
        if (features.quoridorBags) {
            const showNum = document.querySelector('.show-numbers-label');
            if (showNum) showNum.hidden = true;
            const komiEl2 = document.getElementById('komiInfo');
            if (komiEl2) komiEl2.hidden = true;
        }

        if (features.zoomScroll) {
            document.body.classList.remove('qi-room-no-zoom');
            const canvas = document.getElementById('goBoard');
            if (canvas) canvas.style.touchAction = 'none';
        } else {
            document.body.classList.add('qi-room-no-zoom');
            const canvas = document.getElementById('goBoard');
            if (canvas) canvas.style.touchAction = '';
        }

        const markPanel = document.getElementById('boardMarkPanel');
        if (markPanel && config.boardMarkTitle) markPanel.title = config.boardMarkTitle;
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(s);
        });
    }

    /** 标记底色与房间页浅木色棋盘一致 */
    function applyLighterBoardMarkFill() {
        const draw = globalThis.QiSquareWeiqiCanvas && globalThis.QiSquareWeiqiCanvas.draw;
        if (!draw || typeof draw.userBoardMarks !== 'function') return;
        /* 与 room.css 的 --qi-room-board 保持一致 */
        const LIGHT = '#fdcc90';
        draw.userBoardMarks = function (ctx, userBoardMarksMap, boardSize, padding, cellSize, isVisibleAt) {
            for (const key of Object.keys(userBoardMarksMap)) {
                const [r, c] = key.split(',').map(Number);
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (isVisibleAt && !isVisibleAt(r, c)) continue;
                const ch = userBoardMarksMap[key];
                const x = padding + c * cellSize;
                const y = padding + (boardSize - 1 - r) * cellSize;
                const markBgR = cellSize * 0.3;
                ctx.beginPath();
                ctx.arc(x, y, markBgR, 0, 2 * Math.PI);
                ctx.fillStyle = LIGHT;
                ctx.fill();
                const fontPx = cellSize * (ch === '🚩' ? 0.6 : 0.66);
                ctx.font = `bold ${fontPx}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#3a281c';
                ctx.fillText(ch, x, y + 1);
            }
        };
    }

    async function boot() {
        const room = parseRoomFromPath();
        if (!room) {
            if (typeof qiAlert === 'function') qiAlert('无效的房间链接。');
            else alert('无效的房间链接。');
            throw new Error('Invalid room URL');
        }

        applyLighterBoardMarkFill();

        // 须在插件 mount（创建 WebSocket）之前挂钩，否则自建 WS 的棋种收不到聊天广播
        RoomChat.installWebSocketHook();

        await loadScript('/qi/room-plugins/' + room.gameType + '-room.js');

        const plugin = window.RoomPlugins && window.RoomPlugins[room.gameType];
        if (!plugin || typeof plugin.mount !== 'function') {
            if (typeof qiAlert === 'function') qiAlert('未知棋种：' + room.gameType);
            else alert('未知棋种：' + room.gameType);
            throw new Error('Plugin missing for ' + room.gameType);
        }

        const config = plugin.shell;
        if (!config || typeof config !== 'object') {
            throw new Error('Plugin shell config missing for ' + room.gameType);
        }

        const roomPassword = sessionStorage.getItem('roomPassword_' + room.roomId) || null;
        applyShellChrome(config);

        if (config.features && config.features.xiangqi) {
            // 染色象棋 / 国际象棋等：规则内联在插件内，不加载通用象棋规则
            const inlineRules = config.features.dyeingBags
                || config.features.chess
                || config.features.simulatedMakruk
                || config.features.simulatedShogi
                || config.features.janggi
                || config.features.hexagonXiangqi;
            if (!inlineRules) {
                // ?v= 后缀避免命中旧缓存（旧版 rules 无 flipped，象棋插件会取到 undefined）
                await loadScript('/qi/xiangqi-rules.js?v=3');
                if (!window.QiXiangqiRules || typeof window.QiXiangqiRules.createInitialBoard !== 'function' || !window.QiXiangqiRules.flipped) {
                    throw new Error('QiXiangqiRules missing after loading xiangqi-rules.js');
                }
            }
            if (document.fonts && document.fonts.load) {
                try {
                    await document.fonts.load('48px XiangqiPiece');
                } catch (_) { /* 仍继续；插件内会再尝试 redraw */ }
            }
        }

        plugin.mount({
            gameType: room.gameType,
            roomId: room.roomId,
            roomPassword,
            config: {
                title: config.title,
                minLib: config.minLib,
                recordDownloadPrefix: config.recordDownloadPrefix,
                standardWeiqiMatchTime: config.standardWeiqiMatchTime,
                boardSizeMin: config.boardSizeMin,
                boardSizeMax: config.boardSizeMax,
                features: config.features,
                editTools: config.editTools
            }
        });

        // 统一铺棋盘木纹（棋种清单见 WOOD_TEXTURE_GAMES）
        applyBoardWoodTextureForGame(room.gameType);

        // 壳层统一绑定标记折叠，避免部分棋种插件未初始化导致 expand 无效
        ensureBoardMarkFoldControls();

        // 聊天预设不阻塞棋盘首屏：下一帧再拉 CSV / 绑 UI
        requestAnimationFrame(() => {
            try { RoomChat.init(); } catch (e) { console.warn('RoomChat.init failed', e); }
        });
    }

    /* 启用棋盘木纹的棋种：围棋类 + 五子棋类 + 其它类里的「不围棋 / 反五子棋」。
     * 木纹的生成逻辑全在 QiSquareWeiqiCanvas 里（见 WOOD_PRESETS / makeWoodTextureCanvas），
     * 要改木纹只改那段公共代码即可；这里只决定哪些棋种铺。 */
    const WOOD_TEXTURE_GAMES = [
        // —— 围棋类 ——
        'weiqi', 'choice-weiqi', 'triangle-weiqi', 'hexagon-weiqi', 'snub-quadrangle-weiqi',
        'cairo-pentagon-weiqi', 'floret-pentagon-weiqi', 'penrose-p2-weiqi', 'torus-weiqi',
        'short-liberty-weiqi', 'zeroliberty-weiqi', 'various-liberty-weiqi', 'weight-weiqi',
        'hole-weiqi', 'bridge-weiqi', 'neutral-stone-weiqi', 'family-weiqi', 'greedy-weiqi',
        'ukrainian-weiqi', 'russian-weiqi', 'rus-weiqi', 'mirror-image-weiqi', 'magnetism-weiqi',
        'translocation-weiqi', 'fat-weiqi', 'rotation-weiqi', 'instability-weiqi', 'nogrid-weiqi',
        'sync-weiqi', 'fog-weiqi', 'invisible-stone-weiqi', 'radar-weiqi', 'sonar-weiqi',
        'twisted-space-weiqi', 'front-back-weiqi', 'auction-weiqi', 'continuous-weiqi',
        'bury-mine-weiqi', 'minesweeper-weiqi', 'sudoku-weiqi', 'real-time-weiqi',
        'duo-quadricolour-weiqi', 'shizi-weiqi',
        // —— 五子棋类 ——
        'wuziqi', 'choice-wuziqi', 'guess-wuziqi', 'triangle-wuziqi', 'random-instability-wuziqi',
        'match-wuziqi', 'rotation-wuziqi', 'square-diagonal-four',
        // —— 其它类：不围棋 / 反五子棋 / 黑白棋 ——
        'noweiqi', 'reverse-wuziqi', 'reversi',
        // —— 其它类：跳达棋 / 结子棋（画布不铺底色，木纹直接透出来）——
        'halma', 'neutreeko',
        // —— 象棋类（画布不画底色，木纹直接透出来）——
        'xiangqi', 'janggi', 'double-xiangqi', 'dyeing-xiangqi',
        'fog-xiangqi', 'hexagon-xiangqi', 'capture-shiziqi',
        // —— 其它类：WxD棋（底色由 canvas 的 CSS 木纹提供，插件不画底）——
        'wxd',
        // —— 方格类：舒尔特方格 / 对战舒尔特方格 ——
        // 国际象棋类（chess/caturanga/hexagon-chess/rhombic-chess/circular-chess）、
        // 模拟将棋/模拟泰象棋、路墙棋、对战扫雷、DFW 按用户要求不铺木纹
        'schulte-grid', 'versus-schulte-grid'
    ].reduce((m, g) => (m[g] = 1, m), Object.create(null));

    /**
     * 建页后按棋种铺木纹。异形棋盘（画布自绘木色）不在这里处理——
     * 它们由插件用 QiSquareWeiqiCanvas.getWoodFill() 自己填。
     */
    function applyBoardWoodTextureForGame(gameType) {
        if (!WOOD_TEXTURE_GAMES[gameType]) return;
        if (document.body.classList.contains('qi-room-transparent-canvas')) return;
        const C = window.QiSquareWeiqiCanvas;
        if (!C || typeof C.applyBoardWoodTexture !== 'function') return;
        const canvas = document.getElementById('goBoard');
        if (!canvas) return;
        // 放到首帧之后算，避免拖慢进房（生成一张约 200ms，之后按画布缓存）
        const run = () => C.applyBoardWoodTexture(canvas);
        if (window.requestAnimationFrame) window.requestAnimationFrame(run);
        else run();
    }

    function ensureBoardMarkFoldControls() {
        const C = window.QiSquareWeiqiCanvas;
        if (!C || typeof C.initBoardMarkFoldDom !== 'function') return;
        const panel = document.getElementById('boardMarkPanel');
        const foldBtn = document.getElementById('boardMarkFoldBtn');
        const expandBtn = document.getElementById('boardMarkExpandBtn');
        C.initBoardMarkFoldDom(panel, foldBtn, expandBtn);
        const sel = document.getElementById('boardMarkSelect');
        if (sel && sel.options.length === 0 && typeof C.initBoardMarkSelectDom === 'function') {
            const chars = ['?', '!'];
            for (let i = 0; i < 26; i++) chars.push(String.fromCharCode(65 + i));
            chars.push('△', '▽', '♡', '○', '◇', '□', '☆', '×', '🚩');
            C.initBoardMarkSelectDom(sel, chars);
        }
    }

    /** 房间预设聊天（消息表见根目录 chat-messages.csv） */
    const RoomChat = (function () {
        let socket = null;
        let getWs = null;
        let presets = [];
        let ready = false;
        const sendTimestamps = [];
        const RATE_WINDOW_MS = 10000;
        const RATE_MAX = 3;

        function formatTime(at) {
            const d = new Date(typeof at === 'number' ? at : Date.now());
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return hh + ':' + mm;
        }

        function appendEntry(entry) {
            const log = document.getElementById('roomChatLog');
            if (!log || !entry) return;
            const line = document.createElement('div');
            line.className = 'room-chat-line';

            const meta = document.createElement('span');
            meta.className = 'room-chat-meta';
            // 发送人称呼由服务端按「观战者N / 入座者N / 执方」写入 senderLabel
            const who = entry.senderLabel || '观战者';
            meta.textContent = formatTime(entry.at) + ' ' + who + '：';

            const body = document.createElement('span');
            body.className = 'room-chat-body';
            body.textContent = entry.content || '';

            line.appendChild(meta);
            line.appendChild(body);
            log.appendChild(line);
            log.scrollTop = log.scrollHeight;
        }

        function syncSelectFace() {
            const sel = document.getElementById('roomChatSelect');
            const face = document.getElementById('roomChatSelectFace');
            if (!sel || !face) return;
            const opt = sel.selectedIndex >= 0 && sel.selectedOptions
                ? sel.selectedOptions[0]
                : null;
            // 闭合态由 face 显示完整文案并用 CSS 截断为 ...；option 本身始终保留全文
            const full = opt ? (opt.getAttribute('data-full') || opt.textContent || '') : '';
            face.textContent = full;
            face.title = full;
        }

        function clearSelection() {
            const sel = document.getElementById('roomChatSelect');
            if (!sel) return;
            // 不提供空白 option，用 selectedIndex=-1 表示「当前未选」
            sel.selectedIndex = -1;
            syncSelectFace();
        }

        function fillSelect() {
            const sel = document.getElementById('roomChatSelect');
            if (!sel) return;
            sel.innerHTML = '';
            if (!presets.length) {
                sel.disabled = true;
                clearSelection();
                return;
            }
            sel.disabled = false;
            for (const p of presets) {
                const opt = document.createElement('option');
                opt.value = p.id;
                // 下拉列表必须显示完整内容；闭合态截断交给 .room-chat-select-face
                opt.textContent = p.content;
                opt.setAttribute('data-full', p.content);
                sel.appendChild(opt);
            }
            clearSelection();
        }

        function parseCsv(text) {
            const list = [];
            const lines = String(text || '').split(/\r?\n/);
            for (const raw of lines) {
                const line = raw.trim();
                if (!line || line.startsWith('#')) continue;
                const comma = line.indexOf(',');
                if (comma <= 0) continue;
                const id = line.slice(0, comma).trim();
                const content = line.slice(comma + 1).trim();
                if (!id || !content) continue;
                list.push({ id, content });
            }
            return list;
        }

        async function loadPresets() {
            try {
                const res = await fetch('/qi/chat-messages.csv');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                presets = parseCsv(await res.text());
            } catch (e) {
                console.warn('加载聊天预设失败', e);
                presets = [];
            }
            fillSelect();
        }

        function hookSocket(ws) {
            if (!ws || ws.__roomChatHooked) return;
            ws.__roomChatHooked = true;
            ws.addEventListener('message', (e) => {
                let msg;
                try {
                    msg = JSON.parse(e.data);
                } catch (_) {
                    return;
                }
                if (!msg || typeof msg !== 'object') return;
                if (msg.type === 'chat' || msg.type === 'chatHistory' || msg.type === 'chatError') {
                    consumeIncoming(msg);
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                }
            }, true);
        }

        function resolveSocket() {
            if (typeof getWs === 'function') {
                try {
                    const w = getWs();
                    if (w) {
                        hookSocket(w);
                        if (w.readyState === 1) return w;
                    }
                } catch (_) { /* ignore */ }
            }
            if (socket) {
                hookSocket(socket);
                if (socket.readyState === 1) return socket;
            }
            return null;
        }

        function allowSendByRate() {
            const now = Date.now();
            while (sendTimestamps.length && now - sendTimestamps[0] >= RATE_WINDOW_MS) {
                sendTimestamps.shift();
            }
            if (sendTimestamps.length >= RATE_MAX) return false;
            sendTimestamps.push(now);
            return true;
        }

        function sendSelected() {
            const sel = document.getElementById('roomChatSelect');
            if (!sel || !sel.value) return;
            const messageId = sel.value;
            const ws = resolveSocket();
            if (!ws) {
                if (typeof qiAlert === 'function') qiAlert('尚未连接房间，请稍后再试');
                return;
            }
            if (!allowSendByRate()) {
                if (typeof qiAlert === 'function') qiAlert('发送过于频繁，请稍后再试');
                return;
            }
            try {
                ws.send(JSON.stringify({ type: 'chat', messageId }));
                clearSelection();
            } catch (e) {
                if (typeof qiAlert === 'function') qiAlert('发送失败');
            }
        }

        function consumeIncoming(msg) {
            if (!msg || typeof msg !== 'object') return false;
            if (msg.type === 'chat') {
                appendEntry(msg);
                return true;
            }
            if (msg.type === 'chatHistory') {
                const log = document.getElementById('roomChatLog');
                if (log) log.innerHTML = '';
                const list = Array.isArray(msg.messages) ? msg.messages : [];
                for (const entry of list) appendEntry(entry);
                return true;
            }
            if (msg.type === 'chatError') {
                if (typeof qiAlert === 'function') qiAlert(msg.message || '聊天发送失败');
                return true;
            }
            return false;
        }

        function bindSlotContext(ctx) {
            if (!ctx) return;
            if (typeof ctx.getWs === 'function') getWs = ctx.getWs;
            if (typeof getWs === 'function') {
                try { hookSocket(getWs()); } catch (_) { /* ignore */ }
            }
        }

        function setSocket(ws) {
            socket = ws || null;
            hookSocket(socket);
        }

        function installWebSocketHook() {
            if (installWebSocketHook.done) return;
            installWebSocketHook.done = true;
            const Native = window.WebSocket;
            if (!Native) return;
            try {
                window.WebSocket = class RoomChatWebSocket extends Native {
                    constructor(url, protocols) {
                        if (protocols === undefined) super(url);
                        else super(url, protocols);
                        try {
                            if (String(url || '').indexOf('/qi/ws') !== -1) {
                                setSocket(this);
                                if (typeof globalThis.qiRegisterRoomSocket === 'function') {
                                    globalThis.qiRegisterRoomSocket(this);
                                }
                            }
                        } catch (_) { /* ignore */ }
                    }
                };
            } catch (e) {
                console.warn('RoomChat WebSocket hook failed', e);
            }
        }

        function init() {
            if (ready) return;
            ready = true;
            const btn = document.getElementById('roomChatSendBtn');
            if (btn) btn.onclick = sendSelected;
            const sel = document.getElementById('roomChatSelect');
            if (sel) {
                sel.addEventListener('change', syncSelectFace);
                sel.addEventListener('input', syncSelectFace);
                sel.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        sendSelected();
                    }
                });
            }
            loadPresets();
        }

        return {
            init,
            installWebSocketHook,
            setSocket,
            bindSlotContext,
            consumeIncoming
        };
    })();
    window.RoomChat = RoomChat;

    boot().catch((err) => {
        console.error(err);
        if (typeof qiAlert === 'function') qiAlert('房间页加载失败。');
    });
})();
