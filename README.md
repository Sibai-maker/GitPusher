# GitPusher

> 纯前端 GitHub 管理工具：上传本地项目 · 在线浏览 · 在线编辑 · 查看提交历史。
> 既能作为桌面应用运行（Electron 打包），也能直接在浏览器里打开 `index.html` 使用。

![GitPusher](electron-app/build/icon.ico)

---

## 目录

- [这是做什么的](#这是做什么的)
- [功能特性](#功能特性)
- [技术栈与原理](#技术栈与原理)
- [目录结构](#目录结构)
- [安装教程](#安装教程)
  - [方式一 · 浏览器版（最简单）](#方式一--浏览器版最简单)
  - [方式二 · 桌面版（功能更完整）](#方式二--桌面版功能更完整)
- [GitHub Token 申请](#github-token-申请)
- [使用说明](#使用说明)
- [常见问题 FAQ](#常见问题-faq)
- [已知限制](#已知限制)
- [安全说明](#安全说明)
- [开发与打包](#开发与打包)
- [许可](#许可)

---

## 这是做什么的

GitPusher 让你**不打开 Git 客户端、不敲 git 命令**，就能完成下面这些事：

- 把本地一个完整项目（含目录结构）直接推送到 GitHub，**默认忽略 `.git` / `node_modules` / `dist`** 等。
- 在网页里**像资源管理器一样浏览仓库**，点开任意文本/图片/二进制文件。
- 在网页里**直接新建 / 编辑 / 重命名 / 删除** 文件，填写 commit message 一键提交。
- 切换分支、查看**最近 40 条提交**及每次提交改动的文件列表。

> 适合：临时把一个小项目丢上 GitHub 备份、改完别人仓库里的某个文件想顺手提交、不想为了一点小操作去装 SourceTree / Fork / GitHub Desktop。

---

## 功能特性

| 模块 | 能力 |
| --- | --- |
| **M1 账号与仓库** | GitHub Token 登录；自动拉取并按更新时间排序的仓库列表；模糊搜索；新建仓库（可选 README、`.gitignore` 模板、私有/公开）；分支下拉与刷新。 |
| **M2 项目上传** | 拖拽或选择文件夹 → 自动按 `.gitignore` 风格过滤 → 可勾选文件 → 并发创建 blob → 一次性组装 tree 并提交。**支持新建分支**与"强制覆盖"以处理远端被改过的冲突。 |
| **M3 文件浏览** | 懒加载目录树；常见语言**纯前端语法高亮**（JS/TS/Python/Go/Rust/HTML/CSS/JSON/YAML…）；文本预览；图片/二进制提供下载。 |
| **M4 在线编辑** | 右键新建/重命名/删除文件或目录；可视化文件树多选**批量删除**；内嵌编辑器（≤ 1MB 文本）实时 commit；提交冲突检测 + 一键"以远端为准重试"。 |
| **M5 提交历史** | 查看分支最近 40 条提交，展开任一提交可看到 A/D/M/R 的变更文件列表与行数。 |
| **设置** | 查看/复制/清除本机 Token；显示当前版本。 |

> 桌面版额外提供：跨启动的 `localStorage` 持久化、自定义协议 `app://` 隔离、统一的桌面应用图标与 Windows 安装包。

---

## 技术栈与原理

- **纯前端 HTML + CSS + 原生 JavaScript（IIFE 模块）**，无任何前端框架与运行时依赖。
- 所有 GitHub 操作走浏览器原生 `fetch` → GitHub REST API v3（`api.github.com`），**无自建后端**。
- 鉴权：用户输入 Personal Access Token，保存在本机 `localStorage`。
- 写入：使用 [Git Database API](https://docs.github.com/en/rest/git) 拼接 `blob → tree → commit → ref`，实现"一次提交多文件"。
- 桌面版：[Electron 31](https://www.electronjs.org/) + 自定义 `app://` 协议；打包器 [electron-builder 24](https://www.electron.build/)，NSIS 安装包。
- 兼容性：现代 Chromium 内核浏览器（Chrome / Edge / Firefox 最新版均通过）；Node 18+ 用于运行 sync 脚本与 electron-builder。

---

## 目录结构

```
.
├── index.html               # 入口 HTML
├── assets/
│   └── style.css            # 全部样式（深色 GitHub 风格）
├── js/                      # 前端逻辑
│   ├── util.js              # Base64、路径、格式化
│   ├── ui.js                # Toast / Modal / Confirm
│   ├── api.js               # GitHub REST 封装
│   ├── app.js               # M1 视图框架与认证
│   ├── upload.js            # M2 上传
│   ├── explore.js           # M3 浏览
│   ├── edit.js              # M4 编辑
│   ├── history.js           # M5 提交历史
│   └── settings.js          # 设置面板
├── electron-app/            # 桌面端封装
│   ├── main.js              # Electron 主进程（注册 app:// 协议）
│   ├── package.json
│   ├── build/icon.ico       # 应用图标
│   ├── scripts/sync-app.js  # 把上面源码同步到 app/ 的脚本
│   └── app/                 # ⚠ 同步脚本生成，不进版本库
├── .github/                 # Issue 模板
├── .gitignore
├── .gitattributes
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

> ⚠ **`electron-app/app/` 是同步脚本生成的快照**，由 `.gitignore` 排除。每次 `npm start` 或 `npm run dist` 前会自动从仓库根的 `index.html / assets / js` 同步过去（见 `electron-app/scripts/sync-app.js` 与 `package.json` 里的 `prestart` / `predist` 钩子）。**前端源码只有一份，以仓库根为准。**

**本仓库包含两部分**：① 开源 Web 源码（根目录 `index.html` / `assets` / `js`，任何人可直接用浏览器打开或部署）；② 桌面端安装包装（`electron-app/`，用于把上面这套 Web 应用打包成 Windows 安装程序）。安装器本身（`GitPusher-Setup-*.exe`，约 78MB）体积大、不该进 git，请通过 **GitHub Releases** 分发（见下方「安装教程 · 方式二」）。`electron-app/release/`、`dist/`、`node_modules/`、`.workbuddy/` 等均已写入 `.gitignore`，不会进入版本库。

> 💡 用本工具上传项目时，上传模块会**自动读取目标文件夹里的 `.gitignore`** 并据此过滤文件（与 git 行为一致），因此直接把整个项目文件夹拖进上传区即可，无需手动勾选 —— `node_modules`、`app/`、`release/`、`dist/` 等会被自动跳过，`electron-app/build/icon.ico` 等需要保留的源码则正常上传。

---

## 安装教程

### 方式一 · 浏览器版（最简单）

适合不想装 Electron、只想快速体验或临时用一下。

1. 克隆或下载本仓库。
   ```bash
   git clone https://github.com/gitpusher/gitpusher.git
   cd gitpusher
   ```
2. **起一个本地静态服务**（用 `file://` 直接双击打开也可以，但 `localStorage` 在某些浏览器里会按"空 origin"工作，跨刷新有概率丢失，所以**强烈建议走 HTTP**）。
   ```bash
   # 任选其一：
   npx --yes serve .                  # 端口默认 3000
   # 或
   python -m http.server 8080         # 然后访问 http://localhost:8080
   ```
3. 浏览器打开 `http://localhost:8080`（或 `serve` 给出的地址），按提示粘贴 GitHub Token，即可使用。

### 方式二 · 桌面版（功能更完整）

适合每天用、希望像普通软件一样双击启动、Token 在系统里跨启动更稳定。

#### 环境要求

| 工具 | 最低版本 | 用途 |
| --- | --- | --- |
| Node.js | **18.x 或更高**（推荐 20 LTS） | 运行 sync 脚本与 electron-builder |
| npm | 9+ | 包管理 |
| Windows | 10 / 11（64 位） | 仅在该平台验证过；macOS / Linux 理论上可运行但未测试 |

#### 步骤

1. 克隆仓库。
   ```bash
   git clone https://github.com/gitpusher/gitpusher.git
   cd gitpusher/electron-app
   ```
2. 安装依赖（首次会下载 Electron 运行时与 NSIS，约几百 MB，**请保持网络畅通**）。
   ```bash
   npm install
   ```
3. **开发预览**：以桌面窗口运行（不打包）。
   ```bash
   npm start
   ```
   `prestart` 钩子会自动把 `index.html / assets / js` 同步到 `electron-app/app/`，所以你**只需要改仓库根的源码**，改完保存再 `Ctrl+R` 即可看到效果。
4. **打包为 Windows 安装包**：
   ```bash
   npm run dist
   ```
   产物在 `electron-app/dist/GitPusher-Setup-1.0.0.exe`。双击安装，可改安装目录、生成桌面与开始菜单快捷方式。
5. 想跳过打包直接看产物目录（不生成安装器）：
   ```bash
   npm run pack
   ```
   产物在 `electron-app/dist/win-unpacked/GitPusher.exe`。

> 💡 如果你不想装 Node，也可以去 [Releases](https://github.com/gitpusher/gitpusher/releases) 页面下载已经构建好的 `GitPusher-Setup-*.exe`，直接双击安装。

---

## GitHub Token 申请

GitHub 已逐步把旧式 Classic Token 替换为 **Fine-grained Personal Access Token**。两种都支持，按需选一种。

### A. Fine-grained（**推荐**）

权限更细、风险更小，2023 年起 GitHub 主推这一种。

1. 打开 <https://github.com/settings/tokens?type=beta>。
2. **Generate new token** → 填写名称、过期时间、Resource owner（选你名下的账号 / 组织）。
3. **Repository permissions**（仓库级）：
   - `Contents` → **Read and write**（读写文件、提交、上传、删除）
   - `Metadata` → **Read-only**（默认就是）
   - `Administration` → **Read and write**（用于"新建仓库"功能；不需要建仓库可只给 Read-only）
4. **Account permissions**（账号级）：
   - `Administration` → **Read and write**（用于"新建仓库"；不需要可不给）
5. 生成后**立即复制** `github_pat_xxx...`（只显示一次）。

### B. Classic（备选 / 旧仓库兼容）

一次性勾全部权限，最省事但粒度粗。

1. 打开 <https://github.com/settings/tokens>。
2. **Generate new token (classic)**。
3. 勾选 scope：
   - `repo` —— 完整仓库读写（含私有库），上传/编辑/删除都靠它。
   - `workflow` —— 仅当你希望修改 GitHub Actions 配置文件时才需要。
4. 生成后复制 `ghp_xxx...`。

### 把 Token 粘进 GitPusher

启动后顶部会显示登录页：粘贴 Token → 点 **连接 GitHub**。如果验证通过会跳到主界面；不通过会在登录框下方红字提示（401 = Token 无效，403 = 权限不足）。

> **Token 不会上传任何服务器**，仅存放在本机浏览器的 `localStorage`（桌面版则存在 Electron 的 `app://app` 源）。可在顶部 ⚙ 设置里查看/复制/清除。

---

## 使用说明

### 上传一个本地项目（M2）

1. 左侧仓库列表选中**目标仓库**（或点 `+ 新建`）。
2. 切到 **⬆ 上传项目** Tab。
3. **拖拽文件夹**到虚线框，或点击虚线框选择文件夹。整个项目会被递归扫描、目录结构完整保留。
4. 若文件夹里含 `.gitignore`，上传模块会**自动合并其规则**过滤文件（与 git 行为一致）；清单下方的"忽略规则"文本框会显示实际生效的规则，**修改后即时重过滤，无需重新选择文件夹**。你通常不用动它。
5. 在文件清单里**勾选**要上传的文件（默认全选；`>75MB` 会被标为"过大"且不可上传，GitHub blob 接口硬上限约 100MB）。
6. 选**目标分支**（默认是仓库的默认分支，需要时可下拉选 `➕ 新建分支…`）。
7. 填写 **Commit message** → 点 **⬆ 上传到 GitHub**。
8. 进度条下方日志会逐步显示"创建 blob / 提交 / 更新引用"。完成后顶部会提示已推送 N 个文件。

> 💡 提示"提交被拒绝：远程分支已被更新"？可勾选"**强制覆盖**"重试，或先点顶部分支旁的 ↻ 刷新远端状态再试。

### 在线浏览（M3）

切到 **🌳 文件浏览** Tab：
- 左侧**懒加载目录树**，点 ▶ 展开子目录。
- 点任意文件右侧预览内容：文本有语法高亮，图片直接显示，二进制提供下载按钮。

### 在线编辑（M4）

切到 **✎ 在线编辑** Tab：
- **右键**文件 / 目录：`新建文件`、`新建文件夹`、`重命名`、`删除`。
- 顶部勾选 **多选模式** 后可勾选多个文件 / 目录，**批量删除**。
- 单击文件进入编辑面板（≤ 1MB 文本）；上方填 commit message → `Ctrl+Enter` 提交。
- 提交若遇冲突会弹窗，提示"先点顶部分支 ↻ 刷新"或"以远端为准重试"。

### 查看历史（M5）

切到 **📜 提交历史** Tab：
- 看到分支最近 40 条提交。
- **点任一提交**展开，看本次改动的文件清单（含 A / D / M / R 标记与行数）。

---

## 常见问题 FAQ

<details>
<summary><b>Q1：浏览器版 Token 存哪里？安全吗？</b></summary>

仅存于本机 `localStorage`（桌面版存在 Electron 的 `app://app` 源），全程不上传任何服务器。建议：

- 使用 **Fine-grained Token** 并只授予本工具实际需要的权限。
- 不再使用时点顶部 ⚙ 设置里的 **"清除登录"** 按钮。
</details>

<details>
<summary><b>Q2：上传时提示"提交被拒绝：远程分支已被更新"？</b></summary>

说明在你上传期间，远端分支被别人（或你用别处）推了新内容。两种处理方式：

1. **强制覆盖**：勾选"强制覆盖"再上传（会丢弃远端新增的提交）。
2. **拉取远端内容**：点顶部分支旁的 ↻ 刷新远端，重新上传。
</details>

<details>
<summary><b>Q3：新建仓库报 403 / "Resource not accessible by personal access token"？</b></summary>

Token 没有 **Administration** 写权限。

- **Fine-grained**：Repository permissions → Administration 选 **Read and write**；如仍失败，Account permissions → Administration 也给 Read and write。
- **Classic**：勾选 `repo` 即可。
</details>

<details>
<summary><b>Q4：上传大文件失败？</b></summary>

GitHub blob 接口硬上限约 100MB，本工具默认把 **> 75MB** 标为"过大"并跳过。如必须上传接近上限的文件，建议用 `git lfs` 或拆仓库。
</details>

<details>
<summary><b>Q5：编辑时为什么有些文件点不开？</b></summary>

为避免一次拉太多把浏览器卡死，**只对 ≤ 1MB 的文件拉取内容**；更大的文件会在右侧提示"超过 1MB，请使用 M3 下载或本地工具编辑"。
</details>

<details>
<summary><b>Q6：桌面版 <code>npm install</code> / <code>npm run dist</code> 报网络错误？</b></summary>

`npm install` 要下载 Electron；`npm run dist` 还要从 GitHub Releases 下载 **NSIS** 与 **winCodeSign** 两套二进制（国内网络经常连不上 GitHub），报错形如 `dial tcp ...:443: connectex` 或卡在 `downloading nsis-3.0.4.x`。设两个镜像即可：

```bash
# 1) Electron 本体镜像
npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/

# 2) NSIS / winCodeSign 等 electron-builder 二进制的镜像（关键！否则装不出安装器）
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
# 临时生效；或写进系统环境变量：变量名 ELECTRON_BUILDER_BINARIES_MIRROR，值同上

# 然后再装、再打包
cd electron-app
npm install
npm run dist
```

> 若抓包看到 `Cannot create symbolic link : 客户端没有所需的特权`，是 Windows 默认禁止普通用户建符号链接（7z 在解 `winCodeSign` 包时遇到 macOS 软链）。开启 **开发者模式**（设置 → 系统 → 面向开发人员 → 开发人员模式）后重跑即可；或忽略该非致命报错——`rcedit`/`signtool` 通常已解压成功，重跑一次会自动复用。
</details>

<details>
<summary><b>Q7：怎么让桌面版窗口变成 macOS / Linux？</b></summary>

`package.json` 的 `build.win` 仅声明 Windows 平台。把 macOS / Linux 的 target 加上（`mac: { target: "dmg" }` / `linux: { target: "AppImage" }`）即可，本工具在 macOS / Linux 上代码层无平台耦合，理论上可直接跑 `npm start` 验证。
</details>

---

## 已知限制

- **单文件 ≤ 75MB**（GitHub blob 限制）。二进制文件按 base64 上传，会比原文件大约 33%。
- **编辑/预览仅支持 ≤ 1MB 的文本文件**。更大的请使用 M3 下载到本地修改后通过 M2 上传。
- **提交历史只看最近 40 条**，不提供分页与搜索。
- **不支持 Git LFS** 与 **GitHub Wiki**、**Pages**、**Issues**、**PR** 等非仓库内容相关功能。
- **没有冲突解决 UI**：推送冲突只能"覆盖"或"先刷新再传"，不做三方合并。
- **Fine-grained Token 只能操作被授予的仓库 / 组织**，不会自动出现在仓库列表里。

---

## 安全说明

- Token 仅保存在本机 `localStorage`，永远不离开你的电脑。
- Electron 桌面版使用自定义协议 `app://`，对请求路径做归一化与目录穿越拦截（见 `electron-app/main.js`）。
- `webPreferences` 关闭了 `nodeIntegration`、保持 `contextIsolation`；所有 GitHub API 调用都走标准 `fetch`。
- 本工具**不需要**任何回调地址 / OAuth Secret / SSH key，不会向任何非 `api.github.com` 的域名发送请求。

---

## 开发与打包

| 命令 | 作用 |
| --- | --- |
| `npm run sync` | 把根目录的前端源码同步到 `electron-app/app/`（默认会被 `prestart` / `predist` 钩子自动调用） |
| `node scripts/sync-app.js --check` | 只检查 `app/` 是否是最新，不写盘。可用于 CI 校验 |
| `npm start` | 开发预览：先同步再启动 Electron |
| `npm run pack` | 打包出 `dist/win-unpacked/`（不带安装器的可执行目录） |
| `npm run dist` | 打包出 `dist/GitPusher-Setup-1.0.0.exe`（NSIS 安装器） |

### 修改前端代码后的工作流

1. 编辑仓库根的 `index.html` / `assets/style.css` / `js/*.js`。
2. 重新 `npm start` 即可（`prestart` 会自动同步；Electron 窗口按 `Ctrl+R` 刷新页面）。

### 不希望自动同步？

```bash
# 直接绕过 prestart 钩子运行：
node electron-app/scripts/sync-app.js   # 手动同步
npx electron electron-app/.            # 手动启动
```

---

## 许可

[MIT](./LICENSE) © 2026 GitPusher contributors
