use anchor_lang::prelude::*;

use crate::constants::NUM_SQUARES;

#[account]
#[derive(Default)]
pub struct Miner {
    pub authority: Pubkey,
    pub deployed: [u64; NUM_SQUARES],
    pub checkpoint_fee: u64,
    pub checkpoint_id: u64,
    pub last_claim_sol_at: i64,
    pub rewards_sol: u64,
    pub round_id: u64,
    pub lifetime_rewards_sol: u64,
    pub lifetime_deployed: u64,
    pub transaction_nonce: u64,
    pub bump: u8,
}

impl Miner {
    pub const SIZE: usize = 8 + 32 + (8 * NUM_SQUARES) + (8 * 8) + 1;
}
