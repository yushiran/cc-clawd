# cc-clawd

**Claude Code 的像素宠物。** Claude Code 的小螃蟹 Clawd 住在输入框上方那条带子的最左边，以 60 Hz 播放动画，并且知道 Claude 在做什么：
- Claude 干活时，它敲笔记本。
- 权限框等你批准时，它举起票据。
- 没事的时候，它喝咖啡。
- 半夜，它睡觉。

别的 mod 可以让它演什么、交几行字给它画在旁边，甚至给它换个身体。

![Clawd 的 12 种状态](docs/clawd.png)

> Clawd 是 Anthropic 的 Claude Code 吉祥物。本项目是同人作品，与 Anthropic 无关，也未获其认可。

[English](README.md)

## 安装

```sh
claude plugin marketplace add yushiran/cc-clawd
claude plugin install clawd@cc-clawd
```

然后运行 `/reload-plugins`（或重启）。需要支持函数钩子 mod 的 Claude Code（2.1.289 及以上）。

## 它会做什么

| 什么时候 | 宠物 |
|---|---|
| 权限框在等你批准 | 举起票据，`?` 一闪一闪（优先级最高） |
| Claude 在干活 | 敲笔记本，屏幕显示工具在做什么：Bash 是 `>ls_`，Read 是 `[==]`，Edit 是 `+-~` |
| 没事 | 喝咖啡、东张西望、伸懒腰、眨眼 |
| 20 分钟没动静，或半夜 3 分钟没动静 | 在月亮下睡觉 |
| 有 mod 或程序发信号 | 按信号演：盯着显示器上你的数字、撒彩纸、下雨、摇铃 |
| 你点它（桌面端，或 `renderer: client`） | 冒爱心、跳一下、闪光；眼睛跟着鼠标转 |

命令：
- `/clawd`：它在做什么、为什么，以及帧率。
- `/clawd demo`：所有状态演一遍。
- `/clawd pets`：列出所有宠物；`/clawd pet slime` 换成史莱姆。
- `/clawd bench`：把终端的每种画法各测 4 秒。

设置在 `/config` → clawd：宠物（`pet`）、画法（`renderer`）、帧率（`fps`：30 / 60 / 120）。

## 怎么画

| 界面 | 画法 | 效果 |
|---|---|---|
| 大多数终端 | `raster` | 字符像素：四分块让一格画 2×2 个像素，用 `$.ui.blit` 原地刷新 |
| kitty、Ghostty | `image` | 用终端的图形协议画真像素；自动检测，并按终端记住结果 |
| 桌面端 | `client` | 在界面自己的帧时钟上播放的客户端模块，能跟鼠标互动 |
| VS Code、手机 | `text` | 当前帧画成彩色文字，状态变化时重画 |

每 1000/fps 毫秒算一帧，画面变了才发送。算一帧约 10 µs，不到 60 Hz 帧预算的 0.1%。Claude 干活时，每秒约 35 帧有变化。实测数据和最佳实践见 [docs/ENGINE.md](docs/ENGINE.md)。

## 给 mod 作者：`$.clawd`

cc-clawd 给每个插件的 `$` 都加上了 `$.clawd`，不用声明依赖。调用时包在 try/catch 里；抛错说明没装宠物，就自己画。

```js
try {
  const { columns } = await $.clawd.layout()
  await $.clawd.slot({ source: 'build', rows: [[['build ', { dim: true }], ['passing', { color: 'green' }]]], action: { label: 'log', command: 'build log' } })
  await $.clawd.signal({ source: 'build', scene: 'confetti', say: 'all green', priority: 80, ttlMs: 20000 })
  await $.clawd.emote({ emote: 'heart' })
} catch {
  // 没装宠物：自己画带子
}
```

完整说明见 [docs/API.md](docs/API.md)。[`examples/focus-timer`](examples/focus-timer) 是约 50 行的完整示例：番茄钟倒计时，结束时宠物撒彩纸。

## 给任何程序：信号文件

脚本、定时任务、集群上的训练都能发信号：往 `~/.local/share/clawd/signals/` 写一个 JSON。宠物每秒读一次，删掉文件就撤销信号。

```sh
d=~/.local/share/clawd/signals; mkdir -p $d
printf '{"scene":"confetti","say":"训练跑完了","priority":85,"ttlMs":30000}' > $d/.train.tmp && mv $d/.train.tmp $d/train.json
```

## 自己做宠物

宠物就是一个**宠物包**：一份纯 JSON，里面是调色板、字符画精灵，以及每个状态循环播放的帧和共享道具。放进 `~/.config/clawd/pets/<id>.json`，再运行 `/clawd pet <id>`。缺的状态会逐级退回 `idle`。完整格式见 [docs/PACKS.md](docs/PACKS.md)，完整示例见 [`examples/pets/my-slime.json`](examples/pets/my-slime.json)。

```sh
node tools/preview.mjs examples/pets/my-slime.json             # 在普通终端里预览
node tools/preview.mjs examples/pets/my-slime.json --png a.png # 画一张总览图
node tools/preview.mjs --check my-pet.json                     # 只检查格式
```

## 许可

代码使用 [MIT](LICENSE)。Clawd 的形象属于 Anthropic。
