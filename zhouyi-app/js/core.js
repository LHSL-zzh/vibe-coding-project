/**
 * core.js — 周易起卦核心逻辑（纯逻辑，零 DOM / 零依赖）
 *
 * 约定：
 *   - 六爻数组 yao[] 一律【自下而上】(初爻→上爻)，元素 1=阳 0=阴
 *   - 抛币：三枚硬币法（正统六爻），每枚 正=3 反=2，
 *     三枚合计 6/7/8/9 → 老阴/少阳/少阴/老阳；6、9 为动爻
 *   - 六爻起卦结果的数组元素统一 { pos, yinYang, value, label, moving }
 *
 * 浏览器与 Node 双端可用（window.ZY / require('core.js')）。
 */
(function (global) {
  'use strict';

  var ZY = { VERSION: '0.1.0' };

  /* 八卦表：键 = 自下而上三爻（1阳0阴），值 = { 卦名, 卦象 } */
  ZY.TRIGRAMS = {
    '111': { name: '乾', image: '天' },
    '110': { name: '兑', image: '泽' },
    '101': { name: '离', image: '火' },
    '100': { name: '震', image: '雷' },
    '011': { name: '巽', image: '风' },
    '010': { name: '坎', image: '水' },
    '001': { name: '艮', image: '山' },
    '000': { name: '坤', image: '地' }
  };

  /* 爻值 → 含义 */
  ZY.VALUE_INFO = {
    6: { label: '老阴', yinYang: 0, moving: true },
    7: { label: '少阳', yinYang: 1, moving: false },
    8: { label: '少阴', yinYang: 0, moving: false },
    9: { label: '老阳', yinYang: 1, moving: true }
  };

  ZY.POS_NAMES = ['初', '二', '三', '四', '五', '上']; // 初→上

  /**
   * 爻名：初九/六二/九三/六四/九五/上六 …
   * @param {number} pos 0=初爻 … 5=上爻
   * @param {number} yinYang 1=阳 0=阴
   */
  ZY.yaoName = function (pos, yinYang) {
    var xy = yinYang === 1 ? '九' : '六';
    if (pos === 0) return '初' + xy;
    if (pos === 5) return '上' + xy;
    return xy + ZY.POS_NAMES[pos];
  };

  /** 抛一枚硬币：正面(阳面)概率 0.5。返回 true=正(字面朝上) */
  ZY.tossCoin = function (rng) {
    rng = rng || Math.random;
    return rng() < 0.5;
  };

  /**
   * 由正面数(0..3)求爻值 → 三枚和 = 6 + 正面数
   * @param {number} heads 三枚硬币中正面(字)的数量 0..3
   * @returns {{value:number,label:string,yinYang:number,moving:boolean}}
   */
  ZY.valueFromHeads = function (heads) {
    var value = 6 + heads;
    return {
      value: value,
      label: ZY.VALUE_INFO[value].label,
      yinYang: ZY.VALUE_INFO[value].yinYang,
      moving: ZY.VALUE_INFO[value].moving
    };
  };

  /**
   * 三枚硬币抛一次 → 一爻。返回 { value, label, yinYang, moving, coins }
   * coins: 每枚硬币的正反数组（true=正/字面，自左向右）
   */
  ZY.tossThreeCoins = function (rng) {
    var coins = [];
    for (var i = 0; i < 3; i++) coins.push(ZY.tossCoin(rng));
    var heads = coins.filter(function (c) { return c; }).length;
    var info = ZY.valueFromHeads(heads);
    info.coins = coins;
    return info;
  };

  /**
   * 起一卦：自下而上抛 6 次。
   * @param {function} [rng] 随机源（默认 Math.random），可注入做测试
   * @returns {Array} 6 爻数组，元素 { pos, yinYang, value, label, moving, coins }
   */
  ZY.cast = function (rng) {
    var lines = [];
    for (var pos = 0; pos < 6; pos++) {
      var r = ZY.tossThreeCoins(rng);
      lines.push({
        pos: pos,
        yinYang: r.yinYang,
        value: r.value,
        label: r.label,
        moving: r.moving,
        coins: r.coins
      });
    }
    return lines;
  };

  /** 六爻(自下而上) → "010001" 键 */
  ZY.key = function (yao) {
    return yao.join('');
  };

  /** 六爻数组(元素为 0/1 或含 yinYang 的对象) → 上下卦拆分 */
  ZY.trigrams = function (yao) {
    var b = yao.map(function (y) {
      return typeof y === 'object' ? y.yinYang : y;
    });
    return {
      bottom: ZY.TRIGRAMS[b.slice(0, 3).join('')],
      top: ZY.TRIGRAMS[b.slice(3, 6).join('')]
    };
  };

  /**
   * 动爻翻转 → 变卦六爻（6 老阴→阳 1；9 老阳→阴 0；7/8 不变）
   * @param {Array} yao 0/1 数组（自下而上）
   * @param {Array} [moving] 动爻位置数组（缺省则全不动）
   */
  ZY.variation = function (yao, moving) {
    var out = yao.slice();
    (moving || []).forEach(function (pos) {
      out[pos] = out[pos] === 1 ? 0 : 1;
    });
    return out;
  };

  /**
   * 卦条目展示名：八纯卦「乾为天/坎为水」，其余「水雷屯/火天大有」（上象+下象+名）
   */
  ZY.displayName = function (entry) {
    var t = ZY.trigrams(entry.yao);
    if (t.bottom.name === t.top.name) return entry.name + '为' + t.top.image;
    return t.top.image + t.bottom.image + entry.name;
  };

  /** 数据建索引：按 yao 键 / id / 卦名 均可查 */
  ZY.index = function (data) {
    var byKey = {}, byId = {}, byName = {};
    data.forEach(function (e) {
      byKey[e.yao.join('')] = e;
      byId[e.id] = e;
      byName[e.name] = e;
    });
    return { data: data, byKey: byKey, byId: byId, byName: byName };
  };

  /**
   * 由 0/1 六爻数组取卦条目（找不到返回 null）
   */
  ZY.lookup = function (idx, yao) {
    return idx.byKey[ZY.key(yao)] || null;
  };

  /**
   * 完整解卦：
   * @param {Object} idx ZY.index() 的结果
   * @param {Array} lines ZY.cast() 的结果
   * @returns {Object} { hexagram, variation, movingPos, movingCount, hasMoving }
   */
  ZY.resolve = function (idx, lines) {
    var yao = lines.map(function (l) { return l.yinYang; });
    var moving = [];
    lines.forEach(function (l) { if (l.moving) moving.push(l.pos); });
    var hexagram = ZY.lookup(idx, yao);
    var result = {
      hexagram: hexagram,
      movingPos: moving,
      movingCount: moving.length,
      hasMoving: moving.length > 0
    };
    if (result.hasMoving) {
      var varYao = ZY.variation(yao, moving);
      result.variation = ZY.lookup(idx, varYao);
      result.variationYao = varYao;
    } else {
      result.variation = null;
    }
    return result;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ZY;
  if (typeof window !== 'undefined') window.ZY = ZY;
})(typeof window !== 'undefined' ? window : globalThis);
