# LXGW WenKai GB 网页字体（主包 + extra）

结构与参考站类似：首页用字进主包（ui），其余一级常用字进 extra。浏览器按 `unicode-range` 按需下载。

## 当前输出

目录：`lxgw-wenkai-gb/`

| 文件 | 说明 |
|------|------|
| `files/*-ui.woff2` | 主包（首页用字） |
| `files/*-extra.woff2` | 补集（一级字 − 主包） |
| `index.css` | `@font-face` |

字重：Regular 400、Medium 500。

## 重新生成 / 补充用字

1. 源 TTF 放在 `_src/`：
   - `LXGWWenKaiGB-Regular.ttf`
   - `LXGWWenKaiGB-Medium.ttf`
2. 一级字表：`_level1.txt`（已有）
3. 运行（把「主包用字」文件换成你的文本或 HTML）：

```bash
python public/fonts/build_wenkai_subset.py qi.html
# 或
python public/fonts/build_wenkai_subset.py path/to/chars.txt
```

输入文件里出现过的字符会进入主包；一级常用字里其余部分进入 extra。

依赖：`pip install fonttools brotli`
