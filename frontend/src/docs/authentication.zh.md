# 鉴权机制

GITIT 采用双层鉴权模型：管理控制台鉴权与外部客户端 API 鉴权，实现管理特权与消费端调用的彻底隔离。

## 第一层：管理控制台鉴权 (X-Gateway-Token)

你在控制台登录页输入的密码即为管理密钥。前端控制台向后端发起配置、查库或管理请求时会自动在 Header 中附带：

```http
X-Gateway-Token: <admin-password>
```

该密钥保护以下管理接口：
- `/ui/status`：系统总览与节点探活
- `/ui/accounts` 与 `/ui/accounts/*`：账号池增删改查
- `/ui/checkin/*`：双轨自动签到状态与手动补领
- `/ui/config`：API Key 密钥生成与子池映射
- `/ui/logs`：实时系统分流日志

### 生产环境修改方式
在 `.env` 中指定：
```env
QODER_ADMIN_PASSWORD=your-super-safe-password
```

## 第二层：外部 API Key 鉴权 (Bearer Key)

当第三方客户端（Cursor、Codex++、Cherry Studio、NextChat、ZCode 客户端）连接网关时，通过标准 HTTP Bearer 协议进行鉴权：

```http
Authorization: Bearer qg_live_42adacf1b759ee4e6e8a7ea99f9eb350
```

### API Key 子池绑定 (Sub-pool Binding)
在控制台 **API Key & 子池绑定** 板块中，可为每个 API Key 配置不同权限：
- **全部账号 (默认轮询)**：可调用全网关所有处于 `all` 状态的账号，享用最大并发与可用性。
- **专属账号绑定**：指定此 Key 仅消耗特定账号的算力（如个人号或特定组织的套餐），实现团队成员间的算力物理隔离。

## 安全建议

- 永远不要将管理控制台密码直接配置给下游客户端作为 API Key。
- 云端部署建议保持 API Key 鉴权为开启状态（默认即开启）。
