import {
  App,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Platform,
  Setting,
  TFile,
} from "obsidian";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type PlaybackState = "idle" | "loading" | "playing" | "paused" | "stopped";

type MarkdownViewWithSelectedFiles = MarkdownView & { selectedFiles?: TFile[] };
type AppWithSettings = App & { setting?: { openTabById?: (id: string) => void } };

interface OpenReaderSettings {
  ttsctlPath?: string;
  ttsctlPathsBySystem: string;
  outputFolder: string;
  speed: number;
  playbackSpeed: number; // 播放速度（HTMLAudio.playbackRate），独立于合成速度 speed
  maxChunkCharacters: number;
  stripFrontmatter: boolean;
  skipCodeBlocks: boolean;
  keepAudioFiles: boolean;
  openFolderAfterSynthesis: boolean;
  // 控制器美化
  showProgressBar: boolean;
  enableDragToMove: boolean;
  // 文本过滤
  customCharsToFilter: string;
  filterHtmlTags: boolean;
  filterExtraWhitespace: boolean;
}

const WINDOWS_TTSCTL_PATH = "C:\\Users\\18660\\work_space_ai\\07codex_default\\local-tts-service\\ttsctl.ps1";
const MAC_TTSCTL_PATH = "/Users/lorne/work_space_ai/codex-defaute/local-tts-service/ttsctl.sh";

function defaultTtsctlPathsBySystem(): string {
  return [
    `lorne=${MAC_TTSCTL_PATH}`,
    `zhangxiaolong=${WINDOWS_TTSCTL_PATH}`,
  ].join("\n");
}

function fallbackTtsctlPath(): string {
  if (Platform.isWin) return WINDOWS_TTSCTL_PATH;
  if (Platform.isMacOS) return MAC_TTSCTL_PATH;
  return "ttsctl";
}

function getDefaultTtsctlPath(): string {
  return Platform.isWin ? WINDOWS_TTSCTL_PATH : MAC_TTSCTL_PATH;
}

function defaultTtsctlCandidates(): string[] {
  return [
    getDefaultTtsctlPath(),
    WINDOWS_TTSCTL_PATH,
    MAC_TTSCTL_PATH,
  ];
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function parseTtsctlPathsBySystem(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    const path = trimmed.slice(separator + 1).trim();
    if (name && path) result.set(name, path);
  }
  return result;
}

function formatTtsctlPathsBySystem(paths: Map<string, string>): string {
  return Array.from(paths.entries()).map(([name, path]) => `${name}=${path}`).join("\n");
}

const DEFAULT_SETTINGS: OpenReaderSettings = {
  ttsctlPathsBySystem: defaultTtsctlPathsBySystem(),
  outputFolder: ".open-reader/audio",
  speed: 1,
  playbackSpeed: 1,
  maxChunkCharacters: 450,
  stripFrontmatter: true,
  skipCodeBlocks: true,
  keepAudioFiles: false,
  openFolderAfterSynthesis: false,
  // 控制器美化
  showProgressBar: true,
  enableDragToMove: true,
  // 文本过滤
  customCharsToFilter: "",
  filterHtmlTags: true,
  filterExtraWhitespace: true,
};

export default class OpenReaderPlugin extends Plugin {
  settings: OpenReaderSettings;
  private currentAudio: HTMLAudioElement | null = null;
  private objectUrls: string[] = [];
  private generatedFiles: string[] = [];
  private shouldStop = false;
  private statusBarEl: HTMLElement;
  private controllerEl: HTMLElement | null = null;
  private controllerStatusEl: HTMLElement | null = null;
  private controllerTitleEl: HTMLElement | null = null;
  private pauseButtonEl: HTMLButtonElement | null = null;
  private resumeButtonEl: HTMLButtonElement | null = null;
  private finishCurrentPlayback: (() => void) | null = null;
  private activeFilePath: string | null = null; // 当前正在朗读的文件路径
  private progressBarEl: HTMLElement | null = null; // 进度条元素
  private progressTextEl: HTMLElement | null = null; // 进度文字元素
  private fileNameEl: HTMLElement | null = null; // 文件名显示元素
  private speedButtonEls: HTMLButtonElement[] = []; // 播放速度档位按钮
  // 可选播放速度档位（独立于合成速度，仅作用于 HTMLAudio.playbackRate）
  private static readonly PLAYBACK_SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 2.0];

  async onload() {
    await this.loadSettings();

    this.statusBarEl = this.addStatusBarItem();
    this.updateStatus("idle");
    this.createController();

    this.addRibbonIcon("volume-2", "Read note aloud or show controller", () => {
      // 如果控制器已隐藏，先显示控制器
      if (!this.controllerEl || !this.controllerEl.isShown()) {
        this.showController();
      }
      void this.readActiveDocument();
    });

    this.addCommand({
      id: "show-tts-controller",
      name: "Show TTS controller",
      callback: () => {
        this.showController();
      },
    });

    this.addCommand({
      id: "read-selection-or-note",
      name: "Read selected text or active note aloud",
      callback: () => {
        void this.readActiveDocument();
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

    this.addCommand({
      id: "test-local-tts-cli",
      name: "Test local TTS CLI",
      callback: () => {
        void this.testLocalTtsCli();
      },
    });

    this.addCommand({
      id: "open-tts-output-folder",
      name: "Open TTS output folder",
      callback: () => {
        void this.openOutputFolder();
      },
    });

    this.addSettingTab(new OpenReaderSettingTab(this.app, this));
  }

  onunload() {
    this.stopReading(false);
    this.unregisterFileCloseListener();
    this.controllerEl?.remove();
  }

  // 页签关闭监听相关
  // Obsidian 没有 file-close workspace 事件，改用 layout-change：
  // 布局变化（含页签关闭/打开/拖动）时，检查是否仍有 markdown leaf 打开着
  // 正在朗读的文件，若一个都不剩，说明该页签被关闭，停止播放。
  private layoutChangeCallback: (() => void) | null = null;

  private isSourceFileStillOpen(): boolean {
    if (!this.activeFilePath) return false;
    return this.app.workspace
      .getLeavesOfType("markdown")
      .some(
        (leaf) =>
          leaf.view instanceof MarkdownView &&
          leaf.view.file?.path === this.activeFilePath,
      );
  }

  private registerFileCloseListener() {
    // 先取消之前的监听
    this.unregisterFileCloseListener();

    this.layoutChangeCallback = () => {
      // 没在播放或已无目标文件时无需处理
      if (!this.activeFilePath) return;
      if (!this.isSourceFileStillOpen()) {
        console.log("Open Reader: source file closed, stopping playback");
        this.stopReading(true);
      }
    };

    this.app.workspace.on("layout-change", this.layoutChangeCallback);
  }

  private unregisterFileCloseListener() {
    if (this.layoutChangeCallback) {
      this.app.workspace.off("layout-change", this.layoutChangeCallback);
      this.layoutChangeCallback = null;
    }
  }

  async loadSettings() {
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    this.migrateLegacyTtsctlPath(stored);
    this.removeLegacySharedFields();
    if (this.setDetectedTtsctlPath()) {
      await this.saveSettings();
    }
  }

  private migrateLegacyTtsctlPath(stored: Partial<OpenReaderSettings> | null) {
    const previous = stored as Partial<OpenReaderSettings> & {
      windowsTtsctlPath?: string;
      macTtsctlPath?: string;
      linuxTtsctlPath?: string;
    } | null;
    this.addTtsctlPathForSystem("zhangxiaolong", previous?.windowsTtsctlPath);
    this.addTtsctlPathForSystem("lorne", previous?.macTtsctlPath);
    this.addTtsctlPathForSystem("linux", previous?.linuxTtsctlPath);

    const legacyPath = stored?.ttsctlPath?.trim();
    if (!legacyPath) return;
    if (legacyPath === WINDOWS_TTSCTL_PATH) return;
    if (legacyPath === MAC_TTSCTL_PATH) return;
    this.addTtsctlPathForSystem(this.getSystemName(), legacyPath);
  }

  private addTtsctlPathForSystem(systemName: string, path?: string) {
    const nextPath = path?.trim();
    if (!nextPath) return;
    const paths = parseTtsctlPathsBySystem(this.settings.ttsctlPathsBySystem);
    if (paths.get(systemName) === nextPath) return;
    paths.set(systemName, nextPath);
    this.settings.ttsctlPathsBySystem = formatTtsctlPathsBySystem(paths);
  }

  private getTtsctlPath(): string {
    const paths = parseTtsctlPathsBySystem(this.settings.ttsctlPathsBySystem);
    for (const name of this.getSystemNames()) {
      const path = paths.get(name);
      if (path && fileExists(path)) return path;
    }
    return this.detectTtsctlPath() || fallbackTtsctlPath();
  }

  setDetectedTtsctlPath(): boolean {
    const path = this.detectTtsctlPath();
    if (!path) return false;
    const before = this.settings.ttsctlPathsBySystem;
    this.addTtsctlPathForSystem(this.getSystemName(), path);
    return before !== this.settings.ttsctlPathsBySystem;
  }

  private detectTtsctlPath(): string | null {
    const paths = parseTtsctlPathsBySystem(this.settings.ttsctlPathsBySystem);
    const candidates = [
      ...this.getSystemNames().map((name) => paths.get(name)),
      ...Array.from(paths.values()),
      ...defaultTtsctlCandidates(),
    ];
    return candidates.find((path): path is string => Boolean(path && fileExists(path))) || null;
  }

  getSystemName(): string {
    return this.getSystemNames()[0] || (Platform.isMacOS ? "lorne" : "zhangxiaolong");
  }

  getSystemNames(): string[] {
    const names = new Set<string>();
    const add = (value?: string) => {
      const name = value?.trim();
      if (name) names.add(name);
    };
    try {
      add(os.userInfo().username);
      add(os.hostname());
      add(os.hostname().replace(/\.local$/i, ""));
    } catch {
      // Obsidian desktop normally has Node available; keep a deterministic fallback.
    }
    add(process.env.COMPUTERNAME);
    add(process.env.USERNAME);
    add(process.env.USER);
    add(Platform.isMacOS ? "lorne" : "zhangxiaolong");
    return Array.from(names);
  }

  private removeLegacySharedFields() {
    const settings = this.settings as OpenReaderSettings & {
      systemName?: string;
      windowsTtsctlPath?: string;
      macTtsctlPath?: string;
      linuxTtsctlPath?: string;
    };
    delete settings.systemName;
    delete settings.ttsctlPath;
    delete settings.windowsTtsctlPath;
    delete settings.macTtsctlPath;
    delete settings.linuxTtsctlPath;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async readActiveDocument() {
    if (!Platform.isDesktopApp) {
      new Notice("Open Reader: local TTS CLI is only supported on desktop.");
      return;
    }

    const adapter = this.getFileSystemAdapter();
    if (!adapter) return;

    // 获取要朗读的文件路径
    const sourceFile = this.getSelectedFile() || this.app.workspace.getActiveFile();
    if (!sourceFile) {
      new Notice("Open Reader: no file selected or active.");
      return;
    }

    // 先停止上一次的播放并清理状态。
    // 必须在设置新 activeFilePath / 注册监听器之前调用，
    // 否则 stopReading 会把刚设置的 activeFilePath 清空、把监听器注销掉。
    this.stopReading(false);

    this.activeFilePath = sourceFile.path;
    // 注册页签关闭监听：当该文件的页签全部关闭时自动停止播放
    this.registerFileCloseListener();

    const normalized = this.prepareText(await this.getTextToRead());
    if (!normalized.trim()) {
      new Notice("Open Reader: no readable text found.");
      return;
    }

    this.shouldStop = false;
    this.generatedFiles = [];
    this.showController();

    const chunks = splitTextIntoChunks(
      normalized,
      clampInteger(this.settings.maxChunkCharacters, 80, 4000),
    );

    new Notice(`Open Reader: synthesizing ${chunks.length} chunk(s) with local TTS.`);

    try {
      await this.ensureOutputFolder();

      for (let index = 0; index < chunks.length; index += 1) {
        if (this.shouldStop) break;

        this.updateStatus("loading", index + 1, chunks.length);
        const outputPath = this.getChunkOutputPath(adapter, index + 1);
        await synthesizeWithTtsctl({
          ttsctlPath: this.getTtsctlPath(),
          text: chunks[index],
          outputPath,
          speed: clampNumber(this.settings.speed, 0.5, 2),
        });
        this.generatedFiles.push(outputPath);

        if (this.shouldStop) break;

        // 播放实际开始后才更新"正在播放"状态，
        // 确保 currentAudio 已就绪、暂停按钮可点击
        await this.playAudioFile(outputPath, () => {
          this.updateStatus("playing", index + 1, chunks.length);
        });
        this.currentAudio = null;
      }

      if (!this.shouldStop) {
        this.updateStatus("idle");
        if (this.settings.openFolderAfterSynthesis) {
          await this.openOutputFolder();
        }
      }
    } catch (error) {
      this.updateStatus("idle");
      new Notice(`Open Reader failed: ${getErrorMessage(error)}`);
      console.error("Open Reader failed", error);
    } finally {
      this.currentAudio = null;
      this.activeFilePath = null;
      this.unregisterFileCloseListener();
      if (!this.settings.keepAudioFiles) {
        await removeFiles(this.generatedFiles);
      }
      this.releaseObjectUrls();
    }
  }

  pauseReading() {
    if (!this.currentAudio || this.currentAudio.paused) return;
    this.currentAudio.pause();
    this.updateStatus("paused");
    new Notice("已暂停");
  }

  async resumeReading() {
    if (!this.currentAudio) return;

    // 如果 audio 已暂停，恢复播放
    if (this.currentAudio.paused) {
      try {
        await this.currentAudio.play();
        this.updateStatus("playing");
        new Notice("继续播放");
      } catch (error) {
        new Notice(`无法继续播放: ${getErrorMessage(error)}`);
      }
      return;
    }

    // 如果 audio 没有暂停但也没在播放（被阻止的情况），尝试重新播放
    if (this.currentAudio.readyState >= 2) {
      try {
        await this.currentAudio.play();
        this.updateStatus("playing");
        new Notice("继续播放");
      } catch (error) {
        new Notice(`无法继续播放: ${getErrorMessage(error)}`);
      }
    } else {
      new Notice("音频还未准备好，请稍后");
    }
  }

  stopReading(showNotice = true) {
    this.shouldStop = true;

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.removeAttribute("src");
      this.currentAudio.load();
      this.currentAudio = null;
    }
    this.finishCurrentPlayback?.();
    this.finishCurrentPlayback = null;

    // 清理当前文件路径和监听器
    this.activeFilePath = null;
    this.unregisterFileCloseListener();

    this.updateStatus("stopped");

    if (showNotice) {
      new Notice("Open Reader: stopped.");
    }
  }

  async testLocalTtsCli() {
    if (!Platform.isDesktopApp) {
      new Notice("Open Reader: local TTS CLI is only supported on desktop.");
      return;
    }

    const adapter = this.getFileSystemAdapter();
    if (!adapter) return;

    try {
      await this.ensureOutputFolder();
      const outputPath = this.getNamedOutputPath(adapter, "ttsctl-test.wav");
      await synthesizeWithTtsctl({
        ttsctlPath: this.getTtsctlPath(),
        text: "Obsidian 本地朗读插件测试成功。",
        outputPath,
        speed: clampNumber(this.settings.speed, 0.5, 2),
      });
      new Notice(`Open Reader: local TTS CLI test passed.`);
      this.showController();
      try {
        await this.playAudioFile(outputPath, () => {
          this.updateStatus("playing");
        });
      } finally {
        this.currentAudio = null;
        this.finishCurrentPlayback = null;
        this.updateStatus("idle");
        this.releaseObjectUrls();
        if (!this.settings.keepAudioFiles) {
          await removeFiles([outputPath]);
        }
      }
    } catch (error) {
      new Notice(`Open Reader CLI test failed: ${getErrorMessage(error)}`);
      console.error("Open Reader CLI test failed", error);
    }
  }

  async openOutputFolder() {
    const adapter = this.getFileSystemAdapter();
    if (!adapter) return;

    await this.ensureOutputFolder();
    const folderPath = toNativePath(adapter.getBasePath(), normalizeVaultPath(this.settings.outputFolder));
    await openPath(folderPath);
  }

  private getFileSystemAdapter(): FileSystemAdapter | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Open Reader: this vault adapter cannot expose local file paths.");
      return null;
    }
    return adapter;
  }

  private async getTextToRead(): Promise<string> {
    // 优先获取当前选中的文件（文件列表中高亮/点击的文件）
    const selectedFile = this.getSelectedFile();
    if (selectedFile) {
      const content = await this.app.vault.read(selectedFile);
      if (content.trim()) return content;
    }

    // 其次获取活动视图中的选中文本或全部内容
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (markdownView?.editor) {
      const selectedText = markdownView.editor.getSelection();
      if (selectedText.trim()) return selectedText;

      const editorText = markdownView.editor.getValue();
      if (editorText.trim()) return editorText;
    }

    // 最后获取活动文件
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) return await this.app.vault.read(activeFile);

    return "";
  }

  // 获取当前在文件列表中选中的文件
  private getSelectedFile(): TFile | null {
    // 尝试多种方式获取选中的文件
    // 方式1: 从 workspace 的 leaf 中获取
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    if (leaves && leaves.length > 0) {
      for (const leaf of leaves) {
        const selectedFiles = leaf.view instanceof MarkdownView
          ? (leaf.view as MarkdownViewWithSelectedFiles).selectedFiles
          : undefined;
        if (selectedFiles && selectedFiles.length > 0) {
          return selectedFiles[0];
        }
      }
    }
    // 方式2: 获取当前活跃文件
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      return activeFile;
    }
    return null;
  }

  private prepareText(text: string): string {
    let next = text.replace(/\r\n/g, "\n");

    if (this.settings.stripFrontmatter) {
      next = next.replace(/^---\n[\s\S]*?\n---\n?/, "");
    }

    next = normalizeFencedBlocks(next, this.settings.skipCodeBlocks);

    // 过滤残留 HTML 标签
    if (this.settings.filterHtmlTags) {
      next = next.replace(/<[^>]+>/g, "");
    }

    // 过滤多余空白（空格、制表符、超过2个连续换行）
    if (this.settings.filterExtraWhitespace) {
      next = next.replace(/[ \t]+/g, " ");
      next = next.replace(/\n{3,}/g, "\n\n");
    }

    // 自定义字符过滤
    if (this.settings.customCharsToFilter) {
      const chars = this.settings.customCharsToFilter.split("").map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (chars.length > 0) {
        next = next.replace(new RegExp(`[${chars.join("")}]`, "g"), "");
      }
    }

    let result = next
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\[[^\]]+\]\([^)]+\)/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/^[ \t]*[-*+][ \t]+/gm, "")
      .replace(/^[ \t]*\d+\.[ \t]+/gm, "")
      .replace(/\[[ xX]\][ \t]*/g, "")
      .replace(/^[ \t]*[-:| ]{3,}$/gm, "")
      .replace(/\|/g, " ")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[\w./~ -]+:\d+(?::\d+)?/g, "")
      .trim();

    // 段落换行处添加停顿标记
    // 将 \n\n 转换为 。\n\n（句号在换行前面，表示段落结束后的停顿）
    result = result.replace(/\n\n+/g, "。\n\n");

    return result;
  }

  private async playAudioFile(filePath: string, onPlaybackStarted?: () => void): Promise<void> {
    const file = await fs.promises.readFile(filePath);
    const audio = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const url = URL.createObjectURL(new Blob([audio], { type: "audio/wav" }));
    this.objectUrls.push(url);
    await this.playAudioUrl(url, onPlaybackStarted);
  }

  private playAudioUrl(url: string, onPlaybackStarted?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audio.preload = "auto";
      // 应用播放速度（仅影响播放，不影响合成）
      audio.playbackRate = this.settings.playbackSpeed;
      this.currentAudio = audio;

      audio.onended = () => {
        this.currentAudio = null;
        resolve();
      };
      audio.onerror = (e) => {
        this.currentAudio = null;
        reject(new Error(getAudioErrorMessage(audio)));
      };

      // 尝试播放
      audio.play()
        .then(() => {
          // 播放成功，等待 onended
          onPlaybackStarted?.();
          this.finishCurrentPlayback = resolve;
        })
        .catch((error) => {
          // 播放被阻止或失败，保持 audio 引用有效，等待用户点继续
          this.finishCurrentPlayback = resolve;
          new Notice("播放被阻止，请点击「继续」按钮播放");
          console.warn("Playback blocked, waiting for user interaction", error);
          // 此时 audio.paused 为 true，刷新按钮：禁用暂停、启用继续
          this.refreshControllerButtons();
        });
    });
  }

  private updateStatus(state: PlaybackState, chunk?: number, total?: number) {
    const prefix = "TTS";
    // 从 activeFilePath 提取文件名
    const fileName = this.activeFilePath ? this.activeFilePath.split("/").pop() || "" : "";

    if (state === "loading") {
      this.statusBarEl.setText(`${prefix}: synthesizing ${chunk}/${total}`);
      this.updateController("正在合成", chunk, total, fileName);
      return;
    }

    if (state === "playing" && chunk && total) {
      this.statusBarEl.setText(`${prefix}: playing ${chunk}/${total}`);
      this.updateController("正在播放", chunk, total, fileName);
      return;
    }

    if (state === "paused") {
      this.statusBarEl.setText(`${prefix}: paused`);
      this.updateController("已暂停", chunk, total, fileName);
      return;
    }

    if (state === "stopped") {
      this.statusBarEl.setText(`${prefix}: stopped`);
      this.updateController("已停止", chunk, total, fileName);
      return;
    }

    this.statusBarEl.setText(`${prefix}: idle`);
    this.updateController("空闲", chunk, total, fileName);
  }

  private createController() {
    const activeDocument = this.app.workspace.containerEl.ownerDocument;
    const controllerEl = activeDocument.body.createDiv({ cls: "open-reader-controller" });
    this.controllerEl = controllerEl;
    controllerEl.hide();

    // === 顶部区域：标题 + 文件名 + 关闭按钮 ===
    const header = controllerEl.createDiv({ cls: "open-reader-controller-header" });

    // 拖拽手柄区域
    const dragHandle = header.createDiv({ cls: "open-reader-controller-drag" });
    dragHandle.setText("☰");
    dragHandle.setAttribute("aria-label", "拖拽移动");

    // 标题 + 文件名
    const titleArea = header.createDiv({ cls: "open-reader-controller-title-area" });
    this.controllerTitleEl = titleArea.createDiv({
      cls: "open-reader-controller-title",
      text: "Open Reader",
    });
    this.fileNameEl = titleArea.createDiv({
      cls: "open-reader-controller-filename",
      text: "",
    });

    // 关闭按钮
    const closeButton = header.createEl("button", {
      cls: "open-reader-controller-close",
      attr: { "aria-label": "关闭" }
    });
    closeButton.setText("✕");
    closeButton.addEventListener("click", () => this.hideController());

    // === 进度区域 ===
    const progressArea = controllerEl.createDiv({ cls: "open-reader-controller-progress" });
    const progressTrack = progressArea.createDiv({ cls: "open-reader-controller-progress-track" });
    this.progressBarEl = progressTrack.createDiv({ cls: "open-reader-controller-progress-fill" });
    this.progressTextEl = progressArea.createDiv({ cls: "open-reader-controller-progress-text" });

    // === 状态区域 ===
    const statusArea = controllerEl.createDiv({ cls: "open-reader-controller-status-area" });
    this.controllerStatusEl = statusArea.createDiv({
      cls: "open-reader-controller-status",
      text: "空闲",
    });

    // === 播放速度区域（仅控制 HTMLAudio.playbackRate，不影响合成）===
    const speedArea = controllerEl.createDiv({ cls: "open-reader-controller-speed" });
    speedArea.createDiv({ cls: "open-reader-controller-speed-label", text: "播放速度" });
    const speedButtons = speedArea.createDiv({ cls: "open-reader-controller-speed-buttons" });
    this.speedButtonEls = [];
    for (const rate of OpenReaderPlugin.PLAYBACK_SPEED_OPTIONS) {
      const btn = speedButtons.createEl("button", {
        cls: "open-reader-controller-speed-btn",
        text: `${rate}x`,
        attr: { "data-rate": String(rate) },
      });
      btn.addEventListener("click", () => this.setPlaybackSpeed(rate));
      this.speedButtonEls.push(btn);
    }

    // === 操作按钮区域 ===
    const actions = controllerEl.createDiv({ cls: "open-reader-controller-actions" });
    this.pauseButtonEl = actions.createEl("button", { text: "暂停" });
    this.pauseButtonEl.addEventListener("click", () => this.pauseReading());

    this.resumeButtonEl = actions.createEl("button", { text: "继续" });
    this.resumeButtonEl.addEventListener("click", () => {
      void this.resumeReading();
    });

    const stopButton = actions.createEl("button", { text: "停止" });
    stopButton.addEventListener("click", () => this.stopReading());

    // 设置按钮
    const settingsButton = actions.createEl("button", { text: "⚙" });
    settingsButton.setAttribute("aria-label", "设置");
    settingsButton.addEventListener("click", () => {
      (this.app as AppWithSettings).setting?.openTabById?.("open-reader");
    });

    // 目录按钮
    const folderButton = actions.createEl("button", { text: "📁" });
    folderButton.setAttribute("aria-label", "打开目录");
    folderButton.addEventListener("click", () => {
      void this.openOutputFolder();
    });

    // === 拖拽功能 ===
    if (this.settings.enableDragToMove) {
      this.setupControllerDrag();
    }

    // 初始化按钮状态（速度档位高亮、暂停/继续 disabled）
    this.refreshControllerButtons();
  }

  // 设置控制器拖拽
  private setupControllerDrag() {
    const controllerEl = this.controllerEl;
    if (!controllerEl) return;

    const header = controllerEl.querySelector(".open-reader-controller-drag");
    if (!header) return;
    const ownerDocument = controllerEl.ownerDocument;
    const ownerWindow = ownerDocument.defaultView || window;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      // 读取当前 right/bottom 位置
      const style = ownerWindow.getComputedStyle(controllerEl);
      startRight = parseInt(style.right) || 24;
      startBottom = parseInt(style.bottom) || 28;

      // 切换到 left/top 定位以便计算
      controllerEl.setCssStyles({
        right: "auto",
        left: `${ownerWindow.innerWidth - startRight - controllerEl.offsetWidth}px`,
        top: `${ownerWindow.innerHeight - startBottom - controllerEl.offsetHeight}px`,
        bottom: "auto",
      });
      controllerEl.classList.add("is-dragging");
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // 新的 left/top 位置
      const newLeft = Math.max(0, ownerWindow.innerWidth - startRight - controllerEl.offsetWidth + deltaX);
      const newTop = Math.max(0, ownerWindow.innerHeight - startBottom - controllerEl.offsetHeight + deltaY);

      controllerEl.setCssStyles({
        left: `${newLeft}px`,
        top: `${newTop}px`,
      });
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      controllerEl.classList.remove("is-dragging");
    };

    header.addEventListener("mousedown", onMouseDown);
    ownerDocument.addEventListener("mousemove", onMouseMove);
    ownerDocument.addEventListener("mouseup", onMouseUp);
  }

  // 隐藏控制器（停止朗读并隐藏）
  private hideController() {
    this.stopReading(false);
    this.controllerEl?.hide();
  }

  private showController() {
    this.controllerEl?.show();
  }

  private updateController(label: string, chunk?: number, total?: number, fileName?: string) {
    if (!this.controllerEl || !this.controllerStatusEl) return;

    // 更新状态文字
    this.controllerStatusEl.setText(label);

    // 更新文件名
    if (this.fileNameEl) {
      this.fileNameEl.setText(fileName || "");
    }

    // 更新进度条
    if (this.progressBarEl && this.progressTextEl && chunk !== undefined && total !== undefined) {
      const percent = total > 0 ? (chunk / total) * 100 : 0;
      this.progressBarEl.setCssStyles({ width: `${percent}%` });
      this.progressTextEl.textContent = `${chunk}/${total}`;
    } else if (this.progressBarEl && this.progressTextEl) {
      this.progressBarEl.setCssStyles({ width: "0%" });
      this.progressTextEl.textContent = "";
    }

    // 更新按钮状态
    this.refreshControllerButtons();
  }

  // 根据 currentAudio 的实际状态刷新暂停/继续按钮的 disabled 属性。
  // 解决时序问题：updateStatus("playing") 调用时 currentAudio 可能尚未就绪，
  // 因此在音频真正开始播放（onPlaybackStarted）或被阻止后再统一刷新。
  private refreshControllerButtons() {
    if (this.pauseButtonEl) {
      this.pauseButtonEl.disabled = !this.currentAudio || this.currentAudio.paused;
    }
    if (this.resumeButtonEl) {
      this.resumeButtonEl.disabled = !this.currentAudio || !this.currentAudio.paused;
    }
    // 同步刷新速度按钮选中态
    this.refreshSpeedButtons();
  }

  // 切换播放速度：更新设置、作用于正在播放的音频、刷新高亮。
  // 仅改变 HTMLAudio.playbackRate，不触发重新合成。
  private setPlaybackSpeed(rate: number) {
    this.settings.playbackSpeed = rate;
    void this.saveSettings();
    if (this.currentAudio) {
      this.currentAudio.playbackRate = rate;
    }
    this.refreshSpeedButtons();
  }

  // 高亮当前选中的速度档位按钮
  private refreshSpeedButtons() {
    const current = this.settings.playbackSpeed;
    for (const btn of this.speedButtonEls) {
      const rate = Number(btn.getAttribute("data-rate"));
      btn.toggleClass("is-active", rate === current);
    }
  }

  private releaseObjectUrls() {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls = [];
  }

  private async ensureOutputFolder() {
    const folderPath = normalizeVaultPath(this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder);
    await ensureVaultFolder(this.app, folderPath);
  }

  private getChunkOutputPath(adapter: FileSystemAdapter, chunk: number): string {
    const timestamp = formatTimestamp(new Date());
    const padded = String(chunk).padStart(3, "0");
    return this.getNamedOutputPath(adapter, `${timestamp}-chunk-${padded}.wav`);
  }

  private getNamedOutputPath(adapter: FileSystemAdapter, filename: string): string {
    const folderPath = normalizeVaultPath(this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder);
    return toNativePath(adapter.getBasePath(), `${folderPath}/${filename}`);
  }
}

class OpenReaderSettingTab extends PluginSettingTab {
  plugin: OpenReaderPlugin;

  constructor(app: App, plugin: OpenReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("open-reader-settings");

    new Setting(containerEl)
      .setName("语音朗读")
      .setHeading();

    // === TTS 服务配置 ===
    new Setting(containerEl)
      .setName("TTS 服务")
      .setHeading();

    new Setting(containerEl)
      .setName("当前识别系统名")
      .setDesc("此值不写入共享配置，来自当前电脑的用户名、主机名等候选名。")
      .addText((text) => {
        text.setValue(this.plugin.getSystemNames().join(", "));
        text.inputEl.disabled = true;
      });

    new Setting(containerEl)
      .setName("TTS CLI 路径映射")
      .setDesc("一行一个：系统名=ttsctl 路径。共享 vault 时，Mac 和 Windows 各自按系统名选择。")
      .addButton((button) =>
        button
          .setButtonText("自动识别")
          .onClick(async () => {
            if (!this.plugin.setDetectedTtsctlPath()) {
              new Notice("未发现本机 ttsctl，请安装 local-tts-service。");
              return;
            }
            await this.plugin.saveSettings();
            new Notice("已识别本机 ttsctl 路径。");
            this.display();
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("安装指南")
          .onClick(() => {
            window.open("https://github.com/lornezhang66/local-tts-service#cli");
          }),
      )
      .addTextArea((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.ttsctlPathsBySystem)
          .setValue(this.plugin.settings.ttsctlPathsBySystem)
          .onChange(async (value) => {
            this.plugin.settings.ttsctlPathsBySystem = value.trim() || DEFAULT_SETTINGS.ttsctlPathsBySystem;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 64;
      });

    new Setting(containerEl)
      .setName("语速")
      .setDesc("语音播放速度，范围 0.5 到 2。推荐 0.8 - 1.2")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 2, 0.05)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.speed)
          .onChange(async (value) => {
            this.plugin.settings.speed = clampNumber(value, 0.5, 2);
            await this.plugin.saveSettings();
          }),
    );

    // === 文本处理配置 ===
    new Setting(containerEl)
      .setName("文本处理")
      .setHeading();

    new Setting(containerEl)
      .setName("输出文件夹")
      .setDesc("生成的音频文件存放目录，相对于 vault 根目录。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.outputFolder)
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = normalizeVaultPath(value || DEFAULT_SETTINGS.outputFolder);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("分段字符数")
      .setDesc("长文档分段处理的字符数上限，推荐 300-600。")
      .addText((text) =>
        text
          .setPlaceholder("450")
          .setValue(String(this.plugin.settings.maxChunkCharacters))
          .onChange(async (value) => {
            this.plugin.settings.maxChunkCharacters = clampInteger(Number(value), 80, 4000);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("移除 YAML 前置matter")
      .setDesc("朗读时跳过文档开头的 YAML 元数据区域。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.stripFrontmatter)
          .onChange(async (value) => {
            this.plugin.settings.stripFrontmatter = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("跳过非文本代码块")
      .setDesc("朗读 text/txt/plain 代码块，跳过其他语言代码块。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skipCodeBlocks)
          .onChange(async (value) => {
            this.plugin.settings.skipCodeBlocks = value;
            await this.plugin.saveSettings();
          }),
    );

    // === 文本过滤配置 ===
    new Setting(containerEl)
      .setName("文本过滤")
      .setHeading();

    new Setting(containerEl)
      .setName("过滤残留 HTML 标签")
      .setDesc("移除文档中残留的 HTML 标签，如 <div>、<span> 等。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.filterHtmlTags)
          .onChange(async (value) => {
            this.plugin.settings.filterHtmlTags = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("过滤多余空白字符")
      .setDesc("移除多余的空格、制表符和超过两个连续换行符。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.filterExtraWhitespace)
          .onChange(async (value) => {
            this.plugin.settings.filterExtraWhitespace = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("自定义过滤字符")
      .setDesc("输入要过滤的字符列表，如 #$%^&。这些字符将被完全移除。")
      .addText((text) =>
        text
          .setPlaceholder("如 #$%^&")
          .setValue(this.plugin.settings.customCharsToFilter)
          .onChange(async (value) => {
            this.plugin.settings.customCharsToFilter = value;
            await this.plugin.saveSettings();
          }),
    );

    // === 其他配置 ===
    new Setting(containerEl)
      .setName("其他")
      .setHeading();

    new Setting(containerEl)
      .setName("保留生成的音频文件")
      .setDesc("朗读结束后保留生成的 wav 文件，否则自动删除。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.keepAudioFiles)
          .onChange(async (value) => {
            this.plugin.settings.keepAudioFiles = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("朗读完成后打开文件夹")
      .setDesc("朗读结束后自动打开输出文件夹。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openFolderAfterSynthesis)
          .onChange(async (value) => {
            this.plugin.settings.openFolderAfterSynthesis = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("测试 TTS")
      .setDesc("生成并播放一句测试语音，验证 TTS 配置是否正确。")
      .addButton((button) =>
        button
          .setButtonText("测试")
          .onClick(() => {
            void this.plugin.testLocalTtsCli();
          }),
      );

    new Setting(containerEl)
      .setName("打开输出文件夹")
      .setDesc("在文件管理器中打开音频文件输出目录。")
      .addButton((button) =>
        button
          .setButtonText("打开")
          .onClick(() => {
            void this.plugin.openOutputFolder();
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
      .split(/(?<=[。！？；;.!?])\s*/)
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
    let splitAt = Math.max(
      remaining.lastIndexOf("\n", maxCharacters),
      remaining.lastIndexOf("。", maxCharacters) + 1,
      remaining.lastIndexOf("，", maxCharacters) + 1,
      remaining.lastIndexOf(" ", maxCharacters),
    );
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

function getAudioErrorMessage(audio: HTMLAudioElement): string {
  const code = audio.error?.code;
  if (code === MediaError.MEDIA_ERR_ABORTED) return "Audio playback was aborted.";
  if (code === MediaError.MEDIA_ERR_NETWORK) return "Audio file could not be loaded.";
  if (code === MediaError.MEDIA_ERR_DECODE) return "Audio file could not be decoded.";
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return "Audio format is not supported.";
  return "Audio playback failed.";
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

async function ensureVaultFolder(app: App, folderPath: string) {
  const parts = normalizeVaultPath(folderPath).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) {
      await app.vault.createFolder(current);
    }
  }
}

function toNativePath(basePath: string, vaultPath: string): string {
  return path.join(basePath, vaultPath);
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function normalizeFencedBlocks(text: string, skipCodeBlocks: boolean): string {
  return text.replace(/(^|\n)(```|~~~)[ \t]*([^\n`]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g, (_match, prefix, _fence, info, content) => {
    const language = String(info || "").trim().toLowerCase().split(/\s+/)[0];
    if (["text", "txt", "plain", "plaintext"].includes(language)) {
      return `${prefix}${String(content).trim()}\n`;
    }
    return skipCodeBlocks ? `${prefix}\n` : `${prefix}${String(content).trim()}\n`;
  });
}

async function synthesizeWithTtsctl(options: {
  ttsctlPath: string;
  text: string;
  outputPath: string;
  speed: number;
}): Promise<void> {
  const command = options.ttsctlPath.trim();
  if (!command) throw new Error("Local TTS CLI path is empty.");

  await new Promise<void>((resolve, reject) => {
    const extension = path.extname(command).toLowerCase();
    const child =
      Platform.isWin && extension === ".ps1"
        ? childProcess.spawn("powershell.exe", [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            command,
            "say",
            options.text,
            "--output",
            options.outputPath,
            "--speed",
            String(options.speed),
          ], { windowsHide: true })
        : childProcess.spawn(command, [
            "say",
            options.text,
            "--output",
            options.outputPath,
            "--speed",
            String(options.speed),
          ], { windowsHide: true });

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code: number) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Local TTS CLI exited with code ${code}.`));
    });
  });

  const stat = await fs.promises.stat(options.outputPath);
  if (stat.size === 0) {
    throw new Error("Local TTS CLI generated an empty audio file.");
  }
}

async function removeFiles(paths: string[]) {
  await Promise.all(paths.map((path) => fs.promises.rm(path, { force: true })));
}

async function openPath(targetPath: string): Promise<void> {
  // 检查目标是否为文件夹
  const stats = await fs.promises.stat(targetPath);
  const isDirectory = stats.isDirectory();

  if (Platform.isWin) {
    if (isDirectory) {
      // 文件夹：直接打开文件夹
      childProcess.spawn("explorer.exe", [targetPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else {
      // 文件：打开并选中该文件，使用 /select, 参数
      childProcess.spawn("explorer.exe", ["/select,", targetPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
    return;
  }

  if (Platform.isMacOS) {
    childProcess.spawn("open", [targetPath], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  childProcess.spawn("xdg-open", [targetPath], { detached: true, stdio: "ignore" }).unref();
}
