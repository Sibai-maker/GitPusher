/*
 * 自测：M5 模拟考试全流程（jsdom）
 * 覆盖：入口 / 组卷结构 / 作答 / 答题卡 / 中途退出与续考 / 交卷 / 成绩 / 逐题解析 / 简答自评 / 历史记录
 */
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INDEX = path.join(__dirname, '..', 'index.html');
let pass = 0;
const fails = [];

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
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (String(a) !== String(b)) throw new Error((msg || '') + ` 期望「${b}」，实际「${a}」`); }
async function awaitTest(name, fn) {
  try { await fn(); pass++; } catch (e) { fails.push(name + ' → ' + e.message); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function waitFor(fn, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function loop() {
      let v;
      try { v = fn(); } catch (e) { v = false; }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeout) return reject(new Error('等待超时'));
      setTimeout(loop, 25);
    })();
  });
}

(async function run() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => {
    if (!/Not implemented: window.scrollTo/.test(e.message)) errors.push(e.message);
  });

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
  const q = s => doc.querySelector(s);
  const qa = s => Array.from(doc.querySelectorAll(s));
  const click = el => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  try {
    await waitFor(() => qa('#options .option').length === 4 && window.MockExam);

    await awaitTest('从侧栏打开模拟考试：显示试卷说明与学习报告', () => {
      const btn = qa('.mod').find(b => b.dataset.mod === 'exam');
      assert(btn && !btn.dataset.locked, '模拟考试入口不可用');
      click(btn);
      assert(!q('#exam').hidden, '考试层未显示');
      assert(q('#exam-setup').innerHTML.indexOf('模拟试卷') > -1, '缺少试卷说明');
      assert(q('#exam-setup').innerHTML.indexOf('学习报告') > -1, '缺少学习报告');
      assert(q('#exam-setup').innerHTML.indexOf('60 分钟') > -1, '缺少时长说明');
      assert(q('#exam-start'), '缺少开始按钮');
    });

    await awaitTest('开始考试：44 题、60 分钟、首题为单选', () => {
      click(q('#exam-start'));
      assert(!q('#exam-run').hidden, '答题视图未显示');
      eq(q('#exam-section').textContent, '单项选择');
      eq(q('#exam-pos').textContent, '第 1 / 30 题');
      eq(q('#exam-points').textContent, '2 分');
      assert(q('#exam-stem').textContent.length > 4, '题干为空');
      eq(qa('#exam-options .option').length, 4);
      assert(/^\d{2}:\d{2}$/.test(q('#exam-timer').textContent), '计时器格式异常');
      const left = Number(q('#exam-timer').textContent.split(':')[0]);
      assert(left >= 58 && left <= 60, '初始时间不是 60 分钟：' + q('#exam-timer').textContent);
    });

    await awaitTest('作答与翻页：选中态、进度、答题卡同步', () => {
      // 按实际抽到的试卷作答，保证“至少有一道答对”，避免随机导致的用例抖动
      const data = JSON.parse(window.localStorage.getItem('ds100.exams.v1'));
      const correct = data.session.paper[0].answer[0];
      const correctIdx = correct.charCodeAt(0) - 65;
      click(qa('#exam-options .option')[correctIdx]);
      assert(qa('#exam-options .option')[correctIdx].classList.contains('is-picked'), '选项未选中');
      click(q('#exam-next'));
      eq(q('#exam-pos').textContent, '第 2 / 30 题');
      click(q('#exam-sheet-btn'));
      assert(q('#exam-sheet').classList.contains('is-open'), '答题卡未打开');
      eq(qa('.ecell').length, 44);
      eq(qa('.ecell.done').length, 1);
      assert(q('.ecell.done'), '已答题未标记');
      click(q('#exam-sheet-close'));
    });

    await awaitTest('答题卡跳转到判断题（第 31 题）', () => {
      click(q('#exam-sheet-btn'));
      click(qa('.ecell')[30]);
      eq(q('#exam-section').textContent, '判断题');
      eq(qa('#exam-options .option').length, 2);
      eq(q('#exam-pos').textContent, '第 1 / 10 题');
    });

    await awaitTest('答题卡跳转到简答题（第 41 题）：出现作答框', () => {
      click(q('#exam-sheet-btn'));
      click(qa('.ecell')[40]);
      eq(q('#exam-section').textContent, '简答题');
      assert(!q('#exam-short').hidden, '简答作答区未显示');
      assert(q('#exam-options').hidden, '简答题不应显示选项');
      const ta = q('#exam-textarea');
      ta.value = '党的性质：两个先锋队、一个领导核心、三个代表。';
      ta.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    await awaitTest('中途退出后可从学习报告继续，题号保留', async () => {
      click(q('#exam-exit'));
      assert(q('#exam').hidden, '未退出考试层');
      click(qa('.mod').find(b => b.dataset.mod === 'exam'));
      assert(q('#exam-resume'), '缺少继续作答入口');
      click(q('#exam-resume'));
      assert(!q('#exam-run').hidden, '未回到答题视图');
      eq(q('#exam-section').textContent, '简答题');
      assert(q('#exam-textarea').value.indexOf('两个先锋队') > -1, '作答草稿未恢复');
    });

    await awaitTest('交卷：成绩页、分项得分与 44 条解析', () => {
      click(q('#exam-submit-btn'));
      assert(!q('#exam-result').hidden, '成绩页未显示');
      const total = Number(q('#res-total').textContent);
      assert(total >= 0 && total <= 100, '总分异常：' + total);
      eq(qa('.rs-card').length, 3);
      eq(qa('.rev-item').length, 44);
      assert(q('#exam-submit-btn').hidden, '交卷后仍显示交卷按钮');
    });

    await awaitTest('简答题自评 5 分后总分增加 5', () => {
      const before = Number(q('#res-total').textContent);
      const box = q('.self-score');
      assert(box, '缺少自评按钮');
      const five = box.querySelector('button[data-score="5"]');
      click(five);
      eq(Number(q('#res-total').textContent), before + 5);
      assert(five.classList.contains('is-on'), '自评按钮未高亮');
    });

    await awaitTest('只看错题筛选可用', () => {
      const all = qa('.rev-item').length;
      click(qa('#rev-filter button').find(b => b.dataset.filter === 'wrong'));
      const wrong = qa('.rev-item').length;
      assert(wrong < all, '筛选后数量未减少');
      assert(wrong > 0, '筛选后应至少有一条待回顾');
      click(qa('#rev-filter button').find(b => b.dataset.filter === 'all'));
      eq(qa('.rev-item').length, 44);
    });

    await awaitTest('逐题解析可展开收起', () => {
      const item = q('.rev-item.is-right');
      assert(item, '缺少答对题目');
      const head = item.querySelector('.rev-head');
      const body = item.querySelector('.rev-body');
      const hiddenBefore = body.hidden;
      click(head);
      eq(body.hidden, !hiddenBefore);
    });

    await awaitTest('考试记录写入本地存储并计入学习报告', () => {
      const raw = window.localStorage.getItem('ds100.exams.v1');
      assert(raw, '未写入考试存储');
      const data = JSON.parse(raw);
      assert(Array.isArray(data.history) && data.history.length === 1, '历史记录缺失');
      assert(data.last && data.last.paper.length === 44, '最近成绩缺少试卷');
      assert(data.session === null, '交卷后会话未清空');
    });

    await awaitTest('返回首页后学习报告显示本次成绩', () => {
      click(q('#res-home'));
      assert(q('#exam-setup').innerHTML.indexOf('最近成绩') > -1, '缺少最近成绩');
      assert(q('#exam-setup').innerHTML.indexOf('模考次数') > -1, '缺少统计');
      assert(q('#exam-last'), '缺少查看上次成绩入口');
    });

    await awaitTest('退出考试层回到练习界面', () => {
      click(q('#exam-exit'));
      assert(q('#exam').hidden, '考试层未关闭');
      assert(!q('#options').hidden, '练习界面未恢复');
    });

    await awaitTest('运行期间无脚本错误', () => {
      assert(errors.length === 0, '控制台报错：' + errors.join(' | '));
    });
  } catch (e) {
    fails.push('测试初始化失败 → ' + e.message);
  } finally {
    dom.window.close();
  }

  console.log('──────── 模拟考试测试 ────────');
  console.log(`通过 ${pass} 项` + (fails.length ? `，失败 ${fails.length} 项` : '，全部通过'));
  if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})();
