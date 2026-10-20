(function () {
  "use strict";
  const roomSockets = new Set();
  let user = null;
  let currentSubGameId = window.__qiRoomRoute?.gameType || null;
  const roomSlots = { player1: null, player2: null };
  let roomMatchStarted = false;
  const login = document.getElementById("lobbyLoginBtn") || document.getElementById("roomLoginBtn");
  const isRoom = !!window.__qiRoomRoute && !window.__qiTsumego;

  async function refreshSocket(socket) {
    socket._qiAuthRefreshPending = true;
    if (!socket._qiJoined || socket.readyState !== 1 || socket._qiAuthRefreshing || !user) return;
    socket._qiAuthRefreshing = true;
    socket._qiAuthRefreshPending = false;
    try {
      const response = await fetch("/qi/auth/socket-ticket", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "authenticate", ticket: data.ticket }));
    } catch (_) {
      if (window.qiAlert) window.qiAlert("已登入，但房间身份同步失败，请重新进入房间。");
    } finally { socket._qiAuthRefreshing = false; }
  }

  // 死活题页（room.html 注入 __qiTsumego）同样显示登入并走同一套账户菜单；
  // 它没有真实房间 socket（roomSockets 为空），所以下面的身份同步自然空转
  if (login) {
    let loading = false;
    let reloadPending = false;
    const isLobby = login.id === "lobbyLoginBtn";
    const menu = document.createElement("div");
    menu.id = "qiAccountMenu";
    menu.hidden = true;
    menu.className = "qi-account-menu";
    menu.setAttribute("role", "menu");
    const ratingInfo = document.createElement('div');
    ratingInfo.className = 'qi-account-rating';
    ratingInfo.setAttribute('role', 'status');
    if (isLobby) menu.classList.add('qi-account-menu--ratings');
    menu.append(ratingInfo);
    const logout = document.createElement("button");
    logout.type = "button";
    logout.setAttribute("role", "menuitem");
    logout.textContent = "登出";
    menu.append(logout);
    document.body.append(menu);

    function closeMenu(focus) {
      menu.hidden = true;
      login.setAttribute("aria-expanded", "false");
      if (focus) login.focus();
    }
    function render(nextUser) {
      user = nextUser;
      const chars = user ? [...user.username] : [];
      login.textContent = user ? chars.slice(0, 8).join("") + (chars.length > 8 ? "…" : "") : "登入";
      login.title = user ? user.username : "登入";
      login.classList.toggle("qi-account-name", !!user);
      if (isLobby) login.classList.toggle("header-action-btn", !user);
      login.setAttribute("aria-label", user ? user.username + "，账户菜单" : "登入");
      if (user) {
        login.setAttribute("aria-haspopup", "menu");
        login.setAttribute("aria-controls", menu.id);
      } else {
        login.removeAttribute("aria-haspopup");
        login.removeAttribute("aria-controls");
      }
      closeMenu(false);
    }
    function announce() {
      try { localStorage.setItem("qiAuthChanged", Date.now() + ":" + Math.random()); } catch (_) {}
    }
    function positionMenu() {
      const rect = login.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px';
      menu.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - menu.offsetHeight - 8)) + 'px';
    }
    async function loadRatings() {
      const accountId = user.id;
      const subGameId = currentSubGameId;
      ratingInfo.textContent = '等级分读取中…';
      positionMenu();
      try {
        const response = await fetch('/qi/auth/ratings', { cache: 'no-store' });
        if (!response.ok) throw new Error('等级分暂时不可用');
        const data = await response.json();
        if (!user || user.id !== accountId || menu.hidden) return;
        const integerRating = rating => Math.floor(Number(rating));
        const label = row => row ? `${integerRating(row.rating)} (${row.rank})` : '1500 (1k)';
        ratingInfo.replaceChildren();
        const total = document.createElement('div');
        total.className = 'qi-account-rating-total';
        total.textContent = '总等级分：' + label(data.overall);
        ratingInfo.append(total);
        if (isRoom && subGameId) {
          const current = document.createElement('div');
          current.textContent = '本棋类：' + label(data.games.find(row => row.sub_game_id === subGameId));
          ratingInfo.append(current);
        }
        if (isLobby) {
          const list = document.createElement('div');
          list.className = 'qi-account-game-ratings';
          list.setAttribute('role', 'list');
          list.setAttribute('aria-label', '棋类等级分，按等级分从高到低排列');
          list.tabIndex = 0;
          const games = [...data.games].sort((a, b) => Number(b.rating) - Number(a.rating) || a.sub_game_id.localeCompare(b.sub_game_id));
          for (const game of games) {
            const row = document.createElement('div');
            row.className = 'qi-account-game-rating';
            row.setAttribute('role', 'listitem');
            row.dataset.game = game.sub_game_id;
            const name = document.createElement('span');
            name.className = 'qi-account-game-name';
            name.textContent = game.game_name || window.QiGameCatalog?.getGameName(game.sub_game_id) || game.sub_game_id;
            name.title = name.textContent;
            const score = document.createElement('span');
            score.className = 'qi-account-game-score';
            score.textContent = String(integerRating(game.rating));
            const rank = document.createElement('span');
            rank.className = 'qi-account-game-rank';
            rank.textContent = game.rank;
            row.append(name, score, rank);
            list.append(row);
          }
          if (!games.length) {
            const empty = document.createElement('div');
            empty.className = 'qi-account-ratings-empty';
            empty.textContent = '暂无棋类评分记录';
            list.append(empty);
          }
          ratingInfo.append(list);
        }
      } catch (_) {
        if (!user || user.id !== accountId || menu.hidden) return;
        ratingInfo.textContent = '等级分暂时不可用';
      }
      positionMenu();
    }
    login.onclick = () => {
      if (!user) {
        const returnTo = location.pathname + location.search + location.hash;
        // 死活题的棋盘嵌在宿主页（/qi/tsumego）的 iframe 里，而登录页 CSP frame-ancestors 'none'
        // 不允许内嵌：嵌入时改为整个顶层窗口跳转，回跳地址用宿主页而不是视图页
        if (window.__qiTsumego && window.parent !== window) {
          window.top.location.href = "/qi/login?returnTo="
            + encodeURIComponent(returnTo.replace("/qi/tsumego-view", "/qi/tsumego"));
          return;
        }
        location.href = "/qi/login?returnTo=" + encodeURIComponent(returnTo);
        return;
      }
      if (!menu.hidden) return closeMenu(false);
      menu.hidden = false;
      login.setAttribute("aria-expanded", "true");
      void loadRatings();
      logout.focus();
    };
    document.addEventListener("pointerdown", e => {
      if (!menu.contains(e.target) && !login.contains(e.target)) closeMenu(false);
    });
    document.addEventListener("focusin", e => {
      if (!menu.contains(e.target) && !login.contains(e.target)) closeMenu(false);
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !menu.hidden) { e.preventDefault(); closeMenu(true); }
    });
    window.addEventListener("resize", () => closeMenu(false));
    window.addEventListener('scroll', event => {
      if (!(event.target instanceof Node) || !menu.contains(event.target)) closeMenu(false);
    }, true);
    logout.onclick = async () => {
      logout.disabled = true;
      try {
        const response = await fetch("/qi/auth/logout", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });
        if (!response.ok) throw new Error("登出失败，请重试。");
        render(null);
        announce();
      } catch (e) {
        if (window.qiAlert) window.qiAlert(e.message);
      } finally { logout.disabled = false; }
    };
    async function load() {
      if (loading) { reloadPending = true; return; }
      loading = true;
      try {
        const response = await fetch("/qi/auth/me", { cache: "no-store" });
        if (!response.ok) return;
        const nextUser = (await response.json()).user;
        const changed = String(user?.id || "") !== String(nextUser?.id || "");
        render(nextUser);
        if (changed && user) for (const socket of roomSockets) void refreshSocket(socket);
      } catch (_) { /* 网络恢复后再次读取 */ }
      finally {
        loading = false;
        if (reloadPending) { reloadPending = false; void load(); }
      }
    }
    window.addEventListener("pageshow", load);
    window.addEventListener("focus", load);
    window.addEventListener("storage", e => { if (e.key === "qiAuthChanged") void load(); });
    void load();
  }

  if (!isRoom) return;
  window.__qiPlayerIdentities = {};
  function playerRankLabel(rank) {
    const match = /^(\d+)([dk])$/.exec(rank || '1k');
    return match ? match[1] + (match[2] === 'd' ? '段' : '级') : '1级';
  }
  function updateTitles() {
    for (const slot of ["player1", "player2"]) {
      const title = document.querySelector('[data-go-timer="' + slot + '"] .go-timer-title')
        || document.getElementById(slot === "player1" ? "goTimerBlackTitle" : "goTimerWhiteTitle");
      if (!title) continue;
      const previous = title.querySelector(".qi-player-username");
      let rankSpan = title.querySelector('.qi-player-rank');
      const username = window.__qiPlayerIdentities[slot]?.username;
      title.classList.toggle("qi-timer-has-username", !!username);
      let leftStatus = title.querySelector(".qi-player-left-status");
      if (username) {
        // 只处理执方标签的文字，用户名本身可能也包含“(已退出)”。
        const labelNodes = [...title.childNodes].filter(node => node.nodeType === Node.TEXT_NODE);
        const labelHasLeft = labelNodes.some(node => node.textContent.includes('(已退出)'));
        const hasLeft = roomSlots[slot] === null ? labelHasLeft || !!leftStatus : roomMatchStarted && !roomSlots[slot];
        for (const node of labelNodes) {
          if (node.textContent.includes('(已退出)')) node.textContent = node.textContent.replace('(已退出)', '');
        }
        if (hasLeft) {
          if (!leftStatus) {
            leftStatus = document.createElement("span");
            leftStatus.className = "qi-player-left-status";
            leftStatus.textContent = '\u00a0(已退出)';
          }
        } else if (leftStatus) {
          leftStatus.remove();
          leftStatus = null;
        }
      } else if (leftStatus) {
        leftStatus.replaceWith(document.createTextNode("(已退出)"));
        leftStatus = null;
      }
      // 不换行空格在 inline-block 开头仍保留宽度，避免普通空格被折叠。
      const unchanged = !!username && previous && previous.textContent === "\u00a0" + username;
      if (previous && !unchanged) previous.remove();
      if (username && !unchanged) {
        const span = document.createElement("span");
        span.className = "qi-player-username";
        span.textContent = "\u00a0" + username;
        span.title = username;
        span.style.cssText = "display:inline-block;max-width:min(10em,100%);overflow:hidden;text-overflow:ellipsis;vertical-align:bottom";
        title.append(span);
      }
      if (username) {
        const nameSpan = title.querySelector('.qi-player-username');
        if (!rankSpan) {
          rankSpan = document.createElement('span');
          rankSpan.className = 'qi-player-rank';
        }
        const rankText = '\u00a0' + playerRankLabel(window.__qiPlayerIdentities[slot]?.rank);
        if (rankSpan.textContent !== rankText) rankSpan.textContent = rankText;
        if (nameSpan.nextSibling !== rankSpan) nameSpan.after(rankSpan);
        if (leftStatus && leftStatus.textContent !== '\u00a0(已退出)') leftStatus.textContent = '\u00a0(已退出)';
      } else if (rankSpan) rankSpan.remove();
      if (leftStatus && title.lastChild !== leftStatus) title.append(leftStatus);
    }
  }
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(url, protocols) {
      if (protocols === undefined) super(url); else super(url, protocols);
      if (new URL(String(url), location.href).pathname !== "/qi/ws") return;
      roomSockets.add(this);
      this.addEventListener("close", () => roomSockets.delete(this));
      this.addEventListener("message", e => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        const subGameId = msg.subGameId || msg.state?.subGameId;
        if (subGameId) currentSubGameId = subGameId;
        const state = msg.state || msg;
        if (state.slots) {
          for (const slot of ['player1', 'player2'])
            if (state.slots[slot] !== undefined) roomSlots[slot] = !!state.slots[slot];
        }
        if (msg.type === 'slotReleased' && Object.hasOwn(roomSlots, msg.slot)) roomSlots[msg.slot] = false;
        if (msg.type === 'slotOccupied' && Object.hasOwn(roomSlots, msg.slot)) roomSlots[msg.slot] = true;
        if (state.matchStarted !== undefined) roomMatchStarted = !!state.matchStarted;
        else if (msg.type === 'timeControlAgreed') roomMatchStarted = true;
        if (msg.type === "joined") {
          this._qiJoined = true;
          if (this._qiAuthRefreshPending) void refreshSocket(this);
        }
        if (msg.playerIdentities) {
          window.__qiPlayerIdentities = msg.playerIdentities;
          queueMicrotask(updateTitles);
        }
        if (msg.type === "accountAuthenticated" || msg.type === "playerIdentities") e.stopImmediatePropagation();
      });
    }
  };
  const panel = document.getElementById("goTimerPanel");
  if (panel) new MutationObserver(updateTitles).observe(panel, { subtree: true, childList: true });
})();
