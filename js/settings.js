/* GitPusher · M5：设置面板 */
window.GP = window.GP || {};
(function (GP) {
  'use strict';
  const { api, ui } = GP;
  const VERSION = 'v1.0 (M1–M5)';

  function maskToken(t) {
    if (!t) return '（未设置）';
    if (t.length <= 8) return t[0] + '****' + t.slice(-1);
    return t.substring(0, 4) + '****' + t.slice(-4);
  }

  function openSettings() {
    const t = api.token || '';
    ui.openModal({
      title: '⚙ 设置',
      width: 460,
      okText: '关闭',
      body:
        '<div class="form-item"><label>GitHub Token</label>' +
          '<div class="set-token-row">' +
            '<code class="set-token">' + maskToken(t) + '</code>' +
            '<button class="btn btn-ghost btn-sm" id="set-copy-token">复制</button>' +
          '</div>' +
          '<div class="hint">Token 仅保存在本机浏览器（localStorage），不会上传任何服务器。</div>' +
        '</div>' +
        '<div class="form-item"><label>版本</label><div class="set-version">' + VERSION + '</div></div>' +
        '<div class="form-item"><label>本地数据</label>' +
          '<button class="btn btn-danger btn-sm" id="set-clear">清除登录并重新输入 Token</button>' +
          '<div class="hint">将清除本地保存的 Token 并刷新回登录页，已上传到 GitHub 的内容不受影响。</div>' +
        '</div>',
      onOk: function () { return true; },
    });

    const copyBtn = document.getElementById('set-copy-token');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        if (!t) { ui.toast('没有可复制的 Token', 'warn'); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(function () { ui.toast('已复制完整 Token', 'success'); }, function () { ui.toast('复制失败', 'warn'); });
        } else { ui.toast('当前环境不支持复制，请手动从登录页查看', 'warn'); }
      });
    }
    const clearBtn = document.getElementById('set-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        ui.confirm({ title: '清除本地 Token', message: '确定清除本地 Token 并回到登录页？', okText: '清除', danger: true }).then(function (ok) {
          if (!ok) return;
          api.clearToken();
          ui.closeModal && ui.closeModal();
          ui.toast('已清除，正在回到登录页…', 'success');
          setTimeout(function () { location.reload(); }, 600);
        });
      });
    }
  }

  GP.app = GP.app || {};
  GP.app.openSettings = openSettings;
})(window.GP);
