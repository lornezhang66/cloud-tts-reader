# Open Reader

## 注意力读不下去时，让耳朵接着读

## When reading gets hard, let your ears continue

我有 ADHD。长时间盯着文字很容易失去注意力，但听觉能帮我重新进入内容。所以我做了 Open Reader：一个免费、中文友好的 Obsidian 本地朗读插件。

选中一段文字，或者打开整篇笔记，就能用本地中文语音朗读。无需购买云端 TTS，不用 API Key，也不按字数付费。

I have ADHD. Reading for a long time makes it easy to lose focus, but listening helps me reconnect with the content. That is why I built Open Reader: a free, Chinese-friendly, local text-to-speech plugin for Obsidian.

Select some text or open an entire note and let Open Reader read it aloud. There is no cloud TTS subscription, API key, or per-character charge.

**为什么值得试试 · Why try it:**

- **免费使用 · Free** — 没有订阅费、调用额度或隐藏成本。No subscription, usage limit, or hidden cost.
- **中文友好 · Chinese-friendly** — 支持中文和中英混读。Supports Chinese and mixed Chinese-English text.
- **完全本地 · Fully local** — 不用 API Key，笔记内容不会上传。No API key; your notes are not uploaded.
- **理解 Markdown · Markdown-aware** — 自动跳过链接、元数据、代码和格式符号。Skips links, metadata, code, and formatting syntax.
- **一键配置 · One-click setup** — macOS、Windows 均可从插件设置安装本地引擎。Install the local engine from plugin settings on macOS or Windows.

[试听声音 · Voice comparison](https://open-reader.pages.dev/#listen) · [免费下载 · Free download](https://github.com/lornezhang66/open-reader/releases/latest) · [反馈问题 · Report an issue](https://github.com/lornezhang66/open-reader/issues/new?template=bug_report.yml)

> 目前仅支持桌面端 · Desktop only · 免费开源 · Free and open source · 首次模型下载约 130 MB · Initial model download: about 130 MB

## Local TTS Contract

The preferred protocol is Local TTS HTTP protocol 1. The CLI remains the installer, daemon launcher, and compatibility fallback:

```text
ttsctl say <text> --output <wav-path> --speed <number>
```

Open Reader detects Local TTS in a fixed per-user application directory on each computer. Absolute paths are not stored in the synced vault, so the same vault can be shared between macOS and Windows. If Local TTS is missing, the settings page offers a confirmed one-click installation; the model download is about 130 MB.

## 安装 · Installation

1. 从最新版本下载 `main.js`、`manifest.json` 和 `styles.css`。Download these three files from the latest release.
2. 在 vault 中创建以下目录。Create this folder in your vault:

```text
<vault>/.obsidian/plugins/open-reader
```

3. 将文件放入该目录。Put the downloaded files into that folder.
4. 重启 Obsidian 或重新加载社区插件。Restart Obsidian or reload community plugins.
5. 在社区插件设置中启用 **Open Reader**。Enable **Open Reader**.
6. 打开 Open Reader 设置；若本地语音引擎未安装，点击 **一键安装 · Install**。

## Commands

- `Read selected text or active note aloud`
- `Pause reading`
- `Resume reading`
- `Stop reading`
- `Test local TTS CLI`
- `Open TTS output folder`

## Playback Controller

When reading starts, Open Reader shows a floating controller in the lower-right corner of Obsidian.

The controller shows the current synthesis/playback state and chunk progress, and provides:

- `Pause`
- `Continue`
- `Stop`
- `Folder`

If Obsidian or Electron blocks automatic playback after local synthesis, click `Continue` in the controller.

## 设置 · Settings

- `本地语音引擎 · Local speech engine`：检测并一键安装 Local TTS。Detect and install Local TTS.
- `输出文件夹 · Output folder`：生成 WAV 的 vault 相对目录，默认 `.open-reader/audio`。Vault-relative audio folder.
- `语速 · Speech speed`：传给本地引擎的语速，范围 `0.5`–`2`。
- `分段字符数 · Max chunk characters`：每次合成前的文本分段大小。
- `移除 YAML 前置元数据 · Strip YAML frontmatter`：跳过 YAML frontmatter。
- `跳过非文本代码块 · Skip non-text code blocks`：朗读 `text` / `txt` / `plain`，跳过其他代码块。
- `保留音频文件 · Keep generated audio`：播放后保留 WAV 文件。
- `完成后打开文件夹 · Open folder when finished`：朗读结束后打开输出目录。

## Development

```bash
npm install
npm run build
```

The production build writes `main.js` in the repository root.

## 隐私 · Privacy

文字只发送到本机 Local TTS。插件不会调用云端 TTS API、保存 API Key，也不需要联网合成语音。

Text is sent only to Local TTS on your computer. The plugin does not call cloud TTS APIs, store API keys, or require network access for synthesis.
