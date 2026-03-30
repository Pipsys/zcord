import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, get, patch, post, uploadAttachments, uploadServerBanner, uploadServerIcon } from "@/api/client";
import type { UploadProgressEvent } from "@/api/client";
import type { Channel, FriendRelation, Message, Server, ServerMember, User } from "@/types";

export const useMeQuery = () => useQuery({ queryKey: ["me"], queryFn: () => get<User>("/users/me") });

export const useUpdateMeMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      username?: string;
      email?: string;
      current_password?: string;
      new_password?: string;
      avatar_url?: string | null;
      banner_url?: string | null;
      bio?: string | null;
      custom_status?: string | null;
      status?: User["status"];
    }) => patch<User>("/users/me", payload),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(["me"], updatedUser);
      void queryClient.invalidateQueries({ queryKey: ["friends"] });
      void queryClient.invalidateQueries({ queryKey: ["server-members"] });
    },
  });
};

export const useServersQuery = () =>
  useQuery({
    queryKey: ["servers"],
    queryFn: () => get<Server[]>("/servers"),
  });

export const useChannelsQuery = (serverId: string | null) =>
  useQuery({
    queryKey: ["channels", serverId],
    queryFn: () => get<Channel[]>(`/channels${serverId ? `?server_id=${serverId}` : ""}`),
    enabled: serverId !== null,
  });

export const useServerMembersQuery = (serverId: string | null) =>
  useQuery({
    queryKey: ["server-members", serverId],
    queryFn: () => get<ServerMember[]>(`/servers/${serverId}/members`),
    enabled: serverId !== null,
    refetchInterval: 5_000,
  });

export const useDirectChannelsQuery = () =>
  useQuery({
    queryKey: ["channels", "dm"],
    queryFn: () => get<Channel[]>("/channels"),
  });

export const useMessagesQuery = (channelId: string | null) =>
  useQuery({
    queryKey: ["messages", channelId],
    queryFn: () => get<Message[]>(`/messages?channel_id=${channelId}&limit=50`),
    enabled: channelId !== null,
  });

export const useFriendsQuery = () =>
  useQuery({
    queryKey: ["friends"],
    queryFn: () => get<FriendRelation[]>("/friends"),
    refetchInterval: 5_000,
  });

export const useCreateServerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; icon_url?: string | null; banner_url?: string | null; region?: string | null; is_nsfw?: boolean }) =>
      post<Server>("/servers", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
};

export const useCreateChannelMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      server_id: string | null;
      type: Channel["type"];
      name: string;
      topic?: string | null;
      position?: number;
      is_nsfw?: boolean;
      slowmode_delay?: number;
      parent_id?: string | null;
    }) => post<Channel>("/channels", payload),
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: ["channels", payload.server_id] });
    },
  });
};

export const useUpdateChannelMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      channelId: string;
      serverId: string | null;
      name?: string;
      topic?: string | null;
      position?: number;
      is_nsfw?: boolean;
      slowmode_delay?: number;
      parent_id?: string | null;
    }) => {
      const { channelId, serverId: _serverId, ...body } = payload;
      return patch<Channel>(`/channels/${channelId}`, body);
    },
    onSuccess: (channel, payload) => {
      const targetServerId = channel.server_id ?? payload.serverId;
      void queryClient.invalidateQueries({ queryKey: ["channels", targetServerId] });
      if (targetServerId === null) {
        void queryClient.invalidateQueries({ queryKey: ["channels", "dm"] });
      }
    },
  });
};

export const useJoinServerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { serverId: string }) => post<Server>(`/servers/${payload.serverId}/join`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
};

export const useUpdateServerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      serverId: string;
      name?: string;
      icon_url?: string | null;
      banner_url?: string | null;
      region?: string | null;
      is_nsfw?: boolean;
    }) => {
      const { serverId, ...body } = payload;
      return patch<Server>(`/servers/${serverId}`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
};

export const useUploadServerIconMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { serverId: string; file: File }) => uploadServerIcon<Server>(payload.serverId, payload.file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
};

export const useDeleteServerIconMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { serverId: string }) => del<Server>(`/servers/${payload.serverId}/icon`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
};

export const useUploadServerBannerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { serverId: string; file: File }) => uploadServerBanner<Server>(payload.serverId, payload.file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
};

export const useSendFriendRequestMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { addressee_id: string }) => post<FriendRelation>("/friends", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["friends"] });
    },
  });
};

export const useUpdateFriendRequestMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { requesterId: string; status: FriendRelation["status"] }) =>
      patch<FriendRelation>(`/friends/${payload.requesterId}`, { status: payload.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["friends"] });
    },
  });
};

export const useOpenDirectMessageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { friendId: string }) => post<Channel>(`/friends/${payload.friendId}/dm`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["friends"] });
      void queryClient.invalidateQueries({ queryKey: ["channels", "dm"] });
    },
  });
};

export const useCreateMessageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { channel_id: string; content: string; nonce: string | null; type: "default" | "reply"; reference_id: string | null }) =>
      post<Message>("/messages", payload),
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: ["messages", payload.channel_id] });
    },
  });
};

export const useUploadAttachmentsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { messageId: string; channelId: string; files: File[]; onProgress?: (entry: UploadProgressEvent) => void }) =>
      uploadAttachments(payload.messageId, payload.files, payload.onProgress),
    onSuccess: (_, payload) => {
      void queryClient.invalidateQueries({ queryKey: ["messages", payload.channelId] });
    },
  });
};

export const useUpdateMessageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { messageId: string; content: string }) => patch<Message>(`/messages/${payload.messageId}`, { content: payload.content }),
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: ["messages", message.channel_id] });
    },
  });
};

export const useDeleteMessageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => del<{ message_id: string; channel_id: string; server_id: string | null; deleted_at: string }>(`/messages/${messageId}`),
    onSuccess: (payload) => {
      void queryClient.invalidateQueries({ queryKey: ["messages", payload.channel_id] });
    },
  });
};
