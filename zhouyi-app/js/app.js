/**
 * app.js — 周易起卦 界面编排层
 * 依赖：js/core.js (window.ZY) + data/guaci.json
 *
 * 两种起卦方式：
 *   - 自动模拟：电脑随机三枚硬币（可注入 rng）
 *   - 手动掷币：用户掷真硬币，逐爻点选每枚「字(正)/背(反)」
 *
 * 二期接入点（M9 卦辞古籍线画）：
 *   - fillIllustration(entry, slotEl) —— 渲染插图；当前为占位提示，
 *     二期改为按 entry.illustration.img 加载 <img>/<svg>
 */
(function () {
  'use strict';

  var ZY = window.ZY;
  var HISTORY_KEY = 'zy_history_v1';
  var HISTORY_MAX = 12;

  var cfg = {
    revealMs: 620,      // 自动模式：每爻揭晓间隔
    manualDoneMs: 850,  // 手动模式：本爻完成后自动进入下一爻的停顿
    manualCoinsPerLine: 3
  };

  var state = {
    idx: null,
    casting: false,
    mode: 'auto',            // 'auto' | 'manual'
    manual: { pos: 0, coins: [], lines: [] }
  };

  var els = {};

  /* ================= 工具 ================= */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch (e) { return []; }
  }

  function saveHistory(arr) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, HISTORY_MAX))); }
    catch (e) { /* 隐私模式等场景静默失败 */ }
  }

  /* ================= 3D 硬币 DOM ================= */

  /**
   * 生成一枚 3D 硬币元素（含 字/背 两面）
   * @param {boolean} faceUp 朝上面是否为正（字）
   * @param {boolean} flip 是否播放揭晓翻转动画
   * @returns {HTMLElement} .coin3d
   */
  function buildCoin(faceUp, flip) {
    var c = el('span', 'coin3d' + (flip ? ' flip' : '') + (faceUp ? '' : ' show-back'));
    var inner = el('span', 'coin-inner');
    inner.appendChild(el('span', 'face front', '字'));
    inner.appendChild(el('span', 'face back', '背'));
    c.appendChild(inner);
    return c;
  }

  /**
   * 揭晓一行：三枚硬币 + 爻名标签，追加进 #coin-row
   * @param {Object} line { pos, yinYang, value, label, moving, coins }
   */
  function appendRevealLine(line) {
    var row = el('div', 'line-reveal');
    (line.coins || []).forEach(function (up, i) {
      var coin = buildCoin(up, true);
      if (i > 0) coin.style.animationDelay = (i * 90) + 'ms';
      row.appendChild(coin);
    });
    var tag = el('span', 'line-tag', ZY.yaoName(line.pos, line.yinYang) + ' · ' + line.label);
    if (line.moving) {
      tag.appendChild(el('b', 'tag-moving', line.value === 9 ? ' ○ 动' : ' ● 动'));
    }
    row.appendChild(tag);
    els.coinRow.appendChild(row);
  }

  /* ================= 结果卡片 ================= */

  /** 渲染六爻卦画（自上而下展示），动爻朱砂 + 标记 */
  function renderHexFigure(container, lines) {
    container.textContent = '';
    for (var i = 5; i >= 0; i--) {
      var l = lines[i];
      var row = el('span', 'hex-line ' + (l.yinYang === 1 ? 'yang' : 'yin'));
      if (l.moving) row.classList.add('moving');
      row.appendChild(el('i', 'bar'));
      if (l.yinYang === 0) row.appendChild(el('i', 'bar'));
      if (l.moving) {
        row.appendChild(el('b', 'move-mark', l.value === 9 ? '○' : '●'));
      }
      container.appendChild(row);
    }
  }

  function metaText(entry) {
    return '第' + entry.id + '卦 · ' + entry.name + '卦 · ' +
      entry.image_top + '上' + entry.image_bottom + '下';
  }

  /** 填充卦卡片（本卦/变卦通用），prefix: main / var */
  function fillCard(prefix, entry, lines, movingPos) {
    $('fig-' + prefix).textContent = '';
    renderHexFigure($('fig-' + prefix), lines);
    $('name-' + prefix).textContent = ZY.displayName(entry);
    $('meta-' + prefix).textContent = metaText(entry);

    $('guaci-' + prefix).textContent = entry.guaci;
    if ($('xiang-' + prefix)) {
      $('xiang-' + prefix).textContent = entry.xiang ? '象曰：' + entry.xiang : '';
    }
    if ($('yaoci-' + prefix)) {
      var ol = $('yaoci-' + prefix);
      ol.textContent = '';
      entry.yaoci.forEach(function (text, pos) {
        var li = el('li');
        var moving = movingPos.indexOf(pos) !== -1;
        if (moving) {
          li.classList.add('moving');
          li.appendChild(el('span', 'y-mark', lines[pos].value === 9 ? '○' : '●'));
        }
        li.appendChild(el('span', 'y-name', ZY.yaoName(pos, lines[pos].yinYang) + '：'));
        li.appendChild(document.createTextNode(text));
        if (moving) li.appendChild(el('span', 'y-mark', '（此爻动）'));
        ol.appendChild(li);
      });
    }
    // 二期插图槽位（M9 接入点）
    fillIllustration(entry, $('ill-' + prefix), $('ill-cap-' + prefix));
  }

  /** 二期接入点：卦辞古籍线画。illustration 数据就绪前槽位隐藏。 */
  function fillIllustration(entry, slot, caption) {
    if (!slot) return;
    var ill = entry.illustration || {};
    if (ill.img) {
      slot.hidden = false;
      var holder = slot.querySelector('.ill-placeholder');
      if (holder) holder.textContent = '';
      var img = document.createElement('img');
      img.src = ill.img;
      img.alt = entry.name + '卦 古籍线画（' + (ill.desc || '') + '）';
      img.style.maxWidth = '100%';
      slot.appendChild(img);
      if (caption) caption.textContent = '配图：' + (ill.desc || '');
    } else {
      slot.hidden = true;
    }
  }

  /** 渲染完整结果（自动/手动共用收尾） */
  function renderResult(res, lines, animate) {
    var main = res.hexagram;
    fillCard('main', main, lines, res.movingPos);
    var tagMain = res.hasMoving
      ? '动' + res.movingPos.map(function (p) { return ZY.yaoName(p, lines[p].yinYang); }).join('、')
      : '六爻安静';
    var tagEl = $('card-main').querySelector('.tag');
    tagEl.textContent = tagMain;
    $('card-main').hidden = false;

    var cardVar = $('card-var');
    if (res.hasMoving && res.variation) {
      var varLines = res.variationYao.map(function (b, p) {
        return { pos: p, yinYang: b, value: lines[p].value, label: lines[p].label, moving: false, coins: null };
      });
      fillCard('var', res.variation, varLines, []);
      $('card-var').querySelector('.tag').textContent = '变卦';
      $('note-var').textContent =
        '本卦 ' + ZY.displayName(main) + ' 中' + res.movingCount + ' 爻发动（' +
        res.movingPos.map(function (p) { return ZY.yaoName(p, lines[p].yinYang); }).join('、') +
        '），阴阳互变而成此变卦。';
      cardVar.hidden = false;
      $('card-var').scrollIntoView({ behavior: animate ? 'smooth' : 'auto', block: 'nearest' });
    } else {
      cardVar.hidden = true;
    }
    $('result').hidden = false;
  }

  /* ================= 起卦流程 ================= */

  function setStatus(msg) { els.status.textContent = msg || ''; }

  function clearBoard() {
    $('result').hidden = true;
    els.coinRow.textContent = '';
    setStatus('');
  }

  function lockControls(locked) {
    els.btn.disabled = locked;
    els.btn.textContent = locked ? '起卦中…' : '再 起 一 卦';
    els.modeAuto.disabled = locked;
    els.modeManual.disabled = locked;
  }

  /** 共同收尾：解卦 → 渲染 → 历史 → 滚动 */
  function finish(lines) {
    state.casting = false;
    lockControls(false);
    $('manual-panel').hidden = true;
    setStatus('');

    var res = ZY.resolve(state.idx, lines);
    renderResult(res, lines, true);
    pushHistory(res, lines);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** 模式提示文案 */
  var MODE_HINTS = {
    auto: '点击「起卦」：电脑模拟三枚硬币，逐爻揭晓',
    manual: '请自备三枚硬币（或铜钱），掷出后点选每枚的朝上面：字（正）计 3、背（反）计 2'
  };

  function updateModeHint() {
    els.modeHint.textContent = MODE_HINTS[state.mode] || '';
  }

  /* ----- 自动模式 ----- */
  function autoFlow() {
    var lines = ZY.cast();
    var reveal = function (pos) {
      if (pos >= 6) { finish(lines); return; }
      var l = lines[pos];
      setStatus('第 ' + (pos + 1) + ' 爻 · ' + ZY.yaoName(l.pos, l.yinYang) + '：' + l.label);
      appendRevealLine(l);
      setTimeout(function () { reveal(pos + 1); }, cfg.revealMs);
    };
    reveal(0);
  }

  /* ----- 手动模式 ----- */
  function manualResetLine() {
    state.manual.coins = [null, null, null];
    els.manualResult.textContent = '';
    els.manualResult.classList.remove('done');
    renderManualCoins();
  }

  function manualSetCoin(i, up) {
    // up: true=字(正) false=背(反)
    state.manual.coins[i] = up;
    var btn = els.manualCoinBtns[i];
    btn.classList.toggle('show-back', up === false);
    btn.classList.remove('unset');
    btn.querySelector('.mc-side').textContent = up ? '字 · 正' : '背 · 反';
    if (state.manual.coins.every(function (c) { return c !== null; })) {
      completeManualLine();
    }
  }

  /** 三枚都已点选 → 计算本爻并入账；停顿后进入下一爻 */
  function completeManualLine() {
    var heads = state.manual.coins.filter(function (c) { return c; }).length;
    var info = ZY.valueFromHeads(heads);
    var line = {
      pos: state.manual.pos,
      yinYang: info.yinYang,
      value: info.value,
      label: info.label,
      moving: info.moving,
      coins: state.manual.coins.slice()
    };
    state.manual.lines.push(line);

    els.manualCoinBtns.forEach(function (b) { b.disabled = true; });
    els.manualReset.disabled = true;
    els.manualResult.classList.add('done');
    els.manualResult.textContent =
      ZY.yaoName(line.pos, line.yinYang) + ' · ' + line.label +
      (line.moving ? (line.value === 9 ? ' ○（动）' : ' ●（动）') : '');
    setStatus('第 ' + (line.pos + 1) + ' 爻：' + ZY.yaoName(line.pos, line.yinYang) + ' · ' + line.label);
    appendRevealLine(line);

    var next = state.manual.pos + 1;
    var goNext = function () {
      if (next >= 6) { finish(state.manual.lines); return; }
      beginManualLine(next);
    };
    if (cfg.manualDoneMs > 0) {
      setTimeout(goNext, cfg.manualDoneMs);
    } else {
      goNext();
    }
  }

  /** 进入某爻：注入三枚点选币 */
  function beginManualLine(pos) {
    state.manual.pos = pos;
    state.manual.coins = [null, null, null];
    $('manual-panel').hidden = false;
    $('stage').hidden = false;
    $('manual-line-no').textContent = pos + 1;
    $('manual-line-name').textContent = ZY.POS_NAMES[pos] + '爻';
    els.manualResult.textContent = '';
    els.manualResult.classList.remove('done');
    els.manualReset.disabled = false;
    renderManualCoins();
  }

  function renderManualCoins() {
    els.manualCoinsBox.textContent = '';
    els.manualCoinBtns = [];
    for (var i = 0; i < cfg.manualCoinsPerLine; i++) {
      (function (idx) {
        var btn = el('button', 'manual-coin unset');
        btn.type = 'button';
        btn.setAttribute('data-i', idx);
        btn.appendChild(buildCoin(true, false));   // 默认展示正面，翻转由 show-back 控制
        var lab = el('span', 'mc-label', '第' + (idx + 1) + '枚：');
        lab.appendChild(el('span', 'mc-side', '待选'));
        btn.appendChild(lab);
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          // 循环：待选 → 字(正) → 背(反) → 字 …
          var cur = state.manual.coins[idx];
          var next = (cur === null) ? true : !cur;
          manualSetCoin(idx, next);
        });
        els.manualCoinsBox.appendChild(btn);
        els.manualCoinBtns.push(btn);
      })(i);
    }
  }

  function manualFlow() {
    state.manual.lines = [];
    beginManualLine(0);
  }

  /* ----- 入口 ----- */
  function castFlow() {
    if (state.casting || !state.idx) return;
    state.casting = true;
    lockControls(true);
    clearBoard();
    $('stage').hidden = false;
    if (state.mode === 'manual') {
      manualFlow();
    } else {
      autoFlow();
    }
  }

  /* ================= 历史记录 ================= */

  function pushHistory(res, lines) {
    var list = loadHistory();
    list.unshift({
      ts: Date.now(),
      name: res.hexagram.name,
      display: ZY.displayName(res.hexagram),
      id: res.hexagram.id,
      values: lines.map(function (l) { return l.value; }),
      movingPos: res.movingPos,
      varName: res.variation ? ZY.displayName(res.variation) : ''
    });
    saveHistory(list);
    renderHistory();
  }

  function renderHistory() {
    var list = loadHistory();
    els.histEmpty.hidden = list.length > 0;
    els.histList.textContent = '';
    list.forEach(function (h) {
      var li = el('li');
      li.title = '点击回看 ' + h.display;

      var mini = el('span', 'h-mini');
      var lines = h.values.map(function (v) { return { yinYang: v >= 7 ? 1 : 0, value: v }; });
      for (var r = 5; r >= 0; r--) {
        mini.appendChild(el('i', (lines[r].yinYang === 1 ? '' : 'yin') +
          (h.movingPos.indexOf(r) !== -1 ? ' mov' : '')));
      }
      li.appendChild(mini);

      var main = el('span', 'h-main');
      main.appendChild(el('span', 'h-name', h.display + (h.varName ? ' → ' + h.varName : '')));
      main.appendChild(document.createElement('br'));
      main.appendChild(el('span', 'h-time', fmtTime(h.ts)));
      li.appendChild(main);

      li.addEventListener('click', function () { replay(h); });
      els.histList.appendChild(li);
    });
  }

  /** 从历史记录回看（无动画直接渲染） */
  function replay(h) {
    if (state.casting || !state.idx) return;
    var lines = h.values.map(function (v, pos) {
      var info = ZY.VALUE_INFO[v];
      return { pos: pos, yinYang: info.yinYang, value: v, label: info.label, moving: info.moving, coins: null };
    });
    var res = ZY.resolve(state.idx, lines);
    clearBoard();
    $('manual-panel').hidden = true;
    $('stage').hidden = true;
    renderResult(res, lines, false);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ================= 初始化 ================= */

  function cacheEls() {
    els.btn = $('btn-cast');
    els.status = $('cast-status');
    els.modeHint = $('mode-hint');
    els.modeAuto = $('mode-auto');
    els.modeManual = $('mode-manual');
    els.coinRow = $('coin-row');
    els.manualPanel = $('manual-panel');
    els.manualCoinsBox = $('manual-coins');
    els.manualResult = $('manual-result');
    els.manualReset = $('manual-reset');
    els.histList = $('history-list');
    els.histEmpty = $('history-empty');
  }

  function init() {
    cacheEls();
    els.btn.addEventListener('click', castFlow);
    els.manualReset.addEventListener('click', manualResetLine);

    [els.modeAuto, els.modeManual].forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) {
          state.mode = radio.value;
          updateModeHint();
        }
      });
    });
    updateModeHint();

    fetch('data/guaci.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.idx = ZY.index(data);
        renderHistory();
      })
      .catch(function (err) {
        console.error('加载 guaci.json 失败:', err);
        $('load-error').hidden = false;
        els.btn.disabled = true;
      });

    // 自动化测试/调试钩子
    window.__app = {
      state: state,
      cfg: cfg,
      replay: replay,
      castOnce: function () { return ZY.cast(); },
      debugResolve: function (values) {
        var lines = values.map(function (v, pos) {
          var info = ZY.VALUE_INFO[v];
          return { pos: pos, yinYang: info.yinYang, value: v, label: info.label, moving: info.moving, coins: null };
        });
        return ZY.resolve(state.idx, lines);
      },
      /** 手动模式全流程驱动：faces = 6×3 的 true(字)/false(背) 矩阵。
       *  走真实代码路径（manualSetCoin → completeManualLine → finish）。
       *  需 cfg.manualDoneMs=0 时同步完成。返回结果摘要。 */
      debugManualFaces: function (faces) {
        if (!state.idx) return { error: 'data not loaded' };
        if (!state.casting) {
          // 等价于点「起卦」+ 切手动模式
          state.mode = 'manual';
          els.modeManual.checked = true;
          castFlow();
        }
        faces.forEach(function (lineFaces, pos) {
          if (state.manual.pos !== pos) beginManualLine(pos);
          lineFaces.forEach(function (up, i) { manualSetCoin(i, up); });
        });
        if (!state.casting) {
          var res = ZY.resolve(state.idx, state.manual.lines);
          return {
            done: true,
            hexagram: ZY.displayName(res.hexagram),
            moving: res.movingPos.map(function (p) { return ZY.yaoName(p, state.manual.lines[p].yinYang); }),
            variation: res.variation ? ZY.displayName(res.variation) : null
          };
        }
        return { done: false, pos: state.manual.pos };
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
