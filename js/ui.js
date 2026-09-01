/* GitPusher · 通用 UI 组件（Toast / Modal / Confirm） */
window.GP = window.GP || {};
(function (GP) {
  'use strict';
  const { escapeHtml } = GP.util;

  /* ---------- Toast ---------- */
  function toastRoot() {
    let root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      root.className = 'toast-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function toast(message, type, duration) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    const icon = { info: 'ℹ', success: '✓', warn: '!', error: '✕' }[type || 'info'] || 'ℹ';
    el.innerHTML =
      '<span class="toast-icon">' + icon + '</span>' +
      '<span class="toast-msg">' + escapeHtml(message) + '</span>';
    toastRoot().appendChild(el);
    const life = duration || (type === 'error' ? 6000 : 3200);
    setTimeout(function () {
      el.classList.add('toast-out');
      setTimeout(function () { el.remove(); }, 260);
    }, life);
    return el;
  }

  /* ---------- Modal ---------- */
  function modalRoot() {
    let root = document.getElementById('modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'modal-root';
      document.body.appendChild(root);
    }
    return root;
  }

  /**
   * openModal({title, body, width, okText, cancelText, hideCancel, danger, onOk, onOpen})
   * onOk(close) 可返回 Promise；返回 false 阻止关闭
   */
  function openModal(opts) {
    const o = opts || {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal" style="' + (o.width ? 'max-width:' + o.width + 'px;' : '') + '">' +
      '<div class="modal-head"><h3>' + escapeHtml(o.title || '') + '</h3>' +
      '<button class="modal-x" type="button" aria-label="关闭">✕</button></div>' +
      '<div class="modal-body">' + (o.body || '') + '</div>' +
      '<div class="modal-foot">' +
      (o.hideCancel ? '' : '<button class="btn" data-act="cancel">' + escapeHtml(o.cancelText || '取消') + '</button>') +
      (o.okText === null ? '' : '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' + escapeHtml(o.okText || '确定') + '</button>') +
      '</div></div>';

    modalRoot().appendChild(overlay);

    let closing = false;
    function close() {
      if (closing) return;
      closing = true;
      overlay.classList.add('out');
      setTimeout(function () { overlay.remove(); }, 180);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA' && (e.metaKey || e.ctrlKey) && o.onOk) {
        doOk();
      }
    }
    document.addEventListener('keydown', onKey);

    const okBtn = overlay.querySelector('[data-act="ok"]');
    const cancelBtn = overlay.querySelector('[data-act="cancel"]');

    function doOk() {
      if (!o.onOk) { close(); return; }
      setBusy(okBtn, true);
      Promise.resolve()
        .then(function () { return o.onOk(close); })
        .then(function (r) { setBusy(okBtn, false); if (r !== false) close(); })
        .catch(function (err) {
          setBusy(okBtn, false);
          toast(err && err.message ? err.message : '操作失败', 'error');
        });
    }

    if (okBtn) okBtn.addEventListener('click', doOk);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    overlay.querySelector('.modal-x').addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });

    if (typeof o.onOpen === 'function') {
      try { o.onOpen(overlay, close); } catch (e) { console.error(e); }
    }
    const firstInput = overlay.querySelector('input, textarea, select');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 60);

    return { close: close, root: overlay };
  }

  function confirm(opts) {
    const o = typeof opts === 'string' ? { message: opts } : (opts || {});
    return new Promise(function (resolve) {
      let done = false;
      openModal({
        title: o.title || '确认操作',
        body: '<p class="confirm-text">' + escapeHtml(o.message || '') + '</p>',
        okText: o.okText || '确定',
        danger: !!o.danger,
        width: 420,
        onOk: function () { done = true; resolve(true); },
        onOpen: function (root, close) {
          root.addEventListener('click', function (e) {
            if (e.target && e.target.dataset && e.target.dataset.act === 'cancel' && !done) resolve(false);
          });
        },
      });
    });
  }

  /* ---------- 按钮忙碌态 ---------- */
  function setBusy(btn, busy, text) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset._text) btn.dataset._text = btn.textContent;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.innerHTML = '<span class="spinner"></span>' + escapeHtml(text || btn.dataset._text || '处理中');
    } else {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = btn.dataset._text || '确定';
    }
  }

  /* ---------- 空状态 ---------- */
  function emptyState(icon, title, desc) {
    return (
      '<div class="empty">' +
      '<div class="empty-icon">' + (icon || '📦') + '</div>' +
      '<div class="empty-title">' + escapeHtml(title || '') + '</div>' +
      (desc ? '<div class="empty-desc">' + desc + '</div>' : '') +
      '</div>'
    );
  }

  /* ---------- 常驻进度 Toast ---------- */
  function progressToast(title) {
    const el = document.createElement('div');
    el.className = 'toast toast-info progress-toast';
    el.innerHTML =
      '<div class="pt-title">' + escapeHtml(title) + '</div>' +
      '<div class="progress"><div class="progress-inner"></div></div>' +
      '<div class="pt-msg"></div>';
    toastRoot().appendChild(el);
    const bar = el.querySelector('.progress-inner');
    const msg = el.querySelector('.pt-msg');
    let removed = false;
    function remove(after) {
      if (removed) return; removed = true;
      setTimeout(function () { el.remove(); }, after || 400);
    }
    return {
      node: el,
      update: function (pct, text) { bar.style.width = Math.max(0, Math.min(100, pct)) + '%'; if (text) msg.textContent = text; },
      log: function (text) { msg.textContent = text; },
      done: function (text, persistMs) { bar.style.width = '100%'; bar.classList.add('done'); msg.textContent = text || '完成'; remove(persistMs || 2600); },
      fail: function (text, persistMs) { bar.classList.add('err'); msg.textContent = text || '失败'; remove(persistMs || 5200); },
      close: function () { remove(0); },
    };
  }

  GP.ui = { toast, openModal, confirm, setBusy, emptyState, progressToast };
})(window.GP);
