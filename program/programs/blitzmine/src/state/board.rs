use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Board {
    pub round_id: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub intermission_end_ts: i64,
    pub epoch_id: u64,
    pub vrf_requested_at: i64,
    pub request_nonce: u64,
    pub vrf_requested: bool,
    pub vrf_fulfilled: bool,
    pub bump: u8,
}

impl Board {
    pub const SIZE: usize = 8 + (8 * 7) + 1 + 1 + 1;
}
