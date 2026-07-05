# Cloud TTS Reader - Obsidian Local TTS Plugin

Cloud TTS Reader is an **Obsidian local TTS plugin** that reads selected text or active Markdown notes aloud with a local `ttsctl` text-to-speech CLI. It is built for offline note reading, Markdown narration, local-first speech synthesis, and shared macOS / Windows Obsidian vaults.

Keywords: Obsidian TTS plugin, local text-to-speech, Markdown reader, offline TTS, note narration, `ttsctl`, macOS TTS, Windows TTS.

The plugin is intentionally local-first: Obsidian extracts and cleans Markdown text, splits long notes into manageable chunks, calls `ttsctl say <text> --output <wav> --speed <number>`, then plays the generated wav files inside Obsidian.

## Features

- Obsidian desktop plugin for local text-to-speech and Markdown note narration.
- Read selected text first; if nothing is selected, read the active Markdown note.
- Use the local `ttsctl` CLI as the speech engine.
- Split long Markdown files into chunks before synthesis.
- Play chunks sequentially inside Obsidian.
- Show a floating playback controller while reading.
- Pause, resume, and stop playback.
- Test the configured local TTS CLI from the settings page or command palette.
- Keep or automatically delete generated wav files.
- Open the generated audio output folder.
- Strip YAML frontmatter.
- Optionally skip fenced code blocks.
- Clean common Markdown syntax before narration, including headings, links, embeds, wikilinks, blockquotes, list markers, emphasis, inline code, tables, and file references.
- Desktop-only by design, because local CLI execution requires the Obsidian desktop runtime.

## Local TTS CLI Contract

The configured CLI must support this command shape:

```text
ttsctl say <text> --output <wav-path> --speed <number>
```

Default settings store CLI paths by system name so the same Obsidian vault can be shared between macOS and Windows:

```text
lorne=/Users/lorne/work_space_ai/codex-defaute/local-tts-service/ttsctl.sh
zhangxiaolong=C:\Users\18660\work_space_ai\07codex_default\local-tts-service\ttsctl.ps1
```

That `ttsctl` entrypoint uses the local `local-tts-service` repository and can synthesize offline without starting the HTTP service.
The settings page can auto-detect an existing `ttsctl` path for the current machine, or install `local-tts-service` into the default sibling project path.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create this folder in your vault:

```text
<vault>/.obsidian/plugins/cloud-tts-reader
```

3. Put the downloaded files into that folder.
4. Restart Obsidian or reload community plugins.
5. Enable **Cloud TTS Reader** in community plugin settings.

## Commands

- `Read selected text or active note aloud`
- `Pause reading`
- `Resume reading`
- `Stop reading`
- `Test local TTS CLI`
- `Open TTS output folder`

## Playback Controller

When reading starts, Cloud TTS Reader shows a floating controller in the lower-right corner of Obsidian.

The controller shows the current synthesis/playback state and chunk progress, and provides:

- `Pause`
- `Continue`
- `Stop`
- `Folder`

If Obsidian or Electron blocks automatic playback after local synthesis, click `Continue` in the controller.

## Settings

- `Current detected system name`: read-only OS username, not saved into the shared vault config.
- `TTS CLI path map`: one `system-name=ttsctl-path` entry per line. The plugin chooses the matching path at runtime, can auto-detect existing installs, and can install the sibling `local-tts-service` project.
- `Output folder`: vault-relative folder for generated wav files. Default: `.cloud-tts-reader/audio`.
- `Speed`: speech speed passed to the local CLI. Recommended range: `0.5` to `2`.
- `Max chunk characters`: chunk size used before calling the CLI.
- `Strip frontmatter`: skip YAML frontmatter.
- `Skip non-text fenced code blocks`: read `text` / `txt` / `plain` fences, omit other code fences.
- `Keep generated audio files`: keep wav files after playback instead of deleting them.
- `Open folder after synthesis`: open the output folder after a read completes.

## Development

```bash
npm install
npm run build
```

The production build writes `main.js` in the repository root.

## Privacy

Text is sent only to the configured local CLI. The plugin does not call cloud TTS APIs, store API keys, or require network access for synthesis.
