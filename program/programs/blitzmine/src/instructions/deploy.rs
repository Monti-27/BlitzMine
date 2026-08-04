use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::events::DeployEvent;
use crate::state::*;

pub fn handle_deploy(
    ctx: Context<Deploy>,
    amount: u64,
    mask: u64,
    expected_nonce: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let board = &mut ctx.accounts.board;
    let round = &mut ctx.accounts.round;
    let miner = &mut ctx.accounts.miner;

    require!(amount > 0, BlitzmineError::AmountTooSmall);
    require!(
        mask != 0 && mask & !VALID_SQUARE_MASK == 0,
        BlitzmineError::InvalidMask
    );
    require!(
        !round.resolved && !round.canceled,
        BlitzmineError::RoundAlreadyResolved
    );
    require!(
        !board.vrf_requested,
        BlitzmineError::RandomnessAlreadyRequested
    );
    require!(
        clock.unix_timestamp >= board.intermission_end_ts,
        BlitzmineError::RoundNotActive
    );
    require!(
        expected_nonce == miner.transaction_nonce,
        BlitzmineError::InvalidNonce
    );
    require_keys_eq!(
        miner.authority,
        ctx.accounts.signer.key(),
        BlitzmineError::NotAuthorized
    );

    if board.end_ts == i64::MAX {
        board.start_ts = clock.unix_timestamp;
        board.end_ts = clock
            .unix_timestamp
            .checked_add(ROUND_DURATION_SECONDS)
            .ok_or(BlitzmineError::Overflow)?;
    }

    require!(
        clock.unix_timestamp >= board.start_ts && clock.unix_timestamp < board.end_ts,
        BlitzmineError::RoundNotActive
    );

    let is_new_round = miner.round_id != round.id;
    if is_new_round {
        require!(
            miner.checkpoint_id == miner.round_id,
            BlitzmineError::CheckpointRequired
        );
        if miner.checkpoint_fee == 0 {
            require!(
                miner.rewards_sol >= CHECKPOINT_FEE,
                BlitzmineError::InsufficientBalance
            );
            miner.rewards_sol -= CHECKPOINT_FEE;
            miner.checkpoint_fee = CHECKPOINT_FEE;
        }
        miner.deployed = [0; NUM_SQUARES];
        miner.round_id = round.id;
        round.total_miners = round
            .total_miners
            .checked_add(1)
            .ok_or(BlitzmineError::Overflow)?;
    }

    let mut selected = 0u64;
    for i in 0..NUM_SQUARES {
        if mask & (1u64 << i) != 0 && miner.deployed[i] == 0 {
            selected = selected.checked_add(1).ok_or(BlitzmineError::Overflow)?;
        }
    }
    require!(selected > 0, BlitzmineError::AmountTooSmall);

    let total_cost = amount
        .checked_mul(selected)
        .ok_or(BlitzmineError::Overflow)?;
    require!(
        miner.rewards_sol >= total_cost,
        BlitzmineError::InsufficientBalance
    );
    let retained = Rent::get()?
        .minimum_balance(Miner::SIZE)
        .checked_add(miner.checkpoint_fee)
        .ok_or(BlitzmineError::Overflow)?;
    require!(
        miner.to_account_info().lamports() >= retained.saturating_add(total_cost),
        BlitzmineError::InsufficientBalance
    );

    for i in 0..NUM_SQUARES {
        if mask & (1u64 << i) != 0 && miner.deployed[i] == 0 {
            miner.deployed[i] = amount;
            round.deployed[i] = round.deployed[i]
                .checked_add(amount)
                .ok_or(BlitzmineError::Overflow)?;
            round.count[i] = round.count[i]
                .checked_add(1)
                .ok_or(BlitzmineError::Overflow)?;
        }
    }

    miner.rewards_sol -= total_cost;
    miner.lifetime_deployed = miner
        .lifetime_deployed
        .checked_add(total_cost)
        .ok_or(BlitzmineError::Overflow)?;
    miner.transaction_nonce = miner
        .transaction_nonce
        .checked_add(1)
        .ok_or(BlitzmineError::Overflow)?;
    round.total_deployed = round
        .total_deployed
        .checked_add(total_cost)
        .ok_or(BlitzmineError::Overflow)?;

    let miner_info = miner.to_account_info();
    let round_info = round.to_account_info();
    **miner_info.try_borrow_mut_lamports()? -= total_cost;
    **round_info.try_borrow_mut_lamports()? += total_cost;

    emit!(DeployEvent {
        authority: miner.authority,
        amount,
        mask,
        round_id: round.id,
        signer: ctx.accounts.signer.key(),
        total_squares: selected,
        nonce: expected_nonce,
        ts: clock.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Deploy<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [SEED_BOARD], bump = board.bump)]
    pub board: Account<'info, Board>,
    #[account(mut, seeds = [SEED_ROUND, &board.round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [SEED_MINER, signer.key().as_ref()], bump = miner.bump)]
    pub miner: Account<'info, Miner>,
}
