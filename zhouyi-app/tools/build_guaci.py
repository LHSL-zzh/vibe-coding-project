#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_guaci.py — 从公开参考数据源构建 guaci.json（一期数据层）。

数据源: https://github.com/chengjun/iching （data/000000.text ~ 111111.text）
  - 文件名 = 6 位二进制，按「上爻→初爻」书写，1=阳 0=阴
  - 文件内含公版古籍原文：卦辞、象曰、六爻爻辞（现代白话注解不提取，有版权）
提取策略（仅公版古籍文本）:
  卦名 / 卦辞原文 / 大象辞 / 6 条爻辞原文
并做一致性校验:
  - 卦名集合 == 通行本六十四卦名（King Wen 序交叉核对）
  - 爻名（初九/六二…）与二进制阴阳严格对应
  - 每卦 6 爻齐全
输出: data/guaci.json（64 条，含 illustration 占位字段，供二期配图）

用法: uv run python tools/build_guaci.py    （纯标准库，可重复运行）
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/chengjun/iching/master/data/{bits}.text"

# 通行本 King Wen 卦序（交叉校验用，共 64）
KINGWEN = ["乾", "坤", "屯", "蒙", "需", "讼", "师", "比", "小畜", "履", "泰", "否",
           "同人", "大有", "谦", "豫", "随", "蛊", "临", "观", "噬嗑", "贲", "剥", "复",
           "无妄", "大畜", "颐", "大过", "坎", "离", "咸", "恒", "遁", "大壮", "晋", "明夷",
           "家人", "睽", "蹇", "解", "损", "益", "夬", "姤", "萃", "升", "困", "井",
           "革", "鼎", "震", "艮", "渐", "归妹", "丰", "旅", "巽", "兑", "涣", "节",
           "中孚", "小过", "既济", "未济"]

# 八卦（自下而上三爻，1=阳 0=阴）→ 卦象名 / 卦名 / 先天符号
TRIGRAMS = {
    (1, 1, 1): ("天", "乾"),
    (1, 1, 0): ("泽", "兑"),
    (1, 0, 1): ("火", "离"),
    (1, 0, 0): ("雷", "震"),
    (0, 1, 1): ("风", "巽"),
    (0, 1, 0): ("水", "坎"),
    (0, 0, 1): ("山", "艮"),
    (0, 0, 0): ("地", "坤"),
}

POS_NAMES = ["初", "二", "三", "四", "五", "上"]  # 初→上


def yao_name(pos, yang):
    """爻名：初九/六二/九三…/上六。pos 0=初 5=上；yang True=阳。"""
    xy = "九" if yang else "六"
    if pos == 0:
        return f"初{xy}"
    if pos == 5:
        return f"上{xy}"
    return f"{xy}{POS_NAMES[pos]}"


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "build-guaci"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2)


def parse_file(bits, text):
    """返回 dict(卦条目)，提取公版原文。"""
    # 卦名：文件开头 "X卦原文"
    m = re.match(r"(.+?)卦原文", text)
    if not m:
        raise ValueError(f"{bits}: 找不到卦名")
    name = m.group(1).strip()
    head = text[m.end():]

    # 卦辞原文：到第一个 "象曰：" 为止（乾/坤等有 "用九/用六" 后续段，暂只取主卦辞）
    guaci = head.split("象曰：", 1)[0].strip()
    # 去掉 "卦辞" 段可能残留的 "X。" 重复引导
    guaci = re.sub(r"^" + re.escape(name) + r"[。．]", "", guaci).strip()

    # 大象辞：第一个 象曰： 之后到下一个爻辞段或白话段
    rest = head.split("象曰：", 1)[1] if "象曰：" in head else ""
    xiang = rest.split("白话文解释", 1)[0].strip()
    xiang = xiang.split("初六爻辞", 1)[0].strip()
    xiang = xiang.split("初九爻辞", 1)[0].strip()

    # 六爻爻辞：按 爻名+爻辞 分段（每爻原文截止其 "象曰："）
    yao_texts = []
    for pos in range(6):
        yang = int(bits[5 - pos]) == 1  # bits 上→初，反转取初→上
        mark = yao_name(pos, yang) + "爻辞"
        if mark not in text:
            raise ValueError(f"{bits} {name}: 缺 {mark}")
        seg = text.split(mark, 1)[1]
        seg = seg.split("象曰：", 1)[0]
        seg = re.sub(r"^" + re.escape(yao_name(pos, yang)) + r"[。．]", "", seg).strip()
        seg = seg.split("白话文解释", 1)[0].strip()
        if not seg:
            raise ValueError(f"{bits} {name}: {mark} 内容为空")
        yao_texts.append(seg)

    # 二进制（自下而上，初→上）与上下卦
    yaos = [int(b) for b in bits[::-1]]  # 上→初 反转成 初→上
    bot = TRIGRAMS[tuple(yaos[0:3])]
    top = TRIGRAMS[tuple(yaos[3:6])]

    return {
        "name": name,
        "bin_topfirst": bits,          # 文件原始书写（上→初）
        "yao": yaos,                   # 自下而上 1=阳 0=阴
        "trigram_bottom": bot[1],      # 内卦卦名
        "trigram_top": top[1],         # 外卦卦名
        "image_bottom": bot[0],        # 内卦象（天/地/雷/风/水/火/山/泽）
        "image_top": top[0],           # 外卦象
        "guaci": guaci,                # 卦辞原文（公版）
        "xiang": xiang,                # 大象辞（公版）
        "yaoci": yao_texts,            # 6 条爻辞原文（初→上）
        "baihua": "",                  # 二期填充：白话翻译（隐藏步骤）
        "keywords": [],                # 二期填充：视觉关键词（构图用）
        "illustration": {              # 二期填充：古籍线画资源
            "img": "",                 #   图路径（如 assets/ill/01-qian.svg）
            "desc": "",                #   图内容描述（构图依据）
        },
    }


def main():
    out_dir = Path(__file__).resolve().parent.parent / "data"
    out_dir.mkdir(exist_ok=True)

    entries, errors = [], []
    for n in range(64):
        bits = f"{n:06b}"
        try:
            text = None
            for cand in ([bits] if bits != "101111" else ["101111", "10111"]):
                # 数据源笔误：101111.text 缺失，实为 10111.text（大有卦）
                try:
                    text = fetch(RAW.format(bits=cand))
                    break
                except Exception:
                    continue
            if text is None:
                raise ValueError("所有候选文件名均 404")
            entries.append(parse_file(bits, text))
        except Exception as e:
            errors.append(f"{bits}: {e}")
        time.sleep(0.15)

    if errors:
        print("!! 解析错误:")
        for e in errors:
            print("  ", e)
        sys.exit(1)

    # 校验 1: 卦名集合 == 通行本
    names = [e["name"] for e in entries]
    if sorted(names) != sorted(KINGWEN):
        print("!! 卦名集合与通行本不一致")
        print("   多出:", set(names) - set(KINGWEN))
        print("   缺少:", set(KINGWEN) - set(names))
        sys.exit(1)

    # 校验 2: King Wen 序号 + 重复检查
    kw_index = {n: i for i, n in enumerate(KINGWEN)}
    for e in entries:
        e["id"] = kw_index[e["name"]] + 1  # 第几卦
        assert len(e["yaoci"]) == 6, e["name"]

    # 排序输出：按二进制（与卦画自然序一致）还是按 King Wen？取 King Wen 序更常规
    entries.sort(key=lambda e: e["id"])

    out = out_dir / "guaci.json"
    out.write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: 写入 {out}  （{len(entries)} 卦）")
    print("抽查（id 卦名 上下卦 卦辞前12字）:")
    for e in entries[:6] + entries[63:]:
        print(f"  {e['id']:>2} {e['name']:<3} {e['image_top']}{e['image_bottom']} {e['guaci'][:12]}")


if __name__ == "__main__":
    main()
