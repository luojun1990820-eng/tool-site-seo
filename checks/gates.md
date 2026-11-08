# 闸门判定规格

`scripts/audit.mjs` 和人都读这一份。改阈值只改这里，再同步脚本里的常量表。

## 判定值

| 值 | 含义 | 什么时候用 |
|---|---|---|
| `pass` | 已测量且达标 | 有实测值且落在阈值内 |
| `warn` | 已测量但低于建议值 | 有实测值但不致阻塞 |
| `fail` | 已测量且不达标 | 有实测值且越线 |
| `not_assessed` | **没有测量** | 无数据、需要联网、需要语义判断 |

铁律：**`not_assessed` 永远不等于 `pass`。** 脚本对任何无法计算的项输出 `not_assessed`，绝不默认通过。报告里 `not_assessed` 的数量必须与 `pass` 并列展示。

## 12 道门

| 门 | 名称 | 自动化 | 规则 | 证据字段 |
|---|---|---|---|---|
| G1 | 可索引 | ❌ 手工 | 200 + 单一 sitemap + 自指 canonical | 需要 HTTP 与 GSC，离线不可判 |
| G2 | 结果在 HTML | ✅ | 无 JS 可见词数：<50 且有脚本壳 → fail；50–149 → warn；≥150 → pass | `words`, `hasScript` |
| G3 | 内容独有度 | ❌ 手工 | 与最近邻页 ≥40% 独有 | 需语义比对 |
| G4 | 元数据模板化 | ✅ | 站点比例：高 >30% fail；回响比 >10% warn | `templatedRatio`, `echoRatio` |
| G5 | 标题与描述 | ✅ | 标题显示宽 30–60；描述 120–160；越界 warn | `titleWidth`, `descWidth` |
| G6 | 标题结构 | ✅ | H1=1 pass；H1=0 fail；H1>1 warn | `h1Count` |
| G7 | 结构化数据 | ✅ 部分 | JSON-LD 解析成功且有 @type → pass；无 → warn；解析失败 → fail | `jsonldTypes`, `jsonldError` |
| G8 | Core Web Vitals | ❌ 手工 | LCP<2.0s、INP<200ms、CLS≤0.1、首屏 JS≤150KB | 需 lab/field 数据 |
| G9 | 交互可访问 | ❌ 手工 | label、24×24、非 div 点击、结果常驻 | 需 DOM 审计或浏览器 |
| G10 | 状态语义 | ❌ 手工 | 空组合 404/410 | 需 HTTP |
| G11 | 内链 | ✅ | 入链 0 → fail；1–2 → warn；≥3 → pass | `inlinks` |
| G12 | 度量 | ❌ 手工 | GSC 已验证、sitemap 已提交、事件在报数 | 需外部账号 |

自动 6 门，手工 6 门。手工门不是"没写"，是"必须有人给证据"。

## 站点级检查（不属于某道门，但阻塞 G1）

| 检查 | 规则 | 判定 |
|---|---|---|
| sitemap 存在 | 目录下有 `sitemap*.xml` | 无 → warn |
| sitemap 容量 | ≤50,000 URL 且 ≤50MB | 超 → fail |
| sitemap 重复 | `<loc>` 去重后数量 | 有重复 → warn |
| lastmod 一致性 | 全部相同且页数 >1 | warn（疑似构建时间） |
| sitemap 与文件对应 | loc 路径在本地产物里找不到 | warn，列出前 10 条 |

## 显示宽度

CJK 字符按 2 个单位计，拉丁字符按 1 个计——这样中文标题 15 字（30 单位）与英文 30 字符落在同一区间。

## 脚本的已知边界

- **正则解析 HTML**，不执行 JS。为此 G2 的"脚本壳"判定是启发式（词数 <50 且存在 `<script>` 或 `id="root"`），命中后仍建议人工确认。
- **不检查 HTTP 状态码、跳转、canonical 是否被 Google 采纳**——这些必须联网。
- **不判断内容好坏**，只测形态。
- 单页 > 2MB 会跳过并记 `not_assessed`（避免误伤）。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 自动门无 fail（可能仍有 warn 与 not_assessed） |
| 1 | 至少一门 fail |
| 2 | 用法错误或目录不可读 |

CI 里只按 0/1 判断；但人看报告时**必须同时看 `not_assessed` 数量**，否则等于只验了一半。

## 改阈值的流程

1. 改本文件的表格
2. 改 `scripts/audit.mjs` 顶部 `THRESHOLDS` 常量
3. 跑 `node tests/run.mjs`，确认判定变化符合预期；新行为要加进 `tests/fixtures/` 并写进 `tests/run.mjs` 的断言
4. 在 `feedback/log.md` 记一条
