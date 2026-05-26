# Obsidian Community Plugin Submission

Add this entry to the end of `community-plugins.json` in `obsidianmd/obsidian-releases`.

Replace `GITHUB_USER_OR_ORG/cloud-tts-reader` with the final GitHub repository path.

```json
{
  "id": "cloud-tts-reader",
  "name": "Cloud TTS Reader",
  "author": "zhangxiaolong",
  "description": "Read selected text or active notes aloud with Baidu Cloud TTS, OpenAI-compatible TTS services, or Microsoft Edge.",
  "repo": "GITHUB_USER_OR_ORG/cloud-tts-reader"
}
```

Before submitting:

1. Push this repository to GitHub.
2. Create a GitHub release tagged `1.0.0`.
3. Confirm the release contains `main.js`, `manifest.json`, and `styles.css`.
4. Fork `obsidianmd/obsidian-releases`.
5. Add the JSON entry above to `community-plugins.json`.
6. Open a pull request.
