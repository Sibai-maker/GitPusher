#!/usr/bin/env node
/**
 * 把仓库根目录的前端源码同步到 electron-app/app/。
 *
 * 根目录的 index.html / assets / js 是唯一源码来源；
 * electron-app/app 只是打包时用的快照，不进版本库（已在 .gitignore 中排除）。
 *
 * 用法：
 *   node scripts/sync-app.js           # 同步
 *   node scripts/sync-app.js --check   # 只比对，不同步（用于 CI 校验）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = path.resolve(__dirname, '..', 'app');

const COPY = [
  { from: path.join(ROOT, 'index.html'), to: path.join(APP_DIR, 'index.html') },
  { from: path.join(ROOT, 'assets'), to: path.join(APP_DIR, 'assets') },
  { from: path.join(ROOT, 'js'), to: path.join(APP_DIR, 'js') },
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** 返回需要同步的文件列表 [{from, to}] */
function plan() {
  const jobs = [];
  for (const { from, to } of COPY) {
    if (!fs.existsSync(from)) {
      console.error('[sync-app] 源不存在：' + from);
      process.exitCode = 1;
      continue;
    }
    if (fs.statSync(from).isDirectory()) {
      for (const f of walk(from)) {
        jobs.push({ from: f, to: path.join(to, path.relative(from, f)) });
      }
    } else {
      jobs.push({ from, to });
    }
  }
  return jobs;
}

function same(a, b) {
  if (!fs.existsSync(b)) return false;
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  if (sa.size !== sb.size) return false;
  const ha = crypto.createHash('sha1').update(fs.readFileSync(a)).digest('hex');
  const hb = crypto.createHash('sha1').update(fs.readFileSync(b)).digest('hex');
  return ha === hb;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const jobs = plan();
  const changed = jobs.filter((j) => !same(j.from, j.to));

  if (checkOnly) {
    if (changed.length) {
      console.error('[sync-app] 以下内容尚未同步：');
      changed.forEach((j) => console.error('  - ' + path.relative(ROOT, j.to)));
      process.exit(1);
    }
    console.log('[sync-app] app/ 已是最新');
    return;
  }

  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });

  for (const job of jobs) {
    fs.mkdirSync(path.dirname(job.to), { recursive: true });
    if (!same(job.from, job.to)) fs.copyFileSync(job.from, job.to);
  }

  // 清理 app/ 中已不存在的旧文件（避免残留影响打包）
  const wanted = new Set(jobs.map((j) => j.to));
  for (const f of walk(APP_DIR)) {
    if (!wanted.has(f)) {
      fs.unlinkSync(f);
      console.log('[sync-app] 删除多余文件 ' + path.relative(APP_DIR, f));
    }
  }

  console.log(
    '[sync-app] 同步完成：' + changed.length + ' 个文件更新，共 ' + jobs.length + ' 个文件 → ' +
      path.relative(ROOT, APP_DIR)
  );
}

main();
