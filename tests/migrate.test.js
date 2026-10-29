/*
 * 自测：v1 → v2 存储迁移（M2 改造后的兼容性）
 * 场景：用户已在 M1 用旧版本作答，升级后进度不能丢
 */
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INDEX = path.join(__dirname, '..', 'index.html');
let pass = 0;
const fails = [];

function memoryStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
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

(async function run() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => { if (!/Not implemented: window.scrollTo/.test(e.message)) errors.push(e.message); });

  const legacy = {
    records: {
      1: { picked: ['B'], correct: true, t: 1 },
      2: { picked: ['A'], correct: false, t: 2 },
      3: { picked: ['C'], correct: true, t: 3 }
    },
    stars: [1, 5],
    theme: 'dark',
    mode: 'random'
  };

  const dom = await JSDOM.fromFile(INDEX, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        configurable: true,
        value: memoryStorage({ 'ds100.v1': JSON.stringify(legacy) })
      });
      win.confirm = () => true;
      win.scrollTo = () => {};
    }
  });

  const { window } = dom;
  const doc = window.document;
  const q = s => doc.querySelector(s);
  const qa = s => Array.from(doc.querySelectorAll(s));

  try {
    await new Promise(r => setTimeout(r, 700));

    try {
      eq(q('#st-correct').textContent, '2', '迁移后答对数');
      eq(q('#st-wrong').textContent, '1', '迁移后答错数');
      eq(q('#st-remain').textContent, '97', '迁移后未做数');
      pass++;
    } catch (e) { fails.push('旧进度数字未还原 → ' + e.message); }

    try {
      eq(doc.documentElement.getAttribute('data-theme'), 'dark', '主题设置');
      pass++;
    } catch (e) { fails.push('主题未继承 → ' + e.message); }

    try {
      eq(qa('#mode-seg .seg-btn').find(b => b.classList.contains('is-on')).dataset.mode, 'random', '出题模式');
      pass++;
    } catch (e) { fails.push('出题模式未继承 → ' + e.message); }

    // 切回顺序模式：既验证交互可用，也把队列恢复为 1—100 便于断言收藏
    try {
      const orderBtn = qa('#mode-seg .seg-btn').find(b => b.dataset.mode === 'order');
      orderBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      eq(q('#q-index').textContent, '01', '切回顺序后应停在第 1 题');
      pass++;
    } catch (e) { fails.push('切换顺序模式 → ' + e.message); }

    try {
      assert(q('#btn-star').getAttribute('aria-pressed') === 'true', '第 1 题收藏状态未恢复');
      pass++;
    } catch (e) { fails.push('收藏未继承 → ' + e.message); }

    try {
      const raw = window.localStorage.getItem('ds100.v2');
      assert(raw, '未写入 v2 存储');
      const data = JSON.parse(raw);
      assert(data.version === 2, '版本号不是 2');
      assert(data.records['choice:1'] && data.records['choice:1'].correct === true, '未转换为 choice:1 键');
      assert(data.stars.choice.indexOf(1) > -1, '收藏未迁移到 choice 命名空间');
      pass++;
    } catch (e) { fails.push('v2 结构写入异常 → ' + e.message); }

    try {
      // 迁移后旧键保留，不做破坏性删除
      assert(window.localStorage.getItem('ds100.v1'), '旧数据被删除');
      pass++;
    } catch (e) { fails.push('旧数据保留 → ' + e.message); }

    try {
      assert(errors.length === 0, '控制台报错：' + errors.join(' | '));
      pass++;
    } catch (e) { fails.push('无脚本错误 → ' + e.message); }
  } finally {
    dom.window.close();
  }

  console.log('──────── 存储迁移测试 ────────');
  console.log(`通过 ${pass} 项` + (fails.length ? `，失败 ${fails.length} 项` : '，全部通过'));
  if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})();
