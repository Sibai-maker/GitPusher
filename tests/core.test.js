/*
 * 自测 2：核心判分与统计逻辑
 * 运行：node tests/core.test.js
 */
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'assets', 'js', 'core.js'));
const { QUESTIONS, CHAPTERS } = require(path.join(__dirname, '..', 'assets', 'js', 'data-history.js'));
const { JUDGE_QUESTIONS, JUDGE_CHAPTERS } = require(path.join(__dirname, '..', 'assets', 'js', 'data-judge.js'));

let pass = 0;
const fails = [];
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(name + ' → ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ` 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
}

const single = { type: 'single', answer: ['B'] };
const multi = { type: 'multi', answer: ['A', 'B', 'C'] };

/* ---------- 规范化 ---------- */
test('normalizePicked 去重并升序', () => {
  eq(CORE.normalizePicked(['B', 'A', 'B']), ['A', 'B']);
});
test('normalizePicked 过滤非法字母', () => {
  eq(CORE.normalizePicked(['A', 'Z', 'D']), ['A', 'D']);
});
test('normalizePicked 兼容小写', () => {
  eq(CORE.normalizePicked(['c', 'a']), ['A', 'C']);
});
test('normalizePicked 非数组返回空', () => {
  eq(CORE.normalizePicked(null), []);
  eq(CORE.normalizePicked('A'), []);
});

/* ---------- 判分 ---------- */
test('单选答对', () => assert(CORE.judge(single, ['B']) === true));
test('单选答错', () => assert(CORE.judge(single, ['A']) === false));
test('单选未作答判错', () => assert(CORE.judge(single, []) === false));
test('多选全对', () => assert(CORE.judge(multi, ['C', 'A', 'B']) === true));
test('多选少选判错', () => assert(CORE.judge(multi, ['A', 'B']) === false));
test('多选多选判错', () => assert(CORE.judge(multi, ['A', 'B', 'C', 'D']) === false));
test('多选错一个判错', () => assert(CORE.judge(multi, ['A', 'B', 'D']) === false));

/* ---------- 作答态 ---------- */
test('isAnswered 单选', () => {
  assert(CORE.isAnswered(single, ['B']) === true);
  assert(CORE.isAnswered(single, ['A', 'B']) === true);
  assert(CORE.isAnswered(single, []) === false);
});
test('answerText 拼接', () => {
  eq(CORE.answerText(single), 'B');
  eq(CORE.answerText(multi), 'ABC');
});

/* ---------- 筛选 ---------- */
test('filterByChapter 全量返回副本', () => {
  const all = CORE.filterByChapter(QUESTIONS, 'all');
  eq(all.length, 100);
  assert(all !== QUESTIONS, '应返回新数组');
});
test('filterByChapter 按章节过滤数量一致', () => {
  let sum = 0;
  CHAPTERS.forEach(c => {
    const n = CORE.filterByChapter(QUESTIONS, c.key).length;
    sum += n;
    assert(n > 0, `${c.name} 无题目`);
  });
  eq(sum, 100, '各章题数之和');
});
test('chapterName 命中与兜底', () => {
  eq(CORE.chapterName(CHAPTERS, 'ch1'), '建党与大革命');
  eq(CORE.chapterName(CHAPTERS, 'zzz'), '未分类');
});

/* ---------- 洗牌 ---------- */
test('shuffle 不增不减', () => {
  const src = [1, 2, 3, 4, 5];
  const out = CORE.shuffle(src);
  eq(out.slice().sort(), src);
  eq(src, [1, 2, 3, 4, 5], '不得改动原数组');
});
test('shuffle 随机源可注入且确定性', () => {
  const seq = [0.1, 0.9, 0.3, 0.7];
  let i = 0;
  const rand = () => seq[i++ % seq.length];
  const a = CORE.shuffle([1, 2, 3, 4, 5], rand);
  i = 0;
  const b = CORE.shuffle([1, 2, 3, 4, 5], rand);
  eq(a, b);
});

/* ---------- 统计 ---------- */
test('stats 空记录', () => {
  const s = CORE.stats(QUESTIONS, {});
  eq([s.answered, s.correct, s.wrong, s.remaining, s.accuracy], [0, 0, 0, 100, 0]);
});
test('stats 混合记录', () => {
  const records = {
    1: { picked: ['B'], correct: true },
    2: { picked: ['A'], correct: false },
    3: { picked: ['C'], correct: true },
    4: { picked: [], correct: false }
  };
  const s = CORE.stats(QUESTIONS, records);
  eq([s.answered, s.correct, s.wrong, s.remaining], [3, 2, 1, 97]);
  eq(s.accuracy, 67);
  eq(s.wrongIds, [2]);
});
test('stats 全部答对准确率 100%', () => {
  const records = {};
  QUESTIONS.forEach(q => { records[q.id] = { picked: q.answer, correct: true }; });
  const s = CORE.stats(QUESTIONS, records);
  eq([s.answered, s.accuracy, s.wrong], [100, 100, 0]);
});

/* ---------- 真实题库逐题判分 ---------- */
test('100 题答案自洽（按答案键作答必判对）', () => {
  QUESTIONS.forEach(q => {
    assert(CORE.judge(q, q.answer) === true, `第 ${q.id} 题按答案键作答却判错`);
  });
});
test('100 题错误选项必判错', () => {
  QUESTIONS.forEach(q => {
    const wrong = ['A', 'B', 'C', 'D'].filter(l => q.answer.indexOf(l) === -1);
    assert(CORE.judge(q, [wrong[0]]) === false, `第 ${q.id} 题选错误项却判对`);
  });
});
test('多选题逐项少选均判错', () => {
  QUESTIONS.filter(q => q.type === 'multi').forEach(q => {
    q.answer.forEach((_, i) => {
      const subset = q.answer.filter((__, j) => j !== i);
      assert(CORE.judge(q, subset) === false, `第 ${q.id} 题少选一项仍判对`);
    });
  });
});

/* ---------- 判断题题库 ---------- */
test('判断题 60 题，按答案键作答必判对', () => {
  assert(JUDGE_QUESTIONS.length === 60, `实际 ${JUDGE_QUESTIONS.length} 题`);
  JUDGE_QUESTIONS.forEach(q => {
    assert(CORE.judge(q, q.answer) === true, `判断题第 ${q.id} 题按答案作答却判错`);
  });
});

test('判断题反向作答必判错', () => {
  JUDGE_QUESTIONS.forEach(q => {
    const opposite = q.answer[0] === 'A' ? 'B' : 'A';
    assert(CORE.judge(q, [opposite]) === false, `判断题第 ${q.id} 题反向作答却判对`);
  });
});

test('判断题答案分布均衡', () => {
  const t = JUDGE_QUESTIONS.filter(q => q.answer[0] === 'A').length;
  const f = JUDGE_QUESTIONS.filter(q => q.answer[0] === 'B').length;
  assert(t === 30 && f === 30, `正确 ${t} / 错误 ${f}`);
});

test('判断题四章均有题目', () => {
  let sum = 0;
  JUDGE_CHAPTERS.forEach(c => {
    const n = CORE.filterByChapter(JUDGE_QUESTIONS, c.key).length;
    sum += n;
    assert(n > 0, `${c.name} 无题目`);
  });
  assert(sum === 60, `各章之和 ${sum}`);
});

console.log('──────── 核心逻辑测试 ────────');
console.log(`通过 ${pass} 项` + (fails.length ? `，失败 ${fails.length} 项` : '，全部通过'));
if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
