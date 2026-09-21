/**
 * 自检 + 预览生成。不启动 DSH 也能跑：
 *     node check.mjs
 *
 * 覆盖：路由齐不齐、注入落点对不对、是否幂等、boot.js 与 client.js 能不能解析、
 * 图片上传/回退的完整来回（写到临时 DSH_HOME，不碰真图）、客户端半边的插件契约，
 * 顺带把同一份 CSS/JS 挂到假主界面上生成 preview/ 供肉眼看过场与壁纸。
 */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import vm from 'node:vm'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(ROOT, 'assets')
const BASE = '/dsh-startup'
const BOOT_SRC = '<script defer src="' + BASE + '/boot.js"></script>'

// 上传测试必须写进临时目录：插件在 import 时就读 DSH_HOME，所以先改环境再动态 import
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-startup-check-'))
process.env.DSH_HOME = sandboxHome
const { default: plugin } = await import('./lib/index.js')

// 1) 用假 ctx 跑一遍 apply，收下路由、index 注入与日志
const routes = new Map()
const taps = []
const logs = []
plugin.apply({
  logger: () => ({ info: (line) => logs.push(line), warn: () => {}, error: () => {} }),
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
    tapIndex(tap) {
      taps.push(tap)
      return () => {}
    },
  },
  effect(run) {
    run()
  },
})

assert.equal(plugin.name, 'dsh-startup-animation')
assert.equal(logs.length, 1, '挂载后应留下一条就绪日志')
assert.deepEqual(
  [...routes.keys()].sort(),
  [
    BASE + '/avatar',
    BASE + '/bg',
    BASE + '/boot.js',
    BASE + '/config',
    BASE + '/images',
    BASE + '/images/avatar',
    BASE + '/images/avatar/reset',
    BASE + '/images/bg',
    BASE + '/images/bg/reset',
    BASE + '/preview',
  ].sort(),
  '十个路由必须都注册上',
)
assert.equal(taps.length, 1, '必须只注册一个 index 注入')

// 2) 页面里引用的每个 /dsh-startup/* 都得有对应路由，否则静默 404
const splashCss = readFileSync(join(ASSETS, 'boot.css'), 'utf8')
const wallCss = readFileSync(join(ASSETS, 'wallpaper.css'), 'utf8')
const js = readFileSync(join(ASSETS, 'boot.js'), 'utf8')
const referenced = new Set(
  [...`${splashCss}\n${wallCss}\n${js}`.matchAll(/\/dsh-startup\/[\w.-]+/g)].map((m) => m[0]),
)
assert.deepEqual(
  [...referenced].sort(),
  [BASE + '/avatar', BASE + '/bg', BASE + '/boot.js'],
  '页面只该引用这三个地址',
)
for (const url of referenced) assert.ok(routes.has(url), `缺少路由：${url}`)

// 3) 两个脚本都必须能解析——语法错误等于启动页永远不撤 / 设置页签不出现
new vm.Script(js)
const clientJs = readFileSync(join(ROOT, 'client', 'client.js'), 'utf8')
new vm.Script(clientJs)

// 3b) boot.js 搭出来的每个类名都得在 boot.css 里有规则——手写动画最容易在这里悄悄失配
const classes = new Set(
  [...js.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)),
)
for (const name of classes) {
  assert.ok(splashCss.includes('.' + name), `boot.css 里缺少 .${name}，但 boot.js 会用到它`)
}
for (const layer of ['dshs-world', 'dshs-aurora', 'dshs-star', 'dshs-petals', 'dshs-streaks', 'dshs-shine', 'dshs-accent', 'dshs-tip', 'dshs-orb', 'dshs-cursor', 'dshs-orbit', 'dshs-spark', 'dshs-handoff']) {
  assert.ok(splashCss.includes('.' + layer), `boot.css 里缺少 .${layer}，这一层画面不该被删掉`)
}
// 低配机友好：这两样是掉帧主因。只提醒不拦——机器好的话想加回来是自由的。
if (/\.dshs-bg\s*\{[^}]*filter:/.test(splashCss)) {
  console.log('… 注意：启动页背景挂了全屏 filter（blur），低配机上会明显掉帧')
}
if (splashCss.includes('mask-image')) {
  console.log('… 注意：启动页用了 mask（大层遮罩混合），低配机上会明显掉帧')
}
// 收尾交接靠"启动页背景 == 主界面壁纸"：白纱必须来自同一组变量，且主界面那张图也是 cover
assert.ok(wallCss.includes('--dshs-wall-veil-a') && wallCss.includes('--dshs-wall-veil-b'), '壁纸白纱要定义成变量，供收尾那层复用')
assert.ok(splashCss.includes('--dshs-wall-veil-a') && splashCss.includes('--dshs-wall-veil-b'), '收尾层要消费同一组白纱变量')
assert.ok(/\.dshs-bg\s*\{[^}]*inset:\s*0;/.test(splashCss), '启动页背景层不能留富余，否则和主界面壁纸的取景对不上')
// 视差一半在 JS（写变量）一半在 CSS（消费变量），两边都得在
assert.ok(js.includes('--dshs-px') && js.includes('--dshs-py'), 'boot.js 要把指针位置写进视差变量')
assert.ok(splashCss.includes('--dshs-px') && splashCss.includes('--dshs-py'), 'boot.css 要消费视差变量')
// 主界面「模块组装」同理：JS 挂动画名 + 写起点变量，CSS 定义关键帧，缺一个都静默失效
assert.ok(js.includes('dshs-assemble'), 'boot.js 要在收尾时挂上模块组装动画')
assert.ok(splashCss.includes('@keyframes dshs-assemble'), 'boot.css 要有 dshs-assemble 关键帧')
assert.ok(splashCss.includes('--dshs-ax') && splashCss.includes('--dshs-ay'), '关键帧要消费组装起点变量')
assert.ok(js.includes("'--dshs-ax'") && js.includes("'--dshs-ay'"), 'boot.js 要写入组装起点变量')

// 5) 主界面 hero 改造：隐藏类与光标动画在 hero.css 里，client.js 负责挂类 + 写光标字符，
//    两边名字必须对得上（这类手写 DOM 改造最容易在这里悄悄失配）。
const heroCss = readFileSync(join(ASSETS, 'hero.css'), 'utf8')
assert.ok(heroCss.includes('.dshs-hero-hide'), 'hero.css 要有隐藏 logo/徽章的类')
assert.ok(heroCss.includes('@keyframes dshs-hero-blink'), 'hero.css 要有光标闪动关键帧')
for (const name of ['dshs-hero-hide', 'dshs-hero-typed']) {
  assert.ok(heroCss.includes('.' + name), `hero.css 里缺少 .${name}`)
  assert.ok(clientJs.includes(name), `client.js 要用到 ${name}，否则这个类白写了`)
}
assert.ok(heroCss.includes('--dshs-hero-cursor'), '光标字符要能由 client.js 通过变量配置')
assert.ok(clientJs.includes("'--dshs-hero-cursor'"), 'client.js 要把光标字符写进 --dshs-hero-cursor')
assert.ok(heroCss.includes('prefers-reduced-motion'), 'hero.css 要在「减少动态效果」下让光标常亮')
// 文案与开关都来自配置路由，client.js 不许再把问候语写死
assert.ok(clientJs.includes("'/dsh-startup/config'"), 'client.js 要从配置路由取 hero 配置')
assert.ok(clientJs.includes('探索未至之境') === true, 'client.js 要留着原文案当"找到 hero 标题"的锚点')

// 4) 图片槽位：上传 → 生效 → 恢复默认，全程只碰临时目录
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
])
function fakeRes() {
  return {
    status: 0,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
}
function fakeReq(body, method) {
  const req = Readable.from([body])
  // 真实的 http.IncomingMessage 一定带 method；/config 靠它区分读和写，假请求也得给上
  req.method = method || 'GET'
  return req
}
async function call(path, body, method) {
  const res = fakeRes()
  await routes.get(path).handler(fakeReq(body, method), res)
  return res
}
function served(slot) {
  const res = fakeRes()
  routes.get(BASE + '/' + slot).handler(fakeReq(Buffer.alloc(0)), res)
  return res
}

const defaults = { avatar: served('avatar').body, bg: served('bg').body }
assert.deepEqual(defaults.avatar, readFileSync(join(ASSETS, 'toxiang.jpg')), '没传图时头像应是内置默认图')

const uploaded = await call(BASE + '/images/avatar', png)
assert.equal(uploaded.status, 200, '正常上传应成功')
assert.equal(JSON.parse(uploaded.body).ok, true)
assert.equal(JSON.parse(uploaded.body).state.avatar.custom, true, '上传后状态应标为自定义')
assert.ok(existsSync(join(sandboxHome, 'dsh-startup-animation', 'avatar.png')), '图片应落到 DSH_HOME 下的插件目录')
assert.deepEqual(served('avatar').body, png, '页面拿到的应该是刚传的图')
assert.equal(served('avatar').headers['Content-Type'], 'image/png')
assert.deepEqual(served('bg').body, defaults.bg, '另一个槽位不受影响')

const rejected = await call(BASE + '/images/bg', Buffer.from('这不是图片，只是一段文字'))
assert.equal(rejected.status, 400, '非图片内容必须被拒')
assert.equal(JSON.parse(rejected.body).ok, false)
assert.ok(JSON.parse(rejected.body).error.length > 0, '拒绝时要给得出原因')

const back = await call(BASE + '/images/avatar/reset')
assert.equal(back.status, 200)
assert.deepEqual(served('avatar').body, defaults.avatar, '恢复默认后应回落到内置图')
assert.equal(JSON.parse(back.body).state.avatar.custom, false)

const stateRes = fakeRes()
routes.get(BASE + '/images').handler(fakeReq(Buffer.alloc(0)), stateRes)
const state = JSON.parse(stateRes.body)
assert.deepEqual(Object.keys(state).sort(), ['avatar', 'bg'])
assert.equal(state.bg.custom, false)

// 4b) hero 配置：读默认 → 局部保存（其余项不许被打回默认）→ 坏 JSON 被拒 → 恢复默认，全程只碰临时目录
const readConfig = async () => JSON.parse((await call(BASE + '/config', Buffer.alloc(0))).body).config

const fresh = await readConfig()
assert.equal(fresh.headline, '你好，我是和栗薰子，欢迎使用Deepseek Harness', '默认问候语要能读出来')
assert.equal(fresh.typewriter, true)
assert.equal(fresh.hideLogo, true, '默认要摘掉 logo')
assert.equal(fresh.hideBadge, true, '默认要摘掉「预览版」徽章')

const patched = JSON.parse((await call(BASE + '/config', Buffer.from(JSON.stringify({ headline: '测试文案', speed: 200 })), 'POST')).body)
assert.equal(patched.ok, true, '保存配置应成功')
assert.equal(patched.config.headline, '测试文案')
assert.equal(patched.config.speed, 200)
assert.equal(patched.config.cursorChar, fresh.cursorChar, '只改了两个字段，其余项要保持原值')
assert.equal((await readConfig()).headline, '测试文案', '保存后要真的落盘（重新读一次）')

const clamped = JSON.parse((await call(BASE + '/config', Buffer.from(JSON.stringify({ speed: -5, cursor: 'yes', headline: 'x'.repeat(500) })), 'POST')).body)
assert.equal(clamped.config.speed, 10, '速度要夹到下限')
assert.equal(clamped.config.cursor, true, '类型不对的开关要退回原值')
assert.equal(clamped.config.headline.length, 200, '超长文案要截断')

const broken = await call(BASE + '/config', Buffer.from('{ 这不是 JSON'), 'POST')
assert.equal(broken.status, 400, '坏 JSON 必须被拒')
assert.ok(JSON.parse(broken.body).error.length > 0, '拒绝时要给得出原因')

const restored = JSON.parse((await call(BASE + '/config', Buffer.from(JSON.stringify({ reset: true })), 'POST')).body)
assert.deepEqual(restored.config, fresh, '恢复默认要回到最初那份')

// 5) 客户端半边：真的执行一遍 factory，确认返回的插件与注册的页签都对
const captured = {}
const clientSandbox = { window: { __ModuleLoader__: { load: (reg) => { captured.reg = reg } } }, console }
vm.createContext(clientSandbox)
new vm.Script(clientJs).runInContext(clientSandbox)
assert.equal(captured.reg.id, 'dsh-startup-animation', 'client.js 必须以包名注册')
// 设置页的初始 state 来自 fetch（effect 不跑），所以用一个小队列顶替第一次 useState：
// 把图片状态喂给页面组件，才能渲染出"已读到状态"的那一支。
const stateQueue = []
const fakeReact = {
  createElement: (type, props, ...children) => ({
    type,
    props: Object.assign({}, props, children.length === 0 ? null : { children: children.length === 1 ? children[0] : children }),
  }),
  useState: (initial) => [stateQueue.length > 0 ? stateQueue.shift() : initial, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
}
const clientPlugin = captured.reg.factory((spec) => {
  if (spec === 'react') return fakeReact
  throw new Error(`client.js 只该 require 平台种子模块，却要了 ${spec}`)
})
assert.equal(clientPlugin.name, 'dsh-startup-animation')
// 跨 vm realm 的数组原型不同，逐个比而不是 deepEqual
assert.equal(clientPlugin.inject.length, 1)
assert.equal(clientPlugin.inject[0], 'slots')
const registrations = []
clientPlugin.apply({
  slots: {
    inject: (name, run) => { registrations.push(name); run() },
    register: (options, component) => { registrations.push(options); registrations.push(component) },
  },
})
assert.equal(registrations[0], 'settings.section', '设置页签应挂在 settings.section 上')
assert.equal(registrations[1].name, 'settings.section')
assert.equal(registrations[1].id, 'startup-animation')
assert.equal(typeof registrations[1].label(), 'string')
assert.equal(typeof registrations[2], 'function', '第二个参数要是 React 组件')

// 5b) 真把设置页渲染一遍（假 React 只负责攒树，不碰 DOM）：能挡住组件里的运行时错误，
//     也守住"实时预览 iframe / 两张图的上传入口"这些用户可见的结构不被改掉。
function flatten(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (typeof node.type === 'function') {
    // 函数组件：直接当普通函数调用（钩子都被假 React 兜住了），把它的输出接进树里
    out.push(`<${node.type.name || 'anon'}>`)
    flatten(node.type(node.props), out)
    return out
  }
  out.push(String(node.type))
  const props = node.props ?? {}
  for (const key of Object.keys(props)) {
    if (key === 'children') continue
    if (typeof props[key] === 'string' || typeof props[key] === 'number') out.push(`${key}=${props[key]}`)
  }
  flatten(props.children, out)
  return out
}

/** 喂一份图片状态 + 一份 hero 配置渲染设置页；传 null / undefined 就是"还没读回来"。 */
function renderSection(state, config) {
  if (state !== null) stateQueue.push(state)
  if (config !== undefined) stateQueue.push(config)
  return registrations[2]({})
}

const heroState = {
  headline: '你好，我是和栗薰子，欢迎使用Deepseek Harness',
  typewriter: true,
  speed: 70,
  cursor: true,
  cursorChar: '|',
  hideLogo: true,
  hideBadge: true,
}
const loadedTree = flatten(renderSection({
  avatar: { custom: false, bytes: 4096 },
  bg: { custom: true, bytes: 8192, mtime: 1700000000000 },
}, heroState), []).join(' ')
assert.ok(loadedTree.includes('iframe'), '设置页要有实时预览 iframe')
assert.ok(loadedTree.includes('src=/dsh-startup/preview'), '预览 iframe 要指向宿主的预览路由')
assert.ok(loadedTree.includes('sandbox=allow-scripts'), '预览 iframe 必须沙箱化，别让它碰真实页面的 sessionStorage')
assert.ok(/src=\/dsh-startup\/bg\?v=1700000000000/.test(loadedTree), '换过图的槽位预览要带 mtime 版本号')
assert.ok(loadedTree.includes('type=file'), '两个槽位都要有选图入口')
assert.ok(loadedTree.includes('恢复默认'), '换过图的槽位要能恢复内置默认')
// 主界面标题卡片：问候语要带出来，四个开关都要在
assert.ok(loadedTree.includes('主界面标题'), '设置页要有主界面标题卡片')
assert.ok(loadedTree.includes('你好，我是和栗薰子，欢迎使用Deepseek Harness'), '卡片要带出当前问候语')
for (const label of ['打字机逐字显示', '闪烁光标', '隐藏标题旁的 logo', '隐藏「预览版」徽章']) {
  assert.ok(loadedTree.includes(label), `标题卡片要有「${label}」开关`)
}
assert.ok(loadedTree.includes('恢复默认'), '标题卡片要能恢复默认')
// 配置没读回来时不该渲染这张卡片（否则输入框会以空值初始化，存盘就把配置清空了）
const noConfigTree = flatten(renderSection({
  avatar: { custom: false, bytes: 4096 },
  bg: { custom: false, bytes: 8192 },
}, undefined), []).join(' ')
assert.ok(!noConfigTree.includes('主界面标题'), '配置没读回来之前不该渲染标题卡片')
const loadingTree = flatten(renderSection(null, undefined), []).join(' ')
assert.ok(!loadingTree.includes('iframe'), '状态没读回来之前不该挂 iframe（否则会连播两遍）')
assert.ok(loadingTree.includes('正在读取图片状态'), '没读回来时要有占位')

// 6) 在真实 index.html 上验证注入落点与幂等
const distIndex = join(homedir(), '.dsh/profiles/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
if (existsSync(distIndex)) {
  const shell = readFileSync(distIndex, 'utf8')
  const out = taps[0](shell)
  assert.ok(out.includes('<style id="dshs-css">'), '启动页样式必须注入')
  assert.ok(out.includes('<style id="dshs-wall-css">'), '壁纸样式必须注入')
  assert.ok(out.includes('<style id="dshs-hero-css">'), 'hero 改造样式必须注入（hero 在主界面才渲染，不能只放启动页那份里）')
  assert.ok(out.includes(BOOT_SRC), 'boot.js 必须注入')
  assert.ok(out.indexOf('dshs-css') < out.indexOf('<body'), '关键样式必须落在 <head> 内')
  assert.ok(out.indexOf(BOOT_SRC) < out.indexOf('</body>'), 'boot.js 必须落在 </body> 前')
  const appScript = out.indexOf('assets/index-')
  assert.ok(appScript === -1 || out.indexOf('dshs-css') < appScript, '必须早于主界面脚本，才能抢在首帧前藏住 #root')
  assert.ok(wallCss.includes('--dsw-alias-bg-base'), '壁纸样式要改外壳底色变量')
  assert.ok(wallCss.includes('--dsw-specific-sidebar-fill'), '壁纸样式要改侧栏底色变量')
  assert.equal(taps[0](out), out, '重复注入必须是幂等的')
  console.log(`✓ 真实 index.html 注入通过（${shell.length} → ${out.length} 字节）`)
} else {
  console.log(`… 跳过真实 index.html 校验（找不到 ${distIndex}）`)
}

// 7) 生成可双击打开的自包含预览：直接取宿主预览路由的产物，只把资源路径换成相对路径
//    （file:// 下带扩展名才稳，所以三个地址换成同目录里的真实文件）
const previewRes = fakeRes()
await routes.get(BASE + '/preview').handler(fakeReq(Buffer.alloc(0)), previewRes)
const previewHtml = previewRes.body.toString('utf8')
assert.equal(previewRes.status, 200, '预览页应能正常返回')
assert.equal(previewRes.headers['Content-Type'], 'text/html; charset=utf-8')
assert.ok(previewHtml.includes('<style id="dshs-css">'), '预览页要带上启动页样式')
assert.ok(previewHtml.includes('<div id="root"></div>'), '预览页要有假主界面的挂载点')
assert.ok(previewHtml.includes('__dshsNoRemember'), '预览页不该把真实页面的动画标记成"已播过"')
assert.ok(previewHtml.includes('<style id="dshs-wall-css">'), '预览页要带上主界面壁纸，否则看不到收尾的交接')
assert.ok(previewHtml.includes(BOOT_SRC), '预览页要引 boot.js')
assert.ok(previewHtml.indexOf('dshs-css') < previewHtml.indexOf('<body'), '预览页的启动页样式也要落在 <head> 内')

const previewDir = join(ROOT, 'preview')
rmSync(previewDir, { recursive: true, force: true })
mkdirSync(previewDir, { recursive: true })
const relative = (text) => text
  .split(BASE + '/avatar').join('./avatar.jpg')
  .split(BASE + '/bg').join('./bg.jpg')
  .split(BASE + '/boot.js').join('./boot.js')
writeFileSync(join(previewDir, 'index.html'), relative(previewHtml), 'utf8')
writeFileSync(join(previewDir, 'boot.js'), relative(js), 'utf8')
copyFileSync(join(ASSETS, 'toxiang.jpg'), join(previewDir, 'avatar.jpg'))
copyFileSync(join(ASSETS, 'bizhi.jpg'), join(previewDir, 'bg.jpg'))

rmSync(sandboxHome, { recursive: true, force: true })
console.log(`✓ 全部检查通过（含上传/回退来回、预览页），预览已生成：${join(previewDir, 'index.html')}`)
