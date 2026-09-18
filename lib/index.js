/**
 * dsh-startup-animation —— DSH 启动动画 + 主界面壁纸（宿主侧）。
 *
 * 做四件事：
 *   1. 图片槽位：`avatar` / `bg` 各一个，用户上传的图放 `$DSH_HOME/dsh-startup-animation/`，
 *      没有就用包里自带的 `assets/toxiang.jpg`、`assets/bizhi.jpg`；
 *   2. 具名路由：`/dsh-startup/{boot.js,avatar,bg}` 供页面取用，
 *      `/dsh-startup/images[...]` 供设置页读状态、传图、恢复默认，
 *      `/dsh-startup/preview` 是给设置页内嵌的自包含预览页（换图后立刻能看效果）；
 *   3. 用 `webServer.tapIndex` 往 index.html 里塞两段样式与一段脚本：`<head>` 里是启动页关键 CSS
 *      （收尾时由 boot.js 移除）与常驻的主界面壁纸 CSS，`</body>` 前是 boot.js（启动页 DOM 都在这）；
 *   4. 插件卸载时收回全部注册。
 *
 * 页面侧：`assets/boot.js`（动画）、`assets/boot.css`（启动页样式）、`assets/wallpaper.css`（主界面样式）、
 * `client/client.js`（设置页签）。四者都可以直接改；改 client.js 由客户端 HMR 热更，改其余要重启宿主。
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NAME = 'dsh-startup-animation'
const BASE = '/dsh-startup'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DATA_DIR = join(DSH_HOME, NAME)
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

/** 两个图片槽位：槽位名 → 用户文件名前缀 + 包内默认图。 */
const SLOTS = {
  avatar: { file: 'avatar', fallback: 'toxiang.jpg' },
  bg: { file: 'bg', fallback: 'bizhi.jpg' },
}

/**
 * 紧跟 `<head>` 同步执行的早脚本：趁首帧之前把主界面藏起来，避免"先闪一下主界面再盖上"。
 * 60 秒内的重复刷新直接跳过（自动重载循环不该每次放动画）；8 秒还没收尾就自行放行，
 * 保证 boot.js 万一没加载也不会白屏。
 */
const EARLY = '<script>(function(){var h=document.documentElement,k="dshs-at";'
  + 'try{var t=sessionStorage.getItem(k);if(t&&Date.now()-+t<6e4)return}catch(e){}'
  + 'h.classList.add("dshs-boot");'
  + 'setTimeout(function(){h.classList.remove("dshs-boot")},8e3)})()</script>'

function asset(name) {
  return readFileSync(join(PACKAGE_ROOT, 'assets', name))
}

/** 只认这四种图片：按魔数判断，不信 Content-Type。 */
function sniffExt(body) {
  if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpg'
  if (body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return 'png'
  if (body.length > 3 && body.toString('latin1', 0, 3) === 'GIF') return 'gif'
  if (body.length > 12 && body.toString('latin1', 0, 4) === 'RIFF' && body.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

/** 用户给这个槽位传的图（没有就是 null）。 */
function userImage(slot) {
  const prefix = SLOTS[slot].file + '.'
  let names = []
  try {
    names = readdirSync(DATA_DIR)
  } catch {
    return null
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const ext = name.slice(prefix.length)
    if (TYPES[ext] === undefined) continue
    const path = join(DATA_DIR, name)
    try {
      const stat = statSync(path)
      return { path, ext, bytes: stat.size, mtime: stat.mtimeMs }
    } catch {
      return null
    }
  }
  return null
}

/** 页面拿到的这张图：用户图优先，否则包内默认图。 */
function imageOf(slot) {
  const user = userImage(slot)
  if (user !== null) return { body: readFileSync(user.path), type: TYPES[user.ext], custom: true }
  const fallback = SLOTS[slot].fallback
  return { body: asset(fallback), type: TYPES[fallback.split('.').pop()], custom: false }
}

function imageState() {
  const state = {}
  for (const slot of Object.keys(SLOTS)) {
    const user = userImage(slot)
    state[slot] = user === null
      ? { custom: false, bytes: asset(SLOTS[slot].fallback).length }
      : { custom: true, bytes: user.bytes, mtime: Math.round(user.mtime) }
  }
  return state
}

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendJson(res, status, value) {
  send(res, status, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(value)))
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        reject(new Error(`图片超过 ${Math.round(limit / 1024 / 1024)}MB 上限`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 收到一张图：验大小、验魔数、原子落盘，并清掉该槽位的旧文件。 */
async function upload(slot, req, res) {
  try {
    const body = await readBody(req, MAX_UPLOAD_BYTES)
    if (body.length === 0) throw new Error('收到空内容')
    const ext = sniffExt(body)
    if (ext === null) throw new Error('只认 JPEG / PNG / WebP / GIF')
    mkdirSync(DATA_DIR, { recursive: true })
    const keep = `${SLOTS[slot].file}.${ext}`
    const temp = join(DATA_DIR, keep + '.tmp')
    writeFileSync(temp, body)
    renameSync(temp, join(DATA_DIR, keep))
    const prefix = SLOTS[slot].file + '.'
    for (const name of readdirSync(DATA_DIR)) {
      if (name !== keep && name.startsWith(prefix) && TYPES[name.slice(prefix.length)] !== undefined) {
        rmSync(join(DATA_DIR, name), { force: true })
      }
    }
    sendJson(res, 200, { ok: true, slot, ext, bytes: body.length, state: imageState() })
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** 恢复默认：把这个槽位的用户图删掉，页面回落到包内自带图。 */
function reset(slot, res) {
  try {
    const user = userImage(slot)
    if (user !== null) rmSync(user.path, { force: true })
    sendJson(res, 200, { ok: true, slot, state: imageState() })
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 预览页里那个假主界面的样式。只为看清过场，与真实 DSH 布局无关；
 * 底色挂在同名变量上，方便将来把壁纸样式也套进预览。
 */
const PREVIEW_CSS = `
  html, body { margin: 0; height: 100%; }
  body {
    font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #22303f; background: #fff;
    --dsw-alias-bg-base: #fff; --dsw-specific-sidebar-fill: #eef0f7;
  }
  .pv { display: flex; height: 100vh; background: var(--dsw-alias-bg-base); }
  .pv aside { width: 200px; box-sizing: border-box; padding: 16px; background: var(--dsw-specific-sidebar-fill); font-size: 12px; color: #55617a; }
  .pv aside b { display: block; margin-bottom: 12px; color: #22303f; font-size: 13px; }
  .pv aside i { display: block; padding: 8px 10px; border-radius: 8px; font-style: normal; }
  .pv main { flex: 1; min-width: 0; display: flex; flex-direction: column; box-sizing: border-box; padding: 22px 26px; }
  .pv h1 { margin: 0 0 6px; font-size: 17px; }
  .pv p { margin: 0; color: #7a869c; font-size: 12px; }
  .pv .composer { margin-top: auto; padding: 10px 12px; border: 1px solid #dde1ec; border-radius: 14px; background: #fff; box-shadow: 0 6px 20px -12px rgba(34, 48, 63, .4); }
  .pv textarea { width: 100%; height: 44px; border: 0; outline: 0; resize: none; font: inherit; font-size: 13px; background: transparent; }
  #dshs-replay { position: fixed; right: 14px; bottom: 14px; z-index: 1; height: 30px; padding: 0 14px; border: 1px solid #d1d5db; border-radius: 999px; background: rgba(255, 255, 255, .92); color: #22303f; font: inherit; font-size: 12px; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity .4s ease .6s; }
  #dshs-replay.is-ready { opacity: 1; pointer-events: auto; }
`

/**
 * 预览页里假主界面的挂载脚本：延迟 2.6s 才出现，模拟真实 app 建连 + 首屏耗时，
 * 这样过场才看得出是"启动页撤离、主界面接上"，而不是两边同时冒出来。
 */
const PREVIEW_JS = `
  // 启动页盖着的时候别把「重播」露出来（它是 fixed，会透在动画上）
  var replayTimer = setInterval(function () {
    if (document.getElementById('dshs')) return
    clearInterval(replayTimer)
    document.getElementById('dshs-replay').classList.add('is-ready')
  }, 200)
  setTimeout(function () {
    document.getElementById('root').innerHTML =
      '<div class="pv">' +
        '<aside><b>DeepSeek Harness</b><i>新会话</i><i>会话记录</i><i>插件</i><i>设置</i></aside>' +
        '<main><h1>主界面</h1>' +
        '<p>启动页撤离后由 #root 的淡入归位接上；背景图换掉，这里的壁纸也会跟着变。</p>' +
        '<div class="composer"><textarea placeholder="给 DeepSeek Harness 发消息…"></textarea></div>' +
        '</main>' +
      '</div>'
  }, 2600)
`

/**
 * 预览页：同一份启动页样式 + 壁纸样式 + boot.js，挂在一个假主界面上。
 * 设置页把它塞进 iframe（sandbox="allow-scripts"），换完图立刻能看到效果；也可以直接开新标签页。
 *
 * 壁纸样式要一并带上：主界面壁纸画在 body 上，而启动页收尾正是要和它对齐交接——
 * 少了这段，预览里就看不到"背景由虚转实"那一下。
 *
 * 与真实页面的两点差别：无条件加上 `.dshs-boot`（不参与早脚本的"60 秒内跳过"），
 * 以及置上 `__dshsNoRemember`，免得在预览里看一遍就把真实页面的动画也标记成"已经播过"。
 * @param splashCss - 启动页关键样式，与注入 index.html 的那份完全相同
 * @param wallCss - 主界面壁纸样式，同样与真实页面一致
 */
function previewPage(splashCss, wallCss) {
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>DSH 启动动画 · 预览</title>\n'
    + '<style>' + PREVIEW_CSS + '</style>\n'
    + '<style id="dshs-css">' + splashCss + '</style>\n'
    + '<style id="dshs-wall-css">' + wallCss + '</style>\n'
    + '<script>window.__dshsNoRemember = true;document.documentElement.classList.add("dshs-boot")</script>\n'
    + '</head>\n<body>\n'
    + '<div id="root"></div>\n'
    + '<button id="dshs-replay" type="button" onclick="location.reload()">重播</button>\n'
    + '<script>' + PREVIEW_JS + '</script>\n'
    + '<script defer src="' + BASE + '/boot.js"></script>\n'
    + '</body>\n</html>\n'
}

/**
 * 把启动页与壁纸标记注入 index.html。幂等：已经注入过的 HTML 原样返回。
 * @param html - 宿主渲染好的 index.html
 * @param splashCss - 启动页关键样式（`<head>`，启动页收尾时移除）
 * @param wallCss - 主界面壁纸样式（`<head>`，常驻）
 */
function inject(html, splashCss, wallCss) {
  if (html.indexOf(BASE + '/boot.js') !== -1) return html
  const head = '<style id="dshs-css">' + splashCss + '</style>'
    + '<style id="dshs-wall-css">' + wallCss + '</style>'
    + EARLY
  const tail = '<script defer src="' + BASE + '/boot.js"></script>'
  const opened = html.replace(/<head(\s[^>]*)?>/i, (tag) => tag + head)
  return opened.indexOf('</body>') !== -1
    ? opened.replace('</body>', tail + '</body>')
    : opened + tail
}

export default {
  name: NAME,
  inject: ['webServer'],
  apply(ctx) {
    const logger = ctx.logger?.(NAME) ?? console
    const bootJs = asset('boot.js')
    const splashCss = asset('boot.css').toString('utf8')
    const wallCss = asset('wallpaper.css').toString('utf8')
    const slots = Object.keys(SLOTS)

    ctx.effect(() => {
      const route = (path, handler) => ctx.webServer.register({ kind: 'exact', path, handler })
      const disposers = [
        route(BASE + '/boot.js', (req, res) => send(res, 200, 'application/javascript; charset=utf-8', bootJs)),
        ...slots.map((slot) => route(`${BASE}/${slot}`, (req, res) => {
          const image = imageOf(slot)
          send(res, 200, image.type, image.body)
        })),
        route(BASE + '/images', (req, res) => sendJson(res, 200, imageState())),
        ...slots.map((slot) => route(`${BASE}/images/${slot}`, (req, res) => upload(slot, req, res))),
        ...slots.map((slot) => route(`${BASE}/images/${slot}/reset`, (req, res) => reset(slot, res))),
        route(BASE + '/preview', (req, res) => send(res, 200, 'text/html; charset=utf-8', Buffer.from(previewPage(splashCss, wallCss)))),
      ]
      disposers.push(ctx.webServer.tapIndex((html) => inject(html, splashCss, wallCss)))
      logger.info(`dsh-startup-animation: 启动动画 + 主界面壁纸已挂载，图片目录 ${DATA_DIR}`)
      return () => {
        for (const dispose of disposers) dispose()
      }
    })
  },
}
