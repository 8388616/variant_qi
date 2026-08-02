#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从大厅/房间页相关源文件收集主包用字，写入 main-chars.txt。"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # 棋/
PUBLIC = ROOT / "public"
OUT = Path(__file__).resolve().parent / "main-chars.txt"

# 去掉脚本/样式大块，避免把 JS 标识符噪声全塞进主包；仍保留字符串与 HTML 文本。
STRIP_BLOCKS = re.compile(
    r"<script\b[^>]*>[\s\S]*?</script>|<style\b[^>]*>[\s\S]*?</style>",
    re.I,
)
# 从 JS 中抽出字符串字面量（含规则说明、标题等）
JS_STRINGS = re.compile(
    r"""(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)""",
)


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def keep_char(ch: str) -> bool:
    return ord(ch) >= 0x20 and ch not in "\r\n\t"


def chars_from_js_strings(text: str) -> set[str]:
    out: set[str] = set()
    for m in JS_STRINGS.finditer(text):
        s = m.group(0)[1:-1]
        s = (
            s.replace("\\n", "\n")
            .replace("\\r", "")
            .replace("\\t", " ")
            .replace('\\"', '"')
            .replace("\\'", "'")
            .replace("\\\\", "\\")
        )
        out.update(ch for ch in s if keep_char(ch))
    return out


def chars_from_html(text: str) -> set[str]:
    # 先收集 <script> 内字符串，再去掉 script/style，再取标签外文本
    out = chars_from_js_strings(text)
    text = STRIP_BLOCKS.sub(" ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    out.update(ch for ch in text if keep_char(ch))
    return out


def collect() -> set[str]:
    chars: set[str] = set()
    html_files = [
        PUBLIC / "qi.html",
        PUBLIC / "room.html",
        PUBLIC / "super-24.html",
        PUBLIC / "speed-minesweeper.html",
        ROOT / "其它" / "超级24点" / "超级24点.html",
        ROOT / "其它" / "竞速扫雷" / "竞速扫雷.html",
    ]
    for p in html_files:
        if not p.exists():
            continue
        before = len(chars)
        chars |= chars_from_html(read_text(p))
        print(f"HTML {p.relative_to(ROOT)}: +{len(chars) - before} -> {len(chars)}")

    js_files = [
        PUBLIC / "room.js",
        PUBLIC / "qi.js",
        ROOT / "common.js",
    ]
    plugins_dir = PUBLIC / "room-plugins"
    if plugins_dir.is_dir():
        js_files.extend(sorted(plugins_dir.glob("*-room.js")))
    for p in js_files:
        if not p.exists():
            continue
        before = len(chars)
        chars |= chars_from_js_strings(read_text(p))
        print(f"JS   {p.relative_to(ROOT)}: +{len(chars) - before} -> {len(chars)}")

    return chars


def main() -> None:
    chars = collect()
    # 稳定排序：按码点
    text = "".join(sorted(chars, key=ord))
    OUT.write_text(text + "\n", encoding="utf-8")
    cjk = sum(1 for c in chars if "\u4e00" <= c <= "\u9fff")
    print(f"写入 {OUT}：总字符 {len(chars)}（汉字 {cjk}）")


if __name__ == "__main__":
    main()
