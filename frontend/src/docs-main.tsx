import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { gsap } from 'gsap'
import './index.css'
import './docs.css'

type Lang = 'en' | 'zh'
type DocPage = { id: string; title: string; zhTitle: string; group: string; zhGroup: string; icon: string; source: string; zhSource: string }

const docModules = import.meta.glob('./docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const DOC_META = [
  { id: 'quickstart', title: 'Quickstart', zhTitle: '快速开始', group: 'Getting Started', zhGroup: '入门', icon: 'rocket_launch' },
  { id: 'authentication', title: 'Authentication', zhTitle: '鉴权机制', group: 'Guides', zhGroup: '指南', icon: 'shield_lock' },
  { id: 'api-reference', title: 'API Reference', zhTitle: 'API 参考', group: 'Reference', zhGroup: '参考', icon: 'api' },
  { id: 'account-pool', title: 'Account Pool', zhTitle: '账号池', group: 'Guides', zhGroup: '指南', icon: 'account_balance_wallet' },
  { id: 'operations', title: 'Operations', zhTitle: '运维', group: 'Operations', zhGroup: '运维', icon: 'terminal' },
  { id: 'architecture', title: 'Architecture', zhTitle: '架构', group: 'Reference', zhGroup: '参考', icon: 'schema' },
] as const
const DOC_PAGES: DocPage[] = DOC_META.map(meta => ({
  ...meta,
  source: docModules[`./docs/${meta.id}.md`] || '',
  zhSource: docModules[`./docs/${meta.id}.zh.md`] || docModules[`./docs/${meta.id}.md`] || '',
}))

function headingText(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(headingText).join('')
  if (React.isValidElement(value)) return headingText((value.props as { children?: React.ReactNode }).children)
  return ''
}

function slugify(value: React.ReactNode) {
  return headingText(value)
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

function scrollToHeading(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  history.replaceState(null, '', `#${id}`)
}

function DocsApp() {
  const [activeDocId, setActiveDocId] = useState('quickstart')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [lang, setLang] = useState<Lang>(() => {
    const stored = localStorage.getItem('qodergate_lang')
    if (stored === 'en' || stored === 'zh') return stored
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  })
  const contentRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const activeDoc = DOC_PAGES.find(doc => doc.id === activeDocId) || DOC_PAGES[0]
  const activeSource = lang === 'zh' ? activeDoc.zhSource : activeDoc.source
  const activeTitle = lang === 'zh' ? activeDoc.zhTitle : activeDoc.title
  const headings = useMemo(() => Array.from(activeSource.matchAll(/^(#{2,3})\s+(.+)$/gm)).map(match => ({
    id: slugify(match[2]),
    text: match[2].replace(/`/g, ''),
    depth: match[1].length,
  })), [activeSource])
  const filteredDocs = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return DOC_PAGES
    return DOC_PAGES.filter(doc => {
      const title = lang === 'zh' ? doc.zhTitle : doc.title
      const group = lang === 'zh' ? doc.zhGroup : doc.group
      const source = lang === 'zh' ? doc.zhSource : doc.source
      return title.toLowerCase().includes(term) || group.toLowerCase().includes(term) || source.toLowerCase().includes(term)
    })
  }, [query, lang])
  const groupedDocs = filteredDocs.reduce<Record<string, DocPage[]>>((acc, doc) => {
    const group = lang === 'zh' ? doc.zhGroup : doc.group
    acc[group] = acc[group] || []
    acc[group].push(doc)
    return acc
  }, {})

  const switchLang = (next: Lang) => {
    setLang(next)
    localStorage.setItem('qodergate_lang', next)
  }

  useEffect(() => {
    if (!contentRef.current) return
    gsap.fromTo(contentRef.current, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeDocId])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text.replace(/\n$/, ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="docs-shell min-h-screen">
      <header className="docs-topbar">
        <a href="/" className="docs-brand">
          <span className="docs-brand-icon">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1", fontSize: 20 }}>gate</span>
          </span>
          <span>{lang === 'zh' ? 'GITIT 文档' : 'GITIT Docs'}</span>
        </a>
        <div className="docs-search">
          <span className="material-symbols-outlined">search</span>
          <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={lang === 'zh' ? '搜索文档...' : 'Search documentation...'} />
          <kbd>/</kbd>
        </div>
        <nav className="docs-topnav">
          <button onClick={() => switchLang(lang === 'zh' ? 'en' : 'zh')} className="docs-lang-switch">{lang === 'zh' ? 'English' : '中文'}</button>
          <a href="/console">{lang === 'zh' ? '控制台' : 'Console'}</a>
          <a href="/">{lang === 'zh' ? '首页' : 'Home'}</a>
        </nav>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          {Object.entries(groupedDocs).map(([group, docs]) => (
            <section key={group} className="docs-nav-group">
              <div className="docs-nav-title">{group}</div>
              {docs.map(doc => (
                <button key={doc.id} onClick={() => setActiveDocId(doc.id)} className={`docs-nav-item ${activeDocId === doc.id ? 'active' : ''}`}>
                  <span className="material-symbols-outlined">{doc.icon}</span>
                  {lang === 'zh' ? doc.zhTitle : doc.title}
                </button>
              ))}
            </section>
          ))}
        </aside>

        <main ref={contentRef} className="docs-content">
          <div className="docs-hero">
            <div>
              <div className="docs-eyebrow">QoderGate Wiki</div>
              <h1>{activeTitle}</h1>
              <p>{lang === 'zh' ? '面向快速上手、API 接入、账号池管理和本地运维的完整项目 Wiki。' : 'Fast, polished documentation for using and operating the QoderGate local API gateway.'}</p>
            </div>
          </div>

          <article className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                h1() { return null },
                h2({ children }) { return <h2 id={slugify(children)}>{children}</h2> },
                h3({ children }) { return <h3 id={slugify(children)}>{children}</h3> },
                pre({ children }) {
                  const text = String((children as any)?.props?.children || '')
                  return (
                    <div className="code-card">
                      <button onClick={() => copyText(text)}>{copied ? 'Copied' : 'Copy'}</button>
                      <pre>{children}</pre>
                    </div>
                  )
                },
              }}
            >
              {activeSource}
            </ReactMarkdown>
          </article>
        </main>

        <aside className="docs-toc">
          <div className="docs-toc-card">
            <div className="docs-toc-title">{lang === 'zh' ? '本页目录' : 'On This Page'}</div>
            {headings.length === 0 ? <p>{lang === 'zh' ? '暂无章节' : 'No sections'}</p> : headings.map(heading => (
              <button key={heading.id} onClick={() => scrollToHeading(heading.id)} className={heading.depth === 3 ? 'nested' : ''}>{heading.text}</button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<DocsApp />)
