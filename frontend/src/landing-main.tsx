import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { gsap } from 'gsap'
import './index.css'

function Landing() {
  const [lang, setLang] = React.useState<'en' | 'zh'>(() => {
    const stored = localStorage.getItem('qodergate_lang')
    if (stored === 'en' || stored === 'zh') return stored
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  })
  const heroRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  const switchLang = () => {
    const next = lang === 'zh' ? 'en' : 'zh'
    setLang(next)
    localStorage.setItem('qodergate_lang', next)
  }

  useEffect(() => {
    if (heroRef.current) {
      gsap.fromTo(heroRef.current.children, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.12, ease: 'power3.out' })
    }
    if (cardsRef.current) {
      gsap.fromTo(cardsRef.current.children, { opacity: 0, y: 18, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, stagger: 0.08, delay: 0.25, ease: 'power2.out' })
    }
  }, [])

  return (
    <main className="min-h-screen bg-surface relative overflow-hidden">
      <div className="orb bg-mint w-[560px] h-[560px] -top-36 -right-28"></div>
      <div className="orb bg-peach w-[460px] h-[460px] bottom-0 left-[10%]"></div>
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <a href="/" className="flex items-center gap-3">
          <span className="w-10 h-10 bg-ink text-white rounded-xl inline-flex items-center justify-center leading-none">
            <span className="material-symbols-outlined block leading-none" style={{ fontVariationSettings: "'FILL' 1", fontSize: 22 }}>gate</span>
          </span>
          <span className="font-display-sm text-ink">GITIT</span>
        </a>
        <div className="flex items-center gap-3 text-sm font-bold">
          <button onClick={switchLang} className="px-4 py-2 text-body hover:text-ink transition-colors font-bold">{lang === 'zh' ? 'English' : '中文'}</button>
          <a href="/documents" className="px-4 py-2 text-body hover:text-ink transition-colors">{lang === 'zh' ? '文档' : 'Docs'}</a>
          <a href="https://github.com/saulgoodgirl/QoderGateway" target="_blank" rel="noreferrer" className="w-10 h-10 inline-flex items-center justify-center rounded-full border border-hairline bg-white/70 text-ink hover:bg-white transition-all" aria-label="GitHub Repository">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
              <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.93.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
            </svg>
          </a>
          <a href="/console" className="px-5 py-2.5 bg-ink text-white rounded-full hover:bg-primary transition-all">{lang === 'zh' ? '打开控制台' : 'Open Console'}</a>
        </div>
      </nav>

      <section ref={heroRef} className="relative z-10 max-w-7xl mx-auto px-8 pt-24 pb-20">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/70 border border-hairline rounded-full text-[11px] font-bold uppercase tracking-widest text-body mb-8">
          <span className="w-2 h-2 bg-mint rounded-full animate-pulse"></span>
          {lang === 'zh' ? '通用的多厂商 AI 聚合网关' : 'Universal Multi-Provider AI Aggregation Gateway'}
        </div>
        <h1 className="font-display-lg text-ink max-w-4xl" style={{ fontSize: 72, lineHeight: 0.98 }}>
          {lang === 'zh' ? '把 Qoder、ZCode 等多厂商模型与账号统一聚合成标准接口。' : 'Unify Qoder, ZCode and custom AI providers into one standard API.'}
        </h1>
        <p className="mt-7 text-lg text-body max-w-2xl leading-8">
          {lang === 'zh' ? '在云端或本地统一管理多厂商账号池、API Key、每日维保打卡与实时日志，向下游客户端提供统一的 /v1/chat/completions。' : 'Manage multi-provider accounts, API keys, daily maintenance, and logs with unified /v1/chat/completions.'}
        </p>
        <div className="mt-10 flex items-center gap-4">
          <a href="/console" className="bg-ink text-white px-7 py-4 rounded-full font-bold hover:bg-primary transition-all shadow-xl">{lang === 'zh' ? '进入控制台' : 'Launch Console'}</a>
          <a href="/documents" className="bg-white/80 border border-hairline px-7 py-4 rounded-full font-bold text-ink hover:bg-white transition-all">{lang === 'zh' ? '阅读文档' : 'Read Docs'}</a>
        </div>
      </section>

      <section ref={cardsRef} className="relative z-10 max-w-7xl mx-auto px-8 pb-24 grid grid-cols-1 md:grid-cols-3 gap-5">
        {[
          ['account_tree', lang === 'zh' ? '多账号轮转' : 'Multi-account routing', lang === 'zh' ? '导入 PAT 或本地登录会话，按 UID 去重，请求失败时自动切换账号。' : 'Import PATs or local auth sessions, deduplicate by UID, and rotate automatically on failures.'],
          ['vpn_key', lang === 'zh' ? '两层鉴权' : 'Two-layer auth', lang === 'zh' ? '管理后台密钥和外部 API Key 分开配置，避免客户端拿到后台权限。' : 'Separate management gateway tokens from external Bearer API keys for safer local operation.'],
          ['menu_book', lang === 'zh' ? '独立文档站' : 'Markdown docs', lang === 'zh' ? '文档页面独立于后台，说明安装、调用、运维和架构。' : 'A standalone static wiki explains setup, API usage, operations, and architecture.'],
        ].map(([icon, title, desc]) => (
          <div key={title} className="glass-card border border-hairline rounded-3xl p-7 hover:shadow-xl transition-all">
            <span className="material-symbols-outlined text-ink mb-5" style={{ fontSize: 32, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
            <h3 className="font-bold text-ink text-lg mb-2">{title}</h3>
            <p className="text-body text-sm leading-7">{desc}</p>
          </div>
        ))}
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Landing />)
