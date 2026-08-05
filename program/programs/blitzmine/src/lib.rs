use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("CVud2PiM4hYk2YkDa2DZ2dnJwd9gVCXZFJP18DzE1r4F");

#[ephemeral]
#[program]
pub mod blitzmine {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handle_initialize(ctx)
    }

    pub fn prepare_round(ctx: Context<PrepareRound>, round_id: u64) -> Result<()> {
        instructions::prepare::handle_prepare_round(ctx, round_id)
    }

    pub fn fund_miner(ctx: Context<FundMiner>, amount: u64) -> Result<()> {
        instructions::funding::handle_fund_miner(ctx, amount)
    }

    pub fn delegate_board(ctx: Context<DelegateBoard>) -> Result<()> {
        instructions::delegation::handle_delegate_board(ctx)
    }

    pub fn delegate_treasury(ctx: Context<DelegateTreasury>) -> Result<()> {
        instructions::delegation::handle_delegate_treasury(ctx)
    }

    pub fn delegate_round(ctx: Context<DelegateRound>, round_id: u64) -> Result<()> {
        instructions::delegation::handle_delegate_round(ctx, round_id)
    }

    pub fn delegate_miner(ctx: Context<DelegateMiner>) -> Result<()> {
        instructions::delegation::handle_delegate_miner(ctx)
    }

    pub fn deploy(ctx: Context<Deploy>, amount: u64, mask: u64, expected_nonce: u64) -> Result<()> {
        instructions::deploy::handle_deploy(ctx, amount, mask, expected_nonce)
    }

    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        instructions::reset::handle_request_randomness(ctx)
    }

    pub fn callback_resolve_round(
        ctx: Context<CallbackResolveRound>,
        randomness: [u8; 32],
        round_id: u64,
        request_nonce: u64,
    ) -> Result<()> {
        instructions::reset::handle_callback_resolve_round(ctx, randomness, round_id, request_nonce)
    }

    pub fn cancel_round(ctx: Context<CancelRound>) -> Result<()> {
        instructions::reset::handle_cancel_round(ctx)
    }

    pub fn checkpoint(ctx: Context<Checkpoint>, miner_authority: Pubkey) -> Result<()> {
        instructions::checkpoint::handle_checkpoint(ctx, miner_authority)
    }

    pub fn commit_checkpoint(ctx: Context<CommitCheckpoint>) -> Result<()> {
        instructions::delegation::handle_commit_checkpoint(ctx)
    }

    pub fn commit_game(ctx: Context<CommitGame>) -> Result<()> {
        instructions::delegation::handle_commit_game(ctx)
    }

    pub fn undelegate_miner(ctx: Context<UndelegateMiner>) -> Result<()> {
        instructions::delegation::handle_undelegate_miner(ctx)
    }

    pub fn claim_sol(ctx: Context<ClaimSol>) -> Result<()> {
        instructions::claim::handler_claim_sol(ctx)
    }

    pub fn claim_admin_fees(ctx: Context<ClaimAdminFees>) -> Result<()> {
        instructions::claim::handle_claim_admin_fees(ctx)
    }

    pub fn update(
        ctx: Context<Update>,
        new_admin: Option<Pubkey>,
        new_fee_collector: Option<Pubkey>,
    ) -> Result<()> {
        instructions::update::handle_update(ctx, new_admin, new_fee_collector)
    }
}
