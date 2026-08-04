use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::events::CheckpointEvent;
use crate::instructions::reset::calculate_settlement;
use crate::state::*;

pub fn handle_checkpoint(ctx: Context<Checkpoint>, miner_authority: Pubkey) -> Result<()> {
    let clock = Clock::get()?;
    let miner = &mut ctx.accounts.miner;
    let round = &mut ctx.accounts.round;

    let is_owner = miner.authority == ctx.accounts.caller.key();
    let bot_window_open = round.expires_at > 0
        && clock.unix_timestamp
            >= round
                .expires_at
                .saturating_sub(BOT_CHECKPOINT_WINDOW_SECONDS);
    require!(is_owner || bot_window_open, BlitzmineError::NotAuthorized);
    require_keys_eq!(
        miner.authority,
        miner_authority,
        BlitzmineError::NotAuthorized
    );
    require!(
        round.id < ctx.accounts.board.round_id,
        BlitzmineError::RoundNotExpired
    );
    require!(round.id == miner.round_id, BlitzmineError::RoundNotExpired);
    require!(round.resolved, BlitzmineError::RandomnessNotRequested);
    require!(
        miner.checkpoint_id != round.id,
        BlitzmineError::CheckpointRequired
    );

    let expired = clock.unix_timestamp >= round.expires_at;
    let rewards = if expired {
        0
    } else if round.canceled {
        miner.deployed.iter().try_fold(0u64, |total, amount| {
            total.checked_add(*amount).ok_or(BlitzmineError::Overflow)
        })?
    } else {
        calculate_rewards(miner, round)?
    };

    if rewards > 0 {
        require!(
            round.to_account_info().lamports() >= rewards,
            BlitzmineError::InsufficientBalance
        );
        **round.to_account_info().try_borrow_mut_lamports()? -= rewards;
        **miner.to_account_info().try_borrow_mut_lamports()? += rewards;
    }

    miner.checkpoint_id = round.id;
    miner.rewards_sol = miner
        .rewards_sol
        .checked_add(rewards)
        .ok_or(BlitzmineError::Overflow)?;
    miner.lifetime_rewards_sol = miner
        .lifetime_rewards_sol
        .checked_add(rewards)
        .ok_or(BlitzmineError::Overflow)?;

    let fee = if is_owner { 0 } else { miner.checkpoint_fee };
    if fee > 0 {
        require!(
            miner.to_account_info().lamports() >= fee,
            BlitzmineError::InsufficientBalance
        );
        **miner.to_account_info().try_borrow_mut_lamports()? -= fee;
        **ctx
            .accounts
            .caller
            .to_account_info()
            .try_borrow_mut_lamports()? += fee;
        miner.checkpoint_fee = 0;
    }

    emit!(CheckpointEvent {
        authority: miner.authority,
        caller: ctx.accounts.caller.key(),
        round_id: round.id,
        amount: rewards,
        fee,
        balance: miner.rewards_sol,
        expired,
        ts: clock.unix_timestamp,
    });

    Ok(())
}

fn calculate_rewards(miner: &Account<Miner>, round: &Account<Round>) -> Result<u64> {
    let rng = round.rng();
    let winning_square = round.winning_square(rng);
    let miner_deployed = miner.deployed[winning_square];
    if miner_deployed == 0 {
        return Ok(0);
    }

    let winning_deployed = round.deployed[winning_square];
    require!(
        winning_deployed > 0 && round.total_deployed > 0,
        BlitzmineError::InvalidVrfAccount
    );

    let settlement = calculate_settlement(round.total_deployed, winning_deployed);
    let principal = ((settlement.principal as u128) * (miner_deployed as u128)
        / (winning_deployed as u128)) as u64;
    let winnings = ((settlement.winnings as u128) * (miner_deployed as u128)
        / (winning_deployed as u128)) as u64;
    let motherlode =
        ((round.motherlode as u128) * (miner_deployed as u128) / (winning_deployed as u128)) as u64;

    principal
        .checked_add(winnings)
        .and_then(|amount| amount.checked_add(motherlode))
        .ok_or(BlitzmineError::Overflow.into())
}

#[derive(Accounts)]
#[instruction(miner_authority: Pubkey)]
pub struct Checkpoint<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [SEED_BOARD], bump = board.bump)]
    pub board: Account<'info, Board>,
    #[account(mut, seeds = [SEED_MINER, miner_authority.as_ref()], bump = miner.bump)]
    pub miner: Account<'info, Miner>,
    #[account(mut, seeds = [SEED_ROUND, &miner.round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
}
