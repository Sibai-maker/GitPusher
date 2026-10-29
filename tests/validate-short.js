/*
 * 自测：简答题题库校验（M3）
 * 运行：node tests/validate-short.js
 */
const path = require('path');
const { SHORT_QUESTIONS, SHORT_CHAPTERS } = require(path.join(__dirname, '..', 'assets', 'js', 'data-short.js'));

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(name + ' → ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

check('简答题总数为 32', () => assert(SHORT_QUESTIONS.length === 32, `实际 ${SHORT_QUESTIONS.length} 题`));

check('题号 1—32 连续且唯一', () => {
  const ids = SHORT_QUESTIONS.map(q => q.id).sort((a, b) => a - b);
  ids.forEach((id, i) => assert(id === i + 1, `第 ${i + 1} 个题号为 ${id}`));
});

check('题型统一为 short', () => {
  SHORT_QUESTIONS.forEach(q => assert(q.type === 'short', `第 ${q.id} 题类型为 ${q.type}`));
});

check('题干为问句且不重复', () => {
  const seen = new Map();
  SHORT_QUESTIONS.forEach(q => {
    assert(q.question && q.question.trim().length > 5, `第 ${q.id} 题题干为空`);
    assert(/[？?]$/.test(q.question.trim()), `第 ${q.id} 题题干未以问号结尾`);
    const key = q.question.replace(/\s/g, '');
    assert(!seen.has(key), `第 ${q.id} 题与第 ${seen.get(key)} 题重复`);
    seen.set(key, q.id);
  });
});

check('每题至少 1 个要点，要点非空且不重复', () => {
  SHORT_QUESTIONS.forEach(q => {
    assert(Array.isArray(q.points) && q.points.length >= 1, `第 ${q.id} 题缺少要点`);
    const set = new Set();
    q.points.forEach((p, i) => {
      assert(typeof p === 'string' && p.trim().length > 4, `第 ${q.id} 题第 ${i + 1} 个要点过短`);
      const key = p.replace(/\s/g, '');
      assert(!set.has(key), `第 ${q.id} 题要点重复`);
      set.add(key);
    });
  });
});

check('每题至少 1 个关键词提示', () => {
  SHORT_QUESTIONS.forEach(q => {
    assert(Array.isArray(q.hint) && q.hint.length >= 1, `第 ${q.id} 题缺少提示`);
    q.hint.forEach((h, i) => {
      assert(typeof h === 'string' && h.trim().length >= 2, `第 ${q.id} 题第 ${i + 1} 个提示过短`);
    });
  });
});

check('每题均有记忆提示', () => {
  SHORT_QUESTIONS.forEach(q => {
    assert(q.note && q.note.trim().length > 8, `第 ${q.id} 题缺少记忆提示`);
  });
});

check('章节归属合法且五章均有题目', () => {
  const keys = SHORT_CHAPTERS.map(c => c.key);
  const used = new Set();
  SHORT_QUESTIONS.forEach(q => {
    assert(keys.includes(q.chapter), `第 ${q.id} 题章节非法：${q.chapter}`);
    used.add(q.chapter);
  });
  keys.forEach(k => assert(used.has(k), `章节 ${k} 没有题目`));
});

check('党章类占比不低于 70%', () => {
  const party = SHORT_QUESTIONS.filter(q => q.chapter !== 's5').length;
  assert(party / SHORT_QUESTIONS.length >= 0.7, `党章类占比 ${(party / SHORT_QUESTIONS.length * 100).toFixed(0)}%`);
});

check('要点具备作答长度（单题不少于 6 字，全库平均不少于 30 字）', () => {
  let sum = 0;
  SHORT_QUESTIONS.forEach(q => {
    const len = q.points.join('').replace(/\s/g, '').length;
    assert(len >= 6, `第 ${q.id} 题要点总长仅 ${len} 字`);
    sum += len;
  });
  const avg = sum / SHORT_QUESTIONS.length;
  assert(avg >= 30, `全库平均要点长度 ${avg.toFixed(1)} 字`);
});

console.log('──────── 简答题题库校验 ────────');
console.log(`通过 ${pass} 项` + (fails.length ? `，失败 ${fails.length} 项` : '，全部通过'));
if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));

const dist = {};
SHORT_QUESTIONS.forEach(q => { dist[q.chapter] = (dist[q.chapter] || 0) + 1; });
console.log('\n章节分布：');
SHORT_CHAPTERS.forEach(c => console.log(`  ${c.name.padEnd(5, '　')} ${String(dist[c.key] || 0).padStart(3)} 题`));
const totalPoints = SHORT_QUESTIONS.reduce((n, q) => n + q.points.length, 0);
console.log(`\n要点总数 ${totalPoints} 个，平均每题 ${(totalPoints / SHORT_QUESTIONS.length).toFixed(1)} 个`);

process.exit(fails.length ? 1 : 0);
