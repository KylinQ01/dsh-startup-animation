# 桌面版（DSH Desktop）启动动画修复

> **这份改动现在就住在 `official-desktop` 分支里**：用 DeepSeek 官方桌面版的话，直接装这条分支
> （`git clone -b official-desktop …`），不用手工打补丁，也不会被后续更新冲掉。
> 只有当你往 `main` 的克隆里手工改时，下面这句才成立 —— 重新下载/更新后会丢失，需要重新打一遍。

这个目录里的插件**被本地改过**：上游 v2.1.0 在 DSH Desktop 上放不出启动动画。
重新下载/更新插件后会丢失这个改动，需要重新打一遍（改动集中在 `lib/index.js`，另有 `check.mjs` 的配套断言）。

## 症状

- 插件装好了、宿主日志也有一行「已挂载」，路由 `/dsh-startup/boot.js` 等全部 200；
- 但**打开/重启 DSH Desktop 看不到任何启动动画**，主界面壁纸也不生效；
- 设置页（客户端那半）**是好的**。

## 根因

插件只用 `webServer.tapIndex(transform)` 把启动页塞进 index.html。而 `tapIndex` 是宿主进程里的
字符串变换，**只在"由宿主渲染 index"的形态下会跑**：

- `dsh web`：index 由宿主 HTTP 兜底处理器吐出 → 走 `renderIndex()` → 先渲染结构化注入行、
  再依次跑 `tapIndex` 变换 → 能用；
- **DSH Desktop**：index 由 Electron 外壳从打包好的 `dsh-web-frontend/dist/index.html` 直接吐出
  （页面 origin 是 `dsh-app://app/`，见 `app.asar/lib/main.js` 的 `serveWebDocument`），
  外壳只在 `<head>` 里补一个 `__DSH_BOOT_READY__`；注入内容改走 IPC：
  `collectIndexInjections()` 收集**结构化行** → `ready.injections` → 页面侧解释器 `hM()` 插进文档。

也就是说桌面版页面**只认 JSON 形式的注入行，永远收不到 `tapIndex` 的返回值**。
（`collectIndexInjections()` 只发 `webserver/index-inject` 事件收集行，不包含任何 tap。）

## 改法

除原有的 `tapIndex`（保留给 `dsh web`）之外，再以结构化行声明一遍：

- 三段 CSS 用 `html` 行 —— 因为 `style` 行渲染出来的 `<style>` **没有 id**，
  而启动页收尾要靠 `getElementById('dshs-css')` 摘样式；
- `boot.js` 与新增的 `/dsh-startup/preload.js` 用 `script-src` 行。
  配置与早脚本（`__dshsConfig` + `dshs-boot`）必须**每次页面加载现读**，
  而行是宿主启动时的快照，所以这部分放进新路由 `preload.js`；
- `inject()` 见到 `preload.js` 标记就让位，两条通路谁在跑都不会插双份。

页面侧解释器会**按顺序 await 每个 `script-src`**，且整张表应用完才 resolve
`__DSH_BOOT_READY__`（应用在此之前不会挂载），所以启动页仍然先于主界面出现。

## 验证方式

- `node check.mjs`（Node 18+）：含新路由与新注入行的断言；
- 宿主侧路由：`/dsh-startup/preload.js` 应返回现读的配置 + 早脚本；
- 造一个"外壳形态"的页面（打包 index.html + `__DSH_BOOT_READY__` +
  `dshDesktopBoot.ready()` 返回这张行表）在浏览器里打开，应看到完整启动动画。
