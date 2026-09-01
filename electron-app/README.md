# GitPusher 桌面版（Electron 封装）

GitPusher 的桌面端包装：注册自定义协议 `app://` 加载前端页面，并使用 `electron-builder` 打包为 Windows 安装包。

> **前端源码在仓库根目录**（`index.html` / `assets/` / `js/`）。本目录下的 `app/` 是由 `scripts/sync-app.js` 在 `prestart` / `predist` 钩子里自动同步过来的快照，**不进版本库**。请直接修改仓库根的源文件。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `npm run sync` | 把根目录的前端源码同步到 `app/` |
| `node scripts/sync-app.js --check` | 仅校验 `app/` 是否为最新（CI 用） |
| `npm start` | 开发预览（先 sync 再启动 Electron） |
| `npm run pack` | 仅产出可执行目录 `dist/win-unpacked/` |
| `npm run dist` | 产出 NSIS 安装包 `dist/GitPusher-Setup-1.0.0.exe` |

## 详细文档

见仓库根 [README.md](../README.md)。
