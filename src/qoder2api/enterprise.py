"""
企业版 VPC 域名解析（Qoder CN 企业私有化部署）

- 将用户输入归一化为 VPC 实例名（对齐官方 CLI qoderclicn 的 vpc_endpoint 规则）
- 派生企业端点 origin（仅三类：openapi / gateway / portal）
    openapi = https://{name}-openapi.vpc.qoder.com.cn
    gateway = https://{name}-gateway.vpc.qoder.com.cn
    portal  = https://{name}.vpc.qoder.com.cn
- 企业账号的接口路径与公共 CN 完全一致（/api/v1/jobToken/exchange、/api/v1/jobToken/refresh、
  /api/v1/deviceToken/refresh、/api/v1/userinfo、/api/v2/quota/usage、
  /algo/api/v2/service/pro/sse/agent_chat_generation），仅替换 base host
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

VPC_ZONE = "vpc.qoder.com.cn"
_INSTANCE_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


def normalize_vpc_domain(raw: str) -> str:
    """把用户输入归一化为 VPC 实例名；非法输入抛 ValueError（中文消息）。

    接受形式：
    - 裸实例名：acme
    - VPC 域名：acme.vpc.qoder.com.cn
    - 带端点前缀的 VPC 域名：acme-openapi.vpc.qoder.com.cn / acme-gateway.vpc.qoder.com.cn
    - 完整 URL（UX 放宽，仅取 hostname）：https://acme.vpc.qoder.com.cn/account/integrations
    """
    text = str(raw or "").strip()
    if not text:
        raise ValueError("企业域名不能为空")

    if "://" in text:
        host = urlparse(text).hostname or ""
    else:
        # 放宽裸域名带路径的写法（如 acme.vpc.qoder.com.cn/account/integrations）
        host = text.split("/", 1)[0]
    host = host.strip().strip(".").lower()
    if not host:
        raise ValueError(f"无法解析企业域名: {raw}")
    if host == VPC_ZONE:
        raise ValueError(f"企业域名缺少实例名: {raw}")

    if host.endswith("." + VPC_ZONE):
        # 剥离 zone，再剥离 -openapi / -gateway 端点前缀，得到实例名
        label = host[: -(len(VPC_ZONE) + 1)]
        for suffix in ("-openapi", "-gateway"):
            if label.endswith(suffix):
                label = label[: -len(suffix)]
                break
        instance = label
    elif "." in host:
        raise ValueError(
            f"无法识别的企业域名: {raw}（应为 {VPC_ZONE} 下的企业实例，如 acme 或 acme.{VPC_ZONE}）"
        )
    else:
        instance = host

    if not _INSTANCE_RE.match(instance):
        raise ValueError(f"企业实例名不合法: {instance}（需为小写字母/数字/中划线，如 acme）")
    return instance


def enterprise_origins(instance: str) -> dict[str, str]:
    """返回企业实例的三类端点 origin：openapi / gateway / portal。"""
    name = str(instance or "").strip()
    return {
        "openapi": f"https://{name}-openapi.{VPC_ZONE}",
        "gateway": f"https://{name}-gateway.{VPC_ZONE}",
        "portal": f"https://{name}.{VPC_ZONE}",
    }
