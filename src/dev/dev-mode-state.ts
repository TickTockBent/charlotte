import type { PageManager } from "../browser/page-manager.js";
import type { ReloadEvent } from "../types/page-representation.js";
import type { CharlotteConfig } from "../types/config.js";
import { StaticServer, type StaticServerInfo } from "./static-server.js";
import { FileWatcher } from "./file-watcher.js";
import { logger } from "../utils/logger.js";

export interface DevServeOptions {
  directoryPath: string;
  port?: number;
  watch: boolean;
  pageManager: PageManager;
  /** Use polling for file watching. Slower but avoids inotify limits. */
  usePolling?: boolean;
}

export class DevModeState {
  private config: CharlotteConfig;

  constructor(config: CharlotteConfig) {
    this.config = config;
  }

  private staticServer = new StaticServer();
  private fileWatcher = new FileWatcher();
  private pendingReloadEvent: ReloadEvent | null = null;
  private reloadInProgress: Promise<void> | null = null;

  async startServing(options: DevServeOptions): Promise<StaticServerInfo> {
    // Stop any existing serving session first
    await this.stopAll();

    const serverInfo = await this.staticServer.start({
      directoryPath: options.directoryPath,
      allowedRoot: this.config.allowedWorkspaceRoot,
      port: options.port,
    });

    if (options.watch) {
      await this.fileWatcher.start({
        directoryPath: options.directoryPath,
        onFilesChanged: (changedFiles) => {
          this.handleFilesChanged(changedFiles, options.pageManager);
        },
        usePolling: options.usePolling,
      });
    }

    return serverInfo;
  }

  async stopAll(): Promise<void> {
    try {
      if (this.fileWatcher.isWatching()) {
        await this.fileWatcher.stop();
      }
    } catch (error) {
      logger.warn("File watcher stop failed during shutdown", error);
    }
    try {
      if (this.staticServer.isRunning()) {
        await this.staticServer.stop();
      }
    } catch (error) {
      logger.warn("Static server stop failed during shutdown", error);
    }
    this.pendingReloadEvent = null;
    this.reloadInProgress = null;
  }

  consumePendingReloadEvent(): ReloadEvent | null {
    const event = this.pendingReloadEvent;
    this.pendingReloadEvent = null;
    return event;
  }

  isServing(): boolean {
    return this.staticServer.isRunning();
  }

  getServerInfo(): StaticServerInfo | null {
    return this.staticServer.getInfo();
  }

  private handleFilesChanged(changedFiles: string[], pageManager: PageManager): void {
    // Merge with any existing pending event (accumulate files)
    if (this.pendingReloadEvent) {
      const existingFiles = new Set(this.pendingReloadEvent.files_changed);
      for (const file of changedFiles) {
        existingFiles.add(file);
      }
      this.pendingReloadEvent = {
        trigger: "file_change",
        files_changed: [...existingFiles],
        timestamp: new Date().toISOString(),
      };
    } else {
      this.pendingReloadEvent = {
        trigger: "file_change",
        files_changed: changedFiles,
        timestamp: new Date().toISOString(),
      };
    }

    // Reload the active page if not already reloading.
    // If a reload is already in progress, we already merged the changed files into
    // pendingReloadEvent above. We schedule a trailing reload so the page does not stay stale
    // when files arrive during an in-progress reload (e.g. a slow page reload with rapid saves).
    if (this.reloadInProgress) {
      logger.debug("Reload already in progress; trailing reload will run when current finishes");
      this.reloadInProgress = this.reloadInProgress.then(() => {
        // By the time the current reload finishes a new reloadInProgress has been set to null.
        // Re-check whether there are still pending events to service; if the file-watcher fired
        // again during the reload those files are already in pendingReloadEvent.
        if (!pageManager.hasPages()) {
          return;
        }
        const nextPage = pageManager.getActivePage();
        return nextPage
          .reload({ waitUntil: "load" })
          .then(() => {
            logger.info("Trailing page reload completed after file change");
          })
          .catch((error: unknown) => {
            logger.warn("Failed to run trailing reload after file change", error);
          });
      });
      return;
    }

    if (!pageManager.hasPages()) {
      logger.warn("No active page to reload after file change");
      return;
    }

    const page = pageManager.getActivePage();
    this.reloadInProgress = page
      .reload({ waitUntil: "load" })
      .then(() => {
        logger.info("Page reloaded after file change", {
          files: changedFiles,
        });
      })
      .catch((error: unknown) => {
        logger.warn("Failed to reload page after file change", error);
      })
      .finally(() => {
        this.reloadInProgress = null;
      });
  }
}
