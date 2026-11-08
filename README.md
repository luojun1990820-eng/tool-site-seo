# tool-site-seo

一个给 AI Agent 用的技能包：**从 0 到 90 天做工具站 SEO**（计算器 / 转换器 / 生成器 / 检测器 / 查询库这类"一个页面解决一个问题"的站）。

不是通用 SEO 教程，而是把工具站特有的四件事写成可执行的判断流程：

1. **经济模型是"每次访问"，不是"每条线索"** —— 广告 RPM / 联盟佣金决定这个工具值不值得做。
2. **产品就是页面本身** —— 结果若只在 JS 里渲染，搜索引擎和 AI 看到的都是空壳。
3. **规模化必然遇到薄内容** —— 组合页是增长引擎，也是站点级降权的最大来源。
4. **AI 直接吃掉头部词** —— "一盎司等于多少克"会被内联回答，赢法常常是换页面形态，而不是把同一页优化得更好。

---

## 基本信息

| 项 | 值 |
|---|---|
| 技能名 | `tool-site-seo` |
| 版本 | 1.2.0 |
| 许可证 | MIT（见 [LICENSE](LICENSE)） |
| 上游来源 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) + [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo)（均 MIT），已针对工具站经济学重写 |
| 适用 | 工具站选题、建站前的页面规划、上线检查、上线后 90 天诊断 |
| 不适用 | 通用 SaaS 站 SEO 审计、纯内容站、电商 |

## 它做判断，不做数据

技能不会替你编搜索量、SERP 强度或 RPM。这三样要你自己填：

- **已有站** → Google Search Console
- **新站** → DataForSEO / Ahrefs / Semrush / AIsa 任一个

它负责的是：拿到这些数字之后，怎么判断该不该做、先做哪类页面、上线前卡哪 24 项、第一个月盯什么。

---

## 安装

技能放在 DSH 全局目录即对所有会话生效：

```powershell
# 本仓库放到全局技能目录
git clone https://github.com/luojun1990820-eng/tool-site-seo "$HOME\.dsh\skills\tool-site-seo"
```

其他 Agent 的目录约定：

| Agent | 目录 |
|---|---|
| DSH | `~/.dsh/skills/tool-site-seo/` |
| Claude Code | `~/.claude/skills/tool-site-seo/` 或项目内 `.claude/skills/` |
| 通用 / Codex | `.agents/skills/tool-site-seo/` |

目录里必须有 `SKILL.md`，文件名为大写，大小写敏感。

---

## 六种模式

技能按模式拆分，**一次只跑一个**。直接说场景，不用报阶段号。

| 模式 | 你说什么 | 跑哪几段 | 拿到什么 |
|---|---|---|---|
| **Vet** | "我想做个 PDF 转 Word 的工具站，值不值得做" | Phase 0 | 加权评分（≥75 建 / 60–74 先 MVP / <60 放弃）、3 条否决、盈亏平衡 |
| **Spec** | "要做哪些页面？URL 怎么定？模板放什么" | Phase 1+2 | 五类页面矩阵、URL 与内链规则、结果页索引规则、规模闸门、模板模块 |
| **Gate** | "要上线了，检查一遍" | Phase 3 | 12 道闸门的 pass / warn / fail / not assessed 与逐条修复 |
| **Launch** | "刚上线，怎么推" | Phase 4 | 90 天依赖图 + week-0 基线规格 |
| **Diagnose** | "不收录" / "掉了" / "收录率下降" | Phase 5 | 收录诊断、9 条漂移规则 diff、原因归类 |
| **Grow** | "有流量了怎么涨" | Phase 6 或 7 | 外链战术清单，或 AI 可见性修复 |

规则：测不到的项一律标 `not assessed`，不许估数字，不许给 0 分；任何闸门 `fail` 时不得出示整份报告。

要按项目跑完整流程，复制 [assets/runbook-template.md](assets/runbook-template.md) 到项目里，六段各有一张待填的表（立项评分、页面规格、闸门记录、90 天看板、漂移 diff、增长实验）。填好的样子见 [examples/pdf-tools.md](examples/pdf-tools.md)：全能 PDF 工具箱得 58 分被否决，"PDF → Markdown" 得 72 分但盈亏线第一次算不过。

---

## 自动检查

```bash
node scripts/audit.mjs <构建产物目录>          # 表格，人看
node scripts/audit.mjs <构建产物目录> --json   # JSON，进 CI
```

离线测 6 门：结果在 HTML（G2）、元数据模板化（G4）、标题与描述（G5）、H1（G6）、结构化数据（G7）、内链（G11），外加 sitemap 容量与一致性。

另外 6 门（G1 可索引、G3 独有度、G8 CWV、G9 交互、G10 状态码、G12 度量）需要联网或人工，脚本一律标 `not_assessed`。

退出码：`0` 无 fail、`1` 有 fail、`2` 用法错误。**0 不等于可以上线**——报告里 `not_assessed` 的数量和 `pass` 一样重要。

改阈值或规则后跑一次回归：

```bash
node tests/run.mjs    # 两组样例站，断言每道门的期望判定
```

## 边界

| 你会得到 | 你不会得到 |
|---|---|
| 判断框架、检查清单、页面规格 | 具体关键词、搜索量、竞品流量数据 |
| 该不该做、先做什么、卡在哪 | 直接写好的 Next.js / Astro 代码 |
| 上线后每周该看哪三个清单 | 自动跑的爬虫、自动提交 GSC |

代码和数据的活要另配工具。技能管"判断"，不管"执行"。

---

## 目录结构

```
tool-site-seo/
├── SKILL.md                          # 技能主体，Agent 读这个
├── README.md                         # 本文件
├── LICENSE                           # MIT
├── scripts/
│   └── audit.mjs                     # 离线审计：Node 单文件，零依赖
├── checks/
│   └── gates.md                      # 12 道门的判定规则与证据字段（脚本和人共用）
├── tests/
│   ├── run.mjs                       # 回归断言：两组 fixture 的期望判定
│   └── fixtures/                     # site-bad / site-good 两个样例站
├── feedback/
│   └── log.md                        # 纠错记录：一次错误 → 一条检查
├── examples/
│   ├── product-marketing-pdf-site.md # 填好的站点简介（12 行，照抄改数字即可）
│   └── pdf-tools.md                  # 填好的 Vet + Spec（一个否、一个留）
└── assets/
    ├── product-marketing-template.md # 站点上下文模板，填完放到 .agents/product-marketing.md
    └── runbook-template.md           # 项目运行手册：Vet→Spec→Gate→Launch→Diagnose→Grow 全流程表格
```

## 首次使用前

复制 `assets/product-marketing-template.md` 到项目的 `.agents/product-marketing.md` 并填写——重点是**变现方式、RPM 区间、月 PV**。Phase 0 的所有判断都建立在这三项上，缺了它技能只能给通用建议。

嫌模板太长的，直接抄 [examples/product-marketing-pdf-site.md](examples/product-marketing-pdf-site.md)：12 行，改站名和数字就能用。不知道的写"未知"并给个假设值——技能会按假设算，并标出来。

## 更新

技能内文末尾有 `Provenance` 一节，逐条标注了哪个章节来自上游哪个技能、改了什么。上游发大版本时，按那张表决定要不要移植，避免把 SaaS 语境一起带回来。

## 许可

MIT。本技能改编自 [marketingskills](https://github.com/coreyhaines31/marketingskills)（© Corey Haines，MIT），针对工具站经济模型与索引规则做了重写与增补。
