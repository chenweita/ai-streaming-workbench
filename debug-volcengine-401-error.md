# Debug Session: volcengine-401-error

**状态**: [OPEN]

**问题**: 火山引擎方舟 API 持续返回 401 AuthenticationError

**用户反馈**: 使用 `ark-d35988c5-ab1d-4480-a299-0aa4a0cfa230b` 作为 API Key，模型 `doubao-seed-2.0-pro-260228`，持续 401 错误

---

## 假设列表

| # | 假设 | 状态 | 验证方式 |
|---|------|------|---------|
| H1 | API Key 本身无效或已失效 | 待验证 | curl 直接测试 API |
| H2 | API Key 未开通对应模型权限 | 待验证 | 检查方舟控制台开通管理 |
| H3 | 账号未完成实名认证 | 待验证 | 确认实名认证状态 |
| H4 | API 调用需要推理接入点 ID | 待验证 | 创建接入点测试 |
| H5 | Node.js fetch 请求格式问题 | 待验证 | 对比 curl 和代码 |

---

## 调试步骤

### Step 1: curl 直接测试 API（验证 H1）

```bash
curl -v -X POST "https://ark.cn-beijing.volces.com/api/v3/chat/completions" \
  -H "Authorization: Bearer ark-d35988c5-ab1d-4480-a299-0aa4a0cfa230b" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-2.0-pro-260228",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

### Step 2: 检查 API Key 状态
访问: https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey

### Step 3: 检查模型开通状态
访问: https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement

### Step 4: 确认实名认证
访问: https://console.volcengine.com/realname

### Step 5: 创建推理接入点测试
访问: https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint

---

## 结论

（待填写）

---

## 修复方案

（待填写）