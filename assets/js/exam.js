/*
 * M5 · 模拟考试与学习报告
 * 独立于练习视图：随机组卷 → 限时闭卷作答 → 交卷评分 → 逐题解析 → 学习报告
 * 说明：考试作答不写入练习记录，练习进度与考试成绩互不污染
 */
(function () {
  'use strict';

  var D = window.DS100;
  var STORE = 'ds100.exams.v1';
  var DURATION = 60 * 60;          // 秒
  var PASS = 60;

  var SECTIONS = [
    { key: 'single', label: '单项选择', count: 30, points: 2, full: 60 },
    { key: 'judge', label: '判断题', count: 10, points: 2, full: 20 },
    { key: 'short', label: '简答题', count: 4, points: 5, full: 20 }
  ];

  var $ = function (s) { return document.querySelector(s); };
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtClock(sec) {
    sec = Math.max(0, sec);
    return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60);
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var el = {
    root: $('#exam'),
    setup: $('#exam-setup'),
    run: $('#exam-run'),
    result: $('#exam-result'),
    clock: $('#exam-clock'),
    timer: $('#exam-timer'),
    bar: $('#exam-bar'),
    counter: $('#exam-counter'),
    sheetBtn: $('#exam-sheet-btn'),
    submitBtn: $('#exam-submit-btn'),
    exit: $('#exam-exit'),
    sub: $('#exam-sub'),
    section: $('#exam-section'),
    pos: $('#exam-pos'),
    points: $('#exam-points'),
    stem: $('#exam-stem'),
    options: $('#exam-options'),
    short: $('#exam-short'),
    textarea: $('#exam-textarea'),
    prev: $('#exam-prev'),
    next: $('#exam-next'),
    mask: $('#exam-mask'),
    sheet: $('#exam-sheet'),
    sheetSub: $('#exam-sheet-sub'),
    sheetGrid: $('#exam-sheet-grid'),
    sheetClose: $('#exam-sheet-close'),
    sheetSubmit: $('#exam-sheet-submit')
  };

  var ICON_CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4.5 12.5l5.2 5L20 6.6" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_CROSS = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>';

  var store = { session: null, history: [], last: null };
  var paper = [];
  var answers = {};
  var drafts = {};
  var idx = 0;
  var view = 'setup';
  var timerId = null;
  var filter = 'all';

  /* ---------------- 存储 ---------------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      store.session = d.session || null;
      store.history = Array.isArray(d.history) ? d.history : [];
      store.last = d.last || null;
    } catch (e) { /* 忽略损坏数据 */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(store));
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  /* ---------------- 组卷 ---------------- */

  function makeItem(mod, q, section, points) {
    var isJudge = q.type === 'judge';
    return {
      key: mod + ':' + q.id,
      mod: mod,
      id: q.id,
      type: q.type,
      section: section,
      points: points,
      stem: q.stem || q.question || '',
      options: isJudge ? ['正确', '错误'] : (q.options || []),
      answer: q.answer,
      analysis: q.analysis || '',
      source: q.source || '',
      pointsList: q.points || null,
      note: q.note || ''
    };
  }

  function buildPaper() {
    var singles = D.shuffle(D.QUESTIONS.filter(function (q) { return q.type === 'single'; }))
      .slice(0, 18)
      .map(function (q) { return makeItem('choice', q, 'single', 2); });

    var currents = D.shuffle(D.CURRENT_QUESTIONS.filter(function (q) { return q.type === 'single'; }))
      .slice(0, 12)
      .map(function (q) { return makeItem('current', q, 'single', 2); });

    var judges = D.shuffle(D.JUDGE_QUESTIONS)
      .slice(0, 10)
      .map(function (q) { return makeItem('judge', q, 'judge', 2); });

    var party = D.SHORT_QUESTIONS.filter(function (q) { return q.chapter !== 's5'; });
    var hist = D.SHORT_QUESTIONS.filter(function (q) { return q.chapter === 's5'; });
    var shorts = D.shuffle(D.shuffle(party).slice(0, 3).concat(D.shuffle(hist).slice(0, 1)));
    shorts = shorts.map(function (q) { return makeItem('short', q, 'short', 5); });

    return singles.concat(currents, judges, shorts);
  }

  /* ---------------- 计时 ---------------- */

  function remain() {
    if (!store.session) return 0;
    return Math.max(0, Math.round((store.session.endsAt - Date.now()) / 1000));
  }

  function updateClock() {
    var r = remain();
    el.timer.textContent = fmtClock(r);
    el.timer.classList.toggle('is-warn', r <= 300);
    el.bar.style.width = Math.max(0, Math.min(100, (r / DURATION) * 100)) + '%';
    var done = paper.filter(isAnswered).length;
    el.counter.textContent = (idx + 1) + ' / ' + paper.length;
  }

  function startTimer() {
    stopTimer();
    updateClock();
    timerId = setInterval(function () {
      if (!store.session) { stopTimer(); return; }
      if (remain() <= 0) {
        stopTimer();
        submitExam(true);
        return;
      }
      updateClock();
    }, 500);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  /* ---------------- 作答 ---------------- */

  function isAnswered(q) {
    if (q.section === 'short') return !!(drafts[q.key] && drafts[q.key].trim());
    return !!(answers[q.key] && answers[q.key].length);
  }

  function paintOptions() {
    var q = paper[idx];
    var nodes = el.options.querySelectorAll('.option');
    var picked = answers[q.key] || [];
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('is-picked', picked.indexOf(nodes[i].dataset.letter) > -1);
    }
  }

  function pick(letter) {
    var q = paper[idx];
    if (!q || q.section === 'short') return;
    var cur = answers[q.key] || [];
    answers[q.key] = cur[0] === letter ? [] : [letter];
    store.session.answers = answers;
    save();
    paintOptions();
    updateClock();
  }

  function renderQuestion() {
    var q = paper[idx];
    if (!q) return;
    var sec = SECTIONS.filter(function (s) { return s.key === q.section; })[0];
    var base = 0;
    SECTIONS.forEach(function (s) {
      if (s.key === q.section) q.__start = base;
      base += s.count;
    });

    el.section.textContent = sec.label;
    el.pos.textContent = '第 ' + (idx - (q.__start || 0) + 1) + ' / ' + sec.count + ' 题';
    el.points.textContent = q.points + ' 分';
    el.stem.textContent = q.stem;

    if (q.section === 'short') {
      el.options.hidden = true;
      el.short.hidden = false;
      el.textarea.value = drafts[q.key] || '';
    } else {
      el.short.hidden = true;
      el.options.hidden = false;
      el.options.className = 'options' + (q.type === 'judge' ? ' judge' : '');
      var html = '';
      q.options.forEach(function (text, i) {
        var letter = D.LETTERS[i];
        var mark = q.type === 'judge'
          ? (i === 0 ? ICON_CHECK : ICON_CROSS)
          : letter;
        html += '<button type="button" class="option" data-letter="' + letter + '">' +
          '<span class="letter">' + mark + '</span>' +
          '<span class="txt"></span></button>';
      });
      el.options.innerHTML = html;
      Array.prototype.forEach.call(el.options.querySelectorAll('.option'), function (node, i) {
        node.querySelector('.txt').textContent = q.options[i];
      });
      paintOptions();
    }

    el.prev.disabled = idx === 0;
    el.next.textContent = idx >= paper.length - 1 ? '最后一题' : '下一题 →';
    el.next.disabled = idx >= paper.length - 1;
    updateClock();
    updateSheet();
  }

  function flushDraft() {
    if (view !== 'run') return;
    var q = paper[idx];
    if (!q || q.section !== 'short' || !store.session) return;
    drafts[q.key] = el.textarea.value;
    store.session.drafts = drafts;
    save();
  }

  function go(delta) {
    var t = idx + delta;
    if (t < 0 || t >= paper.length) return;
    flushDraft();
    idx = t;
    if (store.session) {
      store.session.idx = idx;
      save();
    }
    renderQuestion();
    el.root.querySelector('.exam-main').scrollTop = 0;
  }

  /* ---------------- 答题卡 ---------------- */

  function updateSheet() {
    el.sheetSub.textContent = '共 ' + paper.length + ' 题 · 已答 ' + paper.filter(isAnswered).length;
    var html = '';
    paper.forEach(function (q, i) {
      var cls = 'ecell';
      if (isAnswered(q)) cls += ' done';
      if (i === idx) cls += ' cur';
      html += '<button type="button" class="' + cls + '" data-i="' + i + '">' + (i + 1) + '</button>';
    });
    el.sheetGrid.innerHTML = html;
  }

  function openSheet() {
    updateSheet();
    el.mask.hidden = false;
    el.sheet.classList.add('is-open');
    el.sheet.setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    el.sheet.classList.remove('is-open');
    el.sheet.setAttribute('aria-hidden', 'true');
    setTimeout(function () { el.mask.hidden = true; }, 260);
  }

  /* ---------------- 评分 ---------------- */

  function grade() {
    var bySection = {};
    SECTIONS.forEach(function (s) {
      bySection[s.key] = { score: 0, full: s.full, right: 0, count: s.count };
    });

    var items = paper.map(function (q) {
      var ans = answers[q.key] || [];
      var item = { key: q.key, answer: ans, draft: drafts[q.key] || '', status: 'pending' };
      if (q.section !== 'short') {
        var right = D.judge({ answer: q.answer }, ans);
        item.status = right ? 'right' : 'wrong';
        if (right) {
          bySection[q.section].score += q.points;
          bySection[q.section].right++;
        }
      }
      return item;
    });

    var objective = bySection.single.score + bySection.judge.score;
    var duration = Math.max(1, Math.round((Date.now() - store.session.startedAt) / 1000));
    var id = Date.now();

    return {
      id: id,
      date: id,
      paper: paper,
      items: items,
      answers: answers,
      drafts: drafts,
      bySection: bySection,
      objective: objective,
      subjective: 0,
      selfScores: {},
      total: objective,
      duration: duration
    };
  }

  function submitExam(auto) {
    if (!store.session) return;
    if (view !== 'run' && !auto) return;

    flushDraft();

    if (!auto) {
      var un = paper.filter(function (q) { return !isAnswered(q); }).length;
      var msg = un > 0 ? '还有 ' + un + ' 题未作答，确定交卷？' : '确定交卷？';
      if (!window.confirm(msg)) return;
    }

    stopTimer();
    var res = grade();
    store.last = res;
    store.history.unshift({
      id: res.id,
      date: res.date,
      total: res.total,
      objective: res.objective,
      subjective: res.subjective,
      duration: res.duration
    });
    store.history = store.history.slice(0, 20);
    store.session = null;
    save();

    closeSheet();
    view = 'result';
    filter = 'all';
    showView();
    renderResult();
    el.root.querySelector('.exam-main').scrollTop = 0;
  }

  /* ---------------- 成绩页 ---------------- */

  function gradeLabel(score) {
    if (score >= 90) return '优秀';
    if (score >= 80) return '良好';
    if (score >= PASS) return '合格';
    return '待提高';
  }

  function currentTotal() {
    var total = store.last.objective;
    Object.keys(store.last.selfScores).forEach(function (k) {
      total += store.last.selfScores[k];
    });
    return total;
  }

  function reviewItemHtml(q, item, i) {
    var cls = item.status === 'right' ? 'is-right' : (item.status === 'wrong' ? 'is-wrong' : 'is-pending');
    var mark = item.status === 'right' ? '<span class="rev-mark ok">✓ 正确</span>'
      : item.status === 'wrong' ? '<span class="rev-mark no">✗ 错误</span>'
        : '<span class="rev-mark pending">待自评</span>';

    var yourAnswer = q.section === 'short' ? '' : (item.answer.join('') || '未作答');
    var correct = q.section === 'short' ? '' : D.normalizePicked(q.answer).join('');

    var body = '';
    if (q.section === 'short') {
      body += '<div class="rev-ans">你的作答</div>';
      body += '<div class="rev-draft">' + (item.draft ? esc(item.draft) : '（未作答）') + '</div>';
      body += '<div class="rev-ans"><b>参考答案</b></div>';
      body += '<ol class="rev-points">' + (q.pointsList || []).map(function (p) {
        return '<li>' + esc(p) + '</li>';
      }).join('') + '</ol>';
      if (q.note) body += '<div class="rev-src">记忆提示：' + esc(q.note) + '</div>';
      body += '<div class="self-score" data-key="' + q.key + '"><span>自评得分</span>' +
        [0, 3, 5].map(function (s) {
          return '<button type="button" data-score="' + s + '">' + (s === 0 ? '未答对 0 分' : s + ' 分') + '</button>';
        }).join('') + '</div>';
    } else {
      body += '<div class="rev-ans">你的答案 <b>' + esc(yourAnswer) + '</b> · 正确答案 <b>' + esc(correct) + '</b></div>';
      body += '<div class="rev-analysis">' + esc(q.analysis) + '</div>';
      if (q.source) body += '<div class="rev-src">来源：' + esc(q.source) + '</div>';
    }

    var expanded = item.status === 'wrong' || (item.status === 'pending' && q.section === 'short');

    return '<article class="rev-item ' + cls + '" data-key="' + q.key + '">' +
      '<div class="rev-head" data-toggle="' + q.key + '">' +
        '<span class="rev-no">' + pad2(i + 1) + '</span>' +
        '<span class="tag">' + (q.section === 'short' ? '简答' : (q.type === 'judge' ? '判断' : '单选')) + '</span>' +
        '<span class="rev-stem">' + esc(q.stem) + '</span>' +
        mark +
      '</div>' +
      '<div class="rev-body"' + (expanded ? '' : ' hidden') + '>' + body + '</div>' +
    '</article>';
  }

  function renderReview() {
    var list = store.last.items.map(function (item, i) {
      return { q: store.last.paper[i], item: item, i: i };
    });
    if (filter === 'wrong') {
      list = list.filter(function (x) {
        return x.item.status === 'wrong' || (x.item.status === 'pending' && x.q.section === 'short');
      });
    }
    var html = list.map(function (x) { return reviewItemHtml(x.q, x.item, x.i); }).join('');
    $('#rev-list').innerHTML = html || '<div class="hist-empty">没有需要回顾的题目。</div>';
    syncSelfButtons();
  }

  function syncSelfButtons() {
    Object.keys(store.last.selfScores).forEach(function (key) {
      var box = $('.self-score[data-key="' + key + '"]');
      if (!box) return;
      Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-on', Number(b.dataset.score) === store.last.selfScores[key]);
      });
    });
  }

  function updateScoreViews() {
    var total = currentTotal();
    var sub = total - store.last.objective;
    store.last.total = total;
    store.last.subjective = sub;

    var h = store.history.filter(function (x) { return x.id === store.last.id; })[0];
    if (h) { h.total = total; h.subjective = sub; }
    save();

    $('#res-total').textContent = total;
    $('#res-grade').textContent = gradeLabel(total);
    $('#res-sub').textContent = '客观题 ' + store.last.objective + ' 分 · 简答自评 ' + sub + ' / 20 分';
    $('#rs-short').textContent = sub;
  }

  function setScore(key, score) {
    store.last.selfScores[key] = score;
    updateScoreViews();

    var box = $('.self-score[data-key="' + key + '"]');
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-on', Number(b.dataset.score) === score);
      });
    }

    var item = store.last.items.filter(function (x) { return x.key === key; })[0];
    if (item) {
      item.status = score >= 5 ? 'right' : (score > 0 ? 'pending' : 'wrong');
      var art = $('.rev-item[data-key="' + key + '"]');
      if (art) {
        art.classList.remove('is-right', 'is-wrong', 'is-pending');
        art.classList.add(score >= 5 ? 'is-right' : (score > 0 ? 'is-pending' : 'is-wrong'));
        var mark = art.querySelector('.rev-mark');
        mark.className = 'rev-mark ' + (score >= 5 ? 'ok' : (score > 0 ? 'pending' : 'no'));
        mark.textContent = score >= 5 ? '✓ ' + score + ' 分' : (score > 0 ? '部分得分 ' + score + ' 分' : '✗ 0 分');
      }
    }
  }

  function renderResult() {
    var r = store.last;
    if (!r) { view = 'setup'; showView(); return; }
    paper = r.paper;
    answers = r.answers || {};
    drafts = r.drafts || {};

    var total = r.total;
    var html =
      '<div class="result-hero">' +
        '<div class="score-big"><span id="res-total">' + total + '</span><small>分</small></div>' +
        '<div class="result-head">' +
          '<h2 id="res-grade">' + gradeLabel(total) + '</h2>' +
          '<p id="res-sub">客观题 ' + r.objective + ' 分 · 简答自评 ' + r.subjective + ' / 20 分</p>' +
          '<p>用时 ' + fmtClock(r.duration) + ' · ' + fmtDate(r.date) + ' · 满分 100 分</p>' +
        '</div>' +
        '<div class="result-btns">' +
          '<button class="btn ghost sm" id="res-home">返回首页</button>' +
          '<button class="btn primary sm" id="res-again">再考一次</button>' +
        '</div>' +
      '</div>' +
      '<div class="result-sections">' +
        '<div class="rs-card"><div class="k">单项选择</div><div class="v">' + r.bySection.single.score + '<small>/ ' + r.bySection.single.full + '</small></div></div>' +
        '<div class="rs-card"><div class="k">判断题</div><div class="v">' + r.bySection.judge.score + '<small>/ ' + r.bySection.judge.full + '</small></div></div>' +
        '<div class="rs-card"><div class="k">简答题（自评）</div><div class="v"><span id="rs-short">' + r.subjective + '</span><small>/ ' + r.bySection.short.full + '</small></div></div>' +
      '</div>' +
      '<div class="review-wrap">' +
        '<div class="review-head">' +
          '<h3>逐题解析</h3>' +
          '<div class="review-filter" id="rev-filter">' +
            '<button type="button" data-filter="all" class="is-on">全部 ' + r.paper.length + '</button>' +
            '<button type="button" data-filter="wrong">只看错题</button>' +
          '</div>' +
        '</div>' +
        '<div id="rev-list"></div>' +
      '</div>';

    el.result.innerHTML = html;
    filter = 'all';
    renderReview();

    $('#res-home').addEventListener('click', function () {
      view = 'setup';
      showView();
      renderSetup();
    });
    $('#res-again').addEventListener('click', function () {
      startExam();
    });
    $('#rev-filter').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-filter]');
      if (!b) return;
      filter = b.dataset.filter;
      Array.prototype.forEach.call($('#rev-filter').querySelectorAll('button'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      renderReview();
    });
  }

  /* ---------------- 学习报告 ---------------- */

  function readPractice() {
    var out = {};
    try {
      var d = JSON.parse(localStorage.getItem('ds100.v2') || '{}');
      out = d.records || {};
    } catch (e) { out = {}; }
    return out;
  }

  function moduleStats() {
    var rec = readPractice();
    var defs = [
      { name: '选择题', mod: 'choice', total: 100, short: false },
      { name: '判断题', mod: 'judge', total: 60, short: false },
      { name: '简答题', mod: 'short', total: 32, short: true },
      { name: '时政', mod: 'current', total: 50, short: false }
    ];
    return defs.map(function (d) {
      var done = 0, good = 0;
      for (var i = 1; i <= d.total; i++) {
        var r = rec[d.mod + ':' + i];
        if (!r) continue;
        var answered = d.short ? !!r.level : !!(r.picked && r.picked.length);
        if (!answered) continue;
        done++;
        if (d.short ? r.level === 'known' : r.correct) good++;
      }
      return {
        name: d.name,
        done: done,
        good: good,
        total: d.total,
        pct: Math.round((done / d.total) * 100),
        acc: done ? Math.round((good / done) * 100) : 0
      };
    });
  }

  function renderSetup() {
    var mods = moduleStats();
    var hist = store.history;
    var avg = hist.length ? Math.round(hist.reduce(function (s, x) { return s + x.total; }, 0) / hist.length) : 0;
    var best = hist.length ? Math.max.apply(null, hist.map(function (x) { return x.total; })) : 0;

    var rows = SECTIONS.map(function (s) {
      var cnt = s.key === 'single' ? '党史 18 + 时政 12' : (s.key === 'judge' ? '党章为主' : '党章 3 + 党史 1');
      return '<div class="paper-row"><span class="sec">' + s.label + '</span><span class="cnt">' + s.count + ' 题 · ' + cnt + '</span><span class="pts">' + s.full + ' 分</span></div>';
    }).join('');

    var modRows = mods.map(function (m) {
      return '<div class="rm-row">' +
        '<span class="name">' + m.name + '</span>' +
        '<span class="rm-bar"><i style="width:' + m.pct + '%"></i></span>' +
        '<span class="val">' + m.done + '/' + m.total + '</span>' +
      '</div>';
    }).join('');

    var histHtml = hist.length
      ? hist.slice(0, 5).map(function (h) {
        return '<div class="hist-row">' +
          '<span class="score">' + h.total + '</span>' +
          '<span class="tag-mini">' + gradeLabel(h.total) + '</span>' +
          '<span class="date">' + fmtDate(h.date) + '</span>' +
        '</div>';
      }).join('')
      : '<div class="hist-empty">还没有模考记录，先完成一次。</div>';

    var resume = '';
    if (store.session) {
      resume = '<div class="resume-tip">上次考试尚未交卷，剩余 ' + fmtClock(remain()) +
        '<button type="button" id="exam-resume">继续作答</button></div>';
    }

    el.setup.innerHTML =
      '<div class="setup-grid">' +
        '<div class="panel">' +
          '<div class="panel-head">' +
            '<span class="kicker">2026 年发展对象党的基本知识测试</span>' +
            '<h2>模拟试卷</h2>' +
            '<p>闭卷 · 满分 100 分 · 限时 60 分钟</p>' +
          '</div>' +
          '<div class="paper-rows">' + rows + '</div>' +
          '<p class="paper-note">' +
            '题目从四个题库<b>随机抽取</b>，作答过程中不显示对错；交卷后自动评出客观题得分，' +
            '简答题对照参考答案<b>自评</b>（0 / 3 / 5 分）。考试作答不计入练习进度。' +
          '</p>' +
          '<button class="btn primary lg" id="exam-start">开始考试</button>' +
          resume +
        '</div>' +
        '<div class="panel">' +
          '<div class="panel-head"><h2 style="font-size:20px;margin:0">学习报告</h2></div>' +
          '<div class="report-mods">' + modRows + '</div>' +
          '<div class="report-top">' +
            '<div>平均分<b>' + (hist.length ? avg : '—') + '</b></div>' +
            '<div>最高分<b>' + (hist.length ? best : '—') + '</b></div>' +
            '<div>模考次数<b>' + hist.length + '</b></div>' +
          '</div>' +
          '<div class="report-hist"><h4>最近成绩</h4>' + histHtml + '</div>' +
          (store.last ? '<button class="btn ghost sm" id="exam-last" style="margin-top:14px;width:100%">查看上次成绩（' + store.last.total + ' 分）</button>' : '') +
        '</div>' +
      '</div>';

    $('#exam-start').addEventListener('click', startExam);
    if ($('#exam-resume')) {
      $('#exam-resume').addEventListener('click', function () {
        resumeExam();
      });
    }
    if ($('#exam-last')) {
      $('#exam-last').addEventListener('click', function () {
        view = 'result';
        showView();
        renderResult();
      });
    }
  }

  /* ---------------- 视图切换 ---------------- */

  function showView() {
    el.setup.hidden = view !== 'setup';
    el.run.hidden = view !== 'run';
    el.result.hidden = view !== 'result';
    el.clock.hidden = view !== 'run';
    el.sheetBtn.hidden = view !== 'run';
    el.submitBtn.hidden = view !== 'run';
    el.sub.textContent = view === 'run' ? '闭卷 · 作答中 · 60 分钟' : '闭卷 · 满分 100 · 60 分钟';
  }

  function startExam() {
    paper = buildPaper();
    answers = {};
    drafts = {};
    idx = 0;
    store.session = {
      id: Date.now(),
      startedAt: Date.now(),
      endsAt: Date.now() + DURATION * 1000,
      idx: 0,
      paper: paper,
      answers: {},
      drafts: {}
    };
    save();
    view = 'run';
    closeSheet();
    showView();
    renderQuestion();
    startTimer();
    el.root.querySelector('.exam-main').scrollTop = 0;
  }

  function resumeExam() {
    if (!store.session) return;
    if (Date.now() >= store.session.endsAt) {
      paper = store.session.paper;
      answers = store.session.answers || {};
      drafts = store.session.drafts || {};
      submitExam(true);
      return;
    }
    paper = store.session.paper;
    answers = store.session.answers || {};
    drafts = store.session.drafts || {};
    idx = typeof store.session.idx === 'number' ? store.session.idx : 0;
    view = 'run';
    showView();
    renderQuestion();
    startTimer();
  }

  function open() {
    load();
    el.root.hidden = false;
    document.body.classList.add('exam-open');
    document.body.style.overflow = 'hidden';

    if (store.session && Date.now() >= store.session.endsAt) {
      paper = store.session.paper;
      answers = store.session.answers || {};
      drafts = store.session.drafts || {};
      submitExam(true);
      return;
    }
    view = 'setup';
    showView();
    renderSetup();
  }

  function close() {
    el.root.hidden = true;
    document.body.classList.remove('exam-open');
    document.body.style.overflow = '';
    stopTimer();
    closeSheet();
  }

  /* ---------------- 事件 ---------------- */

  el.exit.addEventListener('click', function () {
    if (view === 'run') {
      flushDraft();
      if (!window.confirm('退出后计时不会暂停，可稍后点“继续作答”。确定退出？')) return;
    }
    close();
  });

  el.result.addEventListener('click', function (e) {
    var head = e.target.closest('.rev-head');
    if (head) {
      var body = head.parentElement.querySelector('.rev-body');
      if (body) body.hidden = !body.hidden;
      return;
    }
    var sb = e.target.closest('.self-score button[data-score]');
    if (sb) {
      setScore(sb.parentElement.dataset.key, Number(sb.dataset.score));
    }
  });

  el.sheetBtn.addEventListener('click', openSheet);
  el.sheetClose.addEventListener('click', closeSheet);
  el.mask.addEventListener('click', closeSheet);
  el.sheetSubmit.addEventListener('click', function () { submitExam(false); });

  el.sheetGrid.addEventListener('click', function (e) {
    var c = e.target.closest('.ecell');
    if (!c) return;
    if (view !== 'run') return;
    flushDraft();
    idx = Number(c.dataset.i);
    if (store.session) { store.session.idx = idx; save(); }
    renderQuestion();
    closeSheet();
  });

  el.options.addEventListener('click', function (e) {
    var b = e.target.closest('.option');
    if (!b) return;
    pick(b.dataset.letter);
  });

  el.prev.addEventListener('click', function () { go(-1); });
  el.next.addEventListener('click', function () { go(1); });
  el.submitBtn.addEventListener('click', function () { submitExam(false); });

  var draftTimer = null;
  el.textarea.addEventListener('input', function () {
    var q = paper[idx];
    if (!q || q.section !== 'short') return;
    drafts[q.key] = el.textarea.value;
    store.session.drafts = drafts;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { save(); updateClock(); updateSheet(); }, 350);
  });

  document.addEventListener('keydown', function (e) {
    if (el.root.hidden || view !== 'run') return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return;
    if (el.sheet.classList.contains('is-open')) {
      if (e.key === 'Escape') closeSheet();
      return;
    }
    var key = e.key.toUpperCase();
    var q = paper[idx];
    if (q && q.section !== 'short') {
      var i = D.LETTERS.indexOf(key);
      if (i > -1 && i < q.options.length) { e.preventDefault(); pick(D.LETTERS[i]); return; }
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });

  window.MockExam = { open: open, close: close };
})();
