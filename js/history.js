/* GitPusher · M5：提交历史查看模块 */
window.GP = window.GP || {};
(function (GP) {
  'use strict';
  const { api, ui, util } = GP;
  const { escapeHtml, timeAgo, formatBytes } = util;

  let S = { list: [], openSha: null, loading: false };

  function repoInfo() {
    const cur = GP.app.state.current;
    if (!cur) return null;
    return { owner: cur.owner.login, name: cur.name, branch: GP.app.state.branch || cur.default_branch || 'main' };
  }

  function render(c) {
    const info = repoInfo();
    if (!info) { c.innerHTML = ui.emptyState('📜', '提交历史', '请先在左侧选择一个仓库'); return; }
    c.innerHTML =
      '<div class="history-head">' +
        '<div class="history-title">📜 提交历史 · <b>' + escapeHtml(info.owner + '/' + info.name) + '</b> @ ' + escapeHtml(info.branch) + '</div>' +
        '<button class="btn btn-ghost btn-sm" id="hist-refresh">↻ 刷新</button>' +
      '</div>' +
      '<div class="history-list" id="hist-list"></div>';
    c.querySelector('#hist-refresh').addEventListener('click', function () { load(c); });
    load(c);
  }

  async function load(c) {
    const info = repoInfo();
    const box = c.querySelector('#hist-list');
    if (!info || !box) return;
    S.loading = true;
    box.innerHTML = '<div class="tree-loading">加载提交历史…</div>';
    try {
      const commits = await api.listCommits(info.owner, info.name, { sha: info.branch, per_page: 40 });
      S.list = commits || [];
      if (!S.list.length) {
        box.innerHTML = '<div class="tree-empty">该分支暂无提交记录</div>';
        return;
      }
      box.innerHTML = S.list.map(function (cm, i) {
        const sha = cm.sha;
        const msg = (cm.commit && cm.commit.message ? cm.commit.message : '').split('\n')[0] || '(无信息)';
        const author = (cm.author && cm.author.login) || (cm.commit && cm.commit.author && cm.commit.author.name) || 'unknown';
        const avatar = cm.author && cm.author.avatar_url ? cm.author.avatar_url : '';
        const date = (cm.commit && cm.commit.author && cm.commit.author.date) || cm.commit && cm.commit.committer && cm.commit.committer.date;
        const open = S.openSha === sha;
        return '<div class="commit-item' + (open ? ' open' : '') + '" data-sha="' + escapeHtml(sha) + '">' +
          '<div class="commit-row">' +
            (avatar ? '<img class="commit-avatar" src="' + escapeHtml(avatar) + '" alt="" />' : '<span class="commit-avatar commit-avatar-ph"></span>') +
            '<div class="commit-main">' +
              '<div class="commit-msg">' + escapeHtml(msg) + '</div>' +
              '<div class="commit-meta"><span>' + escapeHtml(author) + '</span><span>· ' + timeAgo(date) + '</span><span class="commit-sha">#' + escapeHtml(sha.substring(0, 7)) + '</span></div>' +
            '</div>' +
            '<span class="commit-toggle">' + (open ? '▾' : '▸') + '</span>' +
          '</div>' +
          '<div class="commit-files" id="cf-' + escapeHtml(sha) + '" hidden></div>' +
        '</div>';
      }).join('');
      box.querySelectorAll('.commit-item').forEach(function (node) {
        node.querySelector('.commit-row').addEventListener('click', function () {
          const sha = node.dataset.sha;
          if (S.openSha === sha) { S.openSha = null; node.classList.remove('open'); node.querySelector('.commit-files').hidden = true; node.querySelector('.commit-toggle').textContent = '▸'; return; }
          S.openSha = sha;
          box.querySelectorAll('.commit-item').forEach(function (n) { n.classList.remove('open'); n.querySelector('.commit-files').hidden = true; n.querySelector('.commit-toggle').textContent = '▸'; });
          node.classList.add('open');
          node.querySelector('.commit-toggle').textContent = '▾';
          loadFiles(info, sha, node.querySelector('.commit-files'));
        });
      });
    } catch (e) {
      if (e.status === 404 || e.status === 409) box.innerHTML = '<div class="tree-empty">该分支暂无提交记录</div>';
      else { ui.toast('提交历史加载失败：' + (e.message || '未知错误'), 'error'); box.innerHTML = '<div class="tree-error">加载失败：' + escapeHtml(e.message || '') + '</div>'; }
    } finally {
      S.loading = false;
    }
  }

  async function loadFiles(info, sha, box) {
    box.hidden = false;
    box.innerHTML = '<div class="tree-loading">加载改动文件…</div>';
    try {
      const commit = await api.getCommit(info.owner, info.name, sha);
      const files = (commit && commit.files) || [];
      if (!files.length) { box.innerHTML = '<div class="commit-file-empty">本次提交没有文件改动</div>'; return; }
      box.innerHTML = files.map(function (f) {
        const st = f.status || 'modified';
        const cls = st === 'added' ? 'add' : st === 'removed' ? 'del' : 'mod';
        const add = f.additions || 0, del = f.deletions || 0;
        return '<div class="commit-file">' +
          '<span class="cf-badge ' + cls + '">' + badgeText(st) + '</span>' +
          '<span class="cf-name">' + escapeHtml(f.filename) + '</span>' +
          '<span class="cf-stat">+' + add + ' -' + del + '</span>' +
        '</div>';
      }).join('');
    } catch (e) {
      box.innerHTML = '<div class="tree-error">文件列表加载失败：' + escapeHtml(e.message || '') + '</div>';
    }
  }

  function badgeText(st) {
    return st === 'added' ? 'A' : st === 'removed' ? 'D' : st === 'renamed' ? 'R' : st === 'copied' ? 'C' : 'M';
  }

  GP.app.modules.history = {
    render: render,
    onRepoChange: function () { S = { list: [], openSha: null, loading: false }; },
    onBranchChange: function () { S = { list: [], openSha: null, loading: false }; },
  };
})(window.GP);
