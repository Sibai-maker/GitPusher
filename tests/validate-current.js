/*
 * 自测：时政专题题库校验（M4）
 * 运行：node tests/validate-current.js
 */
const path = require('path');
const { CURRENT_QUESTIONS, CURRENT_CHAPTERS } = require(path.join(__dirname, '..', 'assets', 'js', 'data-current.js'));

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(name + ' → ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const LETTERS = ['A', 'B', 'C', 'D'];

check('时政题总数为 50', () => assert(CURRENT_QUESTIONS.length === 50, `实际 ${CURRENT_QUESTIONS.length} 题`));

check('题号 1—50 连续且唯一', () => {
  const ids = CURRENT_QUESTIONS.map(q => q.id).sort((a, b) => a - b);
  ids.forEach((id, i) => assert(id === i + 1, `第 ${i + 1} 个题号为 ${id}`));
});

check('题型为单选或多选', () => {
  CURRENT_QUESTIONS.forEach(q => {
    assert(q.type === 'single' || q.type === 'multi', `第 ${q.id} 题类型非法：${q.type}`);
  });
});

check('每题 4 个选项、非空且不重复', () => {
  CURRENT_QUESTIONS.forEach(q => {
    assert(Array.isArray(q.options) && q.options.length === 4, `第 ${q.id} 题选项数异常`);
    const set = new Set();
    q.options.forEach((o, i) => {
      assert(String(o).trim().length > 0, `第 ${q.id} 题选项 ${LETTERS[i]} 为空`);
      assert(!set.has(o), `第 ${q.id} 题选项重复`);
      set.add(o);
    });
  });
});

check('答案合法且与题型一致', () => {
  CURRENT_QUESTIONS.forEach(q => {
    assert(Array.isArray(q.answer) && q.answer.length > 0, `第 ${q.id} 题缺少答案`);
    q.answer.forEach(a => {
      assert(LETTERS.indexOf(a) > -1, `第 ${q.id} 题答案非法：${a}`);
      assert(q.options[LETTERS.indexOf(a)] !== undefined, `第 ${q.id} 题答案超出选项`);
    });
    if (q.type === 'single') assert(q.answer.length === 1, `第 ${q.id} 题单选却有多个答案`);
    if (q.type === 'multi') assert(q.answer.length > 1, `第 ${q.id} 题多选却只有一个答案`);
  });
});

check('每题均有出处（来源标注）', () => {
  CURRENT_QUESTIONS.forEach(q => {
    assert(q.source && q.source.trim().length > 4, `第 ${q.id} 题缺少来源`);
    assert(/·/.test(q.source), `第 ${q.id} 题来源格式不规范：${q.source}`);
  });
});

check('每题均有解析', () => {
  CURRENT_QUESTIONS.forEach(q => {
    assert(q.analysis && q.analysis.trim().length > 12, `第 ${q.id} 题解析过短`);
  });
});

check('题干无重复、无中文残留英文单词', () => {
  const seen = new Map();
  CURRENT_QUESTIONS.forEach(q => {
    const key = q.stem.replace(/\s/g, '');
    assert(!seen.has(key), `第 ${q.id} 题与第 ${seen.get(key)} 题重复`);
    seen.set(key, q.id);
    const latin = q.stem.match(/[A-Za-z]{3,}/g) || [];
    const allowed = ['time', 'AI'];
    const bad = latin.filter(w => w !== 'AI' && w !== 'GDP' && w !== 'CPI');
    assert(bad.length === 0, `第 ${q.id} 题疑似夹杂英文：${bad.join(',')}`);
  });
});

check('章节归属合法，九章题量与规划一致', () => {
  const keys = CURRENT_CHAPTERS.map(c => c.key);
  const dist = {};
  CURRENT_QUESTIONS.forEach(q => {
    assert(keys.includes(q.chapter), `第 ${q.id} 题章节非法：${q.chapter}`);
    dist[q.chapter] = (dist[q.chapter] || 0) + 1;
  });
  const expect = { t1: 6, t2: 6, t3: 6, t4: 5, t5: 5, t6: 5, t7: 5, t8: 4, t9: 8 };
  keys.forEach(k => assert(dist[k] === expect[k], `章节 ${k} 实际 ${dist[k] || 0} 题，应为 ${expect[k]}`));
});

check('来源日期不超过 2026-09-30（防止混入范围外内容）', () => {
  CURRENT_QUESTIONS.forEach(q => {
    const m = q.source.match(/(2026)-(\d{2})(?:-(\d{2}))?/);
    if (!m) return;
    const month = Number(m[2]);
    const day = m[3] ? Number(m[3]) : 1;
    assert(month <= 9, `第 ${q.id} 题来源月份 ${month} 超出范围：${q.source}`);
    if (month === 9) assert(day <= 30, `第 ${q.id} 题来源日期异常：${q.source}`);
  });
});

check('答案分布不出现单选项垄断', () => {
  const tally = { A: 0, B: 0, C: 0, D: 0 };
  CURRENT_QUESTIONS.forEach(q => {
    if (q.type === 'single') tally[q.answer[0]]++;
  });
  const values = Object.values(tally);
  assert(values.filter(v => v > 0).length >= 3, '答案选项覆盖不足：' + JSON.stringify(tally));
  assert(Math.max(...values) <= 30, '单一选项占比过高：' + JSON.stringify(tally));
});

console.log('──────── 时政专题题库校验 ────────');
console.log(`通过 ${pass} 项` + (fails.length ? `，失败 ${fails.length} 项` : '，全部通过'));
if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));

const dist = {};
CURRENT_QUESTIONS.forEach(q => { dist[q.chapter] = (dist[q.chapter] || 0) + 1; });
console.log('\n专题分布：');
CURRENT_CHAPTERS.forEach(c => console.log(`  ${c.name.padEnd(8, '　')} ${String(dist[c.key] || 0).padStart(2)} 题`));
const multi = CURRENT_QUESTIONS.filter(q => q.type === 'multi').length;
console.log(`\n单选 ${CURRENT_QUESTIONS.length - multi} 题 / 多选 ${multi} 题`);

process.exit(fails.length ? 1 : 0);
