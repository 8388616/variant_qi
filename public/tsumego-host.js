/* 保留当前棋盘，待新插件在独立视图中就绪后替换；移除旧视图会一并清理其事件和计时器。 */
(function () {
    'use strict';
    let active, pending, timeout;
    const status = document.getElementById('tsumegoHostStatus');
    // 静态图像归外层页面持有，切换插件并移除旧 iframe 时仍可复用。
    // 只保留位图，不保存插件、绘制回调或其 window；按像素数限制内存。
    const images = new Map();
    let pixels = 0;
    window.QiTsumegoBoardCache = {
        woodSeed: (Math.random() * 0x7fffffff) | 0,
        getCanvas(key, create) {
            let canvas = images.get(key);
            if (canvas) {
                images.delete(key); images.set(key, canvas);
                return canvas;
            }
            canvas = create(document);
            images.set(key, canvas);
            pixels += canvas.width * canvas.height;
            while (images.size > 16 || (pixels > 6 * 1024 * 1024 && images.size > 1)) {
                const oldest = images.keys().next().value;
                const previous = images.get(oldest);
                pixels -= previous.width * previous.height;
                images.delete(oldest);
            }
            return canvas;
        }
    };
    function pageUrl(value) {
        if (typeof value !== 'string') return null;
        const url = new URL(value, location.origin);
        if (url.origin !== location.origin || !['/qi/tsumego', '/qi/tsumego-view'].includes(url.pathname)) return null;
        url.pathname = '/qi/tsumego';
        return url;
    }
    function fail(message) {
        clearTimeout(timeout);
        if (pending) pending.remove();
        pending = null;
        status.textContent = message || '读取题目失败，请重试。';
        status.hidden = false;
        if (active) active.contentWindow.postMessage({ type: 'qiTsumegoNavigationCancelled', message: status.textContent }, location.origin);
    }
    function open(value) {
        const url = pageUrl(value);
        if (!url) return;
        clearTimeout(timeout);
        if (pending) pending.remove();
        const frame = document.createElement('iframe');
        frame.className = 'tsumego-view tsumego-view-pending';
        frame.title = '死活题棋盘';
        frame.setAttribute('aria-hidden', 'true');
        frame.inert = true;
        frame.tabIndex = -1;
        frame.dataset.pageUrl = url.pathname + url.search;
        url.pathname = '/qi/tsumego-view';
        frame.src = url.pathname + url.search;
        pending = frame;
        status.hidden = !!active;
        document.body.appendChild(frame);
        timeout = setTimeout(() => fail('读取题目超时，请重试。'), 30000);
    }
    window.addEventListener('message', (event) => {
        if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
        const frame = pending?.contentWindow === event.source ? pending : active?.contentWindow === event.source ? active : null;
        if (!frame) return;
        const message = event.data;
        if (message.type === 'qiTsumegoNavigate') open(message.url);
        else if (message.type === 'qiTsumegoReady' && frame === pending) {
            clearTimeout(timeout);
            const url = pageUrl(message.url);
            if (url) pending.dataset.pageUrl = url.pathname + url.search;
            const old = active;
            active = pending; pending = null;
            active.classList.remove('tsumego-view-pending');
            active.removeAttribute('aria-hidden');
            active.inert = false;
            active.removeAttribute('tabindex');
            history.replaceState(null, '', active.dataset.pageUrl);
            status.hidden = true;
            active.contentWindow.focus();
            if (old) old.remove();
        } else if (message.type === 'qiTsumegoLocation' && frame === active && !pending) {
            const url = pageUrl(message.url);
            if (url) {
                active.dataset.pageUrl = url.pathname + url.search;
                history.replaceState(null, '', active.dataset.pageUrl);
            }
        } else if (message.type === 'qiTsumegoLoadError' && frame === pending) fail(message.message);
        else if (message.type === 'qiTsumegoLobby' && frame === active) location.assign('/qi');
    });
    open(location.href);
})();
