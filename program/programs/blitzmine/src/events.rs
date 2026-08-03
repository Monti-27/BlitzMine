use anchor_lang::prelude::*;

#[event]
pub struct MinerFundedEvent {
    pub authority: Pubkey,
    pub amount: u64,
    pub balance: u64,
    pub ts: i64,
}

#[event]
pub struct DeployEvent {
    pub authority: Pubkey,
    pub amount: u64,
    pub mask: u64,
    pub round_id: u64,
    pub signer: Pubkey,
    pub total_squares: u64,
    pub nonce: u64,
    pub ts: i64,
}

#[event]
pub struct RandomnessRequestedEvent {
    pub round_id: u64,
    pub request_nonce: u64,
    pub requested_at: i64,
}

#[event]
pub struct RoundCanceledEvent {
    pub round_id: u64,
    pub request_nonce: u64,
    pub ts: i64,
}

#[event]
pub struct CheckpointEvent {
    pub authority: Pubkey,
    pub caller: Pubkey,
    pub round_id: u64,
    pub amount: u64,
    pub fee: u64,
    pub balance: u64,
    pub expired: bool,
    pub ts: i64,
}

#[event]
pub struct ClaimEvent {
    pub authority: Pubkey,
    pub amount: u64,
    pub ts: i64,
}

#[event]
pub struct AdminFeesClaimedEvent {
    pub fee_collector: Pubkey,
    pub amount: u64,
    pub ts: i64,
}

#[event]
pub struct FulfillRoundEvent {
    pub round_id: u64,
    pub winning_square: u64,
    pub total_winnings: u64,
    pub did_hit_motherlode: bool,
    pub rng: u64,
    pub ts: i64,
}
