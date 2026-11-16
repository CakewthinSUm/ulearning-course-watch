# ulearning-course-watch

**English** | [简体中文](README.zh-CN.md)

An **agent skill** for driving the [ulearning.cn](https://www.ulearning.cn) course player: keep
playback at `2.00x`, walk the catalog lesson by lesson, handle the inline quizzes the player
throws at you, survive the platform's own "you've been idle" pause, and confirm completion from
observed state instead of guessing.

`ulearning` course videos are the classic "must watch N hours" assignment. The bottleneck is not
watching — it is that the player is a stateful widget: quizzes block progress, the completion class
lags or does not render at all in collapsed chapters, and a 30-minute idle overlay silently stops
the clock. This skill encodes that behaviour so an agent can babysit the whole course in bounded
polling turns.

## What it does

- Verifies the catalog + player are actually up (and hands login to the human via WeChat QR).
- Picks the first lesson that is neither `complete` nor locally observed-ending, expands its
  chapter/section if collapsed, selects it, and sets `2.00x`.
- Polls in ≤120 s windows, returning early on quiz / end / stall / lesson change.
- Answers inline quizzes — single choice, multiple choice, and the true/false type that has no
  `a.choice-item` nodes at all — and requires `correct: true` before resuming.
- Dispatches a synthetic `mouseMoved` every ~48 s so the platform's idle overlay never appears.
- Reports completion from an end-of-video transition plus a local `Set`, not from a timer.

## Boundaries (by design)

- Works only in a browser session **you** are already signed in to. It never types a password: when
  a login wall appears it screenshots the QR code and hands it to you.
- Uses normal player controls, catalog navigation and quiz UI. It does **not** set `currentTime`,
  call progress APIs, forge learning records, or bypass captchas/proctoring/access controls.
- Keeps 2.00x unless you ask otherwise, and never claims a lesson is complete on a timer alone.

**Read this before using it:** automatically accruing watch time may violate your institution's
academic rules or the platform's terms. The skill is a browser-automation reference for content you
are expected to watch anyway — the decision, and the consequences, are yours.

## Requirements

- An agent with a browser tool over CDP, or one exposing a `tab.ax` / `tab.playwright` surface
  (that is what `scripts/ulearning-helper.mjs` is written against).
- One **long-lived** Chromium with a persistent profile. An embedded/short-lived browser crashes
  while playing real `<video>`; see [references/site-notes.md](references/site-notes.md).

## Install

```bash
git clone https://github.com/CakewthinSUm/ulearning-course-watch.git \
  ~/.hermes/skills/media/ulearning-course-watch        # Hermes Agent
# other agents: ~/.claude/skills/, $HOME/.agents/skills/, .opencode/skills/ …
```

Then: *"keep watching the course"* / *「帮我把优学院的课刷完」*.

## Layout

| Path | What |
|---|---|
| `SKILL.md` | The workflow: login handoff, catalog walk, bounded polling, quiz loop, blockers |
| `references/site-notes.md` | DOM/AX map and every quirk found while running it for real |
| `scripts/ulearning-helper.mjs` | `snapshot` / `nextLesson` / `selectPage` / `getQuiz` / `answerQuiz` / `waitForQuizOrEnd` |
| `agents/openai.yaml` | Optional Codex/ChatGPT skill metadata |

## Site quirks worth knowing (all in the reference)

- `learnCourse.html` cannot be opened by direct navigation — it must be reached by clicking
  继续学习 so the site opens it via `window.open`.
- `video.ended` is untrustworthy: the site can reset `currentTime` to 0, set `paused`, and leave
  `ended` false. Use "advanced past a few seconds, then paused at 0" as the end transition.
- `.page-name.complete` does not render for lessons in collapsed chapters — treat unexpanded as
  incomplete.
- 重做 (retry) does **not** clear previously selected options; deselect the extras from
  `.checkbox.selected` first.
- Check the end transition *before* quiz modals when polling, or a leftover dialog hides the end
  event and you loop on the same lesson forever.

## Status

The `tab.ax` / `tab.playwright` surface comes from the agent toolkit this was first written on. On
a raw-CDP stack the same selectors work through `Runtime.evaluate` / `Accessibility.getFullAXTree` /
`Input.dispatchMouseEvent`; `references/site-notes.md` covers the mapping. Verified in real use on a
full course (quizzes answered 17/17 correct); the helper itself has not been re-run on a raw-CDP
adapter by the maintainer, so treat that path as documented, not tested.

## License

MIT — see [LICENSE](LICENSE).
