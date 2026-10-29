/*
 * 党史刷题 · 交互层
 * M1 选择题 / M2 判断题 / M3 简答题共用一套刷题引擎
 */
(function () {
  'use strict';

  var D = window.DS100;
  var STORE_KEY = 'ds100.v2';
  var LEGACY_KEY = 'ds100.v1';
  var MODS = ['choice', 'judge', 'short', 'current'];

  var BANKS = {
    choice: {
      key: 'choice',
      label: '选择题',
      kind: 'choice',
      chapters: D.CHAPTERS,
      questions: D.QUESTIONS
    },
    judge: {
      key: 'judge',
      label: '判断题',
      kind: 'judge',
      chapters: D.JUDGE_CHAPTERS,
      questions: D.JUDGE_QUESTIONS
    },
    short: {
      key: 'short',
      label: '简答题',
      kind: 'short',
      chapters: D.SHORT_CHAPTERS,
      questions: D.SHORT_QUESTIONS
    },
    current: {
      key: 'current',
      label: '时政专题',
      kind: 'choice',
      chapters: D.CURRENT_CHAPTERS,
      questions: D.CURRENT_QUESTIONS
    }
  };

  var $ = function (sel) { return document.querySelector(sel); };

  var el = {
    chapters: $('#chapters'),
    qIndex: $('#q-index'),
    qType: $('#q-type'),
    qChapter: $('#q-chapter'),
    stem: $('#stem'),
    options: $('#options'),
    shortBody: $('#short-body'),
    btnHint: $('#btn-hint'),
    hintLabel: $('#hint-label'),
    recallTip: $('#recall-tip'),
    hintChips: $('#hint-chips'),
    answerBox: $('#answer-box'),
    answerPoints: $('#answer-points'),
    answerNote: $('#answer-note'),
    assess: $('#assess'),
    assessBtns: $('#assess-btns'),
    analysis: $('#analysis'),
    card: $('#card'),
    empty: $('#empty'),
    btnSubmit: $('#btn-submit'),
    btnNext: $('#btn-next'),
    btnPrev: $('#btn-prev'),
    btnStar: $('#btn-star'),
    btnTheme: $('#btn-theme'),
    themeLabel: $('#theme-label'),
    btnReset: $('#btn-reset'),
    btnSheet: $('#btn-sheet'),
    btnCloseSheet: $('#btn-close-sheet'),
    btnEmptyBack: $('#btn-empty-back'),
    mask: $('#mask'),
    sheet: $('#sheet'),
    sheetGrid: $('#sheet-grid'),
    sheetSub: $('#sheet-sub'),
    ring: $('#ring'),
    ringNum: $('#ring-num'),
    progCap: $('#prog-cap'),
    miniStats: $('#mini-stats'),
    stLabels: [$('#st-label-1'), $('#st-label-2'), $('#st-label-3')],
    stCorrect: $('#st-correct'),
    stWrong: $('#st-wrong'),
    stRemain: $('#st-remain'),
    modeSeg: $('#mode-seg'),
    kbdHint: $('#kbd-hint'),
    scrub: $('#scrub'),
    scrubPos: $('#scrub-pos'),
    scrubTotal: $('#scrub-total'),
    scrubTrack: $('#scrub-track'),
    scrubHead: $('#scrub-head'),
    scrubLegend: $('#scrub-legend'),
    sheetLegend: $('#sheet-legend'),
    toast: $('#toast')
  };

  function newModState() {
    return { scope: 'all', mode: 'order', order: [], pos: 0, picked: [], revealed: false, hintFor: null, assessing: false };
  }

  var state = {
    mod: 'choice',
    records: {},
    stars: { choice: [], judge: [], short: [], current: [] },
    theme: 'light'
  };

  var modState = { choice: newModState(), judge: newModState(), short: newModState(), current: newModState() };
  var S = modState.choice;
  var B = BANKS.choice;

  var ICON_CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4.5 12.5l5.2 5L20 6.6" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_CROSS = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>';

  /* ---------------- 持久化 ---------------- */

  function normalizeStars(raw) {
    var out = {};
    MODS.forEach(function (k) { out[k] = []; });
    if (Array.isArray(raw)) {
      out.choice = raw;
      return out;
    }
    if (raw && typeof raw === 'object') {
      MODS.forEach(function (k) {
        if (Array.isArray(raw[k])) out[k] = raw[k];
      });
    }
    return out;
  }

  function migrate(raw) {
    var data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (data.version === 2) return data;

    // v1：records 以题号直存、stars 为数组，仅含选择题
    var records = {};
    Object.keys(data.records || {}).forEach(function (k) {
      records['choice:' + k] = data.records[k];
    });
    return {
      version: 2,
      mod: 'choice',
      records: records,
      stars: { choice: Array.isArray(data.stars) ? data.stars : [], judge: [], short: [] },
      theme: data.theme === 'dark' ? 'dark' : 'light',
      modes: { choice: data.mode === 'random' ? 'random' : 'order' }
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      var data = migrate(raw);
      if (!data) return;

      state.records = data.records && typeof data.records === 'object' ? data.records : {};
      state.stars = normalizeStars(data.stars);
      state.theme = data.theme === 'dark' ? 'dark' : 'light';
      state.mod = MODS.indexOf(data.mod) > -1 ? data.mod : 'choice';

      if (data.modes) {
        MODS.forEach(function (k) {
          if (data.modes[k] === 'random') modState[k].mode = 'random';
        });
      }
      if (data.positions) {
        MODS.forEach(function (k) {
          var p = data.positions[k];
          if (p && typeof p.pos === 'number') modState[k].pos = p.pos;
          if (p && typeof p.scope === 'string') modState[k].scope = p.scope;
        });
      }
    } catch (e) { /* 忽略损坏数据 */ }
  }

  function save() {
    try {
      var modes = {};
      var positions = {};
      MODS.forEach(function (k) {
        modes[k] = modState[k].mode;
        positions[k] = { pos: modState[k].pos, scope: modState[k].scope };
      });
      localStorage.setItem(STORE_KEY, JSON.stringify({
        version: 2,
        mod: state.mod,
        records: state.records,
        stars: state.stars,
        theme: state.theme,
        modes: modes,
        positions: positions
      }));
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  /* ---------------- 记录工具 ---------------- */

  function recKey(id) { return state.mod + ':' + id; }

  function recOf(q) { return state.records[recKey(q.id)]; }

  function stars() { return state.stars[state.mod] || (state.stars[state.mod] = []); }

  function answered(rec) {
    if (!rec) return false;
    if (B.kind === 'short') return !!rec.level;
    return !!(rec.picked && rec.picked.length);
  }

  function isPass(rec) {
    if (!rec) return false;
    if (B.kind === 'short') return rec.level === 'known';
    return rec.correct === true;
  }

  function moduleRecords() {
    var out = {};
    B.questions.forEach(function (q) {
      var r = state.records[recKey(q.id)];
      if (r) out[q.id] = r;
    });
    return out;
  }

  function optionsFor(q) {
    if (q.type === 'judge') {
      return [
        { letter: 'A', text: '正确', icon: 'check' },
        { letter: 'B', text: '错误', icon: 'cross' }
      ];
    }
    return q.options.map(function (text, i) {
      return { letter: D.LETTERS[i], text: text, icon: D.LETTERS[i] };
    });
  }

  /* ---------------- 队列 ---------------- */

  function wrongIds() {
    return B.questions.filter(function (q) {
      var r = recOf(q);
      return answered(r) && !isPass(r);
    }).map(function (q) { return q.id; });
  }

  function buildQueue() {
    var prevId = S.order[S.pos];
    var list;
    if (S.scope === 'wrong') {
      var wset = wrongIds();
      list = B.questions.filter(function (q) { return wset.indexOf(q.id) > -1; });
    } else {
      list = D.filterByChapter(B.questions, S.scope);
    }
    var ids = list.map(function (q) { return q.id; });
    if (S.mode === 'random') ids = D.shuffle(ids);
    S.order = ids;
    var idx = prevId != null ? ids.indexOf(prevId) : -1;
    S.pos = idx > -1 ? idx : 0;
    S.picked = [];
    S.revealed = false;
    S.hintFor = null;
    S.assessing = false;
  }

  function current() {
    var id = S.order[S.pos];
    if (id == null) return null;
    for (var i = 0; i < B.questions.length; i++) {
      if (B.questions[i].id === id) return B.questions[i];
    }
    return null;
  }

  /** 回到已做过的题时还原作答与解析（错题重练除外） */
  function restoreAnswer() {
    var q = current();
    if (!q || S.scope === 'wrong') {
      S.picked = [];
      S.revealed = false;
      return;
    }
    var r = recOf(q);
    if (answered(r)) {
      S.picked = r.picked ? D.normalizePicked(r.picked) : [];
      S.revealed = true;
    } else {
      S.picked = [];
      S.revealed = false;
    }
  }

  /* ---------------- 渲染 ---------------- */

  function renderChapters() {
    var html = '';
    html += '<button class="chip' + (S.scope === 'all' ? ' is-on' : '') + '" data-scope="all">全部<span class="cnt">' + B.questions.length + '</span></button>';
    B.chapters.forEach(function (c) {
      var n = D.filterByChapter(B.questions, c.key).length;
      html += '<button class="chip' + (S.scope === c.key ? ' is-on' : '') + '" data-scope="' + c.key + '">' + c.name + '<span class="cnt">' + n + '</span></button>';
    });
    html += '<button class="chip' + (S.scope === 'wrong' ? ' is-on' : '') + '" data-scope="wrong">' + (B.kind === 'short' ? '待巩固' : '错题重练') + '<span class="cnt">' + wrongIds().length + '</span></button>';
    el.chapters.innerHTML = html;
  }

  function renderOptions(q) {
    var opts = optionsFor(q);
    var isJudge = q.type === 'judge';
    el.options.className = 'options' + (isJudge ? ' judge' : '');
    var frag = document.createDocumentFragment();
    opts.forEach(function (o) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.dataset.letter = o.letter;
      btn.setAttribute('aria-label', o.letter + '．' + o.text);
      btn.innerHTML = '<span class="letter"></span><span class="txt"></span>';
      var mark = btn.querySelector('.letter');
      if (o.icon === 'check') mark.innerHTML = ICON_CHECK;
      else if (o.icon === 'cross') mark.innerHTML = ICON_CROSS;
      else mark.textContent = o.icon;
      btn.querySelector('.txt').textContent = o.text;
      frag.appendChild(btn);
    });
    el.options.innerHTML = '';
    el.options.appendChild(frag);
    paintOptions();
  }

  function paintOptions() {
    var q = current();
    if (!q) return;
    var nodes = el.options.querySelectorAll('.option');
    var correct = D.normalizePicked(q.answer);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var letter = node.dataset.letter;
      node.classList.remove('is-picked', 'is-right', 'is-wrong', 'is-missed', 'is-locked');
      var isPicked = S.picked.indexOf(letter) > -1;
      var isCorrect = correct.indexOf(letter) > -1;

      if (!S.revealed) {
        if (isPicked) node.classList.add('is-picked');
      } else {
        node.classList.add('is-locked');
        if (isCorrect && isPicked) node.classList.add('is-right');
        else if (isPicked) node.classList.add('is-wrong');
        else if (isCorrect) node.classList.add('is-missed');
      }
    }
  }

  function answerLabel(q, letters) {
    var picked = D.normalizePicked(letters);
    if (!picked.length) return '—';
    if (q.type === 'judge') {
      return picked.map(function (l) { return l === 'A' ? '正确' : '错误'; }).join('、');
    }
    return picked.join('');
  }

  function renderShort(q) {
    el.recallTip.textContent = S.revealed
      ? '对照要点，看看哪几条漏了 · 共 ' + q.points.length + ' 个要点'
      : '先默背，再对照 · 本题 ' + q.points.length + ' 个要点';
    var chips = '';
    q.hint.forEach(function (h) {
      chips += '<span class="hint-chip"></span>';
    });
    el.hintChips.innerHTML = chips;
    Array.prototype.forEach.call(el.hintChips.children, function (node, i) {
      node.textContent = q.hint[i];
    });
    var showHint = S.hintFor === q.id;
    el.hintChips.hidden = !showHint;
    el.btnHint.classList.toggle('is-open', showHint);
    el.hintLabel.textContent = showHint ? '收起提示' : '关键词提示';

    el.answerPoints.innerHTML = q.points.map(function () { return '<li></li>'; }).join('');
    Array.prototype.forEach.call(el.answerPoints.children, function (li, i) {
      li.textContent = q.points[i];
    });
    el.answerNote.hidden = !q.note;
    if (q.note) el.answerNote.textContent = '记忆提示：' + q.note;

    el.answerBox.hidden = !S.revealed;
    el.assess.hidden = !S.revealed;

    var r = recOf(q);
    Array.prototype.forEach.call(el.assessBtns.children, function (b) {
      b.classList.toggle('is-on', !!(r && r.level === b.dataset.level));
    });
  }

  function renderCard() {
    var q = current();
    if (!q) {
      el.card.hidden = true;
      el.empty.hidden = false;
      return;
    }
    el.card.hidden = false;
    el.empty.hidden = true;

    var isShort = q.type === 'short';

    el.qIndex.textContent = D.pad2(S.pos + 1);
    el.qType.textContent = q.type === 'multi' ? '多选' : (q.type === 'judge' ? '判断' : (isShort ? '简答' : '单选'));
    el.qChapter.textContent = D.chapterName(B.chapters, q.chapter);
    el.stem.textContent = q.question || q.stem;
    el.stem.classList.toggle('is-short', isShort);
    el.card.classList.toggle('is-short', isShort);

    var isStarred = stars().indexOf(q.id) > -1;
    el.btnStar.setAttribute('aria-pressed', isStarred ? 'true' : 'false');
    el.btnStar.querySelector('span').textContent = isStarred ? '已收藏' : '收藏';

    el.options.hidden = isShort;
    el.shortBody.hidden = !isShort;
    if (isShort) renderShort(q);
    else renderOptions(q);

    var rec = recOf(q);

    if (isShort) {
      el.btnSubmit.hidden = S.revealed;
      el.btnSubmit.textContent = '查看答案';
      el.btnSubmit.disabled = false;
    } else {
      el.btnSubmit.hidden = q.type !== 'multi' || S.revealed;
      el.btnSubmit.textContent = '确认答案';
      el.btnSubmit.disabled = S.picked.length === 0;
    }

    var nextPrimary = isShort ? (S.revealed && !!(rec && rec.level)) : S.revealed;
    el.btnNext.className = 'btn ' + (nextPrimary ? 'primary' : 'ghost');
    el.btnNext.textContent = S.pos >= S.order.length - 1 ? '完成本轮' : '下一题 →';
    el.btnPrev.disabled = S.pos === 0;

    el.kbdHint.textContent = isShort
      ? (S.revealed ? '1 记住了 · 2 有点模糊 · 3 没记住 · Enter 下一题' : 'Enter 查看答案 · ← → 翻页')
      : (q.type === 'judge'
        ? 'A 正确 · B 错误 · Enter 确认 · ← → 翻页'
        : 'A / B / C / D 选择 · Enter 确认 · ← → 翻页');

    renderAnalysis(q);
  }

  function renderAnalysis(q) {
    if (q.type === 'short' || !S.revealed) {
      el.analysis.hidden = true;
      el.analysis.innerHTML = '';
      return;
    }
    var record = recOf(q);
    var ok = record ? record.correct : D.judge(q, S.picked);
    el.analysis.innerHTML =
      '<div class="ans-head">' +
        '<span class="verdict ' + (ok ? 'ok' : 'no') + '">' + (ok ? '回答正确' : '回答错误') + '</span>' +
        '<span class="ans-key">你的答案 <b style="color:' + (ok ? 'var(--jade)' : 'var(--rose)') + '">' + answerLabel(q, S.picked) + '</b></span>' +
        '<span class="ans-key">正确答案 <b>' + answerLabel(q, q.answer) + '</b></span>' +
      '</div>' +
      '<p></p>' +
      (q.source ? '<div class="ans-src"></div>' : '');
    el.analysis.querySelector('p').textContent = q.analysis;
    if (q.source) el.analysis.querySelector('.ans-src').textContent = '来源：' + q.source;
    el.analysis.hidden = false;
  }

  function shortStats() {
    var total = B.questions.length;
    var reviewed = 0, known = 0, fuzzy = 0, unknown = 0;
    B.questions.forEach(function (q) {
      var r = recOf(q);
      if (!answered(r)) return;
      reviewed++;
      if (r.level === 'known') known++;
      else if (r.level === 'fuzzy') fuzzy++;
      else unknown++;
    });
    return {
      total: total,
      reviewed: reviewed,
      known: known,
      fuzzy: fuzzy,
      unknown: unknown,
      remaining: total - reviewed,
      pct: total ? Math.round((reviewed / total) * 100) : 0
    };
  }

  function renderLegends() {
    var items = B.kind === 'short'
      ? [['ok', '掌握'], ['mid', '待巩固'], ['cur', '当前'], ['idle', '未复习']]
      : [['ok', '答对'], ['no', '答错'], ['cur', '当前'], ['idle', '未做']];
    var html = '';
    items.forEach(function (it) {
      html += '<span><i class="dot ' + it[0] + '"></i>' + it[1] + '</span>';
    });
    el.scrubLegend.innerHTML = html;
    el.sheetLegend.innerHTML = html;
  }

  function renderStats() {
    renderLegends();
    var pct;
    if (B.kind === 'short') {
      var ss = shortStats();
      pct = ss.pct;
      el.stLabels[0].textContent = '掌握';
      el.stLabels[1].textContent = '待巩固';
      el.stLabels[2].textContent = '未复习';
      el.stCorrect.textContent = ss.known;
      el.stWrong.textContent = ss.fuzzy + ss.unknown;
      el.stRemain.textContent = ss.remaining;
      el.miniStats.dataset.kind = 'short';
    } else {
      var s = D.stats(B.questions, moduleRecords());
      pct = Math.round((s.answered / s.total) * 100);
      el.stLabels[0].textContent = '答对';
      el.stLabels[1].textContent = '答错';
      el.stLabels[2].textContent = '未做';
      el.stCorrect.textContent = s.correct;
      el.stWrong.textContent = s.wrong;
      el.stRemain.textContent = s.remaining;
      el.miniStats.dataset.kind = B.kind;
    }
    el.ring.style.setProperty('--p', pct);
    el.ringNum.innerHTML = pct + '<span>%</span>';
    el.progCap.textContent = B.label + ' · ' + B.questions.length + ' 题';
  }

  function stateClass(rec) {
    if (!answered(rec)) return '';
    if (B.kind === 'short') {
      if (rec.level === 'known') return ' ok';
      if (rec.level === 'fuzzy') return ' mid';
      return ' no';
    }
    return rec.correct ? ' ok' : ' no';
  }

  function renderScrub() {
    var total = S.order.length;
    el.scrub.hidden = total === 0;
    el.scrubPos.textContent = total ? S.pos + 1 : 0;
    el.scrubTotal.textContent = total;
    var html = '';
    for (var i = 0; i < total; i++) {
      var id = S.order[i];
      var cls = 'tick' + stateClass(state.records[recKey(id)]);
      html += '<button type="button" class="' + cls + '" data-idx="' + i + '" title="第 ' + id + ' 题"></button>';
    }
    el.scrubTrack.innerHTML = html;
    el.scrubHead.style.left = total ? (((S.pos + 0.5) / total) * 100) + '%' : '0%';
  }

  function renderSheet() {
    var html = '';
    B.questions.forEach(function (q) {
      var r = recOf(q);
      var cls = 'gcell' + stateClass(r);
      if (S.order[S.pos] === q.id) cls += ' cur';
      if (stars().indexOf(q.id) > -1) cls += ' star';
      html += '<button type="button" class="' + cls + '" data-id="' + q.id + '" title="第 ' + q.id + ' 题">' + q.id + '</button>';
    });
    el.sheetGrid.innerHTML = html;

    if (B.kind === 'short') {
      var ss = shortStats();
      el.sheetSub.textContent = B.label + ' · 共 ' + ss.total + ' 题 · 已复习 ' + ss.reviewed + ' · 掌握 ' + ss.known;
    } else {
      var s = D.stats(B.questions, moduleRecords());
      el.sheetSub.textContent = B.label + ' · 共 ' + s.total + ' 题 · 已答 ' + s.answered + ' · 正确率 ' + s.accuracy + '%';
    }
  }

  function renderAll() {
    buildQueue();
    restoreAnswer();
    renderChapters();
    renderCard();
    renderStats();
    renderScrub();
  }

  /* ---------------- 交互 ---------------- */

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-show'); }, 1900);
  }

  function pick(letter) {
    var q = current();
    if (!q || S.revealed || q.type === 'short') return;
    if (q.type === 'multi') {
      var i = S.picked.indexOf(letter);
      if (i > -1) S.picked.splice(i, 1);
      else S.picked.push(letter);
      S.picked = D.normalizePicked(S.picked);
      paintOptions();
      el.btnSubmit.disabled = S.picked.length === 0;
    } else {
      S.picked = [letter];
      paintOptions();
      submit();
    }
  }

  function revealShort() {
    var q = current();
    if (!q || S.revealed) return;
    S.revealed = true;
    renderCard();
    renderScrub();
    revealScroll();
  }

  function revealScroll() {
    var box = el.answerBox;
    if (!box || box.hidden || typeof box.scrollIntoView !== 'function') return;
    var rect = box.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 20) {
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function submit() {
    var q = current();
    if (!q || S.revealed) return;
    if (q.type === 'short') {
      revealShort();
      return;
    }
    if (!S.picked.length) {
      toast('请先选择答案');
      return;
    }
    if (q.type === 'multi' && S.picked.length === 1) {
      toast('本题为多选题，可继续选择');
    }
    var ok = D.judge(q, S.picked);
    state.records[recKey(q.id)] = {
      picked: D.normalizePicked(S.picked),
      correct: ok,
      t: Date.now()
    };
    save();
    S.revealed = true;
    paintOptions();
    renderAnalysis(q);
    el.btnSubmit.hidden = true;
    el.btnNext.className = 'btn primary';
    renderStats();
    renderSheet();
    renderScrub();
    renderChapters();
    if (ok) toast('答对了');
  }

  var LEVELS = ['known', 'fuzzy', 'unknown'];

  function assess(level) {
    var q = current();
    if (!q || q.type !== 'short' || !S.revealed) return;
    if (LEVELS.indexOf(level) === -1) return;
    if (S.assessing) return;
    state.records[recKey(q.id)] = { level: level, t: Date.now() };
    save();
    renderShort(q);
    renderStats();
    renderSheet();
    renderScrub();
    renderChapters();
    el.btnNext.className = 'btn primary';

    if (level === 'known') {
      toast('已标记为掌握');
      S.assessing = true;
      var modAtClick = state.mod;
      setTimeout(function () {
        S.assessing = false;
        if (state.mod === modAtClick) go(1);
      }, 320);
    } else if (level === 'fuzzy') {
      toast('已标记为模糊，建议再读一遍要点');
    } else {
      toast('已标记为没记住，建议对照要点重背');
    }
  }

  function go(delta) {
    var target = S.pos + delta;
    if (target < 0 || target >= S.order.length) {
      if (delta > 0) {
        if (!S.order.length) {
          toast('暂无可练题目');
        } else if (B.kind === 'short') {
          var ss = shortStats();
          toast('本轮已完成 · 已复习 ' + ss.reviewed + ' 题，掌握 ' + ss.known + ' 题');
        } else {
          var s = D.stats(B.questions, moduleRecords());
          toast('本轮已完成 · 已答 ' + s.answered + ' 题，正确率 ' + s.accuracy + '%');
        }
      }
      return;
    }
    S.pos = target;
    restoreAnswer();
    renderCard();
    renderSheet();
    renderScrub();
    save();
    replayCardIn();
    if (window.scrollY > 120) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function replayCardIn() {
    el.card.style.animation = 'none';
    void el.card.offsetWidth;
    el.card.style.animation = '';
  }

  function jumpTo(id) {
    var idx = S.order.indexOf(id);
    if (idx === -1) {
      S.scope = 'all';
      buildQueue();
      S.pos = S.order.indexOf(id);
      if (S.pos < 0) S.pos = 0;
      renderChapters();
      renderStats();
    } else {
      S.pos = idx;
    }
    restoreAnswer();
    renderCard();
    renderSheet();
    renderScrub();
    save();
    replayCardIn();
    closeSheet();
  }

  function toggleStar() {
    var q = current();
    if (!q) return;
    var list = stars();
    var i = list.indexOf(q.id);
    if (i > -1) {
      list.splice(i, 1);
      toast('已取消收藏');
    } else {
      list.push(q.id);
      toast('已收藏本题');
    }
    save();
    renderCard();
    renderSheet();
  }

  function openSheet() {
    renderSheet();
    el.mask.hidden = false;
    el.sheet.classList.add('is-open');
    el.sheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { el.mask.classList.add('is-open'); });
  }

  function closeSheet() {
    el.mask.classList.remove('is-open');
    el.sheet.classList.remove('is-open');
    el.sheet.setAttribute('aria-hidden', 'true');
    setTimeout(function () { el.mask.hidden = true; }, 260);
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    el.themeLabel.textContent = state.theme === 'dark' ? '日间' : '夜间';
  }

  function syncModeSeg() {
    Array.prototype.forEach.call(el.modeSeg.querySelectorAll('.seg-btn'), function (b) {
      b.classList.toggle('is-on', b.dataset.mode === S.mode);
    });
  }

  function syncNav() {
    Array.prototype.forEach.call(document.querySelectorAll('.mod'), function (b) {
      b.classList.toggle('is-active', b.dataset.mod === state.mod);
    });
  }

  function switchModule(key) {
    if (!BANKS[key] || state.mod === key) return;
    state.mod = key;
    B = BANKS[key];
    S = modState[key];
    syncNav();
    syncModeSeg();
    renderAll();
    renderSheet();
    replayCardIn();
    save();
  }

  /* ---------------- 事件绑定 ---------------- */

  el.options.addEventListener('click', function (e) {
    var btn = e.target.closest('.option');
    if (!btn) return;
    pick(btn.dataset.letter);
  });

  el.btnHint.addEventListener('click', function () {
    var q = current();
    if (!q || q.type !== 'short') return;
    S.hintFor = S.hintFor === q.id ? null : q.id;
    renderShort(q);
  });

  el.assessBtns.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-level]');
    if (!btn) return;
    assess(btn.dataset.level);
  });

  el.btnSubmit.addEventListener('click', submit);
  el.btnNext.addEventListener('click', function () { go(1); });
  el.btnPrev.addEventListener('click', function () { go(-1); });
  el.btnStar.addEventListener('click', toggleStar);

  /* 移动端左右滑动切题 */
  var swipeX = 0, swipeY = 0, swipeActive = false;
  el.card.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    swipeX = e.touches[0].clientX;
    swipeY = e.touches[0].clientY;
    swipeActive = true;
  }, { passive: true });
  el.card.addEventListener('touchend', function (e) {
    if (!swipeActive) return;
    swipeActive = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - swipeX;
    var dy = t.clientY - swipeY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 60) return;
    if (dx < 0) go(1);
    else go(-1);
  }, { passive: true });

  el.chapters.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    S.scope = chip.dataset.scope;
    S.pos = 0;
    S.order = [];
    renderAll();
    renderSheet();
    save();
    replayCardIn();
  });

  el.modeSeg.addEventListener('click', function (e) {
    var btn = e.target.closest('.seg-btn');
    if (!btn) return;
    if (S.mode === btn.dataset.mode) return;
    S.mode = btn.dataset.mode;
    syncModeSeg();
    S.pos = 0;
    S.order = [];
    renderAll();
    renderSheet();
    save();
    replayCardIn();
    toast(S.mode === 'random' ? '已切换随机练习' : '已切换顺序练习');
  });

  el.btnSheet.addEventListener('click', openSheet);
  el.btnCloseSheet.addEventListener('click', closeSheet);
  el.mask.addEventListener('click', closeSheet);

  el.sheetGrid.addEventListener('click', function (e) {
    var cell = e.target.closest('.gcell');
    if (!cell) return;
    jumpTo(Number(cell.dataset.id));
  });

  el.scrubTrack.addEventListener('click', function (e) {
    var tick = e.target.closest('.tick');
    if (!tick) return;
    var idx = Number(tick.dataset.idx);
    if (idx === S.pos) return;
    S.pos = idx;
    restoreAnswer();
    renderCard();
    renderSheet();
    renderScrub();
    save();
    replayCardIn();
  });

  el.btnTheme.addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
  });

  el.btnReset.addEventListener('click', function () {
    var name = B.label;
    var extra = B.kind === 'short' ? '复习记录' : '答题记录';
    if (!window.confirm('确定要清空「' + name + '」的' + extra + '与收藏吗？此操作不可恢复。')) return;
    B.questions.forEach(function (q) { delete state.records[recKey(q.id)]; });
    state.stars[state.mod] = [];
    S.scope = 'all';
    S.pos = 0;
    S.order = [];
    save();
    renderAll();
    renderSheet();
    toast(name + '进度已重置');
  });

  el.btnEmptyBack.addEventListener('click', function () {
    S.scope = 'all';
    S.pos = 0;
    S.order = [];
    renderAll();
    renderSheet();
    save();
  });

  document.querySelectorAll('.mod').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.mod === 'exam') {
        if (window.MockExam) window.MockExam.open();
        return;
      }
      if (btn.dataset.locked) {
        var map = { };
        toast((map[btn.dataset.mod] || '该模块') + ' 将在下一模块验收通过后开发');
        return;
      }
      switchModule(btn.dataset.mod);
    });
  });

  document.addEventListener('keydown', function (e) {
    if (document.body.classList.contains('exam-open')) return;
    if (el.sheet.classList.contains('is-open')) {
      if (e.key === 'Escape') closeSheet();
      return;
    }
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    var key = e.key.toUpperCase();
    var q = current();
    var isShort = q && q.type === 'short';

    if (isShort && S.revealed && /^[1-3]$/.test(key)) {
      e.preventDefault();
      assess(LEVELS[Number(key) - 1]);
      return;
    }

    var idx = D.LETTERS.indexOf(key);
    if (idx === -1 && /^[1-4]$/.test(key)) idx = Number(key) - 1;
    if (!isShort && q && idx > -1 && idx < optionsFor(q).length) {
      e.preventDefault();
      pick(D.LETTERS[idx]);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (S.revealed) go(1);
      else submit();
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });

  /* ---------------- 启动 ---------------- */

  load();
  B = BANKS[state.mod];
  S = modState[state.mod];
  applyTheme();
  syncNav();
  syncModeSeg();
  renderAll();
  renderSheet();
})();
