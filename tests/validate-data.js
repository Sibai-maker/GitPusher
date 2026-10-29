/*
 * 自测 1：题库数据完整性校验
 * 运行：node tests/validate-data.js
 */
const path = require('path');
const { QUESTIONS, CHAPTERS } = require(path.join(__dirname, '..', 'assets', 'js', 'data-history.js'));

let pass = 0;
const fails = [];

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fails.push(name + ' → ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

check('题目总数为 100', () => assert(QUESTIONS.length === 100, `实际 ${QUESTIONS.length} 题`));

check('题号 1—100 连续且唯一', () => {
  const ids = QUESTIONS.map(q => q.id).sort((a, b) => a - b);
  ids.forEach((id, i) => assert(id === i + 1, `第 ${i + 1} 个题号为 ${id}`));
});

check('题干非空', () => {
  QUESTIONS.forEach(q => assert(q.stem && q.stem.trim().length > 4, `第 ${q.id} 题题干为空`));
});

check('每题恰好 4 个选项且无空项', () => {
  QUESTIONS.forEach(q => {
    assert(Array.isArray(q.options), `第 ${q.id} 题缺少 options`);
    assert(q.options.length === 4, `第 ${q.id} 题选项数 ${q.options.length}`);
    q.options.forEach((o, i) => assert(String(o).trim().length > 0, `第 ${q.id} 题选项 ${LETTERS[i]} 为空`));
  });
});

check('选项内部无重复', () => {
  QUESTIONS.forEach(q => {
    const set = new Set(q.options.map(o => String(o).trim()));
    assert(set.size === q.options.length, `第 ${q.id} 题存在重复选项`);
  });
});

check('答案合法且落在选项范围内', () => {
  QUESTIONS.forEach(q => {
    assert(Array.isArray(q.answer) && q.answer.length > 0, `第 ${q.id} 题答案为空`);
    q.answer.forEach(a => {
      assert(LETTERS.indexOf(a) > -1, `第 ${q.id} 题答案字母非法：${a}`);
      assert(q.options[LETTERS.indexOf(a)] !== undefined, `第 ${q.id} 题答案 ${a} 超出选项范围`);
    });
    const set = new Set(q.answer);
    assert(set.size === q.answer.length, `第 ${q.id} 题答案有重复字母`);
  });
});

check('单选 / 多选类型与答案数量一致', () => {
  QUESTIONS.forEach(q => {
    assert(q.type === 'single' || q.type === 'multi', `第 ${q.id} 题类型非法：${q.type}`);
    if (q.type === 'single') assert(q.answer.length === 1, `第 ${q.id} 题标为单选却有 ${q.answer.length} 个答案`);
    else assert(q.answer.length > 1, `第 ${q.id} 题标为多选却只有 1 个答案`);
  });
});

check('章节归属合法且七章均有题目', () => {
  const keys = CHAPTERS.map(c => c.key);
  const used = new Set();
  QUESTIONS.forEach(q => {
    assert(keys.indexOf(q.chapter) > -1, `第 ${q.id} 题章节非法：${q.chapter}`);
    used.add(q.chapter);
  });
  keys.forEach(k => assert(used.has(k), `章节 ${k} 没有题目`));
});

check('每题均有解析', () => {
  QUESTIONS.forEach(q => assert(q.analysis && q.analysis.trim().length > 8, `第 ${q.id} 题缺少解析`));
});

check('题干无重复', () => {
  const seen = new Map();
  QUESTIONS.forEach(q => {
    const key = q.stem.replace(/\s/g, '');
    assert(!seen.has(key), `第 ${q.id} 题与第 ${seen.get(key)} 题题干重复`);
    seen.set(key, q.id);
  });
});

check('答案分布合理（不存在单一答案垄断）', () => {
  const tally = {};
  QUESTIONS.forEach(q => {
    if (q.type === 'single') tally[q.answer[0]] = (tally[q.answer[0]] || 0) + 1;
  });
  const values = Object.values(tally);
  assert(values.length === 4, '四个选项未被全部使用：' + JSON.stringify(tally));
  assert(Math.max(...values) <= 45, '某一选项占比过高：' + JSON.stringify(tally));
});

console.log('──────── 题库数据校验 ────────');
console.log(`通过 ${pass} 项` + (fails.length ? `，失败 ${fails.length} 项` : '，全部通过'));
if (fails.length) {
  fails.forEach(f => console.log('  ✗ ' + f));
}

const dist = {};
QUESTIONS.forEach(q => { dist[q.chapter] = (dist[q.chapter] || 0) + 1; });
console.log('\n章节分布：');
CHAPTERS.forEach(c => console.log(`  ${c.name.padEnd(6, '　')} ${String(dist[c.key] || 0).padStart(3)} 题`));
const multi = QUESTIONS.filter(q => q.type === 'multi').length;
console.log(`\n单选 ${QUESTIONS.length - multi} 题 / 多选 ${multi} 题（第 ${QUESTIONS.filter(q => q.type === 'multi').map(q => q.id).join('、')} 题）`);

process.exit(fails.length ? 1 : 0);
