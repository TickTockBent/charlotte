import { watch, type FSWatcher } from "chokidar";
import * as path from "node:path";
import { logger } from "../utils/logger.js";

export interface FileWatcherOptions {
  directoryPath: string;
  onFilesChanged: (changedFiles: string[]) => void;
  debounceMs?: number;
  /** Use polling instead of native file system events. Slower but avoids inotify limits. */
  usePolling?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 300;

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private pendingChanges = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private directoryPath: string | null = null;
  private onFilesChanged: ((changedFiles: string[]) => void) | null = null;
  private debounceMs = DEFAULT_DEBOUNCE_MS;

  async start(options: FileWatcherOptions): Promise<void> {
    // Stop any existing watcher first
    if (this.watcher) {
      await this.stop();
    }

    this.directoryPath = path.resolve(options.directoryPath);
    this.onFilesChanged = options.onFilesChanged;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    this.watcher = watch(this.directoryPath, {
      ignoreInitial: true,
      ignored: ["**/node_modules/**", "**/.git/**"],
      usePolling: options.usePolling ?? false,
      interval: options.usePolling ? 100 : undefined,
    });

    const handleFileEvent = (filePath: string) => {
      const relativePath = path.relative(this.directoryPath!, filePath);
      this.pendingChanges.add(relativePath);

      // Clear existing debounce timer and set a new one
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.flushPendingChanges();
      }, this.debounceMs);
    };

    this.watcher.on("change", handleFileEvent);
    this.watcher.on("add", handleFileEvent);
    this.watcher.on("unlink", handleFileEvent);

    // Wait for the watcher to be ready before resolving
    await new Promise<void>((resolve, reject) => {
      this.watcher!.on("ready", resolve);
      this.watcher!.on("error", reject);
    });

    logger.info("File watcher started", {
      directory: this.directoryPath,
      debounceMs: this.debounceMs,
    });
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.pendingChanges.clear();
    this.directoryPath = null;
    this.onFilesChanged = null;

    logger.info("File watcher stopped");
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }

  private flushPendingChanges(): void {
    if (this.pendingChanges.size === 0 || !this.onFilesChanged) {
      return;
    }

    const changedFiles = [...this.pendingChanges];
    this.pendingChanges.clear();
    this.debounceTimer = null;

    logger.debug("File changes detected", { files: changedFiles });
    this.onFilesChanged(changedFiles);
  }
}
