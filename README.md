<div align="center">

# 🌸 dsh-startup-animation

**给 DeepSeek Harness 的开机动画 + 主界面壁纸**

*打开软件的那两秒，也可以很好看喵。*

<img src="assets/bizhi.jpg" width="640" alt="背景图">

</div>

---

## ✨ 它会做什么

一次开机，演这么一出小戏 🎬

| 时刻 | 画面 |
| --- | --- |
| `0.0s` | 主界面被 `<head>` 里的早脚本提前藏好，**不会先闪一下白底主界面** |
| `~0.1s` | 背景图缓缓推近 · 三团极光来回漂 · 一束放射光慢慢转 · 星尘一闪一闪 · 光点往上飘 · 流星偶尔掠过 |
| `~0.2s` | 头像「啵」地弹进来，套一圈爆闪环 + 三圈涟漪，还有一道玻璃反光扫过 |
| `~0.3s` | 「**欢迎回来**」一个字一个字浮上来，下面一条渐变细线展开 |
| 全程 | 鼠标一动，整屏按远近**分层视差**跟着晃，有纵深 🐾 |
| 加载好了 | 中心 bloom 一下 → 启动页淡出、背景推远虚化 → 主界面 680ms 淡入归位 |
| 进去之后 | 主界面壁纸**就是同一张背景图**，所以过场看起来像"背景由虚转实"，接得很顺 🍃 |

最短演 1.5 秒，最多挡你 5 秒；**点一下或者按任意键**就能跳过。

而且——**两张图都能在设置里自己换**，换完当场就能预览，不用重启 👇

## 🎀 换图：设置 → 启动动画与壁纸

| 位置 | 做什么 |
| --- | --- |
| 顶部「实时预览」 | 把开机那一份启动动画原样嵌在小窗里播放。换完图**自动重放**，「重播」手动重放，「新标签打开」放大看 |
| 头像卡片 | 开机动画正中那张。点「选择图片」，或者**直接把图拖到卡片上**。圆角方框显示，不会把猫耳朵裁掉 🐱 |
| 背景图卡片 | 开机背景 + 主界面壁纸。建议横图，界面里按 cover 铺满 |
| 恢复默认 | 删掉自定义图，回到包里自带的图 |
| 在真实界面里看一遍 | 清掉"刚看过"的标记再刷新，真的在 DSH 里重放一遍 |

- 支持 **PNG / JPEG / WebP / GIF**，单张上限 **12MB**（按文件魔数识别，不看 Content-Type）
- 自定义图存在 `$DSH_HOME/dsh-startup-animation/`，删掉文件或点「恢复默认」即可还原
- 壁纸**刷新就生效**，不用重启；在预览小窗里看一遍也**不会**让真实页面误以为"已经播过了"

## 🚀 安装

```powershell
git clone https://github.com/KylinQ01/dsh-startup-animation.git
```

然后把依赖写进 profile 的 `package.json`（`link:` 指向刚 clone 下来的目录）：

```jsonc
// ~/.dsh/profiles/<profile>/package.json
"dependencies": {
  "dsh-startup-animation": "link:/绝对路径/dsh-startup-animation"
}
```

```powershell
dsh plugin --profile desktop install --offline   # 建好 node_modules 链接，并自动加进 dsh.profile.bundles
dsh --profile desktop --dump-config | Select-String startup-animation   # 看到 id: dsh-startup-animation 就对了
```

然后**重启 DSH**（DSH Desktop 或 `dsh web`）。宿主日志里会出现：

```
[dsh-startup-animation] dsh-startup-animation: 启动动画 + 主界面壁纸已挂载，图片目录 …
```

> ⚠️ Windows 上路径里带空格的话，**别用 `dsh plugin add` 传路径** —— 它经 cmd 转发会把参数切碎，
> 手动写进 `package.json` 再 `install` 就好。

**卸载**：从 profile 的 `package.json` 里删掉依赖，再跑一次 `dsh plugin install`，`bundles` 会被自动回收。
（插件目录别删也别改名 —— profile 通过 `link:` 指着它呢。）

## 🎛 想自己改改

| 想改 | 改哪里 |
| --- | --- |
| 节奏：最短/兜底时长、就绪判定、过场时长、星尘光点数量 | `assets/boot.js` 顶部那几个常量 |
| 头像大小圆角、文字、进度条 | `assets/boot.css` 的 `.dshs-avatar` / `.dshs-hello` / `.dshs-bar` |
| 背景虚化程度、推近速度 | `.dshs-bg` 的 `filter` 和 `dshs-drift` |
| **极光颜色与浓淡** | `.dshs-aurora i:nth-child(1~3)` 的三组 `radial-gradient` |
| 星尘 / 光点 / 流星 | `.dshs-star` / `.dshs-petal` / `.dshs-streaks` |
| 光束转速与明暗 | `.dshs-rays` 的 `conic-gradient` 和 `dshs-spin` |
| **鼠标视差幅度** | `boot.css` 顶部三条 `translate: calc(var(--dshs-px) * Npx)`，改那个 N 就是改纵深 |
| 主界面壁纸浓淡 / 侧栏透明度 | `assets/wallpaper.css`（两个白色透明度越大越淡；侧栏看 `--dsw-specific-sidebar-fill`） |

改 `lib/index.js`（路由、注入）要重启宿主；只改 `client/client.js` 由客户端 HMR 热更。

> `check.mjs` 会逐个核对 **boot.js 用到的类名在 boot.css 里有没有规则**，新增画面层时漏写会直接报错，
> 不会让你对着一个"没反应"的元素发呆 🔍

## 🧪 自检 & 本地预览

```powershell
node check.mjs      # Node 18+
```

它会把路由、注入落点、幂等、脚本语法、上传/回退的完整来回、设置页组件全跑一遍，
最后生成 `preview/index.html` —— **双击就能完整看一遍动画与过场**，不用装进 DSH。

> 💡 用无头浏览器截图核对画面时注意：headless Chromium 默认把 `prefers-reduced-motion` 报成 `reduce`，
> 会关掉星尘/光点/循环动效，你看到的是"静音版"。要走 CDP `Emulation.setEmulatedMedia` 显式模拟
> `no-preference` 才是真实效果。

## ❓ 小问题

**刷新页面怎么不放动画？**
同一标签页 **60 秒内**重复刷新会自动跳过（自动重载循环不该每次都演一遍），只看壁纸变化。
想看：点设置里的「在真实界面里看一遍」，或者开个无痕窗口。

**切深色主题为什么没壁纸了？**
故意的。浅色图配浅色文字会糊成一片，所以深色主题保持原样。真想要：删掉
`wallpaper.css` 里的 `:not([data-ds-dark-theme])`，然后自己想好文字对比度怎么办 🙈

**会不会白屏？**
不会。任何一步抛异常都会立刻撤掉启动页、把主界面放出来 —— 最坏情况是"没有动画"，
绝不是"打不开"。另外 `<head>` 里还留了 8 秒自动放行的保险。

**系统开了「减少动态效果」怎么办？**
只保留入场和过场，常驻循环、星尘、光点、视差全部关掉。

## 📄 许可

[MIT](LICENSE) © KylinQ01

<div align="center">

*愿你每次打开它，都被好好欢迎一次。* 🌙

</div>
