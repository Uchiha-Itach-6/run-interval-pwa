# 间歇跑 PWA（第一版）

一个不依赖框架、数据库或后端的静态网页应用。适合在 Windows 上开发，部署到 HTTPS 网址后，再由 iPhone Safari 添加到主屏幕。

## 当前功能

- 第 1、2、3 周间歇训练预设。
- 第 4 周三项连续跑秒表模式（本版不读取 GPS 距离）。
- 自定义跑步时长、步行时长、循环组数、末组加时。
- 自动切换跑步/步行阶段、进度条、暂停/继续、跳过、结束。
- 提示音、中文语音（取决于设备和浏览器支持）。
- localStorage 保存预设和设置；Service Worker 缓存静态资源，支持加载过后的离线打开。

## 本地运行（Windows）

1. 解压文件夹。
2. 安装 VS Code：<https://code.visualstudio.com/>。
3. 在 VS Code 中打开 `run-interval-pwa` 文件夹。
4. 在扩展商店安装 `Live Server`。
5. 右键 `index.html`，选择 **Open with Live Server**。
6. 浏览器打开后测试计时、暂停、继续、跳过和提示音。

不要直接双击 `index.html` 用 `file://` 测试 PWA：Service Worker 需要 HTTPS 或 localhost 环境。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个仓库，例如 `run-interval-pwa`。如果用免费公开仓库，代码会公开；不要放个人隐私或密码。
2. 把本文件夹内的所有文件和 `icons` 文件夹上传至仓库根目录（注意不要多套一层文件夹）。
3. 进入仓库 **Settings → Pages**。
4. 在 **Build and deployment** 中选择 **Deploy from a branch**。
5. Branch 选 `main`，目录选 `/(root)`，点击 **Save**。
6. 等待 Pages 部署成功，打开设置页显示的网址。GitHub Pages 的首次发布可能需要数分钟。
7. 后续修改文件并提交到 `main`，Pages 会自动重新部署。

此项目使用相对路径，适用于 `https://用户名.github.io/仓库名/` 形式的网址。

## 添加到 iPhone 主屏幕

1. 在 iPhone 上用 Safari 打开 GitHub Pages 网址（不要在电脑上本地开发地址上操作）。
2. 点“分享”。
3. 选择“添加到主屏幕”。
4. 如果出现“作为网页 App 打开 / Open as Web App”，将其打开，然后点“添加”。
5. 从主屏幕图标启动应用，首次开始训练时允许声音，并在页面前台完成测试。

## 必测项目

- 第 1 周：在自定义方案里临时设置跑步 1 分钟、步行 15 秒、循环 2 组，测试自动切换，再恢复正式参数。
- 暂停后等待 10 秒再继续，确认剩余时间按暂停时保留。
- 跳过一段后确认立即进入下一段；最后一段不能继续跳过。
- 结束训练后能重新开始。
- 关闭网络后重新打开已加载过的网页，确认页面资源能离线载入。
- iPhone 前台运行 3–5 分钟，检查提示音、语音和切换时间。
- 单独测试锁屏、切换其他 App、低电量模式和来电中断。iOS 可能暂停后台网页执行，主屏幕网页 App 的屏幕常亮能力也有限，不能承诺锁屏期间准时播报。

## 当前不包含

- GPS 与距离测量。
- 云端同步、账号、训练历史图表。
- 锁屏期间的可靠后台计时/音频。
- 原生 iOS 通知能力。

## 文件结构

```text
run-interval-pwa/
├─ index.html              页面结构
├─ styles.css              手机优先的响应式样式
├─ app.js                  计划、计时状态与交互逻辑
├─ manifest.webmanifest    PWA 名称、图标与启动方式
├─ sw.js                   离线缓存
├─ icons/
│  ├─ icon-192.png
│  └─ icon-512.png
└─ README.md
```
