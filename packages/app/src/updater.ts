// Автообновление приложения: проверка при запуске, подписанные сборки из GitHub Releases.
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { askUser, inTauri } from "./tauriFs";
import { useStore } from "./store";

/** Тихая проверка при запуске: нет сети или обновлений — ничего не показываем. */
export async function checkForUpdates() {
  if (!inTauri || import.meta.env.DEV) return;
  try {
    const update = await check();
    if (!update) return;
    const notes = update.body?.trim() ? `\n\n${update.body.trim().slice(0, 600)}` : "";
    if (!(await askUser(`Доступна версия ${update.version} (сейчас ${update.currentVersion}). Установить и перезапустить?${notes}`))) return;
    const { dirty, fs, save } = useStore.getState();
    if (dirty && fs) await save();
    if (useStore.getState().dirty && !(await askUser("Есть несохранённые правки. Обновить без сохранения?"))) return;
    useStore.setState({ statusNonce: Date.now(), status: `Скачиваю версию ${update.version}…` });
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    console.warn("Проверка обновлений не удалась:", e);
  }
}
