import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { post } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import type { User } from "@/types";

interface AuthResponse {
  token: {
    access_token: string;
  };
  user: {
    id: string;
    username: string;
    discriminator: string;
    email: string;
    public_key: string | null;
  };
}

const toUserState = (user: AuthResponse["user"]): User => ({
  id: user.id,
  username: user.username,
  discriminator: user.discriminator,
  email: user.email,
  avatar_url: null,
  banner_url: null,
  bio: null,
  status: "online",
  custom_status: null,
  public_key: user.public_key,
  is_bot: false,
  is_verified: false,
  created_at: new Date().toISOString(),
});

const LoginPage = () => {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const { t } = useI18n();
  const setAuth = useAuthStore((state) => state.setAuth);
  const pushToast = useUiStore((state) => state.pushToast);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const response = await post<AuthResponse>("/auth/login", { login, password });
      await setAuth(response.token.access_token, toUserState(response.user));
      pushToast(t("auth.welcome_back"), t("auth.logged_in_as", { username: response.user.username }));
      navigate("/app/home");
    } catch (error) {
      pushToast(t("auth.login_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  return (
    <main className="relative grid h-full place-items-center px-4">
      <div className="absolute right-6 top-6 z-10">
        <LanguageSwitcher />
      </div>

      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md rounded-2xl border border-white/15 bg-black/20 p-8 shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
      >
        <h1 className="mb-6 font-display text-4xl tracking-tight text-paw-text-primary">{t("auth.login_title")}</h1>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-sm font-medium text-paw-text-secondary">{t("auth.email_or_username")}</span>
          <input
            className="h-11 w-full rounded-lg border border-white/12 bg-black/25 px-3 text-paw-text-primary outline-none transition focus:border-paw-accent focus:ring-2 focus:ring-paw-accent/20"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            required
          />
        </label>

        <label className="mb-5 block">
          <span className="mb-1.5 block text-sm font-medium text-paw-text-secondary">{t("auth.password")}</span>
          <input
            type="password"
            className="h-11 w-full rounded-lg border border-white/12 bg-black/25 px-3 text-paw-text-primary outline-none transition focus:border-paw-accent focus:ring-2 focus:ring-paw-accent/20"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <Button type="submit" className="w-full py-2.5 text-[15px]">
          {t("auth.login_button")}
        </Button>

        <p className="mt-5 text-sm text-paw-text-secondary">
          {t("auth.new_here")} <Link to="/register" className="text-paw-accent hover:underline">{t("auth.create_account")}</Link>
        </p>
      </form>
    </main>
  );
};

export default LoginPage;
