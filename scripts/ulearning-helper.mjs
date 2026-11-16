const QUESTION_MARKER = "container question";
const SUBMIT_LABEL = "button 提交";
const CORRECT_LABEL = "回答正确";

function parseAxLine(line) {
  const match = line.match(/^\s*(\d+)\s+(.*)$/);
  if (!match) return null;
  return { nodeId: Number(match[1]), text: match[2].trim() };
}

function cleanLabel(text) {
  return text
    .replace(/^(?:button|text|container)\s+/, "")
    .replace(/,\s*ID:\s*[^,\n]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getAx(tab) {
  return tab.ax.get("state", { disableDiffing: true });
}

export async function snapshot(tab) {
  const dom = await tab.playwright.evaluate(() => {
    const sections = [...document.querySelectorAll(".section-item")].map((section) => {
      const sectionName = section.querySelector(".section-name .text")?.textContent?.trim() || "";
      const pages = [...section.querySelectorAll(".page-item")].map((page) => {
        const name = page.querySelector(".page-name");
        return {
          id: page.id,
          complete: Boolean(name?.classList.contains("complete")),
          active: Boolean(name?.classList.contains("active")),
          visible: Boolean(page.getBoundingClientRect().width && page.getBoundingClientRect().height),
        };
      });
      return { section: sectionName, pages };
    });

    const activePage = document.querySelector(".page-item .page-name.active")?.closest(".page-item");
    const activeSection = activePage?.closest(".section-item")
      ?.querySelector(".section-name .text")?.textContent?.trim() || "";
    const video = document.querySelector("video");

    return {
      activeId: activePage?.id || null,
      activeSection,
      catalog: sections,
      video: video
        ? {
            currentTime: video.currentTime,
            duration: video.duration,
            paused: video.paused,
            ended: video.ended,
            playbackRate: video.playbackRate,
            readyState: video.readyState,
          }
        : null,
    };
  });

  dom.lessons = dom.catalog.flatMap((section, sectionIndex) =>
    section.pages.map((page) => ({ ...page, section: section.section, sectionIndex }))
  );
  return dom;
}

export function nextLesson(state, locallyCompleted = new Set()) {
  return state.lessons.find((lesson) => !lesson.complete && !locallyCompleted.has(lesson.id)) || null;
}

export async function ensurePlayback(tab) {
  const ax = await getAx(tab);
  const speedLine = ax
    .split("\n")
    .find((line) => /radio button .*ID: mep_\d+-speed-2\.00/.test(line));
  const speedNode = speedLine ? parseAxLine(speedLine) : null;
  if (speedNode && !/Value:\s*1\b/.test(speedLine)) {
    await tab.ax.click(speedNode.nodeId);
  }

  const playLine = ax
    .split("\n")
    .find((line) => /\bbutton (?:播放|继续播放)\b/.test(line));
  const playNode = playLine ? parseAxLine(playLine) : null;
  if (playNode) await tab.ax.click(playNode.nodeId);

  await tab.playwright.waitForTimeout(1200);
}

async function revealPage(tab, pageId) {
  const visible = await tab.playwright
    .locator(`#${pageId} .page-name`)
    .isVisible()
    .catch(() => false);
  if (visible) return;

  const handles = await tab.playwright.evaluate((id) => {
    const page = document.getElementById(id);
    const section = page?.closest(".section-item");
    const chapter = page?.closest(".chapter-item");
    const isShown = (element) => Boolean(
      element && element.getBoundingClientRect().width && element.getBoundingClientRect().height
    );
    return {
      chapterId: chapter?.id || null,
      sectionId: section?.id || null,
      chapterVisible: isShown(chapter?.querySelector(".chapter-name")),
      sectionVisible: isShown(section?.querySelector(".section-name")),
    };
  }, pageId);

  if (!handles.chapterVisible && handles.chapterId) {
    throw new Error(`Chapter ${handles.chapterId} is not visible in the catalog.`);
  }
  if (handles.chapterId) {
    await tab.playwright.locator(`#${handles.chapterId} .chapter-name`).click();
    await tab.playwright.waitForTimeout(1000);
  }
  if (handles.sectionId) {
    const sectionVisible = await tab.playwright
      .locator(`#${handles.sectionId} .section-name`)
      .isVisible()
      .catch(() => false);
    if (!sectionVisible) {
      await tab.playwright.locator(`#${handles.sectionId} .section-name`).click();
      await tab.playwright.waitForTimeout(1000);
    }
  }
}

export async function selectPage(tab, pageId) {
  await revealPage(tab, pageId);
  await tab.playwright.locator(`#${pageId} .page-name`).click({ timeoutMs: 8000 });
  await tab.playwright.waitForTimeout(4000);

  let state = await snapshot(tab);
  if (state.activeId !== pageId) {
    await tab.playwright.locator(`#${pageId} .page-name`).click({ timeoutMs: 8000 });
    await tab.playwright.waitForTimeout(4000);
    state = await snapshot(tab);
  }

  await ensurePlayback(tab);
  return snapshot(tab);
}

export function isQuizVisible(ax) {
  return ax.includes(SUBMIT_LABEL) && !ax.includes(CORRECT_LABEL);
}

export function getQuiz(tabOrAx) {
  return Promise.resolve(tabOrAx).then(async (value) => {
    const ax = typeof value === "string" ? value : await getAx(value);
    const lines = ax.split("\n");
    const questionStart = lines.findIndex((line) => line.includes(QUESTION_MARKER));
    const submitIndex = lines.findIndex((line) => line.includes(SUBMIT_LABEL));
    if (questionStart < 0 || submitIndex < 0 || ax.includes(CORRECT_LABEL)) return null;

    const optionLines = lines
      .slice(questionStart + 1, submitIndex)
      .filter((line) => /\bbutton\b/.test(line) && !line.includes("button 提交"));
    const textLines = lines
      .slice(questionStart + 1, submitIndex)
      .filter((line) => /\btext\b/.test(line))
      .map(parseAxLine)
      .filter(Boolean)
      .map((node) => cleanLabel(node.text));

    const options = optionLines
      .map(parseAxLine)
      .filter(Boolean)
      .map((node) => ({ ...node, label: cleanLabel(node.text) }));
    const submit = parseAxLine(lines[submitIndex]);
    const continueLine = lines.find((line) => /\bbutton 继续播放\b/.test(line));
    const continueNode = continueLine ? parseAxLine(continueLine) : null;

    return {
      question: textLines.join(" ").trim(),
      options,
      submitNodeId: submit?.nodeId || null,
      continueNodeId: continueNode?.nodeId || null,
      raw: lines.slice(questionStart, submitIndex + 1).join("\n"),
    };
  });
}

export async function answerQuiz(tab, optionNodeIds) {
  const quiz = await getQuiz(tab);
  if (!quiz) throw new Error("No unanswered quiz is visible.");
  if (!Array.isArray(optionNodeIds) || optionNodeIds.length === 0) {
    throw new Error("At least one answer option is required.");
  }

  for (const nodeId of optionNodeIds) {
    await tab.ax.click(Number(nodeId));
  }
  if (!quiz.submitNodeId) throw new Error("Quiz submit button was not found.");
  await tab.ax.click(quiz.submitNodeId);
  await tab.playwright.waitForTimeout(1500);

  const feedbackAx = await getAx(tab);
  const feedbackLines = feedbackAx
    .split("\n")
    .filter((line) => /回答正确|回答错误|正确答案|你的答案|得分/.test(line))
    .map((line) => cleanLabel(parseAxLine(line)?.text || line));
  return {
    correct: feedbackAx.includes(CORRECT_LABEL),
    feedback: feedbackLines,
  };
}

export async function resumeAfterQuiz(tab) {
  const ax = await getAx(tab);
  const line = ax.split("\n").find((item) => /\bbutton 继续播放\b/.test(item));
  const node = line ? parseAxLine(line) : null;
  if (!node) throw new Error("Continue-playing button was not found after the quiz.");
  await tab.ax.click(node.nodeId);
  await tab.playwright.waitForTimeout(1500);
  return snapshot(tab);
}

export async function waitForQuizOrEnd(tab, timeoutMs = 120000) {
  const startedAt = Date.now();
  const initial = await snapshot(tab);
  let maxTime = initial.video?.currentTime || 0;
  let lastTime = maxTime;
  let lastProgressAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await tab.playwright.waitForTimeout(5000);
    const state = await snapshot(tab);
    const ax = await getAx(tab);

    if (isQuizVisible(ax)) {
      return {
        reason: "quiz",
        activeId: state.activeId,
        activeSection: state.activeSection,
        video: state.video,
      };
    }

    if (state.activeId !== initial.activeId) {
      return {
        reason: "lesson-changed",
        previousId: initial.activeId,
        activeId: state.activeId,
        activeSection: state.activeSection,
        video: state.video,
      };
    }

    const now = Date.now();
    if (state.video) {
      maxTime = Math.max(maxTime, state.video.currentTime);
      if (Math.abs(state.video.currentTime - lastTime) > 0.5) {
        lastTime = state.video.currentTime;
        lastProgressAt = now;
      }

      if (maxTime > 3 && state.video.paused && state.video.currentTime === 0) {
        return {
          reason: "ended",
          activeId: state.activeId,
          activeSection: state.activeSection,
          video: state.video,
        };
      }

      if (state.video.paused && now - lastProgressAt >= 30000) {
        return {
          reason: "stalled",
          activeId: state.activeId,
          activeSection: state.activeSection,
          video: state.video,
        };
      }
    }
  }

  const state = await snapshot(tab);
  return {
    reason: "timeout",
    activeId: state.activeId,
    activeSection: state.activeSection,
    video: state.video,
  };
}
