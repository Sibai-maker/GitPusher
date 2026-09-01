'use strict';

const { app, protocol, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, 'app');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

/* 必须在 app 的 ready 事件之前调用，否则 Electron 会直接抛错、窗口永远创建不出来 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
  }
]);

function fatal(title, err) {
  const msg = (err && (err.stack || err.message)) || String(err);
  console.error('[GitPusher] ' + title + ':', msg);
  if (app.isReady()) {
    dialog.showErrorBox('GitPusher 启动失败 · ' + title, msg);
  } else {
    app.whenReady().then(() => dialog.showErrorBox('GitPusher 启动失败 · ' + title, msg));
  }
}

process.on('uncaughtException', (err) => fatal('未捕获异常', err));
process.on('unhandledRejection', (err) => fatal('未处理的 Promise 拒绝', err));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'GitPusher',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());

  // 所有外链（如 OAuth 文档、GitHub 网页）改在系统浏览器打开，避免 Electron 内嵌
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 页面加载失败时给出可见提示，而不是一片黑
  win.webContents.on('did-fail-load', (event, code, desc, url) => {
    if (code === -3 /* ABORTED，通常是刷新/跳转打断，忽略 */) return;
    dialog.showErrorBox('GitPusher 页面加载失败', url + '\n\n错误码 ' + code + '：' + desc);
  });

  win.loadURL('app://app/index.html');
  return win;
}

app.whenReady().then(() => {
  // 注册自定义协议并提升为"标准安全源"，使 localStorage / fetch 等按真实源工作
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';

      // 归一化并拦截路径穿越
      const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(APP_DIR, safe);
      if (!filePath.startsWith(APP_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('Not Found: ' + safe, { status: 404 });
      }

      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' }
      });
    } catch (e) {
      return new Response('Error: ' + e.message, { status: 500 });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => fatal('主进程初始化', err));

app.on('window-all-closed', () => {
  // Windows / Linux：关闭全部窗口即退出
  app.quit();
});
