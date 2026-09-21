/* dsh-startup-animation 的网页半边：在「设置」里加一页，管启动页头像/背景图，以及主界面 hero 的标题。
 *
 * 手写、不打构建：整包就是 window.__ModuleLoader__ 的一个 factory，只 require 平台种子模块里的 react。
 * 交互只走本插件自己的 HTTP 路由（/dsh-startup/images…、/dsh-startup/config、/dsh-startup/preview），
 * 不占 DSH 的 RPC 通道。
 *
 * 页面结构：顶上是一块实时预览（把宿主的预览页塞进 sandbox iframe，换图即重放），
 * 然后是「主界面标题」卡片（问候语 / 打字机 / 光标 / 隐藏 logo 与预览版徽章），
 * 最后两张卡片分别管头像与背景图（点选或拖拽上传、可恢复内置默认图）。
 *
 * 设置页之外还顺手改造主界面 hero：把新会话标题「探索未至之境」换成可配置的问候语并逐字打出来，
 * 同时摘掉标题左边的鲸鱼 logo 与右边的「预览版」徽章（见下面的 hero* 函数）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-startup-animation',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useRef } = React

    const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
    const MAX_BYTES = 12 * 1024 * 1024
    const KINDS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

    const SLOTS = [
      {
        slot: 'avatar',
        label: '头像',
        hint: '启动动画正中那张，建议正方形或接近正方形；显示为圆角方框，不会被裁成圆形。',
      },
      {
        slot: 'bg',
        label: '背景图',
        hint: '启动动画的背景，同时也是主界面壁纸；建议横图，界面里会按 cover 铺满。',
      },
    ]

    /** 「主界面标题」卡片上的四个开关：配置字段名 → 显示文案。 */
    const CHECK_LABELS = {
      typewriter: '打字机逐字显示',
      cursor: '闪烁光标',
      hideLogo: '隐藏标题旁的 logo',
      hideBadge: '隐藏「预览版」徽章',
    }

    const styles = {
      page: { maxWidth: 660, fontSize: 13, color: 'var(--dsw-alias-label-primary, #22303f)' },
      lead: { margin: '0 0 16px', color: 'var(--dsw-alias-label-secondary, #55617a)', lineHeight: 1.7 },
      card: {
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        padding: 16,
        marginBottom: 14,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: 12,
      },
      previewCard: {
        padding: 16,
        marginBottom: 14,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: 12,
      },
      previewHead: {
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
        flexWrap: 'wrap',
      },
      previewTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
      frame: {
        display: 'block',
        width: '100%',
        height: 320,
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: 10,
        background: '#f7f1f8',
      },
      frameIdle: {
        display: 'grid',
        placeItems: 'center',
        color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
      },
      thumb: {
        flex: '0 0 96px',
        width: 96,
        height: 96,
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--dsw-alias-bg-layer-2, #f3f4f6)',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
      },
      thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
      body: { flex: 1, minWidth: 0 },
      title: { margin: '0 0 4px', fontSize: 14, fontWeight: 600 },
      hint: { margin: '0 0 6px', color: 'var(--dsw-alias-label-tertiary, #8b93a1)', lineHeight: 1.6 },
      meta: { margin: '0 0 10px', color: 'var(--dsw-alias-label-tertiary, #8b93a1)' },
      row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
      primary: {
        font: 'inherit',
        cursor: 'pointer',
        border: 'none',
        height: 32,
        padding: '0 14px',
        borderRadius: 999,
        background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4f6ef7))',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
      },
      ghost: {
        font: 'inherit',
        cursor: 'pointer',
        height: 32,
        padding: '0 14px',
        borderRadius: 999,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #22303f)',
        border: '1px solid var(--dsw-alias-border-l2, #d1d5db)',
      },
      busy: { opacity: .55, cursor: 'default' },
      err: { margin: '8px 0 0', color: 'var(--dsw-alias-state-error-primary, #dc2626)', lineHeight: 1.6 },
      drop: { outline: '2px dashed var(--dsw-alias-brand-primary, #4f6ef7)', outlineOffset: 2 },
      foot: { margin: '18px 0 0', color: 'var(--dsw-alias-label-tertiary, #8b93a1)', lineHeight: 1.7 },
      mono: { background: 'var(--dsw-alias-bg-layer-2, #f3f4f6)', borderRadius: 4, padding: '1px 4px' },
      formCard: {
        padding: 16,
        marginBottom: 14,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: 12,
      },
      label: { display: 'block', margin: '0 0 6px', color: 'var(--dsw-alias-label-tertiary, #8b93a1)' },
      input: {
        font: 'inherit',
        height: 32,
        padding: '0 10px',
        boxSizing: 'border-box',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #d1d5db)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'inherit',
      },
      area: {
        font: 'inherit',
        width: '100%',
        minHeight: 58,
        padding: '8px 10px',
        boxSizing: 'border-box',
        resize: 'vertical',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #d1d5db)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'inherit',
      },
      checks: { display: 'flex', flexWrap: 'wrap', gap: '8px 16px', margin: '14px 0 0' },
      check: { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' },
      ok: { margin: '10px 0 0', color: 'var(--dsw-alias-state-success-primary, #16a34a)' },
    }

    function describe(state) {
      if (!state) return '读取中…'
      const size = Math.max(1, Math.round((state.bytes || 0) / 1024))
      return (state.custom ? '自定义图' : '内置默认图') + ` · ${size} KB`
    }

    /** 图片地址带上 mtime 作为版本号，换图后预览立刻更新。 */
    function imageUrl(slot, state) {
      const version = state && state.custom && state.mtime ? state.mtime : 0
      return `/dsh-startup/${slot}?v=${version}`
    }

    /** 两张图的版本号拼起来：任何一张换了，预览 iframe 都会重新挂载并重放。 */
    function stamp(state) {
      if (!state) return 'loading'
      return SLOTS.map((item) => {
        const one = state[item.slot]
        return one && one.custom && one.mtime ? one.mtime : 'default'
      }).join('-')
    }

    /** 实时预览：宿主把预览页渲染成自包含文档，这里只负责挂载与重播。 */
    function Preview(props) {
      const [nonce, setNonce] = useState(0)
      // 状态读回来之前先不挂 iframe：否则会先播一遍、拿到 mtime 后再重挂播第二遍
      const ready = props.state !== null
      return h('div', { style: styles.previewCard }, [
        h('div', { key: 'head', style: styles.previewHead }, [
          h('p', { key: 'title', style: styles.previewTitle }, '实时预览'),
          h('div', { key: 'acts', style: styles.row }, [
            h('button', {
              key: 'again',
              type: 'button',
              style: ready ? styles.ghost : Object.assign({}, styles.ghost, styles.busy),
              disabled: !ready,
              onClick: () => setNonce(nonce + 1),
            }, '重播'),
            h('button', {
              key: 'open',
              type: 'button',
              style: styles.ghost,
              onClick: () => window.open('/dsh-startup/preview', '_blank', 'noopener'),
            }, '新标签打开'),
          ]),
        ]),
        // sandbox 只给 allow-scripts：预览页拿到的是独立源，既不会碰到真实页面的
        // sessionStorage（否则在预览里看一遍，真页面就会当成"已播过"而跳过动画），
        // 也不会把脚本能力带进设置页。
        ready
          ? h('iframe', {
            key: stamp(props.state) + '-' + nonce,
            style: styles.frame,
            src: '/dsh-startup/preview',
            sandbox: 'allow-scripts',
            title: '启动动画预览',
          })
          : h('div', { key: 'idle', style: Object.assign({}, styles.frame, styles.frameIdle) }, '正在读取图片状态…'),
        h('p', { key: 'hint', style: styles.hint }, '换完图这里会自动重放一遍；「新标签打开」可放大看。预览里跑的启动动画与真实开机时完全同一份代码。'),
      ])
    }

    /**
     * 「主界面标题」卡片：改问候语、打字机、光标与两处隐藏开关。
     * 存盘后立刻回调 onSaved，主界面那边会拿新配置重放一遍（不用刷新就能看到）。
     */
    function HeroCard(props) {
      const [draft, setDraft] = useState(props.config)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [saved, setSaved] = useState(false)

      function patch(key, value) {
        setDraft(Object.assign({}, draft, { [key]: value }))
        setSaved(false)
      }

      async function save(body) {
        setBusy(true)
        setError(null)
        try {
          const answered = await fetch('/dsh-startup/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await answered.json()
          if (!data.ok) throw new Error(data.error || '保存失败')
          setDraft(data.config)
          setSaved(true)
          props.onSaved(data.config)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      function toggle(key) {
        return h('label', { key, style: styles.check }, [
          h('input', {
            key: 'box',
            type: 'checkbox',
            checked: draft[key] === true,
            disabled: busy,
            onChange: (event) => patch(key, event.target.checked),
          }),
          CHECK_LABELS[key],
        ])
      }

      return h('div', { style: styles.formCard }, [
        h('p', { key: 'title', style: styles.title }, '主界面标题'),
        h('p', { key: 'hint', style: styles.hint },
          '新会话空状态那句标题（原来是「探索未至之境」）。存盘后立刻在主界面生效，不用刷新。'),
        h('label', { key: 'headline', style: styles.label }, '问候语'),
        h('textarea', {
          key: 'text',
          style: styles.area,
          value: draft.headline,
          disabled: busy,
          onChange: (event) => patch('headline', event.target.value),
        }),
        h('div', { key: 'checks', style: styles.checks }, [
          toggle('typewriter'),
          toggle('cursor'),
          toggle('hideLogo'),
          toggle('hideBadge'),
        ]),
        h('div', { key: 'tuning', style: Object.assign({}, styles.row, { marginTop: 14 }) }, [
          h('label', { key: 'speedLabel', style: Object.assign({}, styles.label, { margin: 0 }) }, '每字间隔'),
          h('input', {
            key: 'speed',
            type: 'number',
            min: 10,
            max: 1000,
            step: 10,
            style: Object.assign({}, styles.input, { width: 84 }),
            value: draft.speed,
            disabled: busy || draft.typewriter !== true,
            onChange: (event) => patch('speed', Number(event.target.value)),
          }),
          h('span', { key: 'unit', style: styles.hint }, '毫秒'),
          h('label', { key: 'charLabel', style: Object.assign({}, styles.label, { margin: '0 0 0 8px' }) }, '光标字符'),
          h('input', {
            key: 'char',
            type: 'text',
            maxLength: 4,
            style: Object.assign({}, styles.input, { width: 64 }),
            value: draft.cursorChar,
            disabled: busy || draft.cursor !== true,
            onChange: (event) => patch('cursorChar', event.target.value),
          }),
        ]),
        h('div', { key: 'acts', style: Object.assign({}, styles.row, { marginTop: 14 }) }, [
          h('button', {
            key: 'save',
            type: 'button',
            style: busy ? Object.assign({}, styles.primary, styles.busy) : styles.primary,
            disabled: busy,
            onClick: () => save(draft),
          }, busy ? '保存中…' : '保存并生效'),
          h('button', {
            key: 'reset',
            type: 'button',
            style: busy ? Object.assign({}, styles.ghost, styles.busy) : styles.ghost,
            disabled: busy,
            onClick: () => save({ reset: true }),
          }, '恢复默认'),
          saved ? h('span', { key: 'ok', style: styles.ok }, '已生效 ✓') : null,
        ]),
        error ? h('p', { key: 'err', style: styles.err }, error) : null,
      ])
    }

    function SlotCard(props) {
      const slot = props.slot
      const state = props.state
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [over, setOver] = useState(false)
      const input = useRef(null)

      async function send(file) {
        if (!file) return
        if (KINDS.indexOf(file.type) === -1) {
          setError('只认 PNG / JPEG / WebP / GIF 四种格式')
          return
        }
        if (file.size > MAX_BYTES) {
          setError(`图太大了（${Math.round(file.size / 1024 / 1024)}MB），上限 12MB`)
          return
        }
        setError(null)
        setBusy(true)
        try {
          const answered = await fetch(`/dsh-startup/images/${slot}`, {
            method: 'POST',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          })
          const data = await answered.json()
          if (!data.ok) throw new Error(data.error || '保存失败')
          props.onState(data.state)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
          if (input.current) input.current.value = ''
        }
      }

      async function reset() {
        setError(null)
        setBusy(true)
        try {
          const answered = await fetch(`/dsh-startup/images/${slot}/reset`, { method: 'POST' })
          const data = await answered.json()
          if (!data.ok) throw new Error(data.error || '恢复失败')
          props.onState(data.state)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      return h('div', {
        style: over ? Object.assign({}, styles.card, styles.drop) : styles.card,
        onDragOver: (event) => { event.preventDefault(); setOver(true) },
        onDragLeave: () => setOver(false),
        onDrop: (event) => { event.preventDefault(); setOver(false); send(event.dataTransfer.files[0]) },
      }, [
        h('div', { key: 'thumb', style: styles.thumb },
          h('img', { style: styles.thumbImg, src: imageUrl(slot, state), alt: '' })),
        h('div', { key: 'body', style: styles.body }, [
          h('p', { key: 'title', style: styles.title }, props.label),
          h('p', { key: 'hint', style: styles.hint }, props.hint),
          h('p', { key: 'meta', style: styles.meta }, describe(state)),
          h('div', { key: 'row', style: styles.row }, [
            h('input', {
              key: 'file',
              ref: input,
              type: 'file',
              accept: ACCEPT,
              style: { display: 'none' },
              onChange: (event) => send(event.target.files[0]),
            }),
            h('button', {
              key: 'pick',
              type: 'button',
              style: busy ? Object.assign({}, styles.primary, styles.busy) : styles.primary,
              disabled: busy,
              onClick: () => input.current && input.current.click(),
            }, busy ? '处理中…' : '选择图片'),
            state && state.custom
              ? h('button', {
                key: 'reset',
                type: 'button',
                style: busy ? Object.assign({}, styles.ghost, styles.busy) : styles.ghost,
                disabled: busy,
                onClick: reset,
              }, '恢复默认')
              : null,
          ]),
          error ? h('p', { key: 'err', style: styles.err }, error) : null,
        ]),
      ])
    }

    function SettingsSection() {
      const [state, setState] = useState(null)
      // undefined = 还在读；null = 读失败；对象 = 读到了（失败也占着卡片位置，好让用户知道为什么改不了）
      const [config, setConfig] = useState(undefined)
      const [error, setError] = useState(null)

      React.useEffect(() => {
        let alive = true
        // 两个接口各读各的：标题配置读不到，不该把换图那两张卡片也一起弄没
        fetch('/dsh-startup/images')
          .then((answered) => answered.json())
          .then((data) => { if (alive) setState(data) })
          .catch((err) => { if (alive) setError(err && err.message ? err.message : String(err)) })
        fetch('/dsh-startup/config')
          .then((answered) => answered.json())
          .then((data) => { if (alive) setConfig(data && data.ok === true ? data.config : null) })
          .catch(() => { if (alive) setConfig(null) })
        return () => { alive = false }
      }, [])

      /** 清掉"刚看过动画"的标记再刷新，这样刷新时启动动画会再播一遍。 */
      function replay() {
        try { sessionStorage.removeItem('dshs-at') } catch (err) { /* 忽略 */ }
        location.reload()
      }

      /** 存盘后主界面那边立刻重放：不用刷新就能看到新文案/新开关的效果。 */
      function heroSaved(next) {
        setConfig(next)
        heroApply(next, true)
      }

      return h('div', { style: styles.page, 'data-dshs-ui': '' }, [
        h('p', { key: 'lead', style: styles.lead },
          '换掉打开软件时的启动动画、主界面壁纸，以及主界面新会话那句标题。',
          '图片支持 PNG / JPEG / WebP / GIF，单张上限 12MB；点「选择图片」或直接把图拖到卡片上，',
          '换完上面的预览会自动重放一遍。'),
        h(Preview, { key: 'preview', state: state }),
        config ? h(HeroCard, { key: 'hero', config: config, onSaved: heroSaved }) : h('div', { key: 'hero', style: styles.formCard }, [
          h('p', { key: 'title', style: styles.title }, '主界面标题'),
          h('p', { key: 'hint', style: styles.hint }, config === null
            ? '读不到宿主配置（/dsh-startup/config），所以这里暂时改不了。多半是插件刚更新、宿主还没重新挂载：在插件市场里把它重装一次（或重启 DSH）后再刷新本页即可。'
            : '正在读取配置…'),
        ]),
        ...SLOTS.map((item) => h(SlotCard, {
          key: item.slot,
          slot: item.slot,
          label: item.label,
          hint: item.hint,
          state: state ? state[item.slot] : null,
          onState: (next) => setState(next),
        })),
        h('div', { key: 'foot', style: styles.row }, [
          h('button', { key: 'replay', type: 'button', style: styles.primary, onClick: replay }, '在真实界面里看一遍'),
          h('button', {
            key: 'reload',
            type: 'button',
            style: styles.ghost,
            onClick: () => location.reload(),
          }, '只刷新页面'),
        ]),
        h('p', { key: 'note', style: styles.foot },
          '「在真实界面里看一遍」会刷新页面并重放启动动画（相当于重新打开软件那一下）；',
          '普通刷新（60 秒内）默认跳过动画，只看壁纸变化。自定义图存在 ',
          h('code', { key: 'path', style: styles.mono }, '$DSH_HOME/dsh-startup-animation/'),
          '，删掉或点「恢复默认」就回到内置图。'),
        error ? h('p', { key: 'err', style: styles.err }, `读取状态失败：${error}`) : null,
      ])
    }

    /* ── 主界面 hero 改造 ────────────────────────────────────────────────
     * 新会话那句标题来自会话组件内置的 i18n 字典（hero.headline），槽位机制碰不到字典，
     * 所以直接在 DOM 上做，四件事：
     *   · 标题换成配置里的问候语，逐字打出来（打字机）；
     *   · 光标用 CSS 的 ::after 画，不往 React 的树里插节点——插进去会被重渲染抹掉；
     *   · 摘掉标题左边的鲸鱼 logo 与右边的「预览版」徽章（按结构找，不认哈希类名）；
     *   · 文案/速度/开关都来自 /dsh-startup/config，设置页存盘后立刻重放。
     * React 重挂载（切新会话）会按字典把原文渲染回来，观察器会再接管一次。
     * 自检脚本在没有 DOM 的 vm 沙箱里执行 apply，所以这里按环境跳过。 */
    const HERO_FROM = '探索未至之境'
    const HERO_MARK = 'data-dshs-hero'
    const HERO_HIDE = 'dshs-hero-hide'
    const HERO_TYPED = 'dshs-hero-typed'
    const HERO_FALLBACK = {
      headline: '你好，我是和栗薰子，欢迎使用Deepseek Harness',
      typewriter: true,
      speed: 70,
      cursor: true,
      cursorChar: '|',
      hideLogo: true,
      hideBadge: true,
    }

    let heroConfig = null

    /** 宿主那份配置可能缺字段（老版本 / 半路升级），补上兜底再上屏。 */
    function heroMerge(config) {
      return Object.assign({}, HERO_FALLBACK, config || {})
    }

    /**
     * 摘掉标题两边的装饰：同一个标题组里的其它孩子是「预览版」徽章，
     * 标题组所在那一排里带 svg 的兄弟是 logo。都按结构找，DSH 换类名也不影响。
     * 开关关掉时用 toggle 把类摘回去，所以设置页改完能立刻看到 logo/徽章回来。
     */
    function heroChrome(title) {
      const group = title.parentElement
      if (group === null) return
      for (const child of group.children) {
        if (child !== title) child.classList.toggle(HERO_HIDE, heroConfig.hideBadge === true)
      }
      const row = group.parentElement
      if (row === null) return
      for (const child of row.children) {
        if (child === group) continue
        if (child.querySelector('svg') !== null) child.classList.toggle(HERO_HIDE, heroConfig.hideLogo === true)
      }
    }

    /**
     * 接管标题：标记 + 装饰 + 逐字打出来。
     * 定时器与状态都挂在元素自身上，所以 React 重挂载出来的新元素会自然从头播一遍。
     */
    function heroType(title) {
      if (title.__dshsTyping === true) return
      const config = heroConfig
      title.setAttribute(HERO_MARK, '')
      title.classList.toggle(HERO_TYPED, config.cursor === true)
      title.style.setProperty('--dshs-hero-cursor', JSON.stringify(config.cursorChar || '|'))
      heroChrome(title)
      if (title.__dshsTimer) { clearInterval(title.__dshsTimer); title.__dshsTimer = 0 }
      const chars = Array.from(config.headline)
      if (config.typewriter !== true) {
        title.textContent = config.headline
        return
      }
      title.__dshsTyping = true
      title.textContent = ''
      let shown = 0
      title.__dshsTimer = setInterval(() => {
        shown += 1
        // 按码点切，问候语里带 emoji 也不会被打成半个字符
        title.textContent = chars.slice(0, shown).join('')
        if (shown >= chars.length) {
          clearInterval(title.__dshsTimer)
          title.__dshsTimer = 0
          title.__dshsTyping = false
        }
      }, Math.max(10, config.speed))
    }

    /**
     * 设置页本身也是这个插件画的，而说明文字里就写着那句原文（「原来是『探索未至之境』」）。
     * 不把这块排除掉的话，观察器会把它当成 hero 标题接管，再按"摘掉标题两边的装饰"把
     * 卡片里的输入框/开关/按钮全藏起来 —— 表现就是"设置里那张卡片只剩一行字，改不了"。
     */
    function inOwnUi(node) {
      const el = node.nodeType === 3 ? node.parentElement : node
      return el !== null && el !== undefined && typeof el.closest === 'function' && el.closest('[data-dshs-ui]') !== null
    }

    /**
     * 从一处 DOM 变动里认出 hero 标题。判定要**整段就是那句原文**（trim 后全等），
     * 不能用"包含"：说明文字里只是提到它，包含判定会把设置页自己误伤。
     */
    function heroScan(node) {
      if (heroConfig === null || node === null || node === undefined) return
      if (inOwnUi(node)) return
      if (node.nodeType === 3) {
        if (node.data.trim() === HERO_FROM && node.parentElement !== null) heroType(node.parentElement)
        return
      }
      // 先廉价地看一眼 textContent，没命中就不往子树里走
      if (node.nodeType !== 1 || node.textContent === null || node.textContent.includes(HERO_FROM) === false) return
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let text = walker.nextNode()
      while (text !== null) {
        if (text.data.trim() === HERO_FROM && text.parentElement !== null) {
          heroType(text.parentElement)
          return
        }
        text = walker.nextNode()
      }
    }

    /** 配置变了：把已经接管的标题停掉重播；一个都没有就把当前 DOM 扫一遍。 */
    function heroReplay() {
      const marked = document.querySelectorAll('[' + HERO_MARK + ']')
      for (const title of marked) {
        if (title.__dshsTimer) { clearInterval(title.__dshsTimer); title.__dshsTimer = 0 }
        title.__dshsTyping = false
        heroType(title)
      }
      if (marked.length === 0) heroScan(document.body)
    }

    function heroApply(config, replay) {
      heroConfig = heroMerge(config)
      if (replay === true) heroReplay()
    }

    function heroWatch() {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return null
      const host = document.body || document.documentElement
      if (!host) return null
      heroScan(host)   // 已经渲染出来的先接管
      const observer = new MutationObserver((records) => {
        if (heroConfig === null) return
        for (const record of records) {
          if (record.type === 'characterData') { heroScan(record.target); continue }
          for (const added of record.addedNodes) heroScan(added)
        }
        // React 重渲染会把 logo/徽章重新建出来，所以每轮变动后按标记把装饰补一遍
        for (const title of document.querySelectorAll('[' + HERO_MARK + ']')) heroChrome(title)
      })
      observer.observe(host, { subtree: true, childList: true, characterData: true })
      return observer
    }

    /** 页面侧拉一次配置；拿不到就什么都不做——宁可不改，也别用半份配置把标题改坏。 */
    function heroLoad() {
      // 自检脚本在没有 fetch / DOM 的 vm 沙箱里执行 apply，这里按环境跳过
      if (typeof fetch !== 'function') return
      fetch('/dsh-startup/config')
        .then((answered) => answered.json())
        .then((data) => { if (data && data.ok === true) heroApply(data.config, true) })
        .catch(() => {})
    }

    function apply(ctx) {
      // 客户端 HMR 重载会重跑 apply：先撤旧观察器再挂新的——既不叠加，
      // 改了配置也能随热更立刻生效（旧观察器还揣着旧配置，留着会抢着改回去）
      if (window.__dshsHeroWatch) window.__dshsHeroWatch.disconnect()
      window.__dshsHeroWatch = heroWatch()
      heroLoad()
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        {
          name: 'settings.section',
          id: 'startup-animation',
          order: 3,
          label: () => '启动动画与壁纸',
        },
        SettingsSection,
      ))
    }

    return { name: 'dsh-startup-animation', inject: ['slots'], apply }
  },
})
