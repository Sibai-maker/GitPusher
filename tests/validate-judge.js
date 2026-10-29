/*
 * 自测：判断题题库校验（M2）
 * 运行：node tests/validate-judge.js
 */
const path = require('path');
const { JUDGE_QUESTIONS, JUDGE_CHAPTERS } = require(path.join(__dirname, '..', 'assets', 'js', 'data-judge.js'));

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(name + ' → ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

check('判断题总数为 60', () => assert(JUDGE_QUESTIONS.length === 60, `实际 ${JUDGE_QUESTIONS.length} 题`));

check('题号 1—60 连续且唯一', () => {
  const ids = JUDGE_QUESTIONS.map(q => q.id).sort((a, b) => a - b);
  ids.forEach((id, i) => assert(id === i + 1, `第 ${i + 1} 个题号为 ${id}`));
});

check('题型统一为 judge', () => {
  JUDGE_QUESTIONS.forEach(q => assert(q.type === 'judge', `第 ${q.id} 题类型为 ${q.type}`));
});

check('答案只能是 A（正确）或 B（错误），且唯一', () => {
  JUDGE_QUESTIONS.forEach(q => {
    assert(Array.isArray(q.answer) && q.answer.length === 1, `第 ${q.id} 题答案数量异常`);
    assert(['A', 'B'].includes(q.answer[0]), `第 ${q.id} 题答案非法：${q.answer[0]}`);
  });
});

check('正确 / 错误配比均衡（各 25—35 题）', () => {
  const t = JUDGE_QUESTIONS.filter(q => q.answer[0] === 'A').length;
  const f = JUDGE_QUESTIONS.filter(q => q.answer[0] === 'B').length;
  assert(t >= 25 && t <= 35, `正确项 ${t} 题，配比失衡`);
  assert(f >= 25 && f <= 35, `错误项 ${f} 题，配比失衡`);
});

check('题干非空且为完整陈述句', () => {
  JUDGE_QUESTIONS.forEach(q => {
    assert(q.stem && q.stem.trim().length > 6, `第 ${q.id} 题题干为空`);
    assert(/[。？！]$/.test(q.stem.trim()), `第 ${q.id} 题题干未以句号结尾`);
  });
});

check('题干无重复', () => {
  const seen = new Map();
  JUDGE_QUESTIONS.forEach(q => {
    const key = q.stem.replace(/\s/g, '');
    assert(!seen.has(key), `第 ${q.id} 题与第 ${seen.get(key)} 题题干重复`);
    seen.set(key, q.id);
  });
});

check('每题均有解析，错误项须以“错误”开头给出更正', () => {
  JUDGE_QUESTIONS.forEach(q => {
    assert(q.analysis && q.analysis.trim().length > 10, `第 ${q.id} 题解析过短`);
    if (q.answer[0] === 'B') {
      assert(/^错误/.test(q.analysis.trim()), `第 ${q.id} 题为错误项，解析未以“错误”开头`);
    } else {
      assert(!/^错误/.test(q.analysis.trim()), `第 ${q.id} 题为正确项，解析却写成错误`);
    }
  });
});

check('章节归属合法且四章均有题目', () => {
  const keys = JUDGE_CHAPTERS.map(c => c.key);
  const used = new Set();
  JUDGE_QUESTIONS.forEach(q => {
    assert(keys.includes(q.chapter), `第 ${q.id} 题章节非法：${q.chapter}`);
    used.add(q.chapter);
  });
  keys.forEach(k => assert(used.has(k), `章节 ${k} 没有题目`));
});

check('党章与党史配比合理（党章不少于 70%）', () => {
  const party = JUDGE_QUESTIONS.filter(q => q.chapter !== 'j4').length;
  assert(party / JUDGE_QUESTIONS.length >= 0.7, `党章类占比 ${(party / JUDGE_QUESTIONS.length * 100).toFixed(0)}%`);
});

console.log('──────── 判断题题库校验 ────────');
console.log(`通过 ${pass} 项` + (fails.length ? `，失败 ${fails.length} 项` : '，全部通过'));
if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));

const dist = {};
JUDGE_QUESTIONS.forEach(q => { dist[q.chapter] = (dist[q.chapter] || 0) + 1; });
const t = JUDGE_QUESTIONS.filter(q => q.answer[0] === 'A').length;
console.log('\n章节分布：');
JUDGE_CHAPTERS.forEach(c => console.log(`  ${c.name.padEnd(5, '　')} ${String(dist[c.key] || 0).padStart(3)} 题`));
console.log(`\n答案分布：正确 ${t} 题 / 错误 ${JUDGE_QUESTIONS.length - t} 题`);

process.exit(fails.length ? 1 : 0);
