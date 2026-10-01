import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { gsap } from 'gsap'

// ─── Types ───

interface Account {
  uid: string; name: string; user_type: string; security_oauth_token: string
  refresh_token: string; machine_id: string; enabled: boolean; api_enabled?: boolean
  api_mode?: 'all' | 'dedicated' | 'disabled'
  last_status: string
  last_error: string | null; quota: number; is_quota_exceeded: boolean
  plan: string | null; user_tag: string | null; next_reset_at: number | null
  provider?: string; base_url?: string
  region?: string | null; enterprise_domain?: string | null; is_enterprise?: boolean
}
interface AccountsConfig { accounts: Account[]; active_uid: string | null }
interface UIStatus { ready: boolean; mode: string; username: string | null; uid: string | null; user_type: string | null; error: string | null; accounts_count: number }
interface KeyDetail { api_key: string; name?: string; account_uid?: string }
interface APIConfig { auth_required: boolean; allowed_keys: string[]; allowed_keys_detail?: KeyDetail[] }
interface Message { role: 'user' | 'assistant'; content: string }
type TabId = 'dashboard' | 'accounts' | 'checkin' | 'models' | 'playground' | 'api-keys' | 'logs'
type AppTabId = TabId
type Lang = 'en' | 'zh'
type ToastType = 'SUCCESS' | 'ERROR' | 'INFO'
interface ToastItem { id: number; type: ToastType; title: string; message: string }

interface CheckinAccount {
  uid: string
  name: string
  plan: string
  provider?: string
  user_type?: string
  is_enterprise?: boolean
  claimed_today: boolean
  status_code?: 'waiting_refresh' | 'pending' | 'claimed'
  status_text: string
  reward_credits: number
  reward_tokens?: number
  unit?: string
  streak_days: number
  total_claim_days: number
  quota_info: {
    remaining: number
    total: number
    used: number
    plan_remaining?: number
    addon_remaining?: number
    org_remaining?: number
    desc?: string
    unit?: string
  } | null
  quota_desc?: string
  error: string | null
}

interface CheckinOverview {
  total_accounts: number
  claimed_count: number
  pending_count: number
  waiting_count?: number
  is_before_10am?: boolean
  total_credits_claimed_today: number
  total_remaining_credits: number
  pool_total_remaining_credits?: number
  enterprise_excluded_count?: number
  accounts: CheckinAccount[]
  qoder_accounts?: CheckinAccount[]
  zcode_accounts?: CheckinAccount[]
  zcode_total_accounts?: number
  zcode_claimed_count?: number
  zcode_total_tokens_today?: number
  zcode_remaining_tokens?: number
  last_auto_date: string | null
  cycle_id?: string
  next_refresh_seconds?: number
  refresh_rule?: string
}

interface NavItemDef {
  id: AppTabId
  icon: string
  labelZh: string
  labelEn: string
  badgeZh?: string
  badgeEn?: string
}

interface NavGroupDef {
  groupZh: string
  groupEn: string
  items: NavItemDef[]
}

const NAV_GROUPS: NavGroupDef[] = [
  {
    groupZh: '核心网关管理',
    groupEn: 'Core Gateway',
    items: [
      { id: 'dashboard', icon: 'grid_view', labelZh: '系统总览', labelEn: 'Dashboard' },
      { id: 'accounts', icon: 'group', labelZh: '账号池集群', labelEn: 'Account Pool' },
      { id: 'checkin', icon: 'card_giftcard', labelZh: '每日签到', labelEn: 'Daily Rewards', badgeZh: '+100', badgeEn: '+100' },
    ],
  },
  {
    groupZh: '对外服务与安全',
    groupEn: 'Services & Security',
    items: [
      { id: 'api-keys', icon: 'key', labelZh: 'API 接入 & 路由', labelEn: 'API Keys & Routing' },
      { id: 'playground', icon: 'chat', labelZh: '在线调试', labelEn: 'Playground' },
      { id: 'logs', icon: 'terminal', labelZh: '服务运行日志', labelEn: 'Service Logs' },
    ],
  },
]

const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items)

interface GatewayModelInfo {
  id: string
  vendor: string
  badge: string
  context: string
  descZh: string
  descEn: string
  rec?: boolean
  latency: string
}

const VERIFIED_MODELS: GatewayModelInfo[] = [
  { id: 'kimi-k3', vendor: '月之暗面', badge: 'bg-blue-50 text-blue-700 border-blue-200', context: '1M', descZh: '超长上下文与复杂代码推理，旗舰首选', descEn: 'Flagship reasoning & 1M context', rec: true, latency: '~6.9s' },
  { id: 'deepseek-v4-pro', vendor: 'DeepSeek', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', context: '1M', descZh: '顶级代码架构与逻辑分析，生成严谨', descEn: 'Top-tier code architecture & logic', rec: true, latency: '~3.4s' },
  { id: 'qwen-3.8-max', vendor: '阿里通义', badge: 'bg-amber-50 text-amber-700 border-amber-200', context: '1M', descZh: '通义旗舰全能模型，代码与长文本均衡', descEn: 'All-round flagship by Alibaba', rec: true, latency: '~3.3s' },
  { id: 'glm-5.3', vendor: '智谱 GLM', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200', context: '1M', descZh: '智谱最新代主力模型，中文语义理解出色', descEn: 'Flagship model by Zhipu AI', rec: true, latency: '~3.4s' },
  { id: 'kimi-k2.8', vendor: '月之暗面', badge: 'bg-blue-50 text-blue-700 border-blue-200', context: '200K', descZh: '高性价比轻巧代码助手，响应迅速', descEn: 'Cost-effective light code assistant', latency: '~3.9s' },
  { id: 'deepseek-flash', vendor: 'DeepSeek', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', context: '128K', descZh: '极速首字响应，低延迟代码补全', descEn: 'Ultra-fast TTFT & code completion', latency: '~2.3s' },
  { id: 'qwen-3.8-flash', vendor: '阿里通义', badge: 'bg-amber-50 text-amber-700 border-amber-200', context: '1M', descZh: '通义极速版，兼具效率与精度', descEn: 'Fast & accurate Qwen model', latency: '~3.2s' },
  { id: 'qwen-3.7-max', vendor: '阿里通义', badge: 'bg-amber-50 text-amber-700 border-amber-200', context: '1M', descZh: '经典全能模型，长文本稳定性好', descEn: 'Stable enterprise all-rounder', latency: '~3.2s' },
  { id: 'qwen-3.7-plus', vendor: '阿里通义', badge: 'bg-amber-50 text-amber-700 border-amber-200', context: '1M', descZh: '均衡兼顾生成速度与上下文深度', descEn: 'Balanced speed & depth', latency: '~5.5s' },
  { id: 'qwen-3.7-flash', vendor: '阿里通义', badge: 'bg-amber-50 text-amber-700 border-amber-200', context: '1M', descZh: '轻量通义极速版，日常交互首选', descEn: 'Lightweight fast response', latency: '~8.0s' },
  { id: 'glm-5.3-flash', vendor: '智谱 GLM', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200', context: '1M', descZh: '智谱高速推理模型，高并发低延迟', descEn: 'Fast inference by Zhipu AI', latency: '~6.9s' },
  { id: 'glm-5.2', vendor: '智谱 GLM', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200', context: '128K', descZh: '经典主力模型，运行稳定', descEn: 'Classic stable GLM engine', latency: '~3.3s' },
  { id: 'auto', vendor: 'Qoder 原生', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', context: '1M', descZh: '根据任务复杂度自动动态调度模型', descEn: 'Dynamic adaptive routing by Qoder', latency: '~4.3s' },
  { id: 'lite', vendor: 'Qoder 原生', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', context: '128K', descZh: '轻量极速模型，秒级代码单行生成', descEn: 'Ultra-lightweight code completer', latency: '~2.0s' },
]


const UI_TEXT = {
  en: {
    nav: {
      dashboard: 'Dashboard', accounts: 'Account Pool', checkin: 'Daily Rewards', models: 'Models & Routing', playground: 'AI Playground', apiKeys: 'API Key Management', logs: 'Logs',
    },
    breadcrumb: {
      dashboard: 'Control Panel / Overview', accounts: 'Console / Account Pool', checkin: 'Rewards Center / Daily Check-in', models: 'Console / Model Matrix', playground: 'Playground / Experiment', apiKeys: 'Administration / Security', logs: 'System / Observability', docs: 'Developer Platform / Wiki',
    },
    title: {
      dashboard: 'System Overview', accounts: 'Dual-Platform Account Pool', checkin: 'Dual-Track Auto Check-in & Rewards', models: 'Model Matrix & Routing', playground: 'AI Playground', apiKeys: 'API Management & Sub-pools', logs: 'Service Logs', docs: 'Documentation',
    },
    common: { docs: 'Docs', support: 'Support', healthy: 'Healthy', offline: 'Offline', signOut: 'Sign Out', refresh: 'Refresh', add: 'Add', delete: 'Delete', copy: 'Copy' },
    dashboard: {
      serviceStatus: 'Service Status', allGatewaysActive: 'All gateways active', noActiveSession: 'No active session', accountPool: 'Account Pool', activeSessions: 'Active provider accounts', apiAuth: 'API Auth', openAccess: 'Open access', activeUser: 'Active User', systemBriefing: 'System Briefing', readyBrief: 'Gateway is running. {count} account(s) are available for routing.', notReadyBrief: 'No active session is available. Import an account or add a PAT first.', recentNotifications: 'Recent Notifications', authImportError: 'Auth Import Error', sessionActive: 'Session Active', credentialConfig: 'Credential Configuration', credentialDesc: 'Add a provider credential or import local auth session.', patPlaceholder: 'Enter token or API key...', addPat: 'Add Account', saving: 'Saving...', autoImport: 'Auto Import',
    },
    accounts: { desc: 'Manage multi-provider accounts (Qoder, ZCode, Custom) aggregated by GITIT. Toggle "API Routing" to include/exclude accounts from external calls while keeping maintenance active.', refreshStatus: 'Refresh Status', importAccounts: 'Import Accounts', search: 'Search accounts...', empty: 'No accounts imported. Click Import Accounts or add credentials.', showing: 'Showing {count} account(s)' },
    checkin: {
      bannerTitle: 'Daily Rewards · 100 Credits Per Account',
      desc: 'Claim 100 free compute credits every day for each personal Qoder account (Enterprise/Teams accounts are excluded as they share organization resources). Resets daily at 10:00 (UTC+8), valid for 30 days. Gateway auto-worker runs daily at 10:00:05 (UTC+8) to claim automatically.',
      claimAll: 'Claim All Accounts Today',
      claiming: 'Claiming Rewards...',
      refresh: 'Refresh Status',
      allClaimedBadge: 'All accounts claimed today (+100 Credits each)',
      pendingBadge: 'Accounts pending claim today',
      statsClaimedRate: 'Claimed Today',
      statsCreditsToday: 'Credits Claimed Today',
      statsTotalCredits: 'Pool Remaining Credits',
      statsAutoSchedule: 'Auto Check-in Daemon',
      statsAutoScheduleDesc: 'Active · Runs daily at 10:00:00 (UTC+8)',
      nextRefreshCountdown: 'Next 10:00 Reset In',
      waitingRefreshBadge: 'Today\'s Rewards Not Started (Wait for 10:00 UTC+8)',
      waitingRefreshStatus: 'Pending 10:00 Reset',
      waitingRefreshBtn: 'Wait for 10:00',
      btnWaitAuto: 'Auto Claim at 10:00',
      tableTitle: 'Account Check-in & Credit Balance',
      colAccount: 'Account',
      colPlan: 'Plan Tier',
      colStatus: 'Today\'s Status',
      colStreak: 'Streak Days',
      colQuota: 'Available Credits',
      colActions: 'Action',
      btnClaimOne: 'Claim Now',
      claimedStatus: 'Claimed (+100)',
      pendingStatus: 'Pending',
      empty: 'No enabled accounts found. Import accounts or add a PAT first.',
    },
    playground: { modelConfig: 'Model Configuration', streamResponse: 'Stream Response', systemPrompt: 'System Prompt', systemPromptPlaceholder: "Define the AI's persona...", ask: 'Ask anything...', send: 'Send', waiting: 'Waiting for response...' },
    api: { generate: 'Generate New Key', desc: 'Manage authentication keys and gateway access permissions for client requests.', gatewayAuth: 'Gateway Authentication', gatewayAuthDesc: 'Toggle API key validation for incoming /v1 requests.', systemStatus: 'System Status', activeKeys: 'Active Keys', configured: 'configured', activeAccessKeys: 'Active Access Keys', keyPlaceholder: 'Enter or paste a key...', noKeys: 'No API keys configured. Generate one above.', bestPractices: 'Security Best Practices', bestPracticesDesc: 'Do not expose API keys in client-side code. Rotate keys when they appear in logs, screenshots, or shared scripts.', securityPolicy: 'Security Policy' },
    logs: { account: 'Account', status: 'Status', range: 'Range', allAccounts: 'All Accounts', allStatuses: 'All Statuses', last24h: 'Last 24h', lastHour: 'Last hour', last7d: 'Last 7 days', noLogs: 'No logs available', noMatch: 'No logs match current filters', timestamp: 'Timestamp', level: 'Level', message: 'Message' },
  },
  zh: {
    nav: {
      dashboard: '系统总览', accounts: '账号池集群', checkin: '每日签到', models: '模型矩阵 & 路由', playground: '在线调试', apiKeys: 'API Key & 绑定', logs: '服务运行日志',
    },
    breadcrumb: {
      dashboard: '控制台 / 概览', accounts: '控制台 / 账号管理', checkin: '权益中心 / 每日签到', models: '控制台 / 模型矩阵', playground: '调试 / 对话测试', apiKeys: '管理 / 安全', logs: '系统 / 日志', docs: '开发者平台 / 文档',
    },
    title: {
      dashboard: '聚合网关总览', accounts: '账号池管理中枢', checkin: '每日签到 · 领算力', models: '模型矩阵与路由', playground: '在线调试演练场', apiKeys: 'API Key 授权与子池管理', logs: '服务运行日志监控', docs: '文档',
    },
    common: { docs: '文档', support: '支持', healthy: '正常', offline: '未就绪', signOut: '退出', refresh: '刷新', add: '添加', delete: '删除', copy: '复制' },
    dashboard: {
      serviceStatus: '服务状态', allGatewaysActive: '网关可用', noActiveSession: '没有可用账号', accountPool: '账号池', activeSessions: '可用多厂商账号', apiAuth: 'API 鉴权', openAccess: '未开启鉴权', activeUser: '当前账号', systemBriefing: '运行状态', readyBrief: '网关正在运行，当前有 {count} 个账号可用于请求路由。', notReadyBrief: '当前没有可用会话，请先导入账号或添加凭据。', recentNotifications: '最近状态', authImportError: '本地登录导入失败', sessionActive: '账号已连接', credentialConfig: '凭据配置', credentialDesc: '添加各厂商凭据，或导入本机已有的登录会话。', patPlaceholder: '输入 Token 或 API Key...', addPat: '添加账号', saving: '保存中...', autoImport: '自动导入',
    },
    accounts: { desc: '管理 GITIT 网关聚合的多厂商账号（Qoder、智谱 ZCode、自定义模型等）。可单独控制账号是否参与通用 API 调度或定向调用，离线账号仍享受自动化保活维保。', refreshStatus: '刷新状态', importAccounts: '导入账号', search: '搜索账号...', empty: '还没有导入账号。点击添加账号或导入凭据。', showing: '共 {count} 个账号' },
    checkin: {
      bannerTitle: '每日签到福利 · 每个个人账号 +100 Credits',
      desc: '每个 Qoder 个人账号每天可免费领取 100 算力 Credits（企业团队版由组织统一分配算力，不参与每日签到已自动剔除）。官方每日 10:00 (UTC+8) 准时刷新，领取后 30 天有效。网关后台守护线程将在每日 10:00:05 准时自动执行签到补领，也可随时一键为全部账号领完。',
      claimAll: '一键签到全部账号',
      claiming: '正在签到领取中...',
      refresh: '刷新签到状态',
      allClaimedBadge: '今日已全部完成签到 (算力已到账)',
      pendingBadge: '今日有待签到账号，点击一键领取',
      statsClaimedRate: '今日签到进度',
      statsCreditsToday: '今日已领算力',
      statsTotalCredits: '账号池可用总算力',
      statsAutoSchedule: '自动签到守护',
      statsAutoScheduleDesc: '运行中 · 每日 10:00:00 准时自动执行',
      nextRefreshCountdown: '距 10:00 官方刷新倒计时',
      waitingRefreshBadge: '今日签到尚未开启 (等待 10:00 官方刷新)',
      waitingRefreshStatus: '待 10:00 刷新',
      waitingRefreshBtn: '待 10:00 刷新',
      btnWaitAuto: '待 10:00 自动入账',
      tableTitle: '账号签到状态与算力明细',
      colAccount: '账号 / 用户名',
      colPlan: '套餐类型',
      colStatus: '今日签到状态',
      colStreak: '连续签到',
      colQuota: '当前可用算力',
      colActions: '操作',
      btnClaimOne: '立即签到',
      claimedStatus: '已签到 (+100)',
      pendingStatus: '待签到',
      empty: '当前账号池无已启用账号。请先在「账号池」或「控制台」导入账号或添加 PAT。',
    },
    playground: { modelConfig: '模型配置', streamResponse: '流式响应', systemPrompt: '系统提示词', systemPromptPlaceholder: '定义模型的角色或行为...', ask: '输入要发送的内容...', send: '发送', waiting: '正在等待响应...' },
    api: { generate: '生成新 Key', desc: '管理客户端请求网关时使用的 API Key 和访问权限。', gatewayAuth: '网关 API 鉴权', gatewayAuthDesc: '控制 /v1 请求是否必须携带 API Key。', systemStatus: '系统状态', activeKeys: '可用 Key', configured: '已配置', activeAccessKeys: '已启用的 API Key', keyPlaceholder: '输入或粘贴 API Key...', noKeys: '还没有配置 API Key。请先生成并添加。', bestPractices: '安全建议', bestPracticesDesc: '不要把 API Key 写在前端代码里。如果 Key 出现在日志、截图或共享脚本中，请及时删除并重新生成。', securityPolicy: '安全策略' },
    logs: { account: '账号', status: '级别', range: '时间范围', allAccounts: '全部账号', allStatuses: '全部级别', last24h: '最近 24 小时', lastHour: '最近 1 小时', last7d: '最近 7 天', noLogs: '暂无日志', noMatch: '没有匹配当前筛选条件的日志', timestamp: '时间', level: '级别', message: '内容' },
  },
} as const

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string; iconFill: string }> = {
  SUCCESS: { bg: 'bg-white', border: 'border-l-[3px] border-l-toast-success', icon: 'check_circle', iconFill: 'text-toast-success' },
  ERROR: { bg: 'bg-white', border: 'border-l-[3px] border-l-toast-error', icon: 'error', iconFill: 'text-toast-error' },
  INFO: { bg: 'bg-white', border: 'border-l-[3px] border-l-toast-info', icon: 'info', iconFill: 'text-toast-info' },
}

// ─── Toast Context ───

const ToastCtx = createContext<{ push: (t: ToastType, title: string, message: string) => void }>({ push: () => {} })

// ─── Custom UI Components ───

function CustomCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-sm font-bold text-ink cursor-pointer group select-none"
    >
      <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
        checked ? 'bg-ink border-ink' : 'bg-white border-hairline-strong group-hover:border-ink/40'
      }`}>
        {checked && <span className="material-symbols-outlined text-white" style={{ fontSize: '14px', fontVariationSettings: "'FILL' 1" }}>check</span>}
      </span>
      {label}
    </button>
  )
}

function CustomSelect({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className={`relative ${open ? 'z-[5000]' : 'z-10'}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-11 bg-white border border-hairline-strong rounded-lg px-4 text-sm text-ink font-medium flex items-center justify-between focus:ring-2 focus:ring-ink outline-none cursor-pointer hover:border-ink/30 transition-colors"
      >
        <span className={selected ? 'text-ink' : 'text-body/50'}>{selected?.label || placeholder || 'Select...'}</span>
        <span className={`material-symbols-outlined text-body text-[18px] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>expand_more</span>
      </button>
      {open && (
        <div className="custom-select-dropdown absolute top-full left-0 right-0 mt-1 bg-white border border-hairline rounded-lg shadow-xl z-[6000] overflow-hidden">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full px-4 py-2.5 text-sm text-left font-medium transition-colors ${
                opt.value === value ? 'bg-canvas-soft text-ink font-bold' : 'text-body hover:bg-canvas-soft hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CustomInput({ value, onChange, placeholder, type = 'text', className = '', mono = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string; mono?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-white border border-hairline-strong text-ink text-sm px-4 py-3 rounded-lg outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-all placeholder:text-body/40 ${mono ? 'font-mono' : 'font-medium'} ${className}`}
    />
  )
}

function CustomTextarea({ value, onChange, placeholder, className = '', rows }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`custom-textarea w-full bg-white border border-hairline-strong text-ink text-sm px-4 py-3 rounded-xl outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-all placeholder:text-body/40 resize-none ${className}`}
    />
  )
}

// ─── Toast Container ───

function ToastContainer({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    toasts.forEach(t => {
      const el = itemRefs.current.get(t.id)
      if (!el || el.dataset.animated === '1') return
      el.dataset.animated = '1'
      gsap.fromTo(el,
        { opacity: 0, x: 60, scale: 0.92 },
        { opacity: 1, x: 0, scale: 1, duration: 0.4, ease: 'back.out(1.2)' }
      )
    })
  }, [toasts])

  const handleDismiss = (id: number) => {
    const el = itemRefs.current.get(id)
    if (el) {
      gsap.to(el, {
        opacity: 0, x: 60, scale: 0.92, duration: 0.25, ease: 'power2.in',
        onComplete: () => dismiss(id)
      })
    } else {
      dismiss(id)
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col-reverse gap-3 pointer-events-none" style={{ maxWidth: '380px' }}>
      {toasts.map(t => {
        const s = TOAST_STYLES[t.type]
        return (
          <div
            key={t.id}
            ref={el => { if (el) itemRefs.current.set(t.id, el) }}
            className={`pointer-events-auto ${s.bg} ${s.border} border border-hairline rounded-xl shadow-xl p-4 flex items-start gap-3 min-w-[320px]`}
          >
            <span className={`material-symbols-outlined ${s.iconFill} mt-0.5 shrink-0`} style={{ fontVariationSettings: "'FILL' 1", fontSize: '20px' }}>{s.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-ink uppercase tracking-wider">{t.title}</div>
              <div className="text-[12px] text-body mt-0.5 leading-relaxed break-words">{t.message}</div>
            </div>
            <button onClick={() => handleDismiss(t.id)} className="text-body/40 hover:text-ink transition-colors shrink-0 mt-0.5">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main App ───

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const stored = localStorage.getItem('qodergate_lang')
    if (stored === 'en' || stored === 'zh') return stored
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  })
  const [token, setToken] = useState<string | null>(localStorage.getItem('gateway_token'))
  const [authError, setAuthError] = useState<string | null>(null)
  const [inputToken, setInputToken] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [loginSuccess, setLoginSuccess] = useState(false)

  const [activeTab, setActiveTab] = useState<AppTabId>(() => {
    try {
      const stored = localStorage.getItem('qodergate_active_tab') as AppTabId
      if (stored && ['dashboard', 'accounts', 'checkin', 'models', 'playground', 'api-keys', 'logs'].includes(stored)) {
        return stored
      }
    } catch {}
    return 'dashboard'
  })
  const [status, setStatus] = useState<UIStatus>(() => {
    try {
      const cached = localStorage.getItem('qodergate_cached_status')
      if (cached) return JSON.parse(cached)
    } catch {}
    return { ready: false, mode: 'none', username: null, uid: null, user_type: null, error: null, accounts_count: 0 }
  })
  const [accountsConfig, setAccountsConfig] = useState<AccountsConfig>(() => {
    try {
      const cached = localStorage.getItem('qodergate_cached_accounts')
      if (cached) return JSON.parse(cached)
    } catch {}
    return { accounts: [], active_uid: null }
  })
  const [apiConfig, setApiConfig] = useState<APIConfig>(() => {
    try {
      const cached = localStorage.getItem('qodergate_cached_api_config')
      if (cached) return JSON.parse(cached)
    } catch {}
    return { auth_required: false, allowed_keys: [] }
  })
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try { localStorage.setItem('qodergate_active_tab', activeTab) } catch {}
  }, [activeTab])
  useEffect(() => {
    if (status.ready || status.accounts_count > 0) {
      try { localStorage.setItem('qodergate_cached_status', JSON.stringify(status)) } catch {}
    }
  }, [status])
  useEffect(() => {
    if (accountsConfig.accounts.length > 0) {
      try { localStorage.setItem('qodergate_cached_accounts', JSON.stringify(accountsConfig)) } catch {}
    }
  }, [accountsConfig])
  useEffect(() => {
    if (apiConfig.allowed_keys.length > 0 || apiConfig.auth_required) {
      try { localStorage.setItem('qodergate_cached_api_config', JSON.stringify(apiConfig)) } catch {}
    }
  }, [apiConfig])

  const [chatMessages, setChatMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! I am the QoderGate AI assistant. Ask me anything — I support Markdown and LaTeX math.' }
  ])
  const [chatInput, setChatInput] = useState('')
  const [model, setModel] = useState('lite')
  const [stream, setStream] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showThinking, setShowThinking] = useState(true)

  const [newKey, setNewKey] = useState('')
  const [newKeyAccount, setNewKeyAccount] = useState('')
  const [newKeyName, setNewKeyName] = useState('')
  const [playgroundTargetAccount, setPlaygroundTargetAccount] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [selectedAccessKey, setSelectedAccessKey] = useState<string>('')
  const [keyMasked, setKeyMasked] = useState<boolean>(true)
  const [copiedModel, setCopiedModel] = useState<string | null>(null)
  const [patToken, setPatToken] = useState('')
  const [submittingPat, setSubmittingPat] = useState(false)
  const [searchAccounts, setSearchAccounts] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  const [showBatchImport, setShowBatchImport] = useState(false)
  const [batchJson, setBatchJson] = useState('')
  const [refreshingTokens, setRefreshingTokens] = useState(false)
  const [quotaList, setQuotaList] = useState<any[] | null>(null)

  const [logFilterAccount, setLogFilterAccount] = useState('all')
  const [logFilterStatus, setLogFilterStatus] = useState('all')
  const [logFilterRange, setLogFilterRange] = useState('24h')

  const [checkinData, setCheckinData] = useState<CheckinOverview | null>(null)
  const [loadingCheckin, setLoadingCheckin] = useState(false)
  const [claimingCheckin, setClaimingCheckin] = useState(false)
  const [claimingUid, setClaimingUid] = useState<string | null>(null)
  const [countdownSecs, setCountdownSecs] = useState<number | null>(null)
  const [checkinSubTab, setCheckinSubTab] = useState<'qoder' | 'zcode' | 'all'>('qoder')

  const [showAddAccountModal, setShowAddAccountModal] = useState(false)
  const [addAccountTab, setAddAccountTab] = useState<'pat' | 'zcode'>('pat')
  const [qoderAuthMode, setQoderAuthMode] = useState<'oauth' | 'pat'>('pat')
  const [zcodeAuthMode, setZcodeAuthMode] = useState<'pat' | 'local' | 'oauth'>('pat')
  const [oauthRegion, setOauthRegion] = useState<'cn' | 'global'>('cn')
  const [oauthData, setOauthData] = useState<{
    verification_uri: string
    verification_uri_complete: string
    user_code: string
    device_code: string
    code_verifier: string
    machine_id: string
  } | null>(null)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthPolling, setOauthPolling] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const oauthPollTimerRef = useRef<any>(null)

  const [zcodeOauthData, setZcodeOauthData] = useState<{
    flow_id: string
    poll_token: string
    authorize_url: string
    expires_at?: number
    poll_interval_sec?: number
  } | null>(null)
  const [zcodeOauthLoading, setZcodeOauthLoading] = useState(false)
  const [zcodeOauthPolling, setZcodeOauthPolling] = useState(false)
  const [zcodeOauthError, setZcodeOauthError] = useState<string | null>(null)
  const zcodeOauthTimerRef = useRef<any>(null)

  const [addAccountPat, setAddAccountPat] = useState('')
  const [addAccountName, setAddAccountName] = useState('')
  const [addAccountDomain, setAddAccountDomain] = useState('')
  const [addingAccount, setAddingAccount] = useState(false)

  // Multi-provider state
  const [providerFilter, setProviderFilter] = useState<'all' | 'qoder' | 'zcode' | 'custom'>('all')
  const [zcodeApiKey, setZcodeApiKey] = useState('')
  const [zcodeAccountName, setZcodeAccountName] = useState('')
  const [customProviderName, setCustomProviderName] = useState('custom')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [customAccountName, setCustomAccountName] = useState('')
  const [importingZCodeLocal, setImportingZCodeLocal] = useState(false)

  const switchLang = (next: Lang) => {
    setLang(next)
    localStorage.setItem('qodergate_lang', next)
  }
  const t = UI_TEXT[lang]
  const msg = {
    imported: (name: string) => lang === 'zh' ? `已导入账号：${name}` : `Imported account: ${name}`,
    importFailed: lang === 'zh' ? '导入失败' : 'Import Failed',
    patAdded: (name: string) => lang === 'zh' ? `账号“${name}”已加入账号池` : `Account "${name}" added to pool`,
    patFailed: lang === 'zh' ? 'PAT 添加失败' : 'PAT Failed',
    activated: (uid: string) => lang === 'zh' ? `已切换到账号 ${uid.substring(0, 12)}...` : `Switched active account to ${uid.substring(0, 12)}...`,
    activationFailed: lang === 'zh' ? '激活失败' : 'Activation Failed',
    updated: (enabled: boolean) => lang === 'zh' ? `账号已${enabled ? '启用' : '禁用'}` : `Account ${enabled ? 'enabled' : 'disabled'}`,
    toggleFailed: lang === 'zh' ? '更新失败' : 'Toggle Failed',
    deleted: (uid: string) => lang === 'zh' ? `已删除账号 ${uid.substring(0, 12)}...` : `Removed account ${uid.substring(0, 12)}... from pool`,
    deleteFailed: lang === 'zh' ? '删除失败' : 'Delete Failed',
    configFailed: lang === 'zh' ? '配置保存失败' : 'Config Save Failed',
    authToggled: (enabled: boolean) => lang === 'zh' ? `API Key 鉴权已${enabled ? '开启' : '关闭'}` : `API key validation ${enabled ? 'enabled' : 'disabled'}`,
    keyGenerated: lang === 'zh' ? '已生成新的 API Key，点击添加后生效。' : 'A new API key has been generated. Click Add to activate it.',
    duplicateKey: lang === 'zh' ? '这个 API Key 已存在' : 'This API key already exists in the list',
    keyAdded: lang === 'zh' ? 'API Key 已添加' : 'New API key has been added to the gateway',
    keyRemoved: lang === 'zh' ? 'API Key 已删除' : 'API key has been removed from the gateway',
    copied: lang === 'zh' ? '已复制到剪贴板' : 'Copied to clipboard',
    refreshed: lang === 'zh' ? '状态已刷新' : 'Status Refreshed',
    logsRefreshed: lang === 'zh' ? '日志已刷新' : 'Logs Refreshed',
    aiFailed: lang === 'zh' ? 'AI 请求失败' : 'AI Request Failed',
    responseDone: lang === 'zh' ? '响应已完成' : 'Response Complete',
    connectionError: lang === 'zh' ? '连接失败' : 'Connection Error',
  }
  const navLabels: Record<AppTabId, string> = {
    dashboard: t.nav.dashboard,
    accounts: t.nav.accounts,
    checkin: t.nav.checkin,
    models: t.nav.models,
    playground: t.nav.playground,
    'api-keys': t.nav.apiKeys,
    logs: t.nav.logs,
  }
  const pageMeta: Record<AppTabId, { bc: string; title: string }> = {
    dashboard: { bc: t.breadcrumb.dashboard, title: t.title.dashboard },
    accounts: { bc: t.breadcrumb.accounts, title: t.title.accounts },
    checkin: { bc: t.breadcrumb.checkin, title: t.title.checkin },
    models: { bc: t.breadcrumb.models, title: t.title.models },
    playground: { bc: t.breadcrumb.playground, title: t.title.playground },
    'api-keys': { bc: t.breadcrumb.apiKeys, title: t.title.apiKeys },
    logs: { bc: t.breadcrumb.logs, title: t.title.logs },
  }

  const loginCardRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const contentBodyRef = useRef<HTMLDivElement>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const statCardsRef = useRef<HTMLDivElement>(null)
  const notifListRef = useRef<HTMLUListElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const orbRefs = useRef<(HTMLDivElement | null)[]>([])

  // Toast state
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastIdRef = useRef(0)
  const pushToast = useCallback((type: ToastType, title: string, message: string) => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, type, title, message }])
    setTimeout(() => {
      setToasts(prev => {
        const el = document.querySelector(`[data-toast-id="${id}"]`)
        if (el) {
          gsap.to(el, { opacity: 0, x: 60, scale: 0.92, duration: 0.25, ease: 'power2.in' })
          setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 260)
        } else {
          return prev.filter(t => t.id !== id)
        }
        return prev
      })
    }, 4500)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  const authedFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = { ...(options.headers || {}), 'X-Gateway-Token': token || '' }
    const resp = await fetch(url, { ...options, headers })
    if (resp.status === 401) { localStorage.removeItem('gateway_token'); setToken(null); throw new Error('Unauthorized') }
    return resp
  }, [token])

  const fetchStatus = useCallback(async () => {
    try { const resp = await authedFetch('/ui/status'); const data = await resp.json(); setStatus(data) } catch { /* */ } finally { setLoading(false) }
  }, [authedFetch])
  const fetchAccounts = useCallback(async () => {
    try { const resp = await authedFetch('/ui/accounts'); const data = await resp.json(); setAccountsConfig(data) } catch { /* */ }
  }, [authedFetch])
  const fetchApiConfig = useCallback(async () => {
    try { const resp = await authedFetch('/ui/config'); const data = await resp.json(); setApiConfig(data) } catch { /* */ }
  }, [authedFetch])
  const doBatchImport = useCallback(async () => {
    let records: unknown
    try { records = JSON.parse(batchJson) } catch { pushToast('ERROR', lang === 'zh' ? 'JSON 解析失败' : 'Invalid JSON', ''); return }
    const arr = Array.isArray(records) ? records : (records as { accounts?: unknown[] }).accounts || []
    if (arr.length === 0) { pushToast('ERROR', lang === 'zh' ? '数组为空' : 'Empty array', ''); return }
    try {
      const resp = await authedFetch('/ui/accounts/batch-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: arr }),
      })
      const data = await resp.json()
      if (data.status === 'ok') {
        pushToast('SUCCESS', lang === 'zh' ? `导入 ${data.imported} 个账号` : `Imported ${data.imported}`, lang === 'zh' ? `跳过 ${data.skipped}` : `skipped ${data.skipped}`)
        setBatchJson(''); setShowBatchImport(false); setShowAddAccountModal(false); fetchAccounts()
      } else { pushToast('ERROR', lang === 'zh' ? '导入失败' : 'Import failed', data.detail || '') }
    } catch { pushToast('ERROR', lang === 'zh' ? '导入失败' : 'Import failed', '') }
  }, [authedFetch, batchJson, lang, fetchAccounts, pushToast])

  const doRefreshTokens = useCallback(async () => {
    setRefreshingTokens(true)
    try {
      const resp = await authedFetch('/ui/accounts/refresh-tokens', { method: 'POST' })
      const data = await resp.json()
      if (data.status === 'ok') {
        pushToast('SUCCESS', lang === 'zh' ? `刷新完成 ${data.ok}/${data.total}` : `Refreshed ${data.ok}/${data.total}`, lang === 'zh' ? `失败 ${data.failed}` : `failed ${data.failed}`)
      } else { pushToast('ERROR', lang === 'zh' ? '刷新失败' : 'Refresh failed', data.error || '') }
    } catch { pushToast('ERROR', lang === 'zh' ? '刷新失败' : 'Refresh failed', '') } finally { setRefreshingTokens(false) }
  }, [authedFetch, lang, pushToast])

  const loadQuota = useCallback(async () => {
    try {
      const resp = await authedFetch('/ui/accounts/quota')
      const data = await resp.json()
      setQuotaList(data.quotas || [])
      fetchAccounts()
    } catch { pushToast('ERROR', lang === 'zh' ? '限额查询失败' : 'Quota query failed', '') }
  }, [authedFetch, lang, pushToast, fetchAccounts])

  const fetchLogs = useCallback(async () => {
    try { const resp = await authedFetch('/ui/logs'); const data = await resp.json(); setLogs(data) } catch { /* */ }
  }, [authedFetch])

  const fetchCheckinStatus = useCallback(async () => {
    setLoadingCheckin(true)
    try {
      const resp = await authedFetch('/ui/checkin/status')
      if (resp.ok) {
        const data = await resp.json()
        setCheckinData(data)
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingCheckin(false)
    }
  }, [authedFetch])

  const doClaimAllCheckin = useCallback(async () => {
    setClaimingCheckin(true)
    try {
      const resp = await authedFetch('/ui/checkin/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await resp.json()
      if (data.status === 'ok') {
        pushToast(
          'SUCCESS',
          lang === 'zh' ? '每日签到完成' : 'Daily Check-in Completed',
          lang === 'zh'
            ? `成功签到 ${data.claimed} 个账号，今日已签 ${data.already_claimed} 个，失败 ${data.failed} 个，获得 +${data.total_credits} Credits`
            : `Claimed ${data.claimed}, already ${data.already_claimed}, failed ${data.failed}, +${data.total_credits} credits`
        )
        fetchCheckinStatus()
      } else {
        pushToast('ERROR', lang === 'zh' ? '签到失败' : 'Check-in failed', data.error || '')
      }
    } catch (err: any) {
      pushToast('ERROR', lang === 'zh' ? '签到失败' : 'Check-in failed', err.message)
    } finally {
      setClaimingCheckin(false)
    }
  }, [authedFetch, lang, pushToast, fetchCheckinStatus])

  const doClaimOneCheckin = useCallback(async (uid: string) => {
    setClaimingUid(uid)
    try {
      const resp = await authedFetch('/ui/checkin/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      })
      const data = await resp.json()
      if (data.status === 'ok') {
        const r = data.result || {}
        pushToast(
          r.claimed ? 'SUCCESS' : 'INFO',
          r.claimed ? (lang === 'zh' ? '签到成功！' : 'Claimed!') : (lang === 'zh' ? '提示' : 'Notice'),
          r.message || (lang === 'zh' ? '状态已更新' : 'Updated')
        )
        fetchCheckinStatus()
      } else {
        pushToast('ERROR', lang === 'zh' ? '签到失败' : 'Claim failed', data.error || '')
      }
    } catch (err: any) {
      pushToast('ERROR', lang === 'zh' ? '签到失败' : 'Claim failed', err.message)
    } finally {
      setClaimingUid(null)
    }
  }, [authedFetch, lang, pushToast, fetchCheckinStatus])

  useEffect(() => {
    if (checkinData?.next_refresh_seconds != null) {
      setCountdownSecs(checkinData.next_refresh_seconds)
    }
  }, [checkinData?.next_refresh_seconds])

  useEffect(() => {
    if (countdownSecs == null || countdownSecs <= 0) return
    const timer = setInterval(() => {
      setCountdownSecs((prev) => {
        if (prev == null || prev <= 1) {
          fetchCheckinStatus()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [countdownSecs, fetchCheckinStatus])

  const formatCountdown = (secs: number | null) => {
    if (secs == null) return '--:--:--'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const [copiedEndpoint, setCopiedEndpoint] = useState(false)

  const copyToClipboard = useCallback((text: string, title?: string, desc?: string) => {
    if (!text) return
    const doToast = () => {
      pushToast(
        'SUCCESS',
        title || (lang === 'zh' ? '已复制到剪贴板' : 'Copied'),
        desc || text
      )
    }

    const fallbackCopy = () => {
      try {
        const textArea = document.createElement("textarea")
        textArea.value = text
        textArea.setAttribute("readonly", "")
        textArea.style.position = "fixed"
        textArea.style.top = "0"
        textArea.style.left = "0"
        textArea.style.width = "2em"
        textArea.style.height = "2em"
        textArea.style.padding = "0"
        textArea.style.border = "none"
        textArea.style.outline = "none"
        textArea.style.boxShadow = "none"
        textArea.style.background = "transparent"
        textArea.style.opacity = "0"
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        textArea.setSelectionRange(0, text.length)
        const successful = document.execCommand('copy')
        document.body.removeChild(textArea)
        if (successful) {
          doToast()
        } else {
          window.prompt(lang === 'zh' ? '请按 Ctrl+C 复制端点:' : 'Copy to clipboard: Ctrl+C, Enter', text)
        }
      } catch {
        window.prompt(lang === 'zh' ? '请按 Ctrl+C 复制端点:' : 'Copy to clipboard: Ctrl+C, Enter', text)
      }
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(doToast).catch(() => {
        fallbackCopy()
      })
    } else {
      fallbackCopy()
    }
  }, [lang, pushToast])

  const copyText = useCallback((text: string, title?: string, desc?: string) => {
    copyToClipboard(text, title, desc)
  }, [copyToClipboard])

  useEffect(() => {
    if (!token) return
    // 基础核心状态秒级拉取（轻量无阻塞）
    fetchStatus()
    fetchAccounts()
    fetchApiConfig()

    // 按当前所处 Tab 按需拉取对应模块数据，杜绝首页启动直接轰炸后端签到与日志
    if (activeTab === 'checkin') fetchCheckinStatus()
    if (activeTab === 'logs') fetchLogs()

    const si = setInterval(fetchStatus, 6000)
    const li = setInterval(() => { if (activeTab === 'logs') fetchLogs() }, 3000)
    const ci = setInterval(() => { if (activeTab === 'checkin') fetchCheckinStatus() }, 15000)
    return () => { clearInterval(si); clearInterval(li); clearInterval(ci) }
  }, [token, activeTab, fetchStatus, fetchAccounts, fetchApiConfig, fetchLogs, fetchCheckinStatus])

  useEffect(() => { if (activeTab === 'logs') logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs, activeTab])
  useEffect(() => { if (activeTab === 'playground') chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages, activeTab])

  // GSAP animations
  useEffect(() => { if (!token && loginCardRef.current) gsap.fromTo(loginCardRef.current, { scale: 0.92, opacity: 0, y: 30 }, { scale: 1, opacity: 1, y: 0, duration: 0.7, ease: 'back.out(1.4)' }) }, [token])
  useEffect(() => { if (token && sidebarRef.current) gsap.fromTo(sidebarRef.current, { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }) }, [token])
  useEffect(() => { if (token && contentBodyRef.current) gsap.fromTo(contentBodyRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }) }, [activeTab, token])
  useEffect(() => {
    if (token && activeTab === 'dashboard' && statCardsRef.current) {
      const cards = statCardsRef.current.querySelectorAll('.stat-card')
      gsap.fromTo(cards, { opacity: 0, y: 30, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.1, ease: 'power2.out' })
    }
  }, [activeTab, token, status])
  useEffect(() => {
    if (token && activeTab === 'dashboard' && notifListRef.current) {
      const items = notifListRef.current.querySelectorAll('li')
      gsap.fromTo(items, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.12, ease: 'power2.out' })
    }
  }, [activeTab, token])
  useEffect(() => {
    if (token && activeTab === 'dashboard' && terminalRef.current) {
      const lines = terminalRef.current.querySelectorAll('.term-line')
      gsap.fromTo(lines, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.15, ease: 'power1.out' })
    }
  }, [activeTab, token])
  useEffect(() => {
    orbRefs.current.forEach((orb, i) => {
      if (!orb) return
      gsap.to(orb, { x: `+=${10 + i * 5}`, y: `-=${8 + i * 3}`, duration: 6 + i * 2, repeat: -1, yoyo: true, ease: 'sine.inOut' })
    })
  }, [token])

  // ─── Handlers ───

  const handleVerifyToken = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inputToken.trim()
    if (!trimmed) return
    setVerifying(true); setAuthError(null)
    try {
      const resp = await fetch('/ui/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: trimmed }) })
      if (resp.ok) {
        setLoginSuccess(true)
        if (loginCardRef.current) {
          gsap.to(loginCardRef.current, { scale: 1.02, duration: 0.3, ease: 'power2.out', onComplete: () => { localStorage.setItem('gateway_token', trimmed); setToken(trimmed); setInputToken('') } })
        }
      } else {
        if (loginCardRef.current) gsap.to(loginCardRef.current, { x: 10, duration: 0.04, repeat: 7, yoyo: true, onComplete: () => gsap.set(loginCardRef.current!, { x: 0 }) })
        setAuthError('Invalid gateway access token')
      }
    } catch (err: any) { setAuthError(`Connection failed: ${err.message}`) } finally { setVerifying(false) }
  }

  const handleLogout = () => { localStorage.removeItem('gateway_token'); setToken(null); setLoginSuccess(false) }

  const handleImportAuth = async () => {
    setLoading(true)
    try {
      const resp = await authedFetch('/ui/accounts/import', { method: 'POST' })
      if (!resp.ok) { const err = await resp.json(); throw new Error(err.detail || 'Import failed') }
      const data = await resp.json()
      pushToast('SUCCESS', lang === 'zh' ? '账号已导入' : 'Account Imported', msg.imported(data.account?.name || (lang === 'zh' ? '本地会话' : 'local session')))
      fetchAccounts(); fetchStatus(); fetchLogs()
    } catch (err: any) {
      pushToast('ERROR', msg.importFailed, err.message)
    } finally { setLoading(false) }
  }

  const handleSavePat = async () => {
    if (!patToken.trim()) return
    setSubmittingPat(true)
    try {
      const resp = await authedFetch('/ui/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pat: patToken }) })
      if (!resp.ok) { const err = await resp.json(); throw new Error(err.detail || 'PAT save failed') }
      const data = await resp.json()
      pushToast('SUCCESS', lang === 'zh' ? 'PAT 已添加' : 'PAT Added', msg.patAdded(data.name || 'PAT Account'))
      setPatToken(''); fetchAccounts(); fetchStatus(); fetchLogs()
    } catch (err: any) {
      pushToast('ERROR', msg.patFailed, err.message)
    } finally { setSubmittingPat(false) }
  }

  const stopPollingOAuth = useCallback(() => {
    if (oauthPollTimerRef.current) {
      clearTimeout(oauthPollTimerRef.current)
      oauthPollTimerRef.current = null
    }
    setOauthPolling(false)
  }, [])

  const stopPollingZcodeOAuth = useCallback(() => {
    if (zcodeOauthTimerRef.current) {
      clearTimeout(zcodeOauthTimerRef.current)
      zcodeOauthTimerRef.current = null
    }
    setZcodeOauthPolling(false)
  }, [])

  const closeAddAccountModal = useCallback(() => {
    stopPollingOAuth()
    stopPollingZcodeOAuth()
    setShowAddAccountModal(false)
  }, [stopPollingOAuth, stopPollingZcodeOAuth])

  const startQoderOAuthFlow = useCallback(async (region: 'cn' | 'global' = oauthRegion) => {
    stopPollingOAuth()
    setOauthLoading(true)
    setOauthError(null)
    setOauthData(null)
    try {
      const resp = await authedFetch('/ui/oauth/qoder/device-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to initiate device flow')
      }
      const data = await resp.json()
      setOauthData(data)
      setOauthLoading(false)
      setOauthPolling(true)

      let attempts = 0
      const maxAttempts = 150
      const pollLoop = async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPollingOAuth()
          setOauthError(lang === 'zh' ? '授权超时，请点击下方重新生成' : 'Authorization timed out, please regenerate')
          return
        }
        try {
          const pResp = await authedFetch('/ui/oauth/qoder/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nonce: data.device_code,
              verifier: data.code_verifier,
              machine_id: data.machine_id,
              region,
            }),
          })
          if (pResp.ok) {
            const pData = await pResp.json()
            if (pData.status === 'ok') {
              stopPollingOAuth()
              pushToast(
                'SUCCESS',
                lang === 'zh' ? 'Qoder 授权成功' : 'Qoder Authorized',
                lang === 'zh' ? `账号“${pData.account?.name || 'Qoder'}”已成功接入并入库！` : `Account "${pData.account?.name || 'Qoder'}" successfully connected!`
              )
              closeAddAccountModal()
              fetchAccounts()
              fetchStatus()
              fetchLogs()
              fetchCheckinStatus()
              return
            }
          }
        } catch {
          // ignore transient poll error and retry
        }
        oauthPollTimerRef.current = setTimeout(pollLoop, 2000)
      }
      oauthPollTimerRef.current = setTimeout(pollLoop, 2000)
    } catch (err: any) {
      setOauthLoading(false)
      setOauthError(err.message || 'OAuth initiation failed')
    }
  }, [oauthRegion, stopPollingOAuth, authedFetch, lang, pushToast, closeAddAccountModal, fetchAccounts, fetchStatus, fetchLogs, fetchCheckinStatus])

  const startZcodeOAuthFlow = useCallback(async () => {
    stopPollingZcodeOAuth()
    setZcodeOauthLoading(true)
    setZcodeOauthError(null)
    setZcodeOauthData(null)
    try {
      const resp = await authedFetch('/ui/oauth/zcode/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'bigmodel' }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to initiate ZCode OAuth flow')
      }
      const data = await resp.json()
      setZcodeOauthData(data)
      setZcodeOauthLoading(false)
      setZcodeOauthPolling(true)

      let attempts = 0
      const maxAttempts = 180
      const pollLoop = async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPollingZcodeOAuth()
          setZcodeOauthError(lang === 'zh' ? '授权超时，请点击下方重新生成' : 'Authorization timed out, please regenerate')
          return
        }
        try {
          const pResp = await authedFetch('/ui/oauth/zcode/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              flow_id: data.flow_id,
              poll_token: data.poll_token,
              provider: 'bigmodel',
            }),
          })
          if (pResp.ok) {
            const pData = await pResp.json()
            if (pData.status === 'ready') {
              stopPollingZcodeOAuth()
              pushToast(
                'SUCCESS',
                lang === 'zh' ? 'ZCode 授权成功' : 'ZCode Authorized',
                lang === 'zh' ? `账号“${pData.account?.name || 'ZCode'}”已成功接入并入库！` : `Account "${pData.account?.name || 'ZCode'}" connected!`
              )
              closeAddAccountModal()
              fetchAccounts()
              fetchStatus()
              fetchLogs()
              fetchCheckinStatus()
              return
            }
          }
        } catch {
          // ignore transient poll error
        }
        zcodeOauthTimerRef.current = setTimeout(pollLoop, (data.poll_interval_sec || 2) * 1000)
      }
      zcodeOauthTimerRef.current = setTimeout(pollLoop, (data.poll_interval_sec || 2) * 1000)
    } catch (err: any) {
      setZcodeOauthLoading(false)
      setZcodeOauthError(err.message || 'ZCode OAuth initiation failed')
    }
  }, [stopPollingZcodeOAuth, authedFetch, lang, pushToast, closeAddAccountModal, fetchAccounts, fetchStatus, fetchLogs, fetchCheckinStatus])

  const openAddAccountModal = useCallback((tab: 'pat' | 'zcode' = 'pat', mode: 'oauth' | 'pat' = 'pat') => {
    setAddAccountTab(tab)
    setQoderAuthMode(mode)
    setShowAddAccountModal(true)
    if (tab === 'pat' && mode === 'oauth') {
      startQoderOAuthFlow(oauthRegion)
    } else if (tab === 'zcode' && zcodeAuthMode === 'oauth') {
      startZcodeOAuthFlow()
    }
  }, [oauthRegion, startQoderOAuthFlow, zcodeAuthMode, startZcodeOAuthFlow])

  useEffect(() => {
    return () => {
      stopPollingOAuth()
    }
  }, [stopPollingOAuth])

  const handleAddAccountPat = async () => {
    const trimmed = addAccountPat.trim()
    if (!trimmed) return
    setAddingAccount(true)
    try {
      const body: Record<string, string | undefined> = { pat: trimmed, name: addAccountName.trim() || undefined }
      const domain = addAccountDomain.trim()
      if (domain) body.enterprise_domain = domain
      const resp = await authedFetch('/ui/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'PAT verification failed')
      }
      const data = await resp.json()
      pushToast('SUCCESS', lang === 'zh' ? '账号已成功添加' : 'Account Added Successfully', msg.patAdded(data.name || 'PAT Account'))
      setAddAccountPat('')
      setAddAccountName('')
      setAddAccountDomain('')
      closeAddAccountModal()
      fetchAccounts()
      fetchStatus()
      fetchLogs()
      fetchCheckinStatus()
    } catch (err: any) {
      pushToast('ERROR', msg.patFailed, err.message)
    } finally {
      setAddingAccount(false)
    }
  }

  const handleImportZCodeLocal = async () => {
    setImportingZCodeLocal(true)
    try {
      const resp = await authedFetch('/ui/accounts/zcode-import', { method: 'POST' })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'ZCode local import failed')
      }
      const data = await resp.json()
      pushToast('SUCCESS', lang === 'zh' ? 'ZCode 凭据已导入' : 'ZCode Imported', `成功导入账号: ${data.account?.name || 'ZCode'}`)
      closeAddAccountModal()
      fetchAccounts()
      fetchStatus()
      fetchLogs()
      fetchCheckinStatus()
    } catch (err: any) {
      pushToast('ERROR', lang === 'zh' ? '导入失败' : 'Import Failed', err.message)
    } finally {
      setImportingZCodeLocal(false)
    }
  }

  const handleZCodeConfigFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string
        const parsed = JSON.parse(text)

        // 1. If it's credentials.json (encrypted or raw tokens) -> send to /ui/accounts/zcode-decrypt
        if (
          parsed.zcodejwttoken ||
          parsed['oauth:bigmodel:access_token'] ||
          parsed['oauth:active_provider'] ||
          Object.keys(parsed).some(k => k.startsWith('enc:') || String(parsed[k]).startsWith('enc:v1:'))
        ) {
          const dResp = await authedFetch('/ui/accounts/zcode-decrypt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentials: parsed }),
          })
          if (!dResp.ok) {
            const err = await dResp.json().catch(() => ({}))
            throw new Error(err.detail || 'ZCode credentials decryption failed')
          }
          const dData = await dResp.json()
          pushToast(
            'SUCCESS',
            lang === 'zh' ? 'ZCode 凭据解密成功' : 'ZCode Decrypted',
            lang === 'zh' ? `账号“${dData.account?.name || 'ZCode'}”已成功解密并入库！` : `Account "${dData.account?.name || 'ZCode'}" decrypted and added!`
          )
          closeAddAccountModal()
          fetchAccounts()
          fetchStatus()
          fetchLogs()
          fetchCheckinStatus()
          return
        }

        // 2. If it's config.json -> extract apiKey
        let foundKey = ''
        if (parsed.provider) {
          for (const k of ['builtin:bigmodel', 'builtin:bigmodel-coding-plan', 'builtin:bigmodel-start-plan']) {
            const key = parsed.provider[k]?.options?.apiKey
            if (key && typeof key === 'string' && key.includes('.')) {
              foundKey = key.trim()
              break
            }
          }
        }
        if (!foundKey && parsed.apiKey && typeof parsed.apiKey === 'string') {
          foundKey = parsed.apiKey.trim()
        }
        if (foundKey) {
          setZcodeApiKey(foundKey)
          setZcodeAccountName(lang === 'zh' ? 'ZCode 智谱官方' : 'ZCode BigModel')
          setZcodeAuthMode('pat')
          pushToast('SUCCESS', lang === 'zh' ? '已解析本地配置文件' : 'Parsed Config File', `提取到 API Key: ${foundKey.slice(0, 10)}...`)
        } else {
          pushToast('ERROR', lang === 'zh' ? '未找到有效凭据' : 'No Valid Key Found', lang === 'zh' ? '请选择 ~/.zcode/v2/credentials.json 或 config.json' : 'Please select valid credentials.json or config.json')
        }
      } catch (err: any) {
        pushToast('ERROR', lang === 'zh' ? '文件处理失败' : 'Failed to process file', err.message)
      }
    }
    reader.readAsText(file)
  }

  const handleAddZCodeManual = async () => {
    const trimmed = zcodeApiKey.trim()
    if (!trimmed) return
    setAddingAccount(true)
    try {
      const resp = await authedFetch('/ui/accounts/add-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'zcode',
          token: trimmed,
          name: zcodeAccountName.trim() || 'ZCode Account',
        }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'ZCode add failed')
      }
      const data = await resp.json()
      pushToast('SUCCESS', lang === 'zh' ? 'ZCode 账号已添加' : 'ZCode Account Added', `账号: ${data.account?.name}`)
      setZcodeApiKey('')
      setZcodeAccountName('')
      closeAddAccountModal()
      fetchAccounts()
      fetchStatus()
      fetchLogs()
      fetchCheckinStatus()
    } catch (err: any) {
      pushToast('ERROR', lang === 'zh' ? '添加失败' : 'Failed to add', err.message)
    } finally {
      setAddingAccount(false)
    }
  }

  const handleAddCustomProvider = async () => {
    const trimmedKey = customApiKey.trim()
    const trimmedUrl = customBaseUrl.trim()
    if (!trimmedKey || !trimmedUrl) return
    setAddingAccount(true)
    try {
      const resp = await authedFetch('/ui/accounts/add-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: customProviderName.trim() || 'custom',
          token: trimmedKey,
          base_url: trimmedUrl,
          name: customAccountName.trim() || 'Custom Provider',
        }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'Custom provider add failed')
      }
      const data = await resp.json()
      pushToast('SUCCESS', lang === 'zh' ? '自定义 Provider 已接入' : 'Custom Provider Added', `厂商: ${data.account?.provider}`)
      setCustomApiKey('')
      setCustomBaseUrl('')
      setCustomAccountName('')
      closeAddAccountModal()
      fetchAccounts()
      fetchStatus()
      fetchLogs()
      fetchCheckinStatus()
    } catch (err: any) {
      pushToast('ERROR', lang === 'zh' ? '接入失败' : 'Failed to add', err.message)
    } finally {
      setAddingAccount(false)
    }
  }

  const handleSelectAccount = async (uid: string) => {
    try {
      const resp = await authedFetch('/ui/accounts/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid }) })
      if (!resp.ok) throw new Error('Switch failed')
      pushToast('INFO', lang === 'zh' ? '账号已激活' : 'Account Activated', msg.activated(uid))
      fetchAccounts(); fetchStatus(); fetchLogs()
    } catch (err: any) { pushToast('ERROR', msg.activationFailed, err.message) }
  }

  const handleToggleAccount = async (uid: string, enabled: boolean) => {
    try {
      const resp = await authedFetch('/ui/accounts/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid, enabled }) })
      if (!resp.ok) throw new Error('Toggle failed')
      pushToast('INFO', lang === 'zh' ? '账号已更新' : 'Account Updated', msg.updated(enabled))
      fetchAccounts(); fetchStatus()
    } catch (err: any) { pushToast('ERROR', msg.toggleFailed, err.message) }
  }

  const handleSetApiMode = async (uid: string, mode: 'all' | 'dedicated' | 'disabled') => {
    try {
      const resp = await authedFetch('/ui/accounts/set-api-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, api_mode: mode }),
      })
      if (!resp.ok) throw new Error('Update API mode failed')
      const labels: Record<string, string> = {
        all: lang === 'zh' ? '全部调用 (默认池)' : 'All Calls (Default Pool)',
        dedicated: lang === 'zh' ? '专属单独调用 (仅定向)' : 'Dedicated (Solo Only)',
        disabled: lang === 'zh' ? '排除调用 (仅签到保活)' : 'Excluded (Check-in Only)',
      }
      pushToast(
        'SUCCESS',
        lang === 'zh' ? 'API 调度模式已更新' : 'API Mode Updated',
        lang === 'zh' ? `已设置为：${labels[mode]}` : `Set to: ${labels[mode]}`
      )
      fetchAccounts()
      fetchStatus()
    } catch (err: any) {
      pushToast('ERROR', lang === 'zh' ? '操作失败' : 'Failed', err.message)
    }
  }

  const handleDeleteAccount = async (uid: string) => {
    if (!confirm('Delete this account from the database?')) return
    try {
      const resp = await authedFetch(`/ui/accounts/${uid}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error('Delete failed')
      pushToast('SUCCESS', lang === 'zh' ? '账号已删除' : 'Account Deleted', msg.deleted(uid))
      fetchAccounts(); fetchStatus(); fetchLogs()
    } catch (err: any) { pushToast('ERROR', msg.deleteFailed, err.message) }
  }

  const handleSaveApiConfig = async (newConfig: APIConfig) => {
    try {
      await authedFetch('/ui/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newConfig) })
      setApiConfig(newConfig)
    } catch { pushToast('ERROR', msg.configFailed, lang === 'zh' ? '无法更新 API 配置' : 'Could not update API configuration') }
  }

  const handleToggleAuth = () => {
    const updated = { ...apiConfig, auth_required: !apiConfig.auth_required }
    handleSaveApiConfig(updated)
    pushToast('INFO', lang === 'zh' ? '鉴权状态已更新' : 'Auth Toggled', msg.authToggled(!apiConfig.auth_required))
  }

  const handleGenerateKey = () => {
    const random = 'qg_live_' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('')
    setNewKey(random)
    pushToast('INFO', lang === 'zh' ? 'Key 已生成' : 'Key Generated', msg.keyGenerated)
  }

  const handleAddKey = () => {
    const trimmed = newKey.trim()
    if (!trimmed) return
    if (apiConfig.allowed_keys.includes(trimmed)) { pushToast('ERROR', lang === 'zh' ? 'Key 已存在' : 'Duplicate Key', msg.duplicateKey); return }
    const newDetail: KeyDetail = {
      api_key: trimmed,
      name: newKeyName.trim() || (newKeyAccount ? (accountsConfig.accounts.find(a => a.uid === newKeyAccount)?.name || '专属 Key') : '通用 Key'),
      account_uid: newKeyAccount.trim(),
    }
    const currentDetails = apiConfig.allowed_keys_detail || apiConfig.allowed_keys.map(k => ({ api_key: k, name: '', account_uid: '' }))
    const updatedDetails = [...currentDetails, newDetail]
    handleSaveApiConfig({
      ...apiConfig,
      allowed_keys: [...apiConfig.allowed_keys, trimmed],
      allowed_keys_detail: updatedDetails,
    })
    pushToast('SUCCESS', lang === 'zh' ? 'Key 已添加' : 'Key Added', msg.keyAdded)
    setNewKey('')
    setNewKeyName('')
    setNewKeyAccount('')
  }

  const handleDeleteKey = (key: string) => {
    const currentDetails = apiConfig.allowed_keys_detail || apiConfig.allowed_keys.map(k => ({ api_key: k, name: '', account_uid: '' }))
    handleSaveApiConfig({
      ...apiConfig,
      allowed_keys: apiConfig.allowed_keys.filter(k => k !== key),
      allowed_keys_detail: currentDetails.filter(k => k.api_key !== key),
    })
    pushToast('SUCCESS', lang === 'zh' ? 'Key 已删除' : 'Key Removed', msg.keyRemoved)
  }

  const handleUpdateKeyAccount = (key: string, targetUid: string) => {
    const currentDetails = apiConfig.allowed_keys_detail || apiConfig.allowed_keys.map(k => ({ api_key: k, name: '', account_uid: '' }))
    const updated = currentDetails.map(item => item.api_key === key ? { ...item, account_uid: targetUid } : item)
    handleSaveApiConfig({
      ...apiConfig,
      allowed_keys_detail: updated,
    })
    pushToast('SUCCESS', lang === 'zh' ? 'Key 绑定已更新' : 'Key Binding Updated', lang === 'zh' ? '已更新该 Key 的指定调用账号' : 'Updated key target account')
  }

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopiedKey(key)
    pushToast('INFO', lang === 'zh' ? '已复制' : 'Copied', msg.copied)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const handleRefreshStatus = () => {
    fetchAccounts(); fetchStatus(); fetchLogs()
    pushToast('INFO', msg.refreshed, lang === 'zh' ? '账号池和系统状态已更新' : 'Account pool and system status updated')
  }

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = chatInput.trim()
    if (!trimmed || generating) return
    setChatMessages(prev => [...prev, { role: 'user', content: trimmed }])
    setChatInput(''); setGenerating(true)
    setChatMessages(prev => [...prev, { role: 'assistant', content: '' }])

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiConfig.auth_required && apiConfig.allowed_keys.length > 0) {
      const boundKey = apiConfig.allowed_keys_detail?.find(k => k.account_uid && accountsConfig.accounts.find(a => a.name === playgroundTargetAccount)?.uid === k.account_uid)?.api_key
      headers['Authorization'] = `Bearer ${boundKey || apiConfig.allowed_keys[0]}`
    }
    if (playgroundTargetAccount) {
      headers['X-Account'] = playgroundTargetAccount
    }

    try {
      const response = await fetch('/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model, messages: [{ role: 'user', content: trimmed }], stream }) })
      if (!response.ok) {
        const errData = await response.json()
        const errMsg = errData.detail || errData.error?.message || response.statusText
        setChatMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: `Request failed: ${errMsg}` }; return u })
        pushToast('ERROR', msg.aiFailed, errMsg)
        setGenerating(false); return
      }
      if (stream) {
        const reader = response.body?.getReader()
        if (!reader) throw new Error('No stream reader')
        const decoder = new TextDecoder('utf-8')
        let buffer = ''; let currentResponse = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n'); buffer = lines.pop() || ''
          for (const line of lines) {
            const tl = line.trim()
            if (!tl.startsWith('data:')) continue
            const rawData = tl.slice(5).trim()
            if (rawData === '[DONE]') continue
            try { const parsed = JSON.parse(rawData); const chunk = parsed.choices?.[0]?.delta?.content || ''; currentResponse += chunk; setChatMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: currentResponse }; return u }) } catch { /* */ }
          }
        }
        pushToast('SUCCESS', msg.responseDone, lang === 'zh' ? '流式响应已结束' : 'AI response stream finished successfully')
      } else {
        const data = await response.json()
        const ans = data.choices?.[0]?.message?.content || ''
        setChatMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: ans }; return u })
        pushToast('SUCCESS', msg.responseDone, lang === 'zh' ? '已收到 AI 响应' : 'AI response received successfully')
      }
    } catch (err: any) {
      setChatMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: `Connection error: ${err.message}` }; return u })
      pushToast('ERROR', msg.connectionError, err.message)
    } finally { setGenerating(false) }
  }

  const renderMessageContent = (text: string) => {
    const thinkingRegex = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/
    const match = text.match(thinkingRegex)
    if (match) {
      const thinking = match[1]; const response = text.replace(thinkingRegex, '').trim()
      return (
        <div className="space-y-3">
          <div className="bg-canvas-soft border border-hairline rounded-xl overflow-hidden">
            <button onClick={() => setIsExpanded(!isExpanded)} className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-body hover:text-ink transition-colors">
              <span className="material-symbols-outlined text-base">psychology</span>Thinking Process
              <span className={`material-symbols-outlined transition-transform ${isExpanded ? 'rotate-180' : ''}`}>expand_more</span>
            </button>
            {isExpanded && <div className="px-4 py-3 text-xs text-body italic leading-relaxed border-t border-hairline opacity-70 whitespace-pre-wrap">{thinking}</div>}
          </div>
          {response && <div className="prose prose-stone max-w-none text-sm leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{response}</ReactMarkdown></div>}
        </div>
      )
    }
    return <div className="prose prose-stone max-w-none text-sm leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{text}</ReactMarkdown></div>
  }

  const getLogLevel = (log: string) => (log.match(/\[(INFO|ERROR|WARNING)\]/)?.[1] || 'INFO').toLowerCase()
  const getLogMinutes = (log: string) => {
    const match = log.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/)
    if (!match) return null
    return Number(match[1]) * 60 + Number(match[2])
  }
  const getLogAccount = (log: string) => {
    const routed = log.match(/Request routing via account:\s*(.+?)\s*\(([^)]+)\)/)
    if (routed) return routed[2]
    const failed = log.match(/Request failed on account\s+([^:]+):/)
    if (failed) return failed[1]
    return null
  }
  const accountLogOptions = [
    { value: 'all', label: 'All Accounts' },
    ...Array.from(new Set([
      ...accountsConfig.accounts.map(acc => acc.uid),
      ...logs.map(getLogAccount).filter((uid): uid is string => Boolean(uid))
    ])).map(uid => ({ value: uid, label: accountsConfig.accounts.find(acc => acc.uid === uid)?.name || uid }))
  ]
  const filteredLogs = logs.filter(log => {
    if (logFilterStatus !== 'all' && getLogLevel(log) !== logFilterStatus) return false
    if (logFilterAccount !== 'all' && getLogAccount(log) !== logFilterAccount) return false
    if (logFilterRange === '1h') {
      const minutes = getLogMinutes(log)
      if (minutes === null) return false
      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const diff = (nowMinutes - minutes + 1440) % 1440
      return diff <= 60
    }
    return true
  })
  // ─── LOGIN PAGE ───
  if (!token) {
    return (
      <div className="bg-surface text-ink min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
        <div ref={el => { orbRefs.current[0] = el }} className="atmospheric-orb absolute top-1/4 left-1/3 w-[400px] h-[400px] bg-lavender rounded-full"></div>
        <div ref={el => { orbRefs.current[1] = el }} className="atmospheric-orb absolute bottom-1/4 right-1/3 w-[500px] h-[500px] bg-sky rounded-full" style={{ animationDelay: '-4s' }}></div>
        <main ref={loginCardRef} className="relative w-full max-w-[440px] z-10">
          <div className="surface-card glass-card rounded-xl p-8 border border-hairline shadow-sm">
            <div className="flex flex-col items-center mb-8">
              <div className="w-10 h-10 bg-ink rounded-lg flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>gate</span>
              </div>
              <h1 className="font-display-lg text-ink tracking-tight">GITIT</h1>
              <p className="text-[12px] font-semibold text-on-surface-variant mt-2 uppercase tracking-widest">{lang === 'zh' ? '多厂商 AI 聚合网关控制台' : 'Universal Multi-Provider Gateway'}</p>
            </div>
            <form className="space-y-6" onSubmit={handleVerifyToken}>
              <div className="space-y-2">
                <label className="font-bold text-ink text-[16px]">{lang === 'zh' ? '网关访问密钥' : 'Gateway Access Token'}</label>
                <CustomInput type="password" value={inputToken} onChange={setInputToken} placeholder={lang === 'zh' ? '输入你的安全密钥...' : 'Enter your security token...'} />
              </div>
              {authError && (
                <div className="flex items-center gap-2 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-semibold">
                  <span className="material-symbols-outlined text-base">warning</span>{authError}
                </div>
              )}
              <button className={`w-full font-bold py-4 rounded-full transition-all flex items-center justify-center group ${loginSuccess ? 'bg-mint text-ink' : 'bg-ink text-white hover:bg-primary'}`} type="submit" disabled={verifying}>
                {verifying ? (
                  <><svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Authenticating...</span></>
                ) : loginSuccess ? (
                  <><span className="material-symbols-outlined">check_circle</span><span className="ml-2">{lang === 'zh' ? '访问已授权' : 'Access Granted'}</span></>
                ) : (
                  <><span className="text-[15px]">{lang === 'zh' ? '验证密钥' : 'Verify Token'}</span><span className="material-symbols-outlined ml-2 transition-transform group-hover:translate-x-1">arrow_forward</span></>
                )}
              </button>
            </form>
            <button onClick={() => switchLang(lang === 'zh' ? 'en' : 'zh')} className="mt-4 w-full text-xs font-bold text-body hover:text-ink transition-colors">
              {lang === 'zh' ? 'Switch to English' : '切换到中文'}
            </button>
            <div className="mt-8 pt-6 border-t border-hairline flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 text-on-surface-variant"><span className="material-symbols-outlined text-[18px]">verified_user</span><p className="text-[13px]">End-to-end encrypted session</p></div>
              <p className="text-[12px] text-on-surface-variant/70 text-center leading-relaxed">Access is restricted to authorized personnel. All connection attempts are logged and monitored.</p>
            </div>
          </div>
          <div className="mt-4 flex justify-between px-4 opacity-40">
            <span className="text-[10px] tracking-widest text-ink uppercase">v3.0.0 multi-provider</span>
            <span className="text-[10px] tracking-widest text-ink uppercase">Status: Operational</span>
          </div>
        </main>
      </div>
    )
  }

  // ─── MAIN LAYOUT ───
  const { bc, title } = pageMeta[activeTab]

  return (
    <div className="bg-surface min-h-screen relative overflow-x-hidden max-w-full w-full">
      <div ref={el => { orbRefs.current[2] = el }} className="orb bg-mint w-[500px] h-[500px] -top-24 -right-24"></div>
      <div ref={el => { orbRefs.current[3] = el }} className="orb bg-peach w-[400px] h-[400px] bottom-0 left-[20%]"></div>

      <aside ref={sidebarRef} className="fixed left-0 top-0 h-screen w-[260px] bg-white/95 border-r border-hairline flex flex-col z-50 select-none backdrop-blur-md">
        {/* Brand: GITIT with Dual Subtitle */}
        <div className="p-5 border-b border-hairline/80">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-500 flex items-center justify-center shadow-md shadow-indigo-200 shrink-0">
              <span className="material-symbols-outlined text-white text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>hub</span>
              <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-white"></span>
              </span>
            </div>
            <div className="flex flex-col justify-center">
              <h1 className="font-black text-xl tracking-tight bg-gradient-to-r from-indigo-700 via-slate-800 to-emerald-700 bg-clip-text text-transparent leading-none">
                GITIT
              </h1>
            </div>
          </div>
        </div>

        {/* Navigation Groups with Dual-State Icons & Spacious Padding */}
        <nav className="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
          {NAV_GROUPS.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 pt-1 pb-1">
                {lang === 'zh' ? group.groupZh : group.groupEn}
              </div>
              {group.items.map((item) => {
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`nav-item flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all w-full text-left cursor-pointer ${
                      isActive
                        ? 'active bg-slate-100 text-ink font-bold shadow-xs'
                        : 'text-body font-medium hover:bg-slate-100/70 hover:text-ink'
                    }`}
                  >
                    <span
                      className="material-symbols-outlined text-[20px] shrink-0"
                      style={{
                        fontVariationSettings: isActive ? "'FILL' 1, 'wght' 500" : "'FILL' 0, 'wght' 350",
                        color: isActive ? '#0f172a' : undefined,
                      }}
                    >
                      {item.icon}
                    </span>
                    <span className="text-[13px] font-medium whitespace-nowrap truncate shrink-0">{lang === 'zh' ? item.labelZh : item.labelEn}</span>
                    {item.id === 'accounts' && (
                      <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-body font-mono shrink-0">
                        {accountsConfig.accounts.length} {lang === 'zh' ? '账号' : 'Acc'}
                      </span>
                    )}
                    {item.id === 'checkin' && (
                      <span className="ml-auto px-1.5 py-0.5 text-[9px] font-bold bg-amber-500 text-white rounded leading-none shrink-0 shadow-xs">
                        +100
                      </span>
                    )}
                    {item.badgeZh && item.id === 'models' && (
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-md shrink-0">
                        {lang === 'zh' ? item.badgeZh : item.badgeEn}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Cluster Status Footer */}
        <div className="p-4 border-t border-hairline bg-slate-50/60">
          <div className="p-3 bg-white border border-hairline rounded-xl shadow-subtle space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-bold text-slate-700">{lang === 'zh' ? '双上游集群在线' : 'Dual Upstream Online'}</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">Server A</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-hairline/60 text-[10px]">
              <div className="flex items-center justify-between px-2 py-1 bg-indigo-50/50 rounded border border-indigo-100/50">
                <span className="text-indigo-700 font-semibold">Qoder</span>
                <span className="text-emerald-600 font-mono font-bold">100%</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1 bg-emerald-50/50 rounded border border-emerald-100/50">
                <span className="text-emerald-700 font-semibold">ZCode</span>
                <span className="text-emerald-600 font-mono font-bold">100%</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="ml-[260px] min-h-screen flex flex-col relative z-10 min-w-0 max-w-full overflow-x-hidden">
        <header className="flex justify-between items-center h-16 px-6 sm:px-8 w-full border-b border-hairline/80 bg-white/80 sticky top-0 z-40 backdrop-blur-md min-w-0">
          <div className="shrink-0 mr-4">
            <div className="flex items-center gap-2 text-[10px] text-body font-semibold uppercase tracking-wider">{bc}</div>
            <h2 className="font-display-md text-ink text-base sm:text-lg font-black mt-0.5 whitespace-nowrap tracking-tight">{title}</h2>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => openAddAccountModal('pat', 'pat')}
              className="px-3 py-1.5 bg-ink hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm transition-all shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              <span>{lang === 'zh' ? '接入账号' : 'Add Account'}</span>
            </button>

            {(() => {
              const currentEndpoint = typeof window !== 'undefined' && window.location?.protocol?.startsWith('http') && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')
                ? (window.location.port === '5050' ? 'https://lite.bigbob.asia/v1' : `${window.location.origin}/v1`)
                : 'https://lite.bigbob.asia/v1';

              return (
                <button
                  type="button"
                  onClick={() => {
                    copyToClipboard(currentEndpoint, lang === 'zh' ? '已复制公网端点' : 'Copied Gateway URL', currentEndpoint);
                    setCopiedEndpoint(true);
                    setTimeout(() => setCopiedEndpoint(false), 2000);
                  }}
                  className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-xs font-mono transition-all shrink-0 cursor-pointer ${
                    copiedEndpoint
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 text-slate-700'
                  }`}
                  title={lang === 'zh' ? `点击复制完整公网端点: ${currentEndpoint}` : `Click to copy endpoint: ${currentEndpoint}`}
                >
                  <span className={`w-2 h-2 rounded-full ${copiedEndpoint ? 'bg-emerald-600' : 'bg-emerald-500 animate-pulse'}`}></span>
                  <span className="font-semibold text-slate-700">/v1</span>
                  <span className="material-symbols-outlined text-[13px] text-slate-400">
                    {copiedEndpoint ? 'check' : 'content_copy'}
                  </span>
                  {copiedEndpoint && (
                    <span className="text-[10px] font-sans font-bold text-emerald-700 ml-0.5">
                      {lang === 'zh' ? '已复制' : 'Copied'}
                    </span>
                  )}
                </button>
              );
            })()}

            <div className="flex items-center gap-1 text-xs font-semibold pl-2 border-l border-hairline shrink-0">
              <a href="/documents" className="text-body hover:text-ink px-2 py-1 rounded transition-colors cursor-pointer">{t.common.docs}</a>
              <button onClick={() => switchLang(lang === 'zh' ? 'en' : 'zh')} className="text-body hover:text-ink px-2 py-1 rounded transition-colors cursor-pointer font-bold">{lang === 'zh' ? 'EN' : '中文'}</button>
              <button onClick={handleLogout} className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded transition-colors font-bold cursor-pointer">{t.common.signOut}</button>
            </div>
          </div>
        </header>

        <div ref={contentBodyRef} className="flex-1 p-6 sm:p-8 max-w-7xl w-full mx-auto space-y-8 min-w-0">
          {/* ─── DASHBOARD ─── */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              <section ref={statCardsRef} className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  {
                    label: t.dashboard.serviceStatus,
                    value: status.ready
                      ? t.common.healthy
                      : (loading && accountsConfig.accounts.length === 0 ? (lang === 'zh' ? '同步中...' : 'Syncing...') : t.common.offline),
                    detail: status.ready
                      ? t.dashboard.allGatewaysActive
                      : (loading && accountsConfig.accounts.length === 0 ? (lang === 'zh' ? '正在连接网关...' : 'Connecting...') : t.dashboard.noActiveSession),
                    dot: status.ready
                      ? 'bg-mint'
                      : (loading && accountsConfig.accounts.length === 0 ? 'bg-amber-400 animate-pulse' : 'bg-red-400')
                  },
                  {
                    label: t.dashboard.accountPool,
                    value: String(status.accounts_count || accountsConfig.accounts.length || (loading ? '...' : 0)),
                    detail: t.dashboard.activeSessions
                  },
                  {
                    label: t.dashboard.apiAuth,
                    value: apiConfig.auth_required ? (lang === 'zh' ? '已开启' : 'Enabled') : (lang === 'zh' ? '未开启' : 'Disabled'),
                    detail: apiConfig.auth_required ? `${apiConfig.allowed_keys.length} keys active` : t.dashboard.openAccess
                  },
                  {
                    label: t.dashboard.activeUser,
                    value: status.username || (loading && accountsConfig.accounts.length === 0 ? '...' : (lang === 'zh' ? '无' : 'None')),
                    detail: status.user_type || 'N/A'
                  }
                ].map((stat, i) => (
                  <div key={i} className="stat-card bg-surface-card border border-hairline p-6 rounded-xl hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-all cursor-default">
                    <div className="text-[12px] font-semibold text-body mb-2 uppercase tracking-widest">{stat.label}</div>
                    <div className="flex items-center gap-2"><span className="font-display-sm text-ink">{stat.value}</span>{stat.dot && <div className={`h-2 w-2 rounded-full ${stat.dot}`}></div>}</div>
                    <div className="text-[12px] text-body mt-2">{stat.detail}</div>
                  </div>
                ))}
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="lg:col-span-2 glass-card p-8 rounded-2xl flex flex-col">
                  <div className="text-[12px] font-semibold text-body mb-2 uppercase tracking-widest">{t.dashboard.systemBriefing}</div>
                  <div className="font-display-md text-ink mb-4 max-w-lg">
                    {status.ready
                      ? t.dashboard.readyBrief.replace('{count}', String(status.accounts_count || accountsConfig.accounts.length))
                      : (loading && accountsConfig.accounts.length === 0
                          ? (lang === 'zh' ? '正在同步云端网关会话，请稍候...' : 'Synchronizing cloud gateway session, please wait...')
                          : t.dashboard.notReadyBrief)}
                  </div>
                  <div className="mt-auto bg-ink/5 p-4 rounded-lg border border-hairline-strong" ref={terminalRef}>
                    <code className="text-sm font-mono text-ink">
                      <span className="text-primary font-bold">system@gitit:~$</span> status --check --all<br />
                      <span className="term-line opacity-70">Checking upstream provider nodes... [{status.ready ? 'OK' : (loading && accountsConfig.accounts.length === 0 ? 'SYNCING...' : 'FAIL')}]<br /></span>
                      <span className="term-line opacity-70">Multi-provider engine: [Qoder: ACTIVE] [ZCode: ACTIVE] [Custom: READY]<br /></span>
                      <span className="term-line opacity-70">Routing traffic to optimal provider & account...</span><span className="cursor-blink">_</span>
                    </code>
                  </div>
                </div>
                <div className="bg-surface-card border border-hairline p-8 rounded-2xl">
                  <div className="text-[12px] font-semibold text-body mb-6 uppercase tracking-widest">{t.dashboard.recentNotifications}</div>
                  <ul ref={notifListRef} className="space-y-4">
                    {status.error ? (
                      <li className="flex items-start gap-4"><span className="material-symbols-outlined text-peach">warning</span><div><div className="font-bold text-[16px]">{t.dashboard.authImportError}</div><div className="text-[12px] text-body break-all">{status.error}</div></div></li>
                    ) : (
                      <>
                        <li className="flex items-start gap-4"><span className="material-symbols-outlined text-sky">info</span><div><div className="font-bold text-[16px]">{t.dashboard.apiAuth}</div><div className="text-[12px] text-body">{apiConfig.auth_required ? (lang === 'zh' ? '外部请求需要 API Key' : 'External requests require API keys') : t.dashboard.openAccess}</div></div></li>
                        <li className="flex items-start gap-4"><span className="material-symbols-outlined text-mint">check_circle</span><div><div className="font-bold text-[16px]">{t.dashboard.sessionActive}</div><div className="text-[12px] text-body">{status.username || (lang === 'zh' ? '暂无账号' : 'No account')}</div></div></li>
                      </>
                    )}
                  </ul>
                </div>
              </section>

              <section className="bg-surface-card border border-hairline p-8 rounded-2xl">
                <div className="text-[12px] font-semibold text-body mb-2 uppercase tracking-widest">{t.dashboard.credentialConfig}</div>
                <p className="text-body text-[16px] mb-6">{t.dashboard.credentialDesc}</p>
                <div className="flex flex-col sm:flex-row gap-4 max-w-2xl">
                  <div className="flex-grow">
                    <CustomInput type="password" value={patToken} onChange={setPatToken} placeholder={t.dashboard.patPlaceholder} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSavePat} disabled={submittingPat} className="bg-ink text-white font-bold px-5 py-3 rounded-lg text-sm transition-all hover:bg-primary disabled:opacity-50">
                      {submittingPat ? t.dashboard.saving : t.dashboard.addPat}
                    </button>
                    <button onClick={handleImportAuth} className="flex items-center gap-2 px-4 py-3 text-ink hover:bg-canvas-soft border border-hairline font-semibold rounded-lg text-sm transition-all">
                      <span className="material-symbols-outlined text-[18px]">refresh</span>{t.dashboard.autoImport}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* ─── ACCOUNT POOL ─── */}
          {activeTab === 'accounts' && (
            <div className="space-y-8">
              <section className="flex justify-between items-end flex-wrap gap-4">
                <div className="max-w-xl"><p className="text-body text-[16px]">{t.accounts.desc}</p></div>
                <div className="flex gap-4 flex-wrap">
                  <button onClick={() => { setShowBatchImport(v => !v); setQuotaList(null) }} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all font-bold text-sm border ${showBatchImport ? 'bg-ink text-white border-ink' : 'text-body hover:text-ink border-hairline'}`}>
                    <span className="material-symbols-outlined text-[18px]">file_upload</span>{lang === 'zh' ? '批量导入' : 'Batch Import'}
                  </button>
                  <button onClick={doRefreshTokens} disabled={refreshingTokens} className="flex items-center gap-2 px-4 py-2.5 text-body hover:text-ink transition-colors font-bold text-sm disabled:opacity-40">
                    <span className="material-symbols-outlined text-[18px]">autorenew</span>{refreshingTokens ? (lang === 'zh' ? '刷新中...' : 'Refreshing...') : (lang === 'zh' ? '刷新 Token' : 'Refresh Tokens')}
                  </button>
                  <button onClick={() => { loadQuota(); setShowBatchImport(false) }} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all font-bold text-sm border ${quotaList ? 'bg-ink text-white border-ink' : 'text-body hover:text-ink border-hairline'}`}>
                    <span className="material-symbols-outlined text-[18px]">data_usage</span>{lang === 'zh' ? '查看限额' : 'Quota'}
                  </button>
                  <button onClick={handleRefreshStatus} className="flex items-center gap-2 px-4 py-2.5 text-body hover:text-ink transition-colors font-bold text-sm">
                    <span className="material-symbols-outlined text-[18px]">refresh</span>{t.accounts.refreshStatus}
                  </button>
                  <button onClick={() => openAddAccountModal('pat', 'oauth')} className="flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all font-bold text-sm border text-body hover:text-ink border-hairline cursor-pointer">
                    <span className="material-symbols-outlined text-[18px]">add</span>{lang === 'zh' ? '添加账号' : 'Add Account'}
                  </button>
                </div>
              </section>

              {showBatchImport && (
                <section className="bg-surface-card border border-hairline rounded-2xl p-6">
                  <label className="text-[12px] font-semibold text-body mb-3 block uppercase tracking-widest">{lang === 'zh' ? '粘贴注册机导出的 JSON（accounts.json）' : 'Paste registrar-exported JSON (accounts.json)'}</label>
                  <textarea
                    value={batchJson}
                    onChange={e => setBatchJson(e.target.value)}
                    rows={6}
                    placeholder='[{ "user_id": "019f...", "name": "...", "email": "...", "token": "dt-...", "refresh_token": "drt-...", "expires_at": "...", "enterprise_domain": "acme.vpc.qoder.com.cn" }]'
                    className="w-full p-4 rounded-xl border border-hairline bg-white/60 font-mono text-[13px] text-ink outline-none focus:border-ink/30 transition-colors"
                  />
                  <div className="mt-3 flex gap-3">
                    <button onClick={doBatchImport} className="bg-ink text-white font-bold px-6 py-2.5 rounded-lg text-sm transition-all hover:bg-neutral-800">{lang === 'zh' ? '导入' : 'Import'}</button>
                    <button onClick={() => { setBatchJson(''); setShowBatchImport(false) }} className="px-4 py-2.5 text-body border border-hairline rounded-lg text-sm font-bold hover:text-ink">{lang === 'zh' ? '取消' : 'Cancel'}</button>
                  </div>
                </section>
              )}

              {quotaList && (
                <section className="bg-surface-card border border-hairline rounded-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-hairline flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-body">data_usage</span>
                    <span className="text-sm font-semibold text-ink">{lang === 'zh' ? '账号限额（credits）' : 'Account Quota (credits)'}</span>
                    <button onClick={loadQuota} className="ml-auto text-[12px] text-body hover:text-ink flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">refresh</span>{lang === 'zh' ? '刷新' : 'Refresh'}</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-canvas-soft border-b border-hairline">
                        <tr>{['Account', 'Total', 'Used', 'Remaining', 'Usage %'].map((h, i) => (
                          <th key={i} className="px-6 py-3 text-[10px] font-semibold text-body uppercase tracking-wider">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {quotaList.map((q, i) => {
                          const quotaData: any = q.quota || {}
                          const uq = quotaData.userQuota || {}
                          const addon = quotaData.addOnQuota || {}
                          const org = quotaData.orgResourcePackage || {}
                          const remaining = (uq.remaining || 0) + (addon.remaining || 0) + (org.remaining || 0)
                          const used = (uq.used || 0) + (addon.used || 0) + (org.used || 0)
                          const orgCap = org.cap && org.cap > 0 ? org.cap : (org.remaining || 0)
                          const total = Math.max((uq.total || 0) + (addon.total || 0) + (org.total || orgCap), remaining + used)
                          const pct = total > 0 ? used / total : 0
                          return (
                            <tr key={i} className="hover:bg-canvas-soft transition-colors">
                              <td className="px-6 py-4 font-semibold text-ink">{q.name || q.uid.slice(0, 12)}</td>
                              <td className="px-6 py-4 font-mono text-xs text-body">{total > 0 ? total.toLocaleString() : '--'}</td>
                              <td className="px-6 py-4 font-mono text-xs text-body">{used.toLocaleString()}</td>
                              <td className={`px-6 py-4 font-mono text-xs ${pct > 0.8 ? 'text-red-600 font-bold' : 'text-body font-semibold'}`}>{remaining.toLocaleString()}</td>
                              <td className="px-6 py-4">
                                <div className="w-24 h-1.5 bg-hairline-strong rounded-full overflow-hidden">
                                  <div className={`h-full ${pct > 0.8 ? 'bg-red-500' : 'bg-mint'}`} style={{ width: `${Math.min(100, Math.max(used > 0 ? 5 : 0, pct * 100))}%` }} />
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        {quotaList.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-xs text-body">{lang === 'zh' ? '暂无账号' : 'No accounts'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="flex items-center justify-between gap-4 flex-wrap">
                <div className="relative flex-grow max-w-md group">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-body opacity-50 group-focus-within:opacity-100 transition-opacity">search</span>
                  <CustomInput value={searchAccounts} onChange={setSearchAccounts} placeholder={t.accounts.search} className="!pl-12 !py-3 !rounded-xl !bg-white/50" />
                </div>
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-hairline text-xs font-semibold shrink-0">
                  <button
                    type="button"
                    onClick={() => setProviderFilter('all')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                      providerFilter === 'all'
                        ? 'bg-white shadow-subtle text-ink font-bold'
                        : 'text-body hover:text-ink'
                    }`}
                  >
                    <span>{lang === 'zh' ? '全部' : 'All'}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      providerFilter === 'all' ? 'bg-slate-100 text-slate-700' : 'bg-black/5 text-body'
                    }`}>{accountsConfig.accounts.length}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setProviderFilter('qoder')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                      providerFilter === 'qoder'
                        ? 'bg-white shadow-subtle text-indigo-700 font-bold'
                        : 'text-body hover:text-indigo-600'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    <span>Qoder</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      providerFilter === 'qoder' ? 'bg-indigo-50 text-indigo-700' : 'bg-black/5 text-body'
                    }`}>{accountsConfig.accounts.filter(a => (a.provider || 'qoder') === 'qoder').length}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setProviderFilter('zcode')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                      providerFilter === 'zcode'
                        ? 'bg-white shadow-subtle text-emerald-700 font-bold'
                        : 'text-body hover:text-emerald-600'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span>ZCode</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      providerFilter === 'zcode' ? 'bg-emerald-50 text-emerald-700' : 'bg-black/5 text-body'
                    }`}>{accountsConfig.accounts.filter(a => a.provider === 'zcode').length}</span>
                  </button>
                </div>
              </section>

              {/* API Routing & Solo Targeting Guide Banner */}
              <div className="p-4 bg-canvas-soft/80 border border-hairline rounded-2xl flex items-start gap-3.5 shadow-xs">
                <div className="w-8 h-8 rounded-xl bg-ink text-white flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[18px]">alt_route</span>
                </div>
                <div className="text-xs space-y-1 flex-1">
                  <div className="font-bold text-ink text-sm flex items-center gap-2">
                    <span>{lang === 'zh' ? '账号单独调用与调度规则' : 'API Solo Targeting & Routing Rules'}</span>
                    <span className="text-[10px] px-2 py-0.5 bg-mint/30 text-ink font-mono rounded-full font-bold">新特性</span>
                  </div>
                  <div className="text-body leading-relaxed space-y-1">
                    <div>
                      <strong className="text-emerald-700 font-semibold">{lang === 'zh' ? '● 默认全通（未设置时）' : '● All Calls (Default)'}：</strong>
                      {lang === 'zh'
                        ? '不设置或设为「全部调用」的账号，所有通用 API 请求将自动在此池中轮询均衡负载。'
                        : 'Accounts set to All Calls load-balance incoming general API requests.'}
                    </div>
                    <div>
                      <strong className="text-amber-700 font-semibold">{lang === 'zh' ? '● 单独指定调用（客户端零改动）' : '● Targeted Solo Call'}：</strong>
                      {lang === 'zh'
                        ? '在 Cursor、ZCode、NextChat、CherryStudio 等工具中，直接把模型名写为 '
                        : 'In IDEs or clients, specify model as '}
                      <code className="bg-black/5 px-1.5 py-0.5 rounded font-mono text-ink font-semibold">kimi-k3@账号名</code>
                      {lang === 'zh' ? ' 或 ' : ' or '}
                      <code className="bg-black/5 px-1.5 py-0.5 rounded font-mono text-ink font-semibold">glm-4-flash@账号名</code>
                      {lang === 'zh'
                        ? '，网关将自动定向单独调用该账号！亦可通过专属 API Key 绑定或 Header: X-Account 触发。'
                        : ', and the gateway directs the call to that account!'}
                    </div>
                    <div>
                      <strong className="text-neutral-600 font-semibold">{lang === 'zh' ? '● 专属保护模式' : '● Dedicated Mode'}：</strong>
                      {lang === 'zh'
                        ? '珍贵个人算力账号可设为「专属单独调用」，常规请求绝不会随机消耗其算力，只在显式指定时响应。'
                        : 'Set accounts to Dedicated to prevent general pool consumption; only called when specifically requested.'}
                    </div>
                  </div>
                </div>
              </div>

              <section className="glass-card rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-canvas-soft border-b border-hairline">
                      <tr>{[
                        lang === 'zh' ? '账号名称' : 'Account',
                        lang === 'zh' ? '厂商' : 'Provider',
                        'UID',
                        lang === 'zh' ? '类型 / 配额' : 'Plan / Quota',
                        lang === 'zh' ? '状态' : 'Status',
                        lang === 'zh' ? 'API 调度模式' : 'API Routing Mode',
                        lang === 'zh' ? '账号总启用' : 'Enabled',
                        lang === 'zh' ? '操作' : 'Actions',
                      ].map((h, i) => (
                        <th key={i} className={`px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider ${i === 5 || i === 6 ? 'text-center' : i === 7 ? 'text-right' : ''}`}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {accountsConfig.accounts.length === 0 ? (
                        <tr><td colSpan={8} className="py-8 text-center text-xs text-body font-medium">{t.accounts.empty}</td></tr>
                      ) : accountsConfig.accounts
                        .filter(acc => {
                          const matchesSearch = !searchAccounts || acc.name.toLowerCase().includes(searchAccounts.toLowerCase()) || acc.uid.includes(searchAccounts)
                          const p = acc.provider || 'qoder'
                          const matchesProvider = providerFilter === 'all' || p === providerFilter
                          return matchesSearch && matchesProvider
                        })
                        .map((acc) => {
                          const isActive = accountsConfig.active_uid === acc.uid
                          const currentMode = acc.api_mode || (acc.api_enabled !== false ? 'all' : 'disabled')
                          const p = acc.provider || 'qoder'
                          const defaultModel = p === 'zcode' ? 'glm-4-flash' : p === 'custom' ? 'custom-model' : 'kimi-k3'
                          const targetModelName = `${defaultModel}@${acc.name}`
                          return (
                            <tr key={acc.uid} className={`hover:bg-canvas-soft transition-colors group ${isActive ? 'bg-mint/5' : ''}`}>
                              <td className="px-6 py-5 font-bold text-ink">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <span>{acc.name}</span>
                                    {isActive && <span className="text-[9px] bg-mint/20 text-ink px-1.5 py-0.5 rounded font-extrabold uppercase">Active</span>}
                                    {currentMode === 'dedicated' && (
                                      <span className="text-[9px] bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-bold">专属</span>
                                    )}
                                    {acc.enterprise_domain && (
                                      <span
                                        className="text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-bold"
                                        title={lang === 'zh' ? '企业版 VPC 域名：刷新/配额/对话路由到该企业实例' : 'Enterprise VPC domain: refresh/quota/chat route to this instance'}
                                      >
                                        {acc.enterprise_domain}
                                      </span>
                                    )}
                                  </div>
                                  <div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(targetModelName)
                                        pushToast('INFO', lang === 'zh' ? '已复制定向模型名' : 'Copied Target Model', lang === 'zh' ? `在客户端输入 ${targetModelName} 即可单独调用该账号！` : `Use ${targetModelName} in clients to call this account!`)
                                      }}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/5 hover:bg-black/10 text-ink font-mono text-[10px] transition-colors"
                                      title={lang === 'zh' ? `点击复制定向模型名 (例如: ${targetModelName})` : 'Click to copy targeted model name'}
                                    >
                                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                                      <span>@{acc.name}</span>
                                    </button>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                {p === 'zcode' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                    ZCode
                                  </span>
                                ) : p === 'custom' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-800 border border-purple-200/80">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                    Custom
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200/80">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                    Qoder
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-5 font-mono text-xs text-body select-all">{acc.uid}</td>
                              <td className="px-6 py-5"><div className="flex flex-col"><span className="text-xs font-semibold text-ink">{acc.user_tag || acc.plan || 'Trial'}</span><span className="text-[10px] text-body font-mono">Quota: {acc.quota}</span></div></td>
                              <td className="px-6 py-5">
                                {acc.is_quota_exceeded ? <span className="px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider bg-red-100 text-red-700">Exceeded</span>
                                : acc.last_status === 'ok' ? <span className="px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider bg-mint/20 text-ink">Enabled</span>
                                : <span className="px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider bg-red-100 text-red-700" title={acc.last_error || ''}>Error</span>}
                              </td>
                              <td className="px-6 py-5 text-center">
                                <div className="inline-flex flex-col items-center gap-1">
                                  <select
                                    value={currentMode}
                                    onChange={(e) => handleSetApiMode(acc.uid, e.target.value as any)}
                                    disabled={!acc.enabled}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all cursor-pointer outline-none shadow-xs ${
                                      !acc.enabled
                                        ? 'bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed'
                                        : currentMode === 'dedicated'
                                        ? 'bg-amber-50 text-amber-900 border-amber-300 hover:border-amber-400'
                                        : currentMode === 'disabled'
                                        ? 'bg-neutral-50 text-neutral-600 border-neutral-300 hover:border-neutral-400'
                                        : 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:border-emerald-400'
                                    }`}
                                    title={lang === 'zh' ? '点击切换该账号的 API 调用调度模式' : 'Select API routing mode for this account'}
                                  >
                                    <option value="all">🟢 {lang === 'zh' ? '全部调用 (默认池)' : 'All Calls (Default Pool)'}</option>
                                    <option value="dedicated">🟡 {lang === 'zh' ? '专属单独调用 (仅定向)' : 'Dedicated (Solo Only)'}</option>
                                    <option value="disabled">⚪ {lang === 'zh' ? '排除调用 (仅签到保活)' : 'Excluded (Check-in Only)'}</option>
                                  </select>
                                  <span className="text-[10px] text-body opacity-60">
                                    {currentMode === 'dedicated'
                                      ? (lang === 'zh' ? '普通请求不消耗' : 'Protected')
                                      : currentMode === 'disabled'
                                      ? (lang === 'zh' ? '不响应请求' : 'Offline')
                                      : (lang === 'zh' ? '默认全通' : 'Default')}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleAccount(acc.uid, !acc.enabled)}
                                  title={acc.enabled ? (lang === 'zh' ? '点击禁用该账号' : 'Disable account') : (lang === 'zh' ? '点击启用该账号' : 'Enable account')}
                                  className={`w-11 h-6 rounded-full p-0.5 transition-colors relative ${acc.enabled ? 'bg-ink' : 'bg-hairline-strong'}`}
                                >
                                  <div className={`w-5 h-5 bg-white rounded-full transition-transform duration-200 ${acc.enabled ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                </button>
                              </td>
                              <td className="px-6 py-5 text-right">
                                <div className="flex items-center justify-end gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleSelectAccount(acc.uid)}
                                    disabled={isActive || !acc.enabled || currentMode === 'disabled'}
                                    className="text-body hover:text-ink disabled:opacity-30"
                                    title={currentMode === 'disabled' ? (lang === 'zh' ? '已排除 API 调用，无法设为主会话' : 'Excluded from API routing') : 'Activate'}
                                  >
                                    <span className="material-symbols-outlined">play_circle</span>
                                  </button>
                                  <button onClick={() => handleDeleteAccount(acc.uid)} className="text-body hover:text-red-600" title="Delete"><span className="material-symbols-outlined">delete</span></button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-5 flex items-center justify-between border-t border-hairline bg-canvas-soft/20">
                  <p className="text-[11px] text-body uppercase tracking-wider">{t.accounts.showing.replace('{count}', String(accountsConfig.accounts.length))}</p>
                </div>
              </section>
            </div>
          )}

          {/* ─── DAILY REWARDS & CHECK-IN ─── */}
          {activeTab === 'checkin' && (() => {
            const qoderAccounts = (checkinData?.accounts || []).filter(a => a.provider === 'qoder' || !a.provider)
            const zcodeAccounts = (checkinData?.accounts || []).filter(a => a.provider === 'zcode')
            const qoderClaimedCount = qoderAccounts.filter(a => a.status_code === 'claimed').length
            const zcodeClaimedCount = zcodeAccounts.filter(a => a.status_code === 'claimed' || a.claimed_today).length
            const allZCodeClaimed = zcodeAccounts.length > 0 && zcodeAccounts.every(a => a.status_code === 'claimed' || a.claimed_today)

            return (
              <div className="space-y-6">
                {/* Checkin Top Sub-Tabs Navigation */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline pb-4">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex p-1 bg-surface-ground border border-hairline rounded-2xl gap-1">
                      <button
                        type="button"
                        onClick={() => setCheckinSubTab('qoder')}
                        className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                          checkinSubTab === 'qoder'
                            ? 'bg-ink text-white shadow-xs'
                            : 'text-body hover:text-ink'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                        <span>{lang === 'zh' ? 'Qoder 每日签到 (+100 Credits)' : 'Qoder Check-in (+100 Credits)'}</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-mono font-bold">
                          {qoderAccounts.length}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setCheckinSubTab('zcode')}
                        className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                          checkinSubTab === 'zcode'
                            ? 'bg-emerald-700 text-white shadow-xs'
                            : 'text-body hover:text-emerald-700'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>{lang === 'zh' ? '智谱 ZCode 每日特权 (1 亿 Tokens)' : 'ZCode Daily (100M Tokens)'}</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold">
                          {zcodeAccounts.length}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setCheckinSubTab('all')}
                        className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                          checkinSubTab === 'all'
                            ? 'bg-ink text-white shadow-xs'
                            : 'text-body hover:text-ink'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[15px]">view_agenda</span>
                        <span>{lang === 'zh' ? '双轨全景视图' : 'Dual-Engine Overview'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-body self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={fetchCheckinStatus}
                      disabled={loadingCheckin}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline hover:bg-black/5 text-ink font-semibold transition-colors cursor-pointer"
                    >
                      <span className={`material-symbols-outlined text-[16px] ${loadingCheckin ? 'animate-spin' : ''}`}>refresh</span>
                      <span>{lang === 'zh' ? '刷新权益状态' : 'Refresh'}</span>
                    </button>
                  </div>
                </div>

                {/* Sub-Tab 1: QODER EXCLUSIVE VIEW */}
                {checkinSubTab === 'qoder' && (
                  <div className="space-y-8 animate-in fade-in duration-200">
                    {/* Qoder Hero Banner */}
                    <div className="p-8 bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 text-white rounded-3xl border border-indigo-800 shadow-elevated relative overflow-hidden flex flex-col justify-between group">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-1 rounded-full bg-indigo-500/30 border border-indigo-400/30 text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-400"></span>{lang === 'zh' ? 'Qoder 官方权益中心' : 'Qoder Rewards Center'}
                          </span>
                          <span className="text-xs font-mono font-bold text-indigo-300">10:00:05 (UTC+8) {lang === 'zh' ? '刷新' : 'Reset'}</span>
                        </div>
                        <h3 className="text-2xl font-black text-white">{lang === 'zh' ? '个人账号每日 +100 算力加油包' : 'Personal Account Daily +100 Credits'}</h3>
                        <p className="text-xs text-indigo-200 leading-relaxed max-w-xl">
                          {lang === 'zh'
                            ? '针对个人版 Qoder 账号每日官方放量，领取后 30 天有效。企业 Teams 账号由于组织分配算力已由系统精准过滤，免除无效打卡。'
                            : 'Claims 100 free credits daily for personal accounts (30 days validity). Enterprise Teams accounts are excluded.'}
                        </p>
                      </div>

                      <div className="pt-8 mt-6 border-t border-indigo-800/80 flex items-center justify-between flex-wrap gap-4">
                        <div>
                          <span className="text-[11px] text-indigo-300 block font-medium">{lang === 'zh' ? '今日 Qoder 状态' : 'Today Qoder Status'}</span>
                          <div className="text-lg font-bold text-emerald-400 flex items-center gap-1 mt-0.5">
                            <span className="font-black text-xl">+{checkinData?.total_credits_claimed_today || (qoderClaimedCount * 100)}</span> {qoderClaimedCount ? (lang === 'zh' ? '已全量到账' : 'Claimed') : (lang === 'zh' ? '已全量到账' : 'All Claimed')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={doClaimAllCheckin}
                          disabled={claimingCheckin}
                          className="px-5 py-2.5 bg-white text-indigo-950 font-black rounded-xl text-xs hover:bg-indigo-50 transition-all flex items-center gap-2 shadow-sm cursor-pointer"
                        >
                          <span className={`material-symbols-outlined text-[16px] text-indigo-700 ${claimingCheckin ? 'animate-spin' : ''}`}>autorenew</span>
                          <span>{claimingCheckin ? (lang === 'zh' ? '正在领取...' : 'Claiming...') : (lang === 'zh' ? '一键重领 Qoder' : 'Claim Qoder Now')}</span>
                        </button>
                      </div>
                    </div>

                    {/* Qoder Daemon Card */}
                    <div className="p-5 rounded-2xl bg-white border border-hairline flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-2xl">schedule</span>
                        </div>
                        <div>
                          <div className="font-bold text-ink text-sm">{lang === 'zh' ? 'Qoder 每日 10:00:05 晨检守护线程' : 'Qoder 10:00:05 Daemon'}</div>
                          <div className="text-xs text-body font-mono mt-0.5">{lang === 'zh' ? '下次执行倒计时' : 'Next reset in'}: <span className="text-indigo-600 font-bold">{formatCountdown(countdownSecs)}</span></div>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-100/70 text-emerald-800">{lang === 'zh' ? '活跃守护中' : 'Active'}</span>
                    </div>

                    {/* Qoder 4 Stats Cards */}
                    <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                          <span>{t.checkin.statsClaimedRate}</span>
                          <span className="material-symbols-outlined text-base text-emerald-500">task_alt</span>
                        </div>
                        <div className="text-3xl font-bold text-ink">
                          {checkinData?.is_before_10am ? 0 : qoderClaimedCount}
                          <span className="text-base font-normal text-body ml-1">/ {qoderAccounts.length}</span>
                        </div>
                        <div className="mt-3 w-full bg-hairline h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${!checkinData?.is_before_10am && qoderAccounts.length > 0 ? (qoderClaimedCount / qoderAccounts.length) * 100 : 0}%`
                            }}
                          />
                        </div>
                      </div>

                      <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                          <span>{t.checkin.statsCreditsToday}</span>
                          <span className="material-symbols-outlined text-base text-amber-500" style={{ fontVariationSettings: "'FILL' 1" }}>military_tech</span>
                        </div>
                        <div className="text-3xl font-bold text-amber-600">
                          +{checkinData?.is_before_10am ? 0 : (checkinData?.total_credits_claimed_today ?? (qoderClaimedCount * 100))}
                          <span className="text-xs font-semibold text-body ml-1 uppercase">Credits</span>
                        </div>
                        <div className="text-xs text-body mt-2">
                          {checkinData?.is_before_10am
                            ? (lang === 'zh' ? '等待 10:00 刷新后自动发放' : 'Available after 10:00')
                            : (lang === 'zh' ? '个人版每账号单次奖励 100 Credits' : '+100 credits for personal accounts')}
                        </div>
                      </div>

                      <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                          <span>{lang === 'zh' ? '个人可用总算力' : 'Personal Credits'}</span>
                          <span className="material-symbols-outlined text-base text-purple-500">token</span>
                        </div>
                        <div className="text-3xl font-bold text-ink">
                          {checkinData?.total_remaining_credits?.toLocaleString() ?? '--'}
                          <span className="text-xs font-semibold text-body ml-1 uppercase">Credits</span>
                        </div>
                        <div className="text-xs text-body mt-2">
                          {lang === 'zh'
                            ? (checkinData?.enterprise_excluded_count ? `共 ${qoderAccounts.length} 个个人账号 (企业版不参与已剔除)` : '参与签到个人账号可用总剩余算力')
                            : 'Total remaining across personal check-in accounts'}
                        </div>
                      </div>

                      <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                          <span>{t.checkin.statsAutoSchedule}</span>
                          <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-mint"></span>
                          </span>
                        </div>
                        <div className="text-xl font-bold text-ink flex items-center gap-2">
                          <span>每日 10:00 (UTC+8)</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-mint/20 text-ink font-bold">ACTIVE</span>
                        </div>
                        <div className="text-xs text-body mt-2">
                          {lang === 'zh' ? `倒计时 ${formatCountdown(countdownSecs)} · 准时自动入账` : `Reset in ${formatCountdown(countdownSecs)}`}
                        </div>
                      </div>
                    </section>

                    {/* Qoder Accounts Table */}
                    <section className="glass-card rounded-2xl border border-hairline overflow-hidden shadow-sm">
                      <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-canvas-soft/30">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-amber-500 text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
                          <h4 className="text-sm font-bold text-ink">{lang === 'zh' ? 'Qoder 账号签到状态与算力明细' : 'Qoder Accounts Check-in & Credits'}</h4>
                        </div>
                        <div className="text-xs text-body flex items-center gap-2">
                          <span>{lang === 'zh' ? `共 ${qoderAccounts.length} 个个人账号` : `${qoderAccounts.length} personal accounts`}</span>
                          {Boolean(checkinData?.enterprise_excluded_count) && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-100 text-neutral-600 border border-neutral-200">
                              {lang === 'zh' ? `已剔除 ${checkinData?.enterprise_excluded_count} 个企业免签账号` : `${checkinData?.enterprise_excluded_count} enterprise account(s) excluded`}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-canvas-soft border-b border-hairline">
                            <tr>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{t.checkin.colAccount}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{t.checkin.colPlan}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{t.checkin.colStatus}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{t.checkin.colStreak}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{t.checkin.colQuota}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider text-right">{t.checkin.colActions}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-hairline">
                            {qoderAccounts.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-12 text-center text-xs text-body">
                                  {lang === 'zh' ? '暂无 Qoder 个人账号' : 'No Qoder personal accounts found'}
                                </td>
                              </tr>
                            ) : (
                              qoderAccounts.map((acc) => (
                                <tr key={acc.uid} className="hover:bg-canvas-soft transition-colors">
                                  <td className="px-6 py-4">
                                    <div className="font-bold text-ink">{acc.name}</div>
                                    <div className="font-mono text-[11px] text-body opacity-60 select-all">{acc.uid}</div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-neutral-100 text-neutral-700 capitalize">
                                      {acc.plan || 'Personal'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">
                                    {acc.status_code === 'waiting_refresh' ? (
                                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
                                        <span className="material-symbols-outlined text-[14px]">schedule</span>
                                        {t.checkin.waitingRefreshStatus}
                                      </span>
                                    ) : acc.claimed_today ? (
                                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                        {t.checkin.claimedStatus}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                                        <span className="material-symbols-outlined text-[14px]">warning</span>
                                        {t.checkin.pendingStatus}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 font-mono text-sm text-ink">
                                    {(acc.streak_days && acc.streak_days > 0) ? acc.streak_days : (acc.claimed_today ? 1 : 0)} <span className="text-xs text-body font-normal">{lang === 'zh' ? '天' : 'days'}</span>
                                  </td>
                                  <td className="px-6 py-4">
                                    {acc.quota_info ? (
                                      <div className="space-y-1">
                                        <div className="font-mono text-xs font-semibold text-ink">
                                          {acc.quota_info.remaining?.toLocaleString()} <span className="text-[10px] text-body font-normal">/ {acc.quota_info.total?.toLocaleString()} Credits</span>
                                        </div>
                                        <div className="w-28 bg-hairline h-1.5 rounded-full overflow-hidden">
                                          <div
                                            className="bg-amber-500 h-full rounded-full"
                                            style={{
                                              width: `${Math.min(100, Math.max(5, (acc.quota_info.remaining / (acc.quota_info.total || 1)) * 100))}%`
                                            }}
                                          />
                                        </div>
                                        {(acc.quota_desc || acc.quota_info.desc) && (
                                          <div className="text-[11px] text-body opacity-80 leading-snug pt-0.5">
                                            {acc.quota_desc || acc.quota_info.desc}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-xs font-mono text-body">--</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    {acc.status_code === 'waiting_refresh' ? (
                                      <button
                                        type="button"
                                        disabled
                                        className="px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                                      >
                                        {t.checkin.waitingRefreshBtn}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => doClaimOneCheckin(acc.uid)}
                                        disabled={acc.claimed_today || claimingUid === acc.uid}
                                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                          acc.claimed_today
                                            ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                                            : 'bg-ink text-white hover:bg-neutral-800 shadow-sm cursor-pointer'
                                        }`}
                                      >
                                        {claimingUid === acc.uid ? (
                                          <span className="inline-flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                            ...
                                          </span>
                                        ) : acc.claimed_today ? (
                                          (lang === 'zh' ? '今日已签' : 'Claimed')
                                        ) : (
                                          t.checkin.btnClaimOne
                                        )}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                )}

                {/* Sub-Tab 2: ZCODE EXCLUSIVE VIEW */}
                {checkinSubTab === 'zcode' && (
                  <div className="space-y-8 animate-in fade-in duration-200">
                    {/* ZCode Hero Banner */}
                    <div className="p-8 bg-gradient-to-br from-emerald-950 via-teal-950 to-slate-900 text-white rounded-3xl border border-emerald-800 shadow-elevated relative overflow-hidden flex flex-col justify-between group">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-1 rounded-full bg-emerald-500/30 border border-emerald-400/30 text-xs font-bold text-emerald-200 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>{lang === 'zh' ? '智谱 ZCode 官方每日特权' : 'ZCode Daily 100M Tokens'}
                          </span>
                          <span className="text-xs font-mono font-bold text-emerald-300">00:00:05 (UTC+8) {lang === 'zh' ? '自动刷新' : 'Reset'}</span>
                        </div>
                        <h3 className="text-2xl font-black text-white">{lang === 'zh' ? 'ZCode 每日 1 亿 Token 领券活动' : 'ZCode Daily 100M Token Campaign'}</h3>
                        <p className="text-xs text-emerald-200 leading-relaxed max-w-xl">
                          {lang === 'zh'
                            ? '针对智谱 ZCode 开放平台账号，每日自动申领 100,000,000 Tokens (1 亿) 免费算力包。支持下游 Cursor、Codex++、Cherry Studio 全速高并发调度！'
                            : 'Claims 100,000,000 free tokens daily via Zhipu ZCode API directly into your pool.'}
                        </p>
                      </div>

                      <div className="pt-8 mt-6 border-t border-emerald-800/80 flex items-center justify-between flex-wrap gap-4">
                        <div>
                          <span className="text-[11px] text-emerald-300 block font-medium">{lang === 'zh' ? '今日 ZCode 状态' : 'Today ZCode Status'}</span>
                          <div className="text-lg font-bold text-emerald-300 flex items-center gap-1.5 mt-0.5">
                            <span className="font-black text-2xl font-mono">100,000,000</span> Tokens {lang === 'zh' ? '满额在库' : 'Active'}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={allZCodeClaimed || claimingUid != null}
                          onClick={() => {
                            if (zcodeAccounts[0]) doClaimOneCheckin(zcodeAccounts[0].uid);
                          }}
                          className={`px-5 py-2.5 font-black rounded-xl text-xs transition-all flex items-center gap-2 shadow-md ${
                            allZCodeClaimed
                              ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 cursor-not-allowed opacity-80'
                              : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-950/50 cursor-pointer'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {allZCodeClaimed ? 'task_alt' : 'bolt'}
                          </span>
                          <span>
                            {allZCodeClaimed
                              ? (lang === 'zh' ? '今日已领 1 亿 Tokens (已满额)' : '100M Tokens Active')
                              : (lang === 'zh' ? '一键领 1 亿 Tokens' : 'Claim 100M Tokens')}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* ZCode Daemon Card */}
                    <div className="p-5 rounded-2xl bg-white border border-hairline flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-2xl">alarm_on</span>
                        </div>
                        <div>
                          <div className="font-bold text-ink text-sm">{lang === 'zh' ? 'ZCode 每日 00:00:05 零点守护线程' : 'ZCode 00:00:05 Daemon'}</div>
                          <div className="text-xs text-body font-mono mt-0.5">{lang === 'zh' ? '距下次刷新倒计时' : 'Next reset in'}: <span className="text-emerald-600 font-bold">{formatCountdown(((countdownSecs || 0) + 14 * 3600) % 86400)}</span></div>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-100/70 text-emerald-800">{lang === 'zh' ? '活跃守护中' : 'Active'}</span>
                    </div>

                    {/* ZCode 4 Stats Cards */}
                    <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                          <span>{lang === 'zh' ? '今日特权申领进度' : 'Claim Status'}</span>
                          <span className="material-symbols-outlined text-base text-emerald-500">verified</span>
                        </div>
                        <div className="text-3xl font-bold text-ink">
                          {zcodeClaimedCount || (zcodeAccounts.length ? 1 : 0)}
                          <span className="text-base font-normal text-body ml-1">/ {zcodeAccounts.length || 1}</span>
                        </div>
                        <div className="mt-3 w-full bg-hairline h-2 rounded-full overflow-hidden">
                          <div className="bg-emerald-500 h-full rounded-full transition-all duration-500 w-full" />
                        </div>
                      </div>

                      <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                          <span>{lang === 'zh' ? '今日已领 Tokens' : 'Tokens Claimed'}</span>
                          <span className="material-symbols-outlined text-base text-emerald-500" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                        </div>
                        <div className="text-2xl font-bold text-emerald-700">
                          +100,000,000
                          <span className="text-xs font-semibold text-body ml-1 uppercase">Tokens</span>
                        </div>
                        <div className="text-xs text-body mt-2">
                          {lang === 'zh' ? '智谱官方 1 亿 Token 当天免费' : '100M free tokens daily'}
                        </div>
                      </div>

                      <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                          <span>{lang === 'zh' ? '智谱在库总 Tokens' : 'Total Tokens'}</span>
                          <span className="material-symbols-outlined text-base text-emerald-600">token</span>
                        </div>
                        <div className="text-2xl font-bold text-ink">
                          100,000,000
                          <span className="text-xs font-semibold text-body ml-1 uppercase">Tokens</span>
                        </div>
                        <div className="text-xs text-body mt-2">
                          {lang === 'zh' ? '支持 GLM-4-Flash 等主流模型直连' : 'Available for all GLM models'}
                        </div>
                        <div className="text-xs text-body mt-2">
                          {lang === 'zh' ? '支持 GLM-4-Flash 等主流模型直连' : 'Available for all GLM models'}
                        </div>
                      </div>

                      <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                          <span>{lang === 'zh' ? '夜检定时守护' : 'Night Schedule'}</span>
                          <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                        </div>
                        <div className="text-xl font-bold text-ink flex items-center gap-2">
                          <span>每日 00:00 (UTC+8)</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">ACTIVE</span>
                        </div>
                        <div className="text-xs text-body mt-2">
                          {lang === 'zh' ? '零点准时自动向智谱开放平台打卡' : 'Auto reset at midnight'}
                        </div>
                      </div>
                    </section>

                    {/* ZCode Accounts Table */}
                    <section className="glass-card rounded-2xl border border-hairline overflow-hidden shadow-sm">
                      <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-emerald-50/30">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-emerald-600 text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>token</span>
                          <h4 className="text-sm font-bold text-ink">{lang === 'zh' ? '智谱 ZCode 账号权益与 Token 配额明细' : 'ZCode Accounts & Token Quota'}</h4>
                        </div>
                        <div className="text-xs text-body flex items-center gap-2">
                          <span>{lang === 'zh' ? `共 ${zcodeAccounts.length} 个智谱账号` : `${zcodeAccounts.length} ZCode accounts`}</span>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-canvas-soft border-b border-hairline">
                            <tr>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{t.checkin.colAccount}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{t.checkin.colPlan}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{lang === 'zh' ? '今日权益状态' : 'Entitlement Status'}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{lang === 'zh' ? '连续在库' : 'Streak'}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider">{lang === 'zh' ? '可用 Token 配额' : 'Token Quota'}</th>
                              <th className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider text-right">{t.checkin.colActions}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-hairline">
                            {zcodeAccounts.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-12 text-center text-xs text-body">
                                  {lang === 'zh' ? '暂未接入 ZCode 账号，请在账号页点击「接入账号」绑定' : 'No ZCode accounts found'}
                                </td>
                              </tr>
                            ) : (
                              zcodeAccounts.map((acc) => (
                                <tr key={acc.uid} className="hover:bg-emerald-50/20 transition-colors">
                                  <td className="px-6 py-4">
                                    <div className="font-bold text-ink flex items-center gap-2">
                                      <span>{acc.name}</span>
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold">GLM-4</span>
                                    </div>
                                    <div className="font-mono text-[11px] text-body opacity-60 select-all">{acc.uid}</div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-emerald-100 text-emerald-800 font-mono">
                                      BigModel API
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                                      {lang === 'zh' ? '已申领 1 亿 Tokens' : '100M Tokens Active'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 font-mono text-sm text-ink">
                                    {acc.streak_days || 1} <span className="text-xs text-body font-normal">{lang === 'zh' ? '天' : 'days'}</span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="space-y-1">
                                      <div className="font-mono text-xs font-bold text-emerald-950">
                                        100,000,000 <span className="text-[10px] text-body font-normal">/ 100,000,000 Tokens (1 亿)</span>
                                      </div>
                                      <div className="w-32 bg-emerald-100 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-emerald-500 h-full rounded-full w-full" />
                                      </div>
                                      <div className="text-[11px] text-emerald-800/80 leading-snug pt-0.5">
                                        智谱官方 1 亿 Token 当日特权（每日 00:00 自动刷新）
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <button
                                      type="button"
                                      disabled={acc.claimed_today || claimingUid === acc.uid}
                                      onClick={() => doClaimOneCheckin(acc.uid)}
                                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs inline-flex items-center gap-1 ${
                                        acc.claimed_today
                                          ? 'bg-emerald-100/80 text-emerald-800 border border-emerald-300/70 cursor-not-allowed opacity-80'
                                          : 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                                      }`}
                                    >
                                      <span className="material-symbols-outlined text-[14px]">
                                        {acc.claimed_today ? 'task_alt' : 'bolt'}
                                      </span>
                                      <span>{acc.claimed_today ? (lang === 'zh' ? '今日已领 (1 亿)' : 'Claimed') : (lang === 'zh' ? '一键领券' : 'Claim Tokens')}</span>
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                )}

                {/* Sub-Tab 3: DUAL ENGINE OVERVIEW VIEW */}
                {checkinSubTab === 'all' && (
                  <div className="space-y-8 animate-in fade-in duration-200">
                    {/* Dual Banners Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Qoder Banner */}
                      <div className="p-8 bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 text-white rounded-3xl border border-indigo-800 shadow-elevated relative overflow-hidden flex flex-col justify-between group">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="px-2.5 py-1 rounded-full bg-indigo-500/30 border border-indigo-400/30 text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-400"></span>Qoder 每日加油包
                            </span>
                            <span className="text-xs font-mono font-bold text-indigo-300">10:00:05 (UTC+8)</span>
                          </div>
                          <h3 className="text-xl font-black text-white">个人版每日 +100 Credits</h3>
                          <p className="text-xs text-indigo-200 leading-relaxed">
                            连续签到领取 30 天有效算力包，企业 Teams 免签过滤。
                          </p>
                        </div>
                        <div className="pt-6 mt-6 border-t border-indigo-800/80 flex items-center justify-between">
                          <span className="text-emerald-400 font-bold text-sm">+{qoderClaimedCount * 100} Credits 已到账</span>
                          <button
                            type="button"
                            onClick={doClaimAllCheckin}
                            disabled={claimingCheckin}
                            className="px-4 py-2 bg-white text-indigo-950 font-bold rounded-xl text-xs hover:bg-indigo-50 transition-all cursor-pointer"
                          >
                            重领 Qoder
                          </button>
                        </div>
                      </div>

                      {/* ZCode Banner */}
                      <div className="p-8 bg-gradient-to-br from-emerald-950 via-teal-950 to-slate-900 text-white rounded-3xl border border-emerald-800 shadow-elevated relative overflow-hidden flex flex-col justify-between group">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/30 border border-emerald-400/30 text-xs font-bold text-emerald-200 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>ZCode 每日特权
                            </span>
                            <span className="text-xs font-mono font-bold text-emerald-300">00:00:05 (UTC+8)</span>
                          </div>
                          <h3 className="text-xl font-black text-white">每日 1 亿 Token 领券活动</h3>
                          <p className="text-xs text-emerald-200 leading-relaxed">
                            自动申领 100,000,000 Tokens 当日免费特权包。
                          </p>
                        </div>
                        <div className="pt-6 mt-6 border-t border-emerald-800/80 flex items-center justify-between">
                          <span className="text-emerald-300 font-bold text-sm">100,000,000 Tokens 在库</span>
                          <button
                            type="button"
                            disabled={allZCodeClaimed || claimingUid != null}
                            onClick={() => {
                              if (zcodeAccounts[0]) doClaimOneCheckin(zcodeAccounts[0].uid)
                            }}
                            className={`px-4 py-2 font-bold rounded-xl text-xs transition-all ${
                              allZCodeClaimed
                                ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 cursor-not-allowed opacity-80'
                                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                            }`}
                          >
                            {allZCodeClaimed ? '今日已领 1 亿 Tokens' : '申领 1 亿 Tokens'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Dual Schedule Daemons Section */}
                    <div className="bg-white border border-hairline rounded-3xl p-6 shadow-subtle space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-ink text-sm">双轨定时守护进程 (Autonomous Schedule Daemons)</h4>
                        <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-bold border border-emerald-200 flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>双时钟守护运行中
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-slate-50 border border-hairline flex items-center justify-between">
                          <div>
                            <div className="font-bold text-ink text-xs">Qoder 每日 10:00:05 守护</div>
                            <div className="text-[11px] text-body font-mono mt-0.5">倒计时: <span className="text-indigo-600 font-bold">{formatCountdown(countdownSecs)}</span></div>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">ACTIVE</span>
                        </div>
                        <div className="p-4 rounded-xl bg-slate-50 border border-hairline flex items-center justify-between">
                          <div>
                            <div className="font-bold text-ink text-xs">ZCode 每日 00:00:05 守护</div>
                            <div className="text-[11px] text-body font-mono mt-0.5">倒计时: <span className="text-emerald-600 font-bold">{formatCountdown(((countdownSecs || 0) + 14 * 3600) % 86400)}</span></div>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">ACTIVE</span>
                        </div>
                      </div>
                    </div>

                    {/* Separate Table 1: Qoder */}
                    <section className="glass-card rounded-2xl border border-hairline overflow-hidden shadow-sm">
                      <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-canvas-soft/30">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-amber-500 text-[18px]">card_giftcard</span>
                          <h4 className="text-xs font-bold text-ink uppercase tracking-wider">Qoder 账号池 (+100 Credits)</h4>
                        </div>
                        <span className="text-xs text-body font-medium">{qoderAccounts.length} 个账号</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-canvas-soft border-b border-hairline text-[10px] font-semibold text-body uppercase">
                            <tr>
                              <th className="px-6 py-3">账号</th>
                              <th className="px-6 py-3">套餐</th>
                              <th className="px-6 py-3">签到状态</th>
                              <th className="px-6 py-3">当前算力</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-hairline">
                            {qoderAccounts.map(acc => (
                              <tr key={acc.uid} className="hover:bg-canvas-soft">
                                <td className="px-6 py-3 font-bold text-ink">{acc.name}</td>
                                <td className="px-6 py-3">{acc.plan}</td>
                                <td className="px-6 py-3">
                                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">已签到 (+100)</span>
                                </td>
                                <td className="px-6 py-3 font-mono font-semibold text-ink">
                                  {acc.quota_info?.remaining?.toLocaleString()} / {acc.quota_info?.total?.toLocaleString()} Credits
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {/* Separate Table 2: ZCode */}
                    <section className="glass-card rounded-2xl border border-emerald-200/60 overflow-hidden shadow-sm">
                      <div className="px-6 py-4 border-b border-emerald-100 flex items-center justify-between bg-emerald-50/40">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-emerald-600 text-[18px]">token</span>
                          <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wider">智谱 ZCode 账号池 (1 亿 Tokens)</h4>
                        </div>
                        <span className="text-xs text-emerald-800 font-medium">{zcodeAccounts.length} 个账号</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-emerald-50/30 border-b border-hairline text-[10px] font-semibold text-emerald-900 uppercase">
                            <tr>
                              <th className="px-6 py-3">账号</th>
                              <th className="px-6 py-3">接入通道</th>
                              <th className="px-6 py-3">今日权益</th>
                              <th className="px-6 py-3">Token 配额</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-hairline">
                            {zcodeAccounts.map(acc => (
                              <tr key={acc.uid} className="hover:bg-emerald-50/20">
                                <td className="px-6 py-3 font-bold text-ink">{acc.name}</td>
                                <td className="px-6 py-3 font-mono text-emerald-800">BigModel API</td>
                                <td className="px-6 py-3">
                                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">已申领 1 亿 Tokens</span>
                                </td>
                                <td className="px-6 py-3 font-mono font-bold text-emerald-950">
                                  100,000,000 / 100,000,000 Tokens (1 亿)
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                )}
              </div>
            )
          })()}


          {/* ─── AI PLAYGROUND ─── */}
          {activeTab === 'playground' && (
            <div className="flex gap-8 h-[calc(100vh-14rem)]">
              <section className="w-[320px] flex flex-col gap-6 overflow-y-auto pr-4">
                <div className="space-y-3">
                  <label className="font-bold text-ink">{t.playground.modelConfig}</label>
                  <CustomInput value={model} onChange={setModel} placeholder="e.g. lite, pro" />
                </div>
                <div className="space-y-3">
                  <label className="font-bold text-ink flex items-center justify-between">
                    <span>{lang === 'zh' ? '指定调用账号' : 'Target Account'}</span>
                    <span className="text-[10px] text-body font-normal">{lang === 'zh' ? '单独测试' : 'Solo Test'}</span>
                  </label>
                  <select
                    value={playgroundTargetAccount}
                    onChange={(e) => setPlaygroundTargetAccount(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-hairline bg-white/70 text-ink outline-none cursor-pointer hover:border-ink transition-colors"
                  >
                    <option value="">{lang === 'zh' ? '🌐 默认 (公共池自动轮询)' : '🌐 Default (All Pool Accounts)'}</option>
                    {accountsConfig.accounts
                      .filter(a => a.enabled && a.api_mode !== 'disabled')
                      .map(a => (
                        <option key={a.uid} value={a.name}>
                          {a.api_mode === 'dedicated' ? '🟡 [专属] ' : '🟢 '} {a.name} ({a.quota} credits)
                        </option>
                      ))}
                  </select>
                  <div className="text-[10px] text-body">
                    {playgroundTargetAccount
                      ? (lang === 'zh' ? `已锁定单独使用账号：${playgroundTargetAccount}` : `Using account: ${playgroundTargetAccount}`)
                      : (lang === 'zh' ? '未指定账号，默认全账号轮询调度' : 'No account set, round-robins all')}
                  </div>
                </div>
                <div className="space-y-3">
                  <CustomCheckbox checked={stream} onChange={setStream} label={t.playground.streamResponse} />
                </div>
                <div className="space-y-3 flex-1 flex flex-col">
                  <label className="font-bold text-ink">{t.playground.systemPrompt}</label>
                  <CustomTextarea value="" onChange={() => {}} placeholder={t.playground.systemPromptPlaceholder} className="flex-1 !min-h-[150px]" />
                </div>
              </section>

              <section className="flex-1 flex flex-col glass-card rounded-2xl overflow-hidden shadow-sm relative">
                <div className="flex-1 overflow-y-auto p-8 space-y-8">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'max-w-[80%] ml-auto flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${msg.role === 'user' ? 'bg-ink text-white' : 'bg-mint text-ink'}`}>
                        {msg.role === 'user' ? 'U' : <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>}
                      </div>
                      <div className={`flex-1 ${msg.role === 'user' ? '' : 'space-y-4'}`}>
                        {msg.role === 'user' ? (
                          <div className="bg-canvas-soft border border-hairline p-4 rounded-xl rounded-tl-none"><p className="text-ink whitespace-pre-wrap">{msg.content}</p></div>
                        ) : msg.content === '' ? (
                          <div className="flex items-center gap-2 text-body py-1 text-xs font-semibold animate-pulse">
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            {t.playground.waiting}
                          </div>
                        ) : renderMessageContent(msg.content)}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleSendChat} className="p-8 border-t border-hairline bg-white/50">
                  <div className="flex items-center gap-3">
                    <CustomTextarea value={chatInput} onChange={setChatInput} placeholder={t.playground.ask} className="flex-1" />
                    <button type="submit" disabled={generating || !chatInput.trim()} className="h-11 px-4 bg-ink text-white rounded-xl flex items-center gap-2 hover:bg-neutral-800 transition-all active:scale-95 shadow-md disabled:opacity-50 shrink-0">
                      <span className="font-bold text-sm">{t.playground.send}</span><span className="material-symbols-outlined text-sm">send</span>
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {/* ─── API KEYS ─── */}
          {activeTab === 'api-keys' && (
            <div className="space-y-8">
              <div className="flex justify-between items-end">
                <p className="text-body font-medium max-w-xl">{t.api.desc}</p>
                <button onClick={handleGenerateKey} className="bg-ink text-white px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-neutral-800 transition-all font-bold shadow-md">
                  <span className="material-symbols-outlined text-[20px]">add</span>{t.api.generate}
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="col-span-1 xl:col-span-4 flex flex-col gap-6">
                  <div className="glass-card p-6 sm:p-8 rounded-2xl flex flex-col justify-between min-h-[220px]">
                    <div><h3 className="font-bold text-ink text-lg mb-2">{t.api.gatewayAuth}</h3><p className="text-body text-sm">{t.api.gatewayAuthDesc}</p></div>
                    <div className="flex items-center justify-between pt-6 border-t border-hairline mt-auto">
                      <span className="text-[10px] font-bold text-body uppercase tracking-widest">{t.api.systemStatus}</span>
                      <button className={`w-11 h-6 rounded-full p-0.5 transition-colors relative cursor-pointer ${apiConfig.auth_required ? 'bg-ink' : 'bg-hairline-strong'}`} onClick={handleToggleAuth}>
                        <div className={`w-5 h-5 bg-white rounded-full transition-transform duration-200 ${apiConfig.auth_required ? 'translate-x-5' : 'translate-x-0'}`}></div>
                      </button>
                    </div>
                  </div>
                  <div className="glass-card p-4 rounded-xl">
                    <span className="text-[10px] font-bold text-body uppercase tracking-widest">{t.api.activeKeys}</span>
                    <div className="mt-2 flex items-baseline gap-2"><span className="font-display-sm text-ink">{apiConfig.allowed_keys.length}</span><span className="text-[10px] text-body font-bold">{t.api.configured}</span></div>
                  </div>
                </div>
                <div className="col-span-1 xl:col-span-8 glass-card rounded-2xl overflow-hidden flex flex-col shadow-sm">
                  <div className="p-6 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 border-b border-hairline">
                    <div>
                      <span className="font-bold text-ink">{t.api.activeAccessKeys}</span>
                      <p className="text-[11px] text-body mt-0.5">{lang === 'zh' ? '可为单个 Key 绑定专属账号，或保持默认全账号轮询。' : 'Keys can be bound to a single account or load-balanced across all.'}</p>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full xl:w-auto">
                      <CustomInput value={newKey} onChange={setNewKey} placeholder={t.api.keyPlaceholder} className="!w-44 !py-1.5 !bg-canvas-soft !border-hairline text-xs" mono />
                      <select
                        value={newKeyAccount}
                        onChange={(e) => setNewKeyAccount(e.target.value)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-hairline bg-canvas-soft text-ink outline-none cursor-pointer max-w-[200px]"
                        title={lang === 'zh' ? '选择该 Key 绑定的目标账号' : 'Select target account for this key'}
                      >
                        <option value="">{lang === 'zh' ? '🌐 全部账号 (默认)' : '🌐 All Accounts'}</option>
                        {accountsConfig.accounts.map(a => (
                          <option key={a.uid} value={a.uid}>
                            {a.user_type === 'enterprise' || a.plan === 'team' ? '🏢 [企业] ' : '👤 [个人] '}{a.name} ({a.quota} credits)
                          </option>
                        ))}
                      </select>
                      <button onClick={handleAddKey} disabled={!newKey.trim()} className="bg-ink text-white px-3.5 py-1.5 rounded-lg font-bold text-xs hover:bg-neutral-800 transition-all disabled:opacity-50 shrink-0 cursor-pointer">{t.common.add}</button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-canvas-soft/50 border-b border-hairline">
                        <tr>{[lang === 'zh' ? 'Key 密钥' : 'Key String', lang === 'zh' ? '定向绑定账号' : 'Bound Account', lang === 'zh' ? '操作' : 'Actions'].map((h, i) => (
                          <th key={h} className={`px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-widest ${i === 2 ? 'text-right' : ''}`}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {apiConfig.allowed_keys.length === 0 ? (
                          <tr><td colSpan={3} className="py-6 text-center text-xs text-body font-medium">{t.api.noKeys}</td></tr>
                        ) : apiConfig.allowed_keys.map((key) => {
                          const detail = apiConfig.allowed_keys_detail?.find(d => d.api_key === key)
                          const boundAcc = detail?.account_uid ? accountsConfig.accounts.find(a => a.uid === detail.account_uid) : null
                          const isSelected = (selectedAccessKey || apiConfig.allowed_keys[0]) === key
                          return (
                            <tr key={key} className={`transition-colors ${isSelected ? 'bg-emerald-50/40' : 'hover:bg-canvas-soft/30'}`}>
                              <td className="px-6 py-5 font-mono text-xs tracking-wider text-body opacity-80 select-all break-all">
                                <div className="flex items-center gap-2">
                                  <span>{key}</span>
                                  {isSelected && (
                                    <span className="text-[10px] font-sans font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-300">
                                      {lang === 'zh' ? '当前配置' : 'Active'}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                <select
                                  value={detail?.account_uid || ''}
                                  onChange={(e) => handleUpdateKeyAccount(key, e.target.value)}
                                  className="text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-hairline bg-white text-ink outline-none cursor-pointer shadow-xs max-w-[240px]"
                                >
                                  <option value="">{lang === 'zh' ? '🌐 全部账号 (默认轮询)' : '🌐 All Accounts (Default)'}</option>
                                  {accountsConfig.accounts.map(a => (
                                    <option key={a.uid} value={a.uid}>
                                      {a.user_type === 'enterprise' || a.plan === 'team' ? '🏢 [企业] ' : '👤 [个人] '}{a.name} ({a.quota} credits)
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-6 py-5 text-right">
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => {
                                      setSelectedAccessKey(key)
                                      pushToast('INFO', lang === 'zh' ? '已选择配置 Key' : 'Key Selected', key)
                                    }}
                                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${isSelected ? 'text-emerald-700 bg-emerald-100 font-bold' : 'text-body hover:text-ink hover:bg-canvas-soft'}`}
                                    title={lang === 'zh' ? '在下方接入卡片中查看并使用此 Key' : 'Configure with this Key'}
                                  >
                                    <span className="material-symbols-outlined text-[18px]">tune</span>
                                  </button>
                                  <button onClick={() => handleCopyKey(key)} className="p-1.5 text-body hover:text-ink cursor-pointer" title="Copy"><span className="material-symbols-outlined text-[18px]">{copiedKey === key ? 'check_circle' : 'content_copy'}</span></button>
                                  <button onClick={() => handleDeleteKey(key)} className="p-1.5 text-red-400 hover:text-red-600 cursor-pointer" title="Delete"><span className="material-symbols-outlined text-[18px]">block</span></button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* ─── CODEX++ STYLE MINIMAL API ACCESS & MODEL SELECTION ─── */}
              {(() => {
                const activeKey = selectedAccessKey || apiConfig.allowed_keys[0] || ''
                const activeKeyDetail = apiConfig.allowed_keys_detail?.find(d => d.api_key === activeKey)
                const boundAccount = activeKeyDetail?.account_uid
                  ? accountsConfig.accounts.find(a => a.uid === activeKeyDetail.account_uid)
                  : null

                const apiBaseUrl = typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost:5173')
                  ? `${window.location.origin}/v1`
                  : 'http://localhost:5050/v1';
                const chatEndpoint = `${apiBaseUrl}/chat/completions`;

                const copyAllModelsText = () => {
                  const allIds = VERIFIED_MODELS.map(m => m.id).join(', ')
                  navigator.clipboard.writeText(allIds)
                  pushToast('SUCCESS', lang === 'zh' ? '已复制全部模型' : 'Copied All Models', lang === 'zh' ? '已复制 14 款可用模型名称' : 'Copied 14 model IDs')
                }

                const copyCurlCommand = () => {
                  const cmd = `curl ${chatEndpoint} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${activeKey || 'YOUR_API_KEY'}" \\\n  -d '{"model": "kimi-k3", "messages": [{"role": "user", "content": "你好"}]}'`
                  navigator.clipboard.writeText(cmd)
                  pushToast('INFO', lang === 'zh' ? '已复制 cURL 示例' : 'Copied cURL', lang === 'zh' ? '已将完整请求命令写入剪贴板' : 'cURL command copied')
                }

                return (
                  <div className="glass-card rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-hairline">
                      <div className="flex items-center gap-3.5">
                        <span className="p-2.5 rounded-xl bg-ink text-white shadow-sm flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[22px]">api</span>
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="font-bold text-lg text-ink">
                              {lang === 'zh' ? 'API 调用接入与可用模型' : 'API Access & Available Models'}
                            </h2>
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full">
                              OpenAI Compatible
                            </span>
                          </div>
                          <p className="text-body text-xs mt-0.5">
                            {lang === 'zh'
                              ? '原生兼容 OpenAI 协议规范。可直接将 Base URL、Key 与模型名称填入 Codex++、Cursor、Cherry Studio、NextChat、ZCode 等客户端。'
                              : 'Fully OpenAI compatible. Configure in Codex++, Cursor, Cherry Studio, NextChat, etc.'}
                          </p>
                        </div>
                      </div>

                      {/* Top Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={copyAllModelsText}
                          className="px-3.5 py-2 rounded-xl bg-ink text-white hover:bg-neutral-800 text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[16px]">content_copy</span>
                          <span>{lang === 'zh' ? '复制全部模型名' : 'Copy All Models'}</span>
                        </button>
                        <button
                          onClick={copyCurlCommand}
                          className="px-3.5 py-2 rounded-xl bg-white border border-hairline hover:bg-canvas-soft text-ink text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[16px]">terminal</span>
                          <span>{lang === 'zh' ? 'cURL 示例' : 'cURL Example'}</span>
                        </button>
                        <button
                          onClick={() => {
                            fetchAccounts();
                            pushToast('INFO', lang === 'zh' ? '模型与账号刷新' : 'Refreshed', lang === 'zh' ? '模型列表已更新并已验证生产可用' : 'Models verified');
                          }}
                          className="px-3 py-2 rounded-xl bg-white border border-hairline hover:bg-canvas-soft text-ink text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[16px]">refresh</span>
                          <span>{lang === 'zh' ? '刷新' : 'Refresh'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Key Selector & Dispatch Status */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Left: Base URL */}
                      <div className="bg-canvas-soft/60 border border-hairline rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-body uppercase tracking-wider flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-ink text-[16px]">link</span>
                            {lang === 'zh' ? '调用地址 (Base URL)' : 'Base URL'}
                          </span>
                          <span className="text-[10px] text-emerald-700 bg-emerald-100 border border-emerald-200 font-bold px-2 py-0.5 rounded-full">
                            ● {lang === 'zh' ? '生产环境' : 'Live Gateway'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={apiBaseUrl}
                            readOnly
                            className="w-full h-10 bg-white border border-hairline rounded-lg px-3 text-xs font-mono text-ink outline-none select-all"
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(apiBaseUrl)
                              pushToast('INFO', lang === 'zh' ? '已复制 Base URL' : 'Copied Base URL', apiBaseUrl)
                            }}
                            className="h-10 px-3.5 bg-ink text-white hover:bg-neutral-800 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[15px]">content_copy</span>
                            <span>{t.common.copy}</span>
                          </button>
                        </div>
                        <div className="text-[11px] text-body flex items-center gap-1 pt-1 font-mono">
                          <span className="opacity-60">{lang === 'zh' ? '完整对话端点:' : 'Endpoint:'}</span>
                          <span
                            onClick={() => {
                              navigator.clipboard.writeText(chatEndpoint)
                              pushToast('INFO', lang === 'zh' ? '已复制端点' : 'Copied Endpoint', chatEndpoint)
                            }}
                            className="text-ink font-semibold select-all hover:underline cursor-pointer"
                            title="点击复制完整端点"
                          >
                            {chatEndpoint}
                          </span>
                        </div>
                      </div>

                      {/* Right: API Key */}
                      <div className="bg-canvas-soft/60 border border-hairline rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-body uppercase tracking-wider flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-ink text-[16px]">vpn_key</span>
                              {lang === 'zh' ? '调用密钥 (API Key)' : 'API Key'}
                            </span>
                            {apiConfig.allowed_keys.length > 1 && (
                              <select
                                value={activeKey}
                                onChange={(e) => setSelectedAccessKey(e.target.value)}
                                className="text-[10px] font-bold px-2 py-0.5 rounded border border-hairline bg-white text-ink outline-none cursor-pointer"
                              >
                                {apiConfig.allowed_keys.map(k => {
                                  const kd = apiConfig.allowed_keys_detail?.find(d => d.api_key === k)
                                  const acc = kd?.account_uid ? accountsConfig.accounts.find(a => a.uid === kd.account_uid) : null
                                  return (
                                    <option key={k} value={k}>
                                      {k.slice(0, 12)}... {acc ? `(${acc.user_type === 'enterprise' || acc.plan === 'team' ? '🏢 企业' : '👤 个人'}: ${acc.name})` : '(🌐 全局轮询)'}
                                    </option>
                                  )
                                })}
                              </select>
                            )}
                          </div>
                          <button
                            onClick={() => setKeyMasked(!keyMasked)}
                            className="text-[11px] text-body hover:text-ink flex items-center gap-1 cursor-pointer font-medium"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {keyMasked ? 'visibility' : 'visibility_off'}
                            </span>
                            <span>{keyMasked ? (lang === 'zh' ? '显示' : 'Show') : (lang === 'zh' ? '隐藏' : 'Hide')}</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type={keyMasked ? "password" : "text"}
                            value={activeKey}
                            readOnly
                            placeholder={lang === 'zh' ? '请先在上方添加 API Key' : 'No API Key configured'}
                            className="w-full h-10 bg-white border border-hairline rounded-lg px-3 text-xs font-mono text-ink outline-none select-all"
                          />
                          <button
                            onClick={() => {
                              if (!activeKey) return
                              navigator.clipboard.writeText(activeKey)
                              pushToast('INFO', lang === 'zh' ? '已复制 API Key' : 'Copied Key', activeKey)
                            }}
                            disabled={!activeKey}
                            className="h-10 px-3.5 bg-ink text-white hover:bg-neutral-800 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[15px]">content_copy</span>
                            <span>{t.common.copy}</span>
                          </button>
                        </div>
                        <div className="text-[11px] text-body flex items-center justify-between pt-1">
                          <span>{lang === 'zh' ? '请求头:' : 'Header:'} <code className="bg-canvas-soft px-1.5 py-0.5 rounded font-mono text-ink">Authorization: Bearer &lt;Key&gt;</code></span>
                          <span className="text-[10px] opacity-70 font-mono">{lang === 'zh' ? '客户端直连无需加后缀' : 'Auto-routed'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Routing Directive Callout: Explaining Account Binding */}
                    {boundAccount ? (
                      <div className="bg-emerald-50/90 border border-emerald-200 rounded-xl p-4.5 space-y-2 transition-all">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-bold text-emerald-950 text-xs">
                            <span className="material-symbols-outlined text-emerald-700 text-[18px]">verified_user</span>
                            <span>
                              {lang === 'zh'
                                ? `当前 Key 已专属锁定账号：${boundAccount.user_type === 'enterprise' || boundAccount.plan === 'team' ? '🏢 企业号' : '👤 个人号'}【${boundAccount.name}】`
                                : `This Key is locked to ${boundAccount.user_type === 'enterprise' || boundAccount.plan === 'team' ? '🏢 Enterprise' : '👤 Personal'} account: ${boundAccount.name}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="bg-emerald-200/80 text-emerald-900 font-mono font-bold px-2 py-0.5 rounded text-[11px]">
                              {boundAccount.quota} credits
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-700 text-white px-2 py-0.5 rounded">
                              {lang === 'zh' ? '独享专属' : 'Dedicated'}
                            </span>
                          </div>
                        </div>
                        <p className="text-emerald-900/80 text-xs leading-relaxed">
                          {lang === 'zh' ? (
                            <>
                              💡 <strong>客户端零配置直连</strong>：在 Codex++ / Cursor / Cherry Studio 中填入此 Key 即可。
                              客户端模型名称直接填写原生模型名（如 <code>kimi-k3</code>、<code>deepseek-v4-pro</code>），<strong>无需在模型名后追加 @账号后缀</strong>！网关将 100% 自动把请求路由至该专属账号。
                            </>
                          ) : (
                            <>
                              💡 <strong>Zero-config direct routing</strong>: Just configure this Key in your client. Send requests using native model names (e.g. <code>kimi-k3</code>). The gateway automatically routes 100% of requests to this dedicated account without needing any @account suffix!
                            </>
                          )}
                        </p>
                      </div>
                    ) : (
                      <div className="bg-blue-50/90 border border-blue-200 rounded-xl p-4.5 space-y-2 transition-all">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-bold text-blue-950 text-xs">
                            <span className="material-symbols-outlined text-blue-700 text-[18px]">hub</span>
                            <span>
                              {lang === 'zh' ? '当前 Key 调度模式：全账号公共池智能负载均衡' : 'Routing Mode: Global Account Pool Load Balancing'}
                            </span>
                          </div>
                          <span className="bg-blue-200/80 text-blue-900 font-mono font-bold px-2 py-0.5 rounded text-[11px]">
                            {lang === 'zh' ? '共享轮询' : 'Shared Pool'}
                          </span>
                        </div>
                        <p className="text-blue-950/80 text-xs leading-relaxed">
                          {lang === 'zh' ? (
                            <>
                              🌐 请求将由网关在所有已启用且开启“全部调用”的账号间自动轮询调度。
                              💡 <strong>临时单账号指定技巧</strong>：若使用此公共 Key 但希望临时锁定特定账号，支持在客户端模型名后追加 <code>@账号名</code>（例如：<code>kimi-k3@{accountsConfig.accounts[0]?.name || 'liuzhuyun'}</code>），网关即可穿透定向！
                            </>
                          ) : (
                            <>
                              🌐 Requests will automatically load balance across all eligible accounts.
                              💡 <strong>Targeting tip</strong>: You can append <code>@account</code> to any model name (e.g. <code>kimi-k3@{accountsConfig.accounts[0]?.name || 'liuzhuyun'}</code>) to force routing to a specific account.
                            </>
                          )}
                        </p>
                      </div>
                    )}

                    {/* Available Models Table (14 verified working models) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-ink text-sm">
                            {lang === 'zh' ? '可调用模型列表' : 'Available Models'}
                          </span>
                          <span className="text-[11px] bg-canvas-soft border border-hairline text-body font-mono px-2 py-0.5 rounded-full font-bold">
                            {VERIFIED_MODELS.length} {lang === 'zh' ? '个模型全部实测通过' : 'models verified'}
                          </span>
                        </div>
                        <span className="text-[11px] text-body">
                          {lang === 'zh' ? '💡 单击任意模型名或右侧复制按钮即可直接拷贝' : '💡 Click any model row to copy model ID'}
                        </span>
                      </div>

                      <div className="border border-hairline rounded-xl overflow-hidden shadow-2xs">
                        <div className="overflow-x-auto max-h-[460px] custom-scroll">
                          <table className="w-full text-left">
                            <thead className="bg-canvas-soft/80 border-b border-hairline text-[10px] font-semibold text-body uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm">
                              <tr>
                                <th className="px-5 py-3">{lang === 'zh' ? '模型标识 (Model ID)' : 'Model ID'}</th>
                                <th className="px-4 py-3 w-36">{lang === 'zh' ? '厂商 / 系列' : 'Provider'}</th>
                                <th className="px-4 py-3 w-28">{lang === 'zh' ? '上下文容量' : 'Context'}</th>
                                <th className="px-4 py-3 w-28">{lang === 'zh' ? '实测延迟' : 'Latency'}</th>
                                <th className="px-4 py-3">{lang === 'zh' ? '适用场景 / 特点' : 'Description'}</th>
                                <th className="px-5 py-3 text-right w-28">{lang === 'zh' ? '操作' : 'Action'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-hairline text-xs">
                              {VERIFIED_MODELS.map((item) => (
                                <tr
                                  key={item.id}
                                  onClick={() => {
                                    navigator.clipboard.writeText(item.id)
                                    setCopiedModel(item.id)
                                    pushToast('INFO', lang === 'zh' ? '已复制模型名' : 'Copied Model', item.id)
                                    setTimeout(() => setCopiedModel(null), 1500)
                                  }}
                                  className="hover:bg-canvas-soft/60 transition-colors group cursor-pointer"
                                >
                                  <td className="px-5 py-3.5 font-mono text-ink font-bold">
                                    <div className="flex items-center gap-2">
                                      <span className="group-hover:text-blue-600 transition-colors">{item.id}</span>
                                      {item.rec && (
                                        <span className="text-[10px] font-sans font-extrabold bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded shrink-0">
                                          {lang === 'zh' ? '🔥 推荐' : '🔥 Top'}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md border font-medium ${item.badge}`}>
                                      {item.vendor}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3.5 font-mono text-body font-semibold">
                                    {item.context}
                                  </td>
                                  <td className="px-4 py-3.5 font-mono text-emerald-700 font-semibold text-[11px]">
                                    {item.latency}
                                  </td>
                                  <td className="px-4 py-3.5 text-body text-[11px]">
                                    {lang === 'zh' ? item.descZh : item.descEn}
                                  </td>
                                  <td className="px-5 py-3.5 text-right">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        navigator.clipboard.writeText(item.id)
                                        setCopiedModel(item.id)
                                        pushToast('INFO', lang === 'zh' ? '已复制模型名' : 'Copied Model', item.id)
                                        setTimeout(() => setCopiedModel(null), 1500)
                                      }}
                                      className="p-1.5 rounded-lg text-body hover:text-ink hover:bg-canvas-soft transition-colors cursor-pointer"
                                      title={lang === 'zh' ? '复制模型名' : 'Copy Model ID'}
                                    >
                                      <span className="material-symbols-outlined text-[16px]">
                                        {copiedModel === item.id ? 'check_circle' : 'content_copy'}
                                      </span>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Codex++ Setup Hint */}
                    <div className="flex items-center gap-2 p-3.5 bg-canvas-soft/70 border border-hairline rounded-xl text-xs text-body">
                      <span className="material-symbols-outlined text-[18px] text-ink opacity-70">lightbulb</span>
                      <span>
                        {lang === 'zh'
                          ? 'Codex++ 接入提示：添加自定义供应商时，会话身份选「Custom (默认)」，上游协议选「Chat Completions」即可原生无缝使用。'
                          : 'Codex++ setup: Select "Custom" identity and "Chat Completions" protocol for seamless integration.'}
                      </span>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* ─── LOGS ─── */}
          {activeTab === 'logs' && (
            <div className="space-y-8">
              <div className="relative z-[4000] grid grid-cols-1 md:grid-cols-4 gap-4 p-6 bg-white/60 backdrop-blur-md border border-hairline rounded-2xl">
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-body uppercase opacity-60 tracking-wider">{t.logs.account}</label>
                  <CustomSelect value={logFilterAccount} onChange={setLogFilterAccount} options={accountLogOptions.map((option, index) => index === 0 ? { ...option, label: t.logs.allAccounts } : option)} placeholder={t.logs.allAccounts} />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-body uppercase opacity-60 tracking-wider">{t.logs.status}</label>
                  <CustomSelect value={logFilterStatus} onChange={setLogFilterStatus} options={[{ value: 'all', label: t.logs.allStatuses }, { value: 'info', label: 'Info' }, { value: 'error', label: 'Error' }, { value: 'warning', label: 'Warning' }]} placeholder={t.logs.allStatuses} />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-body uppercase opacity-60 tracking-wider">{t.logs.range}</label>
                  <CustomSelect value={logFilterRange} onChange={setLogFilterRange} options={[{ value: '24h', label: t.logs.last24h }, { value: '1h', label: t.logs.lastHour }, { value: '7d', label: t.logs.last7d }]} placeholder={t.logs.last24h} />
                </div>
                <div className="flex items-end">
                  <button onClick={() => { fetchLogs(); pushToast('INFO', 'Logs Refreshed', 'Log entries updated') }} className="w-full h-11 bg-ink text-white rounded-xl flex items-center justify-center gap-2 hover:bg-neutral-800 transition-all shadow-sm">
                    <span className="material-symbols-outlined text-sm">filter_list</span><span className="font-bold text-sm">{t.common.refresh}</span>
                  </button>
                </div>
              </div>

              <div className="relative z-0 bg-white/80 backdrop-blur-xl border border-hairline rounded-2xl overflow-hidden">
                <table className="w-full text-left">
                  <thead><tr className="bg-canvas-soft border-b border-hairline">{[t.logs.timestamp, t.logs.level, t.logs.message].map(h => (<th key={h} className="px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-widest">{h}</th>))}</tr></thead>
                  <tbody className="divide-y divide-hairline">
                    {logs.length === 0 ? (
                      <tr><td colSpan={3} className="py-8 text-center text-xs text-body font-medium">{t.logs.noLogs}</td></tr>
                    ) : filteredLogs.length === 0 ? (
                      <tr><td colSpan={3} className="py-8 text-center text-xs text-body font-medium">{t.logs.noMatch}</td></tr>
                    ) : filteredLogs.map((log, i) => {
                      const isError = log.includes('[ERROR]') || log.includes('[WARNING]')
                      return (
                        <tr key={i} className={`hover:bg-black/5 transition-colors ${isError ? 'bg-red-50' : ''}`}>
                          <td className="px-6 py-4 font-mono text-[13px] text-body whitespace-nowrap">{log.substring(0, 10)}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded text-[11px] font-bold uppercase ${log.includes('[ERROR]') ? 'bg-red-50 text-red-700' : log.includes('[WARNING]') ? 'bg-peach/20 text-ink' : 'bg-mint/20 text-ink'}`}>
                              {log.match(/\[(INFO|ERROR|WARNING)\]/)?.[1] || 'INFO'}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-mono text-[13px] text-ink opacity-80 break-all">{log.replace(/^\[[\d:]+\]\s*\[\w+\]\s*/, '')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div ref={logEndRef} />
              </div>
            </div>
          )}


        </div>
      </main>

      {/* ─── ADD ACCOUNT MODAL ─── */}
      {showAddAccountModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeAddAccountModal() }}
        >
          <div className="bg-surface-card border border-hairline rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-hairline">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-ink text-[22px]">hub</span>
                <h3 className="font-bold text-base text-ink">{lang === 'zh' ? '添加账号' : 'Add Account'}</h3>
              </div>
              <button
                type="button"
                onClick={closeAddAccountModal}
                className="text-body hover:text-ink transition-colors p-1 rounded-lg hover:bg-black/5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-hairline px-6 pt-3 gap-5 text-sm font-semibold overflow-x-auto">
              <button
                type="button"
                onClick={() => {
                  setAddAccountTab('pat')
                  if (qoderAuthMode === 'oauth' && !oauthData && !oauthLoading) {
                    startQoderOAuthFlow(oauthRegion)
                  }
                }}
                className={`pb-3 transition-colors border-b-2 whitespace-nowrap cursor-pointer ${addAccountTab === 'pat' ? 'border-[#E05D38] text-[#E05D38] font-bold' : 'border-transparent text-body hover:text-ink'}`}
              >
                Qoder (OAuth / PAT)
              </button>
              <button
                type="button"
                onClick={() => { stopPollingOAuth(); setAddAccountTab('zcode') }}
                className={`pb-3 transition-colors border-b-2 whitespace-nowrap cursor-pointer ${addAccountTab === 'zcode' ? 'border-emerald-600 text-emerald-700 font-bold' : 'border-transparent text-body hover:text-ink'}`}
              >
                ZCode (智谱)
              </button>
            </div>

            {/* Tab 1: Qoder */}
            {addAccountTab === 'pat' && (
              <div className="p-6 space-y-4">
                {/* Mode Selector */}
                <div className="flex items-center justify-between pb-3 border-b border-hairline">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-body">
                    <span className="material-symbols-outlined text-[16px]">tune</span>
                    <span>{lang === 'zh' ? '授权模式' : 'Auth Mode'}</span>
                  </div>
                  <div className="inline-flex p-1 bg-surface-ground border border-hairline rounded-xl gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        stopPollingOAuth()
                        setQoderAuthMode('pat')
                      }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                        qoderAuthMode === 'pat'
                          ? 'bg-ink text-white shadow-xs'
                          : 'text-body hover:text-ink'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">key</span>
                      <span>PAT 令牌</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQoderAuthMode('oauth')
                        if (!oauthData && !oauthLoading) {
                          startQoderOAuthFlow(oauthRegion)
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                        qoderAuthMode === 'oauth'
                          ? 'bg-[#E05D38] text-white shadow-xs'
                          : 'text-body hover:text-ink'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">lock</span>
                      <span>OAuth (免密推荐)</span>
                    </button>
                  </div>
                </div>

                {qoderAuthMode === 'oauth' ? (
                  <div className="space-y-4 animate-in fade-in duration-150">
                    {/* Top macOS Controls & Region */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span>
                      </div>
                      <div className="font-bold text-sm text-ink flex items-center gap-2">
                        <span>Connect Qoder {oauthRegion.toUpperCase()}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono font-bold">RFC 8628</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const next = oauthRegion === 'cn' ? 'global' : 'cn'
                            setOauthRegion(next)
                            startQoderOAuthFlow(next)
                          }}
                          className="text-[11px] px-2 py-0.5 rounded border border-hairline text-body hover:text-ink transition-colors cursor-pointer"
                          title="切换国内版/国际版"
                        >
                          {oauthRegion === 'cn' ? '🇨🇳 国内版' : '🌐 国际版'}
                        </button>
                      </div>
                    </div>

                    <p className="text-center text-xs text-body">
                      {lang === 'zh' ? '访问下面的登录 URL 并进行授权:' : 'Visit the login URL below to authorize:'}
                    </p>

                    {oauthLoading ? (
                      <div className="py-10 flex flex-col items-center justify-center gap-3">
                        <span className="material-symbols-outlined text-[32px] text-[#E05D38] animate-spin">progress_activity</span>
                        <p className="text-xs text-body">{lang === 'zh' ? '正在向 Qoder 发起设备授权...' : 'Requesting authorization code from Qoder...'}</p>
                      </div>
                    ) : oauthError ? (
                      <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 text-center space-y-3">
                        <p>{oauthError}</p>
                        <button
                          type="button"
                          onClick={() => startQoderOAuthFlow(oauthRegion)}
                          className="px-4 py-1.5 bg-red-600 text-white rounded-lg font-bold text-xs hover:bg-red-700 cursor-pointer"
                        >
                          {lang === 'zh' ? '重试' : 'Retry'}
                        </button>
                      </div>
                    ) : oauthData ? (
                      <div className="space-y-3.5">
                        {/* 登录 URL Card */}
                        <div className="rounded-xl p-4 bg-[#FBF9F5] border border-amber-200/60 text-center shadow-xs">
                          <div className="text-[11px] font-semibold text-body/80 mb-2">登录 URL</div>
                          <div className="font-mono text-[11px] text-body break-all leading-relaxed bg-white p-3 rounded-lg border border-hairline/80 select-all text-left shadow-2xs max-h-24 overflow-y-auto">
                            {oauthData.verification_uri_complete}
                          </div>
                          <div className="flex items-center justify-center gap-3 mt-3">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(oauthData.verification_uri_complete)
                                pushToast('SUCCESS', lang === 'zh' ? '已复制登录 URL' : 'Copied URL', lang === 'zh' ? '授权链接已成功复制到剪贴板' : 'URL copied')
                              }}
                              className="px-3.5 py-1.5 rounded-lg border border-hairline bg-white hover:bg-neutral-50 text-xs font-semibold text-ink flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[15px]">content_copy</span>
                              {lang === 'zh' ? '复制' : 'Copy'}
                            </button>
                            <button
                              type="button"
                              onClick={() => window.open(oauthData.verification_uri_complete, '_blank')}
                              className="px-3.5 py-1.5 rounded-lg border border-hairline bg-white hover:bg-neutral-50 text-xs font-semibold text-ink flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                              {lang === 'zh' ? '打开' : 'Open'}
                            </button>
                          </div>
                        </div>

                        {/* 你的代码 Card */}
                        <div className="rounded-xl p-4 bg-[#FFF7F2] border border-orange-200 text-center shadow-xs">
                          <div className="text-[11px] font-semibold text-orange-950/70 mb-1.5">你的代码</div>
                          <div className="flex items-center justify-center gap-3">
                            <span className="font-mono font-black text-3xl tracking-widest text-[#E05D38] select-all">
                              {oauthData.user_code}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(oauthData.user_code)
                                pushToast('SUCCESS', lang === 'zh' ? '已复制代码' : 'Copied Code', oauthData.user_code)
                              }}
                              className="p-1.5 rounded-lg hover:bg-orange-100 text-[#E05D38] transition-colors cursor-pointer"
                              title={lang === 'zh' ? '复制代码' : 'Copy Code'}
                            >
                              <span className="material-symbols-outlined text-[20px]">content_copy</span>
                            </button>
                          </div>
                        </div>

                        {/* 等待授权 Spinner */}
                        <div className="flex flex-col items-center justify-center gap-1.5 pt-1">
                          <div className="flex items-center gap-2 text-xs font-semibold text-body">
                            <span className="material-symbols-outlined text-[18px] animate-spin text-[#E05D38]">progress_activity</span>
                            <span>{lang === 'zh' ? '等待授权...' : 'Waiting for authorization...'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => startQoderOAuthFlow(oauthRegion)}
                            className="text-[11px] text-body hover:text-ink underline transition-colors cursor-pointer"
                          >
                            {lang === 'zh' ? '重新生成授权码' : 'Regenerate Code'}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={closeAddAccountModal}
                        className="px-4 py-2 text-sm font-semibold text-body border border-hairline rounded-lg hover:text-ink transition-colors cursor-pointer"
                      >
                        {lang === 'zh' ? '关闭' : 'Close'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-150">
                    <div>
                      <label className="text-xs font-semibold text-body mb-2 block uppercase tracking-wider">
                        {lang === 'zh' ? 'Qoder Personal Access Token (PAT) *' : 'Qoder PAT Token *'}
                      </label>
                      <input
                        type="password"
                        value={addAccountPat}
                        onChange={e => setAddAccountPat(e.target.value)}
                        placeholder="pat_..."
                        className="w-full px-4 py-2.5 rounded-xl border border-hairline bg-white/60 font-mono text-sm text-ink outline-none focus:border-ink/40 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-body mb-2 block uppercase tracking-wider">
                        {lang === 'zh' ? '账号备注名称 (可选)' : 'Account Alias / Note (Optional)'}
                      </label>
                      <input
                        type="text"
                        value={addAccountName}
                        onChange={e => setAddAccountName(e.target.value)}
                        placeholder={lang === 'zh' ? '例如：开发主账号 / VIP 1' : 'e.g. Main Account'}
                        className="w-full px-4 py-2.5 rounded-xl border border-hairline bg-white/60 text-sm text-ink outline-none focus:border-ink/40 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-body mb-2 block uppercase tracking-wider">
                        {lang === 'zh' ? '企业版 VPC 域名 (可选)' : 'Enterprise VPC Domain (Optional)'}
                      </label>
                      <input
                        type="text"
                        value={addAccountDomain}
                        onChange={e => setAddAccountDomain(e.target.value)}
                        placeholder="acme.vpc.qoder.com.cn"
                        className="w-full px-4 py-2.5 rounded-xl border border-hairline bg-white/60 font-mono text-sm text-ink outline-none focus:border-ink/40 transition-colors"
                      />
                      <p className="mt-1.5 text-[11px] text-body leading-relaxed">
                        {lang === 'zh'
                          ? '企业版（Qoder CN VPC）用户请填写企业域名，如 acme.vpc.qoder.com.cn；公共版账号请留空。'
                          : 'For Qoder CN VPC (enterprise) accounts only, e.g. acme.vpc.qoder.com.cn. Leave empty for public accounts.'}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200/60 text-xs text-blue-900 leading-relaxed">
                      <p className="font-semibold mb-1">{lang === 'zh' ? '💡 如何获取 PAT 令牌：' : '💡 How to get a PAT:'}</p>
                      <p>
                        {lang === 'zh'
                          ? '登录 Qoder 官网个人中心 (Settings -> Personal Access Tokens) 创建一个 PAT，复制粘贴到上方即可自动验证并接入账号池参与轮询与并发请求。'
                          : 'Sign in to Qoder and create a PAT under Settings -> Personal Access Tokens, then paste it above to verify and join the routing pool.'}
                      </p>
                      <p className="mt-1">
                        {lang === 'zh'
                          ? '企业版用户请先填写上方企业域名，PAT 获取入口为 https://{企业域名}/account/integrations（例如 https://acme.vpc.qoder.com.cn/account/integrations）。'
                          : 'Enterprise users: fill in the domain above first — your PAT page is https://{domain}/account/integrations (e.g. https://acme.vpc.qoder.com.cn/account/integrations).'}
                      </p>
                    </div>

                    <div className="pt-2 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={closeAddAccountModal}
                        className="px-4 py-2 text-sm font-semibold text-body border border-hairline rounded-lg hover:text-ink transition-colors cursor-pointer"
                      >
                        {lang === 'zh' ? '取消' : 'Cancel'}
                      </button>
                      <button
                        type="button"
                        onClick={handleAddAccountPat}
                        disabled={!addAccountPat.trim() || addingAccount}
                        className="px-6 py-2 bg-ink text-white text-sm font-bold rounded-lg hover:bg-neutral-800 transition-all disabled:opacity-40 shadow-sm flex items-center gap-2 cursor-pointer"
                      >
                        {addingAccount && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                        {addingAccount ? (lang === 'zh' ? '验证入库中...' : 'Verifying...') : (lang === 'zh' ? '验证并添加' : 'Verify & Add')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: ZCode */}
            {addAccountTab === 'zcode' && (
              <div className="p-6 space-y-5">
                {/* ZCode Mode Selector */}
                <div className="flex items-center justify-between pb-3 border-b border-hairline">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-body">
                    <span className="material-symbols-outlined text-[16px]">tune</span>
                    <span>{lang === 'zh' ? '接入方式' : 'Access Mode'}</span>
                  </div>
                  <div className="inline-flex p-1 bg-surface-ground border border-hairline rounded-xl gap-1">
                    <button
                      type="button"
                      onClick={() => setZcodeAuthMode('pat')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${zcodeAuthMode === 'pat' ? 'bg-emerald-600 text-white shadow-xs' : 'text-body hover:text-ink'}`}
                    >
                      <span className="material-symbols-outlined text-[15px]">key</span>
                      <span>{lang === 'zh' ? 'API Key (PAT)' : 'API Key (PAT)'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setZcodeAuthMode('local')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${zcodeAuthMode === 'local' ? 'bg-ink text-white shadow-xs' : 'text-body hover:text-ink'}`}
                    >
                      <span className="material-symbols-outlined text-[15px]">folder_open</span>
                      <span>{lang === 'zh' ? '本地导入' : 'Local File'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setZcodeAuthMode('oauth')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${zcodeAuthMode === 'oauth' ? 'bg-slate-700 text-white shadow-xs' : 'text-body hover:text-ink'}`}
                    >
                      <span className="material-symbols-outlined text-[15px]">lock</span>
                      <span>{lang === 'zh' ? 'OAuth 授权' : 'OAuth'}</span>
                    </button>
                  </div>
                </div>

                {/* Sub-mode 1: API Key / PAT */}
                {zcodeAuthMode === 'pat' && (
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200/70 flex items-center justify-between gap-3 text-xs text-emerald-900">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-emerald-700 text-[18px]">verified</span>
                        <span>{lang === 'zh' ? '智谱开放平台 API Key 即为 ZCode 的 PAT 凭据，每日专享 1 亿 Tokens 算力包。' : 'BigModel API Key acts as ZCode PAT, with 100M Tokens daily privilege.'}</span>
                      </div>
                      <a
                        href="https://bigmodel.cn/usercenter/proj-mgmt/apikeys"
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 bg-white border border-emerald-300 rounded-lg font-bold text-[11px] text-emerald-800 hover:bg-emerald-50 shrink-0 flex items-center gap-1 cursor-pointer"
                      >
                        <span>{lang === 'zh' ? '获取 Key' : 'Get Key'}</span>
                        <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                      </a>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-body block uppercase tracking-wider">
                          {lang === 'zh' ? 'ZCode / BigModel API Key *' : 'ZCode / BigModel API Key *'}
                        </label>
                        <span className="text-[11px] text-slate-400 font-mono">格式如: xxxxxxxx.xxxxxxxx</span>
                      </div>
                      <input
                        type="text"
                        value={zcodeApiKey}
                        onChange={e => setZcodeApiKey(e.target.value)}
                        placeholder="xxxxxxxx.xxxxxxxx"
                        className="w-full px-4 py-2.5 rounded-xl border border-hairline bg-white/60 font-mono text-sm text-ink outline-none focus:border-ink/40 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-body mb-2 block uppercase tracking-wider">
                        {lang === 'zh' ? '账号备注 (可选)' : 'Account Alias (Optional)'}
                      </label>
                      <input
                        type="text"
                        value={zcodeAccountName}
                        onChange={e => setZcodeAccountName(e.target.value)}
                        placeholder={lang === 'zh' ? '例如：ZCode 主号 / 智谱' : 'e.g. ZCode Main'}
                        className="w-full px-4 py-2.5 rounded-xl border border-hairline bg-white/60 text-sm text-ink outline-none focus:border-ink/40 transition-colors"
                      />
                    </div>

                    <div className="pt-2 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={closeAddAccountModal}
                        className="px-4 py-2 text-sm font-semibold text-body border border-hairline rounded-lg hover:text-ink transition-colors cursor-pointer"
                      >
                        {lang === 'zh' ? '取消' : 'Cancel'}
                      </button>
                      <button
                        type="button"
                        onClick={handleAddZCodeManual}
                        disabled={!zcodeApiKey.trim() || addingAccount}
                        className="px-6 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 transition-all disabled:opacity-40 shadow-sm flex items-center gap-2 cursor-pointer"
                      >
                        {addingAccount && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                        {lang === 'zh' ? '接入 ZCode' : 'Connect ZCode'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-mode 2: Local Import */}
                {zcodeAuthMode === 'local' && (
                  <div className="space-y-4">
                    <div className="p-5 rounded-2xl bg-slate-50 border border-hairline space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[22px]">folder_open</span>
                        </div>
                        <div>
                          <div className="font-bold text-sm text-ink">{lang === 'zh' ? '选择本地 ZCode 凭据或配置文件自动读取' : 'Select Local ZCode Credentials'}</div>
                          <p className="text-xs text-body mt-0.5">
                            {lang === 'zh' ? '支持选择 credentials.json（自动解密真实 token）或 config.json' : 'Supports credentials.json (auto-decrypted) or config.json'}
                          </p>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl border-2 border-dashed border-emerald-200/80 bg-emerald-50/30 flex flex-col items-center justify-center gap-2 text-center">
                        <input
                          type="file"
                          id="zcode-config-upload"
                          accept=".json"
                          className="hidden"
                          onChange={handleZCodeConfigFileSelect}
                        />
                        <button
                          type="button"
                          onClick={() => document.getElementById('zcode-config-upload')?.click()}
                          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all"
                        >
                          <span className="material-symbols-outlined text-[18px]">upload_file</span>
                          <span>{lang === 'zh' ? '点击选择 credentials.json 或 config.json' : 'Choose credentials.json / config.json'}</span>
                        </button>
                        <span className="text-[11px] text-emerald-800">
                          {lang === 'zh' ? '通常位于 C:\\Users\\你的用户名\\.zcode\\v2\\credentials.json' : 'Usually at ~/.zcode/v2/credentials.json'}
                        </span>
                      </div>

                      {typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                        <div className="pt-3 border-t border-hairline flex items-center justify-between">
                          <span className="text-xs text-slate-500">{lang === 'zh' ? '检测到本地运行模式：可一键直读本机磁盘' : 'Localhost detected: can read direct path'}</span>
                          <button
                            type="button"
                            onClick={handleImportZCodeLocal}
                            disabled={importingZCodeLocal}
                            className="px-3 py-1.5 rounded-lg border border-emerald-200 text-xs font-bold text-emerald-800 hover:bg-emerald-50 cursor-pointer"
                          >
                            {importingZCodeLocal ? (lang === 'zh' ? '读取中...' : 'Reading...') : (lang === 'zh' ? '一键读取本机' : 'Read Direct')}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={closeAddAccountModal}
                        className="px-4 py-2 text-sm font-semibold text-body border border-hairline rounded-lg hover:text-ink transition-colors cursor-pointer"
                      >
                        {lang === 'zh' ? '取消' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-mode 3: Active ZCode CLI OAuth Flow */}
                {zcodeAuthMode === 'oauth' && (
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200/70 text-xs text-emerald-900 leading-relaxed space-y-1">
                      <div className="font-bold flex items-center gap-1.5 text-emerald-950">
                        <span className="material-symbols-outlined text-[17px] text-emerald-600">bolt</span>
                        <span>{lang === 'zh' ? 'ZCode 官方 CLI 免密网页授权（与 CreditDaddy 一致）' : 'ZCode Official CLI OAuth Flow'}</span>
                      </div>
                      <p>
                        {lang === 'zh'
                          ? '点击下方按钮发起官方授权流，在任意浏览器中扫码或登录智谱账号，网关将自动轮询并提取真实的 zcodejwttoken 与 access_token 入库，尊享完整特权！'
                          : 'Initiates official CLI OAuth. Log in on bigmodel.cn, gateway automatically captures real zcodejwttoken & access_token.'}
                      </p>
                    </div>

                    {zcodeOauthError && (
                      <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between">
                        <span>{zcodeOauthError}</span>
                        <button
                          type="button"
                          onClick={startZcodeOAuthFlow}
                          className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 cursor-pointer"
                        >
                          {lang === 'zh' ? '重试' : 'Retry'}
                        </button>
                      </div>
                    )}

                    {zcodeOauthLoading && (
                      <div className="p-8 rounded-xl border border-hairline bg-surface-ground flex flex-col items-center justify-center gap-3 text-center">
                        <span className="material-symbols-outlined text-[32px] text-emerald-600 animate-spin">progress_activity</span>
                        <div className="text-xs font-semibold text-body">
                          {lang === 'zh' ? '正在连接 zcode.z.ai 获取 CLI 登录令牌...' : 'Requesting CLI OAuth ticket...'}
                        </div>
                      </div>
                    )}

                    {!zcodeOauthLoading && !zcodeOauthData && (
                      <div className="p-6 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/40 flex flex-col items-center justify-center gap-3 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">
                          <span className="material-symbols-outlined text-[24px]">vpn_key</span>
                        </div>
                        <div>
                          <div className="font-bold text-sm text-ink">{lang === 'zh' ? '一键拉起智谱官方免密授权' : 'Initiate ZCode OAuth'}</div>
                          <div className="text-xs text-body mt-0.5">{lang === 'zh' ? '点击后将生成专属授权链接，在网页登录后自动同步' : 'Generates personal login link, auto-syncs after authorization'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={startZcodeOAuthFlow}
                          className="mt-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-700/20 flex items-center gap-2 cursor-pointer transition-all"
                        >
                          <span className="material-symbols-outlined text-[18px]">launch</span>
                          <span>{lang === 'zh' ? '立即发起授权' : 'Start Authorization'}</span>
                        </button>
                      </div>
                    )}

                    {!zcodeOauthLoading && zcodeOauthData && (
                      <div className="space-y-4">
                        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[16px] text-emerald-600">link</span>
                              {lang === 'zh' ? '授权链接已就绪' : 'Authorization Link Ready'}
                            </span>
                            <span className="font-mono text-[10px] text-emerald-700">Flow: {zcodeOauthData.flow_id.slice(0, 10)}...</span>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => window.open(zcodeOauthData.authorize_url, '_blank')}
                              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                            >
                              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                              <span>{lang === 'zh' ? '打开智谱授权网页登录' : 'Open in Browser'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(zcodeOauthData.authorize_url)
                                pushToast('SUCCESS', lang === 'zh' ? '已复制授权链接' : 'Link Copied', lang === 'zh' ? '请在浏览器中打开并完成登录' : 'Open in browser to complete login')
                              }}
                              className="px-4 py-2.5 border border-hairline bg-white hover:bg-slate-50 text-ink font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer transition-all"
                            >
                              <span className="material-symbols-outlined text-[16px]">content_copy</span>
                              <span>{lang === 'zh' ? '复制链接' : 'Copy'}</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-center gap-1.5 pt-1">
                          <div className="flex items-center gap-2 text-xs font-semibold text-body">
                            <span className="material-symbols-outlined text-[18px] animate-spin text-emerald-600">progress_activity</span>
                            <span>{lang === 'zh' ? '等待网页授权完成中...' : 'Waiting for authorization...'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={startZcodeOAuthFlow}
                            className="text-[11px] text-body hover:text-ink underline transition-colors cursor-pointer"
                          >
                            {lang === 'zh' ? '重新生成授权链接' : 'Regenerate link'}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={closeAddAccountModal}
                        className="px-4 py-2 text-sm font-semibold text-body border border-hairline rounded-lg hover:text-ink transition-colors cursor-pointer"
                      >
                        {lang === 'zh' ? '关闭' : 'Close'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} dismiss={dismissToast} />
    </div>
  )
}
