# Claude Code Project Memory

@AGENTS.md

## Claude Code Usage

- 本文件是 Claude Code 在 `duban` 仓库根目录加载的项目级工作上下文。
- 优先遵循上方 `@AGENTS.md` 导入的仓库规则；若 Claude Code 会话中出现更具体的用户指令，以用户当前请求为准。
- 默认使用简体中文回复，命令、路径、代码标识和错误原文保持原样。
- 开始修改前先检查 `git status --short`，识别已有未提交改动，并避免覆盖非本任务相关文件。
- 处理复杂修复时先简要说明计划，再按“定位原因 -> 修复 -> 聚焦验证 -> 必要时构建/lint -> 线上验证或说明未验证”的顺序推进。
- 对 Duban 权限、状态、消息、催办、亮灯、审批和部署问题，必须区分源码、测试、本地 API、数据库、浏览器和线上运行时证据。
- **发布铁律**：任何改动都必须先在本地环境（`pnpm dev` + `cd server && npm run dev` 或本地部署）跑通并验证功能通过，才能执行 `deploy/deploy-local.sh` 发布线上。仅通过 `pnpm run check` / `pnpm lint` / `pnpm run build` 不算本地验证通过。本地未验证时禁止发布，需向用户说明并等待确认。
- 当用户要求发布到线上，且本地修复已经验证通过，按 `AGENTS.md` 的部署规则使用 `deploy/deploy-local.sh` 发布，并检查公开 `/api/health` 与关键业务点。
- 不要把密钥、token、数据库连接串、PEM 内容或用户敏感数据写入回复、日志、测试快照或文档。
