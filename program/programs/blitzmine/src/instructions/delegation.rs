use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::state::*;

fn delegate_config(remaining_accounts: &[AccountInfo<'_>]) -> DelegateConfig {
    DelegateConfig {
        validator: remaining_accounts.first().map(|account| account.key()),
        ..Default::default()
    }
}

pub fn handle_delegate_board(ctx: Context<DelegateBoard>) -> Result<()> {
    let config = delegate_config(ctx.remaining_accounts);
    ctx.accounts
        .delegate_board(&ctx.accounts.admin, &[SEED_BOARD], config)?;
    Ok(())
}

pub fn handle_delegate_treasury(ctx: Context<DelegateTreasury>) -> Result<()> {
    let config = delegate_config(ctx.remaining_accounts);
    ctx.accounts
        .delegate_treasury(&ctx.accounts.admin, &[SEED_TREASURY], config)?;
    Ok(())
}

pub fn handle_delegate_round(ctx: Context<DelegateRound>, round_id: u64) -> Result<()> {
    let config = delegate_config(ctx.remaining_accounts);
    ctx.accounts.delegate_round(
        &ctx.accounts.admin,
        &[SEED_ROUND, &round_id.to_le_bytes()],
        config,
    )?;
    Ok(())
}

pub fn handle_delegate_miner(ctx: Context<DelegateMiner>) -> Result<()> {
    let config = delegate_config(ctx.remaining_accounts);
    ctx.accounts.delegate_miner(
        &ctx.accounts.authority,
        &[SEED_MINER, ctx.accounts.authority.key().as_ref()],
        config,
    )?;
    Ok(())
}

pub fn handle_commit_game(ctx: Context<CommitGame>) -> Result<()> {
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit(&[
        ctx.accounts.board.to_account_info(),
        ctx.accounts.round.to_account_info(),
        ctx.accounts.treasury.to_account_info(),
    ])
    .build_and_invoke()?;
    Ok(())
}

pub fn handle_commit_checkpoint(ctx: Context<CommitCheckpoint>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.miner.authority,
        ctx.accounts.authority.key(),
        BlitzmineError::NotAuthorized
    );
    require!(
        ctx.accounts.miner.checkpoint_id == ctx.accounts.round.id,
        BlitzmineError::MinerNotSettled
    );

    MagicIntentBundleBuilder::new(
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit(&[
        ctx.accounts.miner.to_account_info(),
        ctx.accounts.round.to_account_info(),
    ])
    .build_and_invoke()?;
    Ok(())
}

pub fn handle_undelegate_miner(ctx: Context<UndelegateMiner>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.miner.authority,
        ctx.accounts.authority.key(),
        BlitzmineError::NotAuthorized
    );
    require!(
        ctx.accounts.miner.checkpoint_id == ctx.accounts.miner.round_id,
        BlitzmineError::MinerNotSettled
    );

    MagicIntentBundleBuilder::new(
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.miner.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateBoard<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin @ BlitzmineError::NotAuthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, del, seeds = [SEED_BOARD], bump)]
    pub board: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateTreasury<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin @ BlitzmineError::NotAuthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, del, seeds = [SEED_TREASURY], bump)]
    pub treasury: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct DelegateRound<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin @ BlitzmineError::NotAuthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, del, seeds = [SEED_ROUND, &round_id.to_le_bytes()], bump)]
    pub round: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateMiner<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, del, seeds = [SEED_MINER, authority.key().as_ref()], bump)]
    pub miner: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [SEED_BOARD], bump = board.bump)]
    pub board: Account<'info, Board>,
    #[account(mut, seeds = [SEED_ROUND, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [SEED_TREASURY], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitCheckpoint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_MINER, authority.key().as_ref()], bump = miner.bump)]
    pub miner: Account<'info, Miner>,
    #[account(mut, seeds = [SEED_ROUND, &miner.round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateMiner<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_MINER, authority.key().as_ref()], bump = miner.bump)]
    pub miner: Account<'info, Miner>,
}
