# Ulearning Site Notes

Read this only when adapting or debugging the helper against the course player.

## Driving it over CDP (not a Node REPL)

The bundled helper is written against a browser tool that exposes `tab.ax.get()` / `tab.ax.click()`
plus `tab.playwright`. If your agent drives Chrome over raw CDP instead, the same selectors apply
through `Runtime.evaluate` / `Input.dispatchMouseEvent` / `Accessibility.getFullAXTree`; only the
call surface changes. Two practical points:

- **Don't run the player from a short-lived embedded browser.** Playing a real `<video>` through an
  in-app browser instance crashed it within 1–13 minutes in testing, and a restart comes back as a
  fresh profile on a random debugging port (`--remote-debugging-port=0`, real port written to
  `DevToolsActivePort` in the user-data dir) — the session goes with it.
- **Use one long-lived Chromium with a persistent profile** (`--remote-debugging-port=<fixed>
  --user-data-dir=<persistent dir>`) and attach to it over CDP. Sign in there once; the session
  survives across runs. If you must move an existing session between instances, export the jar with
  `Network.getAllCookies` and replay it with `Network.setCookies` — and only from a jar that already
  shows the signed-in state, because exporting while logged out yields a truncated jar and the
  player reports the session as expired.

- **`learnCourse.html` 不能直接导航**（会「页面内容加载失败」/ Page content loading failed）。必须从 `courseweb` 课件页真实点击「继续学习」由 window.open 打开；用 `Input.dispatchMouseEvent` 点坐标即可。
- 页面可能突然切英文（「Back / Hide TOC」），选择器不要依赖中文文案。
- **弹窗干扰**：会出现「视频观看时长≥视频时长才能算完成，并且首次观看不能拖拽进度条」的提示，需点 `知道了`；左侧「退出学习」提示是 hover 产物，可忽略。
- **小测必须全对才能继续**；答错后弹「重做」，而且**重做不清空已选项**，要先读 `.checkbox.selected` 把多余项点掉。正确答案会显示成「正确答案：A,B」。答对后要点 `继续播放`（有时弹窗不消失但视频已在走——以 `video.currentTime` 是否递增为准）。
- 判定课时完成不要只看 `.page-name.complete`：非当前章节的 complete class 不渲染。未展开章节的课时一律当未完成处理，完成状态以视频结束 + 本地 Set 为准。
- 轮询时**先判视频结束再判弹窗**，否则小测弹窗残留会掩盖结束事件，卡在同一节课。

## 小测类型与作答（实测全对 17/17）

- **单选/多选**：选项是 `a.choice-item`，选中状态在子元素 `.checkbox.selected`。点选项 → 点 `.question-view button.btn-submit`。
- **判断题（type 4）**：没有 `a.choice-item`，而是 `.checking-type` 里两个按钮：`.right-btn`（正确）与 `.wrong-btn`（错误），选中同样看 `.selected`。只按 `a.choice-item` 写会永远找不到选项。
- 答对后点 `继续播放`，然后**必须把残留的问答弹窗关掉**（`.close-btn`）。否则每轮轮询都会再点一次 `继续播放`，视频被反复重置到小测点，卡在同一秒数永不结束。
- 答错会显示「正确答案：A,B」+ `重做`；重做**不清空**已选项，要按 `.checkbox.selected` 把多余项点掉再提交。

## 平台会暂停计时（必须处理）

30 分钟无鼠标/键盘活动，会弹「计时学习已暂停 / 走神太久啦」遮罩，期间**不计入学习时长**且视频停住。处理：每 ~48 秒派发一次 `Input.dispatchMouseEvent {type:'mouseMoved'}`，并顺手点掉按钮文案为 `继续学习` 的按钮。

## 完成后的验收口径

课件页顶部三个数：`进度 %`、`累计学习时间`、`分数`；各章 100% + 分数 100 才算学习项满分。`考核` 页拆分权重：课件学习 70%、作业 20%（周小测验）、讨论 10%，光看完视频当前成绩约 80 分。

## Player and catalog

- Player URL host: `ua.ulearning.cn`; catalog URL host: `courseweb.ulearning.cn`.
- The usable tab URL normally contains `learnCourse.html` and `chapterId=`.
- Lesson pages are `.page-item[id^="page"]`. Their `.page-name` receives `active` and `complete`.
- The visible page label may only say `学习视频`; the real lesson name is in the closest `.section-item .section-name .text`.
- Only the current chapter is expanded. Click the visible ancestor `.chapter-name` before selecting a lesson in another chapter.
- The video element has a generated ID such as `elementVideo...`; prefer selecting the single `video` element.

## Player accessibility tree

- The player widget is a container such as `ID: mep_9`.
- The `2.00x` control is a radio button with `ID: mep_9-speed-2.00`.
- The normal start control is `button 播放`; after an inline quiz it may be `button 继续播放`.
- While playing, the control is `button 暂停`. Do not click it.
- Do not trust the video's `ended` property: the site can reset `currentTime` to `0`, set `paused: true`, and leave `ended: false`.

## Inline quizzes

- Quiz dialogs may not be discoverable with ordinary DOM selectors. Use the full AX tree.
- An unanswered quiz contains a `container question<id>` node and a `button 提交` node.
- Quiz options are `button` nodes. They may be radio-like single answers, checkboxes, or true/false buttons.
- After submission, feedback includes `回答正确` or `回答错误`, plus `正确答案`.
- To continue, use the `button 继续播放` node, not the normal `button 播放` regex alone.
- Some questions include a clue such as `（对）` or `（错）` in their text; still inspect the offered options before answering.

## Completion and monitoring

- A completed page's `complete` class may update a few seconds after the video ends.
- A reliable end transition is: video previously advanced past a few seconds, then becomes paused with `currentTime` reset to `0`.
- Keep each polling call below 300 seconds. A 120-second window is safe and matches a roughly two-minute check cadence.
- During polling, return early for a quiz, end transition, stalled playback, non-quiz modal, or lesson change.
