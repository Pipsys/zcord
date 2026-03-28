import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";

export const setupAutoUpdater = (): void => {
  if (!app.isPackaged) {
    return;
  }

  const updateConfigPath = path.join(process.resourcesPath, "app-update.yml");
  if (!existsSync(updateConfigPath)) {
    console.info(`[updater] skip: ${updateConfigPath} not found`);
    return;
  }

  autoUpdater.autoDownload = false;

  autoUpdater.on("update-available", async () => {
    await autoUpdater.downloadUpdate();
  });

  autoUpdater.on("update-downloaded", async () => {
    autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on("error", (error) => {
    console.warn("[updater] error:", error);
  });

  void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.warn("[updater] check failed:", error);
  });
};
