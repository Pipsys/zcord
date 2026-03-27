import { useI18n } from "@/i18n/provider";

interface VoiceControlsProps {
  muted: boolean;
  deafened: boolean;
  connected: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
  onVolumeChange: (value: number) => void;
}

export const VoiceControls = ({ muted, deafened, connected, onToggleMute, onToggleDeafen, onLeave, onVolumeChange }: VoiceControlsProps) => {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onToggleMute}
        className={`rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold transition ${muted ? "bg-[#da373c] text-white" : "bg-black/25 text-paw-text-secondary hover:text-paw-text-primary"}`}
      >
        {muted ? t("voice.unmute") : t("voice.mute")}
      </button>

      <button
        onClick={onToggleDeafen}
        className={`rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold transition ${deafened ? "bg-[#da373c] text-white" : "bg-black/25 text-paw-text-secondary hover:text-paw-text-primary"}`}
      >
        {deafened ? t("voice.undeafen") : t("voice.deafen")}
      </button>

      <button className="rounded-md border border-white/10 bg-black/25 px-3 py-1.5 text-xs font-semibold text-paw-text-secondary hover:text-paw-text-primary">{t("voice.screen_share")}</button>
      <button className="rounded-md border border-white/10 bg-black/25 px-3 py-1.5 text-xs font-semibold text-paw-text-secondary hover:text-paw-text-primary">{t("voice.video")}</button>

      {connected ? (
        <button onClick={onLeave} className="rounded-md border border-white/10 bg-[#da373c] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">
          {t("voice.leave")}
        </button>
      ) : null}

      <label className="ml-auto flex items-center gap-2 text-xs text-paw-text-muted">
        {t("voice.volume")}
        <input type="range" min={0} max={100} defaultValue={100} onChange={(event) => onVolumeChange(Number(event.target.value) / 100)} className="accent-paw-accent" />
      </label>
    </div>
  );
};
