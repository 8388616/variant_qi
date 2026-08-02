#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 LXGW WenKai GB 网页字体子集（参考 fog 站：主包 + extra）。

用法:
  python build_wenkai_subset.py <主包用字文件> [--out DIR] [--level1 FILE]

示例:
  python build_wenkai_subset.py ../../qi.html
  python build_wenkai_subset.py main-chars.txt

说明:
  - 主包(ui): 输入文件中的字符（+ ASCII/常用标点）
  - extra: 《通用规范汉字表》一级字中，主包未覆盖的部分
  - 字重: Regular(400) + Medium(500)
  - 输出少量 woff2，避免上百个分片请求过慢
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter, load_font, save_font

ROOT = Path(__file__).resolve().parent
DEFAULT_SRC = ROOT / "_src"
DEFAULT_LEVEL1 = ROOT / "_level1.txt"
DEFAULT_OUT = ROOT / "lxgw-wenkai-gb"

WEIGHTS = (
    (400, "LXGWWenKaiGB-Regular.ttf", "regular"),
    (500, "LXGWWenKaiGB-Medium.ttf", "medium"),
)

ASCII_AND_PUNCT = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "·—…‘’“”《》「」『』【】（）〔〕．，、；：？！￥％＃＠＆＊＋－＝＜＞／＼｜～￠￡°℃‰§※"
    + "→←↑↓•﹣–─│℃°"
)


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def collect_chars_from_text(text: str) -> set[str]:
    chars: set[str] = set()
    for ch in text:
        if ord(ch) >= 0x20 and ch not in "\r\n\t":
            chars.add(ch)
    return chars


def load_level1(path: Path) -> set[str]:
    if not path.exists():
        print(f"警告: 找不到一级字表 {path}，extra 将为空", file=sys.stderr)
        return set()
    chars: set[str] = set()
    for ch in read_text(path):
        if "\u4e00" <= ch <= "\u9fff":
            chars.add(ch)
    return chars


def to_unicodes_arg(chars: set[str]) -> str:
    # fontTools accepts U+XXXX or comma-separated codepoints
    cps = sorted(ord(c) for c in chars)
    return ",".join(f"U+{cp:04X}" for cp in cps)


def unicode_range_css(chars: set[str], chunk_size: int = 64) -> str:
    """Compact unicode-range for CSS (merge consecutive where possible)."""
    cps = sorted(ord(c) for c in chars)
    if not cps:
        return ""
    ranges: list[tuple[int, int]] = []
    start = prev = cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        ranges.append((start, prev))
        start = prev = cp
    ranges.append((start, prev))

    parts: list[str] = []
    for lo, hi in ranges:
        if lo == hi:
            parts.append(f"U+{lo:04X}")
        else:
            parts.append(f"U+{lo:04X}-{hi:04X}")
    # Keep CSS reasonably sized; browsers handle long unicode-range fine
    return ", ".join(parts)


def subset_to_woff2(src_ttf: Path, dst_woff2: Path, chars: set[str]) -> None:
    if not chars:
        raise ValueError(f"empty charset for {dst_woff2.name}")
    options = Options()
    options.flavor = "woff2"
    options.with_zopfli = False
    options.desubg = True
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    options.layout_features = ["*"]
    options.glyph_names = False
    options.legacy_kern = True
    options.notdef_outline = True
    options.recalc_bounds = True
    options.recalc_timestamp = False

    font = load_font(str(src_ttf), options)
    subsetter = Subsetter(options=options)
    subsetter.populate(text="".join(sorted(chars)))
    subsetter.subset(font)
    dst_woff2.parent.mkdir(parents=True, exist_ok=True)
    save_font(font, str(dst_woff2), options)
    font.close()


def write_css(out_dir: Path, ui_chars: set[str], extra_chars: set[str]) -> None:
    ui_range = unicode_range_css(ui_chars)
    extra_range = unicode_range_css(extra_chars)
    blocks: list[str] = [
        "/* LXGW WenKai GB — ui(主包) + extra(一级常用字补集)",
        " * 用 build_wenkai_subset.py 重新生成",
        " */",
        "",
    ]
    for weight, _ttf, tag in WEIGHTS:
        blocks.append("@font-face {")
        blocks.append('  font-family: "LXGW WenKai GB";')
        blocks.append("  font-style: normal;")
        blocks.append(f"  font-weight: {weight};")
        blocks.append("  font-display: swap;")
        blocks.append(f"  src: url('./files/lxgw-wenkai-gb-{tag}-ui.woff2') format('woff2');")
        if ui_range:
            blocks.append(f"  unicode-range: {ui_range};")
        blocks.append("}")
        blocks.append("")
        if extra_chars:
            blocks.append("@font-face {")
            blocks.append('  font-family: "LXGW WenKai GB";')
            blocks.append("  font-style: normal;")
            blocks.append(f"  font-weight: {weight};")
            blocks.append("  font-display: swap;")
            blocks.append(f"  src: url('./files/lxgw-wenkai-gb-{tag}-extra.woff2') format('woff2');")
            if extra_range:
                blocks.append(f"  unicode-range: {extra_range};")
            blocks.append("}")
            blocks.append("")
    (out_dir / "index.css").write_text("\n".join(blocks), encoding="utf-8")


def build(main_file: Path, out_dir: Path, level1_path: Path, src_dir: Path) -> None:
    main_chars = collect_chars_from_text(read_text(main_file)) | set(ASCII_AND_PUNCT)
    level1 = load_level1(level1_path)
    extra_chars = (level1 | set(ASCII_AND_PUNCT)) - main_chars
    # Keep ASCII in ui only is enough; strip pure-ascii-only duplicates from extra
    # but keep CJK extras. ASCII already in ui — remove from extra to shrink.
    extra_chars = {c for c in extra_chars if ord(c) >= 0x80}

    print(f"主包用字文件: {main_file}")
    print(f"主包字符数: {len(main_chars)}")
    print(f"一级字表: {len(level1)}")
    print(f"extra 字符数: {len(extra_chars)}")

    files_dir = out_dir / "files"
    if out_dir.exists():
        # Only clean font outputs, keep sibling scripts
        if files_dir.exists():
            for p in files_dir.iterdir():
                if p.is_file():
                    p.unlink()
        for p in out_dir.glob("index.css"):
            p.unlink()
    files_dir.mkdir(parents=True, exist_ok=True)

    for weight, ttf_name, tag in WEIGHTS:
        ttf = src_dir / ttf_name
        if not ttf.exists() or ttf.stat().st_size < 1_000_000:
            raise SystemExit(f"缺少源字体: {ttf}（请放入 Regular/Medium TTF）")
        ui_path = files_dir / f"lxgw-wenkai-gb-{tag}-ui.woff2"
        print(f"生成 {ui_path.name} ...")
        subset_to_woff2(ttf, ui_path, main_chars)
        print(f"  -> {ui_path.stat().st_size / 1024:.1f} KB")
        if extra_chars:
            extra_path = files_dir / f"lxgw-wenkai-gb-{tag}-extra.woff2"
            print(f"生成 {extra_path.name} ...")
            subset_to_woff2(ttf, extra_path, extra_chars)
            print(f"  -> {extra_path.stat().st_size / 1024:.1f} KB")

    write_css(out_dir, main_chars, extra_chars)
    total = sum(p.stat().st_size for p in out_dir.rglob("*") if p.is_file())
    print(f"完成: {out_dir}")
    print(f"总大小: {total / 1024 / 1024:.2f} MB")
    print(f"文件数: {sum(1 for _ in out_dir.rglob('*.woff2'))} 个 woff2 + index.css")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="生成文楷 GB 主包+extra 网页字体")
    parser.add_argument("main_file", type=Path, help="主包用字来源文件（如 qi.html 或字表 txt）")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="输出目录")
    parser.add_argument("--level1", type=Path, default=DEFAULT_LEVEL1, help="一级常用字表")
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC, help="源 TTF 目录")
    args = parser.parse_args(argv)

    if not args.main_file.exists():
        raise SystemExit(f"找不到文件: {args.main_file}")
    build(args.main_file.resolve(), args.out.resolve(), args.level1.resolve(), args.src.resolve())


if __name__ == "__main__":
    main()
