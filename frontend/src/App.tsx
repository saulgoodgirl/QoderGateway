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
}
interface AccountsConfig { accounts: Account[]; active_uid: string | null }
interface UIStatus { ready: boolean; mode: string; username: string | null; uid: string | null; user_type: string | null; error: string | null; accounts_count: number }
interface KeyDetail { api_key: string; name?: string; account_uid?: string }
interface APIConfig { auth_required: boolean; allowed_keys: string[]; allowed_keys_detail?: KeyDetail[] }
interface Message { role: 'user' | 'assistant'; content: string }
type TabId = 'dashboard' | 'accounts' | 'checkin' | 'playground' | 'api-keys' | 'logs' | 'register'
type AppTabId = TabId
type Lang = 'en' | 'zh'
type ToastType = 'SUCCESS' | 'ERROR' | 'INFO'
interface ToastItem { id: number; type: ToastType; title: string; message: string }

interface CheckinAccount {
  uid: string
  name: string
  plan: string
  claimed_today: boolean
  status_text: string
  reward_credits: number
  streak_days: number
  total_claim_days: number
  quota_info: {
    remaining: number
    total: number
    used: number
  } | null
  error: string | null
}

interface CheckinOverview {
  total_accounts: number
  claimed_count: number
  pending_count: number
  total_credits_claimed_today: number
  total_remaining_credits: number
  accounts: CheckinAccount[]
  last_auto_date: string | null
}

interface RegTask {
  stage: string
  logs: string[]
  result: { email: string; password: string; name: string; device: { token: string; refresh_token: string; user_id: string; expires_at: string } } | null
  error: string | null
  started_at: number
}
interface RegStatus {
  running: boolean
  stop_requested: boolean
  parents: number
  started_at: number | null
  verification: string | null
  stats: { success: number; failed: number; total: number }
  active: Record<string, RegTask>
  recent: Record<string, RegTask>
}

const NAV_ITEMS: { id: AppTabId; icon: string; label: string }[] = [
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { id: 'accounts', icon: 'account_balance_wallet', label: 'Account Pool' },
  { id: 'checkin', icon: 'card_giftcard', label: 'Daily Rewards' },
  { id: 'api-keys', icon: 'vpn_key', label: 'API Key Management' },
  { id: 'register', icon: 'person_add', label: 'Auto Registrar' },
  { id: 'logs', icon: 'list_alt', label: 'Logs' },
]

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
      dashboard: 'Dashboard', accounts: 'Account Pool', checkin: 'Daily Rewards', playground: 'AI Playground', apiKeys: 'API Key Management', logs: 'Logs', register: 'Auto Registrar',
    },
    breadcrumb: {
      dashboard: 'Control Panel / Overview', accounts: 'Console / Management', checkin: 'Console / Daily Rewards', playground: 'Playground / Experiment', apiKeys: 'Administration / Security', logs: 'System / Observability', docs: 'Developer Platform / Wiki', register: 'Automation / Registrar',
    },
    title: {
      dashboard: 'System Overview', accounts: 'Account Pool', checkin: 'Daily Rewards & Check-in', playground: 'AI Playground', apiKeys: 'API Management', logs: 'Service Logs', docs: 'Documentation', register: 'Auto Registrar',
    },
    common: { docs: 'Docs', support: 'Support', healthy: 'Healthy', offline: 'Offline', signOut: 'Sign Out', refresh: 'Refresh', add: 'Add', delete: 'Delete', copy: 'Copy' },
    dashboard: {
      serviceStatus: 'Service Status', allGatewaysActive: 'All gateways active', noActiveSession: 'No active session', accountPool: 'Account Pool', activeSessions: 'Active Qoder accounts', apiAuth: 'API Auth', openAccess: 'Open access', activeUser: 'Active User', systemBriefing: 'System Briefing', readyBrief: 'Gateway is running. {count} account(s) are available for routing.', notReadyBrief: 'No active session is available. Import an account or add a PAT first.', recentNotifications: 'Recent Notifications', authImportError: 'Auth Import Error', sessionActive: 'Session Active', credentialConfig: 'Credential Configuration', credentialDesc: 'Add a Qoder PAT or import the current local Qoder auth session.', patPlaceholder: 'Enter Qoder PAT...', addPat: 'Add PAT', saving: 'Saving...', autoImport: 'Auto Import',
    },
    accounts: { desc: 'Manage Qoder accounts used by the gateway. Toggle "API Routing" to include/exclude accounts from external calls while keeping daily check-ins active.', refreshStatus: 'Refresh Status', importAccounts: 'Import Accounts', search: 'Search accounts...', empty: 'No accounts imported. Click Import Accounts or add a PAT from Dashboard.', showing: 'Showing {count} account(s)' },
    checkin: {
      bannerTitle: 'Daily Rewards · 100 Credits Per Account',
      desc: 'Claim 100 free compute credits every day for each Qoder account. Background auto-worker runs daily at 00:05 (UTC+8) to claim automatically.',
      claimAll: 'Claim All Accounts Today',
      claiming: 'Claiming Rewards...',
      refresh: 'Refresh Status',
      allClaimedBadge: 'All accounts claimed today (+100 Credits each)',
      pendingBadge: 'Accounts pending claim today',
      statsClaimedRate: 'Claimed Today',
      statsCreditsToday: 'Credits Claimed Today',
      statsTotalCredits: 'Pool Remaining Credits',
      statsAutoSchedule: 'Auto Check-in Daemon',
      statsAutoScheduleDesc: 'Active · Runs daily at 00:05',
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
    register: {
      desc: 'Register multiple Qoder accounts in parallel, pull device credentials and auto-save them into the pool. Browsers stay hidden in the background; each task pops to top once for human verification, then hides again — finish one, next takes its turn.',
      start: 'Start Registration',
      starting: 'Starting...',
      running: 'Tasks running',
      idle: 'Idle',
      stageLabel: 'Stage',
      statusLabel: 'Status',
      logs: 'Live Logs',
      result: 'Registration Result (auto-imported)',
      noResult: 'No task has run yet',
      countLabel: 'Parent Threads',
      staggerHint: 'Each parent loops forever: 3 child tasks per batch, next batch starts automatically until you click stop',
      stop: 'Stop Registration',
      stopping: 'Stopping (after current batch)...',
      stopHint: 'Stops after the current batch finishes and reports this run\'s stats',
      verifyHint: 'Complete the human verification in the topmost browser window (slide the slider); next task takes over automatically',
      waiting: 'Waiting for human verification',
      task: 'Task',
      statsLabel: 'This Run Stats',
      success: 'Success',
      failed: 'Failed',
      total: 'Total',
      activeTasks: 'Running',
      recentTasks: 'Recent Done',
      stage: {
        idle: 'Idle', registering: 'Registering', waiting_slider: 'Waiting for human verification (topmost)', waiting_otp: 'Waiting for email code', device_auth: 'Device authorization', saving: 'Saving to DB', success: 'Success', failed: 'Failed',
      },
    },
  },
  zh: {
    nav: {
      dashboard: '控制台', accounts: '账号池', checkin: '每日签到', playground: '调试对话', apiKeys: 'API Key 管理', logs: '服务日志', register: '自动注册机',
    },
    breadcrumb: {
      dashboard: '控制台 / 概览', accounts: '控制台 / 账号管理', checkin: '控制台 / 每日签到', playground: '调试 / 对话测试', apiKeys: '管理 / 安全', logs: '系统 / 日志', docs: '开发者平台 / 文档', register: '自动化 / 注册机',
    },
    title: {
      dashboard: '系统概览', accounts: '账号池', checkin: '每日签到 · 积分中心', playground: '调试对话', apiKeys: 'API 管理', logs: '服务日志', docs: '文档', register: '自动注册机',
    },
    common: { docs: '文档', support: '支持', healthy: '正常', offline: '未就绪', signOut: '退出', refresh: '刷新', add: '添加', delete: '删除', copy: '复制' },
    dashboard: {
      serviceStatus: '服务状态', allGatewaysActive: '网关可用', noActiveSession: '没有可用账号', accountPool: '账号池', activeSessions: '可参与路由的 Qoder 账号', apiAuth: 'API 鉴权', openAccess: '未开启鉴权', activeUser: '当前账号', systemBriefing: '运行状态', readyBrief: '网关正在运行，当前有 {count} 个账号可用于请求路由。', notReadyBrief: '当前没有可用会话，请先导入账号或添加 PAT。', recentNotifications: '最近状态', authImportError: '本地登录导入失败', sessionActive: '账号已连接', credentialConfig: '凭据配置', credentialDesc: '添加 Qoder PAT，或导入本机已有的 Qoder 登录会话。', patPlaceholder: '输入 Qoder PAT...', addPat: '添加 PAT', saving: '保存中...', autoImport: '自动导入',
    },
    accounts: { desc: '管理网关用于请求路由和失败切换的 Qoder 账号。可单独控制账号是否参与 API 调用调度（排除调用仍享每日自动签到与令牌保活）。', refreshStatus: '刷新状态', importAccounts: '导入账号', search: '搜索账号...', empty: '还没有导入账号。点击导入账号，或在控制台添加 PAT。', showing: '共 {count} 个账号' },
    checkin: {
      bannerTitle: '每日签到福利 · 每个账号 +100 Credits',
      desc: '每个 Qoder 账号每天可免费领取 100 算力 Credits。网关后台守护线程将在每日 00:05（北京时间）自动执行签到补领，也可随时一键为全部账号领完。',
      claimAll: '一键签到全部账号',
      claiming: '正在签到领取中...',
      refresh: '刷新签到状态',
      allClaimedBadge: '今日已全部完成签到 (算力已到账)',
      pendingBadge: '今日有待签到账号，点击一键领取',
      statsClaimedRate: '今日签到进度',
      statsCreditsToday: '今日已领算力',
      statsTotalCredits: '账号池可用总算力',
      statsAutoSchedule: '自动签到守护',
      statsAutoScheduleDesc: '运行中 · 每日 00:05 定时执行',
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
    register: {
      desc: '并行注册多个 Qoder 账号并拉取 Device 凭据，成功后自动入库。浏览器平时隐藏后台，人机验证时置顶显示，划完一个自动轮到下一个。',
      start: '开始注册',
      starting: '启动中...',
      running: '任务运行中',
      idle: '空闲',
      stageLabel: '阶段',
      statusLabel: '状态',
      logs: '实时日志',
      result: '注册结果（已自动入库）',
      noResult: '尚未运行注册任务',
      countLabel: '母线程数',
      staggerHint: '每个母线程无限循环：每批 3 个子任务并发，注册完一批自动开下一批，直到点击停止',
      stop: '停止注册',
      stopping: '停止中（当前批完成后停）...',
      stopHint: '当前批次完成后停止，统计本次注册数',
      verifyHint: '请在置顶的浏览器窗口中完成人机验证（滑动滑块），划完自动轮到下一个',
      waiting: '等待人工验证',
      task: '任务',
      statsLabel: '本次注册统计',
      success: '成功',
      failed: '失败',
      total: '总计',
      activeTasks: '运行中任务',
      recentTasks: '最近完成',
      stage: {
        idle: '空闲', registering: '正在注册', waiting_slider: '等待人机验证（已置顶）', waiting_otp: '等待邮箱验证码', device_auth: 'Device 授权中', saving: '入库中', success: '注册成功', failed: '失败',
      },
    },
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

  const [activeTab, setActiveTab] = useState<AppTabId>('dashboard')
  const [status, setStatus] = useState<UIStatus>({ ready: false, mode: 'none', username: null, uid: null, user_type: null, error: null, accounts_count: 0 })
  const [accountsConfig, setAccountsConfig] = useState<AccountsConfig>({ accounts: [], active_uid: null })
  const [apiConfig, setApiConfig] = useState<APIConfig>({ auth_required: false, allowed_keys: [] })
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

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

  const [regStatus, setRegStatus] = useState<RegStatus | null>(null)
  const [regStarting, setRegStarting] = useState(false)
  const [regStopping, setRegStopping] = useState(false)
  const [regCount, setRegCount] = useState(2)

  const [checkinData, setCheckinData] = useState<CheckinOverview | null>(null)
  const [loadingCheckin, setLoadingCheckin] = useState(false)
  const [claimingCheckin, setClaimingCheckin] = useState(false)
  const [claimingUid, setClaimingUid] = useState<string | null>(null)

  const [showAddAccountModal, setShowAddAccountModal] = useState(false)
  const [addAccountTab, setAddAccountTab] = useState<'pat' | 'batch' | 'local'>('pat')
  const [addAccountPat, setAddAccountPat] = useState('')
  const [addAccountName, setAddAccountName] = useState('')
  const [addingAccount, setAddingAccount] = useState(false)

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
    playground: t.nav.playground,
    'api-keys': t.nav.apiKeys,
    logs: t.nav.logs,
    register: t.nav.register,
  }
  const pageMeta: Record<AppTabId, { bc: string; title: string }> = {
    dashboard: { bc: t.breadcrumb.dashboard, title: t.title.dashboard },
    accounts: { bc: t.breadcrumb.accounts, title: t.title.accounts },
    checkin: { bc: t.breadcrumb.checkin, title: t.title.checkin },
    playground: { bc: t.breadcrumb.playground, title: t.title.playground },
    'api-keys': { bc: t.breadcrumb.apiKeys, title: t.title.apiKeys },
    logs: { bc: t.breadcrumb.logs, title: t.title.logs },
    register: { bc: t.breadcrumb.register, title: t.title.register },
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
    } catch { pushToast('ERROR', lang === 'zh' ? '限额查询失败' : 'Quota query failed', '') }
  }, [authedFetch, lang, pushToast])

  const fetchLogs = useCallback(async () => {
    try { const resp = await authedFetch('/ui/logs'); const data = await resp.json(); setLogs(data) } catch { /* */ }
  }, [authedFetch])
  const fetchRegStatus = useCallback(async () => {
    try { const resp = await authedFetch('/ui/registrar/status'); const data = await resp.json(); setRegStatus(data) } catch { /* */ }
  }, [authedFetch])
  const startRegister = useCallback(async () => {
    if (regStatus?.running) return
    setRegStarting(true)
    try {
      const resp = await authedFetch('/ui/registrar/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parents: regCount }),
      })
      const data = await resp.json()
      if (data.ok) {
        pushToast('INFO', lang === 'zh' ? '注册已开始（无限循环）' : 'Registration started (looping)', lang === 'zh' ? `${data.parents} 个母线程，每个 3 子任务并发，请完成置顶的人机验证` : `${data.parents} parent threads x 3 workers, complete the topmost human verification`)
        fetchRegStatus()
      } else {
        pushToast('ERROR', lang === 'zh' ? '启动失败' : 'Start failed', data.error || '')
      }
    } catch { pushToast('ERROR', lang === 'zh' ? '启动失败' : 'Start failed', '') } finally { setRegStarting(false) }
  }, [authedFetch, fetchRegStatus, pushToast, regStatus?.running, lang, regCount])

  const stopRegister = useCallback(async () => {
    if (!regStatus?.running || regStopping) return
    setRegStopping(true)
    try {
      const resp = await authedFetch('/ui/registrar/stop', { method: 'POST' })
      const data = await resp.json()
      if (data.ok) {
        pushToast('INFO', lang === 'zh' ? '停止请求已发送' : 'Stop requested', lang === 'zh' ? '当前批次完成后停止' : 'Stops after the current batch')
      } else {
        pushToast('ERROR', lang === 'zh' ? '取消失败' : 'Stop failed', data.error || '')
      }
    } catch { pushToast('ERROR', lang === 'zh' ? '取消失败' : 'Stop failed', '') } finally { setRegStopping(false) }
  }, [authedFetch, pushToast, regStatus?.running, regStopping, lang])

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
    if (!token) return
    fetchStatus(); fetchAccounts(); fetchApiConfig(); fetchLogs(); fetchRegStatus(); fetchCheckinStatus()
    const si = setInterval(fetchStatus, 6000)
    const li = setInterval(() => { if (activeTab === 'logs') fetchLogs() }, 3000)
    const ri = setInterval(() => { if (activeTab === 'register' && regStatus?.running) fetchRegStatus() }, 2000)
    const ci = setInterval(() => { if (activeTab === 'checkin') fetchCheckinStatus() }, 8000)
    return () => { clearInterval(si); clearInterval(li); clearInterval(ri); clearInterval(ci) }
  }, [token, activeTab, fetchStatus, fetchAccounts, fetchApiConfig, fetchLogs, fetchRegStatus, fetchCheckinStatus, regStatus?.running])

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

  const handleAddAccountPat = async () => {
    const trimmed = addAccountPat.trim()
    if (!trimmed) return
    setAddingAccount(true)
    try {
      const resp = await authedFetch('/ui/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pat: trimmed, name: addAccountName.trim() || undefined }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'PAT verification failed')
      }
      const data = await resp.json()
      pushToast('SUCCESS', lang === 'zh' ? '账号已成功添加' : 'Account Added Successfully', msg.patAdded(data.name || 'PAT Account'))
      setAddAccountPat('')
      setAddAccountName('')
      setShowAddAccountModal(false)
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
              <h1 className="font-display-lg text-ink tracking-tight">QoderGate</h1>
              <p className="text-[12px] font-semibold text-on-surface-variant mt-2 uppercase tracking-widest">{lang === 'zh' ? '管理控制台' : 'Management Console'}</p>
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
            <span className="text-[10px] tracking-widest text-ink uppercase">v2.4.0 stable</span>
            <span className="text-[10px] tracking-widest text-ink uppercase">Status: Operational</span>
          </div>
        </main>
      </div>
    )
  }

  // ─── MAIN LAYOUT ───
  const { bc, title } = pageMeta[activeTab]

  return (
    <div className="bg-surface min-h-screen relative">
      <div ref={el => { orbRefs.current[2] = el }} className="orb bg-mint w-[500px] h-[500px] -top-24 -right-24"></div>
      <div ref={el => { orbRefs.current[3] = el }} className="orb bg-peach w-[400px] h-[400px] bottom-0 left-[20%]"></div>

      <aside ref={sidebarRef} className="fixed left-0 top-0 h-screen w-[280px] bg-surface border-r border-hairline flex flex-col p-6 z-50">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-ink rounded-lg flex items-center justify-center"><span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>gate</span></div>
          <div><h1 className="font-display-sm text-ink leading-none">QoderGate</h1><p className="text-[10px] uppercase tracking-widest text-body opacity-60">{lang === 'zh' ? '管理控制台' : 'Management Console'}</p></div>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium w-full text-left ${activeTab === item.id ? 'bg-canvas-soft text-ink font-bold' : 'text-body hover:bg-canvas-soft'}`}>
              <span className="material-symbols-outlined" style={{ fontVariationSettings: activeTab === item.id ? "'FILL' 1" : "" }}>{item.icon}</span>{navLabels[item.id]}
            </button>
          ))}
        </nav>
        <div className="pt-8 border-t border-hairline">
          <div className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${status.ready ? 'bg-mint animate-pulse' : 'bg-red-400'}`}></span>
              <span className="text-xs font-semibold text-body">{status.ready ? t.common.healthy : t.common.offline}</span>
            </div>
            <button onClick={handleLogout} className="text-xs font-bold text-body hover:text-red-600 transition-colors">{t.common.signOut}</button>
          </div>
        </div>
      </aside>

      <main className="ml-[280px] min-h-screen flex flex-col relative z-10">
        <header className="flex justify-between items-center h-24 px-8 w-full border-b border-hairline bg-transparent sticky top-0 z-40 backdrop-blur-sm">
          <div>
            <span className="text-[12px] font-semibold text-body uppercase opacity-60 tracking-[0.96px]">{bc}</span>
            <h2 className="font-display-lg text-ink">{title}</h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-8 text-body text-[16px]">
              <a href="/documents" className="hover:text-ink transition-colors cursor-pointer">{t.common.docs}</a>
              <button onClick={() => switchLang(lang === 'zh' ? 'en' : 'zh')} className="hover:text-ink transition-colors cursor-pointer">{lang === 'zh' ? 'English' : '中文'}</button>
              <a className="hover:text-ink transition-colors cursor-pointer">{t.common.support}</a>
            </div>
            <div className="flex items-center gap-4">
              <button className="p-2 text-body hover:text-ink transition-colors"><span className="material-symbols-outlined">notifications</span></button>
              <div className="w-10 h-10 rounded-full bg-hairline flex items-center justify-center border border-hairline-strong text-xs font-bold text-ink">{status.username ? status.username[0].toUpperCase() : 'Q'}</div>
            </div>
          </div>
        </header>

        <div ref={contentBodyRef} className="flex-1 p-8 w-full">
          {/* ─── DASHBOARD ─── */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              <section ref={statCardsRef} className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: t.dashboard.serviceStatus, value: status.ready ? t.common.healthy : t.common.offline, detail: status.ready ? t.dashboard.allGatewaysActive : t.dashboard.noActiveSession, dot: status.ready ? 'bg-mint' : 'bg-red-400' },
                  { label: t.dashboard.accountPool, value: String(status.accounts_count || 0), detail: t.dashboard.activeSessions },
                  { label: t.dashboard.apiAuth, value: apiConfig.auth_required ? (lang === 'zh' ? '已开启' : 'Enabled') : (lang === 'zh' ? '未开启' : 'Disabled'), detail: apiConfig.auth_required ? `${apiConfig.allowed_keys.length} keys active` : t.dashboard.openAccess },
                  { label: t.dashboard.activeUser, value: status.username || (lang === 'zh' ? '无' : 'None'), detail: status.user_type || 'N/A' }
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
                  <div className="font-display-md text-ink mb-4 max-w-lg">{status.ready ? t.dashboard.readyBrief.replace('{count}', String(status.accounts_count)) : t.dashboard.notReadyBrief}</div>
                  <div className="mt-auto bg-ink/5 p-4 rounded-lg border border-hairline-strong" ref={terminalRef}>
                    <code className="text-sm font-mono text-ink">
                      <span className="text-primary font-bold">system@qodergate:~$</span> status --check --all<br />
                      <span className="term-line opacity-70">Checking nodes... [{status.ready ? 'OK' : 'FAIL'}]<br /></span>
                      <span className="term-line opacity-70">Validating certificates... [OK]<br /></span>
                      <span className="term-line opacity-70">Routing traffic to nearest node...</span><span className="cursor-blink">_</span>
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
                  <button onClick={() => setShowAddAccountModal(true)} className="flex items-center gap-2 px-6 py-2.5 bg-ink text-white rounded-lg hover:bg-neutral-800 transition-all font-bold text-sm shadow-md">
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
                    placeholder='[{ "user_id": "019f...", "name": "...", "email": "...", "token": "dt-...", "refresh_token": "drt-...", "expires_at": "..." }]'
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

              <section className="flex items-center gap-6">
                <div className="relative flex-grow max-w-md group">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-body opacity-50 group-focus-within:opacity-100 transition-opacity">search</span>
                  <CustomInput value={searchAccounts} onChange={setSearchAccounts} placeholder={t.accounts.search} className="!pl-12 !py-3 !rounded-xl !bg-white/50" />
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
                      {lang === 'zh' ? '（例如 ' : ' (e.g. '}
                      <code className="bg-black/5 px-1.5 py-0.5 rounded font-mono text-ink font-semibold">kimi-k3@风思黏</code>
                      {lang === 'zh'
                        ? '），网关将自动定向单独调用该账号！亦可通过专属 API Key 绑定或 Header: X-Account 触发。'
                        : '), and the gateway directs the call to that account!'}
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
                        'UID',
                        lang === 'zh' ? '类型 / 配额' : 'Plan / Quota',
                        lang === 'zh' ? '状态' : 'Status',
                        lang === 'zh' ? 'API 调度模式' : 'API Routing Mode',
                        lang === 'zh' ? '账号总启用' : 'Enabled',
                        lang === 'zh' ? '操作' : 'Actions',
                      ].map((h, i) => (
                        <th key={i} className={`px-6 py-4 text-[10px] font-semibold text-body uppercase tracking-wider ${i === 4 || i === 5 ? 'text-center' : i === 6 ? 'text-right' : ''}`}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {accountsConfig.accounts.length === 0 ? (
                        <tr><td colSpan={7} className="py-8 text-center text-xs text-body font-medium">{t.accounts.empty}</td></tr>
                      ) : accountsConfig.accounts
                        .filter(acc => !searchAccounts || acc.name.toLowerCase().includes(searchAccounts.toLowerCase()) || acc.uid.includes(searchAccounts))
                        .map((acc) => {
                          const isActive = accountsConfig.active_uid === acc.uid
                          const currentMode = acc.api_mode || (acc.api_enabled !== false ? 'all' : 'disabled')
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
                                  </div>
                                  <div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const modelName = `kimi-k3@${acc.name}`
                                        navigator.clipboard.writeText(modelName)
                                        pushToast('INFO', lang === 'zh' ? '已复制定向模型名' : 'Copied Target Model', lang === 'zh' ? `在客户端输入 ${modelName} 即可单独调用该账号！` : `Use ${modelName} in clients to call this account!`)
                                      }}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/5 hover:bg-black/10 text-ink font-mono text-[10px] transition-colors"
                                      title={lang === 'zh' ? '点击复制定向模型名 (例如: kimi-k3@账号名)' : 'Click to copy targeted model name'}
                                    >
                                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                                      <span>@{acc.name}</span>
                                    </button>
                                  </div>
                                </div>
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
          {activeTab === 'checkin' && (
            <div className="space-y-8">
              {/* Hero Banner */}
              <section className="relative overflow-hidden rounded-2xl border border-hairline bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-emerald-500/10 p-8 backdrop-blur-md">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
                  <div className="flex items-start gap-5">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/20 shrink-0">
                      <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-display-md text-ink">{t.checkin.bannerTitle}</h3>
                        {((checkinData?.pending_count ?? 0) === 0 && (checkinData?.total_accounts ?? 0) > 0) ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            {t.checkin.allClaimedBadge}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                            {t.checkin.pendingBadge}
                          </span>
                        )}
                      </div>
                      <p className="text-body text-sm mt-2 max-w-2xl leading-relaxed">{t.checkin.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={fetchCheckinStatus}
                      disabled={loadingCheckin}
                      className="flex items-center gap-2 px-4 py-3 text-body hover:text-ink transition-colors font-bold text-sm bg-white/70 hover:bg-white border border-hairline rounded-xl cursor-pointer"
                    >
                      <span className={`material-symbols-outlined text-[18px] ${loadingCheckin ? 'animate-spin' : ''}`}>refresh</span>
                      {t.checkin.refresh}
                    </button>
                    <button
                      onClick={doClaimAllCheckin}
                      disabled={claimingCheckin || ((checkinData?.pending_count ?? 0) === 0 && (checkinData?.total_accounts ?? 0) > 0)}
                      className="flex items-center gap-2.5 px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl transition-all font-bold text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {claimingCheckin ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>{t.checkin.claiming}</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>stars</span>
                          <span>{t.checkin.claimAll}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </section>

              {/* 4 Stats Cards */}
              <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                    <span>{t.checkin.statsClaimedRate}</span>
                    <span className="material-symbols-outlined text-base text-emerald-500">task_alt</span>
                  </div>
                  <div className="text-3xl font-bold text-ink">
                    {checkinData?.claimed_count ?? 0}
                    <span className="text-base font-normal text-body ml-1">/ {checkinData?.total_accounts ?? 0}</span>
                  </div>
                  <div className="mt-3 w-full bg-hairline h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(checkinData?.total_accounts ?? 0) > 0 ? ((checkinData?.claimed_count ?? 0) / (checkinData?.total_accounts ?? 1)) * 100 : 0}%`
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
                    +{checkinData?.total_credits_claimed_today ?? 0}
                    <span className="text-xs font-semibold text-body ml-1 uppercase">Credits</span>
                  </div>
                  <div className="text-xs text-body mt-2">
                    {lang === 'zh' ? '每个账号单次奖励 100 Credits' : '+100 credits per successful account'}
                  </div>
                </div>

                <div className="bg-surface-card border border-hairline p-6 rounded-2xl hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-body uppercase tracking-wider mb-2">
                    <span>{t.checkin.statsTotalCredits}</span>
                    <span className="material-symbols-outlined text-base text-purple-500">token</span>
                  </div>
                  <div className="text-3xl font-bold text-ink">
                    {checkinData?.total_remaining_credits?.toLocaleString() ?? '--'}
                    <span className="text-xs font-semibold text-body ml-1 uppercase">Credits</span>
                  </div>
                  <div className="text-xs text-body mt-2">
                    {lang === 'zh' ? '账号池可用总剩余算力' : 'Total remaining across all pool accounts'}
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
                    <span>每日 00:05</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-mint/20 text-ink font-bold">ACTIVE</span>
                  </div>
                  <div className="text-xs text-body mt-2">
                    {t.checkin.statsAutoScheduleDesc}
                  </div>
                </div>
              </section>

              {/* Accounts Table */}
              <section className="glass-card rounded-2xl border border-hairline overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-canvas-soft/30">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-ink text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
                    <h4 className="text-sm font-bold text-ink">{t.checkin.tableTitle}</h4>
                  </div>
                  <div className="text-xs text-body">
                    {lang === 'zh' ? `共 ${checkinData?.accounts?.length ?? 0} 个账号` : `${checkinData?.accounts?.length ?? 0} accounts`}
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
                      {(!checkinData?.accounts || checkinData.accounts.length === 0) ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-xs text-body">
                            {t.checkin.empty}
                          </td>
                        </tr>
                      ) : (
                        checkinData.accounts.map((acc) => (
                          <tr key={acc.uid} className="hover:bg-canvas-soft transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-bold text-ink">{acc.name}</div>
                              <div className="font-mono text-[11px] text-body opacity-60 select-all">{acc.uid}</div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-neutral-100 text-neutral-700 capitalize">
                                {acc.plan || 'Teams'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              {acc.claimed_today ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                  <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                  {t.checkin.claimedStatus}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                                  {t.checkin.pendingStatus}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 font-mono text-sm text-ink">
                              {acc.streak_days} <span className="text-xs text-body font-normal">{lang === 'zh' ? '天' : 'days'}</span>
                            </td>
                            <td className="px-6 py-4">
                              {acc.quota_info ? (
                                <div className="space-y-1">
                                  <div className="font-mono text-xs font-semibold text-ink">
                                    {acc.quota_info.remaining?.toLocaleString()} <span className="text-[10px] text-body font-normal">/ {acc.quota_info.total?.toLocaleString()} Credits</span>
                                  </div>
                                  <div className="w-28 bg-hairline h-1.5 rounded-full overflow-hidden">
                                    <div
                                      className="bg-mint h-full rounded-full"
                                      style={{
                                        width: `${Math.min(100, Math.max(5, (acc.quota_info.remaining / (acc.quota_info.total || 1)) * 100))}%`
                                      }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs font-mono text-body">--</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
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
                                    <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    ...
                                  </span>
                                ) : acc.claimed_today ? (
                                  (lang === 'zh' ? '今日已签' : 'Claimed')
                                ) : (
                                  t.checkin.btnClaimOne
                                )}
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

              <div className="grid grid-cols-12 gap-8">
                <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
                  <div className="glass-card p-8 rounded-2xl flex flex-col justify-between min-h-[220px]">
                    <div><h3 className="font-bold text-ink text-lg mb-2">{t.api.gatewayAuth}</h3><p className="text-body text-sm">{t.api.gatewayAuthDesc}</p></div>
                    <div className="flex items-center justify-between pt-6 border-t border-hairline mt-auto">
                      <span className="text-[10px] font-bold text-body uppercase tracking-widest">{t.api.systemStatus}</span>
                      <button className={`w-11 h-6 rounded-full p-0.5 transition-colors relative ${apiConfig.auth_required ? 'bg-ink' : 'bg-hairline-strong'}`} onClick={handleToggleAuth}>
                        <div className={`w-5 h-5 bg-white rounded-full transition-transform duration-200 ${apiConfig.auth_required ? 'translate-x-5' : 'translate-x-0'}`}></div>
                      </button>
                    </div>
                  </div>
                  <div className="glass-card p-4 rounded-xl">
                    <span className="text-[10px] font-bold text-body uppercase tracking-widest">{t.api.activeKeys}</span>
                    <div className="mt-2 flex items-baseline gap-2"><span className="font-display-sm text-ink">{apiConfig.allowed_keys.length}</span><span className="text-[10px] text-body font-bold">{t.api.configured}</span></div>
                  </div>
                </div>
                <div className="col-span-12 lg:col-span-8 glass-card rounded-2xl overflow-hidden flex flex-col shadow-sm">
                  <div className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-hairline">
                    <div>
                      <span className="font-bold text-ink">{t.api.activeAccessKeys}</span>
                      <p className="text-[11px] text-body">{lang === 'zh' ? '可为单个 Key 绑定专属账号，或保持默认全账号轮询。' : 'Keys can be bound to a single account or load-balanced across all.'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      <CustomInput value={newKey} onChange={setNewKey} placeholder={t.api.keyPlaceholder} className="!w-48 !py-2 !bg-canvas-soft !border-hairline" mono />
                      <select
                        value={newKeyAccount}
                        onChange={(e) => setNewKeyAccount(e.target.value)}
                        className="text-xs font-semibold px-2.5 py-2 rounded-xl border border-hairline bg-canvas-soft text-ink outline-none cursor-pointer"
                        title={lang === 'zh' ? '选择该 Key 绑定的目标账号' : 'Select target account for this key'}
                      >
                        <option value="">{lang === 'zh' ? '🌐 全部账号 (默认)' : '🌐 All Accounts'}</option>
                        {accountsConfig.accounts.map(a => (
                          <option key={a.uid} value={a.uid}>
                            {a.user_type === 'enterprise' || a.plan === 'team' ? '🏢 [企业] ' : '👤 [个人] '}{a.name} ({a.quota} credits)
                          </option>
                        ))}
                      </select>
                      <button onClick={handleAddKey} disabled={!newKey.trim()} className="bg-ink text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-neutral-800 transition-all disabled:opacity-50 shrink-0">{t.common.add}</button>
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

                const copyAllModelsText = () => {
                  const allIds = VERIFIED_MODELS.map(m => m.id).join(', ')
                  navigator.clipboard.writeText(allIds)
                  pushToast('SUCCESS', lang === 'zh' ? '已复制全部模型' : 'Copied All Models', lang === 'zh' ? '已复制 14 款可用模型名称' : 'Copied 14 model IDs')
                }

                const copyCurlCommand = () => {
                  const cmd = `curl https://lite.bigbob.asia/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${activeKey || 'YOUR_API_KEY'}" \\\n  -d '{"model": "kimi-k3", "messages": [{"role": "user", "content": "你好"}]}'`
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
                            value="https://lite.bigbob.asia/v1"
                            readOnly
                            className="w-full h-10 bg-white border border-hairline rounded-lg px-3 text-xs font-mono text-ink outline-none select-all"
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText('https://lite.bigbob.asia/v1')
                              pushToast('INFO', lang === 'zh' ? '已复制 Base URL' : 'Copied Base URL', 'https://lite.bigbob.asia/v1')
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
                              navigator.clipboard.writeText('https://lite.bigbob.asia/v1/chat/completions')
                              pushToast('INFO', lang === 'zh' ? '已复制端点' : 'Copied Endpoint', 'https://lite.bigbob.asia/v1/chat/completions')
                            }}
                            className="text-ink font-semibold select-all hover:underline cursor-pointer"
                            title="点击复制完整端点"
                          >
                            https://lite.bigbob.asia/v1/chat/completions
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

          {/* ─── AUTO REGISTRAR ─── */}
          {activeTab === 'register' && (
            <div className="space-y-6">
              <div className="relative z-[4000] flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white/60 backdrop-blur-md border border-hairline rounded-2xl">
                <div>
                  <h2 className="text-lg font-semibold text-ink">{t.title.register}</h2>
                  <p className="text-sm text-body mt-1 max-w-2xl">{t.register.desc}</p>
                  <p className="text-xs text-body opacity-70 mt-1">{t.register.staggerHint}</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{t.register.countLabel}</span>
                    <div className="flex bg-white border border-hairline rounded-xl p-1 gap-1">
                      {[1, 2, 3, 4].map(n => (
                        <button
                          key={n}
                          onClick={() => setRegCount(n)}
                          disabled={regStatus?.running}
                          className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${regCount === n ? 'bg-ink text-white' : 'text-body hover:bg-black/5'}`}
                        >{n}</button>
                      ))}
                    </div>
                  </div>
                  {regStatus?.running ? (
                    <button
                      onClick={stopRegister}
                      disabled={regStopping || regStatus?.stop_requested}
                      className={`h-11 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm font-bold text-sm ${regStopping || regStatus?.stop_requested ? 'bg-neutral-300 text-neutral-500 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}
                    >
                      <span className="material-symbols-outlined text-sm">stop_circle</span>
                      <span>{regStopping ? t.register.stopping : regStatus?.stop_requested ? t.register.stopping : t.register.stop}</span>
                    </button>
                  ) : (
                    <button
                      onClick={startRegister}
                      disabled={regStarting}
                      className={`h-11 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm font-bold text-sm ${regStarting ? 'bg-neutral-300 text-neutral-500 cursor-not-allowed' : 'bg-ink text-white hover:bg-neutral-800'}`}
                    >
                      <span className="material-symbols-outlined text-sm">person_add</span>
                      <span>{regStarting ? t.register.starting : t.register.start}</span>
                    </button>
                  )}
                </div>
              </div>

              {regStatus?.verification && regStatus?.running && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-800 flex items-center gap-2 animate-pulse">
                  <span className="material-symbols-outlined text-base">touch_app</span>
                  <span>{t.register.verifyHint}（{t.register.task} {regStatus.verification}）</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-6 bg-white/60 backdrop-blur-md border border-hairline rounded-2xl">
                  <label className="text-[11px] font-semibold text-body uppercase opacity-60 tracking-wider">{t.register.statsLabel}</label>
                  <div className="mt-2 text-3xl font-bold text-ink">{regStatus?.stats?.total ?? 0}</div>
                </div>
                <div className="p-6 bg-white/60 backdrop-blur-md border border-hairline rounded-2xl">
                  <label className="text-[11px] font-semibold text-emerald-600 uppercase opacity-80 tracking-wider">{t.register.success}</label>
                  <div className="mt-2 text-3xl font-bold text-emerald-600">{regStatus?.stats?.success ?? 0}</div>
                </div>
                <div className="p-6 bg-white/60 backdrop-blur-md border border-hairline rounded-2xl">
                  <label className="text-[11px] font-semibold text-red-600 uppercase opacity-80 tracking-wider">{t.register.failed}</label>
                  <div className="mt-2 text-3xl font-bold text-red-600">{regStatus?.stats?.failed ?? 0}</div>
                </div>
                <div className="p-6 bg-white/60 backdrop-blur-md border border-hairline rounded-2xl">
                  <label className="text-[11px] font-semibold text-body uppercase opacity-60 tracking-wider">{lang === 'zh' ? '启动时间' : 'Started At'}</label>
                  <div className="mt-2 font-mono text-sm text-ink">{regStatus?.started_at ? new Date(regStatus.started_at * 1000).toLocaleTimeString() : '—'}</div>
                </div>
              </div>

              {(() => {
                const allTasks = { ...(regStatus?.active || {}), ...(regStatus?.recent || {}) }
                const entries = Object.entries(allTasks)
                if (entries.length === 0) {
                  return <div className="p-10 text-center text-sm text-body bg-white/60 backdrop-blur-md border border-hairline rounded-2xl">{t.register.noResult}</div>
                }
                return entries.map(([tid, task]) => {
                  const stageText = (t.register.stage as Record<string, string>)[task.stage] || task.stage
                  const isVerify = regStatus?.verification === tid
                  const isActive = !!regStatus?.active?.[tid]
                  return (
                    <div key={tid} className={`relative z-0 bg-white/80 backdrop-blur-xl border rounded-2xl overflow-hidden ${isVerify ? 'border-amber-400 ring-2 ring-amber-200' : 'border-hairline'}`}>
                      <div className="px-6 py-4 border-b border-hairline flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-ink">{t.register.task} {tid}</span>
                          <span className={`px-2 py-1 rounded text-[11px] font-bold uppercase ${task.stage === 'success' ? 'bg-emerald-100 text-emerald-700' : task.stage === 'failed' ? 'bg-red-50 text-red-700' : task.stage === 'waiting_slider' ? 'bg-amber-100 text-amber-700' : 'bg-neutral-100 text-neutral-600'}`}>{stageText}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-body font-mono">
                          <span className={`h-2.5 w-2.5 rounded-full inline-block ${isActive ? (task.stage === 'success' ? 'bg-emerald-500' : task.stage === 'failed' ? 'bg-red-500' : 'bg-amber-400 animate-pulse') : 'bg-neutral-300'}`} />
                          <span>{task.started_at ? new Date(task.started_at * 1000).toLocaleTimeString() : ''}</span>
                        </div>
                      </div>
                      <div className="p-6 h-48 overflow-y-auto font-mono text-[13px] leading-relaxed text-ink opacity-80 space-y-1">
                        {task.logs.slice().reverse().map((line, i) => (
                          <div key={i} className={`break-all ${/FAILED|ERROR/i.test(line) ? 'text-red-600' : ''}`}>{line}</div>
                        ))}
                      </div>
                      {task.result && (
                        <div className="px-6 pb-6 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-t border-hairline">
                          {[
                            { label: lang === 'zh' ? '邮箱' : 'Email', value: task.result.email },
                            { label: lang === 'zh' ? '密码' : 'Password', value: task.result.password },
                            { label: lang === 'zh' ? '姓名' : 'Name', value: task.result.name },
                            { label: 'Token (dt-)', value: task.result.device.token },
                            { label: 'Refresh (drt-)', value: task.result.device.refresh_token },
                            { label: 'UID', value: task.result.device.user_id },
                          ].map((f, i) => (
                            <div key={i}>
                              <div className="text-[11px] font-semibold text-body uppercase opacity-60 tracking-wider">{f.label}</div>
                              <div className="mt-1 font-mono text-ink break-all">{f.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {task.error && (
                        <div className="px-6 pb-6 text-sm text-red-700">{task.error}</div>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>
      </main>

      {/* ─── ADD ACCOUNT MODAL ─── */}
      {showAddAccountModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-card border border-hairline rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-hairline">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-ink text-[22px]">person_add</span>
                <h3 className="font-bold text-base text-ink">{lang === 'zh' ? '添加 Qoder 账号' : 'Add Qoder Account'}</h3>
              </div>
              <button
                onClick={() => setShowAddAccountModal(false)}
                className="text-body hover:text-ink transition-colors p-1 rounded-lg hover:bg-black/5"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-hairline px-6 pt-3 gap-6 text-sm font-semibold">
              <button
                onClick={() => setAddAccountTab('pat')}
                className={`pb-3 transition-colors border-b-2 ${addAccountTab === 'pat' ? 'border-ink text-ink font-bold' : 'border-transparent text-body hover:text-ink'}`}
              >
                {lang === 'zh' ? 'PAT 令牌添加 (推荐)' : 'PAT Token (Recommended)'}
              </button>
              <button
                onClick={() => setAddAccountTab('batch')}
                className={`pb-3 transition-colors border-b-2 ${addAccountTab === 'batch' ? 'border-ink text-ink font-bold' : 'border-transparent text-body hover:text-ink'}`}
              >
                {lang === 'zh' ? '批量导入 (JSON)' : 'Batch JSON'}
              </button>
              <button
                onClick={() => setAddAccountTab('local')}
                className={`pb-3 transition-colors border-b-2 ${addAccountTab === 'local' ? 'border-ink text-ink font-bold' : 'border-transparent text-body hover:text-ink'}`}
              >
                {lang === 'zh' ? '本机客户端导入' : 'Local Auth'}
              </button>
            </div>

            {/* Tab 1: PAT */}
            {addAccountTab === 'pat' && (
              <div className="p-6 space-y-4">
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

                <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200/60 text-xs text-blue-900 leading-relaxed">
                  <p className="font-semibold mb-1">💡 如何获取 PAT 令牌：</p>
                  <p>登录 Qoder 官网个人中心 (Settings -&gt; Personal Access Tokens) 创建一个 PAT，复制粘贴到上方即可自动验证并接入账号池参与轮询与并发请求。</p>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAddAccountModal(false)}
                    className="px-4 py-2 text-sm font-semibold text-body border border-hairline rounded-lg hover:text-ink transition-colors"
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddAccountPat}
                    disabled={!addAccountPat.trim() || addingAccount}
                    className="px-6 py-2 bg-ink text-white text-sm font-bold rounded-lg hover:bg-neutral-800 transition-all disabled:opacity-40 shadow-sm flex items-center gap-2"
                  >
                    {addingAccount && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                    {addingAccount ? (lang === 'zh' ? '验证入库中...' : 'Verifying...') : (lang === 'zh' ? '验证并添加' : 'Verify & Add')}
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Batch JSON */}
            {addAccountTab === 'batch' && (
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-body mb-2 block uppercase tracking-wider">
                    {lang === 'zh' ? '粘贴注册机导出的 JSON（accounts.json）' : 'Paste registrar JSON'}
                  </label>
                  <textarea
                    value={batchJson}
                    onChange={e => setBatchJson(e.target.value)}
                    rows={6}
                    placeholder='[{ "user_id": "019f...", "name": "...", "token": "dt-...", "refresh_token": "drt-..." }]'
                    className="w-full p-3.5 rounded-xl border border-hairline bg-white/60 font-mono text-xs text-ink outline-none focus:border-ink/40 transition-colors"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAddAccountModal(false)}
                    className="px-4 py-2 text-sm font-semibold text-body border border-hairline rounded-lg hover:text-ink transition-colors"
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={doBatchImport}
                    disabled={!batchJson.trim()}
                    className="px-6 py-2 bg-ink text-white text-sm font-bold rounded-lg hover:bg-neutral-800 transition-all disabled:opacity-40 shadow-sm"
                  >
                    {lang === 'zh' ? '立即导入' : 'Import Now'}
                  </button>
                </div>
              </div>
            )}

            {/* Tab 3: Local Desktop Auth */}
            {addAccountTab === 'local' && (
              <div className="p-6 space-y-4">
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed space-y-2">
                  <div className="flex items-center gap-2 font-bold text-amber-950">
                    <span className="material-symbols-outlined text-[18px] text-amber-600">warning</span>
                    {lang === 'zh' ? '仅支持本地运行模式' : 'Local Desktop Only'}
                  </div>
                  <p>
                    {lang === 'zh'
                      ? '本机导入会自动读取本地桌面端 Qoder 的授权会话文件（~/.config/qoder 或 AppData/qoder）。'
                      : 'Reads local desktop Qoder session files from ~/.config/qoder or AppData/qoder.'}
                  </p>
                  <p className="font-semibold text-red-700">
                    {lang === 'zh'
                      ? '注意：若当前服务部署在云端 Linux 服务器或 Docker 容器中，由于没有桌面客户端，此方式无法读取凭据，会报错“auth files not found”。请切回【PAT 令牌添加】！'
                      : 'Notice: If running on a remote cloud Linux VPS / Docker, local files do not exist. Please use PAT Token instead.'}
                  </p>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAddAccountModal(false)}
                    className="px-4 py-2 text-sm font-semibold text-body border border-hairline rounded-lg hover:text-ink transition-colors"
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await handleImportAuth()
                      setShowAddAccountModal(false)
                    }}
                    disabled={loading}
                    className="px-6 py-2 bg-ink text-white text-sm font-bold rounded-lg hover:bg-neutral-800 transition-all disabled:opacity-40 shadow-sm flex items-center gap-2"
                  >
                    {loading && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                    {lang === 'zh' ? '尝试从本机导入' : 'Attempt Local Import'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} dismiss={dismissToast} />
    </div>
  )
}
