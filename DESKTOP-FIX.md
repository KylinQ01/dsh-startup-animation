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
- **早脚本本体内联**成 `script` 行（`EARLY_BODY` 是纯静态代码：只看 `sessionStorage`
  并给 `<html>` 加类名）。行应用完才 resolve `__DSH_BOOT_READY__`，所以它一定赶在
  应用挂载前跑完，白底一闪照样挡得住，而且零网络、不可能失败；
- 配置与动画由**内联装载器**挂真实 `<script src>`：`/dsh-startup/preload.js` 进 head、
  `boot.js` 进 body。配置必须**每次页面加载现读**，而行是宿主启动时的快照，
  所以这一半仍旧走路由。`s.async=false` 保住 preload → boot 的执行顺序，
  `s.onerror` 吞掉失败。
- `inject()` 见到 `preload.js` 标记就让位，两条通路谁在跑都不会插双份。

## 加固：为什么最终一行 `script-src` 都不用（issue #154）

页面侧解释器对两种 script 行的处理**不对称**：

| 行 | 解释器怎么做 | 失败会怎样 |
| --- | --- | --- |
| `script`（内联） | `createElement` + `textContent` + append | 没有网络，**不可能失败** |
| `script-src` | `await loadScript(src)` | **reject ⇒ 连带 reject `__DSH_BOOT_READY__` ⇒ 应用起不来** |

再加上一层：外壳把这张注入表在**宿主启动时收集一次就缓存，没有任何刷新路径** ——
插件在运行期被关掉（比如在插件管理里禁用）时，表里仍留着那一行，而 `/dsh-startup/*`
路由已经注销，加载 404 就把应用钉死在启动阶段。`dsh-whale-widget` 0.3.18 的源码注释里
记了这个坑（issue #154），它也是改成内联行 + 吞 `onerror` 的。

所以这里的取舍是：**宁可"这次不放动画"，也不能"应用起不来"**。
早脚本内联后不存在时序回退（它本就同步执行）；只有配置与动画退化成动态加载，
而它们的顺序由 `async=false` 保证，最坏情况是启动页不播、8 秒后主界面自己放行。

## 验证方式

- `node check.mjs`（Node 18+）：含新路由与新注入行的断言，并**明确断言 `script-src` 行数为 0**、
  第一段必须是早脚本本体、两个装载器必须带 `async=false` 与 `onerror`；
- 宿主侧路由：`/dsh-startup/preload.js` 应返回现读的配置 + 早脚本；
- 宿主渲染路径实测（`dsh <profile>` 后取 `/`）：两个装载器原文正确、`async=false` 与
  `onerror` 各 2 处、`<script src="/dsh-startup…">` 静态标签 0 个、`dshs-css` 无重复注入；
- 造一个"外壳形态"的页面（打包 index.html + `__DSH_BOOT_READY__` +
  `dshDesktopBoot.ready()` 返回这张行表）在浏览器里打开，应看到完整启动动画。
