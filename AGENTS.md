# Duban 项目 AGENTS.md

## 项目概况

这是督办事项管理系统 `duban`，前端为 React + TypeScript + Vite + Tailwind CSS，状态管理以 Zustand 为主；后端为 Express + TypeScript + Drizzle + MySQL。核心业务包括工作台、督办立项、督办台账、执行反馈、任务分解、跟踪催办、亮灯、消息通知、权限配置、操作日志和统计分析。

## 工作原则

- 默认使用简体中文与用户沟通，涉及命令、路径、代码标识时保留原文。
- 先读现有实现和测试，再下判断；不要凭文件名或历史印象直接改业务逻辑。
- 工作区经常存在用户或其他任务留下的未提交改动。修改前查看 `git status --short`，只改本任务相关文件，不回滚无关变更。
- 对用户的问题要区分证据层级：源码推断、单元测试、本地运行、数据库/API 验证、浏览器验证、线上验证分别说明。
- **本地验证→发布闸门（与下方「部署规则·发布铁律 P0」口径一致，最高优先级，不可绕过）**：任何修复/改动类任务，默认流程为「定位原因 → 修复 → 先在本地环境验证通过 → 再发布到线上并检查公开健康状态」。**本地未验证或验证不通过时一律禁止发布**；只有用户明确说「只改本地 / 不要发布」时才止步于本地。此规则不依赖用户是否主动要求发布，修复动作本身即隐含该前置条件。
- 如果任务是审查、分析或出报告，先输出问题位置、影响和建议；不要在用户未确认前顺手改一堆业务代码。

## 关键目录

- `src/`：前端页面、组件、权限辅助、API 封装和 Zustand store。
- `src/pages/Workbench/`：工作台首页、指标卡、任务列表、操作按钮和侧栏。
- `src/pages/Items/`：督办事项列表、详情、审核、回收站、筛选。
- `src/store/`：前端同步、访问控制、消息可见性、事项流程等共享逻辑。
- `server/src/`：Express 后端入口、路由、数据库 schema、权限策略、后台任务。
- `server/src/routes/`：业务 API、认证、角色权限、催办、消息、亮灯、审计日志。
- `server/src/db/`：Drizzle schema、内置角色、迁移/结构补齐、部署角色刷新。
- `server/src/jobs/`：服务端定时/自动化任务，例如事项自动流转。
- `deploy/`：本地到线上部署脚本、服务器部署脚本、Nginx/MySQL 辅助脚本。
- `docs/`：历史分析、验证报告、测试用例和线上部署记录。文档可辅助定位，但不能替代当前源码或运行时验证。

## 常用命令

- 安装依赖：`pnpm install`；后端依赖在 `server/` 下用 `npm install` 或沿用现有 lockfile。
- 前端开发：`pnpm dev`，默认 Vite 地址 `http://localhost:5173/`。
- 后端开发：`cd server && npm run dev`，默认 API 地址 `http://localhost:3001/`。
- 后端健康检查：`curl -sS --max-time 3 http://localhost:3001/api/health`。
- 类型检查：`pnpm run check`。
- 前端和仓库构建：`pnpm run build`。
- 后端构建：`cd server && npm run build`，该命令会把 `.env.production` 复制到 `dist/.env`。
- Lint：`pnpm lint`。
- 全量测试：`pnpm test`。
- 聚焦测试推荐：`./server/node_modules/.bin/tsx --test <test-file...>`。本仓库的 `pnpm test` 可能耗时较长；聚焦测试通过不能说成全量测试通过。
- 部署脚本语法检查：`bash -n deploy/deploy-local.sh && bash -n deploy/deploy-server.sh`。

## 测试与验证策略

- 小范围修复优先添加或更新聚焦测试，再运行相关测试文件。
- 业务规则、权限、状态流转、消息、催办、亮灯、审批等改动要覆盖前端 helper/store 和后端策略/API 两侧。
- 提交或发布前应尽量运行 `pnpm run check`、相关聚焦测试、`pnpm run build`、`pnpm lint`；如果全量 `pnpm test` 未跑或卡住，必须明确说明。
- 本地 API 测试不等于线上验证；线上问题需要至少检查公开 `/api/health`，必要时再查线上 API、数据库和浏览器 UI。
- 未登录接口返回 `401` 有时是预期行为，尤其是 `/api/items`、`/api/roles` 等业务接口；不要误判为服务不可用。
- 不要把 `server/sqlite.db` 当成线上或本地 MySQL 业务数据来源。本项目实际业务数据以 MySQL `DATABASE_URL` 为准。

## 业务高风险点

- 权限分三层：菜单/路由权限、页面按钮权限、行级数据权限。不要只改一层就宣称权限问题修复。
- 页面按钮权限涉及 `allowedActions`、`allowedPageActions`、`src/permissions/page-actions.ts`、`server/src/routes/page-actions.ts` 和角色刷新逻辑。
- 行级可见性涉及 `dataScope`、`followerDataScope`、`adminOrgIds`、`orgIds`、部门树、直属下级和多组织管理员场景。
- 工作台指标和列表状态必须保持一致，重点关注 `getEffectiveItemStatus`、`workbench-metrics.ts`、`TaskList`、`MetricCards`、`item-format` 和后端返回状态。
- 事项流程规则在前端 store、页面操作、后端路由、审批/签收/反馈策略之间容易重复或漂移；改动时要横向搜索同名状态和动作。
- 消息可见性、已读状态和用户消息表容易出现“API 有数据但前端不可见”或“前端展示但后端未隔离”的差异。
- 自动催办、超期、亮灯和事项自动流转应优先放在服务端集中处理，避免多个浏览器页面重复触发。
- 内置角色刷新可能覆盖数据库中的角色动作配置。发布前检查 `server/src/db/built-in-roles.ts`、`deploy-role-refresh.ts` 和相关测试。

## 前端规范

- 使用函数式组件和 Hooks，避免类组件。
- TypeScript 保持类型安全，避免无意义的 `any`。确需兜底时让边界尽量窄。
- 缩进 2 个空格，变量使用 camelCase，组件使用 PascalCase。
- API 调用统一走 `src/lib/api.ts`，不要在页面组件里散落裸 `fetch`。
- 不在前端硬编码密钥、token、数据库连接、第三方凭证或服务器敏感路径。
- UI 修改要符合现有后台系统风格：信息密度适中、可扫描、按钮状态明确，不做营销式大英雄区。
- 操作按钮、筛选、标签、权限隐藏/禁用状态必须和后端能力保持一致；不能只靠 CSS 隐藏敏感操作。

## 后端规范

- 路由处理要使用服务端认证身份和访问上下文，不信任客户端传来的用户、角色、组织、IP、时间、日志 ID 等敏感字段。
- 写接口必须校验业务动作权限和行级权限；读接口必须按用户身份做数据范围过滤。
- 数据库结构变更要同步 Drizzle schema、结构补齐逻辑、测试和必要的部署刷新逻辑。
- 密码必须安全哈希；认证 token、密钥、数据库连接串不得输出到日志或报告。
- 导出 CSV/Excel/HTML 时注意公式注入，避免以 `=`, `+`, `-`, `@`, tab, CR, LF 开头的单元格被执行。
- Express 代理信任、CORS、认证续期和 401 处理属于线上高风险项，改动后要做 API 级验证。

## 部署规则

- **发布铁律（P0）**：任何改动都必须先在本地环境（`pnpm dev` + `cd server && npm run dev` 或本地部署）完成验证并明确通过，才能执行 `deploy/deploy-local.sh` 发布线上。本地未验证 / 验证不通过 / 只跑了静态检查（`check`/`lint`/`build`）时，**禁止发布线上**。
- 本地验证的最低标准：涉及路由或数据库改动要用 `curl` 打本地 `http://localhost:3001/` 接口拿到预期响应；涉及 UI 改动要在浏览器 `http://localhost:5173/` 走一次真实用户操作；仅 helper/纯函数改动可用聚焦测试代替。
- 发布顺序固定为：`本地代码修改 → 本地服务重启/热更 → 本地功能验证通过 → 用户确认或明确要求发布 → deploy-local.sh → 线上健康检查与业务点回归`。任何一步跳过都要显式告知用户并等待确认。
- 当前维护的线上目标由 `deploy/deploy-local.sh` 管理，服务器为 `root@49.233.13.110`，远端目录 `/root/duban`。
- 常规本地发布命令在项目根目录运行：`SSH_KEY=<key-path> bash deploy/deploy-local.sh`；如已有 SSH 默认身份可省略 `SSH_KEY`。
- `deploy-local.sh` 会构建前端、构建后端、同步 `dist/`、`server/dist/` 和 `deploy/`，再远程执行 `SKIP_GIT_SYNC=1 bash /root/duban/deploy/deploy-server.sh`。
- 发布后至少验证 `http://49.233.13.110/` 和 `http://49.233.13.110/api/health`，并记录 `releaseId` 是否为本次发布；关键业务点（登录、菜单、目标页操作）要跟着回归一次。
- `deploy-local.sh` 默认不推送 Git；只有用户明确要求或设置 `PUSH_TO_GIT=1` 时才走提交/推送。
- 不要泄露 PEM、token、数据库密码、`DATABASE_URL`、认证密钥或线上环境文件内容。

## 文档与报告

- 审查类输出要包含具体文件位置、为什么不合理、业务影响、改进建议和验证建议。
- 如果引用历史文档或记忆，要说明其可能过期，并以当前源码/测试/运行时结果为准。
- 新增修复报告应放在 `docs/` 下，文件名包含主题和日期；报告要区分“已验证”和“未验证”。

## Code Review Rules

- 标记只在前端隐藏按钮、但后端 API 未校验权限的改动。
- 标记只改工作台指标、不改对应列表筛选或状态 helper 的改动。
- 标记新增/修改状态枚举却没有检查前端展示、后端路由、数据库字段和测试的改动。
- 标记把本地测试、静态分析或健康检查包装成线上业务闭环验证的描述。
- 标记任何把凭证、token、数据库连接串、PEM 内容或用户敏感数据写入源码、文档、日志或测试快照的改动。
