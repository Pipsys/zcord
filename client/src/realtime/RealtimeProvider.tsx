import { createContext, useContext, useMemo, type ReactNode } from "react";

import { GlobalVoiceAudio } from "@/components/voice/GlobalVoiceAudio";
import { useVoiceRoom } from "@/hooks/useVoiceRoom";
import { type GatewayConnectionStatus, useWebSocket } from "@/hooks/useWebSocket";

interface RealtimeContextValue {
  socket: WebSocket | null;
  gatewayStatus: GatewayConnectionStatus;
  gatewayLatencyMs: number | null;
  voiceRoom: ReturnType<typeof useVoiceRoom>;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export const RealtimeProvider = ({ children }: { children: ReactNode }) => {
  const { socket, status, latencyMs } = useWebSocket();
  const voiceRoom = useVoiceRoom(socket);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      socket,
      gatewayStatus: status,
      gatewayLatencyMs: latencyMs,
      voiceRoom,
    }),
    [latencyMs, socket, status, voiceRoom],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
      <GlobalVoiceAudio
        connectedChannelId={voiceRoom.connectedChannelId}
        participants={voiceRoom.participants}
        remoteStreams={voiceRoom.remoteStreams}
        deafened={voiceRoom.deafened}
        volume={voiceRoom.volume}
      />
    </RealtimeContext.Provider>
  );
};

export const useRealtime = (): RealtimeContextValue => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used inside RealtimeProvider");
  }
  return context;
};
