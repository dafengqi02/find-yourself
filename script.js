const STORAGE_KEY = "find-yourself:v2";
const THEME_KEY = "find-yourself:theme";
const API_STATE_URL = "/api/state";
const API_ANALYZE_URL = "/api/analyze";
const API_CHAT_URL = "/api/emotion-chat";

const state = { entries: [], settings: {} };
let storageMode = "local";
let recognition = null;
let isListening = false;
let selectedTalent = "";
let clockTimer = null;
let lastMinuteKey = "";
let activeEmotionSession = null;
let pendingUnclearText = "";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const todayKey = new Date().toISOString().slice(0, 10);

const splashQuotes = [
  {
    text: "先弄清自己真正想要什么，努力才不会只是盲目追赶。",
    source: "从《小狗钱钱》得到的启发",
  },
  {
    text: "没有人能和你竞争成为你自己。独特的能力，需要从真实经历里慢慢找到。",
    source: "从《纳瓦尔宝典》得到的启发",
  },
  {
    text: "不要急着相信自己对自己的评价，先回到事实。",
    source: "从《穷查理宝典》得到的启发",
  },
  {
    text: "愿望写下来以后，才会从模糊的想象变成可以靠近的方向。",
    source: "关于愿望与行动",
  },
  {
    text: "真正适合你的路，常常藏在那些你愿意反复去做的事情里。",
    source: "关于独特能力",
  },
  {
    text: "财富不只来自拥有更多，也来自更清楚地知道什么对自己重要。",
    source: "关于选择与财富",
  },
  {
    text: "一次表现不能定义你，但反复出现的行为会留下关于你的线索。",
    source: "关于自我发现",
  },
  {
    text: "情绪会改变你看自己的方式，具体做过的事不会。",
    source: "关于事实与感受",
  },
  {
    text: "别人难以复制的，不是你的职位，而是你的经历、判断和长期积累。",
    source: "关于个人优势",
  },
  {
    text: "认识自己不是得出一个结论，而是不断修正对自己的理解。",
    source: "关于自知",
  },
];

const talentRules = [
  { label: "创作与输出", words: ["创造", "写", "作品", "设计", "视频", "项目", "想法", "输出", "做出来", "拍"] },
  { label: "学习与理解", words: ["学习", "阅读", "读书", "课程", "技能", "练习", "研究", "复盘", "理解"] },
  { label: "行动与练习", words: ["健身", "跑步", "篮球", "骑行", "运动", "散步", "训练", "打球", "完成", "坚持"] },
  { label: "表达与沟通", words: ["表达", "说", "写", "分享", "发布", "沟通", "讲清楚", "输出"] },
  { label: "关心与支持", words: ["帮助", "朋友", "陪", "支持", "安慰", "照顾", "理解别人", "倾听"] },
  { label: "整理与推进", words: ["推进", "解决", "交付", "整理", "计划", "复盘", "协调", "落地"] },
  { label: "关系与合作", words: ["认识", "合作", "交流", "链接", "关系", "朋友", "团队", "沟通"] },
  { label: "审美与设计", words: ["好看", "设计", "画", "拍", "颜色", "排版", "风格", "作品"] },
];

const emotionRules = [
  { label: "烦躁", words: ["烦", "烦躁", "不爽", "郁闷"] },
  { label: "开心", words: ["开心", "快乐", "爽", "顺", "满足", "轻松"] },
  { label: "焦虑", words: ["焦虑", "担心", "慌", "压力", "怕"] },
  { label: "挫败", words: ["失败", "废物", "没用", "挫败", "否定自己"] },
  { label: "疲惫", words: ["累", "疲惫", "没力气", "耗", "空"] },
];

startApp();

async function startApp() {
  applyTheme(localStorage.getItem(THEME_KEY) || "day");
  renderSplashQuote();
  Object.assign(state, await loadState());
  state.entries = state.entries.map(normalizeEntry);
  startClock();
  bindTabs();
  bindThemeSwitcher();
  bindVoice();
  bindRecord();
  bindEmotionDialogue();
  bindBackup();
  bindReview();
  render();
  if (!state.entries.length) $("#resultPanel").hidden = true;
}

function bindThemeSwitcher() {
  $$(".theme-button").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.theme));
  });
}

function applyTheme(theme) {
  const allowed = ["day", "night", "morandi"];
  const selected = allowed.includes(theme) ? theme : "day";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem(THEME_KEY, selected);
  $$(".theme-button").forEach((button) => {
    const active = button.dataset.theme === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderSplashQuote() {
  const quote = splashQuotes[Math.floor(Math.random() * splashQuotes.length)];
  $("#splashQuoteText").textContent = quote.text;
  $("#splashQuoteSource").textContent = quote.source;
}

function startClock() {
  window.clearInterval(clockTimer);
  updateClock(false);
  clockTimer = window.setInterval(() => updateClock(true), 1000);
}

function updateClock(animate) {
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  const minuteChanged = Boolean(lastMinuteKey && lastMinuteKey !== minuteKey);
  lastMinuteKey = minuteKey;

  $("#clockDate").textContent = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join(".");
  $("#clockWeekday").textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(now);
  setFlipUnit(
    $("#clockTime"),
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    animate && minuteChanged
  );
}

function setFlipUnit(element, value, shouldFlip) {
  if (element.textContent === value) return;
  element.textContent = value;
  if (!shouldFlip) return;
  element.classList.remove("flipping");
  void element.offsetWidth;
  element.classList.add("flipping");
}

async function loadState() {
  const fallback = { entries: [], settings: {} };
  try {
    const response = await fetch(API_STATE_URL);
    if (response.ok) {
      storageMode = "database";
      return { ...fallback, ...(await response.json()) };
    }
  } catch {
    storageMode = "local";
  }

  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return fallback;
  }
}

async function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (storageMode === "database") {
    try {
      await fetch(API_STATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
    } catch {
      storageMode = "local";
    }
  }
  render();
}

function normalizeEntry(entry) {
  const analysis = entry.analysis || buildLocalAnalysis(entry.text || "", []);
  const talents = normalizeTalents(analysis.abilities || analysis.talents || []);
  return {
    ...entry,
    analysis: { ...analysis, talents, abilities: talents },
    starred: Boolean(entry.starred),
  };
}

function bindTabs() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      $$(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
      $$(".view").forEach((section) => section.classList.remove("active"));
      $(`#${view}View`).classList.add("active");
    });
  });
}

function bindVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = $("#voiceBtn");

  if (!SpeechRecognition) {
    button.addEventListener("click", () => $("#entryText").focus());
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.addEventListener("start", () => {
    isListening = true;
    button.classList.add("listening");
    button.querySelector("strong").textContent = "正在听，点我结束";
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    button.classList.remove("listening");
    button.querySelector("strong").textContent = "说说今天吧";
  });

  recognition.addEventListener("result", (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    if (finalText) {
      const textarea = $("#entryText");
      textarea.value = `${textarea.value}${textarea.value ? "\n" : ""}${finalText.trim()}`;
    }
    button.querySelector("strong").textContent = interimText
      ? `正在听：${interimText.slice(0, 10)}`
      : "正在听，点我结束";
  });

  button.addEventListener("click", () => {
    if (isListening) recognition.stop();
    else recognition.start();
  });
}

function bindRecord() {
  $("#saveBtn").addEventListener("click", async () => {
    const text = $("#entryText").value.trim();
    if (!text) return;

    const inputCheck = assessInputQuality(text);
    if (!inputCheck.meaningful) {
      pendingUnclearText = text;
      renderInputReminder(inputCheck.message);
      return;
    }

    await processRecord(text);
  });

  $("#resultPanel").addEventListener("click", async (event) => {
    const action = event.target.dataset.inputAction;
    if (!action) return;
    if (action === "continue") {
      $("#entryText").focus();
      $("#resultPanel").hidden = true;
      return;
    }
    if (action === "save" && pendingUnclearText) {
      const text = pendingUnclearText;
      pendingUnclearText = "";
      await processRecord(text);
    }
  });

  $("#searchInput").addEventListener("input", renderHistory);
}

async function processRecord(text) {
    const button = $("#saveBtn");
    button.disabled = true;
    button.textContent = "正在整理";

    if (shouldEnterEmotionDialogue(text)) {
      await startEmotionDialogue(text);
      button.disabled = false;
      button.textContent = "帮我整理";
      return;
    }

    const analysis = normalizeAnalysis(await analyzeText(text), text);
    const entry = {
      id: crypto.randomUUID(),
      text,
      analysis,
      date: todayKey,
      createdAt: new Date().toISOString(),
      starred: false,
    };

    state.entries.unshift(entry);
    $("#entryText").value = "";
    renderResult(analysis);
    await saveState();

    button.disabled = false;
    button.textContent = "帮我整理";
}

function assessInputQuality(text) {
  const compact = text.replace(/\s+/g, "");
  const meaningfulShort = /烦|累|痛苦|焦虑|开心|难受|害怕|生气|失眠|失败|废物|工作|感情|睡不着/.test(text);
  if (meaningfulShort) return { meaningful: true };

  if (compact.length < 3) {
    return {
      meaningful: false,
      message: "这段内容有点短，我还听不清发生了什么。可以再说一点：发生了什么，或者你当时有什么感觉？",
    };
  }

  if (/^[\d\W_]+$/u.test(compact)) {
    return {
      meaningful: false,
      message: "这段内容看起来主要是数字或符号，我暂时无法从中理解你的经历。",
    };
  }

  if (/(.)\1{5,}/u.test(compact) || /^(测试|test|hello|哈哈|呵呵|啊啊|随便){1,}$/i.test(compact)) {
    return {
      meaningful: false,
      message: "这段内容更像是在测试输入，还没有出现可以帮助你理解自己的线索。",
    };
  }

  const personalClues = [
    "我", "今天", "昨天", "最近", "因为", "觉得", "感觉", "发现", "完成", "学习",
    "阅读", "朋友", "家人", "领导", "同事", "工作", "运动", "想", "做", "去了",
  ];
  const clueCount = personalClues.filter((word) => text.includes(word)).length;
  const fragments = text.split(/[\s,，、/]+/).filter(Boolean);
  if (clueCount === 0 && fragments.length >= 4 && !/[。！？!?]/.test(text)) {
    return {
      meaningful: false,
      message: "这些词现在更像零散片段，我还无法确定它们之间发生了什么。可以补一句：哪件事让你有感觉？",
    };
  }

  return { meaningful: true };
}

function renderInputReminder(message) {
  $("#resultPanel").hidden = false;
  $("#resultPanel").innerHTML = `
    <article class="input-reminder">
      <span>我还没有听清楚</span>
      <p>${escapeHtml(message)}</p>
      <p class="input-reminder-example">你可以试着补充：发生了什么？你有什么感觉？为什么这件事让你在意？</p>
      <div>
        <button class="primary-button" type="button" data-input-action="continue">继续补充</button>
        <button class="secondary-button" type="button" data-input-action="save">仍然保存原文</button>
      </div>
    </article>
  `;
}

function bindEmotionDialogue() {
  $("#dialogueForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#dialogueInput");
    const text = input.value.trim();
    if (!text || !activeEmotionSession) return;

    input.value = "";
    appendDialogueMessage("user", text);
    activeEmotionSession.messages.push({ role: "user", content: text });
    await continueEmotionDialogue(text);
  });

  $("#dialogueCloseBtn").addEventListener("click", finishEmotionDialogue);
}

function shouldEnterEmotionDialogue(text) {
  const strongPatterns = [
    /我(是不是|就是)?(很)?(废物|没用|失败|差劲)/,
    /不想活|活着没意思|想死|自杀|伤害自己/,
    /撑不住|受不了了|崩溃|绝望|痛苦/,
  ];
  if (strongPatterns.some((pattern) => pattern.test(text))) return true;

  const negativeWords = [
    "焦虑", "压力大", "压力很大", "痛苦", "难受", "压抑", "失眠", "睡不着",
    "害怕", "担心", "内耗", "疲惫", "很累", "崩溃", "自责", "后悔", "迷茫",
  ];
  const matches = negativeWords.filter((word) => text.includes(word)).length;
  const intensity = /非常|特别|一直|每天|最近总是|越来越|完全|根本/.test(text);
  return matches >= 2 || (matches >= 1 && intensity);
}

async function startEmotionDialogue(text) {
  const initial = buildInitialEmotionResponse(text);
  const analysis = normalizeAnalysis(buildLocalAnalysis(text, state.entries), text);
  analysis.emotionSupport = {
    trigger: true,
    possibleAreas: initial.areas,
    translation: initial.translation,
    messages: [],
  };

  const entry = {
    id: crypto.randomUUID(),
    text,
    analysis,
    date: todayKey,
    createdAt: new Date().toISOString(),
    starred: false,
  };
  state.entries.unshift(entry);

  activeEmotionSession = {
    entryId: entry.id,
    originalText: text,
    areas: initial.areas,
    messages: [
      { role: "user", content: text },
      { role: "assistant", content: initial.empathy },
      { role: "assistant", content: initial.translation },
      { role: "assistant", content: initial.question },
    ],
  };
  entry.analysis.emotionSupport.messages = activeEmotionSession.messages;

  $("#entryText").value = "";
  $("#resultPanel").hidden = true;
  $("#emotionDialogue").hidden = false;
  $("#dialogueMessages").innerHTML = "";
  activeEmotionSession.messages.forEach((message) => appendDialogueMessage(message.role, message.content));
  renderDialogueChoices(initial.choices);
  await saveState();
  $("#emotionDialogue").scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildInitialEmotionResponse(text) {
  const areas = detectEmotionAreas(text);
  const selfAttack = /废物|没用|失败|差劲/.test(text);
  const crisis = /不想活|活着没意思|想死|自杀|伤害自己/.test(text);
  const facts = buildRecentFacts(90);

  if (crisis) {
    return {
      areas,
      empathy: "听起来你现在正承受非常强烈的痛苦。你不需要一个人扛住这一刻。",
      translation: "我先不分析原因。现在最重要的是确认你此刻的安全，并让现实中的人来到你身边。",
      question: "你现在是否有立即伤害自己的打算，或者已经准备了具体方式？",
      choices: ["有，情况紧急", "有想法，但没有具体计划", "没有，我只是非常难受"],
    };
  }

  const translation = selfAttack
    ? "你说“我是不是废物”，可能不是在客观评价能力，而是在某些事情没有达到期待后，把挫败、疲惫或失控感全部压成了对自己的否定。"
    : translateEmotion(text, areas);

  return {
    areas,
    empathy: facts.length
      ? `过去 90 天，我在你的记录里看见：\n\n${facts.join("\n")}\n\n${buildCurrentFeelingLine(text)}`
      : buildLimitedDataSupport(text),
    translation,
    question: buildRootQuestion(areas),
    choices: areas.length ? areas.map(areaLabel) : ["工作或学习", "感情或关系", "睡眠和身体", "对自己的期待", "说不清楚"],
  };
}

function buildLimitedDataSupport(text) {
  const facts = extractPresentFacts(text);
  return [
    buildCurrentFeelingLine(text),
    "我现在拥有的长期记录还不够多，所以不会假装已经完全了解你。",
    facts.length
      ? `但从你刚刚说的话里，至少能确认这些事实：${facts.join("；")}。`
      : "但有一件事可以确认：你愿意把此刻的感受说出来，而不是继续独自承受。",
    "困难会让人暂时看不清自己，但此刻的情绪不等于完整的你，也不能替你决定自己的价值。",
    "只有逐渐理解自己，看见真实的需要、能力和走过的路，信心与勇气才会有事实可以依靠，也才能更有力量面对困难和这个世界。",
  ].join("\n\n");
}

function extractPresentFacts(text) {
  const events = extractEvents(text)
    .map(cleanEventText)
    .filter(Boolean)
    .filter((event) => !/^(我)?(很)?(焦虑|难受|痛苦|疲惫|累|废物|失败|没用)$/.test(event));
  return events.slice(0, 3);
}

function buildRecentFacts(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = state.entries.filter((entry) => new Date(entry.createdAt).getTime() >= cutoff);
  const facts = [
    ["运动", countEntriesWithWords(recent, ["健身", "跑步", "篮球", "骑行", "运动", "散步", "训练", "打球"]), "次"],
    ["阅读", countEntriesWithWords(recent, ["阅读", "读书", "看书", "书里", "章节"]), "次"],
    ["输出内容", countEntriesWithWords(recent, ["写作", "文章", "发布", "作品", "视频", "输出", "内容"]), "次"],
    ["学习新知识", countEntriesWithWords(recent, ["学习", "课程", "技能", "研究", "复盘", "认知"]), "次"],
    ["帮助或支持别人", countEntriesWithWords(recent, ["帮助", "支持", "安慰", "陪伴", "倾听", "照顾"]), "次"],
  ];
  return facts
    .filter(([, count]) => count > 0)
    .slice(0, 4)
    .map(([label, count, unit]) => `${label} ${count}${unit}`);
}

function countEntriesWithWords(entries, words) {
  return entries.filter((entry) => words.some((word) => entry.text.includes(word))).length;
}

function buildCurrentFeelingLine(text) {
  if (/累|疲惫|撑不住|没力气/.test(text)) return "你现在感受到疲惫。";
  if (/焦虑|担心|害怕|慌/.test(text)) return "你现在感受到焦虑和不安。";
  if (/废物|没用|失败|差劲/.test(text)) return "你现在正在怀疑和否定自己。";
  if (/痛苦|难受|压抑|崩溃/.test(text)) return "你现在感受到痛苦和压抑。";
  return "你现在的感受很重。";
}

function detectEmotionAreas(text) {
  const rules = [
    { key: "work", words: ["工作", "领导", "同事", "客户", "方案", "加班", "学习", "考试", "成绩", "学校"] },
    { key: "relationship", words: ["感情", "对象", "男朋友", "女朋友", "伴侣", "朋友", "家人", "关系", "吵架", "分手"] },
    { key: "sleep", words: ["睡眠", "失眠", "睡不着", "熬夜", "没睡好", "身体", "生病", "疲惫", "很累"] },
    { key: "expectation", words: ["应该", "必须", "不够好", "废物", "失败", "没用", "别人都", "期待", "完美"] },
    { key: "money", words: ["钱", "收入", "负债", "房贷", "欠款", "赚钱", "财务"] },
  ];
  return rules.filter((rule) => rule.words.some((word) => text.includes(word))).map((rule) => rule.key);
}

function areaLabel(area) {
  return {
    work: "工作或学习",
    relationship: "感情或关系",
    sleep: "睡眠和身体",
    expectation: "对自己的期待",
    money: "金钱压力",
  }[area] || area;
}

function translateEmotion(text, areas) {
  const labels = areas.map(areaLabel);
  if (/焦虑|担心|害怕/.test(text)) {
    return `这可能不只是“焦虑”，更像是你面对${labels.length ? labels.join("、") : "一些尚未确定的事情"}时，既想控制结果，又担心自己应付不了。`;
  }
  if (/痛苦|难受|压抑/.test(text)) {
    return `这可能不只是“难受”，而是你在${labels.length ? labels.join("、") : "现实压力"}里承受了很久，却没有找到能真正松开的出口。`;
  }
  if (/累|疲惫|撑不住/.test(text)) {
    return "你说的“累”可能不只是身体疲惫，也可能是长期努力、维持和自我要求之后，心理上已经没有余量了。";
  }
  return "你现在的情绪可能由几种感受叠在一起：压力、失望、害怕和对自己的怀疑。我们可以一层一层拆开。";
}

function buildRootQuestion(areas) {
  if (areas.length === 1) {
    return `如果从「${areaLabel(areas[0])}」说起，最近哪一件具体的事最让你难受？`;
  }
  if (areas.length > 1) {
    return `这些感受可能同时和 ${areas.map(areaLabel).join("、")} 有关。哪一部分现在最压着你？`;
  }
  return "这种难受最近更像来自工作、关系、睡眠，还是对自己的期待？";
}

function renderDialogueChoices(choices) {
  const container = $("#dialogueChoices");
  container.innerHTML = "";
  choices.forEach((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", async () => {
      appendDialogueMessage("user", choice);
      activeEmotionSession.messages.push({ role: "user", content: choice });
      container.innerHTML = "";
      await continueEmotionDialogue(choice);
    });
    container.append(button);
  });
}

async function continueEmotionDialogue(userText) {
  const formButton = $("#dialogueForm button");
  formButton.disabled = true;
  formButton.textContent = "我在听";

  const reply = await requestEmotionReply(userText);
  appendDialogueMessage("assistant", reply.message);
  activeEmotionSession.messages.push({ role: "assistant", content: reply.message });
  renderDialogueChoices(reply.choices || []);

  const entry = state.entries.find((item) => item.id === activeEmotionSession.entryId);
  if (entry) {
    entry.analysis.emotionSupport.messages = activeEmotionSession.messages;
    entry.analysis.emotionSupport.root = reply.root || entry.analysis.emotionSupport.root || "";
    entry.analysis.emotionSupport.translation = reply.translation || entry.analysis.emotionSupport.translation;
  }
  await saveState();

  formButton.disabled = false;
  formButton.textContent = "继续说";
}

async function requestEmotionReply(userText) {
  try {
    const response = await fetch(API_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalText: activeEmotionSession.originalText,
        messages: activeEmotionSession.messages,
        latest: userText,
      }),
    });
    if (response.ok) return await response.json();
  } catch {
    // 本地追问保证无模型密钥时也能继续。
  }
  return buildLocalEmotionReply(userText, activeEmotionSession.messages);
}

function buildLocalEmotionReply(text, messages) {
  if (/有，情况紧急/.test(text)) {
    return {
      message: "请现在远离可能伤害自己的物品，去到有人在的地方，并立刻联系可信任的人陪着你。如果有立即危险，请联系当地急救服务；在中国可拨打 120 或 110。先只做这一件事：告诉我，你现在身边有没有可以联系的人？",
      choices: ["有，我现在联系他/她", "没有人在身边"],
      root: "当前首要问题是安全，而不是继续分析原因。",
    };
  }

  const areas = detectEmotionAreas(`${activeEmotionSession.originalText} ${text}`);
  const turnCount = messages.filter((message) => message.role === "user").length;
  if (turnCount <= 1) {
    const area = areas[0];
    const questions = {
      work: "这件事最刺痛你的，是做不好、失去控制、被否定，还是觉得努力没有意义？",
      relationship: "这段关系里最让你难受的，是不被理解、害怕失去、冲突，还是一直压着自己的需要？",
      sleep: "最近睡不好之前，脑子里最常反复出现的是什么？身体的疲惫有没有让所有问题看起来更严重？",
      expectation: "你心里那个“我应该做到”的标准是什么？这个标准是你真正想要的，还是来自别人和比较？",
      money: "金钱压力背后最让你害怕的是什么：失去安全感、没有选择、拖累别人，还是看不到改善的办法？",
    };
    return {
      message: `谢谢你说得更具体了一点。${questions[area] || "如果把这份难受缩小到一件具体事情，最近最先想到的是哪一件？"}`,
      choices: [],
    };
  }

  const root = inferEmotionRoot(`${activeEmotionSession.originalText} ${messages.map((item) => item.content).join(" ")}`);
  return {
    message: `我试着把它翻译一下：你现在的情绪可能不只是“${detectPrimaryEmotion(activeEmotionSession.originalText)}”，更深一层可能是${root}。这不是最终结论，但它比“都是我不好”更接近问题本身。接下来更值得观察的是：当这种情况再次发生时，你最先冒出的那个念头是什么？`,
    choices: ["我怕自己做不好", "我怕让别人失望", "我觉得自己没有选择", "我只是太累了", "还不是这些"],
    root,
    translation: `表面的情绪背后，可能是${root}。`,
  };
}

function inferEmotionRoot(text) {
  if (/应该|必须|不够好|废物|失败|别人都|完美/.test(text)) return "对自己的要求很高，并把一次结果扩大成了对整个人的评价";
  if (/领导|工作|加班|成绩|考试|客户/.test(text)) return "长期承受评价和结果压力，却缺少掌控感";
  if (/分手|关系|朋友|家人|对象|吵架/.test(text)) return "很在意关系中的连接，却担心不被理解或被失去";
  if (/失眠|睡不着|很累|疲惫|身体/.test(text)) return "身体和睡眠已经透支，让情绪承受能力明显下降";
  if (/钱|负债|收入|赚钱/.test(text)) return "安全感和选择空间受到金钱问题挤压";
  return "现实压力、自我期待和疲惫叠加在一起，让你开始把问题归咎于自己";
}

function detectPrimaryEmotion(text) {
  if (/焦虑|担心|害怕/.test(text)) return "焦虑";
  if (/废物|失败|没用|自责/.test(text)) return "自我否定";
  if (/痛苦|难受|压抑/.test(text)) return "痛苦";
  if (/累|疲惫/.test(text)) return "疲惫";
  return "难受";
}

function appendDialogueMessage(role, content) {
  const message = document.createElement("div");
  message.className = `dialogue-message ${role}`;
  message.textContent = content;
  $("#dialogueMessages").append(message);
  message.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function finishEmotionDialogue() {
  activeEmotionSession = null;
  $("#emotionDialogue").hidden = true;
  $("#dialogueMessages").innerHTML = "";
  $("#dialogueChoices").innerHTML = "";
  $("#dialogueInput").value = "";
}

function bindBackup() {
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `寻找自己-${todayKey}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  $("#clearBtn").addEventListener("click", async () => {
    if (!confirm("确定清空所有记录吗？这个操作无法撤销。")) return;
    state.entries = [];
    state.settings = {};
    selectedTalent = "";
    finishEmotionDialogue();
    await saveState();
    $("#resultPanel").hidden = true;
    $("#resultPanel").innerHTML = "";
    $("#reviewList").innerHTML = `<p class="empty-state">点击回顾，会从你的记录里随机挑出一组具体事迹。</p>`;
  });
}

function bindReview() {
  $("#reviewBtn").addEventListener("click", () => {
    const entries = pickReviewEntries();
    renderReview(entries);
  });
}

async function analyzeText(text) {
  try {
    const response = await fetch(API_ANALYZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, entries: state.entries.slice(0, 40) }),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.analysis) return data.analysis;
    }
  } catch {
    // 本地规则保证没有模型密钥时也能完成第一版体验。
  }
  return buildLocalAnalysis(text, state.entries);
}

function normalizeAnalysis(analysis, text) {
  const local = buildLocalAnalysis(text, state.entries);
  const talents = normalizeTalents(analysis.abilities || analysis.talents || local.talents);
  return {
    events: safeArray(analysis.events, local.events),
    emotions: safeArray(analysis.emotions, local.emotions),
    sources: safeArray(analysis.sources, local.sources),
    drains: safeArray(analysis.drains, local.drains),
    keywords: safeArray(analysis.keywords, local.keywords),
    talents,
    abilities: talents,
    heard: text,
    value: buildValueLine(text, talents, local.events, local.sources, local.drains),
    talentLine: buildTalentLine(talents, text),
    feedback: buildFeedback(text, talents, topItems(state.entries.slice(0, 20).flatMap((entry) => entry.analysis?.talents || []), 3)),
  };
}

function buildLocalAnalysis(text, entries = []) {
  const events = extractEvents(text);
  const emotions = matchRules(text, emotionRules);
  const talents = normalizeTalents(matchRules(text, talentRules));
  const sources = matchWords(text, ["开心", "顺", "舒服", "有能量", "篮球", "运动", "跑步", "阅读", "创造", "完成", "朋友"]);
  const drains = matchWords(text, ["烦", "累", "耗", "领导", "加班", "改方案", "压抑", "焦虑", "失败", "没意思"]);
  const keywords = [...new Set([...sources, ...drains, ...extractRuleWords(text)])].slice(0, 8);
  const repeated = topItems(entries.slice(0, 20).flatMap((entry) => entry.analysis?.talents || []), 3);

  return {
    events,
    emotions,
    sources,
    drains,
    keywords,
    talents,
    abilities: talents,
    heard: events.length ? `你提到了：${events.join("；")}。` : "你留下了一段真实的表达。",
    value: buildValueLine(text, talents, events, sources, drains),
    talentLine: buildTalentLine(talents, text),
    feedback: buildFeedback(text, talents, repeated),
  };
}

function buildValueLine(text, talents, events = [], sources = [], drains = []) {
  const actions = pickConcreteMoments(text, events, sources);
  const lines = [];

  if (actions.length) {
    lines.push(`具体事实：${actions.join("；")}。`);
  } else {
    lines.push("具体事实：你把今天发生的事和自己的感受留下来了。");
  }

  if (text.includes("废物") || text.includes("失败") || text.includes("没用")) {
    lines.push("值得被看见的地方不是那个否定自己的词，而是你在低谷里仍然愿意把事实说出来。");
  }

  const behaviorLine = buildBehaviorValue(text, talents, actions);
  if (behaviorLine) lines.push(behaviorLine);

  if (drains.length || sources.length) {
    const energyParts = [];
    if (drains.length) energyParts.push(`消耗点可能是 ${drains.join("、")}`);
    if (sources.length) energyParts.push(`能量点可能是 ${sources.join("、")}`);
    lines.push(`能量线索：${energyParts.join("；")}。这能帮你以后分辨什么在拉低你，什么在把你带回来。`);
  }

  lines.push("这不是一句简单的“你很棒”，而是一条可以被保存的证据：你正在用具体行动和感受，慢慢认识自己。");
  return lines.join("\n");
}

function buildBehaviorValue(text, talents, actions) {
  if (talents.includes("学习与理解")) {
    return "行为价值：你不是只停留在“想知道”，而是在主动吸收新信息。阅读、学习、复盘这类动作，会持续扩展你的判断力。";
  }
  if (talents.includes("行动与练习")) {
    return "行为价值：你没有只停留在情绪里，而是做了一个实际动作。行动会把模糊的自我怀疑，变成可回看的事实。";
  }
  if (talents.includes("创作与输出") || talents.includes("表达与沟通")) {
    return "行为价值：你在把想法外化。写出来、做出来、发布出来，都说明你有把内在东西变成现实痕迹的能力。";
  }
  if (talents.includes("关心与支持") || talents.includes("关系与合作")) {
    return "行为价值：你在关系里不是麻木经过，而是会注意、回应、连接别人。这种能力常常需要通过具体事迹才看得见。";
  }
  if (talents.includes("整理与推进")) {
    return "行为价值：你在整理问题、推动事情往前走。它不一定显眼，但会让生活和工作变得更可控。";
  }
  if (actions.length) {
    return "行为价值：这件事不是抽象评价，而是具体发生过的行为。具体行为越多，你对自己的理解就越不容易被一时情绪带偏。";
  }
  return "";
}

function buildTalentLine(talents, text) {
  if (!talents.length) return "这次先保留事实，不急着形成观察。等相似的事反复出现，再看看它们说明了什么。";
  return talents
    .map((talent) => `这条记录出现了「${talent}」的线索：${describeTalentEvidence(talent, text)} 先把它作为证据保存，不急着下结论。`)
    .join("\n");
}

function describeTalentEvidence(talent, text) {
  const descriptions = {
    "学习与理解": "你主动接触新知识，并尝试把它变成自己的理解",
    "行动与练习": "你用实际动作回应状态，而不是只停留在想法或情绪里",
    "创作与输出": "你在把想法、内容或作品从无到有地做出来",
    "表达与沟通": "你在尝试把感受、想法或经验说清楚、写出来",
    "关心与支持": "你注意到了别人，或者在关系里投入了理解和支持",
    "整理与推进": "你在整理、解决或推动一件事继续往前走",
    "关系与合作": "你在和人建立关系、交流信息或形成合作",
    "审美与设计": "你在关注形式、风格、画面或体验的质量",
  };
  return descriptions[talent] || "这件事里有一个值得继续观察的行为线索";
}

function buildFeedback(text, talents, repeated) {
  const lines = [];
  if (text.includes("废物") || text.includes("失败") || text.includes("没用")) {
    lines.push("你现在的感受是真实的，但它不是完整事实。");
  }
  lines.push(
    talents.length
      ? `这件事会被放进「${talents[0]}」这一组证据里。它记录的是发生过什么，不是在定义你。`
      : "这件事会先作为一条原始证据保存下来，不急着解释。"
  );
  if (repeated.length) {
    lines.push(`如果类似事迹反复出现，比如 ${repeated.map((item) => item.name).join("、")}，它们才会慢慢变成更可靠的自我理解。`);
  }
  lines.push("以后你难过时，先回来看具体事迹。事实比空泛安慰更可靠。");
  return lines.join("\n");
}

function pickConcreteMoments(text, events = [], sources = []) {
  const cleaned = events
    .map(cleanEventText)
    .filter(Boolean)
    .filter((event) => !/^(今天|我)?(很)?(烦|焦虑|难受|废物|失败|没用)$/.test(event));
  const useful = cleaned.filter((event) =>
    /篮球|运动|跑步|骑行|阅读|学习|写|作品|发布|完成|帮助|朋友|项目|输出|练习|课程|技能|复盘|整理|方案|打球|赚钱|存钱/.test(event)
  );
  const picked = useful.length ? useful : cleaned;
  if (picked.length) return [...new Set(picked)].slice(0, 3);
  return sources.length ? [`你提到了 ${sources.slice(0, 2).join("、")}`] : [];
}

function cleanEventText(event) {
  return String(event)
    .replace(/^\s*\d+[.、)]\s*/, "")
    .replace(/^我(今天)?/, "")
    .replace(/^今天/, "")
    .trim();
}

function render() {
  renderTalentBubbles();
  renderTalentEvidence();
  renderHistory();
}

function renderResult(analysis) {
  const node = $("#resultTemplate").content.firstElementChild.cloneNode(true);
  node.querySelector('[data-field="heard"]').textContent = analysis.heard;
  node.querySelector('[data-field="value"]').textContent = analysis.value;
  node.querySelector('[data-field="talent"]').textContent = analysis.talentLine;
  node.querySelector('[data-field="feedback"]').textContent = analysis.feedback;
  $("#resultPanel").hidden = false;
  if (!$("#resultPanel").querySelector(".chat-exchange")) {
    $("#resultPanel").innerHTML = "";
  }
  $("#resultPanel").append(node);
  node.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderTalentBubbles() {
  const container = $("#talentBubbles");
  const talents = topItems(state.entries.flatMap((entry) => entry.analysis?.talents || []), 8);
  container.innerHTML = "";

  if (!talents.length) {
    container.innerHTML = `<p class="empty-state">还没有泡泡。你输入的事越多，系统越能看见你的特长。</p>`;
    return;
  }

  talents.forEach((talent, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `talent-bubble tone-${(index % 4) + 1}`;
    button.classList.toggle("active", selectedTalent === talent.name);
    button.style.setProperty("--size", `${Math.min(168, 104 + talent.count * 16)}px`);
    button.innerHTML = `<strong>${escapeHtml(talent.name)}</strong><span>${talent.count} 件事迹</span>`;
    button.addEventListener("click", () => {
      selectedTalent = selectedTalent === talent.name ? "" : talent.name;
      renderTalentBubbles();
      renderTalentEvidence();
    });
    container.append(button);
  });
}

function renderTalentEvidence() {
  const title = $("#talentTitle");
  const hint = $("#talentHint");
  const container = $("#talentEvidence");
  const talent = selectedTalent || topItems(state.entries.flatMap((entry) => entry.analysis?.talents || []), 1)[0]?.name || "";

  if (!talent) {
    title.textContent = "点一个泡泡，看看它从哪里来";
    hint.textContent = "具体事迹比标签更重要";
    container.innerHTML = `<p class="empty-state">当你记录了几件事之后，这里会把相似的行为证据慢慢放在一起。</p>`;
    return;
  }

  const entries = state.entries.filter((entry) => entry.analysis?.talents?.includes(talent));
  title.textContent = `${talent} 是从这些事里被观察到的`;
  hint.textContent = `${entries.length} 件具体事迹`;
  container.innerHTML = "";
  entries.slice(0, 8).forEach((entry) => container.append(createEvidenceItem(entry, false, talent)));
}

function renderReview(entries) {
  const container = $("#reviewList");
  container.innerHTML = "";

  if (!entries.length) {
    container.innerHTML = `<p class="empty-state">还没有足够的事迹。先留下一件今天真实发生的小事。</p>`;
    return;
  }

  const intro = document.createElement("article");
  intro.className = "review-intro";
  intro.innerHTML = `<p>你现在的感受是真实的。但这些记录也是真实的。</p>`;
  container.append(intro);

  entries.forEach((entry) => container.append(createEvidenceItem(entry, true)));
}

function renderHistory() {
  const keyword = $("#searchInput")?.value.trim().toLowerCase() || "";
  const dock = $("#historyDock");
  dock.hidden = state.entries.length === 0;
  if (!state.entries.length) {
    $("#historyEntries").innerHTML = "";
    return;
  }

  const entries = state.entries.filter((entry) => {
    const text = [entry.text, entry.analysis?.events?.join(" "), entry.analysis?.talents?.join(" "), entry.analysis?.keywords?.join(" ")]
      .join(" ")
      .toLowerCase();
    return !keyword || text.includes(keyword);
  });

  const container = $("#historyEntries");
  container.innerHTML = "";

  if (!entries.length) {
    container.innerHTML = `<p class="empty-state">没有找到符合搜索条件的记录。</p>`;
    return;
  }

  entries.slice(0, 12).forEach((entry) => container.append(createEntryItem(entry)));
}

function createEvidenceItem(entry, showDate = false, focusTalent = "") {
  const node = $("#evidenceTemplate").content.firstElementChild.cloneNode(true);
  const talents = entry.analysis?.talents || [];
  const ability = focusTalent || talents[0] || "尚未归纳";
  const star = node.querySelector(".star-button");
  const toggle = node.querySelector(".original-toggle");
  const original = node.querySelector(".original-text");

  node.querySelector(".evidence-time").textContent = formatEvidenceTime(entry.createdAt, showDate);
  node.querySelector(".evidence-action").textContent = summarizeAction(entry);
  node.querySelector(".evidence-ability").textContent =
    ability === "尚未归纳"
      ? "这条记录先保留为事实，暂不形成观察。"
      : `这件事被放进「${ability}」这一组证据中。只有相似行为反复出现后，才值得继续理解。`;
  node.querySelector(".evidence-state").textContent = inferRecordedState(entry);
  node.querySelector(".evidence-clues").textContent = buildEvidenceClues(entry);
  original.textContent = entry.text;

  star.textContent = entry.starred ? "★" : "☆";
  star.classList.toggle("starred", entry.starred);
  star.addEventListener("click", async () => {
    entry.starred = !entry.starred;
    await saveState();
  });

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.textContent = expanded ? "展示当时的完整原文" : "收起完整原文";
    original.hidden = expanded;
  });

  return node;
}

function summarizeAction(entry) {
  const events = (entry.analysis?.events || []).map(cleanEventText).filter(Boolean);
  const action =
    events.find((event) =>
      /阅读|学习|写|完成|帮助|运动|篮球|跑步|骑行|练习|发布|项目|整理|解决|沟通|设计|作品|课程|技能/.test(event)
    ) || events[0];
  if (!action) return "留下了一条关于当时经历和感受的记录";
  return action.length > 72 ? `${action.slice(0, 72)}...` : action;
}

function inferRecordedState(entry) {
  const emotions = entry.analysis?.emotions || [];
  const sources = entry.analysis?.sources || [];
  const drains = entry.analysis?.drains || [];
  const parts = [];
  if (emotions.length) parts.push(`文字中出现了 ${emotions.join("、")}`);
  if (drains.length) parts.push(`可能正被 ${drains.join("、")} 消耗`);
  if (sources.length) parts.push(`同时从 ${sources.join("、")} 获得了一些能量`);
  if (!parts.length) return "仅根据这段文字暂时无法可靠判断当时状态。";
  return `根据当时的用词推测：${parts.join("；")}。这只是文本观察，不是确定判断。`;
}

function buildEvidenceClues(entry) {
  const events = (entry.analysis?.events || []).map(cleanEventText).filter(Boolean);
  const talents = entry.analysis?.talents || [];
  const keywords = entry.analysis?.keywords || [];
  const lines = [];
  if (events.length) lines.push(`行为：${events.slice(0, 3).join("；")}`);
  if (talents.length) lines.push(`证据主题：${talents.join("、")}`);
  if (keywords.length) lines.push(`反复观察词：${keywords.slice(0, 5).join("、")}`);
  return lines.length ? lines.join("\n") : "这条记录的信息还较少，先保留原文，等待更多事迹一起判断。";
}

function formatEvidenceTime(value) {
  const date = new Date(value);
  const dateText = date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const timeText = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return `${dateText} ${timeText}`;
}

function createEntryItem(entry) {
  const node = $("#entryTemplate").content.firstElementChild.cloneNode(true);
  node.querySelector(".entry-meta").textContent = formatDate(entry.createdAt);
  node.querySelector("p").textContent = entry.text;
  const tags = [...(entry.analysis?.talents || []), ...(entry.analysis?.emotions || [])].slice(0, 6);
  node.querySelector(".entry-tags").innerHTML = tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const star = node.querySelector(".star-button");
  star.textContent = entry.starred ? "★" : "☆";
  star.classList.toggle("starred", entry.starred);
  star.addEventListener("click", async () => {
    entry.starred = !entry.starred;
    await saveState();
  });
  return node;
}

function pickReviewEntries() {
  const starred = state.entries.filter((entry) => entry.starred);
  const pool = starred.length >= 2 ? starred : state.entries;
  return shuffle([...pool]).slice(0, Math.min(4, pool.length));
}

function extractEvents(text) {
  return text
    .split(/[。！？!?；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function matchRules(text, rules) {
  return rules.filter((rule) => rule.words.some((word) => text.includes(word))).map((rule) => rule.label);
}

function matchWords(text, words) {
  return words.filter((word) => text.includes(word)).slice(0, 6);
}

function extractRuleWords(text) {
  return talentRules.flatMap((rule) => rule.words.filter((word) => text.includes(word)));
}

function normalizeTalents(items) {
  const allowed = new Set(talentRules.map((rule) => rule.label));
  const normalized = items.map((item) => {
    const legacyMap = {
      创造力: "创作与输出",
      学习力: "学习与理解",
      行动力: "行动与练习",
      表达力: "表达与沟通",
      共情力: "关心与支持",
      执行力: "整理与推进",
      推进力: "整理与推进",
      领导力: "整理与推进",
      连接力: "关系与合作",
      审美力: "审美与设计",
    };
    return legacyMap[item] || item;
  });
  return [...new Set(normalized.filter((item) => allowed.has(item)))].slice(0, 4);
}

function safeArray(value, fallback) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, 8) : fallback;
}

function topItems(items, limit = 5) {
  const counts = new Map();
  items.filter(Boolean).forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function formatDate(value) {
  const date = new Date(value);
  return `${date.toLocaleDateString("zh-CN")} ${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
