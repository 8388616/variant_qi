'use strict';

/** 两字植物种名列表（1000 个，含常见与冷门种名） */
const PLANT_SPECIES_NAMES = [
    "木贼",
    "银杏",
    "水杉",
    "雪松",
    "云杉",
    "冷杉",
    "红杉",
    "落羽",
    "池杉",
    "圆柏",
    "侧柏",
    "龙柏",
    "垂柏",
    "偃柏",
    "桧柏",
    "刺柏",
    "杜松",
    "罗汉",
    "香樟",
    "楠木",
    "檫木",
    "泡桐",
    "梧桐",
    "梓树",
    "楸树",
    "梣树",
    "槐木",
    "榆树",
    "朴树",
    "榉树",
    "桑树",
    "构树",
    "青冈",
    "麻栎",
    "槲树",
    "盐肤",
    "漆树",
    "黄栌",
    "白蜡",
    "梾木",
    "红松",
    "黑松",
    "油松",
    "华山",
    "五针",
    "偃松",
    "垂柳",
    "旱柳",
    "怪柳",
    "杞柳",
    "胡杨",
    "白杨",
    "青杨",
    "山杨",
    "毛白",
    "钻天",
    "箭杆",
    "加杨",
    "黑桦",
    "白桦",
    "红桦",
    "岳桦",
    "锦鸡",
    "刺槐",
    "国槐",
    "龙爪",
    "紫穗",
    "木槿",
    "锦带",
    "六道",
    "忍冬",
    "金银",
    "琼花",
    "荚蒾",
    "卫矛",
    "扶芳",
    "白鹃",
    "杜鹃",
    "映山",
    "马缨",
    "羊踯",
    "石楠",
    "椤木",
    "火棘",
    "栒子",
    "平枝",
    "花楸",
    "珍珠",
    "山楂",
    "山里",
    "海棠",
    "苹果",
    "沙果",
    "花红",
    "梨木",
    "白梨",
    "沙梨",
    "秋子",
    "杜梨",
    "麻梨",
    "桃木",
    "碧桃",
    "寿星",
    "垂丝",
    "西府",
    "贴梗",
    "木瓜",
    "皱皮",
    "蔷薇",
    "月季",
    "玫瑰",
    "木香",
    "金樱",
    "悬钩",
    "地榆",
    "龙芽",
    "棣棠",
    "委陵",
    "翻白",
    "蛇莓",
    "草莓",
    "凌霄",
    "紫葳",
    "木棉",
    "吉贝",
    "石榴",
    "夹竹",
    "长春",
    "络石",
    "紫草",
    "附地",
    "龙胆",
    "秦艽",
    "獐牙",
    "扁蕾",
    "当药",
    "牡丹",
    "芍药",
    "草芍",
    "川赤",
    "乌头",
    "草乌",
    "附子",
    "升麻",
    "铁线",
    "唐松",
    "翠雀",
    "耧斗",
    "黄连",
    "短萼",
    "三角",
    "五加",
    "刺五",
    "人参",
    "三七",
    "竹节",
    "珠子",
    "薄荷",
    "留兰",
    "罗勒",
    "紫苏",
    "白苏",
    "荆芥",
    "益母",
    "夏枯",
    "鼠尾",
    "百里",
    "香薷",
    "藿香",
    "广藿",
    "佩兰",
    "泽兰",
    "灵兰",
    "石蒜",
    "朱顶",
    "水仙",
    "石竹",
    "瞿麦",
    "萹蓄",
    "蓼蓝",
    "酸模",
    "大黄",
    "商陆",
    "菹草",
    "藨草",
    "莎草",
    "苔草",
    "稗子",
    "荩草",
    "燕麦",
    "看麦",
    "狗尾",
    "茅针",
    "芦竹",
    "淡竹",
    "毛竹",
    "慈竹",
    "苦竹",
    "箭竹",
    "箬竹",
    "方竹",
    "佛肚",
    "斑竹",
    "紫竹",
    "刚竹",
    "早园",
    "雷竹",
    "哺鸡",
    "黄槽",
    "绿竹",
    "麻竹",
    "甜竹",
    "撑篙",
    "茶杆",
    "芦苇",
    "荻草",
    "芒草",
    "白茅",
    "黄茅",
    "野古",
    "金丝",
    "龙须",
    "拂子",
    "羊茅",
    "早熟",
    "硬草",
    "野青",
    "狗牙",
    "结缕",
    "马唐",
    "牛筋",
    "千金",
    "雀稗",
    "狼尾",
    "白顶",
    "粟米",
    "稷子",
    "黍子",
    "高粱",
    "玉米",
    "小麦",
    "大麦",
    "黑麦",
    "荞麦",
    "糜子",
    "谷子",
    "荷花",
    "睡莲",
    "王莲",
    "萍蓬",
    "荇菜",
    "芡实",
    "菱角",
    "莼菜",
    "水鳖",
    "浮萍",
    "紫萍",
    "满江",
    "凤眼",
    "水烛",
    "香蒲",
    "黑三",
    "水葱",
    "浮叶",
    "艾蒿",
    "青蒿",
    "黄花",
    "白蒿",
    "野艾",
    "茵陈",
    "苍耳",
    "豨莶",
    "鸡冠",
    "青葙",
    "反枝",
    "凹头",
    "刺苋",
    "皱叶",
    "绿苋",
    "野苋",
    "长芒",
    "碱蓬",
    "盐角",
    "地肤",
    "猪毛",
    "灰绿",
    "红叶",
    "细叶",
    "圆叶",
    "尖叶",
    "菱叶",
    "杖藜",
    "红蓼",
    "水蓼",
    "辣蓼",
    "羊蹄",
    "麦瓶",
    "繁缕",
    "漆姑",
    "牛繁",
    "雀舌",
    "卷耳",
    "灯心",
    "牛膝",
    "银柴",
    "石头",
    "剪秋",
    "紫云",
    "田菁",
    "草木",
    "胡枝",
    "铁扫",
    "紫藤",
    "葛藤",
    "刀豆",
    "豇豆",
    "扁豆",
    "蚕豆",
    "豌豆",
    "大豆",
    "桲果",
    "沙棘",
    "胡颓",
    "南天",
    "十大",
    "功劳",
    "枸骨",
    "冬青",
    "杉木",
    "松木",
    "柏木",
    "樟木",
    "檀木",
    "柚木",
    "榆木",
    "柳木",
    "杨木",
    "桦木",
    "栎木",
    "槭木",
    "椴木",
    "朴木",
    "桑木",
    "构木",
    "楸木",
    "梓木",
    "荆条",
    "黄荆",
    "牡荆",
    "紫荆",
    "梣叶",
    "女贞",
    "小叶",
    "大叶",
    "水蜡",
    "流苏",
    "木犀",
    "桂花",
    "丹桂",
    "金桂",
    "银桂",
    "四季",
    "日香",
    "佛顶",
    "珠兰",
    "米兰",
    "白兰",
    "广玉",
    "含笑",
    "东鹃",
    "西鹃",
    "毛鹃",
    "夏鹃",
    "春鹃",
    "水栒",
    "倭海",
    "十样",
    "七姊",
    "鹅绒",
    "水杨",
    "千屈",
    "紫薇",
    "攀枝",
    "安石",
    "花石",
    "果石",
    "蔓长",
    "斑种",
    "勿忘",
    "鹤虱",
    "田基",
    "类叶",
    "垂序",
    "美洲",
    "小拂",
    "大拂",
    "枫香",
    "鹅掌",
    "桤木",
    "赤杨",
    "桫椤",
    "苏铁",
    "红豆",
    "云锦",
    "白花",
    "红花",
    "紫花",
    "蓝花",
    "粉花",
    "小花",
    "大花",
    "粗叶",
    "长叶",
    "短叶",
    "宽叶",
    "狭叶",
    "厚叶",
    "薄叶",
    "毛叶",
    "光叶",
    "当归",
    "黄芪",
    "甘草",
    "茯苓",
    "泽泻",
    "猪苓",
    "车前",
    "玉竹",
    "黄精",
    "百部",
    "白前",
    "白薇",
    "石斛",
    "白及",
    "白芨",
    "天麻",
    "重楼",
    "独活",
    "羌活",
    "藁本",
    "防风",
    "白芷",
    "川芎",
    "丹参",
    "桃仁",
    "杏仁",
    "贝母",
    "元胡",
    "郁金",
    "姜黄",
    "莪术",
    "三棱",
    "细辛",
    "苍术",
    "白术",
    "厚朴",
    "黄柏",
    "黄芩",
    "栀子",
    "连翘",
    "银花",
    "铁角",
    "凤尾",
    "肾蕨",
    "石韦",
    "瓦韦",
    "槲蕨",
    "紫萁",
    "狗脊",
    "贯众",
    "卷柏",
    "翠云",
    "阴石",
    "阳石",
    "兰科",
    "七叶",
    "一枝",
    "油桐",
    "苦槠",
    "甜槠",
    "锥栗",
    "板栗",
    "茅栗",
    "绿杨",
    "粗荷",
    "黑桂",
    "黄苓",
    "硬兰",
    "粉连",
    "暗壳",
    "直翘",
    "深腺",
    "浅梅",
    "浅樟",
    "绿木",
    "青樟",
    "家兰",
    "圆茎",
    "紫术",
    "绿术",
    "旧术",
    "软杨",
    "橙叶",
    "褐艾",
    "陆参",
    "粉药",
    "陆竹",
    "黄壳",
    "明粉",
    "陆荆",
    "明杉",
    "水种",
    "尖实",
    "新莲",
    "曲术",
    "长连",
    "斑纹",
    "橙核",
    "暗朴",
    "斑杨",
    "陆槭",
    "水干",
    "陆干",
    "高术",
    "高柏",
    "红荆",
    "长腺",
    "灰荷",
    "曲脉",
    "斑木",
    "曲苓",
    "红槐",
    "黑孔",
    "绿兰",
    "新樟",
    "斑参",
    "软栎",
    "粗连",
    "细榆",
    "家花",
    "暗松",
    "尖核",
    "细蒿",
    "高枝",
    "橙朴",
    "斑果",
    "硬芪",
    "水樟",
    "新兰",
    "新苓",
    "白孔",
    "细根",
    "新草",
    "圆粉",
    "灰杏",
    "野梅",
    "圆根",
    "长柏",
    "紫实",
    "橙芽",
    "直梅",
    "细椴",
    "粉壳",
    "曲芍",
    "陆槐",
    "粗翘",
    "水苓",
    "浅木",
    "紫芪",
    "明芍",
    "灰樱",
    "水兰",
    "暗核",
    "黑叶",
    "赤松",
    "绿莲",
    "暗芪",
    "暗柏",
    "褐粉",
    "深果",
    "圆李",
    "褐壳",
    "青樱",
    "绿荷",
    "尖莲",
    "细花",
    "粗花",
    "野槭",
    "橙竹",
    "新壳",
    "新纹",
    "橙毛",
    "硬樱",
    "白构",
    "曲苏",
    "高种",
    "橙柳",
    "黑根",
    "细翘",
    "新茹",
    "高椴",
    "野芪",
    "灰脉",
    "粉柏",
    "硬芷",
    "深杨",
    "紫桑",
    "橙藤",
    "细桑",
    "曲樱",
    "高菊",
    "赤壳",
    "陆膜",
    "赤膜",
    "细芍",
    "旧柳",
    "赤根",
    "旧竹",
    "硬构",
    "陆叶",
    "尖粉",
    "矮杏",
    "硬药",
    "明构",
    "青兰",
    "长李",
    "暗芽",
    "深松",
    "斑栎",
    "粗术",
    "水杏",
    "野朴",
    "软茎",
    "黑构",
    "浅翘",
    "橙干",
    "长刺",
    "褐脉",
    "黑芍",
    "赤连",
    "水芍",
    "红术",
    "矮参",
    "紫朴",
    "橙樟",
    "斑柳",
    "直脉",
    "硬芽",
    "红孔",
    "家艾",
    "红荷",
    "尖荆",
    "家椴",
    "直桃",
    "灰松",
    "浅膜",
    "尖栎",
    "新桃",
    "褐松",
    "水果",
    "青粉",
    "橙膜",
    "硬术",
    "高杨",
    "黄朴",
    "野药",
    "尖根",
    "暗榆",
    "细药",
    "明兰",
    "粉槭",
    "陆杉",
    "硬壳",
    "斑柏",
    "矮壳",
    "橙茹",
    "浅药",
    "明蒿",
    "青桂",
    "细朴",
    "野花",
    "长柳",
    "旧槐",
    "粉桑",
    "浅柏",
    "暗兰",
    "橙槭",
    "浅花",
    "紫孔",
    "黑栎",
    "赤芍",
    "野膜",
    "紫桂",
    "长芍",
    "深构",
    "暗干",
    "紫药",
    "高松",
    "矮干",
    "曲李",
    "明苓",
    "软刺",
    "浅朴",
    "家实",
    "红竹",
    "斑杏",
    "红果",
    "黄椴",
    "褐核",
    "家术",
    "细脉",
    "新朴",
    "矮松",
    "斑核",
    "矮桂",
    "褐草",
    "水毛",
    "高柳",
    "深杏",
    "曲药",
    "矮茎",
    "陆茎",
    "粉杨",
    "细毛",
    "深桑",
    "新李",
    "粗皮",
    "红艾",
    "新茎",
    "黑膜",
    "明连",
    "褐构",
    "矮种",
    "红毛",
    "绿椴",
    "粉兰",
    "尖毛",
    "粉根",
    "赤花",
    "软荆",
    "粉苏",
    "水药",
    "灰藤",
    "曲根",
    "尖朴",
    "粉枝",
    "矮苓",
    "直干",
    "青苓",
    "明竹",
    "新木",
    "灰梅",
    "黄参",
    "红朴",
    "粉术",
    "褐芪",
    "曲种",
    "家叶",
    "粗茎",
    "深粉",
    "粗壳",
    "红桂",
    "橙兰",
    "黑果",
    "曲核",
    "深艾",
    "褐芷",
    "尖种",
    "高樟",
    "青核",
    "野壳",
    "水李",
    "野干",
    "曲构",
    "褐纹",
    "尖杉",
    "矮柏",
    "矮茹",
    "直粉",
    "尖杨",
    "橙果",
    "新槐",
    "硬梅",
    "暗粉",
    "新核",
    "软木",
    "矮纹",
    "矮樱",
    "曲茹",
    "圆椴",
    "深杉",
    "黄果",
    "褐实",
    "灰柳",
    "深桃",
    "暗花",
    "软榆",
    "曲朴",
    "紫兰",
    "软椴",
    "红菊",
    "黄木",
    "赤毛",
    "水芪",
    "粉朴",
    "直槭",
    "紫木",
    "明腺",
    "紫皮",
    "旧茹",
    "明翘",
    "青桑",
    "水槐",
    "粗蒿",
    "粉种",
    "细樱",
    "橙栎",
    "白桑",
    "褐杏",
    "直松",
    "软苏",
    "赤药",
    "长草",
    "灰根",
    "陆芷",
    "细实",
    "硬脉",
    "红刺",
    "陆实",
    "尖木",
    "圆桃",
    "斑梅",
    "橙花",
    "水荷",
    "尖杏",
    "斑苏",
    "曲芪",
    "紫刺",
    "圆梅",
    "斑桂",
    "直根",
    "浅参",
    "暗草",
    "家茎",
    "橙杨",
    "直兰",
    "新艾",
    "深毛",
    "圆腺",
    "矮莲",
    "浅皮",
    "高刺",
    "新芽",
    "长芽",
    "高藤",
    "粉核",
    "黄藤",
    "圆荆",
    "粗苏",
    "矮术",
    "尖芽",
    "软花",
    "红苓",
    "红脉",
    "暗腺",
    "红芍",
    "旧芽",
    "灰核",
    "青翘",
    "高苏",
    "绿叶",
    "黑桃",
    "青根",
    "黄槐",
    "斑槐",
    "明朴",
    "软实",
    "家梅",
    "橙桂",
    "陆樱",
    "曲粉",
    "长粉",
    "黑芷",
    "红杨",
    "硬皮",
    "青杉",
    "硬桂",
    "高皮",
    "粉芍",
    "褐柏",
    "尖桃",
    "软菊",
    "黑实",
    "新桂",
    "斑朴",
    "尖柏",
    "黑柏",
    "矮朴",
    "褐荷",
    "暗皮",
    "紫槭",
    "紫连",
    "红连",
    "旧榆",
    "长槐",
    "粉构",
    "硬杉",
    "长脉",
    "矮孔",
    "粗草",
    "矮枝",
    "矮榆",
    "绿芪",
    "圆参",
    "粉芽",
    "硬毛",
    "黑藤",
    "黑兰",
    "明柳",
    "褐茎",
    "黄翘",
    "新粉",
    "赤脉",
    "尖松",
    "粗朴",
    "斑兰",
    "旧叶",
    "陆栎",
    "细苓",
    "黄兰",
    "灰兰",
    "长实",
    "圆杏",
    "黑艾",
    "曲杨",
    "长樟",
    "斑皮",
    "高李",
    "野栎",
    "明枝",
    "野术",
    "紫腺",
    "白干",
    "直竹",
    "硬苓",
    "家皮",
    "圆朴",
    "曲花",
    "紫叶",
    "粉脉",
    "绿腺",
    "高莲",
    "黑樟",
    "斑荆",
    "灰柏",
    "黑核",
    "紫纹",
    "野实",
    "硬蒿",
    "赤栎",
    "粗樟",
    "暗柳",
    "硬槐",
    "矮杉",
    "细刺",
    "绿种",
    "暗栎",
    "水刺",
    "家苓",
    "家种",
    "陆梅",
    "长艾",
    "直蒿",
    "软松",
    "旧连",
    "陆根",
    "软茹",
    "旧枝",
    "矮芪",
    "褐叶",
    "明叶",
    "暗种",
    "水竹",
    "青构",
    "高苓",
    "褐榆",
    "暗桂",
    "深纹",
    "直杨",
    "灰毛",
    "深药",
    "绿膜",
    "尖果",
    "褐朴",
    "黄杨",
    "陆藤",
    "新杏",
    "褐参",
    "家菊",
    "绿花",
    "曲荆"
];

const DEFAULT_ROUND_COUNT = 5;
const DEFAULT_ROUND_MINUTES = 3;

/** @param {number} min @param {number} max */
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRoundPuzzle() {
    const numbers = [];
    for (let i = 0; i < 10; i++) numbers.push(randInt(1, 100));
    const target = randInt(1000000000, 9999999999);
    return { numbers, target };
}

const ALLOWED_EXPR_RE = /^[0-9+\-*/().\s]*$/;

function tokenizeNumbers(expr) {
    const out = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (ch >= '0' && ch <= '9') {
            let j = i + 1;
            while (j < expr.length && expr[j] >= '0' && expr[j] <= '9') j++;
            out.push(parseInt(expr.slice(i, j), 10));
            i = j;
        } else {
            i++;
        }
    }
    return out;
}

function numbersMatchRequired(used, required) {
    return validateNumberUsage(used, required).ok;
}

/** @returns {{ ok: true } | { ok: false, msg: string }} */
function validateNumberUsage(used, required) {
    const reqCount = new Map();
    for (const n of required) reqCount.set(n, (reqCount.get(n) || 0) + 1);
    const usedCount = new Map();
    for (const n of used) usedCount.set(n, (usedCount.get(n) || 0) + 1);

    for (const [n] of usedCount) {
        if (!reqCount.has(n)) {
            return { ok: false, msg: `${n}不在给出的整数中` };
        }
    }
    for (const [n, c] of usedCount) {
        const need = reqCount.get(n) || 0;
        if (c > need) return { ok: false, msg: `${n}重复` };
    }
    for (const [n, need] of reqCount) {
        const c = usedCount.get(n) || 0;
        if (c < need) return { ok: false, msg: `缺少${n}` };
    }
    return { ok: true };
}

/** 剥离开头多余的 '(' 与末尾多余的 ')'，使 (12+34、(12+34)) 等仍可求值 */
function normalizeExpressionParens(s) {
    let t = s;
    let changed = true;
    while (changed) {
        changed = false;
        let opens = 0;
        let closes = 0;
        for (const ch of t) {
            if (ch === '(') opens++;
            else if (ch === ')') closes++;
        }
        if (opens > closes && t[0] === '(') {
            t = t.slice(1);
            changed = true;
        } else if (closes > opens && t[t.length - 1] === ')') {
            t = t.slice(0, -1);
            changed = true;
        }
    }
    return t;
}

/**
 * 安全解析并求值四则运算表达式（支持括号与一元负号）。
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
function evaluateExpression(expr) {
    if (typeof expr !== 'string') return { ok: false, error: '无效算式' };
    const s = normalizeExpressionParens(expr.replace(/\s+/g, ''));
    if (!s) return { ok: false, error: '算式为空' };
    if (!ALLOWED_EXPR_RE.test(s)) return { ok: false, error: '含非法字符' };

    let i = 0;
    function peek() { return s[i]; }
    function next() { return s[i++]; }

    function parsePrimary() {
        if (peek() === '(') {
            next();
            const inner = parseExpr();
            if (!inner.ok) return inner;
            if (peek() !== ')') return { ok: false, error: '括号不匹配' };
            next();
            return { ok: true, value: inner.value };
        }
        if (peek() === '-' || peek() === '+') {
            const sign = next() === '-' ? -1 : 1;
            const inner = parsePrimary();
            if (!inner.ok) return inner;
            return { ok: true, value: sign * inner.value };
        }
        if (peek() >= '0' && peek() <= '9') {
            let start = i;
            while (peek() >= '0' && peek() <= '9') next();
            return { ok: true, value: parseInt(s.slice(start, i), 10) };
        }
        return { ok: false, error: '语法错误' };
    }

    function parseFactor() {
        let left = parsePrimary();
        if (!left.ok) return left;
        while (peek() === '*' || peek() === '/') {
            const op = next();
            const right = parsePrimary();
            if (!right.ok) return right;
            if (op === '/') {
                if (right.value === 0) return { ok: false, error: '除数为零' };
                left = { ok: true, value: left.value / right.value };
            } else {
                left = { ok: true, value: left.value * right.value };
            }
        }
        return left;
    }

    function parseExpr() {
        let left = parseFactor();
        if (!left.ok) return left;
        while (peek() === '+' || peek() === '-') {
            const op = next();
            const right = parseFactor();
            if (!right.ok) return right;
            left = { ok: true, value: op === '+' ? left.value + right.value : left.value - right.value };
        }
        return left;
    }

    const r = parseExpr();
    if (!r.ok) return r;
    if (i < s.length) return { ok: false, error: '语法错误' };
    if (!Number.isFinite(r.value)) return { ok: false, error: '结果无效' };
    return r;
}

function formatResultValue(v) {
    if (!Number.isFinite(v)) return '—';
    const rounded = Math.round(v * 1e6) / 1e6;
    const s = String(rounded);
    if (s.includes('e') || s.includes('E')) return s;
    if (s.includes('.')) return s.replace(/\.?0+$/, '') || '0';
    return s;
}

/** @param {number} error absolute error */
/** @param {number} target round target */
function calcRoundPoints(error, target) {
    if (!Number.isFinite(error) || !Number.isFinite(target) || target < 0) return 0;
    const denom = Math.log(1 + target);
    if (denom <= 0) return 0;
    const ratio = Math.log(1 + Math.max(0, error)) / denom;
    return Math.max(0, (1 - Math.pow(ratio, 4)) * 100);
}

class Super24Room {
    constructor(room) {
        this.room = room;
        /** @type {'lobby'|'playing'|'finished'} */
        this.phase = 'lobby';
        /** @type {Map<string, { id: string, joinedAt: number, roundErrors: (number|null)[], roundScores: (number|null)[], avgError: number|null, avgScore: number|null, ws: import('ws')|null }>} */
        this.players = new Map();
        /** @type {string[]} join order */
        this.joinOrder = [];
        this.hostId = null;
        this.currentRound = 0;
        this.roundCount = DEFAULT_ROUND_COUNT;
        this.roundMinutes = DEFAULT_ROUND_MINUTES;
        this.roundMs = DEFAULT_ROUND_MINUTES * 60 * 1000;
        /** @type {{ numbers: number[], target: number }|null} */
        this.puzzle = null;
        /** @type {{ endMs: number, remainingMs: number, lastUpdateMs: number, pauseCount: number }|null} */
        this.roundClock = null;
        this._clockInterval = null;
        /** playerId -> best diff this round */
        this.roundBest = new Map();
        this.gameStarted = false;
        this.finished = false;
    }

    broadcast(data, exclude = null) {
        this.room.broadcast(data, exclude);
    }

    assignSlot() {
        return null;
    }

    _genPlayerId() {
        const used = new Set(this.players.keys());
        const available = PLANT_SPECIES_NAMES.filter(n => !used.has(n));
        if (available.length > 0) {
            return available[randInt(0, available.length - 1)];
        }
        for (let t = 0; t < 500; t++) {
            const base = PLANT_SPECIES_NAMES[randInt(0, PLANT_SPECIES_NAMES.length - 1)];
            const id = base + String(t);
            if (!used.has(id)) return id;
        }
        return String(Date.now() % 100000);
    }

    _updatePlayerAverages(p) {
        let errSum = 0;
        let scoreSum = 0;
        let n = 0;
        for (let i = 0; i < p.roundErrors.length; i++) {
            if (p.roundErrors[i] == null) continue;
            errSum += p.roundErrors[i];
            scoreSum += p.roundScores[i] ?? 0;
            n++;
        }
        p.avgError = n > 0 ? errSum / n : null;
        p.avgScore = n > 0 ? scoreSum / n : null;
    }

    _playerListPayload() {
        return this.joinOrder.map(id => {
            const p = this.players.get(id);
            return {
                id: p.id,
                roundErrors: p.roundErrors.slice(),
                roundScores: p.roundScores.slice(),
                avgError: p.avgError,
                avgScore: p.avgScore
            };
        });
    }

    _clockSnapshot() {
        if (!this.roundClock || this.phase !== 'playing') return null;
        const now = Date.now();
        let ms = this.roundClock.remainingMs;
        if (this.roundClock.pauseCount <= 0) {
            ms = Math.max(0, this.roundClock.remainingMs - (now - this.roundClock.lastUpdateMs));
        }
        return {
            timed: true,
            remainingMs: ms,
            totalMs: this.roundMs,
            serverNow: now,
            round: this.currentRound
        };
    }

    _broadcastClock() {
        const snap = this._clockSnapshot();
        if (snap) this.broadcast({ type: 'clockUpdate', clock: snap });
    }

    _stopClock() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }

    _applyClockElapsed(nowMs) {
        const rc = this.roundClock;
        if (!rc || rc.pauseCount > 0) {
            if (rc) rc.lastUpdateMs = nowMs;
            return false;
        }
        let elapsed = nowMs - rc.lastUpdateMs;
        if (elapsed < 0) elapsed = 0;
        rc.remainingMs = Math.max(0, rc.remainingMs - elapsed);
        rc.lastUpdateMs = nowMs;
        return rc.remainingMs <= 0;
    }

    _startRoundClock() {
        this._stopClock();
        const now = Date.now();
        this.roundClock = {
            endMs: now + this.roundMs,
            remainingMs: this.roundMs,
            lastUpdateMs: now,
            pauseCount: 0
        };
        this._broadcastClock();
        this._clockInterval = setInterval(() => {
            if (this.phase !== 'playing' || !this.roundClock) {
                this._stopClock();
                return;
            }
            if (this._applyClockElapsed(Date.now())) {
                this._endRound();
            } else {
                this._broadcastClock();
            }
        }, 1000);
    }

    _startRound() {
        this.currentRound += 1;
        this.puzzle = generateRoundPuzzle();
        this.roundBest.clear();
        for (const id of this.joinOrder) {
            this.roundBest.set(id, null);
        }
        this.phase = 'playing';
        this._startRoundClock();
        this.broadcast({ type: 'gameState', ...this.getState() });
    }

    _endRound() {
        this._stopClock();
        this.roundClock = null;

        for (const id of this.joinOrder) {
            const p = this.players.get(id);
            const best = this.roundBest.get(id);
            const idx = this.currentRound - 1;
            const target = this.puzzle ? this.puzzle.target : 1e11;
            const error = best != null ? best : target;
            p.roundErrors[idx] = error;
            p.roundScores[idx] = calcRoundPoints(error, target);
            this._updatePlayerAverages(p);
        }

        if (this.currentRound >= this.roundCount) {
            this.phase = 'finished';
            this.finished = true;
            this.puzzle = null;
            this.broadcast({ type: 'gameState', ...this.getState() });
            return;
        }

        this._startRound();
    }

    getState() {
        const ranked = this._playerListPayload().slice().sort((a, b) => {
            const as = a.avgScore ?? -1;
            const bs = b.avgScore ?? -1;
            if (bs !== as) return bs - as;
            return a.id.localeCompare(b.id);
        });
        return {
            phase: this.phase,
            gameStarted: this.gameStarted,
            finished: this.finished,
            hostId: this.hostId,
            currentRound: this.currentRound,
            roundCount: this.roundCount,
            roundMinutes: this.roundMinutes,
            puzzle: this.puzzle ? { numbers: this.puzzle.numbers.slice(), target: this.puzzle.target } : null,
            players: this._playerListPayload(),
            ranking: ranked,
            clock: this._clockSnapshot()
        };
    }

    getStateForClient(ws) {
        const slot = this.room.getSlotByWs(ws);
        return { ...this.getState(), myPlayerId: slot || null };
    }

    _addPlayer(ws) {
        const id = this._genPlayerId();
        const player = {
            id,
            joinedAt: Date.now(),
            roundErrors: Array(this.roundCount).fill(null),
            roundScores: Array(this.roundCount).fill(null),
            avgError: null,
            avgScore: null,
            ws
        };
        this.players.set(id, player);
        this.joinOrder.push(id);
        if (this.joinOrder.length === 1) this.hostId = id;
        this.room.setPlayerSlot(ws, id);
        return id;
    }

    _parseStartSettings(msg) {
        let roundMinutes = parseInt(String(msg.roundMinutes ?? ''), 10);
        let roundCount = parseInt(String(msg.roundCount ?? ''), 10);
        if (!Number.isFinite(roundMinutes)) roundMinutes = DEFAULT_ROUND_MINUTES;
        if (!Number.isFinite(roundCount)) roundCount = DEFAULT_ROUND_COUNT;
        roundMinutes = Math.min(60, Math.max(1, roundMinutes));
        roundCount = Math.min(30, Math.max(1, roundCount));
        return { roundMinutes, roundCount };
    }

    _resetToLobby() {
        this._stopClock();
        this.roundClock = null;
        this.puzzle = null;
        this.roundBest.clear();
        this.currentRound = 0;
        this.phase = 'lobby';
        this.gameStarted = false;
        this.finished = false;
        for (const p of this.players.values()) {
            p.roundErrors = Array(this.roundCount).fill(null);
            p.roundScores = Array(this.roundCount).fill(null);
            p.avgError = null;
            p.avgScore = null;
        }
    }

    _fullResetRoom() {
        this._stopClock();
        this.roundClock = null;
        this.puzzle = null;
        this.roundBest.clear();
        this.currentRound = 0;
        this.phase = 'lobby';
        this.gameStarted = false;
        this.finished = false;
        this.hostId = null;
        this.players.clear();
        this.joinOrder = [];
    }

    _removePlayer(slot) {
        this.players.delete(slot);
        this.joinOrder = this.joinOrder.filter(id => id !== slot);
    }

    _onRosterChanged() {
        if (this.joinOrder.length === 0) {
            this._fullResetRoom();
        } else {
            this.hostId = this.joinOrder[0];
        }
        this.broadcast({ type: 'gameState', ...this.getState() });
    }

    _isActiveMatch() {
        return this.gameStarted && !this.finished;
    }

    _syncRosterWithConnections() {
        const liveIds = this.joinOrder.filter(id => this.room.getPlayerBySlot(id));
        for (const id of this.joinOrder) {
            if (!liveIds.includes(id)) this.players.delete(id);
        }
        this.joinOrder = liveIds;
        if (this.joinOrder.length === 0 && (this.finished || this.gameStarted || this.players.size > 0)) {
            this._fullResetRoom();
        } else if (this.joinOrder.length > 0) {
            this.hostId = this.joinOrder[0];
        }
    }

    _beginMatch(settings) {
        this.roundMinutes = settings.roundMinutes;
        this.roundCount = settings.roundCount;
        this.roundMs = this.roundMinutes * 60 * 1000;
        for (const p of this.players.values()) {
            p.roundErrors = Array(this.roundCount).fill(null);
            p.roundScores = Array(this.roundCount).fill(null);
            p.avgError = null;
            p.avgScore = null;
        }
        this.gameStarted = true;
        this.finished = false;
        this.phase = 'playing';
        this.currentRound = 0;
        this._startRound();
    }

    handleMessage(ws, msg) {
        switch (msg.type) {
            case 'enterRoom': {
                if (this._isActiveMatch()) {
                    ws.send(JSON.stringify({ type: 'roomEntered', hostId: this.hostId, state: this.getStateForClient(ws) }));
                    return;
                }
                if (this.room.getSlotByWs(ws)) {
                    ws.send(JSON.stringify({ type: 'roomEntered', hostId: this.hostId, state: this.getStateForClient(ws) }));
                    return;
                }
                if (this.players.size >= this.room.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间已满。' }));
                    return;
                }
                this._syncRosterWithConnections();
                if (this.joinOrder.length === 0) {
                    const id = this._addPlayer(ws);
                    ws.send(JSON.stringify({
                        type: 'playerJoined',
                        playerId: id,
                        hostId: this.hostId,
                        state: this.getStateForClient(ws)
                    }));
                    this.broadcast({
                        type: 'playerListUpdate',
                        hostId: this.hostId,
                        players: this._playerListPayload()
                    }, ws);
                } else {
                    ws.send(JSON.stringify({
                        type: 'roomEntered',
                        hostId: this.hostId,
                        state: this.getStateForClient(ws)
                    }));
                }
                break;
            }
            case 'joinGame': {
                if (this._isActiveMatch()) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局已开始，无法加入。' }));
                    return;
                }
                if (this.room.getSlotByWs(ws)) {
                    ws.send(JSON.stringify({ type: 'error', message: '您已在游戏中。' }));
                    return;
                }
                if (this.players.size >= this.room.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: '房间已满。' }));
                    return;
                }
                this._syncRosterWithConnections();
                const id = this._addPlayer(ws);
                ws.send(JSON.stringify({
                    type: 'playerJoined',
                    playerId: id,
                    hostId: this.hostId,
                    state: this.getStateForClient(ws)
                }));
                this.broadcast({
                    type: 'playerListUpdate',
                    hostId: this.hostId,
                    players: this._playerListPayload()
                }, ws);
                break;
            }
            case 'startGame': {
                const slot = this.room.getSlotByWs(ws);
                if (!slot || slot !== this.hostId) {
                    ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏。' }));
                    return;
                }
                if (this._isActiveMatch()) {
                    ws.send(JSON.stringify({ type: 'error', message: '游戏已开始。' }));
                    return;
                }
                if (this.players.size < 1) {
                    ws.send(JSON.stringify({ type: 'error', message: '至少需要一名玩家。' }));
                    return;
                }
                this._beginMatch(this._parseStartSettings(msg));
                break;
            }
            case 'restartGame': {
                const slot = this.room.getSlotByWs(ws);
                if (!slot || slot !== this.hostId) {
                    ws.send(JSON.stringify({ type: 'error', message: '只有房主可以重新开始。' }));
                    return;
                }
                if (!this.finished) {
                    ws.send(JSON.stringify({ type: 'error', message: '对局尚未结束。' }));
                    return;
                }
                this._resetToLobby();
                this.broadcast({ type: 'gameState', ...this.getState() });
                break;
            }
            case 'submitExpression': {
                const slot = this.room.getSlotByWs(ws);
                if (!slot) {
                    ws.send(JSON.stringify({ type: 'error', message: '请先加入游戏。' }));
                    return;
                }
                if (this.phase !== 'playing' || !this.puzzle) {
                    ws.send(JSON.stringify({ type: 'error', message: '当前不可提交。' }));
                    return;
                }
                const expr = typeof msg.expression === 'string' ? msg.expression.trim() : '';
                const ev = evaluateExpression(expr);
                if (!ev.ok) {
                    ws.send(JSON.stringify({ type: 'submitRejected', reason: ev.error }));
                    return;
                }
                const used = tokenizeNumbers(expr.replace(/\s+/g, ''));
                const numCheck = validateNumberUsage(used, this.puzzle.numbers);
                if (!numCheck.ok) {
                    ws.send(JSON.stringify({ type: 'submitRejected', reason: numCheck.msg }));
                    return;
                }
                const diff = Math.abs(ev.value - this.puzzle.target);
                const prev = this.roundBest.get(slot);
                if (prev == null || diff < prev) {
                    this.roundBest.set(slot, diff);
                }
                ws.send(JSON.stringify({
                    type: 'submitAccepted',
                    value: ev.value,
                    valueText: formatResultValue(ev.value),
                    diff,
                    bestThisRound: this.roundBest.get(slot)
                }));
                this.broadcast({
                    type: 'scoresUpdate',
                    players: this._playerListPayload(),
                    round: this.currentRound
                });
                break;
            }
            case 'previewExpression': {
                const expr = typeof msg.expression === 'string' ? msg.expression : '';
                const ev = evaluateExpression(expr);
                if (ev.ok) {
                    ws.send(JSON.stringify({ type: 'previewResult', valueText: formatResultValue(ev.value) }));
                } else {
                    ws.send(JSON.stringify({ type: 'previewResult', valueText: '' }));
                }
                break;
            }
            default:
                break;
        }
    }

    onPlayerLeave(ws) {
        const slot = this.room.getSlotByWs(ws);
        if (!slot) return;

        if (this._isActiveMatch()) {
            const p = this.players.get(slot);
            if (p) p.ws = null;
            return;
        }

        this._removePlayer(slot);
        this._onRosterChanged();
    }
}

module.exports = {
    evaluateExpression,
    tokenizeNumbers,
    numbersMatchRequired,
    validateNumberUsage,
    formatResultValue,
    initRoom(room) {
        room.maxPlayers = 16;
        room.gameLogic = new Super24Room(room);
    }
};
