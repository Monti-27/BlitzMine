use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::events::{AdminFeesClaimedEvent, ClaimEvent};
use crate::state::*;

pub fn handler_claim_sol(ctx: Context<ClaimSol>) -> Result<()> {
    let clock = Clock::get()?;
    let miner = &mut ctx.accounts.miner;

    require!(
        miner.checkpoint_id == miner.round_id,
        BlitzmineError::MinerNotSettled
    );
    require!(miner.rewards_sol > 0, BlitzmineError::AmountTooSmall);

    let rent = Rent::get()?.minimum_balance(Miner::SIZE);
    let retained = rent
        .checked_add(miner.checkpoint_fee)
        .ok_or(BlitzmineError::Overflow)?;
    require!(
        miner.to_account_info().lamports() >= retained,
        BlitzmineError::InsufficientBalance
    );

    let available = miner.to_account_info().lamports().saturating_sub(retained);
    let amount = miner.rewards_sol.min(available);
    require!(amount > 0, BlitzmineError::InsufficientBalance);

    miner.rewards_sol = miner.rewards_sol.saturating_sub(amount);
    miner.last_claim_sol_at = clock.unix_timestamp;

    **miner.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx
        .accounts
        .authority
        .to_account_info()
        .try_borrow_mut_lamports()? += amount;

    emit!(ClaimEvent {
        authority: miner.authority,
        amount,
        ts: clock.unix_timestamp,
    });

    Ok(())
}

pub fn handle_claim_admin_fees(ctx: Context<ClaimAdminFees>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.fee_collector.key(),
        ADMIN_FEE_COLLECTOR,
        BlitzmineError::NotAuthorized
    );

    let treasury = &mut ctx.accounts.treasury;
    let amount = treasury.admin_fees;
    require!(amount > 0, BlitzmineError::AmountTooSmall);
    let retained = Rent::get()?
        .minimum_balance(Treasury::SIZE)
        .checked_add(treasury.motherlode)
        .ok_or(BlitzmineError::Overflow)?;
    require!(
        treasury.to_account_info().lamports() >= retained.saturating_add(amount),
        BlitzmineError::InsufficientBalance
    );

    treasury.admin_fees = 0;
    **treasury.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx
        .accounts
        .fee_collector
        .to_account_info()
        .try_borrow_mut_lamports()? += amount;

    emit!(AdminFeesClaimedEvent {
        fee_collector: ctx.accounts.fee_collector.key(),
        amount,
        ts: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimSol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_MINER, authority.key().as_ref()],
        bump = miner.bump,
        constraint = miner.authority == authority.key() @ BlitzmineError::NotAuthorized
    )]
    pub miner: Account<'info, Miner>,
}

#[derive(Accounts)]
pub struct ClaimAdminFees<'info> {
    #[account(mut)]
    pub fee_collector: Signer<'info>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,
}
