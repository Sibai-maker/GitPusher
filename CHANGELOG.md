# 更新日志

本项目的所有显著变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.2] - 2026-08-31

### 修复
- **上传模块不尊重 `.gitignore`**：此前只用一份内置忽略清单，导致拖入项目时会把 `node_modules`、`electron-app/app/`、`electron-app/release/` 等生成物一并上传。现改为：选择文件夹时自动读取根级 `.gitignore` 并合并规则（无 `.gitignore` 才退回内置清单）。
- **忽略匹配在任意层级不生效**（严重）：原 `gitignoreMatch` 只匹配路径末尾，且对带路径前缀的规则（如 `electron-app/node_modules/`）和裸规则（如 `node_modules`、`*.log`）在子目录里全部失配。现改为与 git 行为一致：规则在任意层级生效，并对"去掉前导目录"的所有路径后缀逐一匹配。验证用例含 `electron-app/build/icon.ico` 必须保留、`app/` / `release/` / `node_modules` / `.workbuddy` 必须跳过。
- 内置忽略清单移除 `build`（避免误伤放在 `build/` 下的源码，如应用图标 `icon.ico`）；是否需要忽略交由项目自己的 `.gitignore` 决定。

### 新增
- 上传面板的"忽略规则"文本框改为显示**实际生效**的规则，且编辑后**即时重过滤**，无需重新选择文件夹。

## [1.0.1] - 2026-08-31

### 修复
- **双击桌面版无任何窗口**（严重）：`main.js` 把 `protocol.registerSchemesAsPrivileged()` 写在了 `app.whenReady().then()` 内部。Electron 要求它必须在 ready 之前调用，于是抛
  `protocol.registerSchemesAsPrivileged should be called before app is ready`，导致 `createWindow()` 永不执行；而 `window-all-closed` 也不会触发，进程一直挂在后台变成僵尸。
  现已移到模块顶层，并在 `whenReady()` 链上补 `.catch()`。
- **启动失败静默无提示**：新增 `uncaughtException` / `unhandledRejection` / `did-fail-load` 三个兜底，任何启动期异常都会弹出可见的错误对话框，而不是"点了没反应"。
- **NSIS 安装器构建不成**：`dist` / `pack` 脚本中的同步命令与 `prepack` / `predist` 钩子重复，已去重；并补充 `synccheck` 命令。

### 新增
- 应用图标 `electron-app/build/icon.ico`（256/128/64/48/32/16 多尺寸），安装器与可执行文件均使用它。
- `npm run synccheck`：仅校验 `app/` 与源码是否一致，供 CI 使用。

## [1.0.0] - 2026-08-31

### 新增
- M1 · 账号与仓库管理：使用 GitHub Personal Access Token 登录；自动拉取并搜索仓库；新建仓库（含 README/.gitignore 模板）；分支下拉切换与刷新。
- M2 · 本地项目上传：拖拽或选择文件夹；按 `.gitignore` 风格过滤；可勾选文件；自动区分文本/二进制；并发创建 blob → tree → commit；支持新建分支与"强制覆盖"。
- M3 · 在线文件浏览：懒加载目录树；纯前端语法高亮；文本文件预览；图片与二进制文件提供下载。
- M4 · 在线编辑与提交：右键菜单新建/重命名/删除文件或目录；可视化文件树多选批量删除；内嵌编辑器编辑文本（≤1MB）并提交；冲突检测与"以远端为准重试"恢复入口。
- M5 · 提交历史：查看分支最近 40 条提交；展开任一提交查看变更文件清单（增/删/改/重命名）。
- 设置面板：查看/复制/清除本机 Token；显示版本。
- Electron 桌面封装：自定义 `app://` 协议保证 `localStorage` 跨启动持久化；通过 `electron-builder` 打包为 Windows NSIS 安装包。
- 应用图标（256/128/64/48/32/16 多尺寸 ICO）。

### 安全
- Token 仅保存在本机 `localStorage`（浏览器版或 Electron 版的 `app://app` 源），不会发往任何第三方服务器。
- 路径遍历防护：`app://` 协议对请求路径做归一化并限制在 `electron-app/app/` 内。
