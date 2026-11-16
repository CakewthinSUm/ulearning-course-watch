---
name: ulearning-course-watch
description: Automate a signed-in ulearning.cn course player by keeping video playback at 2x, advancing lessons, monitoring progress, and surfacing or handling inline quizzes through normal browser UI interaction.
---

# Ulearning Course Watch

Use this skill when the user asks to keep watching, monitor, advance, or complete a course at `ulearning.cn` or `ua.ulearning.cn`.

## Boundaries

- Work only in a browser session that is already signed in; never ask for or type the account password yourself (use the credential vault's masked prompt).
- Use normal player controls, catalog navigation, and quiz controls. Do not alter `currentTime`, call progress APIs, forge learning records, or bypass proctoring, captcha, or access controls.
- Keep the player at `2.00x` unless the user asks for another rate.
- Do not claim a lesson is complete from a timer alone. Confirm it from the lesson's completion state or an observed end-of-video transition.
- Long courses take hours. Monitor in bounded turns instead of holding one tool call for the entire course.

## Login (concrete entry path)

Step 1's "ask the user to log in" is not actionable in a headless browser — the user cannot type into it. Use the WeChat QR handoff instead:

1. `new_tab("https://www.ulearning.cn/")` → lands on `/home/portal.html#/home`.
2. Do **not** judge login state from a `.avatar` / `.user-name` selector: the portal renders 登录/注册 for anonymous visitors AND the selector matches unrelated nodes, giving a false "logged in". Read `document.body.innerText` and look for the literal `登录/注册` in the nav.
3. Click the real button — a bare `el.click()` on the text node does nothing. Target `.account-wrap .el-button--primary` and dispatch the full sequence (`mouseover`, `mousedown`, `mouseup`, `click`, all with `bubbles:true`). It navigates to `https://umooc.ulearning.cn/pc.html#/login`.
4. That page lists `Institution Login / SMS Login / WeChat Login`. Click the leaf node whose text is exactly `WeChat Login` (same event sequence). It goes to `open.weixin.qq.com/connect/qrconnect?...&redirect_uri=https://www.ulearning.cn/r/wx.html` (the `appid` query parameter is the platform's own public OAuth client) and renders the QR titled 「使用微信扫一扫登录」「优学院2」.
5. `capture_screenshot()`, copy the PNG out of the harness tmp dir to a stable path, and send it as `MEDIA:<path>`. Tell the user to scan with WeChat (or save then scan from album) and to reply as soon as they have, because **the QR expires within minutes**.
6. Poll the page for the signed-in state; if it expired, repeat from step 3.

Never type a username/password yourself. `ua.ulearning.cn` is the teacher/backoffice app (`createCourse/#/main/courseList`) — useless for a student's coursework; the student side is the portal + `umooc.ulearning.cn`.

## Workflow

1. Open the course player tab and verify that the catalog and video player are visible. If login or course entry is missing, bring the session up with the Login section above (WeChat QR, screenshot to the user), then re-check.
2. Attach to the long-lived browser instance and select the active player tab. Prefer a URL containing `learnCourse.html`; do not use the catalog-only tab.
3. Import the helper module into your agent's JS runtime (Node REPL, or your tool's `import()`), replacing the path with this skill's absolute path:

   ```js
   const uh = await import("file:///ABSOLUTE/PATH/TO/ulearning-course-watch/scripts/ulearning-helper.mjs");
   const state = await uh.snapshot(tab);
   console.log(JSON.stringify(state, null, 2));
   ```

4. Maintain a JavaScript `Set` of lesson IDs already observed ending, because the site's completion class can lag:

   ```js
   const locallyCompleted = new Set();
   ```

5. Pick the first lesson that is neither marked `.complete` nor in `locallyCompleted`:

   ```js
   const next = uh.nextLesson(await uh.snapshot(tab), locallyCompleted);
   ```

6. Open and play the lesson with `await uh.selectPage(tab, next.id)`. The helper expands a collapsed chapter or section when necessary, selects the lesson, and sets `2.00x`.
7. Monitor in chunks no longer than 120 seconds, returning immediately when a quiz appears, the video ends, playback stalls, or the active lesson changes:

   ```js
   const event = await uh.waitForQuizOrEnd(tab, 120000);
   console.log(JSON.stringify(event, null, 2));
   ```

8. Repeat the bounded wait while the result is `timeout`. When it returns `ended`, add the lesson ID to `locallyCompleted`, refresh `snapshot()`, and continue with the next incomplete lesson. A completion class that appears shortly afterward should take precedence over the local set.
9. When it returns `quiz`, read `uh.getQuiz(tab)`. Decide the answer from the question and options, then click the chosen AX node IDs with `uh.answerQuiz(tab, ids)`.
10. Require `uh.answerQuiz()` to report `correct: true` before resuming. If the result is incorrect, use visible feedback or the revealed correct answer to retry when the page allows it. Stop and ask the user if a quiz cannot be resolved after two attempts.
11. After a correct quiz, call `uh.resumeAfterQuiz(tab)` and verify that the video advances at `2.00x`.
12. Continue through the catalog until every lesson is complete or a real blocker appears.

## Blockers

Stop and report the visible state when:

- login, payment, permission, captcha, or an anti-cheat dialog requires the user;
- playback stays paused or makes no progress for 30 seconds;
- the active lesson changes unexpectedly;
- a non-quiz modal blocks the player;
- the site rejects two answer attempts for the same question;
- the browser tab closes or the browser session disconnects.

Do not silently skip a blocked lesson or mark it complete.

For site-specific selectors, AX patterns, completion behavior, and quiz DOM quirks, read [references/site-notes.md](references/site-notes.md) only when debugging the helper.
