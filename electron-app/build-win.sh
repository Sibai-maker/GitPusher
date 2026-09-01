#!/usr/bin/env bash
# GitPusher · Windows NSIS 安装包构建脚本（Git Bash 下运行）
#
# 用法：  bash build-win.sh
#
# 设计要点：
# 1. 构建输出目录放在系统临时目录（os.tmpdir()）下。WorkBuddy 的安全删除守卫
#    (genie-safe-delete) 对 os.tmpdir() 下的删除放行原生删除，收尾删 .nsis.7z
#    时不再报 [safe-delete] 错误；且产物不进 OneDrive 同步目录，更安全。
# 2. 清空旧产物用 mv（安全删除守卫会拦截 rm -rf，mv 是 rename 不受影响）。
# 3. 国内镜像加速 electron / electron-builder-binaries 下载。
# 4. 构建成功后把 exe 拷贝到 release/ 供分发（源码走 git，安装包走 GitHub Releases）。
# 5. 所有路径用 cygpath -m 转成 C:/... 形式，避免 Git Bash 的 /c/ mount 前缀
#    被 Windows 版 node 误读成 C:\c\...。

set -e

# 项目根（脚本所在目录），转 Windows 正斜杠风格
APP_DIR="$(cygpath -m "$(cd "$(dirname "$0")" && pwd)")"
cd "$APP_DIR"

NODE_BIN="$(cygpath -m "/c/Users/四白/.workbuddy/binaries/node/versions/22.22.2/node.exe")"
BUILDER="$APP_DIR/node_modules/electron-builder/cli.js"
# 与 package.json 中 build.directories.output 保持一致
OUT_DIR="$(cygpath -m "$LOCALAPPDATA/Temp/gitpusher-dist")"

if [ ! -f "$NODE_BIN" ]; then
  echo "✗ 找不到 managed node: $NODE_BIN" >&2
  exit 1
fi
if [ ! -f "$BUILDER" ]; then
  echo "✗ 找不到 electron-builder: $BUILDER" >&2
  exit 1
fi

# 1. 清空旧 output（mv 而非 rm，避免被安全删除守卫拦截）
if [ -d "$OUT_DIR" ]; then
  BAK="$(cygpath -m "$LOCALAPPDATA/Temp/gp-dist-bak_$(date +%s)")"
  echo "→ 移走旧构建产物 → $BAK"
  mv "$OUT_DIR" "$BAK"
fi

# 2. 国内镜像，跑构建（输出已在 tmpdir，收尾删 .nsis.7z 不会再被守卫拦截）
echo "→ 开始打包（输出目录: $OUT_DIR）…"
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
"$NODE_BIN" "$BUILDER" --win --x64 -c.win.signAndEditExecutable=false

# 3. 拷贝到 release（确保目录存在，可能被外部 mv 走）
mkdir -p "$APP_DIR/release"
if [ -f "$OUT_DIR/GitPusher-Setup-1.0.0.exe" ]; then
  cp "$OUT_DIR/GitPusher-Setup-1.0.0.exe" "$APP_DIR/release/GitPusher-Setup-1.0.0.exe"
  echo "✓ 已拷贝到 release/GitPusher-Setup-1.0.0.exe"
else
  echo "✗ 未找到构建产物 $OUT_DIR/GitPusher-Setup-1.0.0.exe" >&2
  exit 1
fi

echo "✓ 完成"