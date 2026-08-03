use anchor_lang::prelude::*;

/// Global program configuration (singleton PDA).
#[account]
#[derive(Default)]
pub struct Config {
    /// Admin authority that can update config.
    pub admin: Pubkey,
    /// Treasury address.
    pub treasury: Pubkey,
    /// Fee collector address (rotatable at runtime).
    pub fee_collector: Pubkey,
    /// Whether the program has been initialized.
    pub initialized: bool,
    /// Bump seed.
    pub bump: u8,
}

impl Config {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 1 + 1;
}
