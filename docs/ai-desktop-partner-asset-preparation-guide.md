# AI 桌面伴侣资产准备指南

日期：2026-05-31

## 结论

资产准备分两层：

1. **基础资产**：用 hatch-pet 或 Petdex 兼容资产跑通 MVP。
2. **扩展资产**：用 `ai-partner.animations.json` 和 `extras/` 补本项目自己的动画。

不要一开始手工维护一整张复杂 spritesheet。推荐把 PNG 序列作为源资产，把 spritesheet / atlas 当成构建产物或兼容输入。

## 第一阶段：直接使用 hatch-pet / Petdex 基础资产

MVP 最低要求：

```text
pet.json
spritesheet.webp
```

`pet.json` 示例：

```json
{
  "id": "demo-partner",
  "displayName": "Demo Partner",
  "description": "Petdex compatible partner",
  "spritesheetPath": "spritesheet.webp"
}
```

`spritesheet.webp` 要求：

- 8 列 x 9 行。
- cell size: `192x208`。
- 总尺寸：`1536x1872`。
- 行顺序：`idle`、`running-right`、`running-left`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review`。

这一步的目标不是完美，而是让 Petdex 资产能进入 ai-partner 的动画 resolver。

## 第二阶段：添加 ai-partner 扩展资产

推荐目录：

```text
my-partner/
  pet.json
  spritesheet.webp
  ai-partner.animations.json
  extras/
    workflow-done/
      000.png
      001.png
      002.png
      meta.json
    physical-carried/
      000.png
      meta.json
    physical-struggling/
      000.png
      001.png
      002.png
      003.png
      meta.json
    physical-falling/
      000.png
      001.png
      002.png
      meta.json
    physical-recovering/
      000.png
      001.png
      002.png
      meta.json
    physical-hover-hug/
      000.png
      001.png
      002.png
      meta.json
```

每个 `extras/*` 目录是一段 PNG frame sequence。

## 每个扩展目录放什么

| 目录 | 内容 | 是否 MVP 必须 |
| --- | --- | --- |
| `workflow-done/` | 任务完成后的庆祝、松一口气、打招呼或开心反馈 | 建议有 |
| `physical-struggling/` | 被用户按住/拖拽时左右挣扎的小循环 | 自有动画包 v0 必须 |
| `physical-falling/` | 松手后的下落过渡，不循环 | 自有动画包 v0 必须 |
| `physical-recovering/` | 落地后站稳，再回到 idle 或 workflow 状态，不循环 | 自有动画包 v0 必须 |
| `physical-hover-hug/` | 鼠标每次 hover partner 时播放一次拥抱/贴近反馈，不循环 | 自有动画包 v0 必须 |
| `physical-carried/` | 被用户拎住时的基础姿态，可以先是一帧 | 可后置 |

如果这些目录缺失，resolver 必须 fallback：

| 缺失动画 | fallback |
| --- | --- |
| `workflow-done` | `legacy.waving` 或 `legacy.jumping` |
| `physical-carried` | `legacy.idle + drag transform` |
| `physical-struggling` | `legacy.running-left/right + shake` |
| `physical-falling` | `legacy.idle + gravity/rotation transform` |
| `physical-recovering` | `legacy.idle` |
| `physical-hover-hug` | 忽略 hover body override，保持当前 body animation |

## PNG frame 要求

推荐规格：

- 每帧透明 PNG。
- 每帧画布：`192x208`。
- 伴侣主体大小和基准线尽量稳定。
- 不要带阴影、背景、文字、气泡、UI、代码片段。
- 不要把状态文字画进图片，气泡由 UI 层负责。
- 文件名使用三位序号：`000.png`、`001.png`。
- 同一段动画里保持角色比例、朝向、脸、配色和道具一致。

如果源图不是 `192x208`，也可以先保存更高分辨率源文件，但导入工具必须产出 `192x208` 运行帧。

## meta.json

每段动画可以带一个很小的 `meta.json`：

```json
{
  "fps": 8,
  "loop": true,
  "origin": "custom",
  "notes": "Fallback-safe extension animation."
}
```

`workflow-done`、`physical-falling`、`physical-recovering`、`physical-hover-hug` 通常不是无限循环；`physical-struggling` 通常循环。因为 runtime 里部分 loader 会默认把未声明的动画当成循环，非循环动画必须在 manifest 里显式写 `"loop": false`。

## ai-partner.animations.json

扩展清单示例：

```json
{
  "schemaVersion": "ai-partner.animations.v1",
  "baseAsset": {
    "format": "petdex",
    "spritesheetPath": "spritesheet.webp",
    "cellSize": { "width": 192, "height": 208 }
  },
  "animations": {
    "workflow.done": {
      "source": "extras/workflow-done",
      "fps": 8,
      "loop": false,
      "priority": 80,
      "tags": ["workflow", "done", "celebrate"],
      "fallbacks": ["legacy.waving", "legacy.jumping", "legacy.idle"]
    },
    "physical.struggling": {
      "source": "extras/physical-struggling",
      "fps": 10,
      "loop": true,
      "priority": 90,
      "tags": ["physical", "struggling", "drag"],
      "fallbacks": ["legacy.running-left", "legacy.running-right", "legacy.idle"]
    },
    "physical.falling": {
      "source": "extras/physical-falling",
      "fps": 10,
      "loop": false,
      "priority": 95,
      "tags": ["physical", "falling", "release"],
      "fallbacks": ["legacy.idle"]
    },
    "physical.recovering": {
      "source": "extras/physical-recovering",
      "fps": 8,
      "loop": false,
      "priority": 85,
      "tags": ["physical", "recovering", "release"],
      "fallbacks": ["legacy.idle"]
    },
    "physical.hover-hug": {
      "source": "extras/physical-hover-hug",
      "fps": 8,
      "loop": false,
      "priority": 40,
      "tags": ["physical", "hover", "hug"],
      "fallbacks": []
    }
  }
}
```

MVP 只需要读取这个静态 manifest，不需要做动画编辑器、资产市场或复杂打包器。`physical.hover-hug` 缺失时不应该 fallback 到 `legacy.waving` 或 `legacy.jumping`，否则 hover 会被误读成任务完成或庆祝。

## 自有动画包 v0 不是重做 Petdex 9 行

`pet.json + spritesheet.webp` 仍然是当前 app 发现本地 companion 的兼容入口，因此打包工具仍要产出一个 `1536x1872` 的最小兼容 spritesheet。这个 spritesheet 可以是 deterministic compatibility shim 或复用已授权 base asset；不要要求图像模型为自有动画包重新生成 Petdex 的 `running-right`、`running-left`、`waving`、`jumping` 等 legacy 行。

自有动画包 v0 的主要产物是：

```text
ai-partner.animations.json
extras/workflow-done/
extras/physical-struggling/
extras/physical-falling/
extras/physical-recovering/
extras/physical-hover-hug/
```

## 你现在应该怎么准备

最短路线：

1. 先用 hatch-pet 生成一个标准 Petdex 兼容伴侣。
2. 不补任何 `extras/`，先让 app 能加载 `pet.json + spritesheet.webp`。
3. 用 resolver fallback 做 `workflow.done`、`physical.struggling`、`physical.falling`。
4. 等状态链路跑通后，优先补 `workflow-done/`，因为任务完成反馈最有情绪价值。
5. 再补 `physical-struggling/`，因为这是本项目和普通 AI 状态伴侣拉开差异的动作。
6. 最后补 `physical-carried/`、`physical-falling/`、`physical-recovering/`。

MVP real asset smoke 只需要一个默认/配置 golden asset。不要复制用户私有素材进仓库；本机验证时可显式传入 atlas 路径：

```bash
VITE_AI_PARTNER_DEFAULT_ATLAS_PATH="$HOME/.petdex/pets/artoria/spritesheet.webp" pnpm tauri:dev
```

该路径只用于本地 smoke/build 注入，不代表要做宠物搜索、切换、市场或管理 UI。默认发布构建不设置这个变量时仍使用内置 probe atlas。

## 不推荐现在做的事

- 不要先做完整 Live2D / Spine / Rive 管线。
- 不要先做伴侣资产市场。
- 不要把每个 AI 状态都画一套专属动画。
- 不要把气泡文字、代码片段或状态标签画进伴侣图片。
- 不要为了 Petdex 兼容保留 `waving/jumping/running-left/right` 作为产品语义。
