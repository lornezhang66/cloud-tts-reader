# I built a free, local TTS plugin for Obsidian because I kept losing focus while reading

I have ADHD, and sometimes I can stare at the same paragraph for several minutes without actually taking it in.

Listening helps me get back into the content, so I built **Open Reader**, a free and open-source Obsidian plugin that reads selected text or an entire note aloud.

What makes it different:

- Runs locally on your computer
- No API key, subscription, or usage limits
- Your notes are not sent to a cloud TTS service
- Works well with Chinese and mixed Chinese-English text
- Skips Markdown syntax, links, YAML frontmatter, and non-text code blocks
- Includes playback controls, progress, pause/resume, and speed settings
- One-click local voice setup on macOS and Windows

The local voice model is downloaded once (about 130 MB), then speech synthesis works offline.

It is currently desktop-only. I am also exploring mobile support, starting with the smallest approach that still preserves privacy and a good reading experience.

Voice comparison: https://open-reader.pages.dev/#listen

Download: https://github.com/lornezhang66/open-reader/releases/latest

Source code: https://github.com/lornezhang66/open-reader

If you try it, I would especially like to know:

1. Does the installation work without extra troubleshooting?
2. Is the voice comfortable enough for long notes?
3. What is the one missing feature that would make you keep using it?

