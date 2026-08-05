use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::state::*;

/// Close an expired round account and return rent to the original payer.
/// Any unclaimed SOL remaining in the round rolls into the motherlode pool.
pub fn handle_close(ctx: Context<Close>) -> Result<()> {
    let clock = Clock::get()?;
    let board = &ctx.accounts.board;
    let round = &ctx.accounts.round;
    let treasury = &mut ctx.accounts.treasury;

    // Round must be older than the current round
    require!(round.id < board.round_id, BlitzmineError::RoundNotExpired);

    // Round must have expired
    require!(clock.slot >= round.expires_at, BlitzmineError::RoundNotExpired);

    // Rent payer must match
    require!(
        round.rent_payer == ctx.accounts.rent_payer.key(),
        BlitzmineError::NotAuthorized
    );

    // Roll any unclaimed SOL into the motherlode pool
    let round_info = ctx.accounts.round.to_account_info();
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(Round::SIZE);
    let unclaimed_sol = round_info.lamports().saturating_sub(min_rent);

    if unclaimed_sol > 0 {
        let treasury_info = treasury.to_account_info();
        **round_info.try_borrow_mut_lamports()? -= unclaimed_sol;
        **treasury_info.try_borrow_mut_lamports()? += unclaimed_sol;
        treasury.motherlode = treasury.motherlode
            .checked_add(unclaimed_sol)
            .ok_or(BlitzmineError::Overflow)?;
        treasury.total_vaulted = treasury.total_vaulted
            .checked_add(unclaimed_sol)
            .ok_or(BlitzmineError::Overflow)?;
    }

    // Close the round account and return rent to rent_payer
    let dest_info = ctx.accounts.rent_payer.to_account_info();
    let remaining = round_info.lamports();
    **round_info.try_borrow_mut_lamports()? = 0;
    **dest_info.try_borrow_mut_lamports()? += remaining;

    // Zero out the account data to mark it as closed
    let mut data = round_info.try_borrow_mut_data()?;
    data.fill(0);

    Ok(())
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [SEED_BOARD],
        bump = board.bump,
    )]
    pub board: Account<'info, Board>,

    #[account(
        mut,
        seeds = [SEED_ROUND, &round.id.to_le_bytes()],
        bump = round.bump,
    )]
    pub round: Account<'info, Round>,

    /// CHECK: Validated against round.rent_payer
    #[account(mut)]
    pub rent_payer: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}
