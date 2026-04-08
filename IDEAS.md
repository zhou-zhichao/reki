# Anki Rewrite - Ideas & Research Notes

> 2026-03-25 讨论记录

## 目标

做一个 Anki 的现代替代品。保留 Rust 核心性能和通用性（不限于语言学习），砍掉历史包袱。

## 许可问题

- Anki 是 **AGPL-3.0**，包含其源码 → 整个 app 必须 AGPL 开源
- FSRS 算法是 **MIT** 许可，可自由使用
- 结论：**从零重写，不包含 Anki 源码**，许可自由选择

## 技术选型

| 决策 | Anki 现状 | 新方案 | 理由 |
|------|-----------|--------|------|
| 核心引擎 | Rust | **Rust** | 保留性能 |
| 桌面框架 | PyQt | **Tauri** | Rust 原生，包体积从 ~150MB 降到 ~10-20MB，干掉 Python 运行时 |
| 前端 | Svelte（嵌 Qt WebView） | **Svelte 或 React**（Tauri WebView） | 直连 Rust，没有中间层 |
| 数据库 | SQLite + 自研 schema | **SQLite**（更干净的 schema） | 无需兼容历史格式 |
| 同步协议 | 自研（最重的部分，几千行） | **cr-sqlite / Turso**（CRDT） | 省掉最复杂的工程量，还支持多设备同时同步 |
| 媒体文件同步 | 自研 | **S3/R2 对象存储** | 成熟方案 |
| 用户认证 | AnkiWeb 自研 | **Clerk / Auth.js** | 成熟方案 |
| SRS 算法 | FSRS（Rust 内置） | **FSRS**（MIT，直接用） | 几百行代码 |
| 层间通信 | Protobuf（Rust↔Python↔TS 三层） | **Tauri Commands**（Rust↔TS 两层） | 干掉 Python 中间层 |
| 插件系统 | Python add-on | **WASM 插件 或 Lua** | 沙箱化，安全，不绑定 Python |
| 国际化 | Fluent (FTL) | **Fluent 或 i18next** | — |
| 移动端 | 独立 Java/Swift app | **Tauri Mobile** 或 **React Native + Rust FFI** | 共享 Rust 核心 |

## 架构对比

```
Anki:      TS/Svelte → Python(PyQt) → Rust → SQLite
                        ↑ 最大的包袱

新 app:    TS/Svelte → Tauri Commands → Rust → SQLite
                        ↑ 直连，没有中间层
```

## 同步方案拆解

Anki 自研同步协议是历史原因（2006 年没有 CRDT 等方案）。现在可以用成熟组件替代：

| 功能 | 替代方案 |
|------|----------|
| 数据同步（卡片、牌组、配置、复习记录） | cr-sqlite / Turso（CRDT） |
| 媒体文件同步（图片、音频） | S3 / Cloudflare R2 |
| 用户认证 | Clerk / Auth.js |

CRDT 的优势：
- 自动冲突合并（Anki 现在是粗暴的"以服务端为准"）
- 支持多设备同时同步（Anki 目前不支持）
- 增量同步

CRDT 不能覆盖的：媒体文件、用户认证、服务端存储、首次全量同步的带宽优化。

## 性能预期

| 场景 | Anki 现状 | 重写后 |
|------|-----------|--------|
| 启动速度 | 2-5s（Python 冷启动） | <1s |
| 卡片调度 | 快（Rust） | 持平 |
| 搜索 | 快（Rust + SQLite） | 持平或更快 |
| 大量卡片浏览 | 卡顿（PyQt 表格） | 更流畅（Web 虚拟滚动） |
| 同步 | 慢（全量对比） | 更快（CRDT 增量） |
| 内存 | 200-400MB | 50-100MB |
| 包体积 | ~150MB | ~10-20MB |

## 代码量估算

| 模块 | Anki (~100K 行) | 重写估算 (~45-55K 行) | 省在哪 |
|------|-----------------|----------------------|--------|
| Rust 核心 | ~46K | ~25-30K | 更干净的 schema，无历史兼容 |
| Python 桥接层 | ~29K | **0** | 干掉 |
| 前端 UI | ~22K | ~15-20K | 不用塞进 Qt WebView |
| 同步 | ~5-8K | ~1-2K | CRDT 替代自研 |

## 插件生态迁移策略

现有 Python 插件全部不兼容。应对方案：

1. **热门功能内置化** — 很多 Top 插件本该是内置功能（暗色模式、图片遮挡等）
2. **设计 WASM/Lua 插件 API**
3. **AI 批量移植工具** — 用 Claude 将 Python 插件自动转换为新格式（大部分插件只有几百行，结构统一）
4. **集中移植 Top 50** — 长尾分布，Top 50 覆盖大多数用户需求

不追求 100% 兼容，追求 80% 用户不需要回头。

## Anki 现有技术参考

- 仓库：https://github.com/ankitects/anki
- 代码量：~100K 行（Rust 46.4%, Python 29.4%, Svelte 11.3%, TS 11.1%）
- 架构文档：https://github.com/ankitects/anki/blob/main/docs/architecture.md
- FSRS 算法：MIT 许可，有 Rust/TS/Python 实现
