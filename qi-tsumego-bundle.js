'use strict';
// 将已有规则作为静态浏览器脚本发送；不创建房间，也不在服务端解题。
const fs = require('fs');
const path = require('path');
const catalog = require('./public/game-catalog');
function bundle(gameId) {
    if (!catalog.games.some((g) => g.enabled && g.id === gameId)) throw new Error('未知棋类');
    const root = __dirname, modules = new Map();
    const stubs = {
        crypto: 'module.exports = {};',
        'katago-gtp.js': 'module.exports = {canAcquireKatagoNow:()=>false,isKatagoBusyError:()=>false,acquireKatagoSession:async()=>{throw new Error("离线模式");},releaseKatagoSession:()=>{}};',
        'qi-katago-opponent.js': 'module.exports = {engineKomi:(g,k)=>k||0};'
    };
    function visit(id) {
        if (modules.has(id)) return;
        if (stubs[id]) { modules.set(id, stubs[id]); return; }
        if (id !== 'common.js' && id !== 'qi-record-tree.js' && id !== 'public/record-tree.js' && !id.startsWith('games/'))
            throw new Error('规则依赖不支持离线运行：' + id);
        let source = fs.readFileSync(path.join(root, id), 'utf8');
        modules.set(id, '');
        source = source.replace(/require\(['"]([^'"]+)['"]\)/g, (_, request) => {
            let target = request;
            if (request.startsWith('.')) {
                target = path.posix.normalize(path.posix.join(path.posix.dirname(id), request));
                if (!target.endsWith('.js')) target += '.js';
            }
            visit(target);
            return 'require(' + JSON.stringify(target) + ')';
        });
        modules.set(id, source);
    }
    visit('games/' + gameId + '.js'); visit('common.js'); visit('qi-record-tree.js');
    return '(function(){"use strict";const modules={' + [...modules].map(([id, src]) =>
        JSON.stringify(id) + ':function(require,module,exports){\n' + src + '\n}').join(',\n') +
        '};const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](require,m,m.exports);return m.exports;}window.QiTsumegoRules={game:require(' +
        JSON.stringify('games/' + gameId + '.js') + '),common:require("common.js"),records:require("qi-record-tree.js")};})();';
}
module.exports = { bundle };
