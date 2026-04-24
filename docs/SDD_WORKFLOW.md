# SDD 驱动开发流程（SDD-Driven Development Workflow）

目的

为保证设计与实现一致、本仓库采用 SDD（docs/SDD.md）作为变更的源头（source-of-truth）。所有影响架构、接口或数据模型的变更，都应先在 SDD 中记录并通过评审。

流程（简要）

1. 提出 Issue：描述问题或需求，指明影响范围。
2. 更新 SDD（如需）：在 docs/SDD.md 中新增或修改相应条目，并在 docs/SDD-checklist.md 中补充完成项。
3. 创建分支：feat/xxx 或 fix/xxx。
4. 提交实现：在同一 PR 中同时提交 SDD 文档变更与实现代码（推荐）。
5. PR 描述：在 PR 中引用 SDD 对应节号并附上 SDD-checklist 状态（已勾选项）。
6. CI 与评审：等待 CI 通过并由至少一名维护者审核通过。
7. 合并：合并后更新变更日志与 ADR（如有）。

SDD 更新要求（简短）

- 在涉及接口、数据模型或架构的变更前更新 SDD。
- 使用 SDD-checklist 确认已覆盖关键项。
- 小型修正（不影响接口或架构）可在实现后补充 SDD，但仍需在 PR 中说明。

PR 验收条件（示例）

- SDD-checklist 相关项为已完成或在 PR 中记录为待办并说明理由。
- 代码通过基础构建与 lint。
- 新增功能含基本单元测试或示例验证步骤。
- 文档已更新（README/CONTRIBUTING/SDD 等）。

维护者职责

- 确认 SDD 与实现一致；必要时要求作者补充设计说明或测试用例。
- 对重大设计决策记录 ADR 并在 SDD 中留存引用。

备注

本流程为推荐实践，可根据项目规模与团队习惯调整。