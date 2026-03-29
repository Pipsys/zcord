import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { uploadAvatar } from "@/api/client";
import { useUpdateMeMutation } from "@/api/queries";
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
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const pushToast = useUiStore((state) => state.pushToast);
  const updateMe = useUpdateMeMutation();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notifications, setNotifications] = useState(true);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  useEffect(() => {
    setDisplayName(user?.username ?? "");
    setEmail(user?.email ?? "");
  }, [user?.email, user?.username]);

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

  const handleSaveProfile = async () => {
    if (!user) {
      return;
    }

    const nextDisplayName = displayName.trim();
    const nextEmail = email.trim();
    if (nextDisplayName.length < 2 || nextEmail.length === 0) {
      pushToast(t("home.request_failed"), t("common.unknown_error"));
      return;
    }

    const payload: { username?: string; email?: string } = {};
    if (nextDisplayName !== user.username) {
      payload.username = nextDisplayName;
    }
    if (nextEmail !== user.email) {
      payload.email = nextEmail;
    }

    if (Object.keys(payload).length === 0) {
      pushToast(t("settings.profile_no_changes"), "");
      return;
    }

    try {
      const updated = await updateMe.mutateAsync(payload);
      setUser(updated);
      pushToast(t("settings.profile_updated_title"), t("settings.profile_updated_desc"));
    } catch (error) {
      pushToast(t("home.request_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      pushToast(t("settings.password_required"), "");
      return;
    }

    if (newPassword !== confirmPassword) {
      pushToast(t("settings.password_mismatch"), "");
      return;
    }

    try {
      await updateMe.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      pushToast(t("settings.password_changed_title"), t("settings.password_changed_desc"));
    } catch (error) {
      pushToast(t("home.request_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  return (
    <main className="h-full overflow-auto bg-paw-bg-primary p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary px-5 py-4">
          <h1 className="text-xl font-semibold text-paw-text-primary">{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-paw-text-muted">{t("settings.description")}</p>
        </section>

        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary px-5 py-4">
          <h2 className="mb-4 text-base font-semibold text-paw-text-primary">{t("settings.profile")}</h2>

          <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <Avatar src={user?.avatar_url ?? null} label={user?.username ?? "user"} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-paw-text-secondary">{displayName || t("common.none")}</p>
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
              <Button className="px-3 py-1.5 text-xs" disabled={isUploadingAvatar} onClick={() => avatarInputRef.current?.click()}>
                {isUploadingAvatar ? t("settings.avatar_uploading") : t("settings.avatar_upload")}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("settings.display_name")}</label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-10 w-full rounded-md border border-white/10 bg-[#1e1f22] px-3 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none focus:ring-2 focus:ring-paw-accent/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("auth.email")}</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                className="h-10 w-full rounded-md border border-white/10 bg-[#1e1f22] px-3 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none focus:ring-2 focus:ring-paw-accent/30"
              />
            </div>
          </div>

          <div className="mt-4">
            <Button className="px-4 py-2 text-sm font-semibold" onClick={() => void handleSaveProfile()} disabled={updateMe.isPending}>
              {t("settings.save_profile")}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary px-5 py-4">
          <h2 className="mb-4 text-base font-semibold text-paw-text-primary">{t("settings.security")}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("settings.current_password")}</label>
              <input
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                className="h-10 w-full rounded-md border border-white/10 bg-[#1e1f22] px-3 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none focus:ring-2 focus:ring-paw-accent/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("settings.new_password")}</label>
              <input
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                className="h-10 w-full rounded-md border border-white/10 bg-[#1e1f22] px-3 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none focus:ring-2 focus:ring-paw-accent/30"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("settings.confirm_password")}</label>
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                className="h-10 w-full rounded-md border border-white/10 bg-[#1e1f22] px-3 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none focus:ring-2 focus:ring-paw-accent/30"
              />
            </div>
          </div>

          <div className="mt-4">
            <Button className="px-4 py-2 text-sm font-semibold" onClick={() => void handleChangePassword()} disabled={updateMe.isPending}>
              {t("settings.change_password")}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary px-5 py-4">
          <h2 className="mb-3 text-base font-semibold text-paw-text-primary">{t("settings.notifications")}</h2>
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

        <section className="rounded-xl border border-white/10 bg-paw-bg-secondary px-5 py-4">
          <Button className="bg-[#da373c] px-3 py-2 text-sm font-semibold leading-5 shadow-none hover:bg-[#e0484d]" onClick={() => void clearAuth()}>
            {t("home.logout")}
          </Button>
        </section>

        <div className="flex gap-2">
          <Link to="/app/home">
            <Button className="bg-black/25 px-4 py-2 text-sm font-semibold text-paw-text-primary shadow-none">{t("common.back")}</Button>
          </Link>
        </div>
      </div>
    </main>
  );
};

export default SettingsPage;
