/** 首页与房间共用的棋类目录。新增棋类只需在这里登记。 */
(function (global) {
    'use strict';
    const games = [
            // 围棋类
            { id: 'choice-weiqi', name: '选点围棋', randomLevel: 4, path: 'choice-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '每步棋只能从随机候选点中选择落子。' },
            { id: 'traitor-weiqi', name: '内奸围棋', randomLevel: 3, path: 'traitor-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '在对手的棋子中藏入己方内奸。' },
            { id: 'non-rectangular-weiqi', name: '非四角围棋', randomLevel: 0, path: 'non-rectangular-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '各种非四角棋盘。' },
            { id: 'large-small-circle-weiqi', name: '大小圆围棋', randomLevel: 0, path: 'large-small-circle-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '不对称连接的棋盘。' },
            { id: 'torus-weiqi', name: '环面围棋', randomLevel: 0, path: 'torus-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '环面棋盘。' },
            { id: 'short-liberty-weiqi', name: '短气围棋', randomLevel: 0, path: 'short-liberty-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '每组棋子少若干气。' },
            { id: 'zeroliberty-weiqi', name: '零气围棋', randomLevel: 0, path: 'zeroliberty-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '棋子没有气后，还需要花额外的一手棋来提子。' },
            { id: 'delayed-capture-weiqi', name: '缓提围棋', randomLevel: 0, path: 'delayed-capture-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '无气时下一手才能提掉。' },
            { id: 'various-liberty-weiqi', name: '异气围棋', randomLevel: 0, path: 'various-liberty-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '每个棋子的气数不同。' },
            { id: 'che-style-weiqi', name: '车式围棋', randomLevel: 0, path: 'che-style-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '隔空紧气。' },
            { id: 'global-liberty-weiqi', name: '全气围棋', randomLevel: 0, path: 'global-liberty-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '全盘供气。' },
            { id: 'weight-weiqi', name: '权重围棋', randomLevel: 2, path: 'weight-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '棋盘上每个点的价值不同。' },
			{ id: 'broken-line-weiqi', name: '断线围棋', randomLevel: 2, path: 'broken-line-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '棋盘上随机切断一些连线。' },
	        { id: 'hole-weiqi', name: '洞围棋', randomLevel: 2, path: 'hole-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '棋盘上破了一些洞。' },
            { id: 'bridge-weiqi', name: '桥围棋', randomLevel: 2, path: 'bridge-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '棋盘上建了一些桥。' },
            { id: 'neutral-stone-weiqi', name: '中立子围棋', randomLevel: 2, path: 'neutral-stone-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '棋盘上有一些中立的棋子。' },
			{ id: 'mirror-weiqi', name: '镜子围棋', randomLevel: 2, path: 'mirror-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '落子后会经过镜子反射在多处落子。' },
			{ id: 'greedy-weiqi', name: '贪吃围棋', randomLevel: 0, path: 'greedy-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '有提必提。' },
            { id: 'capture-weiqi', name: '吃子围棋', randomLevel: 0, path: 'capture-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '吃子即赢。' },
			{ id: 'sharp-edge-evasion-weiqi', name: '避锋围棋', randomLevel: 0, path: 'sharp-edge-evasion-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '不能下在前一手旁边。' },
			{ id: 'travel-expense-weiqi', name: '路费围棋', randomLevel: 0, path: 'travel-expense-weiqi', enabled: false, recommended: false, category: '围棋/占地', intro: '距离前一手越远成本越高。' },
            { id: 'reversi-weiqi', name: '翻转围棋', randomLevel: 0, path: 'reversi-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '提子时翻转成己方棋子。' },
            { id: 'torus-fill-weiqi', name: '环面填满围棋', randomLevel: 0, path: 'torus-fill-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '环面棋盘，围住即填满。' },
			{ id: 'ukrainian-weiqi', name: '乌克兰围棋', randomLevel: 0, path: 'ukrainian-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '一次下三颗子。' },
            { id: 'russian-weiqi', name: '俄罗斯围棋', randomLevel: 4, path: 'russian-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '棋子是俄罗斯方块的形状。' },
            { id: 'rus-weiqi', name: '罗斯围棋', randomLevel: 0, path: 'rus-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '一次下三颗子，其中有一颗是对方的。' },
			{ id: 'compound-stone-weiqi', name: '复合子围棋', randomLevel: 0, path: 'compound-stone-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '可落单子或复合子。' },
            { id: 'symmetry-weiqi', name: '对称围棋', randomLevel: 4, path: 'symmetry-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '落子时会同时在对称位置落子。' },
            { id: 'magnetism-weiqi', name: '磁性围棋', randomLevel: 0, path: 'magnetism-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '落子时会吸引或排斥附近的棋子。' },
			{ id: 'rotation-weiqi', name: '旋转围棋', randomLevel: 0, path: 'rotation-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '落子后周围的棋子顺时针转一格。' },
		    { id: 'translocation-weiqi', name: '易位围棋', randomLevel: 0, path: 'translocation-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '可以交换棋子的位置。' },
			{ id: 'fat-weiqi', name: '胖围棋', randomLevel: 0, path: 'fat-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '' },
            { id: 'drift-weiqi', name: '漂移围棋', randomLevel: 0, path: 'drift-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '下着下着，棋盘漂移了。' },
            { id: 'instability-weiqi', name: '不稳定围棋', randomLevel: 0, path: 'instability-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '棋子落下后还会消失。' },
			{ id: 'nogrid-weiqi', name: '无格线围棋', randomLevel: 0, path: 'nogrid-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '棋盘忘记画格线了。' },
            { id: 'sync-weiqi', name: '同步围棋', randomLevel: 3, path: 'sync-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '双方同步落子。' },
            { id: 'fog-weiqi', name: '迷雾围棋', randomLevel: 3, path: 'fog-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '棋盘上笼罩着迷雾。' },
            { id: 'invisible-stone-weiqi', name: '隐身子围棋', randomLevel: 3, path: 'invisible-stone-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '每第3手棋会隐身。' },
            { id: 'radar-weiqi', name: '雷达围棋', randomLevel: 3, path: 'radar-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '看不到对方的棋子，只能感知到距离。' },
            { id: 'sonar-weiqi', name: '声呐围棋', randomLevel: 3, path: 'sonar-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '每枚棋子只能看到每个方向上最近的对方棋子。' },
            { id: 'twisted-space-weiqi', name: '扭曲空间围棋', randomLevel: 2, path: 'twisted-space-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '棋盘空间极度扭曲。' },
            { id: 'front-back-weiqi', name: '正反面围棋', randomLevel: 0, path: 'front-back-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '正反面一起下。' },
            { id: 'auction-weiqi', name: '竞叫围棋', randomLevel: 0, path: 'auction-weiqi', enabled: false, recommended: false, category: '围棋/占地', intro: '超级博弈论游戏，谁叫的分高谁下。' },
            { id: 'continuous-weiqi', name: '连续围棋', randomLevel: 0, path: 'continuous-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '' },
            { id: 'bury-mine-weiqi', name: '埋雷围棋', randomLevel: 3, path: 'bury-mine-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '埋雷。' },
            { id: 'minesweeper-weiqi', name: '扫雷围棋', randomLevel: 4, path: 'minesweeper-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '一边下棋一边扫雷。' },
            { id: 'sudoku-weiqi', name: '数独围棋', randomLevel: 0, path: 'sudoku-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '一边下棋一边做数独。' },
            { id: 'real-time-weiqi', name: 'RealTime围棋', randomLevel: 0, path: 'real-time-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '拼手速。' },
            { id: 'point-integration-weiqi', name: '点数积分围棋', randomLevel: 0, path: 'point-integration-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '点数积分。' },
            { id: 'fotte-weiqi', name: '先一各二围棋', randomLevel: 0, path: 'fotte-weiqi', enabled: true, recommended: true, category: '围棋/占地', intro: '先一各二。' },
			{ id: 'duo-quadricolour-weiqi', name: '双人四色围棋', randomLevel: 0, path: 'duo-quadricolour-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '' },
            { id: 'shizi-weiqi', name: '十子围棋', randomLevel: 0, path: 'shizi-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '连成十子即胜。' },
            { id: 'custom-weiqi', name: '自定义围棋', randomLevel: 0, path: 'custom-weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '自定义。' },
            { id: 'weiqi', name: '围棋', randomLevel: 0, path: 'weiqi', enabled: true, recommended: false, category: '围棋/占地', intro: '普通的围棋有什么好玩的。' },
            { id: 'triangle-reversi', name: '三角黑白棋', randomLevel: 0, path: 'triangle-reversi', enabled: true, recommended: false, category: '围棋/占地', intro: '三角棋盘下的黑白棋。' },
            { id: 'reversi', name: '黑白棋', randomLevel: 0, path: 'reversi', enabled: true, recommended: false, category: '围棋/占地', intro: '黑白棋有什么好玩的。' },
            { id: 'wxd', name: 'WxD棋', randomLevel: 2, path: 'wxd', enabled: true, recommended: false, category: '围棋/占地', intro: '' },

            // 五子棋类
            { id: 'choice-wuziqi', name: '选点五子棋', randomLevel: 4, path: 'choice-wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '每步棋只能从随机候选点中选择落子。' },
            { id: 'guess-wuziqi', name: '猜点五子棋', randomLevel: 4, path: 'guess-wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '猜对方的选点，并且让对方猜错。' },
            { id: 'triangle-wuziqi', name: '三角五子棋', randomLevel: 0, path: 'triangle-wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '三角形棋盘。' },
            { id: 'magnetism-wuziqi', name: '磁性五子棋', randomLevel: 0, path: 'magnetism-wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '落子时会吸引或排斥附近的棋子。' },
            { id: 'rotation-wuziqi', name: '旋转五子棋', randomLevel: 0, path: 'rotation-wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '落子后周围的棋子顺时针转一格。' },
            { id: 'random-instability-wuziqi', name: '随机不稳定五子棋', randomLevel: 4, path: 'random-instability-wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '每个棋子都有随机寿命。' },
            { id: 'match-wuziqi', name: '消除五子棋', randomLevel: 0, path: 'match-wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '' },
            { id: 'drift-wuziqi', name: '漂移五子棋', randomLevel: 0, path: 'drift-wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '' },
            { id: 'square-diagonal-four', name: '方斜四棋', randomLevel: 0, path: 'square-diagonal-four', enabled: true, recommended: true, category: '五子棋/成型', intro: '方四胜斜四负。' },
            { id: 'wuziqi', name: '五子棋', randomLevel: 0, path: 'wuziqi', enabled: true, recommended: false, category: '五子棋/成型', intro: '普通的五子棋有什么好玩的。' },

            // 象棋类
            { id: 'double-xiangqi', name: '二象棋', randomLevel: 0, path: 'double-xiangqi', enabled: true, recommended: false, category: '象棋/杀王', intro: '两副象棋，但是只有一个棋盘。' },
            { id: 'dyeing-xiangqi', name: '染色象棋', randomLevel: 0, path: 'dyeing-xiangqi', enabled: true, recommended: false, category: '象棋/杀王', intro: '谁先抢到算谁的。' },
            { id: 'fog-xiangqi', name: '迷雾象棋', randomLevel: 0, path: 'fog-xiangqi', enabled: true, recommended: false, category: '象棋/杀王', intro: '棋盘上笼罩着迷雾。' },
            { id: 'hexagon-xiangqi', name: '六角象棋', randomLevel: 0, path: 'hexagon-xiangqi', enabled: true, recommended: false, category: '象棋/杀王', intro: '六角棋盘上的象棋。' },
            { id: 'magnetism-xiangqi', name: '磁性象棋', randomLevel: 0, path: 'magnetism-xiangqi', enabled: true, recommended: false, category: '象棋/杀王', intro: '落子时会吸引或排斥附近的棋子。' },
			{ id: 'puppet-xiangqi', name: '傀儡象棋', randomLevel: 0, path: 'puppet-xiangqi', enabled: true, recommended: false, category: '象棋/杀王', intro: '每回合先走自己的棋子，再走对方的棋子。' },
            { id: 'xiangqi', name: '象棋', randomLevel: 0, path: 'xiangqi', enabled: true, recommended: false, category: '象棋/杀王', intro: '普通的象棋有什么好玩的。' },
			{ id: 'hybrid-xiangqi', name: '融合象棋', randomLevel: 0, path: 'hybrid-xiangqi', enabled: true, recommended: false, category: '象棋/杀王', intro: '' },
	        { id: 'hexagon-chess', name: '六角国际象棋', randomLevel: 0, path: 'hexagon-chess', enabled: true, recommended: false, category: '象棋/杀王', intro: '六角棋盘上的国际象棋。' },
			{ id: 'rhombic-chess', name: '菱国际象棋', randomLevel: 0, path: 'rhombic-chess', enabled: true, recommended: false, category: '象棋/杀王', intro: '菱棋盘上的国际象棋。' },
			{ id: 'circular-chess', name: '环国际象棋', randomLevel: 0, path: 'circular-chess', enabled: true, recommended: false, category: '象棋/杀王', intro: '环棋盘上的国际象棋。' },
			{ id: 'chess', name: '国际象棋', randomLevel: 0, path: 'chess', enabled: true, recommended: false, category: '象棋/杀王', intro: '普通的国际象棋有什么好玩的。' },
			{ id: 'simulated-shogi', name: '模拟日本将棋', randomLevel: 0, path: 'simulated-shogi', enabled: true, recommended: false, category: '象棋/杀王', intro: '普通的日本将棋有什么好玩的。' },
            { id: 'janggi', name: '朝鲜将棋', randomLevel: 0, path: 'janggi', enabled: true, recommended: false, category: '象棋/杀王', intro: '普通的朝鲜将棋有什么好玩的。' },
            { id: 'simulated-makruk', name: '模拟泰国象棋', randomLevel: 0, path: 'simulated-makruk', enabled: true, recommended: false, category: '象棋/杀王', intro: '普通的泰国象棋有什么好玩的。' },
            { id: 'caturanga', name: '古印度象棋', randomLevel: 0, path: 'caturanga', enabled: true, recommended: false, category: '象棋/杀王', intro: '恰图兰卡有什么好玩的。' },

			// 不围棋
            { id: 'noweiqi', name: '不围棋', randomLevel: 0, path: 'noweiqi', enabled: true, recommended: false, category: '不围棋/封锁', intro: '不允许提子，欠行负。' },
            { id: 'reverse-noweiqi', name: '反不围棋', randomLevel: 0, path: 'reverse-noweiqi', enabled: true, recommended: false, category: '不围棋/封锁', intro: '不允许提子，欠行胜。' },
            { id: 'nopincer', name: '不夹棋', randomLevel: 0, path: 'nopincer', enabled: true, recommended: false, category: '不围棋/封锁', intro: '不允许夹，欠行负。' },
            { id: 'nowuziqi', name: '不五子棋', randomLevel: 0, path: 'nowuziqi', enabled: true, recommended: false, category: '不围棋/封锁', intro: '不允许连五，欠行负。' },	
            { id: 'nort', name: '放牛棋', randomLevel: 0, path: 'snort', enabled: true, recommended: false, category: '不围棋/封锁', intro: '不允许单独碰一颗对方的棋子，欠行负。' },

			// 国际跳棋类
			{ id: 'draughts', name: '国际跳棋', randomLevel: 0, path: 'draughts', enabled: true, recommended: false, category: '国际跳棋/全歼', intro: '国际跳棋有什么好玩的。' },
			{ id: 'wudao', name: '五道棋', randomLevel: 0, path: 'wudao', enabled: true, recommended: false, category: '国际跳棋/全歼', intro: '' },
			{ id: 'neighbours', name: '邻居棋', randomLevel: 0, path: 'neighbours', enabled: true, recommended: false, category: '国际跳棋/全歼', intro: '' },
		
			// 跳达棋类
			{ id: 'salta', name: '原始跳达棋', randomLevel: 0, path: 'salta', enabled: true, recommended: false, category: '跳达棋/到达', intro: '把棋子移动到对面同号的格子里。' },
			{ id: 'halma', name: '跳达棋', randomLevel: 0, path: 'halma', enabled: true, recommended: false, category: '跳达棋/到达', intro: '跳达棋有什么好玩的。' },
			{ id: 'sternhalma', name: '六角跳达棋', randomLevel: 0, path: 'sternhalma', enabled: false, recommended: false, category: '跳达棋/到达', intro: '六角跳达棋有什么好玩的。' },
			{ id: 'fog-halma', name: '迷雾跳达棋', randomLevel: 3, path: 'fog-halma', enabled: false, recommended: false, category: '跳达棋/到达', intro: '' },
			{ id: 'quoridor', name: '路墙棋', randomLevel: 0, path: 'quoridor', enabled: true, recommended: false, category: '跳达棋/到达', intro: '砌墙让对方绕路，但不能把对方堵死。' },

			// 结子棋类
			{ id: 'neutreeko', name: '结子棋', randomLevel: 0, path: 'neutreeko', enabled: true, recommended: false, category: '结子棋/成型', intro: '' },
			{ id: 'lines-of-action', name: '集结棋', randomLevel: 0, path: 'lines-of-action', enabled: true, recommended: false, category: '结子棋/成型', intro: '把棋子全部连起来。' },

			// 贯棋类
			{ id: 'connection', name: '贯棋', randomLevel: 0, path: 'connection', roomPlugin: 'connection-rooms.js', enabled: false, recommended: false, category: '贯棋/连接', intro: '' },
			{ id: 'hexagon-connection', name: '六贯棋', randomLevel: 0, path: 'hexagon-connection', roomPlugin: 'hexagon-connection-room.js', enabled: true, recommended: false, category: '贯棋/连接', intro: '' },

			// 其它类
            { id: 'super-24', name: '超级24点', randomLevel: 0, path: 'super-24', enabled: true, recommended: false, category: '其它', intro: '' },
            { id: 'versus-minesweeper', name: '对战扫雷', randomLevel: 0, path: 'versus-minesweeper', enabled: true, recommended: false, category: '其它', intro: '' },
            { id: 'speed-minesweeper', name: '竞速扫雷', randomLevel: 0, path: 'speed-minesweeper', enabled: true, recommended: false, category: '其它', intro: '' },
            { id: 'schulte-grid', name: '舒尔特方格', randomLevel: 0, path: 'schulte-grid', enabled: true, recommended: false, category: '其它', intro: '打谱练习。' },
            { id: 'versus-schulte-grid', name: '对战舒尔特方格', randomLevel: 0, path: 'versus-schulte-grid', enabled: true, recommended: false, category: '其它', intro: '打谱练习。' },
            { id: 'guess-number', name: '猜数字', randomLevel: 0, path: 'guess-number', enabled: true, recommended: false, category: '其它', intro: '' },
            { id: 'dfw', name: 'DFW', randomLevel: 0, path: 'dfw', enabled: true, recommended: false, category: '其它', intro: '测试游戏，无实际功能。' },
		];
    const subGameNames = {
        'cylinder-weiqi': '柱面围棋',
        'weak-magnetism-weiqi': '弱磁性围棋', 'medium-magnetism-weiqi': '中磁性围棋', 'strong-magnetism-weiqi': '强磁性围棋',
        'biliberty-weiqi': '二气围棋', 'triliberty-weiqi': '三气围棋', 'quadriliberty-weiqi': '四气围棋',
        'triangle-weiqi': '三角围棋', 'snub-quadrangle-weiqi': '扭棱四角围棋', 'cairo-pentagon-weiqi': '开罗五角围棋',
        'floret-pentagon-weiqi': '花形五角围棋', 'hexagon-weiqi': '六角围棋', 'rhom-triangle-weiqi': '菱形三角围棋', 'hexagon-triangle-weiqi': '六角形三角围棋',
        'biweight-weiqi': '二权重围棋', 'triweight-weiqi': '三权重围棋', 'focus-weight-weiqi': '焦点围棋',
        'no-adjacent-prev-weiqi': '不邻前手围棋', 'no-adjacent-own-prev-weiqi': '不邻己方前手围棋',
        'no-near-prev-weiqi': '不近前手围棋', 'no-near-own-prev-weiqi': '不近己方前手围棋',
        snort: '小放牛棋', lnort: '大放牛棋', 'ultimate-24': '究级24点',
        'custom-weiqi-triangle': '自定义围棋（三角）', 'custom-weiqi-snub': '自定义围棋（扭棱四角）',
        'custom-weiqi-cairo': '自定义围棋（开罗五角）', 'custom-weiqi-floret': '自定义围棋（花形五角）', 'custom-weiqi-hexagon': '自定义围棋（六角）'
    };
    const catalog = { games, categories: ['围棋/占地', '五子棋/成型', '象棋/杀王', '不围棋/封锁', '国际跳棋/全歼', '跳达棋/到达', '结子棋/成型', '贯棋/连接', '其它'],
        getGameName(id) { return subGameNames[id] || games.find(game => game.id === id)?.name || id; }
    };
    if (typeof module === 'object' && module.exports) module.exports = catalog;
    else global.QiGameCatalog = catalog;
})(typeof window !== 'undefined' ? window : globalThis);
