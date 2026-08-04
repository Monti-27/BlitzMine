use anchor_lang::prelude::*;

use crate::constants::*;
use crate::instructions::initialize::initialize_round;
use crate::state::*;

pub fn handle_prepare_round(ctx: Context<PrepareRound>, round_id: u64) -> Result<()> {
    initialize_round(
        &mut ctx.accounts.round,
        round_id,
        ctx.accounts.payer.key(),
        ctx.bumps.round,
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct PrepareRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = Round::SIZE, seeds = [SEED_ROUND, &round_id.to_le_bytes()], bump)]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}
