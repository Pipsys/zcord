import { useState } from "react";

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
  const [showAdvanced, setShowAdvanced] = useState(false);

  const buttonBaseClass =
    "grid h-10 w-10 place-items-center rounded-full border border-white/10 text-paw-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mx-auto flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-paw-bg-secondary px-3 py-2">
        <button
          onClick={onToggleMute}
          disabled={!connected}
          title={muted ? t("voice.unmute") : t("voice.mute")}
          className={`${buttonBaseClass} ${!connected ? "cursor-not-allowed bg-[#2b2d31] text-white/40" : muted ? "bg-[#da373c] text-white hover:bg-[#ef4444] active:bg-[#cf3f44]" : "bg-[#3b3f46] hover:bg-[#4a4d55]"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
            <path d="M19 11a7 7 0 0 1-12 4.95" />
            <path d="M5 11a7 7 0 0 0 10.64 5.95" />
            <path d="M12 19v3" />
            <path d="M9 22h6" />
            {muted ? <path d="M4 4l16 16" /> : null}
          </svg>
        </button>

        <button
          onClick={onToggleDeafen}
          disabled={!connected}
          title={deafened ? t("voice.undeafen") : t("voice.deafen")}
          className={`${buttonBaseClass} ${!connected ? "cursor-not-allowed bg-[#2b2d31] text-white/40" : deafened ? "bg-[#da373c] text-white hover:bg-[#ef4444] active:bg-[#cf3f44]" : "bg-[#3b3f46] hover:bg-[#4a4d55]"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <path d="M4 14h4l5 4V6L8 10H4z" />
            {!deafened ? <path d="M16 9a4 4 0 0 1 0 6" /> : null}
            {!deafened ? <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" /> : null}
            {deafened ? <path d="M4 4l16 16" /> : null}
          </svg>
        </button>

        <button
          onClick={onToggleScreenShare}
          disabled={!connected}
          title={screenSharing ? t("voice.stop_screen_share") : t("voice.screen_share")}
          className={`${buttonBaseClass} ${
            !connected
              ? "cursor-not-allowed bg-[#2b2d31] text-white/40"
              : screenSharing
                ? "bg-[#248046] text-white hover:bg-[#2a9351] active:bg-[#227f47]"
                : "bg-[#3b3f46] hover:bg-[#4a4d55]"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <rect x="3" y="5" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
            <path d="M12 17v3" />
            {screenSharing ? <path d="M5 7l14 8" /> : null}
          </svg>
        </button>

        <button disabled className={`${buttonBaseClass} cursor-not-allowed bg-[#2b2d31] text-white/40`} title={t("voice.video")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <rect x="3" y="7" width="12" height="10" rx="2" />
            <path d="M15 11l6-3v8l-6-3z" />
          </svg>
        </button>

        <button
          onClick={() => setShowAdvanced((value) => !value)}
          disabled={!connected}
          className={`${buttonBaseClass} ${!connected ? "cursor-not-allowed bg-[#2b2d31] text-white/40" : "bg-[#3b3f46] hover:bg-[#4a4d55]"}`}
          title="Devices"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6z" />
          </svg>
        </button>

        {connected ? (
          <button onClick={onLeave} className={`${buttonBaseClass} border-red-400/40 bg-[#da373c] text-white hover:bg-[#ef4444] active:bg-[#cf3f44]`} title={t("voice.leave")}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
              <path d="M5 16c1.5-2 4-3 7-3s5.5 1 7 3" />
              <path d="M9 14l-2 2" />
              <path d="M15 14l2 2" />
            </svg>
          </button>
        ) : null}
      </div>

      {connected && showAdvanced ? (
        <div className="mx-auto mt-2 flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-paw-bg-secondary p-3">
          <label className="flex items-center gap-2 text-xs text-paw-text-muted">
            {t("voice.input_device")}
            <select
              value={selectedInputDeviceId}
              onChange={(event) => onInputDeviceChange(event.target.value)}
              className="min-w-[220px] rounded-md border border-white/12 bg-black/25 px-2 py-1 text-xs leading-4 text-paw-text-secondary focus:border-paw-accent focus:outline-none focus:ring-2 focus:ring-paw-accent/30"
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
              className="max-w-[300px] rounded-md border border-white/12 bg-black/25 px-2 py-1 text-xs leading-4 text-paw-text-secondary focus:border-paw-accent focus:outline-none focus:ring-2 focus:ring-paw-accent/30"
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
            className="rounded-md border border-white/10 bg-black/25 px-2.5 py-1.5 text-xs font-semibold leading-4 text-paw-text-secondary transition-colors hover:bg-black/35 hover:text-paw-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
            disabled={!connected}
          >
            {t("voice.refresh_sources")}
          </button>

          <label className="ml-auto flex items-center gap-2 text-xs text-paw-text-muted">
            {t("voice.volume")}
            <input type="range" min={0} max={100} defaultValue={100} onChange={(event) => onVolumeChange(Number(event.target.value) / 100)} className="accent-paw-accent" />
          </label>
        </div>
      ) : null}
    </div>
  );
};
