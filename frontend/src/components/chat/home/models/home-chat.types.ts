export type HomeChatTab = "chat" | "news";

export interface ChatReactionSummary {
  emoji: string;
  count: number;
  reactors: string[];
}

export interface ChatReplyPreview {
  id: string;
  sender: string;
  username?: string;
  contentPreview: string;
}

export interface HomeChatMessage {
  id: string;
  walletAddress?: string;
  createdAt?: string;
  clientMessageId?: string;
  message: string;
  timestamp: string;
  deliveryStatus?: "pending" | "sent" | "failed";
  isLocal?: boolean;
  replyToId?: string;
  replyTo?: ChatReplyPreview | null;
  reactions?: ChatReactionSummary[];
  username?: string;
}

export interface ReplyContext {
  messageId: string;
  sender: string;
  username?: string;
  contentPreview: string;
}

export interface UserProfileData {
  username?: string;
  walletAddress: string;
  avatarColor: string;
  avatarImage?: string;
  rank?: number;
  deployedSol?: number;
  roundsPlayed?: number;
  motherlodeHits?: number;
  loading?: boolean;
  unavailable?: boolean;
}

export interface NoteItem {
  type: "Update" | "Event";
  date: string;
  title: string;
  desc: string;
}
