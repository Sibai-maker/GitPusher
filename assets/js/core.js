/*
 * 党史100题 · 核心逻辑（纯函数，无 DOM 依赖，可在 Node 中直接测试）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DS100 = root.DS100 || {};
  for (var k in api) {
    if (Object.prototype.hasOwnProperty.call(api, k)) root.DS100[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  function normalizePicked(picked) {
    if (!Array.isArray(picked)) return [];
    var seen = {};
    var out = [];
    picked.forEach(function (l) {
      var up = String(l).toUpperCase();
      if (LETTERS.indexOf(up) > -1 && !seen[up]) {
        seen[up] = true;
        out.push(up);
      }
    });
    out.sort();
    return out;
  }

  function sameSet(a, b) {
    var x = normalizePicked(a);
    var y = normalizePicked(b);
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) return false;
    }
    return true;
  }

  /** 判定作答是否正确。多选题必须完全一致，少选、多选均判错。 */
  function judge(question, picked) {
    if (!question) return false;
    var p = normalizePicked(picked);
    if (!p.length) return false;
    return sameSet(p, question.answer);
  }

  /** 本题是否已作答（单选、多选均以“至少选中一项”为准） */
  function isAnswered(question, picked) {
    var p = normalizePicked(picked);
    if (!p.length) return false;
    return true;
  }

  function answerText(question) {
    if (!question) return '';
    return normalizePicked(question.answer).join('');
  }

  /** 洗牌，使用可注入的随机源，便于测试 */
  function shuffle(list, rand) {
    var r = typeof rand === 'function' ? rand : Math.random;
    var arr = list.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function filterByChapter(questions, chapter) {
    if (!chapter || chapter === 'all') return questions.slice();
    return questions.filter(function (q) { return q.chapter === chapter; });
  }

  function chapterName(chapters, key) {
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].key === key) return chapters[i].name;
    }
    return '未分类';
  }

  /**
   * 统计
   * records: { [id]: { picked: [], correct: boolean } }
   */
  function stats(questions, records) {
    var total = questions.length;
    var answered = 0;
    var correct = 0;
    var wrongIds = [];
    questions.forEach(function (q) {
      var r = records && records[q.id];
      if (r && r.picked && r.picked.length) {
        answered++;
        if (r.correct) correct++;
        else wrongIds.push(q.id);
      }
    });
    var wrong = answered - correct;
    return {
      total: total,
      answered: answered,
      correct: correct,
      wrong: wrong,
      remaining: total - answered,
      accuracy: answered ? Math.round((correct / answered) * 100) : 0,
      wrongIds: wrongIds
    };
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  return {
    LETTERS: LETTERS,
    normalizePicked: normalizePicked,
    sameSet: sameSet,
    judge: judge,
    isAnswered: isAnswered,
    answerText: answerText,
    shuffle: shuffle,
    filterByChapter: filterByChapter,
    chapterName: chapterName,
    stats: stats,
    pad2: pad2
  };
});
