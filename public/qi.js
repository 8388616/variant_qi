/**
 * 大厅与独立房间页共用的轻量客户端（消息框、房间 WebSocket）。
 * 棋盘运行时与房间壳见 /qi/room.js。
 */
(function (global) {
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

    function normalizeMessageOptions(type, message, options) {
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
        const wrap = document.createElement('div');
        wrap.className = 'qi-time-control-modal qi-message-modal';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.display = 'none';
        wrap.innerHTML =
            '<div class="qi-time-control-dialog qi-message-dialog" role="dialog" aria-modal="true" aria-labelledby="qiMessageTitle">' +
            '<h3 class="qi-time-control-title qi-message-title" id="qiMessageTitle"></h3>' +
            '<div class="qi-message-text" id="qiMessageText"></div>' +
            '<div class="qi-time-control-footer qi-message-footer">' +
            '<button type="button" class="qi-time-control-primary" id="qiMessageOk"></button>' +
            '<button type="button" class="qi-time-control-secondary" id="qiMessageCancel"></button>' +
            '</div></div>';
        document.body.appendChild(wrap);
        ui = {
            wrap,
            dialog: wrap.querySelector('.qi-message-dialog'),
            title: wrap.querySelector('#qiMessageTitle'),
            text: wrap.querySelector('#qiMessageText'),
            ok: wrap.querySelector('#qiMessageOk'),
            cancel: wrap.querySelector('#qiMessageCancel')
        };
        return ui;
    }

    function closeCurrent(result) {
        const item = queue.shift();
        const box = ensureUi();
        box.wrap.classList.remove('qi-message-modal--open');
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
        box.wrap.classList.add('qi-message-modal--open');
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
        if (!global.document || !global.document.body) {
            return Promise.resolve(type !== 'confirm');
        }
        const item = normalizeMessageOptions(type, message, options);
        return new Promise((resolve) => {
            queue.push({ ...item, resolve });
            showNext();
        });
    }

    const api = {
        qiAlert(message, options) {
            return showMessage('alert', message, options);
        },
        confirm(message, options) {
            return showMessage('confirm', message, options);
        },
        ask(message, options) {
            return showMessage('confirm', message, { ...(options || {}), buttons: 'yesNo' });
        }
    };

    global.QiMessageBox = api;
    global.qiAlert = api.qiAlert;
    global.qiConfirm = api.confirm;
    global.qiAsk = api.ask;
})(window);

(function (global) {
    const activeRoomSockets = new Set();

    function setLeaving(v) {
        if (typeof window !== 'undefined') window.__qiRoomLeaving = !!v;
    }

    function qiRegisterRoomSocket(socket) {
        if (!socket) return socket;
        activeRoomSockets.add(socket);
        const drop = () => { activeRoomSockets.delete(socket); };
        socket.addEventListener('close', drop);
        return socket;
    }

    function qiLeaveRoomIntentionally() {
        setLeaving(true);
        for (const s of Array.from(activeRoomSockets)) {
            try {
                if (s.readyState === 1) s.send(JSON.stringify({ type: 'leave' }));
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
        setLeaving(false);
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = protocol + '//' + location.host + '/qi/ws?game=' +
            encodeURIComponent(opts.gameType) + '&room=' + encodeURIComponent(opts.roomId);
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
            opts.onMessage(JSON.parse(e.data));
        };
        const userOnClose = opts.onClose;
        socket.onclose = function (event) {
            if (typeof window !== 'undefined' && window.__qiRoomLeaving) return;
            if (typeof userOnClose === 'function') userOnClose(event);
        };
        return socket;
    }

    global.qiOpenRoomWebSocket = qiOpenRoomWebSocket;
    global.qiRegisterRoomSocket = qiRegisterRoomSocket;
    global.qiLeaveRoomIntentionally = qiLeaveRoomIntentionally;
    global.qiLeaveRoomAndGoLobby = qiLeaveRoomAndGoLobby;

    if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            if (!t.closest('#backToLobbyBtn')) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            qiLeaveRoomAndGoLobby();
        }, true);
        window.addEventListener('pagehide', () => { qiLeaveRoomIntentionally(); });
        window.addEventListener('beforeunload', () => { qiLeaveRoomIntentionally(); });
    }
})(typeof window !== 'undefined' ? window : global);
