# 陨石样本编目台（sologsb-1125 / gbmeteorite）

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21825>

停止（镜像保留）：

```bash
docker compose down
```

## 项目简介

面向陨石收藏者与标本室的纯前端单页应用：把样本、发现记录、切片制样与检测数值整理成本地可检索档案。
核心动作是登记样本与发现地坐标、挂接切片、录入电子探针数值并给出分类建议；借出、归还与审计则串成一条借阅台账。

- 纯前端 SPA：**无后端、无数据库服务、无外部 API**
- 所有数据保存在浏览器本地：业务数据走 **IndexedDB（Dexie，库名 `gbmeteorite-db`）**，表单草稿走 **localStorage**
- 容器无状态，不挂载任何命名卷；换浏览器即换档案库

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript 5.7 |
| 构建 | Vite 6（`build` 脚本为 `tsc -b && vite build`，类型检查零错误） |
| UI 组件库 | MUI（@mui/material 6 + @mui/icons-material） |
| 状态管理 | Zustand（`sampleStore` 业务数据 / `uiStore` 筛选与提示） |
| 路由 | React Router 6（BrowserRouter + nginx `try_files` 兜底） |
| 本地存储 | Dexie 4（IndexedDB）+ localStorage（草稿） |
| 部署 | 多阶段 Dockerfile：node:20-alpine 构建 → nginx:alpine 托管 |

## 核心页面

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 样本总览：卡片流 + 分类/化学群/重量区间筛选与排序，缺坐标或缺切片显示角标；外借/超期/旧册待补全状态同步显示 | MeteoriteSample、LoanRecord |
| `/loans` | 借阅台账：外借中 / 超期催还 / 旧册待补全 / 已归还历史分页，超期档案红色醒目提示 | LoanRecord、MeteoriteSample |
| `/samples/new` | 样本登记：编号生成、分类化学群、重量、存放位置（不可直接选“外借中”），可补录发现地坐标并即时校验 | MeteoriteSample、FindRecord |
| `/samples/:id` | 样本详情：基本信息 + 发现地摘要 + 借阅台账（借出/补全/归还核对）+ 切片列表 + 分析记录，可就地新增 | 五个模型 |
| `/sections` | 切片库：按厚度与矿物占比筛选，回跳样本，批量标注质量；随样外借状态同步显示 | ThinSection、MeteoriteSample、LoanRecord |
| `/analysis` | 分析检测：录入 Fa / Fs / Ni / 铁纹石带宽，实时分类建议与阈值命中说明 | AnalysisRecord、MeteoriteSample |
| `/locations` | 发现地分布：SVG 网格按经纬度打点、按分类着色、点选弹出样本清单 | FindRecord、MeteoriteSample |

## 数据模型（`src/types/` 独立文件）

- `types/sample.ts` — **MeteoriteSample**：id、样本编号、总重量 g、分类、化学群、风化等级 W0–W4、发现/坠落、存放位置
- `types/find.ts` — **FindRecord**：id、关联样本、地名、国家地区、经纬度、坐标来源（GPS/文献）、发现环境、发现者
- `types/section.ts` — **ThinSection**：id、切片编号、关联样本、厚度 μm、制样方式、矿物占比、显微照片清单
- `types/analysis.ts` — **AnalysisRecord**：id、关联样本或切片、方法、橄榄石 Fa、辉石 Fs、Ni wt%、铁纹石带宽 mm、检测日期
- `types/loan.ts` — **LoanRecord**：id、关联样本、借用人、借出/应还/归还日期、随样切片 id、借出前快照（样本+切片+检测记录）、状态 active/returned/legacy、归还核对差异

## 借阅台账规则（借出 → 归还 → 审计一条链）

- **借出登记**：必须填写借用人、借出日期、应还日期与随样切片；借出瞬间对样本、随样切片与该样本全部检测记录拍快照；样本转“外借中”，详情、总览、切片库同步显示借用人/应还日期
- **旧册兼容**：升级前只有“外借中”存放标记、缺借用人/日期的样本，v4 迁移为 `legacy` 借阅单（仍可查询），在台账补全后转为正常外借单
- **归还核对**：归还前按快照比对切片数量/内容与检测记录；有新增、缺失或修改即为冲突，必须逐条核对并勾选确认后才能关闭借阅，差异与快照永久留档
- **防重复**：连续点击归还只落一条记录（进行中二次调用直接拒绝）；日期颠倒（应还早于借出、归还早于借出）的交易不成立
- **清理拦截**：外借中（含旧册待补全）的样本禁止清理，避免切断追责链路；已归还历史即使样本被清理也保留在台账中，超期档案在总览与台账页红色醒目提示

## 目录结构

```
sologsb-1125/
├── docker-compose.yml
├── .env / .env.example
├── README.md
└── frontend/
    ├── Dockerfile          # 多阶段：node:20-alpine → nginx:alpine
    ├── nginx.conf          # try_files + gzip
    ├── index.html
    ├── package.json
    ├── tsconfig*.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── types/{sample,find,section,analysis,loan}.ts
        ├── db/index.ts                 # Dexie 封装与 v1→v4 升级迁移
        ├── stores/{sampleStore,uiStore}.ts
        ├── components/common/{SampleCard,Badge,FieldGroup,EmptyState,CoordinatePicker,AppShell}.tsx
        ├── components/loan/LoanPanel.tsx   # 借出/补全/归还核对面板
        ├── hooks/{useSampleFilter,useLocalDraft,useRegionStats}.ts
        ├── pages/{Overview,Loans,New,Detail,Sections,Analysis,Locations}.tsx
        ├── router/index.tsx
        └── utils/{classify,format,geo,loanDiff}.ts
```

## 数据存储说明

- **库名**：`gbmeteorite-db`；表：`samples`、`finds`、`sections`、`analysis`、`loans`
- **版本迁移**：
  - v1 建 `samples` / `finds` / `sections`
  - v2 新增 `analysis` 表并加 `sampleId` 索引
  - v3 为 `samples` 补 `updatedAt` 字段并按 id 回填旧记录
  - v4 新增 `loans` 借阅台账表，把旧册 `storage=loan-out` 但缺借用人/日期的样本迁入 `legacy` 借阅单并拍快照
- **草稿**：`/samples/new` 与 `/analysis` 的表单草稿写入 localStorage（键前缀 `gbmeteorite:draft:`），切页自动恢复，提交后清理
- 首次打开会灌入 6 份演示样本（含 3 份旧册外借、1 份正常超期、1 份已归还）、3 条发现记录、4 张切片、3 条检测记录与 5 条借阅单，便于直接体验

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `gbmeteorite` | Compose 项目名与容器名前缀 |
| `FRONTEND_PORT` | `21825` | 宿主端口，映射到容器 80 |
