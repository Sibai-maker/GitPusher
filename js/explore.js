/* GitPusher · M3 在线文件浏览模块（文件树 + 预览 + 下载）
 * 文件树改用「懒加载子目录」：只拉根目录 + 用户展开哪个子目录再拉哪个，避免一次性 recursive
 */
window.GP = window.GP || {};
(function (GP) {
  'use strict';
  var api = GP.api, ui = GP.ui, util = GP.util;
  var escapeHtml = util.escapeHtml;
  var formatBytes = util.formatBytes;
  var baseName = util.baseName;
  var extOf = util.extOf;
  var base64ToBytes = util.base64ToBytes;
  var base64ToStr = util.base64ToStr;

  var MAX_PREVIEW = 256 * 1024;
  var IMG_EXT = ['png','jpg','jpeg','gif','bmp','webp','avif','ico','svg'];

  var S = {
    full: '',
    branch: '',
    sig: '',
    selected: '',
    entries: {},     // dirPath ('') -> [{path, type, size, sha}]
    expanded: {},    // dirPath -> bool
    loaded: {},      // dirPath -> bool
    pending: {},     // dirPath -> Promise
  };

  /* ---------------- 简单语法高亮 ---------------- */
  var KEYWORDS = new Set(('const let var function return if else for while do switch case break continue ' +
    'class extends new this super import export from default try catch finally throw typeof instanceof in of ' +
    'async await yield static get set public private protected interface type enum namespace void null undefined ' +
    'true false def elif lambda pass raise with as and or not None True False func go defer chan map struct package ' +
    'select range print echo fi then end begin module use using mut pub fn abstract final readonly override virtual').split(/\s+/));
  var HASH_LANGS = new Set(['python','shell','yaml','yml','ruby','toml','perl','nginx','ini','cfg','conf']);

  function langOf(ext) {
    var map = {
      js:'js', mjs:'js', cjs:'js', jsx:'js', ts:'js', tsx:'js', vue:'js', svelte:'js',
      py:'python', rb:'ruby', go:'go', rs:'rust', java:'java', kt:'kotlin', kts:'kotlin',
      c:'c', h:'c', cpp:'c', cc:'c', cxx:'c', hpp:'c', cs:'c', php:'php', swift:'swift',
      sh:'shell', bash:'shell', zsh:'shell', ps1:'shell', bat:'shell', cmd:'shell',
      css:'css', scss:'css', less:'css', sass:'css', styl:'css',
      html:'html', htm:'html', xml:'xml', svg:'xml',
      json:'json', json5:'json', yaml:'yaml', toml:'toml', md:'md', sql:'sql'
    };
    return map[ext] || 'text';
  }

  function escapeRe(s) { return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'); }

  function highlightLine(line, lang) {
    // HTML/XML 标签
    if (lang === 'html' || lang === 'xml') {
      var re = new RegExp('^(<\\/?[A-Za-z][\\w-]*(?:\\s+[A-Za-z-]+(?:="[^"]*")?)*\\s*\\/?>)');
      var mm = re.exec(line);
      if (mm) {
        var rest2 = line.slice(mm[0].length);
        return '<span class="tk-tag">' + escapeHtml(mm[0]) + '</span>' + highlightText(rest2, lang);
      }
    }
    return highlightText(line, lang);
  }

  function highlightText(line, lang) {
    // 行注释 //
    var idx = line.indexOf('//');
    if (idx !== -1 && lang !== 'python' && lang !== 'shell' && lang !== 'yaml') {
      return highlightText(line.slice(0, idx), lang) + '<span class="tk-com">' + escapeHtml(line.slice(idx)) + '</span>';
    }
    if (HASH_LANGS.has(lang)) {
      var hi = line.indexOf('#');
      if (hi !== -1) {
        return highlightText(line.slice(0, hi), lang) + '<span class="tk-com">' + escapeHtml(line.slice(hi)) + '</span>';
      }
    }
    // 字符串
    var strRe = /^(?:"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)/;
    var sm = strRe.exec(line);
    if (sm) {
      return '<span class="tk-str">' + escapeHtml(sm[0]) + '</span>' + highlightText(line.slice(sm[0].length), lang);
    }
    // 数字
    var numRe = /^(?:0x[0-9a-fA-F]+|0b[01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/;
    var nm = numRe.exec(line);
    if (nm) {
      return '<span class="tk-num">' + escapeHtml(nm[0]) + '</span>' + highlightText(line.slice(nm[0].length), lang);
    }
    // 标识符
    var idRe = /^([A-Za-z_$][A-Za-z0-9_$]*)/;
    var im = idRe.exec(line);
    if (im) {
      var w = im[0], nxt = line.charAt(w.length);
      var cls = KEYWORDS.has(w) ? 'tk-kw' : (nxt === '(' ? 'tk-fn' : '');
      var tag = cls ? '<span class="' + cls + '">' + escapeHtml(w) + '</span>' : escapeHtml(w);
      return tag + highlightText(line.slice(w.length), lang);
    }
    if (!line) return '';
    return escapeHtml(line[0]) + highlightText(line.slice(1), lang);
  }

  function codeHtml(text, ext) {
    var lang = langOf(ext);
    var lines = text.split('\n');
    var out = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      out += '<div class="code-line"><span class="ln">' + (i + 1) + '</span><span class="lc">' + (ln ? highlightLine(ln, lang) : '') + '</span></div>';
    }
    return '<pre class="code-pre" data-lang="' + lang + '">' + out + '</pre>';
  }

  /* ---------------- 文件树（懒加载子目录） ---------------- */
  function sortedEntries(dirPath) {
    var arr = (S.entries[dirPath] || []).slice();
    arr.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
      return a.path.toLowerCase() < b.path.toLowerCase() ? -1 : 1;
    });
    return arr;
  }

  function fileIcon(name) {
    var ext = extOf(name);
    if (IMG_EXT.indexOf(ext) !== -1) return '\u{1F5BC}'; // 🖼
    if (ext === 'md' || ext === 'markdown') return '\u{1F4DD}';
    if (ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'toml' || ext === 'xml') return '\u2699';
    if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx' || ext === 'mjs' || ext === 'cjs') return '\u{1F4DC}';
    if (ext === 'css' || ext === 'scss' || ext === 'less' || ext === 'html' || ext === 'htm') return '\u{1F3A8}';
    if (ext === 'py' || ext === 'rb' || ext === 'go' || ext === 'rs' || ext === 'java' || ext === 'c' || ext === 'cpp' || ext === 'cs' || ext === 'php' || ext === 'swift') return '\u{1F527}';
    if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'tar' || ext === 'gz' || ext === 'tgz') return '\u{1F5DC}';
    if (ext === 'pdf' || ext === 'doc' || ext === 'docx' || ext === 'xls' || ext === 'xlsx' || ext === 'ppt' || ext === 'pptx') return '\u{1F4C4}';
    if (ext === 'lock') return '\u{1F512}';
    return '\u{1F4C4}';
  }

  function renderDir(dirPath, depth) {
    var arr = sortedEntries(dirPath);
    var html = '';
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      var fullPath = dirPath ? dirPath + '/' + e.path : e.path;
      var pad = depth * 14 + 8;
      if (e.type === 'tree') {
        var open = !!S.expanded[fullPath];
        var loaded = !!S.loaded[fullPath];
        var pending = !!S.pending[fullPath];
        var tog = pending ? '\u23F3' : (open ? '\u25BE' : '\u25B8');
        var safePath = escapeHtml(fullPath);
        var safeSha = escapeHtml(e.sha || '');
        html += '<div class="tree-row tree-dir' + (open ? ' open' : '') + '" style="padding-left:' + pad + 'px">';
        html += '<span class="tree-toggle" data-toggle="' + safePath + '" data-sha="' + safeSha + '">' + tog + '</span>';
        html += '<span class="tree-name" data-open="' + safePath + '" data-sha="' + safeSha + '">\u{1F4C1} ' + escapeHtml(e.path) + '</span>';
        html += '</div>';
        if (open) {
          if (!loaded && !pending) {
            html += '<div class="tree-row tree-loading-row" style="padding-left:' + (pad + 16) + 'px"><span class="muted">\u2B1C (尚未加载)</span></div>';
          } else if (pending) {
            html += '<div class="tree-row tree-loading-row" style="padding-left:' + (pad + 16) + 'px"><span class="spinner"></span> \u52A0\u8F7D\u4E2D\u2026</div>';
          } else {
            html += renderDir(fullPath, depth + 1);
          }
        }
      } else {
        var sel = S.selected === fullPath ? ' selected' : '';
        html += '<div class="tree-row tree-file' + sel + '" data-file="' + escapeHtml(fullPath) + '" style="padding-left:' + (pad + 16) + 'px">';
        html += '<span class="tree-ic">' + fileIcon(e.path) + '</span>';
        html += '<span class="tree-name">' + escapeHtml(e.path) + '</span>';
        if (e.size != null) {
          html += '<span class="tree-size muted">' + formatBytes(e.size) + '</span>';
        }
        html += '</div>';
      }
    }
    return html;
  }

  function renderTreeOnly(c) {
    var body = c.querySelector('#explore-tree-body');
    if (!body) return;
    if (!S.loaded['']) {
      body.innerHTML = '<div class="tree-empty muted">\u2B1C \u6587\u4EF6\u6811\u672A\u52A0\u8F7D</div>';
      return;
    }
    body.innerHTML = renderDir('', 0);
    var count = c.querySelector('#explore-tree-count');
    if (count) count.textContent = (S.entries[''] || []).length + ' \u9879';
  }

  function renderTreeRoot(c) {
    var body = c.querySelector('#explore-tree-body');
    if (body) body.innerHTML = '<div class="tree-loading"><span class="spinner"></span> \u52A0\u8F7D\u6587\u4EF6\u6811\u2026</div>';
  }

  function ensureSubtree(dirPath, sha, c) {
    if (S.loaded[dirPath]) return Promise.resolve();
    if (S.pending[dirPath]) return S.pending[dirPath];
    var cur = GP.app.state.current;
    if (!cur) return Promise.resolve();
    var owner = cur.owner.login, name = cur.name;
    var task = api.getTree(owner, name, sha, false).then(function (tree) {
      var items = (tree.tree || []).filter(function (t) { return t.path && t.type; }).map(function (t) {
        return { path: t.path, type: t.type, size: t.size || 0, sha: t.sha || '' };
      });
      S.entries[dirPath] = items;
      S.loaded[dirPath] = true;
      if (tree.truncated) ui.toast('\u76EE\u5F55 ' + (dirPath || '\u6839') + ' \u6587\u4EF6\u8FC7\u591A\uFF0C\u4EC5\u663E\u793A\u90E8\u5206', 'warn', 4000);
      console.log('[explore] loaded', dirPath || '/', '->', items.length, 'items');
    });
    S.pending[dirPath] = task;
    if (c) {
      S.expanded[dirPath] = true;
      renderTreeOnly(c);
    }
    return task.finally(function () {
      S.pending[dirPath] = null;
      if (c) renderTreeOnly(c);
    });
  }

  function toggleDir(c, fullPath, sha) {
    if (S.expanded[fullPath]) {
      S.expanded[fullPath] = false;
      renderTreeOnly(c);
      return;
    }
    if (S.loaded[fullPath]) {
      S.expanded[fullPath] = true;
      renderTreeOnly(c);
      return;
    }
    ensureSubtree(fullPath, sha, c).catch(function (e) {
      ui.toast('\u52A0\u8F7D\u5B50\u76EE\u5F55\u5931\u8D25\uFF1A' + (e.message || '\u672A\u77E5\u9519\u8BEF'), 'error');
      S.expanded[fullPath] = false;
      S.entries[fullPath] = [];
      renderTreeOnly(c);
    });
  }

  function bindTree(c) {
    var body = c.querySelector('#explore-tree-body');
    if (!body) return;
    body.addEventListener('click', function (e) {
      var t = e.target.closest('[data-toggle],[data-open],[data-file]');
      if (!t) return;
      if (t.hasAttribute('data-toggle') || t.hasAttribute('data-open')) {
        var p = t.getAttribute('data-toggle') || t.getAttribute('data-open');
        var sha = t.getAttribute('data-sha') || '';
        toggleDir(c, p, sha);
      } else if (t.hasAttribute('data-file')) {
        openFile(c, t.getAttribute('data-file'));
      }
    });
  }

  /* ---------------- 文件内容 ---------------- */
  function downloadFile(c, path) {
    var cur = GP.app.state.current;
    if (!cur) return;
    var owner = cur.owner.login, name = cur.name;
    ui.toast('\u51C6\u5907\u4E0B\u8F7D ' + baseName(path), 'info');
    api.getContent(owner, name, path, S.branch).then(function (d) {
      return new Promise(function (resolve, reject) {
        if (d.content && d.encoding === 'base64') {
          try { resolve(new Blob([base64ToBytes(d.content)], { type: 'application/octet-stream' })); }
          catch (e) { reject(e); }
        } else if (d.download_url) {
          fetch(d.download_url).then(function (r) { return r.blob(); }).then(resolve).catch(reject);
        } else {
          reject(new Error('\u65E0\u6CD5\u83B7\u53D6\u6587\u4EF6\u5185\u5BB9'));
        }
      });
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = baseName(path);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      ui.toast('\u5DF2\u5F00\u59CB\u4E0B\u8F7D ' + baseName(path), 'success');
    }).catch(function (e) {
      ui.toast('\u4E0B\u8F7D\u5931\u8D25\uFF1A' + (e.message || '\u672A\u77E5\u9519\u8BEF'), 'error');
    });
  }

  function renderContent(c, path, d) {
    var body = c.querySelector('#explore-file-body');
    var ext = extOf(path);
    var isImg = IMG_EXT.indexOf(ext) !== -1;

    if (d.content == null || d.encoding !== 'base64') {
      body.innerHTML = '<div class="file-big">\u8BE5\u6587\u4EF6\u8F83\u5927\uFF08' + formatBytes(d.size) + '\uFF09\uFF0C\u6D4F\u89C8\u5668\u9884\u89C8\u53D7\u9650\u3002' +
        '<div class="file-big-act"><button class="btn btn-sm" id="btn-dl-big">\u2B07 \u4E0B\u8F7D\u5230\u672C\u5730</button></div></div>';
      var bb = c.querySelector('#btn-dl-big');
      if (bb) bb.addEventListener('click', function () { downloadFile(c, path); });
      return;
    }
    var bytes = base64ToBytes(d.content);
    if (isImg) {
      var mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
      var dataUrl = 'data:' + mime + ';base64,' + d.content.replace(/\s/g, '');
      body.innerHTML = '<div class="file-image"><img src="' + dataUrl + '" alt="' + escapeHtml(baseName(path)) + '"/></div>';
      return;
    }
    var isText = util.guessTextByName(path);
    if (isText === false || util.looksBinary(bytes)) {
      body.innerHTML = '<div class="file-bin">\u8FD9\u662F\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u65E0\u6CD5\u9884\u89C8\u5185\u5BB9\u3002' +
        '<div class="file-big-act"><button class="btn btn-sm" id="btn-dl-bin">\u2B07 \u4E0B\u8F7D\u5230\u672C\u5730</button></div></div>';
      var bbb = c.querySelector('#btn-dl-bin');
      if (bbb) bbb.addEventListener('click', function () { downloadFile(c, path); });
      return;
    }
    var text = base64ToStr(d.content);
    if (text.length > MAX_PREVIEW) {
      body.innerHTML = codeHtml(text.slice(0, MAX_PREVIEW), ext) +
        '<div class="file-note muted">\u6587\u4EF6\u8F83\u5927\uFF08' + formatBytes(d.size) + '\uFF09\uFF0C\u4EC5\u9884\u89C8\u524D ' + (MAX_PREVIEW / 1024) + 'KB\u3002' +
        '<button class="btn btn-sm" id="btn-dl-long">\u2B07 \u4E0B\u8F7D\u5B8C\u6574\u6587\u4EF6</button></div>';
      var b4 = c.querySelector('#btn-dl-long');
      if (b4) b4.addEventListener('click', function () { downloadFile(c, path); });
      return;
    }
    body.innerHTML = codeHtml(text, ext);
  }

  function openFile(c, path) {
    S.selected = path;
    var cur = GP.app.state.current;
    if (!cur) return;
    var owner = cur.owner.login, name = cur.name;
    var head = c.querySelector('#explore-file-head');
    var body = c.querySelector('#explore-file-body');
    head.innerHTML =
      '<span class="file-title">' + fileIcon(path) + ' ' + escapeHtml(baseName(path)) + '</span>' +
      '<span class="file-path muted" title="' + escapeHtml(path) + '">' + escapeHtml(path) + '</span>' +
      '<span class="file-actions"><button class="btn btn-sm" id="btn-dl">\u2B07 \u4E0B\u8F7D</button></span>';
    var dl = c.querySelector('#btn-dl');
    if (dl) dl.addEventListener('click', function () { downloadFile(c, path); });
    renderTreeOnly(c);
    body.innerHTML = '<div class="file-loading"><span class="spinner"></span> \u52A0\u8F7D\u5185\u5BB9\u2026</div>';
    api.getContent(owner, name, path, S.branch).then(function (d) {
      renderContent(c, path, d);
    }).catch(function (e) {
      body.innerHTML = '<div class="file-error">\u8BFB\u53D6\u5931\u8D25\uFF1A' + escapeHtml(e.message || '\u672A\u77E5\u9519\u8BEF') + '</div>';
      ui.toast('\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25\uFF1A' + (e.message || ''), 'error');
    });
  }

  /* ---------------- 主流程 ---------------- */
  function resetState() {
    S.entries = {};
    S.expanded = {};
    S.loaded = {};
    S.pending = {};
    S.selected = '';
  }

  function loadRoot(c) {
    var cur = GP.app.state.current;
    if (!cur) {
      var tb = c.querySelector('#explore-tree-body');
      if (tb) tb.innerHTML = '<div class="tree-empty muted">\u8BF7\u5148\u5728\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u4ED3\u5E93</div>';
      return Promise.resolve();
    }
    S.full = cur.full_name;
    S.branch = GP.app.state.branch || cur.default_branch || 'main';
    var owner = cur.owner.login, name = cur.name;
    resetState();
    renderTreeRoot(c);

    return api.getRef(owner, name, 'heads/' + S.branch).then(function (ref) {
      return api.getTree(owner, name, ref.object.sha, false).then(function (root) {
        S.entries[''] = (root.tree || []).filter(function (t) { return t.path && t.type; }).map(function (t) {
          return { path: t.path, type: t.type, size: t.size || 0, sha: t.sha || '' };
        });
        S.loaded[''] = true;
        S.sig = S.full + '@' + S.branch;
        if (root.truncated) ui.toast('\u8BE5\u4ED3\u5E93\u5355\u5C42\u76EE\u5F55\u8FC7\u5927\uFF0C\u5DF2\u8D85\u51FA GitHub \u5355\u6B21\u8FD4\u56DE\u4E0A\u9650\uFF0C\u4EC5\u663E\u793A\u90E8\u5206\u6587\u4EF6', 'warn', 5000);
        console.log('[explore] root loaded:', S.entries[''].length, 'items');
        renderTreeOnly(c);
        var main = c.querySelector('#explore-file-body');
        if (!S.entries[''].length) {
          main.innerHTML = '<div class="file-empty muted">\u{1F4ED} \u8FD9\u662F\u4E00\u4E2A\u7A7A\u4ED3\u5E93\uFF0C\u6CA1\u6709\u4EFB\u4F55\u6587\u4EF6\u3002</div>';
        } else if (!S.selected) {
          main.innerHTML = ui.emptyState('\u{1F4C4}', '\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6', '\u4ECE\u5DE6\u4FA7\u6587\u4EF6\u6811\u70B9\u51FB\u4EFB\u610F\u6587\u4EF6\u67E5\u770B\u5185\u5BB9\u6216\u4E0B\u8F7D');
        }
      });
    }).catch(function (e) {
      var tb = c.querySelector('#explore-tree-body');
      if (e.status === 404) {
        tb.innerHTML = '<div class="tree-empty muted">\u8BE5\u5206\u652F\uFF08' + escapeHtml(S.branch) + '\uFF09\u6682\u65E0\u63D0\u4EA4\uFF0C\u65E0\u6CD5\u6D4F\u89C8\u6587\u4EF6</div>';
        S.sig = S.full + '@' + S.branch;
        return;
      }
      if (tb) tb.innerHTML = '<div class="tree-error">\u6587\u4EF6\u6811\u52A0\u8F7D\u5931\u8D25\uFF1A' + escapeHtml(e.message || '\u672A\u77E5\u9519\u8BEF') + '</div>';
      ui.toast('\u6587\u4EF6\u6811\u52A0\u8F7D\u5931\u8D25\uFF1A' + (e.message || '\u672A\u77E5\u9519\u8BEF'), 'error');
    });
  }

  function render(c) {
    var cur = GP.app.state.current;
    var fullNow = cur ? cur.full_name : '';
    var branchNow = GP.app.state.branch || (cur && cur.default_branch) || 'main';
    c.innerHTML =
      '<div class="explore-layout">' +
        '<div class="explore-tree">' +
          '<div class="explore-tree-head"><span>\u{1F4C2} \u6587\u4EF6\u6811\uFF08\u61D2\u52A0\u8F7D\uFF09</span><span class="muted" id="explore-tree-count"></span></div>' +
          '<div class="tree-scroll" id="explore-tree-body"><div class="tree-empty muted">\u52A0\u8F7D\u4E2D\u2026</div></div>' +
        '</div>' +
        '<div class="explore-main">' +
          '<div class="explore-file-head" id="explore-file-head"></div>' +
          '<div class="explore-file-body" id="explore-file-body">' + ui.emptyState('\u{1F4C4}', '\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6', '\u4ECE\u5DE6\u4FA7\u6587\u4EF6\u6811\u70B9\u51FB\u4EFB\u610F\u6587\u4EF6\u67E5\u770B\u5185\u5BB9\u6216\u4E0B\u8F7D') + '</div>' +
        '</div>' +
      '</div>';
    bindTree(c);
    if (S.sig === (fullNow + '@' + branchNow)) {
      renderTreeOnly(c);
      if (S.selected && GP.app.state.current) openFile(c, S.selected);
    } else {
      loadRoot(c);
    }
  }

  GP.app.modules.explore = {
    render: render,
    onBranchChange: function () { S.sig = ''; },
    onAfterPush: function () {
      S.sig = '';
      if (GP.app.state.view === 'explore') {
        var c = document.getElementById('panel-explore');
        if (c) loadRoot(c);
      }
    }
  };
})(window.GP);
