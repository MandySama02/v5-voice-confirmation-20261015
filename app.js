const CONFIG_URL = "data/evaluation-config.json";
const LABELS = ["甲", "乙"];

let config;
let state;
let storageKey;

const byId = (id) => document.getElementById(id);

function shuffle(values) {
  const result = [...values];
  const random = new Uint32Array(result.length);
  crypto.getRandomValues(random);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = random[index] % (index + 1);
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

function defaultState() {
  return {
    revision: config.revision,
    order: shuffle(config.variants.map((variant) => variant.id)),
    listened: {},
    scores: {},
    notes: {},
    decision: null,
    revealed: false,
    retryUsed: false,
    signedAt: null,
  };
}

function loadState() {
  storageKey = `voice-confirmation:${config.evaluationId}:r${config.revision}`;
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    const validOrder = stored?.order?.length === config.variants.length &&
      stored.order.every((id) => config.variants.some((variant) => variant.id === id));
    if (stored?.revision === config.revision && validOrder) return stored;
  } catch (error) {
    console.warn("Saved state could not be restored", error);
  }
  return defaultState();
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  const status = byId("saveStatus");
  status.innerHTML = "<span></span>已自动保存到本机";
}

function variantById(id) {
  return config.variants.find((variant) => variant.id === id);
}

function displayLabel(id) {
  return LABELS[state.order.indexOf(id)];
}

function isListened(id) {
  return (state.listened[id] || 0) >= config.listenGate;
}

function allScoresPresent(id) {
  const scores = state.scores[id] || {};
  return config.criteria.every((criterion) => Number.isInteger(scores[criterion.id]));
}

function qualifies(id) {
  if (!allScoresPresent(id)) return false;
  return config.criteria.every((criterion) => state.scores[id][criterion.id] >= criterion.threshold);
}

function ratingMarkup(criterion, id) {
  const selected = state.scores[id]?.[criterion.id];
  return `
    <div class="criterion" data-criterion="${criterion.id}">
      <div class="criterion-title"><strong>${criterion.label}</strong><small>${criterion.question}</small></div>
      <div class="score-buttons" aria-label="${criterion.label}评分">
        ${[1, 2, 3, 4, 5].map((score) => `
          <button type="button" data-score="${score}" class="${selected === score ? "selected" : ""}" aria-label="${criterion.label} ${score} 分">${score}</button>
        `).join("")}
      </div>
    </div>`;
}

function renderVariant(id, index) {
  const variant = variantById(id);
  const fragment = byId("variantTemplate").content.cloneNode(true);
  const card = fragment.querySelector(".variant-card");
  const audio = fragment.querySelector("audio");
  const fieldset = fragment.querySelector("fieldset");
  const note = fragment.querySelector("textarea");
  const ready = isListened(id);

  card.dataset.variant = id;
  fragment.querySelector(".variant-label").textContent = LABELS[index];
  audio.src = variant.audio;
  fieldset.innerHTML = config.criteria.map((criterion) => ratingMarkup(criterion, id)).join("");
  fieldset.disabled = !ready || state.revealed;
  note.value = state.notes[id] || "";
  note.disabled = state.revealed;

  const listenState = fragment.querySelector(".listen-state");
  const lock = fragment.querySelector(".rating-lock");
  if (ready) {
    listenState.classList.add("ready");
    listenState.querySelector("strong").textContent = "已听到 80%，评分已开放";
    lock.classList.add("unlocked");
    lock.innerHTML = "✓ 可以评分；建议仍然完整听到结尾";
  } else {
    const percent = Math.round((state.listened[id] || 0) * 100);
    listenState.querySelector("strong").textContent = percent ? `已播放 ${percent}%` : "尚未听完";
  }

  audio.addEventListener("timeupdate", () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const progress = Math.min(1, audio.currentTime / audio.duration);
    if (progress > (state.listened[id] || 0)) {
      state.listened[id] = progress;
      saveState();
      if (progress >= config.listenGate && fieldset.disabled && !state.revealed) {
        fieldset.disabled = false;
        listenState.classList.add("ready");
        listenState.querySelector("strong").textContent = "已听到 80%，评分已开放";
        lock.classList.add("unlocked");
        lock.innerHTML = "✓ 可以评分；建议仍然完整听到结尾";
      } else if (progress < config.listenGate) {
        listenState.querySelector("strong").textContent = `已播放 ${Math.round(progress * 100)}%`;
      }
    }
  });
  audio.addEventListener("ended", () => {
    state.listened[id] = 1;
    saveState();
  });

  fieldset.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-score]");
    if (!button || fieldset.disabled) return;
    const criterion = button.closest(".criterion").dataset.criterion;
    state.scores[id] ||= {};
    state.scores[id][criterion] = Number(button.dataset.score);
    button.parentElement.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
    state.decision = null;
    saveState();
    renderGate();
  });
  note.addEventListener("input", () => {
    state.notes[id] = note.value;
    saveState();
  });

  return fragment;
}

function renderGate() {
  const complete = config.variants.every((variant) => allScoresPresent(variant.id));
  const gateStatus = byId("gateStatus");
  const options = byId("decisionOptions");
  const reveal = byId("revealButton");

  if (!complete) {
    gateStatus.innerHTML = `<span class="gate-icon">⌛</span><div><strong>等待完整评分</strong><p>请完成甲乙两版的四项评分。</p></div>`;
    options.innerHTML = "";
    reveal.disabled = true;
    return;
  }

  const qualified = config.variants.filter((variant) => qualifies(variant.id));
  if (qualified.length === 2) {
    gateStatus.innerHTML = `<span class="gate-icon">✓</span><div><strong>甲乙两版均达到严格门槛</strong><p>请选择你更喜欢的一版，或确认两版都不采用。</p></div>`;
  } else if (qualified.length === 1) {
    gateStatus.innerHTML = `<span class="gate-icon">✓</span><div><strong>只有${displayLabel(qualified[0].id)}达到严格门槛</strong><p>只能签收合格版本，或确认两版都不采用。</p></div>`;
  } else {
    gateStatus.innerHTML = `<span class="gate-icon">×</span><div><strong>两版都未达到严格门槛</strong><p>本轮只能选择“两版都不通过”，不会强行推荐相对高分版本。</p></div>`;
  }

  const allowed = qualified.map((variant) => variant.id);
  if (state.decision !== "none" && !allowed.includes(state.decision)) state.decision = null;
  const candidateOptions = qualified.map((variant) => {
    const label = displayLabel(variant.id);
    return `<label class="decision-option"><input type="radio" name="decision" value="${variant.id}" ${state.decision === variant.id ? "checked" : ""}><span>选择${label}作为本轮节奏确认版本</span></label>`;
  });
  candidateOptions.push(`<label class="decision-option"><input type="radio" name="decision" value="none" ${state.decision === "none" ? "checked" : ""}><span>两版都不通过，保留一次定向重做机会</span></label>`);
  options.innerHTML = candidateOptions.join("");
  options.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
    state.decision = input.value;
    saveState();
    reveal.disabled = false;
  }));
  reveal.disabled = !state.decision || state.revealed;
}

function scoreTable(id) {
  return config.criteria.map((criterion) => `${criterion.label} ${state.scores[id]?.[criterion.id] ?? "—"}`).join(" · ");
}

function renderReveal() {
  if (!state.revealed) return;
  byId("revealPanel").classList.remove("hidden");
  byId("revealButton").disabled = true;
  document.querySelectorAll(".ratings, .variant-card textarea, #decisionOptions input").forEach((element) => { element.disabled = true; });
  const chosenLabel = state.decision === "none" ? null : displayLabel(state.decision);
  byId("revealTitle").textContent = chosenLabel ? `你选择了${chosenLabel}` : "你确认了两版都不通过";
  byId("revealGrid").innerHTML = state.order.map((id) => {
    const variant = variantById(id);
    return `<div class="reveal-item"><strong>${displayLabel(id)} = ${variant.revealName}</strong><span>${variant.processing}</span><span>SHA-256：${variant.sha256}</span></div>`;
  }).join("");
  const decisionText = state.decision === "none" ? "本轮不通过" : `${displayLabel(state.decision)} / ${variantById(state.decision).revealName}`;
  byId("signoffSummary").innerHTML = `
    <div class="summary-line"><span>本轮选择</span><strong>${decisionText}</strong></div>
    ${state.order.map((id) => `<div class="summary-line"><span>${displayLabel(id)}评分</span><strong>${scoreTable(id)}</strong></div>`).join("")}
    <div class="summary-line"><span>重做机会</span><strong>${state.decision === "none" ? "可使用 1 次" : "未使用"}</strong></div>`;
  const signoff = byId("signoffButton");
  signoff.textContent = state.decision === "none" ? "确认本轮不通过" : "正式签收本轮结果";
  signoff.disabled = !byId("scopeCheck").checked || Boolean(state.signedAt);
}

function resultPayload() {
  const gate = Object.fromEntries(config.variants.map((variant) => [variant.id, {
    qualified: qualifies(variant.id),
    scores: state.scores[variant.id],
    notes: state.notes[variant.id] || "",
  }]));
  return {
    schema: "voice-confirmation-result/v1",
    evaluationId: config.evaluationId,
    revision: config.revision,
    priorResult: config.priorResult,
    blindOrder: state.order.map((id) => ({ display: displayLabel(id), variantId: id })),
    listenedProgress: state.listened,
    results: gate,
    thresholdRule: "Each of the four criteria must be >= 4.",
    decision: state.decision,
    selectedDisplay: state.decision === "none" ? null : displayLabel(state.decision),
    selectedRevealName: state.decision === "none" ? null : variantById(state.decision).revealName,
    variants: config.variants.map((variant) => ({
      id: variant.id,
      display: displayLabel(variant.id),
      revealName: variant.revealName,
      sha256: variant.sha256,
      durationSeconds: variant.durationSeconds,
      processing: variant.processing,
      tempo: variant.tempo,
      silencePolicy: variant.silencePolicy,
    })),
    retry: { maxRetries: config.retry.maxRetries, used: state.retryUsed, remaining: state.decision === "none" && !state.retryUsed ? 1 : 0 },
    signedAt: state.signedAt,
    scope: config.disclosure.signoffScope,
  };
}

function resultMarkdown() {
  const payload = resultPayload();
  const lines = [
    "# C 版声音节奏确认结果",
    "",
    `- 评测 ID：${payload.evaluationId}`,
    `- 签收时间：${payload.signedAt}`,
    `- 上一轮来源：系统推荐与人工选择均为 ${config.priorResult.winner}`,
    `- 本轮结论：${payload.decision === "none" ? "两版都不通过" : `签收${payload.selectedDisplay}（${payload.selectedRevealName}）`}`,
    `- 签收范围：${payload.scope}`,
    "",
    "## 盲听与评分",
    "",
    "| 盲听标签 | 揭晓版本 | 语速 | 停连 | 发音 | 音色 | 是否合格 |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
  ];
  state.order.forEach((id) => {
    const scores = state.scores[id];
    lines.push(`| ${displayLabel(id)} | ${variantById(id).revealName} | ${scores.pace} | ${scores.phrasing} | ${scores.pronunciation} | ${scores.timbre} | ${qualifies(id) ? "是" : "否"} |`);
  });
  lines.push("", "## 备注", "");
  state.order.forEach((id) => lines.push(`- ${displayLabel(id)}：${state.notes[id] || "无"}`));
  lines.push("", "## 音频校验", "");
  state.order.forEach((id) => lines.push(`- ${displayLabel(id)} / ${variantById(id).revealName}：\`${variantById(id).sha256}\``));
  lines.push("", `重做机会：${payload.retry.remaining ? "剩余 1 次" : "未启用或已用尽"}`);
  return lines.join("\n");
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderSigned() {
  if (!state.signedAt) return;
  byId("exportPanel").classList.remove("hidden");
  byId("scopeCheck").checked = true;
  byId("scopeCheck").disabled = true;
  byId("signoffButton").disabled = true;
  byId("completionTitle").textContent = state.decision === "none" ? "本轮已记录为不通过" : "本轮声音与节奏已签收";
  byId("completionText").textContent = state.decision === "none"
    ? "结果已保存在本机；可以导出记录后进入一次定向重做。"
    : "结果已保存在本机；下一阶段是否制作正式旁白，需要另行审批。";
}

async function init() {
  const response = await fetch(CONFIG_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load configuration: ${response.status}`);
  config = await response.json();
  state = loadState();

  byId("priorScores").innerHTML = config.priorResult.scores.map((item) => `<span class="score-chip">${item.label}<strong>${item.value}</strong></span>`).join("");
  byId("referenceAudio").src = config.reference.audio;
  byId("referenceTranscript").textContent = config.reference.semanticText;
  byId("confirmationScript").textContent = config.script.text;
  const grid = byId("variantGrid");
  state.order.forEach((id, index) => grid.appendChild(renderVariant(id, index)));

  renderGate();
  renderReveal();
  renderSigned();

  byId("revealButton").addEventListener("click", () => {
    if (!state.decision) return;
    state.revealed = true;
    saveState();
    renderReveal();
    byId("revealPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  byId("scopeCheck").addEventListener("change", () => {
    byId("signoffButton").disabled = !byId("scopeCheck").checked || Boolean(state.signedAt);
  });
  byId("signoffButton").addEventListener("click", () => {
    if (!state.revealed || !byId("scopeCheck").checked) return;
    state.signedAt = new Date().toISOString();
    saveState();
    renderReveal();
    renderSigned();
    byId("exportPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  byId("exportJson").addEventListener("click", () => download(
    `声音确认_${config.evaluationId}.json`,
    JSON.stringify(resultPayload(), null, 2),
    "application/json;charset=utf-8",
  ));
  byId("exportMarkdown").addEventListener("click", () => download(
    `声音确认_${config.evaluationId}.md`,
    resultMarkdown(),
    "text/markdown;charset=utf-8",
  ));
  byId("resetButton").addEventListener("click", () => {
    if (!confirm("确定清空本机上的本轮播放、评分和签收记录吗？音频与网站文件不会删除。")) return;
    localStorage.removeItem(storageKey);
    location.reload();
  });
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="shell" style="padding:80px 0"><h1>页面未能载入</h1><p>${error.message}</p><p>请通过 HTTP 服务器打开本页，不要直接双击 HTML 文件。</p></main>`;
});
