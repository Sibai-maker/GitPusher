/* GitPusher · M4 在线编辑与提交模块
 * 文件树（懒加载子目录，复用 M3 思路但独立实现）+ 右键菜单（新建/重命名/删除）+ 文本编辑器 + 提交 + 冲突检测
 */
window.GP = window.GP || {};
(function (GP) {
  'use strict';
  var api = GP.api, ui = GP.ui, util = GP.util;
  var escapeHtml = util.escapeHtml;
  var formatBytes = util.formatBytes;
  var baseName = util.baseName;
  var extOf = util.extOf;
  var parentPath = util.parentPath;
  var joinPath = util.joinPath;
  var base64ToStr = util.base64ToStr;
  var base64ToBytes = util.base64ToBytes;
  var strToBase64 = util.strToBase64;

  var IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'avif', 'ico', 'svg'];
  var MAX_LOAD = 1 * 1024 * 1024; // 1MB 以内的文件才拉取内容用于编辑/预览

  var S = {
    full: '',
    branch: '',
    sig: '',          // full@branch，用于判断是否需要重新拉取
    selected: '',     // 当前选中（正在编辑/预览）的文件路径
    entries: {},      // dirPath('') -> [{path,type,size,sha}]
    expanded: {},     // dirPath -> bool
    loaded: {},       // dirPath -> bool
    pending: {},      // dirPath -> Promise
    editing: null,    // { path, sha, dirty }
    ctxTarget: null,  // 右键菜单目标 { path, kind }
    multi: false,     // 多选模式
    multiSel: {},     // 多选集合 path -> true
  };

  /* ============== 文件树（懒加载） ============== */
  function repoInfo() {
    var cur = GP.app.state.current;
    if (!cur) return null;
    return { owner: cur.owner.login, name: cur.name };
  }

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
    if (IMG_EXT.indexOf(ext) !== -1) return '🖼';
    if (ext === 'md' || ext === 'markdown') return '📝';
    if (ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'toml' || ext === 'xml') return '⚙';
    if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx' || ext === 'mjs' || ext === 'cjs') return '📜';
    if (ext === 'css' || ext === 'scss' || ext === 'less' || ext === 'html' || ext === 'htm') return '🎨';
    if (ext === 'py' || ext === 'rb' || ext === 'go' || ext === 'rs' || ext === 'java' || ext === 'c' || ext === 'cpp' || ext === 'cs' || ext === 'php' || ext === 'swift') return '🔧';
    if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'tar' || ext === 'gz' || ext === 'tgz') return '🗜';
    if (ext === 'pdf' || ext === 'doc' || ext === 'docx' || ext === 'xls' || ext === 'xlsx' || ext === 'ppt' || ext === 'pptx') return '📄';
    return '📄';
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
        var tog = pending ? '⏳' : (open ? '▾' : '▸');
        var safePath = escapeHtml(fullPath);
        var safeSha = escapeHtml(e.sha || '');
        var cb = S.multi ? '<input type="checkbox" class="tree-cb" data-cb="' + safePath + '"' + (S.multiSel[fullPath] ? ' checked' : '') + ' />' : '';
        html += '<div class="tree-row tree-dir' + (open ? ' open' : '') + '" style="padding-left:' + pad + 'px" data-kind="dir" data-path="' + safePath + '">';
        html += cb;
        html += '<span class="tree-toggle" data-toggle="' + safePath + '" data-sha="' + safeSha + '">' + tog + '</span>';
        html += '<span class="tree-name" data-open="' + safePath + '" data-sha="' + safeSha + '">📁 ' + escapeHtml(e.path) + '</span>';
        html += '</div>';
        if (open) {
          if (!loaded && !pending) {
            html += '<div class="tree-row tree-loading-row" style="padding-left:' + (pad + 16) + 'px"><span class="muted">▫ (尚未加载)</span></div>';
          } else if (pending) {
            html += '<div class="tree-row tree-loading-row" style="padding-left:' + (pad + 16) + 'px"><span class="spinner"></span> 加载中…</div>';
          } else {
            html += renderDir(fullPath, depth + 1);
          }
        }
      } else {
        var sel = S.selected === fullPath ? ' selected' : '';
        var isEditing = S.editing && S.editing.path === fullPath ? ' editing' : '';
        var cb2 = S.multi ? '<input type="checkbox" class="tree-cb" data-cb="' + escapeHtml(fullPath) + '"' + (S.multiSel[fullPath] ? ' checked' : '') + ' />' : '';
        html += '<div class="tree-row tree-file' + sel + isEditing + '" data-kind="file" data-path="' + escapeHtml(fullPath) + '" style="padding-left:' + (pad + 16) + 'px">';
        html += cb2;
        html += '<span class="tree-ic">' + fileIcon(e.path) + '</span>';
        html += '<span class="tree-name">' + escapeHtml(e.path) + '</span>';
        if (e.size != null) html += '<span class="tree-size muted">' + formatBytes(e.size) + '</span>';
        html += '</div>';
      }
    }
    return html;
  }

  function renderTreeOnly(c) {
    var body = c.querySelector('#edit-tree-body');
    if (!body) return;
    if (!S.loaded['']) {
      body.innerHTML = '<div class="tree-empty muted">▫ 文件树未加载</div>';
      return;
    }
    body.innerHTML = renderDir('', 0);
    var count = c.querySelector('#edit-tree-count');
    if (count) count.textContent = (S.entries[''] || []).length + ' 项';
    updateMultiBar(c);
  }

  function updateMultiBar(c) {
    var bar = c.querySelector('#multi-bar');
    if (!bar) return;
    if (!S.multi) { bar.hidden = true; return; }
    bar.hidden = false;
    var n = Object.keys(S.multiSel).filter(function (p) { return S.multiSel[p]; }).length;
    bar.querySelector('#multi-count').textContent = '已选 ' + n + ' 项';
    bar.querySelector('#btn-multi-del').disabled = n === 0;
  }

  function renderTreeRoot(c) {
    var body = c.querySelector('#edit-tree-body');
    if (body) body.innerHTML = '<div class="tree-loading"><span class="spinner"></span> 加载文件树…</div>';
  }

  function ensureSubtree(dirPath, sha, c) {
    if (S.loaded[dirPath]) return Promise.resolve();
    if (S.pending[dirPath]) return S.pending[dirPath];
    var info = repoInfo();
    if (!info) return Promise.resolve();
    var task = api.getTree(info.owner, info.name, sha, false).then(function (tree) {
      var items = (tree.tree || []).filter(function (t) { return t.path && t.type; }).map(function (t) {
        return { path: t.path, type: t.type, size: t.size || 0, sha: t.sha || '' };
      });
      S.entries[dirPath] = items;
      S.loaded[dirPath] = true;
      if (tree.truncated) ui.toast('目录 ' + (dirPath || '根') + ' 文件过多，仅显示部分', 'warn', 4000);
    });
    S.pending[dirPath] = task;
    if (c) { S.expanded[dirPath] = true; renderTreeOnly(c); }
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
      ui.toast('加载子目录失败：' + (e.message || '未知错误'), 'error');
      S.expanded[fullPath] = false;
      S.entries[fullPath] = [];
      renderTreeOnly(c);
    });
  }

  function bindTree(c) {
    var body = c.querySelector('#edit-tree-body');
    if (!body) return;
    body.addEventListener('click', function (e) {
      var cb = e.target.closest('.tree-cb');
      if (cb) {
        e.stopPropagation();
        var p = cb.getAttribute('data-cb');
        if (cb.checked) S.multiSel[p] = true; else delete S.multiSel[p];
        updateMultiBar(c);
        return;
      }
      var t = e.target.closest('[data-toggle],[data-open],[data-path]');
      if (!t) return;
      if (t.hasAttribute('data-toggle') || t.hasAttribute('data-open')) {
        toggleDir(c, t.getAttribute('data-toggle') || t.getAttribute('data-open'), t.getAttribute('data-sha') || '');
      } else if (t.hasAttribute('data-path') && t.getAttribute('data-kind') === 'file') {
        openFile(c, t.getAttribute('data-path'));
      }
    });
    // 右键菜单
    body.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.tree-row');
      if (row) {
        e.preventDefault();
        S.ctxTarget = { path: row.getAttribute('data-path'), kind: row.getAttribute('data-kind') };
        showCtxMenu(c, e.clientX, e.clientY);
      } else if (e.target.closest('.tree-scroll') || e.target.closest('.edit-tree')) {
        e.preventDefault();
        S.ctxTarget = { path: '', kind: 'root' };
        showCtxMenu(c, e.clientX, e.clientY);
      }
    });
  }

  /* ============== 右键菜单 ============== */
  function showCtxMenu(c, x, y) {
    hideCtxMenu();
    var ctx = S.ctxTarget;
    if (!ctx) return;
    var menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.id = 'edit-ctx-menu';
    var items = [];
    if (ctx.kind === 'root') {
      items.push({ label: '➕ 新建文件', act: function () { promptNewFile(c, ''); } });
      items.push({ label: '📁 新建文件夹', act: function () { promptNewFolder(c, ''); } });
    } else if (ctx.kind === 'dir') {
      items.push({ label: '➕ 在此新建文件', act: function () { promptNewFile(c, ctx.path); } });
      items.push({ label: '📁 在此新建文件夹', act: function () { promptNewFolder(c, ctx.path); } });
      items.push({ sep: true });
      items.push({ label: '✏ 重命名', act: function () { promptRename(c, ctx.path, 'dir'); } });
      items.push({ label: '🗑 删除', danger: true, act: function () { confirmDelete(c, ctx.path, 'dir'); } });
    } else { // file
      var parent = parentPath(ctx.path);
      items.push({ label: '➕ 同目录新建文件', act: function () { promptNewFile(c, parent); } });
      items.push({ label: '📁 同目录新建文件夹', act: function () { promptNewFolder(c, parent); } });
      items.push({ sep: true });
      items.push({ label: '✏ 重命名', act: function () { promptRename(c, ctx.path, 'file'); } });
      items.push({ label: '🗑 删除', danger: true, act: function () { confirmDelete(c, ctx.path, 'file'); } });
    }
    var actionItems = items.filter(function (it) { return !it.sep; });
    menu.innerHTML = items.map(function (it) {
      if (it.sep) return '<div class="ctx-sep"></div>';
      return '<div class="ctx-item' + (it.danger ? ' danger' : '') + '" data-act>' + it.label + '</div>';
    }).join('');
    menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 220) + 'px';
    (c || document.body).appendChild(menu);
    menu.querySelectorAll('[data-act]').forEach(function (el, idx) {
      el.addEventListener('click', function () {
        hideCtxMenu();
        actionItems[idx].act();
      });
    });
    setTimeout(function () {
      document.addEventListener('click', onDocClickHide);
      document.addEventListener('contextmenu', onDocClickHide);
    }, 0);
  }
  function onDocClickHide(e) {
    if (e.target.closest && e.target.closest('#edit-ctx-menu')) return;
    hideCtxMenu();
  }
  function hideCtxMenu() {
    var m = document.getElementById('edit-ctx-menu');
    if (m) m.remove();
    document.removeEventListener('click', onDocClickHide);
    document.removeEventListener('contextmenu', onDocClickHide);
  }

  /* ============== 打开文件（编辑 / 预览） ============== */
  function openFile(c, path) {
    S.selected = path;
    var info = repoInfo();
    if (!info) return;
    var head = c.querySelector('#edit-file-head');
    var body = c.querySelector('#edit-file-body');
    head.innerHTML =
      '<span class="file-title">' + fileIcon(path) + ' ' + escapeHtml(baseName(path)) + '</span>' +
      '<span class="file-path muted" title="' + escapeHtml(path) + '">' + escapeHtml(path) + '</span>' +
      '<span class="file-actions"><button class="btn btn-sm" id="btn-edit-dl">⬇ 下载</button>' +
      '<button class="btn btn-sm btn-danger" id="btn-edit-del">🗑 删除</button></span>';
    var dl = c.querySelector('#btn-edit-dl');
    if (dl) dl.addEventListener('click', function () { downloadFile(c, path); });
    var del = c.querySelector('#btn-edit-del');
    if (del) del.addEventListener('click', function () { confirmDelete(c, path, 'file'); });

    renderTreeOnly(c);
    body.innerHTML = '<div class="file-loading"><span class="spinner"></span> 加载内容…</div>';
    api.getContent(info.owner, info.name, path, S.branch).then(function (d) {
      var sha = d.sha;
      var size = d.size;
      if (d.content == null || d.encoding !== 'base64' || size > MAX_LOAD) {
        // 大文件 / 无内容：只读预览或无预览
        renderReadOnly(c, path, d);
        return;
      }
      var text = base64ToStr(d.content);
      var bytes = base64ToBytes(d.content);
      var isText = util.guessTextByName(path);
      if (isText === false || util.looksBinary(bytes)) {
        renderReadOnly(c, path, d); // 二进制不可编辑
        return;
      }
      S.editing = { path: path, sha: sha, dirty: false };
      renderEditor(c, path, text);
    }).catch(function (e) {
      body.innerHTML = '<div class="file-error">读取失败：' + escapeHtml(e.message || '未知错误') + '</div>';
      ui.toast('读取文件失败：' + (e.message || ''), 'error');
    });
  }

  function renderEditor(c, path, text) {
    var body = c.querySelector('#edit-file-body');
    body.innerHTML =
      '<textarea id="edit-area" class="edit-area" spellcheck="false">' + escapeHtml(text) + '</textarea>' +
      '<div class="edit-commit">' +
      '<input id="edit-msg" class="input" placeholder="提交信息（commit message）" value="' + escapeHtml('Update ' + baseName(path)) + '" />' +
      '<button class="btn btn-primary" id="btn-commit">保存并提交</button>' +
      '<button class="btn btn-ghost" id="btn-discard">放弃修改</button>' +
      '</div>';
    var area = c.querySelector('#edit-area');
    area.addEventListener('input', function () {
      if (S.editing) S.editing.dirty = true;
    });
    c.querySelector('#btn-commit').addEventListener('click', function () { commitEdit(c); });
    c.querySelector('#btn-discard').addEventListener('click', function () {
      if (S.editing && S.editing.dirty) {
        ui.confirm({ title: '放弃修改', message: '确定放弃对 ' + baseName(path) + ' 的未保存修改？', okText: '放弃', danger: true }).then(function (ok) {
          if (ok) { S.editing = null; openFile(c, path); }
        });
      } else { S.editing = null; openFile(c, path); }
    });
  }

  function renderReadOnly(c, path, d) {
    var body = c.querySelector('#edit-file-body');
    var ext = extOf(path);
    var isImg = IMG_EXT.indexOf(ext) !== -1;
    if (isImg && d.content && d.encoding === 'base64') {
      var mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
      var dataUrl = 'data:' + mime + ';base64,' + d.content.replace(/\s/g, '');
      body.innerHTML = '<div class="file-image"><img src="' + dataUrl + '" alt="' + escapeHtml(baseName(path)) + '"/></div>' +
        '<div class="file-note muted">二进制图片文件，不可在线编辑。可下载或右键删除。</div>';
      return;
    }
    if (d.size > MAX_LOAD) {
      body.innerHTML = '<div class="file-big">该文件较大（' + formatBytes(d.size) + '），超出编辑器加载上限。' +
        '<div class="file-big-act"><button class="btn btn-sm" id="btn-dl-big">⬇ 下载到本地</button></div></div>';
    } else {
      body.innerHTML = '<div class="file-bin">这是二进制文件，无法在线编辑内容。' +
        '<div class="file-big-act"><button class="btn btn-sm" id="btn-dl-bin">⬇ 下载到本地</button></div></div>';
    }
    var b1 = c.querySelector('#btn-dl-big'); if (b1) b1.addEventListener('click', function () { downloadFile(c, path); });
    var b2 = c.querySelector('#btn-dl-bin'); if (b2) b2.addEventListener('click', function () { downloadFile(c, path); });
  }

  function commitEdit(c) {
    var ed = S.editing;
    if (!ed) { ui.toast('没有可提交的内容', 'warn'); return; }
    var info = repoInfo();
    if (!info) return;
    var area = c.querySelector('#edit-area');
    var msgInput = c.querySelector('#edit-msg');
    var text = area ? area.value : '';
    var msg = (msgInput && msgInput.value || '').trim() || ('Update ' + baseName(ed.path));
    var btn = c.querySelector('#btn-commit');
    if (!text && !ed.dirty) { ui.toast('内容未改动', 'warn'); return; }
    ui.setBusy(btn, true, '提交中');
    var content = strToBase64(text);
    api.putFile(info.owner, info.name, ed.path, {
      message: msg, content: content, branch: S.branch, sha: ed.sha
    }).then(function () {
      ui.toast('已提交到 ' + S.branch, 'success');
      ed.sha = null; ed.dirty = false;
      if (GP.app && GP.app.afterPush) GP.app.afterPush();
      refreshTree(c);
    }).catch(function (e) {
      handleCommitError(c, e, ed, msg, text);
    }).finally(function () { ui.setBusy(btn, false); });
  }

  function handleCommitError(c, e, ed, msg, text) {
    if (e.status === 409) {
      // 冲突：远程文件已被更新（sha 不一致）
      ui.confirm({
        title: '提交冲突',
        message: '远程文件 ' + baseName(ed.path) + ' 已被更新（SHA 不一致），直接覆盖会丢失别人的修改。\n是否拉取最新版本并覆盖？',
        okText: '拉取并覆盖', danger: true
      }).then(function (ok) {
        if (!ok) { ui.toast('已取消提交，未覆盖远程内容', 'info'); return; }
        overwriteLatest(c, ed, msg, text);
      });
    } else if (e.status === 403) {
      if (GP.api.state.rate && GP.api.state.rate.remaining === 0) {
        ui.toast('API 调用额度已用尽，请稍后再提交（403 限流）', 'error', 5000);
      } else {
        ui.toast('Token 权限不足：需要 Contents 读写权限才能提交（403）', 'error', 5000);
      }
    } else if (e.status === 422) {
      ui.toast('提交被拒绝：' + (e.message || '分支状态异常'), 'error', 5000);
    } else if (e.status === 404) {
      ui.toast('文件不存在（可能已被删除）：' + (e.message || ''), 'error');
      refreshTree(c);
    } else {
      ui.toast('提交失败：' + (e.message || '未知错误'), 'error');
    }
  }

  function overwriteLatest(c, ed, msg, text) {
    var info = repoInfo();
    if (!info) return;
    api.getContent(info.owner, info.name, ed.path, S.branch).then(function (d) {
      return api.putFile(info.owner, info.name, ed.path, {
        message: msg, content: strToBase64(text), branch: S.branch, sha: d.sha
      });
    }).then(function () {
      ui.toast('已覆盖远程最新版本', 'success');
      ed.sha = null; ed.dirty = false;
      refreshTree(c);
    }).catch(function (e) {
      ui.toast('覆盖失败：' + (e.message || '未知错误'), 'error');
    });
  }

  /* ============== 下载 ============== */
  function downloadFile(c, path) {
    var info = repoInfo();
    if (!info) return;
    ui.toast('准备下载 ' + baseName(path), 'info');
    api.getContent(info.owner, info.name, path, S.branch).then(function (d) {
      return new Promise(function (resolve, reject) {
        if (d.content && d.encoding === 'base64') {
          try { resolve(new Blob([base64ToBytes(d.content)], { type: 'application/octet-stream' })); }
          catch (e) { reject(e); }
        } else if (d.download_url) {
          fetch(d.download_url).then(function (r) { return r.blob(); }).then(resolve).catch(reject);
        } else reject(new Error('无法获取文件内容'));
      });
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = baseName(path);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      ui.toast('已开始下载 ' + baseName(path), 'success');
    }).catch(function (e) {
      ui.toast('下载失败：' + (e.message || '未知错误'), 'error');
    });
  }

  /* ============== 新建 / 重命名 / 删除 ============== */
  function promptNewFile(c, parent) {
    ui.openModal({
      title: '新建文件', width: 420, okText: '创建',
      body: '<div class="form-item"><label>父目录</label><div class="muted">' + escapeHtml(parent || '/（仓库根）') + '</div></div>' +
        '<div class="form-item"><label for="nf-name">文件名</label><input id="nf-name" class="input" placeholder="例如 index.html" autocomplete="off" /></div>',
      onOk: function () {
        var name = (document.getElementById('nf-name').value || '').trim();
        if (!name) { ui.toast('请输入文件名', 'warn'); return false; }
        if (/[\/\\]/.test(name)) { ui.toast('文件名不能包含路径分隔符', 'warn'); return false; }
        var path = joinPath(parent, name);
        var info = repoInfo();
        if (!info) return false;
        ui.closeModal && ui.closeModal();
        var btn = document.querySelector('.modal-footer .btn-primary'); ui.setBusy(btn, true, '创建中');
        return api.putFile(info.owner, info.name, path, {
          message: 'Create ' + path, content: strToBase64(''), branch: S.branch
        }).then(function () {
          ui.toast('已创建 ' + path, 'success');
          if (GP.app && GP.app.afterPush) GP.app.afterPush();
          refreshTree(c);
        }).catch(function (e) { apiErrToast(e); }).finally(function () { ui.setBusy(btn, false); });
      }
    });
  }

  function promptNewFolder(c, parent) {
    ui.openModal({
      title: '新建文件夹', width: 420, okText: '创建',
      body: '<div class="form-item"><label>父目录</label><div class="muted">' + escapeHtml(parent || '/（仓库根）') + '</div></div>' +
        '<div class="form-item"><label for="nd-name">文件夹名</label><input id="nd-name" class="input" placeholder="例如 src" autocomplete="off" /></div>' +
        '<div class="hint">Git 不能保存空文件夹，将创建一个占位文件 <code>.gitkeep</code></div>',
      onOk: function () {
        var name = (document.getElementById('nd-name').value || '').trim();
        if (!name) { ui.toast('请输入文件夹名', 'warn'); return false; }
        if (/[\/\\]/.test(name)) { ui.toast('文件夹名不能包含路径分隔符', 'warn'); return false; }
        var path = joinPath(parent, name, '.gitkeep');
        var info = repoInfo();
        if (!info) return false;
        ui.closeModal && ui.closeModal();
        var btn = document.querySelector('.modal-footer .btn-primary'); ui.setBusy(btn, true, '创建中');
        return api.putFile(info.owner, info.name, path, {
          message: 'Create folder ' + name, content: strToBase64(''), branch: S.branch
        }).then(function () {
          ui.toast('已创建文件夹 ' + joinPath(parent, name), 'success');
          if (GP.app && GP.app.afterPush) GP.app.afterPush();
          refreshTree(c);
        }).catch(function (e) { apiErrToast(e); }).finally(function () { ui.setBusy(btn, false); });
      }
    });
  }

  function promptRename(c, path, kind) {
    var base = baseName(path);
    var parent = parentPath(path);
    ui.openModal({
      title: kind === 'dir' ? '重命名文件夹' : '重命名文件', width: 440, okText: '确定',
      body: '<div class="form-item"><label for="rn-name">新名称</label><input id="rn-name" class="input" value="' + escapeHtml(base) + '" autocomplete="off" /></div>' +
        '<div class="hint">父目录：' + escapeHtml(parent || '/（仓库根）') + '</div>',
      onOk: function () {
        var name = (document.getElementById('rn-name').value || '').trim();
        if (!name || name === base) { ui.toast('名称未改变', 'warn'); return false; }
        if (/[\/\\]/.test(name)) { ui.toast('名称不能包含路径分隔符', 'warn'); return false; }
        var newPath = joinPath(parent, name);
        var info = repoInfo();
        if (!info) return false;
        ui.closeModal && ui.closeModal();
        var toast = ui.progressToast('重命名：' + base + ' → ' + name);
        toast.update(2, '准备中…');
        renamePath(info, path, newPath, S.branch, 'Rename ' + base + ' → ' + name, toast)
          .then(function (n) {
            toast.done('✅ 已重命名（处理 ' + n + ' 项）');
            if (S.editing && S.editing.path === path) { S.editing = null; }
            if (GP.app && GP.app.afterPush) GP.app.afterPush();
            refreshTree(c);
          })
          .catch(function (e) {
            console.error('[rename]', e);
            toast.fail('❌ ' + (e.message || '重命名失败'));
            apiErrToast(e);
          });
        return true;
      }
    });
  }

  function confirmDelete(c, path, kind) {
    ui.confirm({
      title: '删除' + (kind === 'dir' ? '文件夹' : '文件'),
      message: '确定删除 ' + (kind === 'dir' ? '文件夹及其全部内容' : baseName(path)) + '？\n' + escapeHtml(path) + '\n此操作会创建一次提交，不可撤销。',
      okText: '删除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      var info = repoInfo();
      if (!info) return;
      var toast = ui.progressToast('删除中：' + baseName(path));
      deletePath(info, path, S.branch, 'Delete ' + baseName(path), c)
        .then(function (n) {
          toast.done('✅ 已删除（' + n + ' 个文件）');
          if (S.editing && (S.editing.path === path || S.editing.path.indexOf(path + '/') === 0)) S.editing = null;
          if (GP.app && GP.app.afterPush) GP.app.afterPush();
          refreshTree(c);
        })
        .catch(function (e) { toast.fail('❌ ' + (e.message || '删除失败')); apiErrToast(e); });
    });
  }

  // 递归删除（文件或目录）
  function deletePath(info, path, branch, message, c) {
    var count = 0;
    function walk(p) {
      return api.getContent(info.owner, info.name, p, branch).then(function (d) {
        if (Array.isArray(d)) {
          var chain = Promise.resolve();
          d.forEach(function (child) {
            chain = chain.then(function () { return walk(child.path); });
          });
          return chain.then(function () { return count; });
        }
        // 文件
        return api.deleteFile(info.owner, info.name, p, { message: message, sha: d.sha, branch: branch }).then(function () {
          count++; return count;
        });
      });
    }
    return walk(path);
  }

  // 用 Git Data API 一次提交完成重命名（适用于单文件或目录）
  function renamePath(info, oldPath, newPath, branch, message, toast) {
    return (async function () {
      toast.update(10, '读取分支引用…');
      var ref = await api.getRef(info.owner, info.name, 'heads/' + branch);
      var parentSha = ref.object.sha;
      toast.update(20, '读取父提交…');
      var parentCommit = await api.getCommit(info.owner, info.name, parentSha);
      var baseTreeSha = parentCommit.tree ? parentCommit.tree.sha : null;

      toast.update(35, '读取文件树…');
      var tree = await api.getTree(info.owner, info.name, baseTreeSha || parentSha, true);
      if (tree.truncated) {
        // 仓库超大：递归树被截断 -> 退回 Contents API（putFile + deleteFile）
        toast.log('仓库过大，自动改用 Contents API 分步提交…');
        return renameViaContents(info, oldPath, newPath, branch, message, toast);
      }
      var entries = tree.tree || [];
      var oldPrefix = oldPath + '/';
      var newItems = [];
      var moved = 0;
      for (var i = 0; i < entries.length; i++) {
        var it = entries[i];
        if (it.path === oldPath || it.path.indexOf(oldPrefix) === 0) {
          var newItemPath = newPath + it.path.substring(oldPath.length);
          if (it.type === 'blob' || it.type === 'tree') {
            // 旧路径：显式删除（sha 置 null，否则 createTree 会原样继承）
            newItems.push({ path: it.path, mode: it.mode, type: it.type, sha: null });
            // 新路径：保留原 sha 与 mode 新增
            newItems.push({ path: newItemPath, mode: it.mode, type: it.type, sha: it.sha });
            moved++;
          }
        }
        // 其他项不列出：createTree(base_tree) 会自动继承（除被显式删除的）
      }
      if (!moved) throw new Error('在 tree 中没有找到要重命名的项：' + oldPath);

      toast.update(60, '构造新 tree…');
      var treeBody = { tree: newItems };
      if (baseTreeSha) treeBody.base_tree = baseTreeSha;
      var newTree = await api.createTree(info.owner, info.name, treeBody.tree, treeBody.base_tree);

      toast.update(78, '创建提交…');
      var newCommit = await api.createCommit(info.owner, info.name, message, newTree.sha, [parentSha]);

      toast.update(90, '更新分支指针…');
      await api.updateRef(info.owner, info.name, 'heads/' + branch, newCommit.sha, false);

      toast.update(100, '提交完成');
      return moved;
    })();
  }

  // Contents API 兜底（用于超大仓库或被截断的 tree）
  function renameViaContents(info, oldPath, newPath, branch, message, toast) {
    var count = 0, total = 1;
    function walk(oldP, newP) {
      return api.getContent(info.owner, info.name, oldP, branch).then(function (d) {
        if (Array.isArray(d)) {
          var chain = Promise.resolve();
          total += d.length;
          d.forEach(function (child) {
            chain = chain.then(function () { return walk(child.path, joinPath(newP, baseName(child.path))); });
          });
          return chain;
        }
        return api.putFile(info.owner, info.name, newP, {
          message: message, content: d.content, encoding: d.encoding || 'base64', branch: branch
        }).then(function () {
          return api.deleteFile(info.owner, info.name, oldP, { message: message, sha: d.sha, branch: branch });
        }).then(function () {
          count++;
          toast.update(Math.min(95, 30 + count / Math.max(1, total) * 60), '已处理 ' + count + ' / ' + total);
        });
      });
    }
    return walk(oldPath, newPath).then(function () { return count; });
  }

  function apiErrToast(e) {
    if (e.status === 403) {
      if (GP.api.state.rate && GP.api.state.rate.remaining === 0) ui.toast('API 额度用尽，请稍后再试（403 限流）', 'error', 5000);
      else ui.toast('Token 权限不足：需要 Contents 读写权限（403）', 'error', 5000);
    } else if (e.status === 409) {
      ui.toast('操作冲突：资源已被更新，请刷新后重试（409）', 'error', 5000);
    } else if (e.status === 422) {
      ui.toast('操作被拒绝：' + (e.message || '校验失败'), 'error', 5000);
    } else if (e.status === 404) {
      ui.toast('资源不存在：' + (e.message || ''), 'error');
    } else {
      ui.toast('操作失败：' + (e.message || '未知错误'), 'error');
    }
  }

  /* ============== 刷新（操作后自动刷新文件树） ============== */
  function refreshTree(c) {
    S.entries = {}; S.loaded = {}; S.pending = {};
    if (S.sig !== (S.full + '@' + S.branch)) S.sig = S.full + '@' + S.branch;
    loadRoot(c).then(function () { reExpand(c); });
  }

  function reExpand(c) {
    var paths = Object.keys(S.expanded).filter(function (p) { return S.expanded[p]; });
    paths.sort(function (a, b) { return a.split('/').length - b.split('/').length; });
    var chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        if (S.loaded[p]) return Promise.resolve();
        var parent = parentPath(p);
        var arr = S.entries[parent] || [];
        var e = arr.filter(function (x) { return x.path === baseName(p); })[0];
        if (e) { S.expanded[p] = true; return ensureSubtree(p, e.sha, c); }
        return Promise.resolve();
      });
    });
    return chain.then(function () { renderTreeOnly(c); });
  }

  /* ============== 主流程 ============== */
  function resetState() {
    S.entries = {}; S.expanded = {}; S.loaded = {}; S.pending = {};
    S.selected = ''; S.editing = null;
  }

  function loadRoot(c) {
    var cur = GP.app.state.current;
    if (!cur) {
      var tb = c.querySelector('#edit-tree-body');
      if (tb) tb.innerHTML = '<div class="tree-empty muted">请先在左侧选择一个仓库</div>';
      return Promise.resolve();
    }
    S.full = cur.full_name;
    S.branch = GP.app.state.branch || cur.default_branch || 'main';
    var info = repoInfo();
    resetState();
    renderTreeRoot(c);
    return api.getRef(info.owner, info.name, 'heads/' + S.branch).then(function (ref) {
      return api.getTree(info.owner, info.name, ref.object.sha, false).then(function (root) {
        S.entries[''] = (root.tree || []).filter(function (t) { return t.path && t.type; }).map(function (t) {
          return { path: t.path, type: t.type, size: t.size || 0, sha: t.sha || '' };
        });
        S.loaded[''] = true;
        S.sig = S.full + '@' + S.branch;
        if (root.truncated) ui.toast('该仓库单层目录过大，已超出 GitHub 单次返回上限，仅显示部分文件', 'warn', 5000);
        renderTreeOnly(c);
        var main = c.querySelector('#edit-file-body');
        if (!S.entries[''].length) {
          main.innerHTML = '<div class="file-empty muted">📭 这是一个空仓库，右键文件树可新建文件。</div>';
        } else if (!S.selected) {
          main.innerHTML = ui.emptyState('✎', '选择一个文件进行编辑', '从左侧文件树点击任意文本文件即可在线编辑；右键可新建/重命名/删除');
        }
      });
    }).catch(function (e) {
      var tb = c.querySelector('#edit-tree-body');
      if (e.status === 404) {
        tb.innerHTML = '<div class="tree-empty muted">该分支（' + escapeHtml(S.branch) + '）暂无可浏览的提交</div>';
        S.sig = S.full + '@' + S.branch;
        var main = c.querySelector('#edit-file-body');
        if (main) main.innerHTML = ui.emptyState('✎', '空分支', '该分支还没有任何提交，可右键新建文件');
        return;
      }
      if (tb) tb.innerHTML = '<div class="tree-error">文件树加载失败：' + escapeHtml(e.message || '未知错误') + '</div>';
      ui.toast('文件树加载失败：' + (e.message || '未知错误'), 'error');
    });
  }

  function render(c) {
    var cur = GP.app.state.current;
    var fullNow = cur ? cur.full_name : '';
    var branchNow = GP.app.state.branch || (cur && cur.default_branch) || 'main';
    c.innerHTML =
      '<div class="explore-layout edit-layout">' +
        '<div class="explore-tree edit-tree">' +
          '<div class="explore-tree-head">' +
            '<span>📂 文件树（右键操作）</span>' +
            '<span class="tree-head-right"><span class="muted" id="edit-tree-count"></span>' +
            '<button class="btn btn-ghost btn-sm" id="btn-multi-toggle">' + (S.multi ? '☑ 取消多选' : '☐ 多选') + '</button></span>' +
          '</div>' +
          '<div class="tree-scroll" id="edit-tree-body"><div class="tree-empty muted">加载中…</div></div>' +
          '<div class="multi-bar" id="multi-bar" hidden>' +
            '<span id="multi-count">已选 0 项</span>' +
            '<button class="btn btn-danger btn-sm" id="btn-multi-del" disabled>批量删除</button>' +
            '<button class="btn btn-ghost btn-sm" id="btn-multi-clear">清空选择</button>' +
          '</div>' +
        '</div>' +
        '<div class="explore-main">' +
          '<div class="explore-file-head" id="edit-file-head"></div>' +
          '<div class="explore-file-body" id="edit-file-body">' + ui.emptyState('✎', '选择一个文件进行编辑', '从左侧文件树点击任意文本文件即可在线编辑；右键可新建/重命名/删除') + '</div>' +
        '</div>' +
      '</div>';
    bindTree(c);
    var mt = c.querySelector('#btn-multi-toggle');
    if (mt) mt.addEventListener('click', function () {
      S.multi = !S.multi;
      if (!S.multi) S.multiSel = {};
      this.textContent = S.multi ? '☑ 取消多选' : '☐ 多选';
      renderTreeOnly(c);
    });
    var md = c.querySelector('#btn-multi-del');
    if (md) md.addEventListener('click', function () { batchDelete(c); });
    var mc = c.querySelector('#btn-multi-clear');
    if (mc) mc.addEventListener('click', function () { S.multiSel = {}; renderTreeOnly(c); });
    if (S.sig === (fullNow + '@' + branchNow)) {
      renderTreeOnly(c);
      if (S.selected && GP.app.state.current) openFile(c, S.selected);
    } else {
      loadRoot(c);
    }
  }

  // 批量删除：收集选中路径下所有 blob，逐个删除（目录递归）
  async function batchDelete(c) {
    var paths = Object.keys(S.multiSel).filter(function (p) { return S.multiSel[p]; });
    if (!paths.length) { ui.toast('请先勾选要删除的文件/目录', 'warn'); return; }
    var ok = await ui.confirm({ title: '批量删除', message: '确定删除选中的 ' + paths.length + ' 项（含其下所有文件）？此操作不可撤销。', okText: '删除', danger: true });
    if (!ok) return;
    var info = repoInfo();
    if (!info) return;
    var branch = S.branch;
    var files = [];
    async function collect(p) {
      var d = await api.getContent(info.owner, info.name, p, branch);
      if (Array.isArray(d)) {
        for (var i = 0; i < d.length; i++) {
          await collect(p ? p + '/' + d[i].path : d[i].path);
        }
      } else if (d && d.sha) {
        files.push({ path: p, sha: d.sha });
      }
    }
    var toast = ui.progressToast('批量删除：' + paths.length + ' 项');
    try {
      for (var k = 0; k < paths.length; k++) {
        await collect(paths[k]);
      }
      toast.update(30, '已收集 ' + files.length + ' 个文件，开始删除…');
      for (var j = 0; j < files.length; j++) {
        await api.deleteFile(info.owner, info.name, files[j].path, { message: 'Batch delete ' + files[j].path, sha: files[j].sha, branch: branch });
        toast.update(30 + Math.round((j + 1) / Math.max(1, files.length) * 60), '已删除 ' + (j + 1) + ' / ' + files.length);
      }
      toast.done('✅ 已删除 ' + files.length + ' 个文件');
      S.multiSel = {};
      refreshTree(c);
    } catch (e) {
      toast.fail('❌ ' + (e.message || '批量删除失败'));
      apiErrToast(e);
      console.error('[batchDelete]', e);
    }
  }

  GP.app.modules.edit = {
    render: render,
    onBranchChange: function () { S.sig = ''; S.multi = false; S.multiSel = {}; },
    onRepoChange: function () { S.sig = ''; S.multi = false; S.multiSel = {}; },
    onAfterPush: function () {
      if (GP.app.state.view === 'edit') {
        var c = document.getElementById('panel-edit');
        if (c) refreshTree(c);
      }
    }
  };
})(window.GP);
