import { useCallback, useMemo, useRef, useState } from "react";

interface VoiceState {
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  volume: number;
}

export const useVoice = () => {
  const [state, setState] = useState<VoiceState>({
    muted: false,
    deafened: false,
    speaking: false,
    volume: 1,
  });
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    setState((current) => ({ ...current, speaking: true }));
    return stream;
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState((current) => ({ ...current, speaking: false }));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    setState((current) => ({ ...current, muted }));
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, []);

  const setDeafened = useCallback((deafened: boolean) => {
    setState((current) => ({ ...current, deafened }));
  }, []);

  const setVolume = useCallback((volume: number) => {
    setState((current) => ({ ...current, volume }));
  }, []);

  return useMemo(
    () => ({
      state,
      start,
      stop,
      setMuted,
      setDeafened,
      setVolume,
    }),
    [setDeafened, setMuted, setVolume, start, state, stop],
  );
};
