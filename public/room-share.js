(function () {
    'use strict';
    const button = document.getElementById('roomShareBtn');
    const route = window.__qiRoomRoute;
    if (!button || window.__qiTsumego || !route || !/^\d+$/.test(String(route.roomId || ''))) return;

    const roomId = String(route.roomId);
    const link = 'https://159.75.75.218/qi/rooms/' + roomId;
    button.querySelector('.room-share-number').textContent = roomId;
    button.title = '复制房间链接';
    button.setAttribute('aria-label', '房间 ' + roomId + '，复制房间链接');
    button.hidden = false;

    function copyWithSelection() {
        const focused = document.activeElement;
        const input = document.createElement('textarea');
        input.value = link;
        input.readOnly = true;
        input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
        document.body.append(input);
        try {
            input.select();
            input.setSelectionRange(0, input.value.length);
            if (!document.execCommand('copy')) throw new Error('Copy failed');
        } finally {
            input.remove();
            if (focused && focused.isConnected) focused.focus({ preventScroll: true });
        }
    }

    button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true;
        const showMessage = typeof window.qiAlert === 'function' ? window.qiAlert : window.alert.bind(window);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try { await navigator.clipboard.writeText(link); }
                catch (_) { copyWithSelection(); }
            } else copyWithSelection();
            showMessage('已复制房间链接');
        } catch (_) {
            showMessage('复制失败，请允许剪贴板访问后重试。');
        } finally { button.disabled = false; }
    };
})();
