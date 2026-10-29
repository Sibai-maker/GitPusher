/*
 * 自测 3：真实 DOM 交互流程（jsdom）
 * 覆盖：首屏渲染 / 单选即时判分 / 错题标记 / 翻页 / 多选判分 / 答题卡跳转 / 持久化 / 重置
 * 运行：NODE_PATH=<workspace>/node_modules node tests/dom.test.js
 */
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');

let pass = 0;
const fails = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('异步用例请使用 awaitTest');
    pass++;
  } catch (e) {
    fails.push(name + ' → ' + e.message);
  }
}
async function awaitTest(name, fn) {
  try {
    await fn();
    pass++;
  } catch (e) {
    fails.push(name + ' → ' + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
  if (String(a) !== String(b)) throw new Error((msg || '') + ` 期望「${b}」，实际「${a}」`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    key: i => Array.from(map.keys())[i] || null,
    get length() { return map.size; }
  };
}

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => {
  if (!/Not implemented: window.scrollTo/.test(e.message)) pageErrors.push(e.message);
});
vc.on('error', (...args) => pageErrors.push(args.join(' ')));

function waitFor(fn, timeout = 3000, interval = 25) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function loop() {
      let val;
      try { val = fn(); } catch (e) { val = false; }
      if (val) return resolve(val);
      if (Date.now() - t0 > timeout) return reject(new Error('等待超时'));
      setTimeout(loop, interval);
    })();
  });
}

(async function run() {
  const dom = await JSDOM.fromFile(INDEX, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', { configurable: true, value: memoryStorage() });
      win.confirm = () => true;
      win.scrollTo = () => {};
    }
  });

  const { window } = dom;
  const doc = window.document;
  const q = sel => doc.querySelector(sel);
  const qa = sel => Array.from(doc.querySelectorAll(sel));
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  try {
    await waitFor(() => qa('#options .option').length === 4);

    /* ---------- 首屏 ---------- */
    await awaitTest('首屏渲染第 1 题与 4 个选项', () => {
      eq(q('#q-index').textContent, '01');
      assert(q('#stem').textContent.indexOf('拉开了中国新民主主义革命的帷幕') > -1, '题干不符');
      eq(qa('#options .option').length, 4);
      eq(q('#q-type').textContent, '单选');
      eq(q('#q-chapter').textContent, '建党与大革命');
    });

    await awaitTest('答题卡渲染 100 个题号', () => {
      eq(qa('#sheet-grid .gcell').length, 100);
    });

    /* ---------- 单选判分：故意答错 ---------- */
    await awaitTest('单选答错：选项标红、正确项标绿虚线、解析出现', () => {
      click(qa('#options .option')[0]); // A，正确答案为 B
      const opts = qa('#options .option');
      assert(opts[0].classList.contains('is-wrong'), 'A 未标记为错误');
      assert(opts[1].classList.contains('is-missed'), 'B 未标记为正确答案');
      assert(!q('#analysis').hidden, '解析未展开');
      assert(q('#analysis').textContent.indexOf('回答错误') > -1, '未显示回答错误');
      assert(q('#analysis').textContent.indexOf('B') > -1, '未显示正确答案');
      eq(q('#st-wrong').textContent, '1');
      eq(q('#st-correct').textContent, '0');
    });

    await awaitTest('答错后“下一题”升级为主按钮', () => {
      assert(q('#btn-next').classList.contains('primary'), '答完后下一题未变为主按钮');
    });

    await awaitTest('答错后重新点击不会改变结果（已锁定）', () => {
      click(qa('#options .option')[2]);
      assert(qa('#options .option')[2].classList.contains('is-wrong') === false, '锁定失效');
      eq(q('#st-wrong').textContent, '1');
    });

    /* ---------- 翻页 + 答对 ---------- */
    await awaitTest('下一题：题号推进到 02，状态重置', () => {
      click(q('#btn-next'));
      eq(q('#q-index').textContent, '02');
      assert(q('#btn-next').classList.contains('ghost'), '未作答时下一题应为次要按钮');
      assert(q('#analysis').hidden, '解析未收起');
      assert(qa('#options .option').every(o => !o.classList.contains('is-right')), '选项状态未重置');
    });

    await awaitTest('单选答对：正确项标绿、统计更新', () => {
      click(qa('#options .option')[2]); // Q2 答案 C
      assert(qa('#options .option')[2].classList.contains('is-right'), 'C 未标绿');
      assert(q('#analysis').textContent.indexOf('回答正确') > -1, '未显示回答正确');
      eq(q('#st-correct').textContent, '1');
      eq(q('#st-wrong').textContent, '1');
    });

    await awaitTest('上一题可回看已答题目与解析', () => {
      click(q('#btn-prev'));
      eq(q('#q-index').textContent, '01');
      assert(!q('#analysis').hidden, '回看时解析应保持展开');
    });

    /* ---------- 多选题 ---------- */
    await awaitTest('答题卡跳转到第 93 题（多选）', () => {
      click(q('#btn-sheet'));
      const cell = q('#sheet-grid .gcell[data-id="93"]');
      assert(cell, '答题卡缺少第 93 题');
      click(cell);
      eq(q('#q-index').textContent, '93');
      eq(q('#q-type').textContent, '多选');
      assert(!q('#btn-submit').hidden, '多选题应显示确认按钮');
    });

    await awaitTest('多选少选判错', () => {
      click(qa('#options .option')[0]);
      click(qa('#options .option')[1]);
      click(q('#btn-submit'));
      assert(q('#analysis').textContent.indexOf('回答错误') > -1, '少选应判错');
    });

    await awaitTest('多选全部正确项判对（第 98 题）', () => {
      click(q('#btn-sheet'));
      const cell = q('#sheet-grid .gcell[data-id="98"]');
      assert(cell, '答题卡缺少第 98 题');
      click(cell);
      eq(q('#q-index').textContent, '98');
      eq(q('#q-type').textContent, '多选');
      ['A', 'B', 'C'].forEach((l, i) => click(qa('#options .option')[i]));
      click(q('#btn-submit'));
      assert(q('#analysis').textContent.indexOf('回答正确') > -1, '全选正确项应判对');
    });

    await awaitTest('已答题目回看时保持锁定，不能重复作答', () => {
      click(q('#btn-prev'));
      click(q('#btn-next'));
      const before = q('#analysis').textContent;
      click(qa('#options .option')[3]);
      assert(q('#analysis').textContent === before, '已答题目的作答状态被改动');
    });

    /* ---------- 持久化 ---------- */
    await awaitTest('答题记录写入 localStorage', () => {
      const raw = window.localStorage.getItem('ds100.v2');
      assert(raw, 'localStorage 为空');
      const data = JSON.parse(raw);
      assert(data.records['choice:1'] && data.records['choice:1'].correct === false, '第 1 题记录缺失');
      assert(data.records['choice:2'] && data.records['choice:2'].correct === true, '第 2 题记录缺失');
    });

    /* ---------- 章节筛选 ---------- */
    await awaitTest('章节筛选：抗战章节 11 题且首题为第 20 题', () => {
      const chip = qa('#chapters .chip').find(c => c.dataset.scope === 'ch3');
      assert(chip, '缺少抗战章节筛选项');
      click(chip);
      eq(q('#q-index').textContent, '01');
      assert(q('#q-chapter').textContent === '全民族抗战', '章节未切换');
      click(q('#btn-next'));
      eq(q('#q-index').textContent, '02');
      assert(q('#stem').textContent.indexOf('日本由此开始了全面侵华战争') > -1, '第 20 题未按序出现');
    });

    /* ---------- 错题重练 ---------- */
    await awaitTest('错题重练只包含做错的题', () => {
      const chip = qa('#chapters .chip').find(c => c.dataset.scope === 'wrong');
      assert(chip, '缺少错题重练入口');
      click(chip);
      const cur = q('#stem').textContent;
      assert(cur.indexOf('拉开了中国新民主主义革命的帷幕') > -1 || cur.indexOf('四个自信') > -1, '错题集内容异常：' + cur.slice(0, 20));
    });

    /* ---------- 主题 ---------- */
    await awaitTest('主题切换写入 data-theme', () => {
      click(q('#btn-theme'));
      eq(doc.documentElement.getAttribute('data-theme'), 'dark');
      click(q('#btn-theme'));
      eq(doc.documentElement.getAttribute('data-theme'), 'light');
    });

    /* ---------- 重置 ---------- */
    await awaitTest('重置进度清空记录并回到全部', () => {
      click(q('#btn-reset'));
      eq(q('#st-correct').textContent, '0');
      eq(q('#st-wrong').textContent, '0');
      eq(q('#st-remain').textContent, '100');
      eq(q('#q-index').textContent, '01');
    });

    /* ---------- M2 判断题模块 ---------- */
    await awaitTest('切换到判断题：60 题、两选项、统计与答题卡同步', () => {
      const btn = qa('.mod').find(b => b.dataset.mod === 'judge');
      assert(btn, '缺少判断题入口');
      assert(!btn.dataset.locked, '判断题不应被锁定');
      click(btn);
      eq(q('#q-index').textContent, '01');
      eq(q('#q-type').textContent, '判断');
      eq(qa('#options .option').length, 2);
      eq(qa('#options .option')[0].querySelector('.txt').textContent, '正确');
      eq(qa('#options .option')[1].querySelector('.txt').textContent, '错误');
      eq(q('#st-remain').textContent, '60');
      eq(qa('#sheet-grid .gcell').length, 60);
      assert(btn.classList.contains('is-active'), '导航未激活');
      assert(q('#prog-cap').textContent.indexOf('判断题') > -1, '进度标题未切换');
    });

    await awaitTest('判断题答对：判定、解析与记录落盘', () => {
      click(qa('#options .option')[0]); // 第 1 题答案为 A（正确）
      assert(q('#analysis').textContent.indexOf('回答正确') > -1, '未显示回答正确');
      assert(q('#analysis').textContent.indexOf('党章总纲') > -1, '解析内容异常');
      eq(q('#st-correct').textContent, '1');
      const data = JSON.parse(window.localStorage.getItem('ds100.v2'));
      assert(data.records['judge:1'] && data.records['judge:1'].correct === true, '判断题记录未写入');
    });

    await awaitTest('模块隔离：切回选择题不串进度', () => {
      click(q('#btn-next'));
      eq(q('#q-index').textContent, '02');
      const choiceBtn = qa('.mod').find(b => b.dataset.mod === 'choice');
      click(choiceBtn);
      eq(q('#q-type').textContent, '单选');
      eq(q('#q-index').textContent, '01');
      eq(q('#st-remain').textContent, '100');
      assert(q('#prog-cap').textContent.indexOf('选择题') > -1, '进度标题未切回选择题');
    });

    await awaitTest('模块切换保留各自位置', () => {
      const judgeBtn = qa('.mod').find(b => b.dataset.mod === 'judge');
      click(judgeBtn);
      eq(q('#q-index').textContent, '02');
      eq(q('#st-correct').textContent, '1');
    });

    await awaitTest('判断题答错：解析给出更正', () => {
      click(qa('#options .option')[0]); // 第 2 题答案为 B（错误），选“正确”应判错
      assert(q('#analysis').textContent.indexOf('回答错误') > -1, '未显示回答错误');
      assert(q('#analysis').textContent.indexOf('共产主义') > -1, '未给出更正说明');
      eq(q('#st-wrong').textContent, '1');
    });

    await awaitTest('数字键 1 / 2 可作答', () => {
      click(q('#btn-next'));
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', bubbles: true }));
      assert(!q('#analysis').hidden, '数字键未触发作答');
      assert(q('#analysis').textContent.indexOf('回答') > -1, '未出现判定结果');
    });

    /* ---------- M3 简答题模块 ---------- */
    await awaitTest('切换到简答题：32 题、隐藏选项、统计口径切换', () => {
      const btn = qa('.mod').find(b => b.dataset.mod === 'short');
      assert(btn && !btn.dataset.locked, '缺少简答题入口');
      click(btn);
      eq(q('#q-index').textContent, '01');
      eq(q('#q-type').textContent, '简答');
      assert(q('#options').hidden, '选项区未隐藏');
      assert(!q('#short-body').hidden, '简答区未显示');
      eq(q('#st-label-1').textContent, '掌握');
      eq(q('#st-label-2').textContent, '待巩固');
      eq(q('#st-remain').textContent, '32');
      eq(qa('#sheet-grid .gcell').length, 32);
      assert(q('#prog-cap').textContent.indexOf('简答题') > -1, '进度标题未切换');
    });

    await awaitTest('关键词提示可展开与收起', () => {
      assert(q('#hint-chips').hidden, '提示默认应收起');
      click(q('#btn-hint'));
      assert(!q('#hint-chips').hidden, '提示未展开');
      eq(qa('#hint-chips .hint-chip').length, 3);
      eq(q('#hint-label').textContent, '收起提示');
      click(q('#btn-hint'));
      assert(q('#hint-chips').hidden, '提示未收起');
    });

    await awaitTest('查看答案：要点、记忆提示与自评按钮出现', () => {
      click(q('#btn-submit'));
      assert(!q('#answer-box').hidden, '答案未展开');
      eq(qa('#answer-points li').length, 3);
      assert(q('#answer-note').textContent.indexOf('记忆提示') === 0, '记忆提示缺失');
      assert(!q('#assess').hidden, '自评按钮未出现');
      assert(q('#btn-submit').hidden, '查看答案按钮应隐藏');
    });

    await awaitTest('自评“记住了”：记录落盘并自动进入下一题', async () => {
      click(qa('#assess-btns button').find(b => b.dataset.level === 'known'));
      await sleep(520);
      eq(q('#q-index').textContent, '02');
      const data = JSON.parse(window.localStorage.getItem('ds100.v2'));
      assert(data.records['short:1'] && data.records['short:1'].level === 'known', '简答记录未写入');
      eq(q('#st-correct').textContent, '1');
    });

    await awaitTest('自评“没记住”：停留原题并计入待巩固', () => {
      click(q('#btn-submit'));
      click(qa('#assess-btns button').find(b => b.dataset.level === 'unknown'));
      eq(q('#q-index').textContent, '02');
      eq(q('#st-remain').textContent, '30');
      eq(q('#st-wrong').textContent, '1');
    });

    await awaitTest('答题卡区分掌握与待巩固', () => {
      click(q('#btn-sheet'));
      const c1 = q('#sheet-grid .gcell[data-id="1"]');
      const c2 = q('#sheet-grid .gcell[data-id="2"]');
      assert(c1.classList.contains('ok'), '第 1 题未标为掌握');
      assert(c2.classList.contains('no'), '第 2 题未标为待巩固');
      click(q('#btn-close-sheet'));
    });

    await awaitTest('回看已复习题目时答案展开且自评状态保留', () => {
      click(q('#btn-prev'));
      assert(!q('#answer-box').hidden, '回看时答案应收起');
      const on = qa('#assess-btns button.is-on');
      assert(on.length === 1 && on[0].dataset.level === 'known', '自评状态未还原');
    });

    await awaitTest('连点“记住了”只前进一题', async () => {
      click(q('#btn-next')); // 02
      click(q('#btn-next')); // 03
      eq(q('#q-index').textContent, '03');
      click(q('#btn-submit'));
      const btn = qa('#assess-btns button').find(b => b.dataset.level === 'known');
      click(btn);
      click(btn);
      await sleep(520);
      eq(q('#q-index').textContent, '04');
    });

    await awaitTest('模块隔离：切回选择题数据不受影响', () => {
      const choiceBtn = qa('.mod').find(b => b.dataset.mod === 'choice');
      click(choiceBtn);
      eq(q('#st-remain').textContent, '100');
      eq(q('#q-type').textContent, '单选');
      assert(!q('#options').hidden, '选项区未恢复');
      assert(q('#short-body').hidden, '简答区未隐藏');
    });

    /* ---------- M4 时政专题模块 ---------- */
    await awaitTest('切换到时政专题：50 题、九章、单选渲染', () => {
      const btn = qa('.mod').find(b => b.dataset.mod === 'current');
      assert(btn && !btn.dataset.locked, '缺少时政专题入口');
      click(btn);
      eq(q('#q-index').textContent, '01');
      eq(q('#q-type').textContent, '单选');
      eq(qa('#chapters .chip').length, 11); // 全部 + 9 专题 + 错题
      eq(qa('#sheet-grid .gcell').length, 50);
      eq(q('#st-remain').textContent, '50');
      assert(q('#prog-cap').textContent.indexOf('时政专题') > -1, '进度标题未切换');
      assert(!q('#options').hidden, '选项区未显示');
    });

    await awaitTest('时政答题后展示来源标注', () => {
      click(qa('#options .option')[2]); // 第 1 题答案 C
      assert(q('#analysis').textContent.indexOf('回答正确') > -1, '未判定正确');
      const src = q('#analysis .ans-src');
      assert(src && src.textContent.indexOf('来源：') === 0, '缺少来源标注');
      assert(src.textContent.indexOf('光明网') > -1, '来源未指向光明网');
    });

    await awaitTest('专题筛选：金砖会晤 6 题，首题为第 13 题', () => {
      const chip = qa('#chapters .chip').find(c => c.dataset.scope === 't3');
      assert(chip, '缺少金砖会晤筛选项');
      click(chip);
      eq(q('#q-index').textContent, '01');
      eq(q('#q-chapter').textContent, '金砖会晤');
      assert(q('#stem').textContent.indexOf('第十八次会晤') > -1, '首题不是金砖会晤题');
    });

    await awaitTest('时政多选题判分', () => {
      click(q('#btn-sheet'));
      click(q('#sheet-grid .gcell[data-id="18"]'));
      eq(q('#q-index').textContent, '06');
      eq(q('#q-type').textContent, '多选');
      ['A', 'B', 'C'].forEach((l, i) => click(qa('#options .option')[i]));
      click(q('#btn-submit'));
      assert(q('#analysis').textContent.indexOf('回答正确') > -1, '多选题判分异常');
    });

    await awaitTest('时政模块与选择题数据隔离', () => {
      const choiceBtn = qa('.mod').find(b => b.dataset.mod === 'choice');
      click(choiceBtn);
      eq(q('#st-remain').textContent, '100');
      eq(q('#q-type').textContent, '单选');
      assert(q('#prog-cap').textContent.indexOf('选择题') > -1, '进度标题未切回');
    });

    await awaitTest('运行期间无脚本错误', () => {
      assert(pageErrors.length === 0, '控制台报错：' + pageErrors.join(' | '));
    });
  } catch (e) {
    fails.push('测试初始化失败 → ' + e.message);
  } finally {
    dom.window.close();
  }

  console.log('──────── DOM 交互测试 ────────');
  console.log(`通过 ${pass} 项` + (fails.length ? `，失败 ${fails.length} 项` : '，全部通过'));
  if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})();
