use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::{
    anchor::{vrf, vrf_callback},
    vrf::{
        self,
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};
use solana_keccak_hasher::hashv;

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::events::{FulfillRoundEvent, RandomnessRequestedEvent, RoundCanceledEvent};
use crate::state::*;

pub fn handle_request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
    let clock = Clock::get()?;
    let board_key = ctx.accounts.board.key();
    let current_round_key = ctx.accounts.current_round.key();
    let next_round_key = ctx.accounts.next_round.key();
    let treasury_key = ctx.accounts.treasury.key();
    let (round_id, request_nonce, end_ts, total_deployed) = {
        let board = &mut ctx.accounts.board;
        let round = &mut ctx.accounts.current_round;

        require!(board.end_ts != i64::MAX, BlitzmineError::RoundNotActive);
        require!(
            clock.unix_timestamp >= board.end_ts,
            BlitzmineError::RoundNotExpired
        );
        require!(
            !board.vrf_requested,
            BlitzmineError::RandomnessAlreadyRequested
        );
        require!(
            !round.resolved && !round.canceled,
            BlitzmineError::RoundAlreadyResolved
        );
        require!(
            ctx.accounts.next_round.id == board.round_id + 1,
            BlitzmineError::RoundNotPrepared
        );

        board.request_nonce = board
            .request_nonce
            .checked_add(1)
            .ok_or(BlitzmineError::Overflow)?;
        board.vrf_requested = true;
        board.vrf_fulfilled = false;
        board.vrf_requested_at = clock.unix_timestamp;
        round.request_nonce = board.request_nonce;

        (
            round.id,
            board.request_nonce,
            board.end_ts,
            round.total_deployed,
        )
    };

    let caller_seed = hashv(&[
        crate::ID.as_ref(),
        board_key.as_ref(),
        &round_id.to_le_bytes(),
        &end_ts.to_le_bytes(),
        &total_deployed.to_le_bytes(),
    ])
    .to_bytes();

    let mut callback_args = Vec::with_capacity(16);
    callback_args.extend_from_slice(&round_id.to_le_bytes());
    callback_args.extend_from_slice(&request_nonce.to_le_bytes());

    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackResolveRound::DISCRIMINATOR.to_vec(),
        caller_seed,
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: board_key,
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: current_round_key,
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: next_round_key,
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: treasury_key,
                is_signer: false,
                is_writable: true,
            },
        ]),
        callback_args: Some(callback_args),
        ..Default::default()
    });

    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

    emit!(RandomnessRequestedEvent {
        round_id,
        request_nonce,
        requested_at: clock.unix_timestamp,
    });

    Ok(())
}

pub fn handle_callback_resolve_round(
    ctx: Context<CallbackResolveRound>,
    randomness: [u8; 32],
    round_id: u64,
    request_nonce: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let board = &mut ctx.accounts.board;
    let round = &mut ctx.accounts.current_round;
    let treasury = &mut ctx.accounts.treasury;

    require!(
        board.round_id == round_id,
        BlitzmineError::InvalidVrfAccount
    );
    require!(board.vrf_requested, BlitzmineError::RandomnessNotRequested);
    require!(!board.vrf_fulfilled, BlitzmineError::RoundAlreadyResolved);
    require!(
        board.request_nonce == request_nonce,
        BlitzmineError::InvalidNonce
    );
    require!(
        round.request_nonce == request_nonce,
        BlitzmineError::InvalidNonce
    );
    require!(
        !round.resolved && !round.canceled,
        BlitzmineError::RoundAlreadyResolved
    );
    require!(
        ctx.accounts.next_round.id == round_id + 1,
        BlitzmineError::RoundNotPrepared
    );

    round.randomness = randomness;
    round.resolved = true;
    round.expires_at = clock
        .unix_timestamp
        .checked_add(CLAIM_WINDOW_SECONDS)
        .ok_or(BlitzmineError::Overflow)?;

    let rng = round.rng();
    let winning_square = round.winning_square(rng);
    let did_hit_motherlode = settle_round(round, treasury, winning_square)?;

    let round_info = round.to_account_info();
    let treasury_info = treasury.to_account_info();
    let to_treasury = treasury
        .admin_fees
        .checked_add(treasury.motherlode)
        .ok_or(BlitzmineError::Overflow)?;
    let treasury_rent = Rent::get()?.minimum_balance(Treasury::SIZE);
    let expected_treasury_lamports = treasury_rent
        .checked_add(to_treasury)
        .ok_or(BlitzmineError::Overflow)?;
    let current_treasury_lamports = treasury_info.lamports();

    if current_treasury_lamports < expected_treasury_lamports {
        let amount = expected_treasury_lamports - current_treasury_lamports;
        require!(
            round_info.lamports() >= amount,
            BlitzmineError::InsufficientBalance
        );
        **round_info.try_borrow_mut_lamports()? -= amount;
        **treasury_info.try_borrow_mut_lamports()? += amount;
    } else if current_treasury_lamports > expected_treasury_lamports {
        let amount = current_treasury_lamports - expected_treasury_lamports;
        **treasury_info.try_borrow_mut_lamports()? -= amount;
        **round_info.try_borrow_mut_lamports()? += amount;
    }

    board.vrf_fulfilled = true;
    advance_board(board, clock.unix_timestamp)?;

    emit!(FulfillRoundEvent {
        round_id,
        winning_square: winning_square as u64,
        total_winnings: round.total_winnings,
        did_hit_motherlode,
        rng,
        ts: clock.unix_timestamp,
    });

    Ok(())
}

pub fn handle_cancel_round(ctx: Context<CancelRound>) -> Result<()> {
    let clock = Clock::get()?;
    let board = &mut ctx.accounts.board;
    let round = &mut ctx.accounts.current_round;

    require!(board.vrf_requested, BlitzmineError::RandomnessNotRequested);
    require!(!board.vrf_fulfilled, BlitzmineError::RoundAlreadyResolved);
    require!(
        !round.resolved && !round.canceled,
        BlitzmineError::RoundAlreadyResolved
    );
    require!(
        clock.unix_timestamp >= board.vrf_requested_at.saturating_add(VRF_TIMEOUT_SECONDS),
        BlitzmineError::RandomnessNotTimedOut
    );
    require!(
        ctx.accounts.next_round.id == board.round_id + 1,
        BlitzmineError::RoundNotPrepared
    );

    round.canceled = true;
    round.resolved = true;
    round.expires_at = clock
        .unix_timestamp
        .checked_add(CLAIM_WINDOW_SECONDS)
        .ok_or(BlitzmineError::Overflow)?;

    let round_id = round.id;
    let request_nonce = round.request_nonce;
    advance_board(board, clock.unix_timestamp)?;

    emit!(RoundCanceledEvent {
        round_id,
        request_nonce,
        ts: clock.unix_timestamp,
    });

    Ok(())
}

fn settle_round(
    round: &mut Account<Round>,
    treasury: &mut Account<Treasury>,
    winner: usize,
) -> Result<bool> {
    let total = round.total_deployed;
    let winning_deployed = round.deployed[winner];
    let settlement = calculate_settlement(total, winning_deployed);

    if winning_deployed == 0 {
        round.total_vaulted = settlement.vaulted;
        round.total_winnings = settlement.winnings;
        treasury.admin_fees = treasury
            .admin_fees
            .checked_add(settlement.admin_fee)
            .ok_or(BlitzmineError::Overflow)?;
        treasury.motherlode = treasury
            .motherlode
            .checked_add(settlement.vaulted)
            .ok_or(BlitzmineError::Overflow)?;
        treasury.total_vaulted = treasury
            .total_vaulted
            .checked_add(settlement.vaulted)
            .ok_or(BlitzmineError::Overflow)?;
        return Ok(false);
    }

    round.total_winnings = settlement.winnings;
    round.total_vaulted = settlement.vaulted;
    treasury.admin_fees = treasury
        .admin_fees
        .checked_add(settlement.admin_fee)
        .ok_or(BlitzmineError::Overflow)?;
    treasury.motherlode = treasury
        .motherlode
        .checked_add(settlement.vaulted)
        .ok_or(BlitzmineError::Overflow)?;
    treasury.total_vaulted = treasury
        .total_vaulted
        .checked_add(settlement.vaulted)
        .ok_or(BlitzmineError::Overflow)?;

    let did_hit = round.did_hit_motherlode();
    if did_hit {
        round.motherlode = treasury.motherlode;
        treasury.motherlode = 0;
    }

    Ok(did_hit)
}

pub(crate) struct SettlementAmounts {
    pub(crate) admin_fee: u64,
    pub(crate) principal: u64,
    pub(crate) winnings: u64,
    pub(crate) vaulted: u64,
}

pub(crate) fn calculate_settlement(total: u64, winning_deployed: u64) -> SettlementAmounts {
    let admin_fee = ((total as u128) * (ADMIN_FEE as u128) / (DENOMINATOR_BPS as u128)) as u64;
    if winning_deployed == 0 {
        return SettlementAmounts {
            admin_fee,
            principal: 0,
            winnings: 0,
            vaulted: total.saturating_sub(admin_fee),
        };
    }

    let losing_deployed = total.saturating_sub(winning_deployed);
    let admin_from_winning =
        ((admin_fee as u128) * (winning_deployed as u128) / (total as u128)) as u64;
    let admin_from_losing = admin_fee.saturating_sub(admin_from_winning);
    let winnings_pool = losing_deployed.saturating_sub(admin_from_losing);
    let vaulted =
        ((winnings_pool as u128) * (MOTHERLODE_FEE as u128) / (DENOMINATOR_BPS as u128)) as u64;

    SettlementAmounts {
        admin_fee,
        principal: winning_deployed.saturating_sub(admin_from_winning),
        winnings: winnings_pool.saturating_sub(vaulted),
        vaulted,
    }
}

fn advance_board(board: &mut Account<Board>, now: i64) -> Result<()> {
    board.round_id = board
        .round_id
        .checked_add(1)
        .ok_or(BlitzmineError::Overflow)?;
    board.epoch_id = board
        .epoch_id
        .checked_add(1)
        .ok_or(BlitzmineError::Overflow)?;
    board.start_ts = 0;
    board.end_ts = i64::MAX;
    board.intermission_end_ts = now
        .checked_add(INTERMISSION_SECONDS)
        .ok_or(BlitzmineError::Overflow)?;
    board.vrf_requested_at = 0;
    board.vrf_requested = false;
    board.vrf_fulfilled = false;
    Ok(())
}

#[vrf]
#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [SEED_BOARD], bump = board.bump)]
    pub board: Account<'info, Board>,
    #[account(mut, seeds = [SEED_ROUND, &board.round_id.to_le_bytes()], bump = current_round.bump)]
    pub current_round: Account<'info, Round>,
    #[account(seeds = [SEED_ROUND, &(board.round_id + 1).to_le_bytes()], bump = next_round.bump)]
    pub next_round: Account<'info, Round>,
    #[account(seeds = [SEED_TREASURY], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
#[instruction(randomness: [u8; 32], round_id: u64, request_nonce: u64)]
pub struct CallbackResolveRound<'info> {
    #[account(mut, seeds = [SEED_BOARD], bump = board.bump)]
    pub board: Account<'info, Board>,
    #[account(mut, seeds = [SEED_ROUND, &round_id.to_le_bytes()], bump = current_round.bump)]
    pub current_round: Account<'info, Round>,
    #[account(mut, seeds = [SEED_ROUND, &(round_id + 1).to_le_bytes()], bump = next_round.bump)]
    pub next_round: Account<'info, Round>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,
}

#[derive(Accounts)]
pub struct CancelRound<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [SEED_BOARD], bump = board.bump)]
    pub board: Account<'info, Board>,
    #[account(mut, seeds = [SEED_ROUND, &board.round_id.to_le_bytes()], bump = current_round.bump)]
    pub current_round: Account<'info, Round>,
    #[account(seeds = [SEED_ROUND, &(board.round_id + 1).to_le_bytes()], bump = next_round.bump)]
    pub next_round: Account<'info, Round>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settlement_conserves_every_lamport() {
        for total in 0..10_000u64 {
            let empty = calculate_settlement(total, 0);
            assert_eq!(empty.admin_fee + empty.vaulted, total);

            if total > 0 {
                for winning in [1, total / 2 + 1, total] {
                    let settlement = calculate_settlement(total, winning.min(total));
                    assert_eq!(
                        settlement.admin_fee
                            + settlement.principal
                            + settlement.winnings
                            + settlement.vaulted,
                        total
                    );
                }
            }
        }
    }
}
