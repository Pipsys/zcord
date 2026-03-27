import { Avatar } from "@/components/ui/Avatar";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { useVoice } from "@/hooks/useVoice";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";

interface VoiceChannelProps {
  channelName: string | null;
  connected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export const VoiceChannel = ({ channelName, connected, onConnect, onDisconnect }: VoiceChannelProps) => {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const { state, start, stop, setMuted, setDeafened, setVolume } = useVoice();

  const handleConnect = async () => {
    try {
      await start();
      onConnect();
    } catch {
      // Permissions error is surfaced by browser UI.
    }
  };

  const handleLeave = () => {
    stop();
    onDisconnect();
  };

  return (
    <section className="m-4 rounded-xl border border-white/10 bg-black/20 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.35)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-paw-text-muted">{t("voice.title")}</h3>
        <span className={`rounded-md border border-white/10 px-2 py-1 text-xs font-semibold ${connected ? "bg-[#3ba55d] text-white" : "bg-black/25 text-paw-text-muted"}`}>
          {connected ? t("voice.connected") : t("voice.not_connected")}
        </span>
      </div>

      <p className="mb-3 text-sm text-paw-text-secondary">{channelName ? `#${channelName}` : t("server.voice_panel_hint")}</p>

      {connected ? (
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <Avatar src={user?.avatar_url ?? null} label={user?.username ?? "you"} online size="sm" />
            <div>
              <p className="text-sm font-semibold text-paw-text-secondary">{user?.username ?? "you"}</p>
              <p className="text-xs text-paw-text-muted">{state.speaking ? t("channels.connected") : t("voice.connected")}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-paw-text-muted">{t("voice.no_participants")}</div>
      )}

      <div className="mb-3">
        {!connected ? (
          <button className="rounded-md border border-white/10 bg-paw-accent px-3 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_var(--color-accent-glow)] transition-colors hover:bg-paw-accentSecondary" onClick={() => void handleConnect()}>
            {t("voice.connect")}
          </button>
        ) : null}
      </div>

      <VoiceControls
        muted={state.muted}
        deafened={state.deafened}
        connected={connected}
        onToggleMute={() => setMuted(!state.muted)}
        onToggleDeafen={() => setDeafened(!state.deafened)}
        onLeave={handleLeave}
        onVolumeChange={setVolume}
      />
    </section>
  );
};
