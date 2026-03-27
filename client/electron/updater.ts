import { autoUpdater } from "electron-updater";

export const setupAutoUpdater = (): void => {
  autoUpdater.autoDownload = false;

  autoUpdater.on("update-available", async () => {
    await autoUpdater.downloadUpdate();
  });

  autoUpdater.on("update-downloaded", async () => {
    autoUpdater.quitAndInstall(false, true);
  });

  void autoUpdater.checkForUpdatesAndNotify();
};
