import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { uploadAvatar } from "@/api/client";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import type { User } from "@/types";

const AVATAR_MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);

const SettingsPage = () => {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const pushToast = useUiStore((state) => state.pushToast);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [pushToTalkKey, setPushToTalkKey] = useState("V");
  const [notifications, setNotifications] = useState(true);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const handlePickAvatar = async (file: File | null) => {
    if (!file) {
      return;
    }

    if (!ALLOWED_AVATAR_MIME_TYPES.has(file.type)) {
      pushToast(t("settings.avatar_invalid_type_title"), t("settings.avatar_invalid_type_desc"));
      return;
    }

    if (file.size > AVATAR_MAX_BYTES) {
      pushToast(t("settings.avatar_invalid_size_title"), t("settings.avatar_invalid_size_desc"));
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const updated = await uploadAvatar<User>(file);
      setUser(updated);
      pushToast(t("settings.avatar_upload_success_title"), t("settings.avatar_upload_success_desc"));
    } catch (error) {
      pushToast(t("settings.avatar_upload_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  };

  return (
    <main className="h-full overflow-auto bg-paw-bg-primary p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary p-5">
          <h1 className="font-display text-2xl">{t("settings.title")}</h1>
          <p className="text-sm text-paw-text-secondary">{t("settings.description")}</p>
        </section>

        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary p-5">
          <h2 className="mb-3 font-display text-lg">{t("settings.profile")}</h2>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <Avatar src={user?.avatar_url ?? null} label={user?.username ?? "user"} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-paw-text-secondary">{user?.username ?? t("common.none")}</p>
                <p className="truncate text-xs text-paw-text-muted">{t("settings.avatar_hint")}</p>
              </div>
            </div>

            <div className="flex gap-2 md:ml-auto">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif"
                className="hidden"
                onChange={(event) => void handlePickAvatar(event.target.files?.[0] ?? null)}
              />
              <Button
                className="px-3 py-1.5 text-xs"
                disabled={isUploadingAvatar}
                onClick={() => avatarInputRef.current?.click()}
              >
                {isUploadingAvatar ? t("settings.avatar_uploading") : t("settings.avatar_upload")}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary p-5">
          <h2 className="mb-3 font-display text-lg">{t("settings.notifications")}</h2>
          <label className="flex items-center gap-2 text-sm text-paw-text-secondary">
            <input
              type="checkbox"
              checked={notifications}
              onChange={(event) => setNotifications(event.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-[#1e1f22] accent-paw-accent"
            />
            {t("settings.notifications_toggle")}
          </label>
        </section>

        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary p-5">
          <h2 className="mb-3 font-display text-lg">{t("settings.voice_keybinds")}</h2>
          <label className="text-sm text-paw-text-secondary">{t("settings.push_to_talk")}</label>
          <input
            value={pushToTalkKey}
            onChange={(event) => setPushToTalkKey(event.target.value)}
            className="mt-1 block rounded-md border border-white/10 bg-[#1e1f22] px-3 py-2 text-[14px] leading-5 outline-none transition focus:border-paw-accent focus:ring-2 focus:ring-paw-accent/30"
          />
        </section>

        <div className="flex gap-2">
          <Link to="/app/home">
            <Button className="bg-black/25 text-paw-text-primary shadow-none">{t("common.back")}</Button>
          </Link>
        </div>
      </div>
    </main>
  );
};

export default SettingsPage;
