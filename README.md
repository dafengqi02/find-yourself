# 寻找自己

一个通过长期记录帮助用户看见事实、理解情绪、发现行为线索的自我发现产品原型。

## 本地运行

需要 Python 3：

```powershell
python server.py
```

然后打开：

```text
http://127.0.0.1:5180/
```

也可以在 Windows 上双击 `启动寻找自己.bat`。

## AI 能力

没有配置 API Key 时，项目会使用本地规则。启用 AI 分析时，在服务端设置：

```powershell
$env:OPENAI_API_KEY="your-key"
python server.py
```

不要将 API Key 写入前端代码或提交到 Git。

## 数据

本地运行时，记录保存在 SQLite 数据库中。数据库文件已被 `.gitignore` 排除。

部署到公网时，默认使用浏览器本地存储。每位访客的数据彼此独立，不会进入公共数据库。

## 部署到 Render

仓库包含 `render.yaml`，可以在 Render 中使用 Blueprint 连接 GitHub 仓库并部署。

如需在线启用 AI，在 Render 的环境变量中设置 `OPENAI_API_KEY`。
