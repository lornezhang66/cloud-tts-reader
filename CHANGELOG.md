# Changelog

## 1.1.2 - 2026-07-15

- Fixed custom character filtering by removing each entered Unicode character directly instead of constructing a regular expression.
- Clarified that Chinese opening and closing quotation marks must both be entered when both should be removed.

## 1.1.1 - 2026-07-14

- Fixed first-time installation by downloading the official sherpa-onnx model archive instead of the unreliable Hugging Face snapshot path.
- Cleared Obsidian source and CSS review warnings and replaced the browser confirmation dialog with an Obsidian modal.
- Corrected the first-install download estimate to about 130 MB.

## 1.1.0 - 2026-07-14

- Added confirmed one-click Local TTS installation on macOS and Windows.
- Replaced synced machine/path mappings with fixed per-device application directories.
- Reused the on-demand Local TTS daemon across note chunks and agent hooks.
- Switched synthesis to Local TTS HTTP protocol 1 with automatic CLI fallback.
- Aligned Markdown speech cleanup with the agent hook: skip Markdown links, file references, tables, and non-text code fences while preserving `text` / `txt` / `plain` fences.

## 1.0.1 - 2026-07-03

- Fixed local wav playback by reading generated audio back into a Blob URL before playback.
- Added a floating playback controller with pause, continue, stop, and output-folder actions.
- Added clearer audio playback error messages and autoplay recovery guidance.

## 1.0.0 - 2026-05-26

- Refocused Open Reader on local `ttsctl` speech synthesis.
- Removed cloud TTS provider setup from the product surface.
- Added configurable local CLI path, output folder, speed, chunking, and audio retention.
- Added command and settings action for testing the local TTS CLI.
- Added command and settings action for opening the generated audio folder.
- Added playback controls for pause, resume, and stop.
- Added Markdown text cleanup, chunking, and settings UI.
