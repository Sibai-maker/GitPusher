/* GitPusher · 应用主逻辑（M1：认证 / 仓库管理 / 视图框架） */
window.GP = window.GP || {};
(function (GP) {
  'use strict';
  const { api, ui, util } = GP;
  const { escapeHtml, timeAgo, formatBytes, debounce } = util;

  const app = {
    state: {
      repos: [],
      keyword: '',
      current: null,   // 当前仓库对象
      branch: '',      // 当前分支
      branches: [],
      view: 'upload',  // upload | explore | edit
    },
    /** 各功能模块注册点：{ render(el), onActivate?, onBranchChange? } */
    modules: {},
  };

  const el = function (id) { return document.getElementById(id); };

  /* ================= 视图切换 ================= */
  function showAuth(errorMsg) {
    el('topbar').hidden = true;
    el('view-main').hidden = true;
    el('view-auth').hidden = false;
    const tip = el('auth-error');
    if (tip) {
      tip.hidden = !errorMsg;
      tip.textContent = errorMsg || '';
    }
    const input = el('token-input');
    if (input) input.value = api.token || '';
  }

  function showMain() {
    el('view-auth').hidden = true;
    el('view-main').hidden = false;
    el('topbar').hidden = false;
  }

  function renderRate() {
    const box = el('rate-info');
    if (!box) return;
    if (!api.state.rate) { box.textContent = ''; return; }
    const r = api.state.rate;
    box.textContent = 'API ' + r.remaining + '/' + r.limit;
    box.className = 'rate' + (r.remaining < 20 ? ' rate-warn' : '');
    box.title = 'GitHub API 本小时剩余调用次数：' + r.remaining + ' / ' + r.limit;
  }
  app.renderRate = renderRate;

  function renderUser(user) {
    el('user-chip').innerHTML =
      '<img class="avatar" src="' + escapeHtml(user.avatar_url) + '" alt="" />' +
      '<span class="uname">' + escapeHtml(user.login) + '</span>';
  }

  /* ================= 仓库列表 ================= */
  function filteredRepos() {
    const kw = app.state.keyword.trim().toLowerCase();
    if (!kw) return app.state.repos;
    return app.state.repos.filter(function (r) {
      return (r.full_name || '').toLowerCase().indexOf(kw) !== -1 ||
        (r.description || '').toLowerCase().indexOf(kw) !== -1;
    });
  }

  function renderRepoList() {
    const list = filteredRepos();
    const box = el('repo-list');
    if (!app.state.repos.length) {
      box.innerHTML = '<div class="repo-empty">暂无仓库</div>';
    } else if (!list.length) {
      box.innerHTML = '<div class="repo-empty">没有匹配的仓库</div>';
    } else {
      box.innerHTML = list.map(function (r) {
        const active = app.state.current && app.state.current.id === r.id;
        return '<div class="repo-item' + (active ? ' active' : '') + '" data-id="' + r.id + '" data-full="' +
          escapeHtml(r.full_name) + '">' +
          '<div class="repo-item-top">' +
          '<span class="repo-name">' + escapeHtml(r.name) + '</span>' +
          '<span class="badge badge-' + (r.private ? 'private' : 'public') + '">' + (r.private ? '私有' : '公开') + '</span>' +
          '</div>' +
          '<div class="repo-meta">' +
          (r.language ? '<span class="lang"><i class="dot"></i>' + escapeHtml(r.language) + '</span>' : '') +
          '<span>' + timeAgo(r.updated_at) + '</span>' +
          '</div></div>';
      }).join('');
      box.querySelectorAll('.repo-item').forEach(function (node) {
        node.addEventListener('click', function () {
          const full = node.dataset.full;
          const repo = app.state.repos.find(function (x) { return x.full_name === full; });
          if (repo) selectRepo(repo);
        });
      });
    }
    el('sidebar-foot').textContent = '共 ' + app.state.repos.length + ' 个仓库' + (list.length !== app.state.repos.length ? '（筛选 ' + list.length + '）' : '');
  }

  async function loadRepos(silent) {
    const btn = el('btn-refresh');
    if (!silent) {
      btn.classList.add('spinning');
      btn.disabled = true;
    }
    try {
      const repos = await api.listAllRepos(10);
      repos.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
      app.state.repos = repos;
      renderRepoList();
      // 若当前选中仓库被删除或首次加载，默认选中第一个
      if (!app.state.current || !repos.some(function (r) { return r.id === app.state.current.id; })) {
        if (repos.length) selectRepo(repos[0]);
        else renderRepoHeader(null);
      }
      if (!silent) ui.toast('已加载 ' + repos.length + ' 个仓库', 'success');
    } catch (e) {
      ui.toast(e.message || '仓库列表加载失败', 'error');
    } finally {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
  }
  app.loadRepos = loadRepos;

  async function selectRepo(repo) {
    app.state.current = repo;
    renderRepoList();
    renderRepoHeader(repo);
    try {
      const branches = await api.listBranches(repo.owner.login, repo.name);
      app.state.branches = branches || [];
      app.state.branch = repo.default_branch && branches.some(function (b) { return b.name === repo.default_branch; })
        ? repo.default_branch
        : (branches[0] ? branches[0].name : 'main');
    } catch (e) {
      app.state.branches = [];
      app.state.branch = repo.default_branch || 'main';
    }
    renderBranchBar();
    notifyModules('onRepoChange');
    renderActivePanel();
  }
  app.selectRepo = selectRepo;

  function renderRepoHeader(repo) {
    const box = el('repo-header');
    if (!repo) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<div class="repo-head-left">' +
      '<h2 class="repo-title">' + escapeHtml(repo.full_name) +
      '<span class="badge badge-' + (repo.private ? 'private' : 'public') + '">' + (repo.private ? '私有' : '公开') + '</span></h2>' +
      '<p class="repo-desc">' + (repo.description ? escapeHtml(repo.description) : '<span class="muted">暂无描述</span>') + '</p>' +
      '</div>' +
      '<div class="repo-head-right">' +
      '<a class="btn btn-ghost btn-sm" href="' + escapeHtml(repo.html_url) + '" target="_blank" rel="noopener">在 GitHub 打开 ↗</a>' +
      '<button class="btn btn-ghost btn-sm" id="btn-copy-clone" title="复制克隆地址">复制地址</button>' +
      '</div>';
    const copyBtn = el('btn-copy-clone');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        const url = repo.clone_url;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(
            function () { ui.toast('已复制：' + url, 'success'); },
            function () { ui.toast('复制失败，请手动复制：' + url, 'warn'); }
          );
        } else {
          ui.toast('请手动复制：' + url, 'warn');
        }
      });
    }
    el('repo-stat').innerHTML =
      '<span>⭐ ' + repo.stargazers_count + '</span>' +
      '<span>⑂ ' + repo.forks_count + '</span>' +
      '<span>' + formatBytes((repo.size || 0) * 1024) + '</span>' +
      '<span>更新于 ' + timeAgo(repo.updated_at) + '</span>';
  }

  function renderBranchBar() {
    const box = el('branch-bar');
    if (!app.state.current) { box.innerHTML = ''; return; }
    const opts = app.state.branches.map(function (b) {
      return '<option value="' + escapeHtml(b.name) + '"' + (b.name === app.state.branch ? ' selected' : '') + '>' + escapeHtml(b.name) + '</option>';
    }).join('');
    box.innerHTML =
      '<label class="branch-label" for="branch-select">分支</label>' +
      '<select id="branch-select" class="select select-sm">' + opts + '</select>' +
      '<button class="btn btn-ghost btn-sm" id="btn-refresh-branch" title="重新拉取分支内容">↻</button>';
    const sel = el('branch-select');
    sel.addEventListener('change', function () {
      app.state.branch = sel.value;
      notifyModules('onBranchChange');
      renderActivePanel();
      ui.toast('已切换到分支 ' + sel.value, 'success');
    });
    el('btn-refresh-branch').addEventListener('click', async function () {
      const cur = app.state.current;
      if (!cur) { notifyModules('onBranchChange'); renderActivePanel(); return; }
      // 真去 GitHub 重新拉分支，让顶部小下拉和模块内部都拿到最新列表
      try {
        const branches = await api.listBranches(cur.owner.login, cur.name);
        app.state.branches = branches || [];
      } catch (e) { ui.toast('刷新分支失败：' + (e.message || '未知错误'), 'error'); }
      renderBranchBar();
      notifyModules('onBranchChange');
      renderActivePanel();
    });
  }

  /* ================= 面板渲染 ================= */
  function renderActivePanel() {
    const view = app.state.view;
    ['upload', 'explore', 'edit', 'history'].forEach(function (v) {
      const p = el('panel-' + v);
      if (p) p.hidden = v !== view;
    });
    const mod = app.modules[view];
    const container = el('panel-' + view);
    if (mod && typeof mod.render === 'function') {
      try { mod.render(container); } catch (e) { console.error(e); container.innerHTML = ui.emptyState('⚠', '模块渲染异常', escapeHtml(e.message)); }
    }
  }
  app.renderActivePanel = renderActivePanel;

  function setView(view) {
    app.state.view = view;
    document.querySelectorAll('#tabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === view);
    });
    renderActivePanel();
    notifyModules('onActivate');
  }

  function notifyModules(hook) {
    Object.keys(app.modules).forEach(function (k) {
      const m = app.modules[k];
      if (m && typeof m[hook] === 'function') {
        try { m[hook](); } catch (e) { console.error('[' + k + '.' + hook + ']', e); }
      }
    });
  }

  /* ================= 新建仓库 ================= */
  function openNewRepoModal() {
    ui.openModal({
      title: '新建 GitHub 仓库',
      width: 480,
      okText: '创建',
      body:
        '<div class="form-item"><label for="nr-name">仓库名称 <span class="req">*</span></label>' +
        '<input id="nr-name" class="input" placeholder="例如 my-project" autocomplete="off" />' +
        '<div class="hint">只能包含字母、数字、点、下划线和连字符</div></div>' +
        '<div class="form-item"><label for="nr-desc">描述（可选）</label>' +
        '<input id="nr-desc" class="input" placeholder="一句话介绍这个项目" /></div>' +
        '<div class="form-item"><label for="nr-ignore">.gitignore 模板（可选）</label>' +
        '<select id="nr-ignore" class="select"><option value="">无</option>' +
        ['Node', 'Python', 'Java', 'Go', 'Rust', 'VisualStudioCode', 'C++', 'Ruby', 'PHP', 'Swift'].map(function (t) {
          return '<option value="' + t + '">' + t + '</option>';
        }).join('') + '</select></div>' +
        '<div class="form-row">' +
        '<label class="checkbox"><input type="checkbox" id="nr-private" checked /><span>私有仓库</span></label>' +
        '<label class="checkbox"><input type="checkbox" id="nr-init" checked /><span>初始化 README</span></label>' +
        '</div>',
      onOk: async function () {
        const name = (el('nr-name').value || '').trim();
        if (!name) { ui.toast('请填写仓库名称', 'warn'); return false; }
        if (!/^[A-Za-z0-9._-]+$/.test(name)) { ui.toast('仓库名称含有非法字符', 'warn'); return false; }
        const btn = document.querySelector('.modal-footer .btn-primary');
        ui.setBusy(btn, true, '创建中');
        try {
          const repo = await api.createRepo({
            name: name,
            description: (el('nr-desc').value || '').trim(),
            private: el('nr-private').checked,
            auto_init: el('nr-init').checked,
            gitignore_template: el('nr-ignore').value || undefined,
          });
          ui.toast('仓库 ' + repo.full_name + ' 创建成功', 'success');
          await loadRepos(true);
          const found = app.state.repos.find(function (r) { return r.id === repo.id; });
          if (found) selectRepo(found);
        } catch (e) {
          // 把 GitHub 英文错误翻译成人话，最常见的是 Fine-grained token 缺 Administration: Write 权限
          if (e.status === 403 && /Resource not accessible by personal access token/i.test(e.message || '')) {
            ui.toast('Token 权限不足：新建仓库需要 Administration 读写权限（Fine-grained）或 repo 全部勾选（Classic）', 'error', 6000);
            console.warn('[新建仓库] 原因：当前 Token 不能创建仓库。修复：\n' +
              '  · Classic Token（推荐）：勾选 repo、workflow\n' +
              '  · Fine-grained Token：Permissions → Repository → Administration 选 Read and write');
          } else if (e.status === 422) {
            ui.toast('仓库名称已存在或校验失败：' + (e.message || ''), 'error', 6000);
          } else {
            ui.toast('创建失败：' + (e.message || '未知错误'), 'error', 5000);
          }
        } finally {
          ui.setBusy(btn, false);
        }
      },
    });
  }

  /* ================= 登录 ================= */
  async function doLogin() {
    const token = (el('token-input').value || '').trim();
    if (!token) { ui.toast('请输入 GitHub Token', 'warn'); return; }
    const btn = el('btn-login');
    ui.setBusy(btn, true, '验证中');
    api.setToken(token);
    try {
      const user = await api.getUser();
      renderUser(user);
      showMain();
      ui.toast('欢迎，' + user.login, 'success');
      await loadRepos(true);
    } catch (e) {
      api.clearToken();
      showAuth(e.status === 401 ? 'Token 无效或已过期，请检查后重试' : (e.message || '登录失败'));
      ui.toast(e.message || '登录失败', 'error');
    } finally {
      ui.setBusy(btn, false);
    }
  }

  /* ================= 事件绑定 ================= */
  function bindEvents() {
    el('btn-login').addEventListener('click', doLogin);
    el('token-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    el('btn-toggle-token').addEventListener('click', function () {
      const i = el('token-input');
      i.type = i.type === 'password' ? 'text' : 'password';
      this.textContent = i.type === 'password' ? '显示' : '隐藏';
    });
    el('btn-logout').addEventListener('click', async function () {
      const ok = await ui.confirm({ title: '退出登录', message: '将清除本地保存的 Token，确定继续？', okText: '退出', danger: true });
      if (!ok) return;
      api.clearToken();
      app.state.repos = [];
      app.state.current = null;
      renderRepoList();
      showAuth();
    });
    el('btn-settings').addEventListener('click', function () {
      if (GP.app && typeof GP.app.openSettings === 'function') GP.app.openSettings();
      else ui.toast('设置模块未加载', 'error');
    });
    el('btn-refresh').addEventListener('click', function () { loadRepos(false); });
    el('btn-new-repo').addEventListener('click', openNewRepoModal);
    el('repo-search').addEventListener('input', debounce(function (e) {
      app.state.keyword = e.target.value;
      renderRepoList();
    }, 180));
    document.querySelectorAll('#tabs .tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.dataset.view); });
    });
    window.addEventListener('error', function (e) { console.error('[global error]', e.error || e.message); });
  }

  /* ================= 启动 ================= */
  async function bootstrap() {
    bindEvents();
    registerPlaceholders();
    if (!api.token) { showAuth(); return; }
    try {
      const user = await api.getUser();
      renderUser(user);
      showMain();
      renderRepoList();
      await loadRepos(true);
    } catch (e) {
      if (e.status === 401) { api.clearToken(); showAuth('Token 已失效，请重新输入'); }
      else showAuth('加载失败：' + (e.message || '未知错误'));
    }
  }

  /* M3/M4 占位提示；M2、M3 已各自由 upload.js / explore.js 注册，这里只在尚未注册时才占位，避免覆盖 */
  function registerPlaceholders() {
    if (!app.modules.explore) {
      app.modules.explore = {
        render: function (c) {
          c.innerHTML = ui.emptyState('🌳', 'M3 · 在线文件浏览', '正在开发中：文件树、在线预览、单文件下载');
        },
      };
    }
    if (!app.modules.edit) {
      app.modules.edit = {
        render: function (c) {
          c.innerHTML = ui.emptyState('✎', 'M4 · 在线编辑与提交', '正在开发中：编辑/新建/删除文件、填写 commit 信息直接推送');
        },
      };
    }
    if (!app.modules.history) {
      app.modules.history = {
        render: function (c) {
          c.innerHTML = ui.emptyState('📜', 'M5 · 提交历史', '正在开发中：查看分支提交记录与改动文件');
        },
      };
    }
  }

  /* 上传/编辑成功后通知各模块刷新（M3 注册 onAfterPush 后生效） */
  function afterPush() { notifyModules('onAfterPush'); }
  app.afterPush = afterPush;

  /* 顶部小分支下拉：从 GitHub 重新拉取并同步刷新各模块（供 upload.js 在新建分支后调用） */
  app.refreshBranches = async function () {
    const cur = this.state.current;
    if (!cur) return;
    try {
      const branches = await api.listBranches(cur.owner.login, cur.name);
      this.state.branches = branches || [];
    } catch (e) {
      ui.toast('刷新分支失败：' + (e.message || '未知错误'), 'error');
      return;
    }
    renderBranchBar();
    notifyModules('onBranchChange');
    renderActivePanel();
  };

  document.addEventListener('DOMContentLoaded', bootstrap);
  GP.app = app;
})(window.GP);
