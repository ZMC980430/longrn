# 贡献指南（CONTRIBUTING）

感谢你愿意为本项目贡献！请按以下流程提交改动：

1. Fork 本仓库并创建 feature 分支：
   - git checkout -b feat/简短描述

2. 本地开发与测试
   - 安装依赖：npm install
   - 运行构建/类型检查：npm run build
   - 运行测试：npm test

3. 提交规范
   - 使用清晰的 commit message，首行限制 50 字符，说明改动要点。
   - 若提交由 Copilot 辅助生成的自动提交，提交信息末尾保留以下行：
     Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>

4. 提交 PR
   - 将分支推送到你的 fork，发起 Pull Request 到主仓库。
   - 在 PR 描述中引用相关 Issue 或 SDD 节点，并附上变更摘要、测试说明与回归风险。

5. 代码审查
   - 等待至少一名维护者批准。根据评审意见更新代码并保持 PR 清晰可读。

6. 其他要求
   - 在修改实现相关的同时，更新 docs/SDD.md 或 sample SDD（如果设计有变更）。

感谢你的贡献！如有问题，请在 Issue 区讨论。