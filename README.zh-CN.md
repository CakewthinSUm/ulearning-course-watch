# ulearning-course-watch

[English](README.md) | **简体中文**

一个**代理技能（agent skill）**，用来驱动 [优学院 ulearning.cn](https://www.ulearning.cn) 的课程播放器：保持 `2.00x`、按目录逐节推进、处理播放器弹出的随堂小测、扛过平台自己的「走神暂停」，并且**只按观察到的状态**判定课时完成，而不是靠计时器猜。

优学院的课程视频是典型的「必须看满 N 小时」任务。真正的麻烦不在看，而在这个播放器是有状态的控件：小测会卡住进度、完成标记要么延迟要么在折叠章节里根本不渲染、30 分钟无操作还会弹遮罩把计时停掉。本技能把这些行为固化下来，让代理用分段的轮询把整门课看护完。

## 它做什么

- 确认目录和播放器真的起来了（登录交给人类扫微信二维码）。
- 挑出第一个既没有 `complete`、也没有被本地记录过结束的课时，必要时展开所属章节/小节，选中并把倍速设到 `2.00x`。
- 以 ≤120 秒为单位轮询，遇到小测 / 视频结束 / 卡住 / 切换课时就立刻返回。
- 处理随堂小测——单选、多选，以及**根本没有 `a.choice-item` 节点**的判断题——并且必须拿到 `correct: true` 才继续。
- 每约 48 秒派发一次 `mouseMoved`，让平台的「走神太久」遮罩不出现。
- 用「视频播过几秒后归零暂停」这一结束特征 + 本地 `Set` 判定完成，不靠计时。

## 边界（设计如此）

- 只在**你自己已登录**的浏览器会话里工作。它从不代你输密码：遇到登录墙就截图二维码交给你。
- 只用正常的播放器控件、目录导航和小测界面。**不会**改 `currentTime`、调进度接口、伪造学习记录，也不绕过验证码/监考/权限控制。
- 除你另有要求，保持 2.00x；绝不在只看计时器的情况下声称某节已完成。

**用之前请读这段：** 自动累积观看时长可能违反你所在学校的学术规定或平台条款。本技能是给「本来也要求你看的内容」提供的浏览器自动化参考——是否使用、以及后果，由你承担。

## 依赖

- 一个具备 CDP 浏览器工具的代理，或者一个提供 `tab.ax` / `tab.playwright` 接口的代理（`scripts/ulearning-helper.mjs` 是照着后者写的）。
- **一个长期存活的 Chromium + 持久化 profile**。短命的内嵌浏览器在真正播放 `<video>` 时会崩，详见 [references/site-notes.md](references/site-notes.md)。

## 安装

```bash
git clone https://github.com/CakewthinSUm/ulearning-course-watch.git \
  ~/.hermes/skills/media/ulearning-course-watch        # Hermes Agent
# 其他代理：~/.claude/skills/、$HOME/.agents/skills/、.opencode/skills/ …
```

然后跟它说：*「帮我把优学院的课刷完」* / *"keep watching the course"*。

## 目录结构

| 路径 | 内容 |
|---|---|
| `SKILL.md` | 流程：登录交接、目录遍历、分段轮询、小测循环、阻塞条件 |
| `references/site-notes.md` | DOM/AX 图谱，以及实跑时踩到的全部坑 |
| `scripts/ulearning-helper.mjs` | `snapshot` / `nextLesson` / `selectPage` / `getQuiz` / `answerQuiz` / `waitForQuizOrEnd` |
| `agents/openai.yaml` | 可选的 Codex/ChatGPT 技能元数据 |

## 值得先知道的坑（细节都在参考里）

- `learnCourse.html` 不能直接导航打开——必须回到课件页点「继续学习」，让站点自己 `window.open`。
- `video.ended` 不可信：站点会把 `currentTime` 重置成 0、把 `paused` 设成 true，而 `ended` 仍是 false。判结束要用「播过几秒 → 暂停且归零」。
- 折叠章节里的课时不会渲染 `.page-name.complete`——没展开的一律按未完成处理。
- 「重做」**不清空**已选项，要先按 `.checkbox.selected` 把多余的取消掉。
- 轮询时**先判结束再判小测弹窗**，否则残留弹窗会掩盖结束事件，永远卡在同一节课。

## 状态说明

`tab.ax` / `tab.playwright` 这套接口来自本技能最初编写时所用的代理工具链。在纯 CDP 栈上用 `Runtime.evaluate` / `Accessibility.getFullAXTree` / `Input.dispatchMouseEvent` 可以驱动同样的选择器，映射见 `references/site-notes.md`。实跑阶段验证过一整门课（小测 17/17 全对）；但 helper 本身没有在纯 CDP 适配层上由维护者复跑过，所以那条路径目前是「有文档、未实测」。

## 许可证

MIT，见 [LICENSE](LICENSE)。
