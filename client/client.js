/* dsh-startup-animation 的网页半边：在「设置」里加一页，让用户自己换启动页头像与背景图。
 *
 * 手写、不打构建：整包就是 window.__ModuleLoader__ 的一个 factory，只 require 平台种子模块里的 react。
 * 交互只走本插件自己的 HTTP 路由（/dsh-startup/images…、/dsh-startup/preview），不占 DSH 的 RPC 通道。
 *
 * 页面结构：顶上是一块实时预览（把宿主的预览页塞进 sandbox iframe，换图即重放），
 * 下面两张卡片分别管头像与背景图（点选或拖拽上传、可恢复内置默认图）。
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
      const [error, setError] = useState(null)

      React.useEffect(() => {
        let alive = true
        fetch('/dsh-startup/images')
          .then((answered) => answered.json())
          .then((data) => { if (alive) setState(data) })
          .catch((err) => { if (alive) setError(err && err.message ? err.message : String(err)) })
        return () => { alive = false }
      }, [])

      /** 清掉"刚看过动画"的标记再刷新，这样刷新时启动动画会再播一遍。 */
      function replay() {
        try { sessionStorage.removeItem('dshs-at') } catch (err) { /* 忽略 */ }
        location.reload()
      }

      return h('div', { style: styles.page }, [
        h('p', { key: 'lead', style: styles.lead },
          '换掉打开软件时的启动动画与主界面壁纸。支持 PNG / JPEG / WebP / GIF，单张上限 12MB；',
          '点「选择图片」或直接把图拖到卡片上，换完上面的预览会自动重放一遍。'),
        h(Preview, { key: 'preview', state: state }),
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

    function apply(ctx) {
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
