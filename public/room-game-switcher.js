/* 房间棋类选择器：由服务器人数决定是否可切换，切换后沿用当前短链。 */
(function () {
    'use strict';
    let socket = null;
    let joined = false;
    let canSwitch = false;
    let busy = false;
    let timeout = null;
    let menu, trigger, hint;
    const settingsSelects = new Set();

    function syncSettingsSelect(select) {
        if (!select || select.hidden) return;
        settingsSelects.add(select);
        select.style.display = 'inline-block';
        select.disabled = !joined || !canSwitch;
        select.title = canSwitch ? '' : window.__qiTsumego ? '解题时不能更改设置' : '已有多人落座，不能切换';
    }

    window.QiRoomGameSwitcher = { syncSettingsSelect, canChangeSettings: () => joined && canSwitch };

    function refresh() {
        settingsSelects.forEach(syncSettingsSelect);
        if (!menu) return;
        const enabled = joined && canSwitch && !busy;
        hint.textContent = window.__qiTsumego ? (canSwitch ? '选择棋类，创建新的题目。' : '解题时不能更改棋类。') : !joined ? '正在连接房间…' : busy ? '正在切换棋类…'
            : !canSwitch ? '已有其他人落座，目前不能切换棋类。'
                : '切换后重新开始；房间号和密码保持不变。';
        menu.querySelectorAll('[data-game]').forEach((button) => {
            button.disabled = !enabled || button.dataset.game === window.__qiRoomRoute.gameType;
        });
    }

    function close(focus) {
        if (!menu) return;
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (focus) trigger.focus();
    }

    function position() {
        if (!menu || menu.hidden) return;
        const rect = trigger.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport ? viewport.offsetLeft : 0;
        const top = viewport ? viewport.offsetTop : 0;
        const width = viewport ? viewport.width : window.innerWidth;
        const height = viewport ? viewport.height : window.innerHeight;
        menu.style.width = Math.min(840, width - 24) + 'px';
        menu.style.left = Math.max(left + 12, Math.min(rect.left, left + width - menu.offsetWidth - 12)) + 'px';
        const y = Math.max(top + 12, Math.min(rect.bottom + 8, top + height - 100));
        menu.style.top = y + 'px';
        menu.style.maxHeight = Math.max(72, top + height - y - 12) + 'px';
    }

    function fail(message) {
        clearTimeout(timeout);
        busy = false;
        refresh();
        if (typeof window.qiAlert === 'function') window.qiAlert(message);
    }

    function choose(game) {
        if (!joined || !canSwitch || busy || !socket || socket.readyState !== 1) return;
        busy = true;
        refresh();
        timeout = setTimeout(() => fail('切换超时，请检查连接后重试。'), 12000);
        try { socket.send(JSON.stringify({ type: 'switchGame', game })); }
        catch (_) { fail('切换失败，请稍后重试。'); }
    }

    function init() {
        trigger = document.getElementById('gameTitleInfo');
        const catalog = window.QiGameCatalog;
        if (!trigger || !catalog || !window.__qiRoomRoute) return;
        menu = document.createElement('div');
        menu.id = 'roomGameMenu';
        menu.className = 'room-game-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-label', '切换棋类');
        hint = document.createElement('p');
        hint.className = 'room-game-menu-hint';
        hint.setAttribute('role', 'status');
        menu.appendChild(hint);
        for (const category of catalog.categories) {
            const games = catalog.games.filter((g) => g.enabled && g.category === category
                && (!window.__qiTsumego || window.__qiTsumegoGameIds.includes(g.id)));
            if (!games.length) continue;
            const section = document.createElement('section');
            const title = document.createElement('h3');
            title.textContent = category;
            const buttons = document.createElement('div');
            buttons.className = 'room-game-menu-buttons';
            for (const game of games) {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.game = game.id;
                button.textContent = game.name;
                button.title = game.intro || game.name;
                if (game.id === window.__qiRoomRoute.gameType) {
                    button.classList.add('is-current');
                    button.setAttribute('aria-current', 'true');
                }
                button.onclick = () => choose(game.id);
                buttons.appendChild(button);
            }
            section.append(title, buttons);
            menu.appendChild(section);
        }
        document.body.appendChild(menu);
        refresh();
        trigger.onclick = () => {
            if (!menu.hidden) return close(false);
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            position();
        };
        trigger.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown') return;
            e.preventDefault();
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            position();
            const first = menu.querySelector('button:not(:disabled)');
            if (first) first.focus();
        });
        document.addEventListener('pointerdown', (e) => {
            if (!menu.contains(e.target) && !trigger.contains(e.target)) close(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); close(true); }
        });
        document.addEventListener('focusin', (e) => {
            if (!menu.contains(e.target) && e.target !== trigger) close(false);
        });
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', position);
            window.visualViewport.addEventListener('scroll', position);
        }
    }

    // 在棋种插件创建连接前安装，使独立页面和自建 WebSocket 的插件也能同步切换。
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class RoomSwitchWebSocket extends NativeWebSocket {
        constructor(url, protocols) {
            if (protocols === undefined) super(url);
            else super(url, protocols);
            if (new URL(String(url), location.href).pathname !== '/qi/ws') return;
            this._qiRoomConnection = true;
            socket = this;
            joined = false;
            refresh();
            this.addEventListener('message', (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch (_) { return; }
                if (msg.type === 'localGameTransferred') {
                    sessionStorage.removeItem('qiLocalPlay_' + window.__qiRoomRoute.roomId);
                    window.__qiRoomLeaving = true;
                    if (typeof window.qiLeaveRoomIntentionally === 'function') window.qiLeaveRoomIntentionally();
                    location.reload();
                    e.stopImmediatePropagation();
                    return;
                }
                if (msg.type === 'localGameStarted' || msg.type === 'localGameEnded') {
                    const key = 'qiLocalPlay_' + window.__qiRoomRoute.roomId;
                    if (msg.type === 'localGameStarted') sessionStorage.setItem(key, msg.token);
                    else sessionStorage.removeItem(key);
                    e.stopImmediatePropagation();
                    return;
                }
                if (msg.type === 'joined') {
                    if (!(msg.state && msg.state.localPlay)) sessionStorage.removeItem('qiLocalPlay_' + window.__qiRoomRoute.roomId);
                    joined = true;
                    refresh();
                }
                if (msg.type === 'roomSwitchState') {
                    canSwitch = !!msg.canSwitch;
                    window.__qiCanChangeRoomSettings = canSwitch;
                    refresh();
                    window.dispatchEvent(new CustomEvent('qiRoomSettingsAvailability', { detail: canSwitch }));
                    e.stopImmediatePropagation();
                } else if (msg.type === 'roomGameChanged') {
                    clearTimeout(timeout);
                    window.__qiRoomLeaving = true;
                    if (typeof window.qiLeaveRoomIntentionally === 'function') window.qiLeaveRoomIntentionally();
                    // 地址只有房间号；重新加载会获取服务器注入的新棋类，清掉旧插件和计时器。
                    location.reload();
                    e.stopImmediatePropagation();
                } else if (msg.type === 'switchGameError') {
                    fail(msg.message || '切换失败，请重试。');
                    e.stopImmediatePropagation();
                }
            });
            this.addEventListener('close', () => {
                if (socket !== this) return;
                joined = false;
                clearTimeout(timeout);
                busy = false;
                refresh();
            });
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
