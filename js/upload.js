/* GitPusher · M2 本地项目上传模块 */
window.GP = window.GP || {};
(function (GP) {
  'use strict';
  const { api, ui, util } = GP;
  const { escapeHtml, formatBytes, normalizePath, joinPath } = util;

  const MAX_FILE_SIZE = 75 * 1024 * 1024;   // GitHub blob 接口硬上限约 100MB，留余量
  const CONCURRENCY = 8;                     // 分批并发创建 blob（分片并发）

  // 始终忽略（与具体项目无关的安全兜底，任何情况下都不过问）
  const ALWAYS_IGNORE = [
    '.git', 'node_modules', 'dist', 'out', 'win-unpacked',
    '.DS_Store', 'Thumbs.db',
  ];
  // 默认回退忽略（所选文件夹没有 .gitignore 时才用）。
  // 注意：刻意不含 'build' —— 很多项目把图标等源码放在 build/ 下，
  // 是否忽略一律交给项目自己的 .gitignore 决定，避免误伤 icon.ico 之类。
  const DEFAULT_IGNORE = ALWAYS_IGNORE.concat([
    '*.log', '*.tmp', '.idea', '.vscode', '__pycache__', '*.pyc',
    '.cache', 'coverage', 'venv', '.venv', 'env',
  ]);

  const S = {
    folderName: '',
    files: [],        // {file, path, size, selected, tooBig, kind}
    repoFull: '',     // 目标仓库 full_name
    branch: '',       // 目标分支
    branchCache: {},  // full -> [{name, sha}]
  };

  /* ---------------- .gitignore 风格匹配 ---------------- */
  function toRegex(pat) {
    const parts = pat.split('/');
    let re = '';
    parts.forEach(function (part, i) {
      if (part === '') return;
      if (i > 0) re += '\\/';
      if (part === '**') { re += '(?:.*\\/)?'; return; }
      const s = part
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      re += s;
    });
    return re;
  }
  function gitignoreMatch(rule, path) {
    let p = rule.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!p) return false;
    const isDir = rule.trim().endsWith('/');
    const segs = path.split('/').filter(Boolean);
    const base = segs[segs.length - 1];
    // 含路径分隔或 ** 的规则：对完整路径做正则匹配
    if (p.indexOf('/') !== -1 || p.indexOf('**') !== -1) {
      const re = new RegExp('^' + toRegex(p) + (isDir ? '(/.*)?$' : '$'));
      return re.test(path);
    }
    // 纯文件名规则：匹配任意层级的同名文件 / 目录（含其下所有内容）
    const re = new RegExp('^' + toRegex(p) + '$');
    if (re.test(base)) return true;
    if (segs.some(function (s) { return re.test(s); })) return true;
    if (isDir) return path === p || path.indexOf(p + '/') === 0;
    return re.test(path);
  }
  // 与 git 行为一致：忽略规则在任意层级生效。
  // 拖入文件夹时路径带顶层文件夹名（如 tool/electron-app/...），
  // 故对路径本身及其所有"去掉前导目录"的后缀逐一尝试匹配。
  function matchesIgnore(path, rules) {
    const norm = normalizePath(path);
    const segs = norm.split('/').filter(Boolean);
    const candidates = [];
    for (let i = 0; i < segs.length; i++) candidates.push(segs.slice(i).join('/'));
    for (let i = 0; i < rules.length; i++) {
      for (let j = 0; j < candidates.length; j++) {
        if (gitignoreMatch(rules[i], candidates[j])) return true;
      }
    }
    return false;
  }
  function parseRules(text) {
    const raw = (text || '').split('\n').map(function (s) { return s.trim(); });
    return raw.filter(function (s) { return s && !s.startsWith('#'); });
  }

  /* ---------------- 文件采集 ---------------- */
  // 方式1：<input webkitdirectory> 的 FileList
  function fromInput(fileList) {
    return Array.prototype.slice.call(fileList)
      .filter(function (f) { return f && f.name && !f.isDirectory; })
      .map(function (f) {
        return { file: f, path: normalizePath(f.webkitRelativePath || f.relativePath || f.name) };
      });
  }
  // 方式2：拖拽文件夹（webkitGetAsEntry 递归）
  function walkEntry(entry, base, out) {
    return new Promise(function (resolve, reject) {
      if (entry.isFile) {
        entry.file(function (file) {
          out.push({ file: file, path: normalizePath(joinPath(base, file.name)) });
          resolve();
        }, reject);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readBatch = function () {
          reader.readEntries(async function (batch) {
            try {
              if (!batch.length) { resolve(); return; }
              for (const e of batch) await walkEntry(e, joinPath(base, entry.name), out);
              readBatch();
            } catch (err) { reject(err); }
          }, reject);
        };
        readBatch();
      } else { resolve(); }
    });
  }
  async function fromDrop(dt) {
    const out = [];
    const entries = [];
    if (dt.items) {
      for (const item of dt.items) {
        if (item.kind === 'file') {
          const e = item.webkitGetAsEntry && item.webkitGetAsEntry();
          if (e) entries.push(e);
        }
      }
    } else if (dt.files) {
      return fromInput(dt.files);
    }
    for (const e of entries) await walkEntry(e, '', out);
    return out;
  }

  // 在所选文件夹中查找根级 .gitignore（路径形如 ".gitignore" 或 "<folder>/.gitignore"）
  function findGitignore(rawFiles) {
    for (const it of rawFiles) {
      const segs = normalizePath(it.path || '').split('/').filter(Boolean);
      if (segs.length >= 1 && segs.length <= 2 && segs[segs.length - 1] === '.gitignore') return it.file;
    }
    return null;
  }

  // 依据规则文本重新过滤已采集的原始文件（编辑忽略规则后即时生效，无需重新选文件夹）
  function refilterFromRaw(text) {
    const rules = parseRules(text);
    const files = [];
    let ignored = 0;
    for (const item of S.raw) {
      const path = item.path;
      if (!path || path === '') continue;
      if (matchesIgnore(path, rules)) { ignored++; continue; }
      const tooBig = item.file.size > MAX_FILE_SIZE;
      const guess = util.guessTextByName(path);
      const kind = tooBig ? 'big' : (guess === false ? 'bin' : 'txt');
      files.push({
        file: item.file, path: path, size: item.file.size,
        selected: !tooBig, tooBig: tooBig, kind: kind,
      });
    }
    files.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
    S.files = files;
    renderFileList();
    renderStats();
    if (ignored) ui.toast('已忽略 ' + ignored + ' 个文件（按当前忽略规则）', 'info');
  }

  async function ingest(rawFiles, folderName) {
    S.raw = rawFiles;
    const stripped = stripCommonRootPrefix(rawFiles);
    const gi = findGitignore(rawFiles);
    let rulesText = DEFAULT_IGNORE.join('\n');
    if (gi) {
      try {
        const giText = await gi.text();
        const merged = DEFAULT_IGNORE.concat(parseRules(giText));
        const seen = {}; const uniq = [];
        merged.forEach(function (r) { if (!seen[r]) { seen[r] = 1; uniq.push(r); } });
        rulesText = uniq.join('\n');
        S.usingGitignore = true;
      } catch (e) { S.usingGitignore = false; }
    } else {
      S.usingGitignore = false;
    }
    S.rulesText = rulesText;
    const box = document.getElementById('upload-ignore');
    if (box) box.value = rulesText;   // 把实际生效的规则写回文本框，用户可见可改
    refilterFromRaw(rulesText);
    S.folderName = folderName || (S.files[0] ? S.files[0].path.split('/')[0] : '');
    if (!S.files.length) ui.toast('未选中任何文件（可能全部被忽略或文件夹为空）', 'warn');
    else if (S.usingGitignore) ui.toast('已按所选文件夹的 .gitignore 自动过滤', 'info');
    if (stripped) ui.toast('已自动剥离顶层目录「' + stripped + '」，文件将上传到仓库根目录', 'info', 3500);
  }

  // 自动剥离所有文件共同的顶层目录前缀（例如拖入 "tool/" 文件夹时，去掉 "tool/" 让文件上传到仓库根目录）
  function stripCommonRootPrefix(rawFiles) {
    if (!rawFiles || !rawFiles.length) return '';
    const segs = rawFiles.map(function (it) { return ((it.path || '').split('/')[0] || ''); });
    if (segs.some(function (s) { return !s; })) return '';
    const first = segs[0];
    if (!segs.every(function (s) { return s === first; })) return '';
    if (first.charAt(0) === '.') return ''; // 不动 .github / .gitignore 等
    const prefix = first + '/';
    for (const it of rawFiles) {
      if (it.path && it.path.startsWith(prefix)) it.path = it.path.substring(prefix.length);
    }
    return first;
  }

  /* ---------------- 渲染 ---------------- */
  function repoOptions() {
    const repos = GP.app.state.repos || [];
    if (!S.repoFull && GP.app.state.current) S.repoFull = GP.app.state.current.full_name;
    return repos.map(function (r) {
      return '<option value="' + escapeHtml(r.full_name) + '"' +
        (r.full_name === S.repoFull ? ' selected' : '') + '>' + escapeHtml(r.full_name) + '</option>';
    }).join('') || '<option value="">（无仓库）</option>';
  }
  async function ensureBranches(full) {
    if (S.branchCache[full]) return S.branchCache[full];
    const owner = full.split('/')[0], name = full.split('/')[1];
    let branches = [];
    try {
      const repo = await api.getRepo(owner, name);
      S.defaultBranch = repo.default_branch || 'main';
      branches = await api.listBranches(owner, name);
    } catch (e) { /* ignore，后续上传时会再报错 */ }
    const list = (branches || []).map(function (b) { return { name: b.name, sha: b.commit && b.commit.sha }; });
    if (!S.branch) S.branch = S.defaultBranch || (list[0] && list[0].name) || 'main';
    S.branchCache[full] = list;
    return list;
  }
  function branchOptions() {
    const list = S.branchCache[S.repoFull] || [];
    let opts = '';
    if (!list.length) {
      // 空仓库：还没有任何分支，把"将创建的首个分支"显示为可选项（默认 main）
      const first = (S.branch && S.branch !== '__new__') ? S.branch : (S.defaultBranch || 'main');
      opts = '<option value="' + escapeHtml(first) + '" selected>' + escapeHtml(first) + '</option>';
    } else {
      opts = list.map(function (b) {
        return '<option value="' + escapeHtml(b.name) + '"' + (b.name === S.branch ? ' selected' : '') + '>' + escapeHtml(b.name) + '</option>';
      }).join('');
    }
    opts += '<option value="__new__"' + (S.branch === '__new__' ? ' selected' : '') + '>➕ 新建分支…</option>';
    return opts;
  }

  function renderFileList() {
    const box = document.getElementById('upload-filelist');
    if (!box) return;
    if (!S.files.length) {
      box.innerHTML = '<div class="file-row" style="color:var(--text-mute)">尚未选择文件夹</div>';
      return;
    }
    const rows = S.files.map(function (f, i) {
      const tag = f.tooBig
        ? '<span class="ftag big">过大</span>'
        : '<span class="ftag ' + (f.kind === 'bin' ? 'bin' : 'txt') + '">' + (f.kind === 'bin' ? '二进制' : '文本') + '</span>';
      return '<label class="file-row' + (f.tooBig ? ' too-big' : '') + '">' +
        '<input type="checkbox" data-i="' + i + '"' + (f.selected ? ' checked' : '') + (f.tooBig ? ' disabled' : '') + ' />' +
        '<span class="fname"><span class="fpath">' + escapeHtml(f.path) + '</span></span>' +
        tag +
        '<span class="fsize">' + formatBytes(f.size) + '</span>' +
        '</label>';
    }).join('');
    box.innerHTML = rows;
    box.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const i = +cb.dataset.i;
        S.files[i].selected = cb.checked;
        renderStats();
      });
    });
  }

  function renderStats() {
    const sel = S.files.filter(function (f) { return f.selected; });
    const total = sel.reduce(function (s, f) { return s + f.size; }, 0);
    const elTotal = document.getElementById('upload-stat');
    if (elTotal) elTotal.textContent = '已选 ' + sel.length + ' / 共 ' + S.files.length + ' 个文件 · 合计 ' + formatBytes(total);
    const allCb = document.getElementById('upload-selectall');
    if (allCb) {
      const ok = S.files.filter(function (f) { return !f.tooBig; });
      allCb.checked = ok.length > 0 && ok.every(function (f) { return f.selected; });
      allCb.indeterminate = !allCb.checked && sel.length > 0;
    }
  }

  function render(container) {
    if (!GP.app.state.repos || !GP.app.state.repos.length) {
      container.innerHTML = ui.emptyState('⬆', '还没有仓库', '请先新建一个 GitHub 仓库，或在左侧选择一个目标仓库。');
      return;
    }
    container.innerHTML =
      '<div class="upload-wrap">' +
      '<div class="dropzone" id="upload-dz">' +
      '<div class="dz-icon">📁</div>' +
      '<div class="dz-title">拖拽文件夹到此处，或点击选择文件夹</div>' +
      '<div class="dz-sub">支持多级子目录，自动保留完整目录结构；若文件夹含 .gitignore 会自动按其规则过滤（node_modules / dist 等默认忽略）</div>' +
      '<input type="file" id="upload-input" webkitdirectory directory multiple hidden />' +
      '</div>' +
      '<div class="folder-info" id="upload-folder"' + (S.folderName ? '' : ' hidden') + '>' +
      '<span>已选择文件夹：<b id="upload-foldername">' + escapeHtml(S.folderName) + '</b>，共 <b id="upload-count">' + S.files.length + '</b> 个文件</span>' +
      '<button class="btn btn-ghost btn-sm" id="upload-repick">重新选择</button>' +
      '</div>' +

      '<div class="collapse">' +
      '<div class="collapse-head" id="upload-ignore-head">忽略规则（.gitignore 风格）<span class="muted">▾</span></div>' +
      '<div class="collapse-body" id="upload-ignore-body">' +
      '<textarea class="input" id="upload-ignore" rows="4" spellcheck="false">' + escapeHtml(S.rulesText || DEFAULT_IGNORE.join('\n')) + '</textarea>' +
      '<div class="hint">每行一个规则，如 <code>*.log</code>、<code>build/</code>、<code>.cache</code>；<code>#</code> 开头为注释。若所选文件夹含 <code>.gitignore</code> 会自动合并其规则，且此处修改后立即生效，无需重新选择文件夹。</div>' +
      '</div></div>' +

      '<div class="file-list" id="upload-filelist-wrap"' + (S.files.length ? '' : ' hidden') + '>' +
      '<div class="file-list-head">' +
      '<label><input type="checkbox" id="upload-selectall" /> 全选</label>' +
      '<span id="upload-stat" class="spacer"></span>' +
      '</div>' +
      '<div class="file-scroll" id="upload-filelist"></div>' +
      '</div>' +

      '<div class="upload-opts">' +
      '<div class="form-item"><label>目标仓库</label><select class="select" id="upload-repo">' + repoOptions() + '</select></div>' +
      '<div class="form-item"><label>目标分支</label>' +
      '<div class="branch-row"><select class="select" id="upload-branch">' + branchOptions() + '</select>' +
      '<button class="btn btn-ghost btn-sm" id="upload-newbranch" type="button">➕ 新建</button></div>' +
      '</div>' +
      '</div>' +
      '<div class="card commit-box"><div class="form-item" style="margin:0"><label for="upload-msg">提交信息（Commit message）</label>' +
      '<textarea class="input" id="upload-msg" placeholder="Upload project via GitPusher">Upload project via GitPusher</textarea></div>' +
      '<label class="opt-force"><input type="checkbox" id="upload-force" /> 强制覆盖（当远程分支已被更新、本地提交被拒时使用，会丢弃远程改动）</label>' +
      '</div>' +

      '<div class="upload-actions">' +
      '<button class="btn btn-primary" id="upload-btn">⬆ 上传到 GitHub</button>' +
      '<span class="muted" id="upload-status"></span>' +
      '</div>' +
      '<div class="upload-progress" id="upload-progress" hidden>' +
      '<div class="progress"><div class="progress-inner" id="upload-bar"></div></div>' +
      '<div class="upload-log" id="upload-log"></div>' +
      '</div>' +
      '</div>';

    bind(container);
    renderFileList();
    renderStats();
  }

  /* ---------------- 事件 ---------------- */
  function bind(c) {
    const dz = c.querySelector('#upload-dz');
    const input = c.querySelector('#upload-input');
    dz.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      const raw = fromInput(input.files);
      const name = input.files && input.files[0]
        ? (input.files[0].webkitRelativePath || input.files[0].name).split('/')[0] : 'folder';
      ingest(raw, name);
      c.querySelector('#upload-folder').hidden = false;
      c.querySelector('#upload-filelist-wrap').hidden = false;
      c.querySelector('#upload-count').textContent = S.files.length;
      c.querySelector('#upload-foldername').textContent = S.folderName;
    });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
    dz.addEventListener('drop', async function (e) {
      e.preventDefault(); dz.classList.remove('drag');
      const raw = await fromDrop(e.dataTransfer);
      const name = raw[0] ? raw[0].path.split('/')[0] : 'folder';
      ingest(raw, name);
      c.querySelector('#upload-folder').hidden = false;
      c.querySelector('#upload-filelist-wrap').hidden = false;
      c.querySelector('#upload-count').textContent = S.files.length;
      c.querySelector('#upload-foldername').textContent = S.folderName;
    });
    c.querySelector('#upload-repick').addEventListener('click', function () { input.click(); });

    const igHead = c.querySelector('#upload-ignore-head');
    igHead.addEventListener('click', function () {
      const b = c.querySelector('#upload-ignore-body');
      b.hidden = !b.hidden;
      igHead.querySelector('.muted').textContent = b.hidden ? '▸' : '▾';
    });
    const igBox = c.querySelector('#upload-ignore');
    if (igBox) igBox.addEventListener('input', function () { refilterFromRaw(igBox.value); });

    const repoSel = c.querySelector('#upload-repo');
    repoSel.addEventListener('change', async function () {
      S.repoFull = repoSel.value; S.branch = '';
      const list = await ensureBranches(S.repoFull);
      c.querySelector('#upload-branch').innerHTML = branchOptions();
    });
    // 初次进入默认仓库分支
    if (!S.branchCache[S.repoFull]) { ensureBranches(S.repoFull).then(function () { const bs = c.querySelector('#upload-branch'); if (bs) bs.innerHTML = branchOptions(); }); }

    const branchSel = c.querySelector('#upload-branch');
    branchSel.addEventListener('change', function () {
      if (branchSel.value === '__new__') {
        promptNewBranch(c);
      } else {
        S.branch = branchSel.value;
      }
    });
    const nbBtn = c.querySelector('#upload-newbranch');
    if (nbBtn) nbBtn.addEventListener('click', function () { promptNewBranch(c); });

    c.querySelector('#upload-selectall').addEventListener('change', function (e) {
      const v = e.target.checked;
      S.files.forEach(function (f) { if (!f.tooBig) f.selected = v; });
      renderFileList(); renderStats();
    });

    c.querySelector('#upload-btn').addEventListener('click', function () { doUpload(c); });
  }

  async function promptNewBranch(c) {
    // 先确保分支列表已加载（空仓库时列表为空，但 defaultBranch 已知）
    if (!S.branchCache[S.repoFull]) { try { await ensureBranches(S.repoFull); } catch (e) {} }
    const list = S.branchCache[S.repoFull] || [];
    const isEmpty = list.length === 0;

    let body;
    if (isEmpty) {
      // 空仓库：没有任何可"基于"的分支，提交时会直接用新分支名创建首个提交
      body =
        '<div class="form-item"><label for="nb-name">新分支名称（将作为仓库首个分支）</label>' +
        '<input class="input" id="nb-name" placeholder="例如 main" autocomplete="off" /></div>' +
        '<div class="hint">该仓库还没有任何分支。提交时 GitPusher 会直接以这个分支名创建首个提交，' +
        'GitHub 会自动将其设为默认分支（建议填 <code>main</code>）。</div>';
    } else {
      const opts = list.map(function (b) {
        return '<option value="' + escapeHtml(b.name) + '">' + escapeHtml(b.name) + '</option>';
      }).join('');
      body =
        '<div class="form-item"><label for="nb-name">新分支名称</label>' +
        '<input class="input" id="nb-name" placeholder="例如 feature/upload" autocomplete="off" /></div>' +
        '<div class="form-item"><label for="nb-base">基于哪个分支创建</label>' +
        '<select class="select" id="nb-base">' + opts + '</select></div>' +
        '<div class="hint">分支将立即创建到 GitHub，创建后顶部小下拉与下方目标分支都会同步出现。</div>';
    }

    ui.openModal({
      title: '新建分支',
      width: 420,
      okText: isEmpty ? '确定' : '创建',
      body: body,
      onOk: async function () {
        const name = (document.getElementById('nb-name').value || '').trim();
        if (!/^[A-Za-z0-9._\/-]+$/.test(name)) { ui.toast('分支名含有非法字符', 'warn'); return false; }
        const btn = document.querySelector('.modal-footer .btn-primary');
        ui.setBusy(btn, true, isEmpty ? '准备中' : '创建中');
        try {
          const owner = S.repoFull.split('/')[0], rname = S.repoFull.split('/')[1];
          if (isEmpty) {
            // 空仓库：无法基于已有分支，直接把目标分支设为新名，
            // 交由上传流程在创建首个提交时一并 createRef（见 doUpload 第 5 步）。
            S.branch = name;
            S.branchCache[S.repoFull] = [{ name: name, sha: null }];
            const bs = c.querySelector('#upload-branch');
            if (bs) { bs.innerHTML = branchOptions(); bs.value = name; }
            ui.toast('已设定首个分支为「' + name + '」，上传后自动创建', 'success');
            return true; // 关闭弹窗
          }
          const base = document.getElementById('nb-base').value || S.defaultBranch || 'main';
          const ref = await api.getRef(owner, rname, 'heads/' + base);
          await api.createRef(owner, rname, name, ref.object.sha);
          // 立即刷新两处下拉
          delete S.branchCache[S.repoFull];
          await ensureBranches(S.repoFull);
          S.branch = name;
          if (GP.app && GP.app.refreshBranches) { try { await GP.app.refreshBranches(); } catch (e) {} }
          const bs = c.querySelector('#upload-branch');
          if (bs) { bs.innerHTML = branchOptions(); bs.value = name; }
          ui.toast('已创建分支 ' + name, 'success');
        } catch (e) {
          if (e.status === 422) ui.toast('分支 ' + name + ' 已存在', 'warn', 4000);
          else if (e.status === 403) ui.toast('Token 缺少 Contents 写权限，无法创建分支（Classic 需勾 repo；Fine-grained 需 Contents: Read and write）', 'error', 6000);
          else if (e.status === 404 || e.status === 409) {
            // 基础分支不存在（404）或仓库为空（409），无法用 getRef 拿 sha；改为空仓库逻辑
            // ——只设目标分支名，由 doUpload 引导时一并 createRef
            S.branch = name;
            S.branchCache[S.repoFull] = [{ name: name, sha: null }];
            const bs = c.querySelector('#upload-branch');
            if (bs) { bs.innerHTML = branchOptions(); bs.value = name; }
            ui.toast('已将「' + name + '」设为待创建的首个分支，上传时自动建立', 'success');
            ui.setBusy(btn, false);
            return true; // 关闭弹窗
          }
          else ui.toast('创建分支失败：' + (e.message || '未知错误'), 'error', 5000);
          ui.setBusy(btn, false);
          return false; // 保留弹窗，让用户重试或取消
        } finally {
          ui.setBusy(btn, false);
        }
      },
    });
  }

  /* ---------------- 并发上传 ---------------- */
  function mapLimit(items, limit, fn, onProgress) {
    const results = new Array(items.length);
    let i = 0, done = 0;
    async function worker() {
      while (i < items.length) {
        const cur = i++;
        try { results[cur] = await fn(items[cur]); }
        catch (e) { results[cur] = { error: e }; }
        done++;
        if (onProgress) onProgress(done, items.length);
      }
    }
    const n = Math.min(limit, items.length);
    const workers = [];
    for (let k = 0; k < n; k++) workers.push(worker());
    return Promise.all(workers).then(function () { return results; });
  }

  function readFile(file) {
    return file.arrayBuffer().then(function (buf) {
      const bytes = new Uint8Array(buf);
      if (util.looksBinary(bytes)) return { content: util.bytesToBase64(bytes), encoding: 'base64' };
      return { content: new TextDecoder().decode(bytes), encoding: 'utf-8' };
    });
  }

  async function doUpload(c) {
    const btn = c.querySelector('#upload-btn');
    if (ui && btn && btn.disabled) return;
    const sel = S.files.filter(function (f) { return f.selected; });
    if (!sel.length) { ui.toast('没有可上传的文件，请先选择文件夹并勾选', 'warn'); return; }
    if (!S.repoFull) { ui.toast('请选择目标仓库', 'warn'); return; }

    // 解析目标分支（下拉选中的即目标，新建分支已在弹窗中立即创建到 GitHub）
    let targetBranch = S.branch;
    if (!targetBranch || targetBranch === '__new__') {
      ui.toast('请选择一个目标分支（可在下拉中新建）', 'warn');
      ui.setBusy(btn, false);
      return;
    }

    const owner = S.repoFull.split('/')[0];
    const name = S.repoFull.split('/')[1];
    const msg = (c.querySelector('#upload-msg').value || '').trim() || 'Upload project via GitPusher';
    const force = c.querySelector('#upload-force').checked;

    const prog = c.querySelector('#upload-progress');
    prog.hidden = false;
    const bar = c.querySelector('#upload-bar');
    const log = c.querySelector('#upload-log');
    ui.setBusy(btn, true, '上传中');

    const toast = ui.progressToast('正在批量上传 ' + sel.length + ' 个文件…');

    try {
      // 1) 取目标分支当前最新 commit 作为 parent（保留仓库已有文件树）
      let parentSha = null, baseTreeSha = null, branchExists = true, bootstrapped = false;
      try {
        const ref = await api.getRef(owner, name, 'heads/' + targetBranch);
        parentSha = ref.object.sha;
        const ci = await api.getCommit(owner, name, parentSha);
        baseTreeSha = ci.tree ? ci.tree.sha : null;
      } catch (e) {
        // 空仓库的 getRef 返回 409 "Git Repository is empty"，分支不存在返回 404，两种都视为需创建分支
        if (e.status === 404 || e.status === 409) branchExists = false;
        else throw e;
      }
      if (!branchExists) {
        // 2) bootstrap：空仓库的 Git Data API（createBlob / createTree / createCommit）全部会返回 409 "Git Repository is empty"
        //    用 Contents API putFile 推一个占位文件，GitHub 会自动建首个 commit + 目标分支
        const first = sel[0];
        const firstData = await readFile(first.file);
        // Contents API 的 content 必须是 base64（无 encoding 字段），readFile 对文本返回的是 utf-8 字符串，这里统一转 base64
        const base64Content = firstData.encoding === 'base64'
          ? firstData.content
          : btoa(unescape(encodeURIComponent(firstData.content)));
        log.textContent += '➤ 空仓库引导：用 ' + first.path + ' 建立首个 commit…\n';
        toast.update(5, '引导空仓库…');
        bar.style.width = '5%';
        try {
          await api.putFile(owner, name, first.path, {
            message: 'Initial commit (bootstrap by GitPusher)',
            content: base64Content,
            branch: targetBranch,
          });
        } catch (e) {
          throw new Error('空仓库引导失败：' + (e.message || '未知错误') + '（可能 Token 权限不足，或 Contents API 被限制）');
        }
        // 重新拉 ref / commit / tree
        const ref2 = await api.getRef(owner, name, 'heads/' + targetBranch);
        parentSha = ref2.object.sha;
        const ci2 = await api.getCommit(owner, name, parentSha);
        baseTreeSha = ci2.tree ? ci2.tree.sha : null;
        branchExists = true;
        bootstrapped = true;
      }

      // 3) 分批并发创建 blob
      log.textContent += '➤ 读取并创建文件对象…\n';
      const results = await mapLimit(sel, CONCURRENCY, async function (f) {
        const data = await readFile(f.file);
        const blob = await api.createBlob(owner, name, data.content, data.encoding);
        return { path: f.path, sha: blob.sha, size: f.size };
      }, function (done, total) {
        const pct = Math.round((done / total) * 80); // 80% 给 blob，20% 给 commit
        toast.update(pct, '上传对象 ' + done + '/' + total);
        bar.style.width = pct + '%';
        if (done % 10 === 0 || done === total) log.textContent += '已传 ' + done + '/' + total + '\n';
      });

      const failed = results.filter(function (r) { return r.error; });
      if (failed.length) {
        const first = failed[0].error;
        throw new Error('有 ' + failed.length + ' 个文件上传失败：' + (first.message || '未知错误'));
      }

      // 4) 构建 tree 并提交
      toast.update(85, '组装提交…');
      bar.style.width = '85%';
      log.textContent += '➤ 组装目录树…\n';
      const tree = results.map(function (r) {
        return { path: r.path, mode: '100644', type: 'blob', sha: r.sha };
      });
      const newTree = await api.createTree(owner, name, tree, baseTreeSha || undefined);
      const newCommit = await api.createCommit(owner, name, msg, newTree.sha, parentSha ? [parentSha] : []);

      // 5) 更新引用（分支不存在 -> createRef；已存在 -> updateRef）
      log.textContent += '➤ 更新分支引用…\n';
      const finalBranch = targetBranch;
      try {
        if (branchExists) {
          await api.updateRef(owner, name, 'heads/' + finalBranch, newCommit.sha, force);
        } else {
          await api.createRef(owner, name, finalBranch, newCommit.sha);
          log.textContent += '✓ 已创建分支 ' + finalBranch + '\n';
        }
      } catch (e) {
        if (e.status === 422) {
          throw new Error('提交被拒绝：远程分支 ' + finalBranch + ' 已被更新（可能有人或你已推送新内容）。可勾选"强制覆盖"重试，或先点顶部分支↻刷新。');
        }
        throw e;
      }

      bar.style.width = '100%';
      toast.done('✅ 已上传 ' + sel.length + ' 个文件到 ' + S.repoFull + '@' + finalBranch);
      log.textContent += '✅ 提交成功：' + newCommit.sha.slice(0, 10) + '\n';
      ui.setBusy(btn, false);

      // 成功后：刷新仓库（M3 接手后自动刷新文件树）
      if (GP.app && GP.app.afterPush) GP.app.afterPush();
      ui.toast('上传完成！已推送到 ' + S.repoFull + '@' + targetBranch, 'success');
    } catch (e) {
      bar.classList.add('err');
      toast.fail('❌ ' + (e.message || '上传失败'));
      log.textContent += '❌ 错误：' + (e.message || '上传失败') + '\n';
      ui.setBusy(btn, false);
      if (e.status === 403 && api.state.rate && api.state.rate.remaining === 0) {
        ui.toast('GitHub API 额度已用尽，请稍后重试', 'error');
      } else if (e.status === 401) {
        ui.toast('Token 失效，请重新登录', 'error');
      } else {
        ui.toast('上传失败：' + (e.message || '未知错误'), 'error');
      }
    }
  }

  /* ---------------- 注册 ---------------- */
  GP.app.modules.upload = {
    render: render,
    onRepoChange: function () { if (!S.repoFull && GP.app.state.current) S.repoFull = GP.app.state.current.full_name; },
    // 每次切回 M2 Tab，都把当前仓库的分支缓存丢掉重拉，保证目标分支下拉和顶部小下拉永远同步
    onActivate: async function () {
      const c = document.getElementById('panel-upload');
      if (!c) return;
      const full = S.repoFull || (GP.app.state.current && GP.app.state.current.full_name);
      if (!full) return;
      delete S.branchCache[full];
      try { await ensureBranches(full); } catch (e) { /* 后续提交再报错 */ }
      const bs = c.querySelector('#upload-branch');
      if (bs) bs.innerHTML = branchOptions();
      const rs = c.querySelector('#upload-repo');
      if (rs) rs.value = full;
    },
  };
})(window.GP);
