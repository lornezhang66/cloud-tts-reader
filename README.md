# Cloud TTS Reader

Cloud TTS Reader reads selected text or the active note aloud from inside your note editor.

It is designed for people who want a practical read-aloud workflow for long notes, drafts, study material, and reference documents. The default backend is Baidu Cloud Speech Synthesis, and the plugin also keeps an OpenAI-compatible backend for services such as SiliconFlow or OpenAI-style `/audio/speech` APIs. On desktop, it can also export the current note to a local HTML page and open it in Microsoft Edge for Edge's built-in Read aloud feature.

## Features

- Read selected text first; if nothing is selected, read the active Markdown note.
- Use Baidu Cloud short text speech synthesis by default.
- Cache Baidu `access_token` locally after exchanging your API Key and Secret Key.
- Split long notes into smaller chunks before synthesis.
- Pause, resume, and stop playback.
- Configure speech speed, pitch, volume, audio format, Baidu speaker ID, and client ID.
- Switch to an OpenAI-compatible speech backend when needed.
- Open the current note in Microsoft Edge for Edge Read aloud.
- Strip YAML frontmatter and optionally skip fenced code blocks before narration.

## Installation

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Create this folder in your vault:

```text
<vault>/.obsidian/plugins/cloud-tts-reader
```

3. Put the downloaded files into that folder.
4. Restart Obsidian or reload community plugins.
5. Enable **Cloud TTS Reader** in community plugin settings.

## Baidu Cloud Setup

Create a Baidu Cloud Speech application and copy its credentials into the plugin settings:

- Backend: `Baidu Cloud speech synthesis`
- Speech endpoint: `https://tsn.baidu.com/text2audio`
- API key: your Baidu application API Key
- Secret key: your Baidu application Secret Key
- Speaker ID:
  - `0`: common female voice
  - `1`: common male voice
  - `3`: Du Xiaoyao
  - `4`: Du Yaya

Available speakers and quotas depend on the voice libraries enabled for your Baidu Cloud account. Baidu Cloud's free testing resources are controlled by Baidu's console and policy, not by this plugin.

## Commands

- `Read selected text or active note aloud`
- `Pause reading`
- `Resume reading`
- `Stop reading`
- `Open selected text or active note in Microsoft Edge`

## Settings

- `TTS backend`: Baidu Cloud or OpenAI-compatible API.
- `API key`: Baidu API Key or bearer token for compatible APIs.
- `Secret key`: Baidu Secret Key.
- `Speech endpoint`: Baidu or compatible TTS endpoint.
- `Model` and `Voice`: used only by OpenAI-compatible APIs.
- `Audio format`: `mp3`, `wav`, or `pcm` for Baidu Cloud.
- `Speed`, `Pitch`, `Volume`: Baidu range is `0` to `15`, default `5`.
- `Baidu speaker ID`: voice selection for Baidu Cloud.
- `Baidu CUID`: client identifier used for quota and rate limiting.
- `Max chunk characters`: chunk size used before calling TTS.
- `Strip frontmatter`: skip YAML frontmatter.
- `Skip fenced code blocks`: omit Markdown code blocks.
- `Voice instructions`: optional style instructions for compatible APIs that support them.
- `Edge export path`: temporary HTML path used for Microsoft Edge Read aloud.

## Development

```bash
npm install
npm run build
```

The production build writes `main.js` in the repository root.

## Privacy

When using Baidu Cloud or another cloud backend, the text being read is sent to that provider for synthesis. API credentials are stored in Obsidian plugin data inside your local vault. Do not commit `data.json` or any vault plugin settings file to a public repository.
