import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { uploadAvatar, uploadUserBanner } from "@/api/client";
import { useUpdateMeMutation } from "@/api/queries";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import { THEMES, type ThemeId } from "@/theme/themes";
import type { User } from "@/types";

const AVATAR_MAX_BYTES = 25 * 1024 * 1024;
const USER_BANNER_MAX_BYTES = 30 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
const ALLOWED_USER_BANNER_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
const settingsCardClass = "rounded-xl border border-white/10 bg-[var(--color-bg-secondary)] p-5";

type SettingsTabId = "profile" | "security" | "appearance" | "updates";

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / 1024 ** exponent;
  const decimals = exponent === 0 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals)} ${units[exponent]}`;
};

const formatReleaseDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString();
};

const getThemePreview = (theme: ThemeId): readonly [string, string, string] => {
  if (theme === THEMES.OLED_BLACK) {
    return ["#0c0d10", "#08090c", "#050609"];
  }
  if (theme === THEMES.PEARL_LIGHT) {
    return ["#f6f7fb", "#eef1f7", "#e4e9f4"];
  }
  return ["#181b22", "#12151b", "#0d1015"];
};

const SettingsPage = () => {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const pushToast = useUiStore((state) => state.pushToast);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const updateMe = useUpdateMeMutation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<SettingsTabId>("profile");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notifications, setNotifications] = useState(true);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [updaterState, setUpdaterState] = useState<UpdaterState | null>(null);

  const tabs = useMemo(
    () => [
      { id: "profile" as const, label: t("settings.profile") },
      { id: "security" as const, label: t("settings.security") },
      { id: "appearance" as const, label: t("settings.appearance") },
      { id: "updates" as const, label: t("settings.updates") },
    ],
    [t],
  );

  const activeTabLabel = tabs.find((item) => item.id === activeTab)?.label ?? t("settings.title");

  useEffect(() => {
    setDisplayName(user?.username ?? "");
    setEmail(user?.email ?? "");
  }, [user?.email, user?.username]);

  useEffect(() => {
    let active = true;

    const hydrateUpdater = async () => {
      try {
        const next = await window.pawcord.updater.getState();
        if (active) {
          setUpdaterState(next);
        }
      } catch (error) {
        if (active) {
          pushToast(t("settings.updates_check_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
        }
      }
    };

    void hydrateUpdater();
    const unsubscribe = window.pawcord.updater.onStateChange((next) => {
      if (active) {
        setUpdaterState(next);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [pushToast, t]);

  const handleCheckUpdates = async () => {
    try {
      const next = await window.pawcord.updater.checkForUpdates();
      setUpdaterState(next);
    } catch (error) {
      pushToast(t("settings.updates_check_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      const next = await window.pawcord.updater.downloadUpdate();
      setUpdaterState(next);
    } catch (error) {
      pushToast(t("settings.updates_download_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleInstallUpdate = async () => {
    try {
      const next = await window.pawcord.updater.installUpdate();
      setUpdaterState(next);
    } catch (error) {
      pushToast(t("settings.updates_install_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const updaterStatusLabel = (() => {
    if (!updaterState) {
      return t("common.loading");
    }

    switch (updaterState.status) {
      case "disabled":
        return t("settings.updates_status_disabled");
      case "idle":
        return t("settings.updates_status_idle");
      case "checking":
        return t("settings.updates_status_checking");
      case "available":
        return t("settings.updates_status_available");
      case "not-available":
        return t("settings.updates_status_not_available");
      case "downloading":
        return t("settings.updates_status_downloading");
      case "downloaded":
        return t("settings.updates_status_downloaded");
      case "installing":
        return t("settings.updates_status_installing");
      case "error":
        return t("settings.updates_status_error");
      default:
        return t("common.unknown_error");
    }
  })();

  const isUpdaterBusy = updaterState?.status === "checking" || updaterState?.status === "downloading" || updaterState?.status === "installing";
  const canCheckUpdates = Boolean(updaterState?.enabled && !isUpdaterBusy);
  const canDownloadUpdate = updaterState?.status === "available";
  const canInstallUpdate = updaterState?.status === "downloaded";
  const releaseDateLabel = formatReleaseDate(updaterState?.releaseDate ?? null);
  const themeOptions = [
    {
      id: THEMES.GRAPHITE_GRAY,
      label: t("settings.theme_graphite_gray"),
      description: t("settings.theme_graphite_gray_desc"),
      preview: getThemePreview(THEMES.GRAPHITE_GRAY),
    },
    {
      id: THEMES.OLED_BLACK,
      label: t("settings.theme_oled_black"),
      description: t("settings.theme_oled_black_desc"),
      preview: getThemePreview(THEMES.OLED_BLACK),
    },
    {
      id: THEMES.PEARL_LIGHT,
      label: t("settings.theme_pearl_light"),
      description: t("settings.theme_pearl_light_desc"),
      preview: getThemePreview(THEMES.PEARL_LIGHT),
    },
  ] as const;

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

  const handlePickBanner = async (file: File | null) => {
    if (!file) {
      return;
    }

    if (!ALLOWED_USER_BANNER_MIME_TYPES.has(file.type)) {
      pushToast(t("settings.banner_invalid_type_title"), t("settings.banner_invalid_type_desc"));
      return;
    }

    if (file.size > USER_BANNER_MAX_BYTES) {
      pushToast(t("settings.banner_invalid_size_title"), t("settings.banner_invalid_size_desc"));
      return;
    }

    setIsUploadingBanner(true);
    try {
      const updated = await uploadUserBanner<User>(file);
      setUser(updated);
      pushToast(t("settings.banner_upload_success_title"), t("settings.banner_upload_success_desc"));
    } catch (error) {
      pushToast(t("settings.banner_upload_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
    } finally {
      setIsUploadingBanner(false);
      if (bannerInputRef.current) {
        bannerInputRef.current.value = "";
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

    const usernameChanged = nextDisplayName !== user.username;
    const emailChanged = nextEmail !== user.email;

    if (!usernameChanged && !emailChanged) {
      pushToast(t("settings.profile_no_changes"), "");
      return;
    }

    let hasAppliedChanges = false;
    let firstErrorMessage: string | null = null;

    if (usernameChanged) {
      try {
        const updated = await updateMe.mutateAsync({ username: nextDisplayName });
        setUser(updated);
        setDisplayName(updated.username);
        setEmail(updated.email);
        hasAppliedChanges = true;
      } catch (error) {
        firstErrorMessage = error instanceof Error ? error.message : t("common.unknown_error");
      }
    }

    if (emailChanged) {
      try {
        const updated = await updateMe.mutateAsync({ email: nextEmail });
        setUser(updated);
        setDisplayName(updated.username);
        setEmail(updated.email);
        hasAppliedChanges = true;
      } catch (error) {
        if (firstErrorMessage === null) {
          firstErrorMessage = error instanceof Error ? error.message : t("common.unknown_error");
        }
      }
    }

    if (firstErrorMessage !== null) {
      if (hasAppliedChanges) {
        pushToast(t("settings.profile_updated_title"), t("settings.profile_updated_desc"));
      }
      pushToast(t("home.request_failed"), firstErrorMessage);
      return;
    }

    if (hasAppliedChanges) {
      pushToast(t("settings.profile_updated_title"), t("settings.profile_updated_desc"));
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
    <main className="h-full overflow-hidden bg-paw-bg-primary">
      <div className="mx-auto flex h-full w-full max-w-[1320px]">
        <aside className="relative flex h-full w-[260px] shrink-0 flex-col bg-[var(--color-bg-secondary)]/90 p-4 md:p-5">
          <div>
            <h1 className="typo-title-md text-paw-text-primary">{t("settings.title")}</h1>
            <p className="typo-meta mt-1">{t("settings.description")}</p>
          </div>

          <div className="mt-5 space-y-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`ui-focus-ring flex h-9 w-full items-center rounded-md px-3 text-left text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-[var(--state-selected-bg)] text-paw-text-primary"
                      : "text-paw-text-muted hover:bg-[var(--state-hover-bg)] hover:text-paw-text-secondary"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="mt-auto space-y-2 pt-4">
            <div className="mb-4 h-px w-full bg-gradient-to-r from-transparent via-white/14 to-transparent" />
            <Button variant="danger" className="w-full" onClick={() => void clearAuth()}>
              {t("home.logout")}
            </Button>
            <Link to="/app/home" className="block">
              <Button variant="ghost" className="w-full">
                {t("common.back")}
              </Button>
            </Link>
          </div>

          <div className="pointer-events-none absolute inset-y-4 right-0 w-px bg-gradient-to-b from-transparent via-white/14 to-transparent" />
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto px-6 py-6 md:px-8 md:py-7">
          <header className="mb-6 pb-4">
            <h2 className="typo-title-lg">{activeTabLabel}</h2>
            <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-white/16 to-transparent" />
          </header>

          {activeTab === "profile" ? (
            <div className="space-y-4">
              <section className={settingsCardClass}>
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex items-center gap-3">
                    <Avatar src={user?.avatar_url ?? null} label={user?.username ?? "user"} size="lg" />
                    <div className="min-w-0">
                      <p className="typo-body truncate font-semibold text-paw-text-secondary">{displayName || t("common.none")}</p>
                      <p className="typo-meta truncate">{t("settings.avatar_hint")}</p>
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
                    <Button size="sm" disabled={isUploadingAvatar} onClick={() => avatarInputRef.current?.click()}>
                      {isUploadingAvatar ? t("settings.avatar_uploading") : t("settings.avatar_upload")}
                    </Button>
                  </div>
                </div>
              </section>

              <section className={settingsCardClass}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="typo-body font-semibold text-paw-text-secondary">{t("settings.call_banner")}</p>
                  <input
                    ref={bannerInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif"
                    className="hidden"
                    onChange={(event) => void handlePickBanner(event.target.files?.[0] ?? null)}
                  />
                  <Button size="sm" variant="secondary" disabled={isUploadingBanner} onClick={() => bannerInputRef.current?.click()}>
                    {isUploadingBanner ? t("settings.banner_uploading") : t("settings.banner_upload")}
                  </Button>
                </div>
                <p className="typo-meta mb-3">{t("settings.banner_hint")}</p>
                <div className="overflow-hidden rounded-lg border border-white/10 bg-[var(--color-bg-tertiary)]">
                  {user?.banner_url ? (
                    <img src={user.banner_url} alt={t("settings.call_banner")} className="h-24 w-full object-cover" />
                  ) : (
                    <div className="flex h-24 items-center justify-center text-xs text-paw-text-muted">{t("settings.banner_empty")}</div>
                  )}
                </div>
              </section>

              <section className={settingsCardClass}>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("settings.display_name")}</label>
                    <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("auth.email")}</label>
                    <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
                  </div>
                </div>

                <div className="mt-4">
                  <Button onClick={() => void handleSaveProfile()} disabled={updateMe.isPending}>
                    {t("settings.save_profile")}
                  </Button>
                </div>
              </section>

              <section className={settingsCardClass}>
                <h3 className="typo-title-md mb-2">{t("settings.notifications")}</h3>
                <label className="typo-body flex items-center gap-2 text-paw-text-secondary">
                  <input
                    type="checkbox"
                    checked={notifications}
                    onChange={(event) => setNotifications(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-[var(--color-bg-tertiary)] accent-paw-accent"
                  />
                  {t("settings.notifications_toggle")}
                </label>
              </section>
            </div>
          ) : null}

          {activeTab === "security" ? (
            <section className={settingsCardClass}>
              <p className="typo-meta mb-4">{t("settings.security_description")}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("settings.current_password")}</label>
                  <Input
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("settings.new_password")}</label>
                  <Input
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("settings.confirm_password")}</label>
                  <Input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="mt-4">
                <Button onClick={() => void handleChangePassword()} disabled={updateMe.isPending}>
                  {t("settings.change_password")}
                </Button>
              </div>
            </section>
          ) : null}

          {activeTab === "appearance" ? (
            <section className={settingsCardClass}>
              <p className="typo-meta mb-4">{t("settings.appearance_description")}</p>

              <div className="grid gap-3 md:grid-cols-2">
                {themeOptions.map((option) => {
                  const isActiveTheme = option.id === theme;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setTheme(option.id)}
                      aria-pressed={isActiveTheme}
                      className={`ui-focus-ring rounded-xl border p-3 text-left transition-colors ${
                        isActiveTheme
                          ? "border-paw-accent/50 bg-[var(--state-selected-bg)]"
                          : "border-white/10 bg-[var(--color-bg-tertiary)] hover:bg-[var(--state-hover-bg)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="typo-body font-semibold text-paw-text-secondary">{option.label}</p>
                        {isActiveTheme ? (
                          <span className="rounded-full border border-paw-accent/40 bg-paw-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-paw-text-primary">
                            {t("settings.theme_active")}
                          </span>
                        ) : null}
                      </div>
                      <p className="typo-meta mt-1">{option.description}</p>
                      <div className="mt-3 flex gap-1.5">
                        {option.preview.map((color) => (
                          <span key={color} className="h-3 flex-1 rounded-full border border-white/10" style={{ background: color }} />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeTab === "updates" ? (
            <section className={settingsCardClass}>
              <p className="typo-meta mb-4">{t("settings.updates_description")}</p>

              <div className="rounded-xl border border-white/10 bg-[var(--color-bg-tertiary)] p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="typo-body truncate font-semibold text-paw-text-secondary">
                      {t("settings.updates_current_version", { version: updaterState?.currentVersion ?? "..." })}
                    </p>
                    <p className="typo-meta">{updaterStatusLabel}</p>
                    {updaterState?.latestVersion ? (
                      <p className="typo-meta mt-1">
                        {t("settings.updates_latest_version", { version: updaterState.latestVersion })}
                        {releaseDateLabel ? ` | ${releaseDateLabel}` : ""}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={!canCheckUpdates} onClick={() => void handleCheckUpdates()}>
                      {updaterState?.status === "checking" ? t("settings.updates_checking") : t("settings.updates_check")}
                    </Button>
                    <Button size="sm" disabled={!canDownloadUpdate} onClick={() => void handleDownloadUpdate()}>
                      {updaterState?.status === "downloading" ? t("settings.updates_downloading") : t("settings.updates_download")}
                    </Button>
                    <Button size="sm" variant="primary" disabled={!canInstallUpdate} onClick={() => void handleInstallUpdate()}>
                      {updaterState?.status === "installing" ? t("settings.updates_installing") : t("settings.updates_install")}
                    </Button>
                  </div>
                </div>

                {updaterState?.status === "downloading" ? (
                  <div className="mt-3 space-y-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-paw-accent transition-all"
                        style={{ width: `${Math.max(0, Math.min(100, updaterState.progressPercent))}%` }}
                      />
                    </div>
                    <p className="typo-meta">
                      {t("settings.updates_progress", {
                        percent: Math.round(updaterState.progressPercent),
                        downloaded: formatBytes(updaterState.downloadedBytes),
                        total: formatBytes(updaterState.totalBytes),
                      })}
                    </p>
                  </div>
                ) : null}

                {updaterState?.message ? <p className="mt-3 text-xs text-rose-300">{updaterState.message}</p> : null}
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
};

export default SettingsPage;
