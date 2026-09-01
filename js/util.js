/* GitPusher · 通用工具函数（无 DOM 依赖） */
window.GP = window.GP || {};
(function (GP) {
  'use strict';

  /* ---------- Base64（支持 UTF-8 / 二进制） ---------- */
  function bytesToBase64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function strToBase64(str) {
    return bytesToBase64(new TextEncoder().encode(str));
  }

  function base64ToBytes(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function base64ToStr(b64) {
    return new TextDecoder().decode(base64ToBytes(b64));
  }

  /* ---------- 文本 / 二进制判定 ---------- */
  const TEXT_EXT = new Set([
    'txt', 'md', 'markdown', 'json', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'html', 'htm', 'css', 'scss',
    'sass', 'less', 'styl', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cc',
    'cpp', 'hpp', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql',
    'r', 'm', 'mm', 'lua', 'pl', 'pm', 'dart', 'scala', 'groovy', 'gradle', 'xml', 'svg',
    'gitignore', 'gitattributes', 'editorconfig', 'env', 'lock', 'log', 'csv', 'tsv',
    'dockerfile', 'makefile', 'cmake', 'properties', 'proto', 'graphql', 'gql', 'tex',
    'asm', 's', 'vb', 'fs', 'ex', 'exs', 'erl', 'clj', 'lisp', 'nim', 'zig', 'v', 'sol',
  ]);

  const BINARY_EXT = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'tif', 'tiff', 'psd', 'sketch',
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'mp4', 'webm', 'avi', 'mov', 'mkv', 'flv',
    'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
    'ppt', 'pptx', 'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'apk', 'ipa', 'dmg', 'iso',
    'ttf', 'otf', 'woff', 'woff2', 'eot', 'class', 'jar', 'pyc', 'pyo', 'o', 'a', 'lib',
    'node', 'wasm', 'pdb', 'db', 'sqlite', 'sqlite3',
  ]);

  function extOf(name) {
    const base = String(name).split(/[\\/]/).pop() || '';
    if (base.startsWith('.') && base.indexOf('.', 1) === -1) return base.slice(1).toLowerCase();
    const i = base.lastIndexOf('.');
    if (i <= 0) return '';
    return base.slice(i + 1).toLowerCase();
  }

  /** 依据扩展名猜测是否为文本文件；无法判断时返回 null（交给内容检测） */
  function guessTextByName(name) {
    const ext = extOf(name);
    if (BINARY_EXT.has(ext)) return false;
    if (TEXT_EXT.has(ext)) return true;
    return null;
  }

  /** 内容嗅探：存在 \0 字节或 UTF-8 解码替换符过多，视为二进制 */
  function looksBinary(bytes) {
    const len = Math.min(bytes.length, 4096);
    for (let i = 0; i < len; i++) {
      if (bytes[i] === 0) return true;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, len));
      if (/\uFFFD/.test(text)) return true;
    } catch (e) {
      return true;
    }
    return false;
  }

  /* ---------- 路径 ---------- */
  function normalizePath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  }

  function joinPath() {
    const parts = Array.from(arguments)
      .filter((s) => s !== null && s !== undefined && s !== '')
      .map((s) => normalizePath(s));
    return parts.join('/');
  }

  function parentPath(p) {
    const s = normalizePath(p);
    const i = s.lastIndexOf('/');
    return i === -1 ? '' : s.slice(0, i);
  }

  function baseName(p) {
    const s = normalizePath(p);
    return s.slice(s.lastIndexOf('/') + 1);
  }

  /* ---------- 格式化 ---------- */
  function formatBytes(n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 10 ? 1 : 0) + ' ' + units[i];
  }

  function timeAgo(iso) {
    if (!iso) return '-';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '-';
    const diff = Date.now() - t;
    const s = Math.floor(diff / 1000);
    if (s < 60) return '刚刚';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + ' 个月前';
    return Math.floor(d / 365) + ' 年前';
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait || 200);
    };
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  GP.util = {
    bytesToBase64, strToBase64, base64ToBytes, base64ToStr,
    extOf, guessTextByName, looksBinary, TEXT_EXT, BINARY_EXT,
    normalizePath, joinPath, parentPath, baseName,
    formatBytes, timeAgo, escapeHtml, debounce, sleep, uid,
  };
})(window.GP);
