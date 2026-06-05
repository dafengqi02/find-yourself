from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "find-yourself.db"
STORAGE_MODE = os.environ.get("STORAGE_MODE", "database")


def connect():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with connect() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              data TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            INSERT OR IGNORE INTO app_state (id, data)
            VALUES (1, '{"entries":[],"settings":{}}')
            """
        )


class FindYourselfHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/api/state":
            if STORAGE_MODE == "browser":
                self.send_error(404)
                return
            with connect() as db:
                row = db.execute("SELECT data FROM app_state WHERE id = 1").fetchone()
            self.send_json(normalize_state(json.loads(row["data"])))
            return

        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/analyze":
            self.handle_analyze()
            return
        if self.path == "/api/emotion-chat":
            self.handle_emotion_chat()
            return

        if self.path != "/api/state":
            self.send_error(404)
            return
        if STORAGE_MODE == "browser":
            self.send_error(404)
            return

        try:
            payload = self.read_json()
            normalized = normalize_state(payload)
            with connect() as db:
                db.execute(
                    "UPDATE app_state SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                    (json.dumps(normalized, ensure_ascii=False),),
                )
            self.send_json({"ok": True})
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)

    def handle_analyze(self):
        try:
            payload = self.read_json()
            text = str(payload.get("text", "")).strip()
            entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
            if not text:
                self.send_json({"ok": False, "error": "text is required"}, status=400)
                return

            self.send_json({"analysis": generate_analysis(text, entries)})
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)

    def handle_emotion_chat(self):
        try:
            payload = self.read_json()
            original_text = str(payload.get("originalText", "")).strip()
            latest = str(payload.get("latest", "")).strip()
            messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
            if not original_text or not latest:
                self.send_json({"ok": False, "error": "originalText and latest are required"}, status=400)
                return
            self.send_json(generate_emotion_reply(original_text, messages, latest))
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length).decode("utf-8")
        return json.loads(payload or "{}")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def normalize_state(data):
    return {
        "entries": data.get("entries") if isinstance(data.get("entries"), list) else [],
        "settings": data.get("settings") if isinstance(data.get("settings"), dict) else {},
    }


def generate_analysis(text, entries):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return build_local_analysis(text, entries)

    model = os.environ.get("FIND_YOURSELF_MODEL", "gpt-4.1-mini")
    recent = json.dumps(entries[:20], ensure_ascii=False)
    body = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "你是「寻找自己」的自我发现分析助手。你的目标不是心理诊断、不是鸡汤、不是说教，"
                    "而是基于用户原文提取事实、情绪、能量来源、能量消耗、关键词和行为证据。"
                    "产品原则：不要给用户贴标签；不要告诉用户是谁；结论永远比证据出现得晚。"
                    "只描述发生过什么，以及哪些行为主题可能值得继续观察。"
                    "必须保留并尊重用户原话，鼓励要基于具体事迹，不要空泛夸奖。"
                    "输出必须是 JSON，字段为 events, emotions, sources, drains, keywords, abilities, "
                    "heard, value, talentLine, feedback。每个数组字段最多 6 项。"
                    "value 要分多角度具体说明这件事哪里有价值：具体事实、行为价值、能量线索、长期可观察线索。"
                    "不能只抓一个关键词就结束，不能写空泛鼓励。talentLine 要表达为行为证据主题，并说明依据，"
                    "禁止使用“你是、你属于、你天生、你就是某种人”等定义式表达。"
                    "feedback 要温暖、克制、基于事实。"
                ),
            },
            {
                "role": "user",
                "content": f"用户今天的原文：\n{text}\n\n最近历史记录：\n{recent}",
            },
        ],
        "text": {"format": {"type": "json_object"}},
    }

    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.loads(response.read().decode("utf-8"))
        parsed = json.loads(extract_response_text(data))
        return normalize_analysis(parsed, text, entries)
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError, ValueError):
        return build_local_analysis(text, entries)


def generate_emotion_reply(original_text, messages, latest):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return build_local_emotion_reply(original_text, messages, latest)

    conversation = json.dumps(messages[-12:], ensure_ascii=False)
    body = {
        "model": os.environ.get("FIND_YOURSELF_MODEL", "gpt-4.1-mini"),
        "input": [
            {
                "role": "system",
                "content": (
                    "你是「寻找自己」产品里的情绪梳理助手。用户表达了明显焦虑、压力、痛苦或自我否定。"
                    "先共情，再把模糊情绪翻译成更具体的语言，然后每次只问一个容易回答的问题。"
                    "优先从工作/学习、感情/关系、睡眠/身体、自我期待、金钱压力中寻找可能来源，"
                    "但不要强行归因，不要诊断，不要贴标签。区分事实、感受和推测。"
                    "当信息足够时，用“可能是”总结表层情绪和更深层需要。"
                    "如果出现自杀、自伤或立即危险，停止普通分析，优先确认安全并建议联系现实支持和当地紧急服务。"
                    "输出 JSON：message（回复），choices（0到5个简短选项），root（可选根源总结），"
                    "translation（可选情绪翻译）。中文输出，温暖、克制、具体。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"最初记录：\n{original_text}\n\n"
                    f"已有对话：\n{conversation}\n\n"
                    f"用户最新回答：\n{latest}"
                ),
            },
        ],
        "text": {"format": {"type": "json_object"}},
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.loads(response.read().decode("utf-8"))
        parsed = json.loads(extract_response_text(data))
        return {
            "message": str(parsed.get("message", "")).strip() or build_local_emotion_reply(original_text, messages, latest)["message"],
            "choices": parsed.get("choices", [])[:5] if isinstance(parsed.get("choices"), list) else [],
            "root": str(parsed.get("root", "")).strip(),
            "translation": str(parsed.get("translation", "")).strip(),
        }
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError, ValueError):
        return build_local_emotion_reply(original_text, messages, latest)


def build_local_emotion_reply(original_text, messages, latest):
    combined = f"{original_text} {latest} " + " ".join(
        str(item.get("content", "")) for item in messages if isinstance(item, dict)
    )
    if any(word in combined for word in ["想死", "自杀", "不想活", "伤害自己"]):
        return {
            "message": (
                "我很在意你现在的安全。请先远离可能伤害自己的物品，去到有人在的地方，"
                "并联系一个可信任的人陪着你。如果有立即危险，请联系当地急救服务。"
                "你现在身边有可以联系的人吗？"
            ),
            "choices": ["有，我现在联系", "没有人在身边"],
            "root": "当前首要问题是安全，不是继续分析原因。",
            "translation": "你正在承受强烈痛苦，需要现实中的即时支持。",
        }

    if any(word in combined for word in ["废物", "没用", "失败", "不够好", "应该", "必须"]):
        root = "对自己的期待很高，并把一次结果扩大成了对整个人的否定"
    elif any(word in combined for word in ["工作", "领导", "加班", "考试", "成绩", "客户"]):
        root = "长期承受结果和评价压力，却缺少掌控感"
    elif any(word in combined for word in ["关系", "分手", "对象", "朋友", "家人", "吵架"]):
        root = "在意关系中的连接，也担心不被理解或失去"
    elif any(word in combined for word in ["失眠", "睡不着", "疲惫", "很累", "身体"]):
        root = "睡眠和身体已经透支，降低了情绪承受能力"
    elif any(word in combined for word in ["钱", "收入", "负债", "欠款", "赚钱"]):
        root = "安全感和选择空间受到金钱问题挤压"
    else:
        root = "现实压力、自我期待和疲惫叠加，让你开始把问题归咎于自己"

    user_turns = sum(
        1 for item in messages if isinstance(item, dict) and item.get("role") == "user"
    )
    if user_turns < 2:
        message = "谢谢你继续说。最近哪一件具体的事，最容易让这种感受一下子变强？"
        choices = ["被否定或批评时", "事情失控时", "和别人比较时", "独处或睡前", "说不清楚"]
    else:
        message = (
            f"我试着把它翻译一下：表面上你在责怪自己，更深一层可能是{root}。"
            "这不是最终结论，但它比“都是我不好”更接近问题本身。"
            "当这种情况再次发生时，你最先冒出的念头通常是什么？"
        )
        choices = ["我怕自己做不好", "我怕让别人失望", "我觉得没有选择", "我只是太累了", "还不是这些"]
    return {
        "message": message,
        "choices": choices,
        "root": root,
        "translation": f"表面的难受背后，可能是{root}。",
    }


def extract_response_text(data):
    if data.get("output_text"):
        return data["output_text"]

    chunks = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(content["text"])
    return "\n".join(chunks).strip()


def normalize_analysis(data, text, entries):
    fallback = build_local_analysis(text, entries)
    result = {}
    for key in ["events", "emotions", "sources", "drains", "keywords", "abilities"]:
        value = data.get(key)
        result[key] = value[:6] if isinstance(value, list) else fallback[key]
    for key in ["heard", "translation", "energy", "feedback"]:
        value = data.get(key)
        result[key] = value if isinstance(value, str) and value.strip() else fallback[key]
    return result


def build_local_analysis(text, entries):
    events = extract_events(text)
    emotions = match_emotions(text)
    sources = match_words(text, ["开心", "顺", "舒服", "有能量", "篮球", "运动", "跑步", "阅读", "创造", "完成", "朋友"])
    drains = match_words(text, ["烦", "累", "耗", "领导", "加班", "改方案", "压抑", "焦虑", "失败", "没意思"])
    keywords = extract_keywords(text)
    abilities = match_abilities(text)
    repeated = top_items(
        [
            keyword
            for entry in entries[:14]
            for keyword in entry.get("analysis", {}).get("keywords", [])
            if isinstance(keyword, str)
        ],
        4,
    )

    return {
        "events": events,
        "emotions": emotions,
        "sources": sources,
        "drains": drains,
        "keywords": keywords,
        "abilities": abilities,
        "heard": build_heard(events, emotions),
        "translation": build_translation(text, emotions, sources, drains),
        "energy": build_energy_line(sources, drains),
        "feedback": build_feedback(abilities, repeated),
    }


def extract_events(text):
    parts = []
    for item in text.replace("\n", "。").split("。"):
        clean = item.strip(" ！？!?；;，,")
        if clean:
            parts.append(clean)
    return parts[:4]


def match_emotions(text):
    rules = {
        "烦躁": ["烦", "烦躁", "不爽", "火大", "郁闷"],
        "开心": ["开心", "快乐", "爽", "顺", "满足", "轻松"],
        "焦虑": ["焦虑", "担心", "慌", "压力", "怕"],
        "挫败": ["失败", "废物", "没用", "挫败", "否定自己"],
        "疲惫": ["累", "疲惫", "没力气", "耗", "空"],
        "平静": ["平静", "安静", "稳定", "舒服"],
    }
    return [label for label, words in rules.items() if any(word in text for word in words)]


def match_abilities(text):
    rules = {
        "创作与输出": ["创造", "写", "作品", "设计", "画", "拍", "视频", "项目", "想法", "输出", "做出来"],
        "关心与支持": ["帮助", "朋友", "陪", "支持", "安慰", "分享", "教", "照顾"],
        "学习与理解": ["学习", "阅读", "读书", "课程", "技能", "练习", "研究", "复盘"],
        "行动与练习": ["健身", "跑步", "篮球", "骑行", "运动", "散步", "训练", "打球"],
        "表达与沟通": ["表达", "写", "说", "分享", "发布", "输出"],
        "整理与推进": ["完成", "坚持", "推进", "交付", "打卡", "做到"],
    }
    return [label for label, words in rules.items() if any(word in text for word in words)]


def extract_keywords(text):
    words = [
        "创造", "写", "作品", "设计", "视频", "项目", "输出", "帮助", "朋友", "学习", "阅读",
        "技能", "健身", "跑步", "篮球", "骑行", "运动", "工作", "领导", "方案", "会议",
        "赚钱", "收入", "副业", "焦虑", "压抑", "开心",
    ]
    return list(dict.fromkeys([word for word in words if word in text]))[:8]


def match_words(text, words):
    return [word for word in words if word in text][:5]


def build_heard(events, emotions):
    event_line = f"你提到了：{'；'.join(events)}。" if events else "你留下了一段真实的表达。"
    emotion_line = f"里面能看见 {'、'.join(emotions)}。" if emotions else "情绪还没有完全展开，但它值得被认真听见。"
    return f"{event_line}\n{emotion_line}"


def build_translation(text, emotions, sources, drains):
    if any(word in text for word in ["废物", "失败", "没用"]):
        return "你现在像是在用一个很重的词概括自己。但这更可能是一种低谷里的自我评价，不等于事实本身。"
    if any(word in drains for word in ["领导", "改方案", "加班", "压抑"]):
        return "听起来你不是单纯烦躁，而是在投入之后被反复打断，心里产生了挫败和消耗感。"
    if sources and drains:
        return "今天不是单一的好或坏，而是有些事情消耗了你，也有些事情把你重新拉回了自己。"
    if sources:
        return "你提到的这些片段，像是在提醒你：真正让你有能量的东西，往往已经在日常里出现了。"
    if "焦虑" in emotions:
        return "焦虑背后可能不是你不够好，而是你正在同时承受期待、变化和不确定。"
    return "你说得不多，但这段记录已经在帮你把模糊的感受变成可以被看见的线索。"


def build_energy_line(sources, drains):
    source_line = f"点亮你的可能是：{'、'.join(sources)}。" if sources else "今天的能量来源还不明显。"
    drain_line = f"消耗你的可能是：{'、'.join(drains)}。" if drains else "今天的主要消耗还不明显。"
    return f"{source_line}\n{drain_line}"


def build_feedback(abilities, repeated):
    ability_line = f"这条记录里浮现出 {'、'.join(abilities)}。" if abilities else "这条记录还没有急着给你贴标签。"
    repeated_line = (
        f"最近你反复提到 {'、'.join(item['name'] for item in repeated)}，这可能是你的长期线索。"
        if repeated
        else "再多记录几次，系统会开始看见你的长期模式。"
    )
    return f"{ability_line}\n{repeated_line}\n今天先不用评价自己，只把事实留下来。事实会慢慢替你说话。"


def top_items(items, limit):
    counts = {}
    for item in items:
        counts[item] = counts.get(item, 0) + 1
    return [
        {"name": name, "count": count}
        for name, count in sorted(counts.items(), key=lambda pair: pair[1], reverse=True)[:limit]
    ]


if __name__ == "__main__":
    if STORAGE_MODE != "browser":
        init_db()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5180"))
    server = ThreadingHTTPServer((host, port), FindYourselfHandler)
    print(f"寻找自己 server: http://{host}:{port}/")
    print(f"Storage mode: {STORAGE_MODE}")
    server.serve_forever()
