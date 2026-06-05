# 寻找自己

一个通过长期记录帮助用户看见事实、理解情绪、发现行为线索的自我发现产品原型。

## 运行

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

项目没有配置 API Key 时会使用本地规则。需要启用 AI 分析时，在服务端设置：

```powershell
$env:OPENAI_API_KEY="your-key"
python server.py
```

不要将 API Key 写入前端代码或提交到 Git。

## 数据

记录默认保存在本地 SQLite 数据库中。数据库文件已被 `.gitignore` 排除，不会上传到仓库。
