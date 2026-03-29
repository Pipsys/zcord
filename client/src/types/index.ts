export type UserStatus = "online" | "idle" | "dnd" | "invisible";
export type FriendStatus = "pending" | "accepted" | "blocked";

export interface User {
  id: string;
  username: string;
  discriminator: string;
  email: string;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string | null;
  status: UserStatus;
  custom_status: string | null;
  public_key: string | null;
  is_bot: boolean;
  is_verified: boolean;
  created_at: string;
}

export interface Server {
  id: string;
  name: string;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: string;
  region: string | null;
  is_nsfw: boolean;
  max_members: number;
  created_at: string;
}

export interface ServerMember {
  user_id: string;
  username: string;
  nickname: string | null;
  avatar_url: string | null;
  status: UserStatus;
  is_online: boolean;
  was_recently_online: boolean;
  last_seen_at: string | null;
  joined_at: string;
}

export interface Channel {
  id: string;
  server_id: string | null;
  type: "text" | "voice" | "announcement" | "forum" | "dm" | "group_dm";
  name: string;
  topic: string | null;
  position: number;
  is_nsfw: boolean;
  slowmode_delay: number;
  parent_id: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  channel_id: string;
  server_id?: string | null;
  author_id: string;
  author_username?: string | null;
  author_avatar_url?: string | null;
  content: string;
  nonce: string | null;
  type: "default" | "system" | "reply" | "thread_starter";
  reference_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
  delivered_by?: string[];
  read_by?: string[];
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  download_url: string;
}

export interface FriendRelation {
  requester_id: string;
  addressee_id: string;
  requester_username?: string | null;
  addressee_username?: string | null;
  requester_avatar_url?: string | null;
  addressee_avatar_url?: string | null;
  peer_is_online: boolean;
  peer_was_recently_online: boolean;
  peer_last_seen_at: string | null;
  status: FriendStatus;
  created_at: string;
}

export interface GatewayEvent {
  op: string;
  t: string;
  d: Record<string, unknown>;
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T;
}
