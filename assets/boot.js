/* DSH 启动动画（页面侧）。宿主插件把它作为 /dsh-startup/boot.js 提供，并在 </body> 前以 defer 注入。
   启动页 DOM 全部由本文件创建，收尾时自行清理；任何异常都会立刻把主界面放出来，绝不留白屏。

   这里只负责"编排"：搭 DOM、给星尘/光点撒随机参数、跟随指针做视差、等图落地后入场、
   判定主界面就绪、一次切类名完成过场，最后把节点和启动页样式删干净。
   所有位移/缩放/透明度都写在 boot.css 里，且只跑 transform / translate / opacity 这类合成器属性。

   想调节奏改下面五个常量；想调画面改 boot.css。 */
(function () {
  'use strict'

  var doc = document
  var html = doc.documentElement
  // 早脚本只在"本次该显示"时加 .dshs-boot（短时间内重复刷新会跳过它）
  if (!html.classList.contains('dshs-boot')) {
    var stale = doc.getElementById('dshs-css')
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale)
    return
  }
  if (window.__dshsStarted || !doc.body) return
  window.__dshsStarted = true

  var SEEN_KEY = 'dshs-at'
  var MIN_MS = 1500    // 最短展示时长
  var GRACE_MS = 520   // 主界面已挂载后多等一拍，等它画完再撤
  var MAX_MS = 5000    // 兜底：最多挡住主界面这么久
  var OUT_MS = 700     // 过场时长，与 boot.css 的 .is-out 保持一致
  var PETALS = 16      // 上浮光点数量
  var STARS = 30       // 星尘数量
  var SPARKS = 12      // 入场时头像四周迸出的星火数量

  var HELLO = '欢迎回来'
  var TIP = '正在准备你的工作台'

  // 系统开了"减少动态效果"就只保留入场与过场，不做常驻循环与视差
  var calm = false
  try { calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch (err) {}

  var startedAt = Date.now()
  var splash = null
  var bar = null
  var poll = 0
  var raf = 0
  var px = 0
  var py = 0

  function release() {
    html.classList.remove('dshs-boot', 'dshs-boot-out')
    var css = doc.getElementById('dshs-css')
    if (css && css.parentNode) css.parentNode.removeChild(css)
  }

  try {
    splash = build()
    doc.body.appendChild(splash)
    bar = splash.querySelector('.dshs-bar span')
    follow()
    whenImagesSettled(enter)
  } catch (err) {
    release()
  }

  function build() {
    var box = doc.createElement('div')
    box.id = 'dshs'
    box.setAttribute('aria-hidden', 'true')
    var hello = ''
    for (var i = 0; i < HELLO.length; i++) hello += '<span>' + HELLO.charAt(i) + '</span>'
    var pings = ''
    for (var p = 0; p < 2; p++) pings += '<div class="dshs-ping"></div>'
    box.innerHTML =
      // 背景单独一层，且刻意不留富余：盒子就是视口，取景因此和主界面壁纸逐像素对齐
      '<div class="dshs-bg"><img src="/dsh-startup/bg" alt=""></div>' +
      // 远景装饰：极光色块 + 旋转光束 + 星尘 + 上浮光点 + 掠过流星 + 斜向光带
      '<div class="dshs-world">' +
        '<div class="dshs-aurora"><i></i><i></i><i></i></div>' +
        '<div class="dshs-rays"></div>' +
        '<div class="dshs-stars"></div>' +
        '<div class="dshs-petals"></div>' +
        '<div class="dshs-streaks"><i></i><i></i></div>' +
        '<div class="dshs-sheen"></div>' +
      '</div>' +
      // 中景：提亮面纱 + 收尾时顶上来的"壁纸白纱" + 跟随指针的暖光 + 呼吸暗角
      '<div class="dshs-veil"></div>' +
      '<div class="dshs-handoff"></div>' +
      '<div class="dshs-cursor"></div>' +
      '<div class="dshs-vig"></div>' +
      // 近景：头像 + 柔光 + 两圈转动的加载环 + 一次性爆闪 + 两圈涟漪 + 迸出的星火 + 过场闪白
      '<div class="dshs-flash"></div>' +
      '<div class="dshs-stage">' +
        '<div class="dshs-portrait">' +
          '<div class="dshs-halo"></div>' +
          '<div class="dshs-orbit"></div>' +
          '<div class="dshs-orbit"></div>' +
          '<div class="dshs-burst"></div>' +
          pings +
          '<div class="dshs-sparks"></div>' +
          '<div class="dshs-avatar"><img src="/dsh-startup/avatar" alt=""><span class="dshs-shine"></span></div>' +
        '</div>' +
        '<div class="dshs-hello">' + hello + '</div>' +
        '<div class="dshs-accent"></div>' +
        '<div class="dshs-tip">' + TIP + '<i>.</i><i>.</i><i>.</i></div>' +
        '<div class="dshs-bar"><span></span><i class="dshs-orb"></i><i class="dshs-orb"></i></div>' +
      '</div>'
    scatterStars(box.querySelector('.dshs-stars'))
    scatterPetals(box.querySelector('.dshs-petals'))
    scatterSparks(box.querySelector('.dshs-sparks'))
    return box
  }

  /** 星尘：大小/亮度/闪烁周期都随机，闪烁相位用负延迟错开，避免整屏同步。 */
  function scatterStars(host) {
    if (calm) return
    for (var i = 0; i < STARS; i++) {
      var size = 2 + Math.random() * 2.6
      var star = doc.createElement('i')
      star.className = 'dshs-star'
      star.style.cssText =
        'left:' + (Math.random() * 100).toFixed(2) + '%;' +
        'top:' + (Math.random() * 100).toFixed(2) + '%;' +
        'width:' + size.toFixed(1) + 'px;' +
        'height:' + size.toFixed(1) + 'px;' +
        '--dshs-tw:' + (0.45 + Math.random() * 0.5).toFixed(2) + ';' +
        'animation-duration:' + (2.4 + Math.random() * 3.6).toFixed(1) + 's;' +
        'animation-delay:' + (-Math.random() * 6).toFixed(1) + 's;'
      host.appendChild(star)
    }
  }

  /**
   * 星火：入场那一下从头像四周迸出去。角度按数量均分再抖动一点，
   * 半径/延迟/大小随机，所以每次开软件的形状都不一样。
   */
  function scatterSparks(host) {
    if (calm) return
    for (var i = 0; i < SPARKS; i++) {
      var size = 3 + Math.random() * 3
      var spark = doc.createElement('i')
      spark.className = 'dshs-spark'
      spark.style.cssText =
        'width:' + size.toFixed(1) + 'px;' +
        'height:' + size.toFixed(1) + 'px;' +
        '--dshs-sa:' + (i * (360 / SPARKS) + Math.random() * 18 - 9).toFixed(1) + 'deg;' +
        '--dshs-sr:' + (58 + Math.random() * 46).toFixed(0) + 'px;' +
        '--dshs-sd:' + (0.22 + Math.random() * 0.28).toFixed(2) + 's;'
      host.appendChild(spark)
    }
  }

  /** 光点：位置、大小、上浮时长、左右摆动都随机，每次开软件都不一样。 */
  function scatterPetals(host) {
    for (var i = 0; i < PETALS; i++) {
      var size = 5 + Math.random() * 9
      var petal = doc.createElement('i')
      petal.className = 'dshs-petal'
      petal.style.cssText =
        'left:' + (Math.random() * 100).toFixed(2) + '%;' +
        'width:' + size.toFixed(1) + 'px;' +
        'height:' + size.toFixed(1) + 'px;' +
        'animation-duration:' + (9 + Math.random() * 9).toFixed(1) + 's;' +
        'animation-delay:' + (-Math.random() * 12).toFixed(1) + 's;' +
        '--dshs-sway:' + (Math.random() * 12 - 6).toFixed(1) + 'vmin;'
      host.appendChild(petal)
    }
  }

  /**
   * 指针视差：只把归一化坐标写进 --dshs-px / --dshs-py，各层在 CSS 里按自己的深度换算成位移。
   * 每帧最多写一次，且只改自定义属性，不触碰布局。触屏拖动不参与（会抖）。
   */
  function follow() {
    if (calm) return
    window.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return
      var w = window.innerWidth || 1
      var h = window.innerHeight || 1
      px = (event.clientX / w) * 2 - 1
      py = (event.clientY / h) * 2 - 1
      // 动过指针才点亮跟随暖光：没动过时它会在正中照出一团白，反而糊了背景
      if (splash) splash.classList.add('is-aim')
      if (raf || !splash) return
      raf = window.requestAnimationFrame(paint)
    }, { passive: true })

    function paint() {
      raf = 0
      if (!splash) return
      splash.style.setProperty('--dshs-px', px.toFixed(3))
      splash.style.setProperty('--dshs-py', py.toFixed(3))
    }
  }

  /** 两张图都落地（或出错、或 1.2s 超时）后入场，避免图片"跳"进画面。 */
  function whenImagesSettled(done) {
    var imgs = splash.querySelectorAll('img')
    var left = imgs.length
    var fired = false
    function one() {
      if (fired) return
      if (--left > 0) return
      fired = true
      done()
    }
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].complete) { one(); continue }
      imgs[i].addEventListener('load', one, { once: true })
      imgs[i].addEventListener('error', one, { once: true })
    }
    setTimeout(function () { if (!fired) { fired = true; done() } }, 1200)
  }

  function enter() {
    if (!splash) return
    splash.classList.add('is-in')
    // 点一下或按任意键都能跳过等待
    splash.addEventListener('click', finish)
    window.addEventListener('keydown', finish)
    poll = setInterval(check, 80)
  }

  function progress(value) {
    if (bar) bar.style.transform = 'scaleX(' + value.toFixed(3) + ')'
  }

  /** 主界面就绪判定：输入框出现 = 真正可用了；退一步只要求 React 挂载 + 已过最短时长。 */
  function check() {
    var elapsed = Date.now() - startedAt
    progress(Math.min(0.92, elapsed / MIN_MS * 0.92))
    if (elapsed >= MAX_MS) return finish()
    if (elapsed < MIN_MS) return
    var root = doc.getElementById('root')
    if (!root) return
    if (root.querySelector('textarea, [contenteditable="true"]')) return finish()
    if (root.firstElementChild && elapsed >= MIN_MS + GRACE_MS) return finish()
  }

  function finish() {
    if (!splash) return
    var node = splash
    splash = null
    clearInterval(poll)
    poll = 0
    if (raf) { window.cancelAnimationFrame(raf); raf = 0 }
    window.removeEventListener('keydown', finish)
    progress(1)
    node.classList.add('is-out')
    html.classList.remove('dshs-boot')
    html.classList.add('dshs-boot-out')
    // 预览页会置上 __dshsNoRemember：在预览里放一遍不该让真实页面也跳过动画
    if (!window.__dshsNoRemember) { try { sessionStorage.setItem(SEEN_KEY, String(Date.now())) } catch (err) {} }

    // 等淡出**真的**结束再摘节点。主界面这会儿正在首次渲染，主线程一忙，
    // 走主线程的 opacity 过渡会比合成器上的位移晚开始；固定等 OUT_MS 就会把还没淡完的
    // 启动页硬切掉 —— 那看起来就是"没有转场"。所以以 transitionend 为准，定时器只做兜底。
    var done = false
    function cleanup() {
      if (done) return
      done = true
      html.classList.remove('dshs-boot-out')
      if (node.parentNode) node.parentNode.removeChild(node)
      var css = doc.getElementById('dshs-css')
      if (css && css.parentNode) css.parentNode.removeChild(css)
    }
    node.addEventListener('transitionend', function (event) {
      if (event.target === node && event.propertyName === 'opacity') cleanup()
    })
    setTimeout(cleanup, OUT_MS + 600)
  }
})()
