/* GitPusher · GitHub REST API 封装 */
window.GP = window.GP || {};
(function (GP) {
  'use strict';

  const API = 'https://api.github.com';
  const TOKEN_KEY = 'gp_token_v1';

  class GitHubError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'GitHubError';
      this.status = status;
      this.payload = payload;
    }
  }

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: null,
    rate: null, // {remaining, limit, reset}
  };

  function readRate(res) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const limit = res.headers.get('x-ratelimit-limit');
    if (remaining !== null) {
      state.rate = {
        remaining: parseInt(remaining, 10),
        limit: parseInt(limit || '0', 10),
      };
      if (window.GP.app && typeof window.GP.app.renderRate === 'function') window.GP.app.renderRate();
    }
  }

  async function request(path, options) {
    const opt = options || {};
    const method = (opt.method || 'GET').toUpperCase();
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, opt.timeout || 60000);

    const headers = {
      Accept: opt.accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
      ...(opt.headers || {}),
    };

    let body = opt.body;
    if (body && typeof body !== 'string' && !(body instanceof ArrayBuffer)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(API + path, {
        method: method,
        headers: headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new GitHubError('请求超时，请检查网络后重试', 0, null);
      throw new GitHubError('网络请求失败：' + (err.message || '无法连接 api.github.com'), 0, null);
    }
    clearTimeout(timer);
    readRate(res);

    if (res.status === 204) return null;

    const ctype = res.headers.get('content-type') || '';
    let data = null;
    if (ctype.indexOf('json') !== -1) {
      data = await res.json().catch(function () { return null; });
    } else {
      data = await res.text().catch(function () { return ''; });
    }

    if (!res.ok) {
      let msg = (data && data.message) || '请求失败（HTTP ' + res.status + '）';
      if (res.status === 401) msg = 'Token 无效或已过期（401）';
      else if (res.status === 403 && state.rate && state.rate.remaining === 0) msg = 'API 调用额度已用尽，请稍后再试（403）';
      else if (res.status === 404) msg = (data && data.message) || '资源不存在（404）';
      const err = new GitHubError(msg, res.status, data);
      if (data && data.errors) err.errors = data.errors;
      throw err;
    }
    return data;
  }

  const api = {
    GitHubError,
    state,
    get token() { return state.token; },
    get user() { return state.user; },

    setToken(t) {
      state.token = (t || '').trim();
      if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
      else localStorage.removeItem(TOKEN_KEY);
    },
    clearToken() {
      state.token = '';
      state.user = null;
      localStorage.removeItem(TOKEN_KEY);
    },

    /* ---------- 用户 & 仓库 ---------- */
    async getUser() {
      const d = await request('/user');
      state.user = d;
      return d;
    },

    async listRepos(opts) {
      const o = opts || {};
      return request(
        '/user/repos?per_page=' + (o.perPage || 100) + '&page=' + (o.page || 1) +
        '&sort=' + (o.sort || 'updated') + '&direction=desc&affiliation=' + (o.affiliation || 'owner')
      );
    },

    async listAllRepos(maxPages) {
      const limit = maxPages || 10;
      const out = [];
      for (let p = 1; p <= limit; p++) {
        const list = await api.listRepos({ page: p, perPage: 100 });
        if (!Array.isArray(list) || list.length === 0) break;
        out.push.apply(out, list);
        if (list.length < 100) break;
      }
      return out;
    },

    async createRepo(payload) {
      return request('/user/repos', {
        method: 'POST',
        body: {
          name: payload.name,
          description: payload.description || '',
          private: !!payload.private,
          auto_init: !!payload.auto_init,
          gitignore_template: payload.gitignore_template || undefined,
          has_issues: true,
          has_wiki: false,
          has_projects: false,
        },
      });
    },

    async getRepo(owner, repo) {
      return request('/repos/' + owner + '/' + repo);
    },

    async updateRepo(owner, repo, payload) {
      return request('/repos/' + owner + '/' + repo, {
        method: 'PATCH',
        body: payload,
      });
    },

    async deleteRepo(owner, repo) {
      return request('/repos/' + owner + '/' + repo, {
        method: 'DELETE',
      });
    },

    async listBranches(owner, repo) {
      return request('/repos/' + owner + '/' + repo + '/branches?per_page=100');
    },

    async getBranch(owner, repo, branch) {
      return request('/repos/' + owner + '/' + repo + '/branches/' + encodeURIComponent(branch));
    },

    async getCommit(owner, repo, sha) {
      return request('/repos/' + owner + '/' + repo + '/git/commits/' + encodeURIComponent(sha));
    },

    /* ---------- 内容读取 ---------- */
    async getTree(owner, repo, ref, recursive) {
      const q = recursive === false ? '' : '?recursive=1';
      return request('/repos/' + owner + '/' + repo + '/git/trees/' + encodeURIComponent(ref) + q);
    },

    async getBlob(owner, repo, sha) {
      return request('/repos/' + owner + '/' + repo + '/git/blobs/' + sha);
    },

    async getContent(owner, repo, path, ref) {
      const q = ref ? '?ref=' + encodeURIComponent(ref) : '';
      return request('/repos/' + owner + '/' + repo + '/contents/' +
        encodeURI(path || '').replace(/%2F/g, '/') + q);
    },

    /* ---------- Git 写入（批量提交用） ---------- */
    async createBlob(owner, repo, content, encoding) {
      return request('/repos/' + owner + '/' + repo + '/git/blobs', {
        method: 'POST',
        body: { content: content, encoding: encoding || 'utf-8' },
      });
    },

    async createTree(owner, repo, tree, base_tree) {
      const body = { tree: tree };
      if (base_tree) body.base_tree = base_tree;
      return request('/repos/' + owner + '/' + repo + '/git/trees', { method: 'POST', body: body });
    },

    async createCommit(owner, repo, message, treeSha, parents) {
      return request('/repos/' + owner + '/' + repo + '/git/commits', {
        method: 'POST',
        body: { message: message, tree: treeSha, parents: parents || [] },
      });
    },

    async getRef(owner, repo, ref) {
      // git ref path 必须字面斜杠（'heads/main'），不能 encode 成 'heads%2Fmain'
      return request('/repos/' + owner + '/' + repo + '/git/ref/' + encodeURI(ref).replace(/%2F/g, '/'));
    },

    async updateRef(owner, repo, ref, sha, force) {
      return request('/repos/' + owner + '/' + repo + '/git/refs/' + encodeURI(ref).replace(/%2F/g, '/'), {
        method: 'PATCH',
        body: { sha: sha, force: !!force },
      });
    },

    async createRef(owner, repo, ref, sha) {
      return request('/repos/' + owner + '/' + repo + '/git/refs', {
        method: 'POST',
        body: { ref: 'refs/heads/' + ref, sha: sha },
      });
    },

    async listCommits(owner, repo, opts) {
      const o = opts || {};
      const qs = ['per_page=' + (o.per_page || 30)];
      if (o.sha) qs.push('sha=' + encodeURIComponent(o.sha));
      if (o.path) qs.push('path=' + encodeURIComponent(o.path));
      return request('/repos/' + owner + '/' + repo + '/commits?' + qs.join('&'));
    },

    /* ---------- 单文件写入 / 删除 ---------- */
    async putFile(owner, repo, path, payload) {
      const body = {
        message: payload.message,
        content: payload.content, // base64
        branch: payload.branch,
      };
      if (payload.sha) body.sha = payload.sha;
      if (payload.encoding) body.encoding = payload.encoding;
      return request('/repos/' + owner + '/' + repo + '/contents/' +
        encodeURI(path).replace(/%2F/g, '/'), { method: 'PUT', body: body });
    },

    async deleteFile(owner, repo, path, payload) {
      return request('/repos/' + owner + '/' + repo + '/contents/' +
        encodeURI(path).replace(/%2F/g, '/'), {
        method: 'DELETE',
        body: { message: payload.message, sha: payload.sha, branch: payload.branch },
      });
    },
  };

  GP.api = api;
})(window.GP);
