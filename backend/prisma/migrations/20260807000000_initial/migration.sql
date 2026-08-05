-- CreateTable
CREATE TABLE "rounds" (
    "id" INTEGER NOT NULL,
    "deployed" JSONB NOT NULL,
    "slot_hash" TEXT,
    "vrf_hash" TEXT,
    "count" JSONB NOT NULL,
    "expires_at" BIGINT,
    "motherlode" BIGINT NOT NULL DEFAULT 0,
    "rent_payer" TEXT,
    "top_miner" TEXT,
    "top_miner_reward" BIGINT NOT NULL DEFAULT 0,
    "total_deployed" BIGINT NOT NULL DEFAULT 0,
    "total_miners" INTEGER NOT NULL DEFAULT 0,
    "total_vaulted" BIGINT NOT NULL DEFAULT 0,
    "total_winnings" BIGINT NOT NULL DEFAULT 0,
    "winning_square" INTEGER,
    "is_split_reward" BOOLEAN NOT NULL DEFAULT false,
    "did_hit_motherlode" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_blocks" (
    "round_id" INTEGER NOT NULL,
    "block_number" INTEGER NOT NULL,
    "sol_deployed" BIGINT NOT NULL DEFAULT 0,
    "miner_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "round_blocks_pkey" PRIMARY KEY ("round_id","block_number")
);

-- CreateTable
CREATE TABLE "miners" (
    "wallet" TEXT NOT NULL,
    "rewards_sol" BIGINT NOT NULL DEFAULT 0,
    "lifetime_rewards_sol" BIGINT NOT NULL DEFAULT 0,
    "lifetime_deployed" BIGINT NOT NULL DEFAULT 0,
    "rounds_played" INTEGER NOT NULL DEFAULT 0,
    "rounds_won" INTEGER NOT NULL DEFAULT 0,
    "last_active" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "miners_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" SERIAL NOT NULL,
    "round_id" INTEGER NOT NULL,
    "wallet" TEXT NOT NULL,
    "squares" JSONB NOT NULL,
    "amount" BIGINT NOT NULL,
    "tx_hash" TEXT,
    "slot" BIGINT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_participants" (
    "round_id" INTEGER NOT NULL,
    "wallet" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_participants_pkey" PRIMARY KEY ("round_id","wallet")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" SERIAL NOT NULL,
    "round_id" INTEGER NOT NULL,
    "wallet" TEXT NOT NULL,
    "sol_amount" BIGINT NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMP(3),
    "claim_tx_hash" TEXT,
    "is_motherlode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "username" TEXT,
    "content" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "avatar_url_snapshot" TEXT,
    "auth_session_id" TEXT,
    "auth_proof_type" TEXT,
    "room" TEXT NOT NULL DEFAULT 'general',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reply_to_id" TEXT,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "reactor_wallet" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "wallet" TEXT NOT NULL,
    "username" TEXT,
    "username_normalized" TEXT,
    "bio" TEXT,
    "x_handle" TEXT,
    "telegram_handle" TEXT,
    "discord_handle" TEXT,
    "website" TEXT,
    "avatar_url" TEXT,
    "banner_url" TEXT,
    "username_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "wallet" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("wallet","action_type")
);

-- CreateTable
CREATE TABLE "wallet_challenges" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_token_hash" TEXT,
    "refresh_expires_at" TIMESTAMP(3),
    "family_id" TEXT,
    "parent_session_id" TEXT,
    "replaced_by_session_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_leases" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "heartbeat_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_leases_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "failed_transactions" (
    "id" SERIAL NOT NULL,
    "tx_type" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "params" JSONB NOT NULL,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_retry_at" TIMESTAMP(3),

    CONSTRAINT "failed_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexer_cursors" (
    "key" TEXT NOT NULL,
    "slot" BIGINT NOT NULL DEFAULT 0,
    "signature" TEXT,
    "metadata" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_cursors_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rounds_status_idx" ON "rounds"("status");

-- CreateIndex
CREATE INDEX "rounds_started_at_idx" ON "rounds"("started_at");

-- CreateIndex
CREATE INDEX "rounds_ended_at_idx" ON "rounds"("ended_at");

-- CreateIndex
CREATE INDEX "miners_lifetime_rewards_sol_idx" ON "miners"("lifetime_rewards_sol" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "deployments_tx_hash_key" ON "deployments"("tx_hash");

-- CreateIndex
CREATE INDEX "deployments_round_id_idx" ON "deployments"("round_id");

-- CreateIndex
CREATE INDEX "deployments_wallet_idx" ON "deployments"("wallet");

-- CreateIndex
CREATE INDEX "deployments_created_at_idx" ON "deployments"("created_at");

-- CreateIndex
CREATE INDEX "round_participants_wallet_idx" ON "round_participants"("wallet");

-- CreateIndex
CREATE INDEX "rewards_wallet_idx" ON "rewards"("wallet");

-- CreateIndex
CREATE INDEX "rewards_round_id_idx" ON "rewards"("round_id");

-- CreateIndex
CREATE INDEX "rewards_claimed_at_idx" ON "rewards"("claimed_at");

-- CreateIndex
CREATE INDEX "rewards_wallet_claimed_at_idx" ON "rewards"("wallet", "claimed_at");

-- CreateIndex
CREATE UNIQUE INDEX "rewards_round_id_wallet_key" ON "rewards"("round_id", "wallet");

-- CreateIndex
CREATE INDEX "chat_messages_room_idx" ON "chat_messages"("room");

-- CreateIndex
CREATE INDEX "chat_messages_room_created_at_idx" ON "chat_messages"("room", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_sender_idx" ON "chat_messages"("sender");

-- CreateIndex
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages"("created_at");

-- CreateIndex
CREATE INDEX "chat_messages_auth_session_id_idx" ON "chat_messages"("auth_session_id");

-- CreateIndex
CREATE INDEX "chat_reactions_message_id_idx" ON "chat_reactions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_reactions_msg_emoji_wallet_key" ON "chat_reactions"("message_id", "emoji", "reactor_wallet");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_username_key" ON "user_profiles"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_username_normalized_key" ON "user_profiles"("username_normalized");

-- CreateIndex
CREATE INDEX "user_profiles_updated_at_idx" ON "user_profiles"("updated_at");

-- CreateIndex
CREATE INDEX "wallet_challenges_wallet_idx" ON "wallet_challenges"("wallet");

-- CreateIndex
CREATE INDEX "wallet_challenges_expires_at_idx" ON "wallet_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "wallet_challenges_consumed_at_idx" ON "wallet_challenges"("consumed_at");

-- CreateIndex
CREATE INDEX "auth_sessions_wallet_idx" ON "auth_sessions"("wallet");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_refresh_expires_at_idx" ON "auth_sessions"("refresh_expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");

-- CreateIndex
CREATE INDEX "auth_sessions_revoked_at_idx" ON "auth_sessions"("revoked_at");

-- CreateIndex
CREATE INDEX "job_leases_expires_at_idx" ON "job_leases"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "failed_transactions_idempotency_key" ON "failed_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "failed_transactions_status_idx" ON "failed_transactions"("status");

-- CreateIndex
CREATE INDEX "failed_transactions_created_at_idx" ON "failed_transactions"("created_at");

-- AddForeignKey
ALTER TABLE "round_blocks" ADD CONSTRAINT "round_blocks_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "miners"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "miners"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "miners"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_fkey" FOREIGN KEY ("sender") REFERENCES "miners"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

