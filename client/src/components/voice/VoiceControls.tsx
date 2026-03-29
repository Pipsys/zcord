import { useI18n } from "@/i18n/provider";
import type { ScreenShareSource, VoiceInputDevice } from "@/hooks/useVoiceRoom";

interface VoiceControlsProps {
  muted: boolean;
  deafened: boolean;
  connected: boolean;
  screenSharing: boolean;
  inputDevices: VoiceInputDevice[];
  selectedInputDeviceId: string;
  screenSources: ScreenShareSource[];
  selectedScreenSourceId: string;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  onVolumeChange: (value: number) => void;
  onInputDeviceChange: (deviceId: string) => void;
  onRefreshScreenSources: () => void;
  onScreenSourceChange: (sourceId: string) => void;
}

export const VoiceControls = ({
  muted,
  deafened,
  connected,
  screenSharing,
  inputDevices,
  selectedInputDeviceId,
  screenSources,
  selectedScreenSourceId,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onLeave,
  onVolumeChange,
  onInputDeviceChange,
  onRefreshScreenSources,
  onScreenSourceChange,
}: VoiceControlsProps) => {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
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

      <button
        onClick={onToggleScreenShare}
        disabled={!connected}
        className={`rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold transition ${
          !connected
            ? "cursor-not-allowed bg-black/25 text-paw-text-muted opacity-60"
            : screenSharing
              ? "bg-[#3ba55d] text-white hover:brightness-110"
              : "bg-black/25 text-paw-text-secondary hover:text-paw-text-primary"
        }`}
      >
        {screenSharing ? t("voice.stop_screen_share") : t("voice.screen_share")}
      </button>
      <button
        disabled
        className="cursor-not-allowed rounded-md border border-white/10 bg-black/25 px-3 py-1.5 text-xs font-semibold text-paw-text-muted opacity-60"
      >
        {t("voice.video")}
      </button>

        {connected ? (
          <button onClick={onLeave} className="rounded-md border border-white/10 bg-[#da373c] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">
            {t("voice.leave")}
          </button>
        ) : null}

      <label className="flex items-center gap-2 text-xs text-paw-text-muted">
        {t("voice.input_device")}
        <select
          value={selectedInputDeviceId}
          onChange={(event) => onInputDeviceChange(event.target.value)}
          className="rounded-md border border-white/12 bg-black/25 px-2 py-1 text-xs text-paw-text-secondary focus:border-paw-accent focus:outline-none"
        >
          {inputDevices.map((device: VoiceInputDevice, index: number) => (
            <option key={`${device.deviceId}-${index}`} value={device.deviceId}>
              {device.deviceId === "__system_default__" ? t("voice.input_default") : device.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-paw-text-muted">
        {t("voice.screen_source")}
        <select
          value={selectedScreenSourceId}
          onChange={(event) => onScreenSourceChange(event.target.value)}
          className="max-w-[260px] rounded-md border border-white/12 bg-black/25 px-2 py-1 text-xs text-paw-text-secondary focus:border-paw-accent focus:outline-none"
          disabled={!connected}
        >
          <option value="__auto__">{t("voice.screen_source_auto")}</option>
          {screenSources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.kind === "screen" ? `${t("voice.screen_source_display")} ` : `${t("voice.screen_source_window")} `}
              {source.name}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={onRefreshScreenSources}
        className="rounded-md border border-white/10 bg-black/25 px-2.5 py-1.5 text-xs font-semibold text-paw-text-secondary hover:text-paw-text-primary"
        disabled={!connected}
      >
        {t("voice.refresh_sources")}
      </button>

      <label className="ml-auto flex items-center gap-2 text-xs text-paw-text-muted">
        {t("voice.volume")}
        <input type="range" min={0} max={100} defaultValue={100} onChange={(event) => onVolumeChange(Number(event.target.value) / 100)} className="accent-paw-accent" />
      </label>
    </div>
  );
};
