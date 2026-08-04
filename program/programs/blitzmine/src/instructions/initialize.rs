use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::state::*;

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ADMIN_ADDRESS,
        BlitzmineError::NotAuthorized
    );

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.treasury = ctx.accounts.treasury.key();
    config.fee_collector = ADMIN_FEE_COLLECTOR;
    config.initialized = true;
    config.bump = ctx.bumps.config;

    let board = &mut ctx.accounts.board;
    board.round_id = 0;
    board.start_ts = 0;
    board.end_ts = i64::MAX;
    board.intermission_end_ts = 0;
    board.epoch_id = 0;
    board.vrf_requested_at = 0;
    board.request_nonce = 0;
    board.vrf_requested = false;
    board.vrf_fulfilled = false;
    board.bump = ctx.bumps.board;

    let treasury = &mut ctx.accounts.treasury;
    treasury.motherlode = 0;
    treasury.total_vaulted = 0;
    treasury.admin_fees = 0;
    treasury.bump = ctx.bumps.treasury;

    initialize_round(
        &mut ctx.accounts.round,
        0,
        ctx.accounts.admin.key(),
        ctx.bumps.round,
    );

    Ok(())
}

pub fn initialize_round(round: &mut Account<Round>, id: u64, rent_payer: Pubkey, bump: u8) {
    round.id = id;
    round.deployed = [0; NUM_SQUARES];
    round.randomness = [0; 32];
    round.count = [0; NUM_SQUARES];
    round.expires_at = 0;
    round.motherlode = 0;
    round.rent_payer = rent_payer;
    round.total_deployed = 0;
    round.total_miners = 0;
    round.total_vaulted = 0;
    round.total_winnings = 0;
    round.request_nonce = 0;
    round.resolved = false;
    round.canceled = false;
    round.bump = bump;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SIZE, seeds = [SEED_CONFIG], bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = Board::SIZE, seeds = [SEED_BOARD], bump)]
    pub board: Account<'info, Board>,
    #[account(init, payer = admin, space = Treasury::SIZE, seeds = [SEED_TREASURY], bump)]
    pub treasury: Account<'info, Treasury>,
    #[account(init, payer = admin, space = Round::SIZE, seeds = [SEED_ROUND, &0u64.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}
