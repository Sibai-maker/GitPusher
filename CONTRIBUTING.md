# 贡献指南

感谢你愿意让 GitPusher 变得更好。提 PR 前请先过一遍这份指南。

## 报告问题
- **先搜后提**：在 [Issues](https://github.com/gitpusher/gitpusher/issues) 里搜索是否已有相同问题；如果是，请在该 issue 下补充复现，而不是重复开新 issue。
- **选择模板**：Bug 请用 [Bug Report] 模板，需求请用 [Feature Request] 模板。
- **附带复现信息**：浏览器或 Electron 版本、操作系统、Token 类型（Fine-grained / Classic）、截图或控制台错误截图。

## 提 PR
1. Fork 仓库后从 `main` 拉特性分支：
   ```bash
   git checkout -b feat/short-description
   ```
2. 遵循现有目录结构：
   - 前端源码（`index.html` / `assets/` / `js/`）放在仓库根目录。
   - 桌面端专属代码在 `electron-app/`。
3. 保持提交信息简短清晰，例：`feat(upload): 支持 .gitattributes 解析`。
4. 改完前端源码后务必运行同步脚本，让 `electron-app/app/` 保持一致：
   ```bash
   cd electron-app && npm run sync
   ```
   仓库根的 `prestart` / `predist` 钩子会自动调用该脚本，但手动 PR 时不要把 `electron-app/app/` 一并提交。
5. 在 PR 描述里写明：动机、改动、测试方式、相关 issue 编号。
6. 通过本地冒烟测试：
   - 浏览器版：`npx --yes serve .`，确认 4 个 Tab 正常。
   - 桌面版：`cd electron-app && npm start`。

## 代码风格
- 纯前端 JavaScript，IIFE 模块挂在 `window.GP` 上，对外 API 用 `GP.api` / `GP.ui` / `GP.util`。
- 缩进 2 空格，单引号字符串，语句末尾带分号。
- HTML 中转义使用 `util.escapeHtml`，不要直接拼接用户输入。

## 许可
贡献的代码遵循 [MIT License](./LICENSE)。
