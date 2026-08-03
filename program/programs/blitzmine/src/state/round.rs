use anchor_lang::prelude::*;
use solana_keccak_hasher::hashv;

use crate::constants::{MOTHERLODE_ODDS, NUM_SQUARES};

#[account]
#[derive(Default)]
pub struct Round {
    pub id: u64,
    pub deployed: [u64; NUM_SQUARES],
    pub randomness: [u8; 32],
    pub count: [u64; NUM_SQUARES],
    pub expires_at: i64,
    pub motherlode: u64,
    pub rent_payer: Pubkey,
    pub total_deployed: u64,
    pub total_miners: u64,
    pub total_vaulted: u64,
    pub total_winnings: u64,
    pub request_nonce: u64,
    pub resolved: bool,
    pub canceled: bool,
    pub bump: u8,
}

impl Round {
    pub const SIZE: usize = 8
        + 8
        + (8 * NUM_SQUARES)
        + 32
        + (8 * NUM_SQUARES)
        + 8
        + 8
        + 32
        + 8
        + 8
        + 8
        + 8
        + 8
        + 1
        + 1
        + 1;

    pub fn rng(&self) -> u64 {
        let round_id = self.id.to_le_bytes();
        let draw = hashv(&[self.randomness.as_ref(), b"winner", round_id.as_ref()]);
        Self::sample(draw.to_bytes(), NUM_SQUARES as u64)
    }

    pub fn winning_square(&self, rng: u64) -> usize {
        rng as usize
    }

    pub fn did_hit_motherlode(&self) -> bool {
        let round_id = self.id.to_le_bytes();
        let draw = hashv(&[self.randomness.as_ref(), b"motherlode", round_id.as_ref()]);
        Self::sample(draw.to_bytes(), MOTHERLODE_ODDS) == 0
    }

    fn sample(mut bytes: [u8; 32], upper: u64) -> u64 {
        let limit = u64::MAX - (u64::MAX % upper);
        loop {
            for chunk in bytes.chunks_exact(8) {
                let value = u64::from_le_bytes(chunk.try_into().unwrap());
                if value < limit {
                    return value % upper;
                }
            }
            bytes = hashv(&[bytes.as_ref()]).to_bytes();
        }
    }
}
