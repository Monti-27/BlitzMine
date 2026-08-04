use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::events::MinerFundedEvent;
use crate::state::*;

pub fn handle_fund_miner(ctx: Context<FundMiner>, amount: u64) -> Result<()> {
    require!(amount > 0, BlitzmineError::AmountTooSmall);

    let miner = &mut ctx.accounts.miner;
    if miner.authority == Pubkey::default() {
        miner.authority = ctx.accounts.authority.key();
        miner.deployed = [0; NUM_SQUARES];
        miner.checkpoint_id = u64::MAX;
        miner.round_id = u64::MAX;
        miner.last_claim_sol_at = 0;
        miner.rewards_sol = 0;
        miner.lifetime_rewards_sol = 0;
        miner.lifetime_deployed = 0;
        miner.transaction_nonce = 0;
        miner.bump = ctx.bumps.miner;
    }

    require_keys_eq!(
        miner.authority,
        ctx.accounts.authority.key(),
        BlitzmineError::NotAuthorized
    );

    let checkpoint_top_up = CHECKPOINT_FEE.saturating_sub(miner.checkpoint_fee);
    let transfer_amount = amount
        .checked_add(checkpoint_top_up)
        .ok_or(BlitzmineError::Overflow)?;

    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: miner.to_account_info(),
            },
        ),
        transfer_amount,
    )?;

    miner.rewards_sol = miner
        .rewards_sol
        .checked_add(amount)
        .ok_or(BlitzmineError::Overflow)?;
    miner.checkpoint_fee = miner
        .checkpoint_fee
        .checked_add(checkpoint_top_up)
        .ok_or(BlitzmineError::Overflow)?;

    emit!(MinerFundedEvent {
        authority: miner.authority,
        amount,
        balance: miner.rewards_sol,
        ts: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct FundMiner<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = Miner::SIZE,
        seeds = [SEED_MINER, authority.key().as_ref()],
        bump
    )]
    pub miner: Account<'info, Miner>,
    pub system_program: Program<'info, System>,
}
