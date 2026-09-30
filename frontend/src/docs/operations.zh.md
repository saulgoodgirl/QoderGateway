# 运维与部署规范

本页记录 GITIT 网关在云端与本地环境下的运维、数据库维护以及关键安全守则。

## 部署模式

### 1. 云端生产部署 (Server A)
- **部署环境**：Server A Linux 主机（`35.212.220.77:22`）Docker 容器，端口映射 `5050`。
- **公网域名**：`https://lite.bigbob.asia`。
- **自动部署脚本**：工程内置 `scripts/deploy_remote.py`，支持基于文件哈希的增量极速部署与热加载。
- **容器健康检查**：
  ```bash
  docker ps -f name=qodergateway
  docker logs -f --tail 50 qodergateway
  ```

### 2. 本地开发与测试
- **环境**：Windows 11，直接运行根目录下 `start.bat`。
- **端口管理**：默认占用 `5050` 端口。当切换至云端使用时，建议主动关闭本地占用的 5050 端口：
  ```powershell
  Get-NetTCPConnection -LocalPort 5050 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```

## 数据库与备份规范

GITIT 运行数据持久化保存在用户目录的 SQLite 数据库：

```text
~/.qoder/qoder2api.db
```

包含核心数据表：
- `accounts`：所有 Qoder、ZCode 账号凭证、额度与 API 调度模式。
- `api_keys`：对外分发的 Bearer API Key 及其子池绑定关系。
- `settings`：网关全局配置与管理员密码哈希。

### 备份命令 (PowerShell)
```powershell
Copy-Item "$env:USERPROFILE\.qoder\qoder2api.db" "$env:USERPROFILE\Desktop\gitit_db_backup.db"
```

## 云端注册机安全守则 (重要)

- **云端环境强制拦截**：自动批量注册机功能**仅限本地部署使用**。
- 云端 Server A 部署默认设置 `ENABLE_REGISTRAR=false`。任何向 `/ui/registrar/*` 发起的请求均会被后端直接拦截并返回 `403 Forbidden`。
- 云端 Web 控制台已彻底下线注册机的前端入口，杜绝恶意探测与风控风险。

## 常见排障与日志诊断

### 401 Unauthorized
- 若在 Web 控制台报错：检查是否登录已过期或管理员密码不正确。
- 若在客户端（Cursor 等）报错：检查请求 Header 中的 `Authorization: Bearer <key>` 是否正确有效。

### 上游模型报错 502 / 超额
- 检查控制台「双平台账号池」中对应厂商的账号是否已满额度。
- GITIT 会自动熔断并尝试轮询到池内下一个有效账号。如果全部账号均超额，可通过控制台一键重领算力或添加新账号。
