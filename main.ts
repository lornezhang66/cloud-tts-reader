import {
  App,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Platform,
  requestUrl,
  Setting,
} from "obsidian";

type PlaybackState = "idle" | "loading" | "playing" | "paused" | "stopped";
type TtsBackend = "baidu-cloud" | "openai-compatible";

interface CodexTtsReaderSettings {
  backend: TtsBackend;
  apiKey: string;
  secretKey: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  endpoint: string;
  model: string;
  voice: string;
  responseFormat: string;
  speed: number;
  volume: number;
  pitch: number;
  sampleRate: number;
  speakerId: number;
  cuid: string;
  instructions: string;
  maxChunkCharacters: number;
  stripFrontmatter: boolean;
  skipCodeBlocks: boolean;
  edgeExportPath: string;
}

const DEFAULT_SETTINGS: CodexTtsReaderSettings = {
  backend: "baidu-cloud",
  apiKey: "",
  secretKey: "",
  accessToken: "",
  accessTokenExpiresAt: 0,
  endpoint: "https://tsn.baidu.com/text2audio",
  model: "",
  voice: "",
  responseFormat: "mp3",
  speed: 5,
  volume: 5,
  pitch: 5,
  sampleRate: 0,
  speakerId: 0,
  cuid: "cloud-tts-reader",
  instructions: "",
  maxChunkCharacters: 450,
  stripFrontmatter: true,
  skipCodeBlocks: false,
  edgeExportPath: ".cloud-tts-reader/edge-read-aloud.html",
};

const MIME_BY_FORMAT: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

export default class CodexTtsReaderPlugin extends Plugin {
  settings: CodexTtsReaderSettings;
  private currentAudio: HTMLAudioElement | null = null;
  private objectUrls: string[] = [];
  private shouldStop = false;
  private state: PlaybackState = "idle";
  private statusBarEl: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.statusBarEl = this.addStatusBarItem();
    this.updateStatus("idle");

    this.addRibbonIcon("volume-2", "Read note aloud", () => {
      void this.readActiveDocument();
    });

    this.addCommand({
      id: "read-selection-or-note",
      name: "Read selected text or active note aloud",
      callback: () => {
        void this.readActiveDocument();
      },
    });

    this.addCommand({
      id: "open-selection-or-note-in-edge",
      name: "Open selected text or active note in Microsoft Edge",
      callback: () => {
        void this.openActiveDocumentInEdge();
      },
    });

    this.addCommand({
      id: "pause-reading",
      name: "Pause reading",
      callback: () => this.pauseReading(),
    });

    this.addCommand({
      id: "resume-reading",
      name: "Resume reading",
      callback: () => {
        void this.resumeReading();
      },
    });

    this.addCommand({
      id: "stop-reading",
      name: "Stop reading",
      callback: () => this.stopReading(),
    });

    this.addSettingTab(new CodexTtsReaderSettingTab(this.app, this));
  }

  onunload() {
    this.stopReading();
  }

  async loadSettings() {
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);

    if (!stored?.backend && this.settings.backend === "baidu-cloud") {
      this.settings.endpoint = DEFAULT_SETTINGS.endpoint;
      this.settings.responseFormat = DEFAULT_SETTINGS.responseFormat;
      this.settings.speed = DEFAULT_SETTINGS.speed;
      this.settings.volume = DEFAULT_SETTINGS.volume;
      this.settings.pitch = DEFAULT_SETTINGS.pitch;
      this.settings.maxChunkCharacters = DEFAULT_SETTINGS.maxChunkCharacters;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async readActiveDocument() {
    if (this.settings.backend === "baidu-cloud" && (!this.settings.apiKey.trim() || !this.settings.secretKey.trim())) {
      new Notice("Cloud TTS Reader: set Baidu API Key and Secret Key in plugin settings first.");
      return;
    }

    if (this.settings.backend === "openai-compatible" && !this.settings.apiKey.trim()) {
      new Notice("Cloud TTS Reader: set an API key in plugin settings first.");
      return;
    }

    const text = await this.getTextToRead();
    const normalized = this.prepareText(text);

    if (!normalized.trim()) {
      new Notice("Cloud TTS Reader: no readable text found.");
      return;
    }

    this.stopReading(false);
    this.shouldStop = false;

    const chunks = splitTextIntoChunks(
      normalized,
      clampInteger(this.settings.maxChunkCharacters, 50, 4096),
    );

    new Notice(`Cloud TTS Reader: reading ${chunks.length} chunk(s).`);

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        if (this.shouldStop) break;

        this.updateStatus("loading", index + 1, chunks.length);
        const audioUrl = await this.createSpeech(chunks[index]);

        if (this.shouldStop) {
          this.revokeObjectUrl(audioUrl);
          break;
        }

        this.updateStatus("playing", index + 1, chunks.length);
        await this.playAudioUrl(audioUrl);
      }

      if (!this.shouldStop) {
        this.updateStatus("idle");
      }
    } catch (error) {
      this.updateStatus("idle");
      new Notice(`Cloud TTS Reader failed: ${getErrorMessage(error)}`);
      console.error("Cloud TTS Reader failed", error);
    } finally {
      this.currentAudio = null;
      this.releaseObjectUrls();
    }
  }

  async openActiveDocumentInEdge() {
    if (!Platform.isDesktopApp) {
      new Notice("Cloud TTS Reader: opening Microsoft Edge is only supported on desktop.");
      return;
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Cloud TTS Reader: this vault adapter cannot expose a local file path.");
      return;
    }

    const text = this.prepareText(await this.getTextToRead());
    if (!text.trim()) {
      new Notice("Cloud TTS Reader: no readable text found.");
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    const title = activeFile?.basename ?? "Obsidian note";
    const vaultPath = normalizeVaultPath(this.settings.edgeExportPath);

    await ensureFolder(this.app, getFolderPath(vaultPath));
    await this.app.vault.adapter.write(vaultPath, renderReadableHtml(title, text));

    const filePath = toNativePath(adapter.getBasePath(), vaultPath);
    const fileUrl = pathToFileUrl(filePath);

    try {
      await openUrlInMicrosoftEdge(fileUrl);
      new Notice("Cloud TTS Reader: opened in Microsoft Edge. Use Edge Read aloud to start narration.");
    } catch (error) {
      new Notice(`Cloud TTS Reader could not open Edge: ${getErrorMessage(error)}`);
      console.error("Cloud TTS Reader could not open Edge", error);
    }
  }

  pauseReading() {
    if (!this.currentAudio || this.currentAudio.paused) return;
    this.currentAudio.pause();
    this.updateStatus("paused");
  }

  async resumeReading() {
    if (!this.currentAudio || !this.currentAudio.paused) return;
    await this.currentAudio.play();
    this.updateStatus("playing");
  }

  stopReading(showNotice = true) {
    this.shouldStop = true;

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.removeAttribute("src");
      this.currentAudio.load();
      this.currentAudio = null;
    }

    this.releaseObjectUrls();
    this.updateStatus("stopped");

    if (showNotice) {
      new Notice("Cloud TTS Reader: stopped.");
    }
  }

  private async getTextToRead(): Promise<string> {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (markdownView?.editor) {
      const selectedText = markdownView.editor.getSelection();
      if (selectedText.trim()) return selectedText;

      const editorText = markdownView.editor.getValue();
      if (editorText.trim()) return editorText;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) return await this.app.vault.read(activeFile);

    return "";
  }

  private prepareText(text: string): string {
    let next = text.replace(/\r\n/g, "\n");

    if (this.settings.stripFrontmatter) {
      next = next.replace(/^---\n[\s\S]*?\n---\n?/, "");
    }

    if (this.settings.skipCodeBlocks) {
      next = next.replace(/```[\s\S]*?```/g, "\n");
      next = next.replace(/~~~[\s\S]*?~~~/g, "\n");
    }

    return next
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private async createSpeech(input: string): Promise<string> {
    if (this.settings.backend === "baidu-cloud") {
      return await this.createBaiduCloudSpeech(input);
    }

    return await this.createOpenAiCompatibleSpeech(input);
  }

  private async createBaiduCloudSpeech(input: string): Promise<string> {
    const token = await this.getBaiduAccessToken();
    const body = buildBaiduSpeechBody({
      text: input,
      token,
      cuid: this.settings.cuid.trim() || DEFAULT_SETTINGS.cuid,
      format: this.settings.responseFormat,
      speed: clampInteger(this.settings.speed, 0, 15),
      pitch: clampInteger(this.settings.pitch, 0, 15),
      volume: clampInteger(this.settings.volume, 0, 15),
      speakerId: clampInteger(this.settings.speakerId, 0, 9999),
    });

    const response = await requestUrl({
      url: this.settings.endpoint.trim(),
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (response.status < 200 || response.status >= 300) {
      const detail = response.text || `HTTP ${response.status}`;
      throw new Error(detail);
    }

    const contentType = getHeader(response.headers, "content-type");
    if (contentType.includes("application/json") || response.text.trim().startsWith("{")) {
      throw new Error(`Baidu TTS error: ${response.text}`);
    }

    const mime = this.settings.responseFormat === "wav" ? "audio/wav" : "audio/mpeg";
    const blob = new Blob([response.arrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }

  private async getBaiduAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.settings.accessToken && this.settings.accessTokenExpiresAt > now + 60_000) {
      return this.settings.accessToken;
    }

    const tokenUrl = new URL("https://aip.baidubce.com/oauth/2.0/token");
    tokenUrl.searchParams.set("grant_type", "client_credentials");
    tokenUrl.searchParams.set("client_id", this.settings.apiKey.trim());
    tokenUrl.searchParams.set("client_secret", this.settings.secretKey.trim());

    const response = await requestUrl({
      url: tokenUrl.toString(),
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "",
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.text || `Baidu token HTTP ${response.status}`);
    }

    const data = parseJsonResponse(response.text) as Record<string, unknown>;
    const accessToken = typeof data.access_token === "string" ? data.access_token : "";
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 0;

    if (!accessToken) {
      throw new Error(`Baidu token response did not include access_token: ${response.text}`);
    }

    this.settings.accessToken = accessToken;
    this.settings.accessTokenExpiresAt = now + Math.max(expiresIn - 300, 60) * 1000;
    await this.saveSettings();

    return accessToken;
  }

  private async createOpenAiCompatibleSpeech(input: string): Promise<string> {
    const payload: Record<string, string | number> = {
      model: this.settings.model.trim(),
      voice: this.settings.voice.trim(),
      input,
      response_format: this.settings.responseFormat.trim(),
      speed: clampNumber(this.settings.speed, 0.25, 4),
    };

    if (
      this.settings.instructions.trim() &&
      !["tts-1", "tts-1-hd"].includes(this.settings.model.trim())
    ) {
      payload.instructions = this.settings.instructions.trim();
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.settings.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.settings.apiKey.trim()}`;
    }

    const response = await requestUrl({
      url: this.settings.endpoint.trim(),
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (response.status < 200 || response.status >= 300) {
      const detail = response.text || `HTTP ${response.status}`;
      throw new Error(detail);
    }

    const mime = MIME_BY_FORMAT[this.settings.responseFormat.trim()] ?? "audio/mpeg";
    const blob = new Blob([response.arrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }

  private playAudioUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      this.currentAudio = audio;

      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Audio playback failed."));

      void audio.play().catch(reject);
    });
  }

  private updateStatus(state: PlaybackState, chunk?: number, total?: number) {
    this.state = state;
    const prefix = "TTS";

    if (state === "loading") {
      this.statusBarEl.setText(`${prefix}: loading ${chunk}/${total}`);
      return;
    }

    if (state === "playing" && chunk && total) {
      this.statusBarEl.setText(`${prefix}: playing ${chunk}/${total}`);
      return;
    }

    if (state === "paused") {
      this.statusBarEl.setText(`${prefix}: paused`);
      return;
    }

    if (state === "stopped") {
      this.statusBarEl.setText(`${prefix}: stopped`);
      return;
    }

    this.statusBarEl.setText(`${prefix}: idle`);
  }

  private releaseObjectUrls() {
    for (const url of this.objectUrls) {
      this.revokeObjectUrl(url);
    }
    this.objectUrls = [];
  }

  private revokeObjectUrl(url: string) {
    URL.revokeObjectURL(url);
    this.objectUrls = this.objectUrls.filter((candidate) => candidate !== url);
  }
}

class CodexTtsReaderSettingTab extends PluginSettingTab {
  plugin: CodexTtsReaderPlugin;

  constructor(app: App, plugin: CodexTtsReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("cloud-tts-reader-settings");

    containerEl.createEl("h2", { text: "Cloud TTS Reader" });

    new Setting(containerEl)
      .setName("TTS backend")
      .setDesc("Use Baidu Cloud for the free cloud quota route, or keep OpenAI-compatible for SiliconFlow/OpenAI-style APIs.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            "baidu-cloud": "Baidu Cloud speech synthesis",
            "openai-compatible": "OpenAI-compatible speech API",
          })
          .setValue(this.plugin.settings.backend)
          .onChange(async (value: TtsBackend) => {
            this.plugin.settings.backend = value;
            if (value === "baidu-cloud") {
              this.plugin.settings.endpoint = DEFAULT_SETTINGS.endpoint;
              this.plugin.settings.responseFormat = "mp3";
              this.plugin.settings.speed = 5;
              this.plugin.settings.pitch = 5;
              this.plugin.settings.volume = 5;
              this.plugin.settings.maxChunkCharacters = 450;
            }
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("For Baidu Cloud, use the app API Key. For OpenAI-compatible APIs, use the bearer API key.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Baidu API Key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Secret key")
      .setDesc("Required by Baidu Cloud OAuth token exchange. Leave empty for OpenAI-compatible APIs.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Baidu Secret Key")
          .setValue(this.plugin.settings.secretKey)
          .onChange(async (value) => {
            this.plugin.settings.secretKey = value.trim();
            this.plugin.settings.accessToken = "";
            this.plugin.settings.accessTokenExpiresAt = 0;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Speech endpoint")
      .setDesc("Baidu Cloud default: https://tsn.baidu.com/text2audio")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.endpoint)
          .setValue(this.plugin.settings.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.endpoint = value.trim() || DEFAULT_SETTINGS.endpoint;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Only used by OpenAI-compatible APIs. Baidu Cloud short text synthesis ignores this field.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.model)
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice")
      .setDesc("Only used by OpenAI-compatible APIs. For Baidu Cloud, use speaker ID below.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.voice)
          .setValue(this.plugin.settings.voice)
          .onChange(async (value) => {
            this.plugin.settings.voice = value.trim() || DEFAULT_SETTINGS.voice;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Audio format")
      .setDesc("Baidu Cloud short text synthesis supports mp3, wav, and pcm. OpenAI-compatible providers may support more.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            mp3: "mp3",
            opus: "opus",
            aac: "aac",
            flac: "flac",
            wav: "wav",
            pcm: "pcm",
          })
          .setValue(this.plugin.settings.responseFormat)
          .onChange(async (value) => {
            this.plugin.settings.responseFormat = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Speed")
      .setDesc("Baidu Cloud range: 0 to 15, default 5. OpenAI-compatible APIs usually use 0.25 to 4.0.")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.speed))
          .onChange(async (value) => {
            this.plugin.settings.speed =
              this.plugin.settings.backend === "baidu-cloud"
                ? clampInteger(Number(value), 0, 15)
                : clampNumber(Number(value), 0.25, 4);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Pitch")
      .setDesc("Baidu Cloud range: 0 to 15, default 5.")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.pitch))
          .onChange(async (value) => {
            this.plugin.settings.pitch = clampInteger(Number(value), 0, 15);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Volume")
      .setDesc("Baidu Cloud range: 0 to 15, default 5.")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.volume))
          .onChange(async (value) => {
            this.plugin.settings.volume = clampInteger(Number(value), 0, 15);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Baidu speaker ID")
      .setDesc("Common values: 0 female, 1 male, 3 Du Xiaoyao, 4 Du Yaya. Available IDs depend on enabled Baidu voice libraries.")
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.speakerId))
          .onChange(async (value) => {
            this.plugin.settings.speakerId = clampInteger(Number(value), 0, 9999);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Baidu CUID")
      .setDesc("Client identifier used by Baidu for quota and rate limiting.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.cuid)
          .setValue(this.plugin.settings.cuid)
          .onChange(async (value) => {
            this.plugin.settings.cuid = value.trim() || DEFAULT_SETTINGS.cuid;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Max chunk characters")
      .setDesc("Baidu short text synthesis has a much smaller practical limit than OpenAI-compatible APIs. Default: 450 characters.")
      .addText((text) =>
        text
          .setPlaceholder("450")
          .setValue(String(this.plugin.settings.maxChunkCharacters))
          .onChange(async (value) => {
            this.plugin.settings.maxChunkCharacters = clampInteger(Number(value), 50, 4096);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Strip frontmatter")
      .setDesc("Skip YAML frontmatter before sending text to TTS.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.stripFrontmatter)
          .onChange(async (value) => {
            this.plugin.settings.stripFrontmatter = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Skip fenced code blocks")
      .setDesc("Useful when notes contain large code snippets that should not be narrated.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skipCodeBlocks)
          .onChange(async (value) => {
            this.plugin.settings.skipCodeBlocks = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice instructions")
      .setDesc("Optional style guidance for compatible models. Ignored for tts-1 and tts-1-hd.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Read clearly, at a steady pace, with a calm tone.")
          .setValue(this.plugin.settings.instructions)
          .onChange(async (value) => {
            this.plugin.settings.instructions = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Edge export path")
      .setDesc("Temporary HTML file inside the vault for Microsoft Edge Read aloud.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.edgeExportPath)
          .setValue(this.plugin.settings.edgeExportPath)
          .onChange(async (value) => {
            this.plugin.settings.edgeExportPath = normalizeVaultPath(value || DEFAULT_SETTINGS.edgeExportPath);
            await this.plugin.saveSettings();
          }),
      );
  }
}

function splitTextIntoChunks(text: string, maxCharacters: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxCharacters) {
      pushChunk(chunks, paragraph, maxCharacters);
      continue;
    }

    const sentences = paragraph
      .split(/(?<=[。！？.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      splitLongText(paragraph, maxCharacters).forEach((part) => pushChunk(chunks, part, maxCharacters));
      continue;
    }

    for (const sentence of sentences) {
      if (sentence.length <= maxCharacters) {
        pushChunk(chunks, sentence, maxCharacters);
      } else {
        splitLongText(sentence, maxCharacters).forEach((part) => pushChunk(chunks, part, maxCharacters));
      }
    }
  }

  return chunks;
}

function pushChunk(chunks: string[], text: string, maxCharacters: number) {
  const last = chunks[chunks.length - 1];
  const separator = "\n\n";

  if (last && last.length + separator.length + text.length <= maxCharacters) {
    chunks[chunks.length - 1] = `${last}${separator}${text}`;
    return;
  }

  chunks.push(text);
}

function splitLongText(text: string, maxCharacters: number): string[] {
  const parts: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxCharacters) {
    let splitAt = remaining.lastIndexOf(" ", maxCharacters);
    if (splitAt < maxCharacters * 0.5) {
      splitAt = maxCharacters;
    }

    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildBaiduSpeechBody(options: {
  text: string;
  token: string;
  cuid: string;
  format: string;
  speed: number;
  pitch: number;
  volume: number;
  speakerId: number;
}): string {
  const encodedText = encodeURIComponent(encodeURIComponent(options.text));
  const params = new URLSearchParams();
  params.set("lan", "zh");
  params.set("cuid", options.cuid);
  params.set("ctp", "1");
  params.set("tok", options.token);
  params.set("aue", String(getBaiduAudioEncoding(options.format)));
  params.set("spd", String(options.speed));
  params.set("pit", String(options.pitch));
  params.set("vol", String(options.volume));
  params.set("per", String(options.speakerId));

  return `tex=${encodedText}&${params.toString()}`;
}

function getBaiduAudioEncoding(format: string): number {
  if (format === "wav") return 4;
  if (format === "pcm") return 5;
  return 3;
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON response: ${text.slice(0, 500)}`);
  }
}

function getHeader(headers: Record<string, string>, name: string): string {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value.toLowerCase();
  }
  return "";
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function getFolderPath(path: string): string {
  const index = path.lastIndexOf("/");
  if (index === -1) return "";
  return path.slice(0, index);
}

async function ensureFolder(app: App, folderPath: string) {
  if (!folderPath) return;
  if (await app.vault.adapter.exists(folderPath)) return;
  await app.vault.createFolder(folderPath);
}

function renderReadableHtml(title: string, text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      line-height: 1.75;
    }
    body {
      max-width: 820px;
      margin: 48px auto;
      padding: 0 28px 64px;
      font-size: 20px;
    }
    h1 {
      font-size: 32px;
      line-height: 1.25;
      margin: 0 0 28px;
    }
    p {
      margin: 0 0 1.1em;
    }
  </style>
</head>
<body>
  <article>
    <h1>${escapeHtml(title)}</h1>
    ${paragraphs}
  </article>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toNativePath(basePath: string, vaultPath: string): string {
  const path = require("path") as typeof import("path");
  return path.join(basePath, vaultPath);
}

function pathToFileUrl(filePath: string): string {
  const url = require("url") as typeof import("url");
  return url.pathToFileURL(filePath).toString();
}

async function openUrlInMicrosoftEdge(fileUrl: string): Promise<void> {
  const childProcess = require("child_process") as typeof import("child_process");

  if (Platform.isWin) {
    const child = childProcess.spawn(
      "cmd.exe",
      ["/c", "start", "", "msedge", fileUrl],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();
    return;
  }

  if (Platform.isMacOS) {
    const child = childProcess.spawn(
      "open",
      ["-a", "Microsoft Edge", fileUrl],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    return;
  }

  const child = childProcess.spawn(
    "microsoft-edge",
    [fileUrl],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}
