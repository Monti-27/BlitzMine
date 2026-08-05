use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::BlitzmineError;
use crate::state::*;

/// Update config (admin only).
pub fn handle_update(
    ctx: Context<Update>,
    new_admin: Option<Pubkey>,
    new_fee_collector: Option<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    require!(
        ctx.accounts.admin.key() == config.admin,
        BlitzmineError::NotAuthorized
    );

    if let Some(admin) = new_admin {
        config.admin = admin;
    }
    if let Some(fc) = new_fee_collector {
        config.fee_collector = fc;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ BlitzmineError::NotAuthorized,
    )]
    pub config: Account<'info, Config>,
}
