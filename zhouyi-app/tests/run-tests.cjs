/**
 * run-tests.cjs — 核心逻辑自测（Node 直跑，零依赖）
 * 用法: node tests/run-tests.cjs
 * 覆盖：数据完整性 / 抛币概率分布 / 六爻结构 / 本卦变卦闭包 / 卦名约定
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ZY = require('../js/core.js');

const DATA = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'guaci.json'), 'utf8')
);
const idx = ZY.index(DATA);

let passed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failures.push(msg); console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + `（期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}）`);
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* 确定性随机源（mulberry32） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 1. 数据完整性 ---------- */
section('1. 数据完整性（guaci.json 64 卦）');
eq(DATA.length, 64, '共 64 卦');
const ids = DATA.map(e => e.id);
eq(new Set(ids).size, 64, 'id 1..64 无重复');
ok(ids.every((v, i) => v === i + 1), 'id 恰为 1..64（King Wen 序）');
const names = DATA.map(e => e.name);
eq(new Set(names).size, 64, '卦名无重复');
ok(DATA.every(e => Array.isArray(e.yao) && e.yao.length === 6 &&
  e.yao.every(b => b === 0 || b === 1)), 'yao 均为 6 位 0/1 数组');
ok(DATA.every(e => e.guaci && e.guaci.trim().length >= 2), '卦辞非空（短卦辞如 大有「元亨。」为通行本原文）');
ok(DATA.every(e => Array.isArray(e.yaoci) && e.yaoci.length === 6 &&
  e.yaoci.every(t => t.length > 2)), '每卦 6 条爻辞非空');
ok(DATA.every(e => e.xiang && e.xiang.length > 2), '大象辞非空');
ok(DATA.every(e => !/白话|断易|邵雍|傅佩荣/.test(e.guaci + e.xiang + e.yaoci.join(''))),
  '原文不含现代注解污染');

/* 上下卦与八卦表一致（由 yao 拆分推导） */
ok(DATA.every(e => {
  const b = ZY.TRIGRAMS[e.yao.slice(0, 3).join('')];
  const t = ZY.TRIGRAMS[e.yao.slice(3, 6).join('')];
  return b && t && b.name === e.trigram_bottom && t.name === e.trigram_top &&
    b.image === e.image_bottom && t.image === e.image_top;
}), '上下卦字段与八卦表推导一致');

/* 索引覆盖 */
eq(Object.keys(idx.byKey).length, 64, '索引 64 键无冲突');

/* 卦画方向抽查：文件二进制 top-first == yao 反转 */
ok(DATA.every(e => e.bin_topfirst === e.yao.slice().reverse().join('')),
  'bin_topfirst 与 yao（自下而上）互逆');

/* ---------- 2. 抛币概率分布 ---------- */
section('2. 抛币概率（三枚硬币法：6/7/8/9 = 1/8,3/8,3/8,1/8）');
{
  const rng = mulberry32(20260808);
  const N = 60000;
  const counts = { 6: 0, 7: 0, 8: 0, 9: 0 };
  for (let i = 0; i < N; i++) counts[ZY.tossThreeCoins(rng).value]++;
  const expect = { 6: 1 / 8, 7: 3 / 8, 8: 3 / 8, 9: 1 / 8 };
  for (const v of [6, 7, 8, 9]) {
    const got = counts[v] / N;
    ok(Math.abs(got - expect[v]) < 0.02,
      `P(${v})≈${got.toFixed(4)}（期望 ${expect[v].toFixed(4)}，实测 ${counts[v]}/${N}）`);
  }
  console.log(`  实测分布: 6=${counts[6]} 7=${counts[7]} 8=${counts[8]} 9=${counts[9]}`);
}

/* ---------- 2b. valueFromHeads / coins 结构 ---------- */
section('2b. valueFromHeads 与 coins 一致性');
{
  const headsInfo = { 0: 6, 1: 7, 2: 8, 3: 9 };
  for (const h of [0, 1, 2, 3]) {
    const info = ZY.valueFromHeads(h);
    eq(info.value, headsInfo[h], `heads=${h} → value=${headsInfo[h]}`);
    ok(info.yinYang === (h % 2 === 1 ? 1 : 0), `heads=${h} 阴阳正确（7/9 阳、6/8 阴）`);
    ok(info.moving === (h === 0 || h === 3), `heads=${h} 动爻判定正确（0/3 为动）`);
  }
  const rng = mulberry32(7);
  let consistent = true, allCoins3 = true;
  for (let i = 0; i < 500; i++) {
    const r = ZY.tossThreeCoins(rng);
    if (!Array.isArray(r.coins) || r.coins.length !== 3) allCoins3 = false;
    const heads = r.coins.filter(c => c).length;
    if (heads !== r.value - 6) consistent = false;
  }
  ok(allCoins3, 'coins 恒为长度 3 数组');
  ok(consistent, 'coins 正面数 === value - 6（500 次抽查）');
  const castLines = ZY.cast(mulberry32(9));
  ok(castLines.every(l => Array.isArray(l.coins) && l.coins.length === 3 &&
    l.coins.filter(c => c).length === l.value - 6), 'cast() 每爻携带 coins 且一致');
}

/* ---------- 3. 六爻结构 ---------- */
section('3. cast() 结构');
{
  const rng = mulberry32(42);
  const lines = ZY.cast(rng);
  eq(lines.length, 6, '六爻');
  ok(lines.every((l, p) => l.pos === p), 'pos 自下而上 0..5');
  ok(lines.every(l => [6, 7, 8, 9].includes(l.value)), 'value ∈ {6,7,8,9}');
  ok(lines.every(l => ZY.VALUE_INFO[l.value].yinYang === l.yinYang &&
    ZY.VALUE_INFO[l.value].moving === l.moving &&
    ZY.VALUE_INFO[l.value].label === l.label), 'label/阴阳/动爻与 VALUE_INFO 一致');
  ok(lines.every(l => {
    const n = ZY.yaoName(l.pos, l.yinYang);
    return /^(初|上)[六九]$|^[六九][二三四五]$/.test(n);
  }), '爻名格式正确（初九/六二/九三…/上六）');
  ok(ZY.yaoName(0, 1) === '初九' && ZY.yaoName(0, 0) === '初六' &&
     ZY.yaoName(1, 1) === '九二' && ZY.yaoName(5, 0) === '上六', '爻名具体抽查');
}

/* ---------- 4. 本卦/变卦 ---------- */
section('4. 解卦与变卦闭包（64 卦 × 动爻组合全遍历）');
{
  // 每个卦、每种单爻动 + 全动 + 不动
  let checked = 0;
  for (const entry of DATA) {
    const yao = entry.yao.slice();
    const mkLines = (movPos) => yao.map((b, p) => ({
      pos: p, yinYang: b, value: b === 1 ? (movPos.includes(p) ? 9 : 7) : (movPos.includes(p) ? 6 : 8),
      moving: movPos.includes(p), label: ''
    }));

    // 不动：本卦自身
    let res = ZY.resolve(idx, mkLines([]));
    ok(res.hexagram.id === entry.id && res.hasMoving === false, `${entry.name}：六爻安静得本卦`);

    // 单爻动 ×6
    for (let p = 0; p < 6; p++) {
      res = ZY.resolve(idx, mkLines([p]));
      ok(res.hexagram.id === entry.id, `${entry.name}：第${p + 1}爻动本卦仍为自身`);
      ok(res.hasMoving && res.movingPos.length === 1 && res.movingPos[0] === p, `${entry.name}：动爻定位正确`);
      ok(res.variation && res.variation.yao.join('') ===
        ZY.variation(yao, [p]).join(''), `${entry.name}：变卦 yao = 动爻翻转`);
      // 变卦也必须在 64 卦数据内（闭包）
      ok(idx.byKey[res.variation.yao.join('')] != null, `${entry.name}：变卦存在`);
      checked++;
    }

    // 全动：六爻皆变 → 错卦（全取反），必在 64 内
    res = ZY.resolve(idx, mkLines([0, 1, 2, 3, 4, 5]));
    ok(res.variation && res.variation.yao.join('') ===
      yao.map(b => (b === 1 ? 0 : 1)).join(''), `${entry.name}：六爻全动得错卦`);
  }
  console.log(`  共校验 ${checked} 组单爻动 + 64 组全动/不动`);
}

/* ---------- 5. 卦名展示约定 ---------- */
section('5. displayName 约定');
{
  const byName = idx.byName;
  const pure = { 乾: '乾为天', 坤: '坤为地', 坎: '坎为水', 离: '离为火',
                 震: '震为雷', 艮: '艮为山', 巽: '巽为风', 兑: '兑为泽' };
  for (const n of Object.keys(pure)) {
    eq(ZY.displayName(byName[n]), pure[n], `八纯卦 ${n}`);
  }
  eq(ZY.displayName(byName['屯']), '水雷屯', '屯 → 水雷屯');
  eq(ZY.displayName(byName['蒙']), '山水蒙', '蒙 → 山水蒙');
  eq(ZY.displayName(byName['泰']), '地天泰', '泰 → 地天泰');
  eq(ZY.displayName(byName['未济']), '火水未济', '未济 → 火水未济');
}

/* ---------- 汇总 ---------- */
console.log('\n----------------------------------------');
if (failures.length === 0) {
  console.log(`全部通过 ✓  （${passed} 项断言）`);
  process.exit(0);
} else {
  console.error(`失败 ${failures.length} 项 / 通过 ${passed} 项`);
  process.exit(1);
}
