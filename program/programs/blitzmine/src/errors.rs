use anchor_lang::prelude::*;

#[error_code]
pub enum BlitzmineError {
    #[msg("Amount is too small")]
    AmountTooSmall,

    #[msg("Not authorized")]
    NotAuthorized,

    #[msg("Round not active")]
    RoundNotActive,

    #[msg("Round not expired")]
    RoundNotExpired,

    #[msg("Checkpoint required before entering a new round")]
    CheckpointRequired,

    #[msg("Insufficient balance")]
    InsufficientBalance,

    #[msg("Overflow")]
    Overflow,

    #[msg("Invalid VRF account")]
    InvalidVrfAccount,

    #[msg("Invalid square mask")]
    InvalidMask,

    #[msg("Invalid transaction nonce")]
    InvalidNonce,

    #[msg("Randomness has already been requested")]
    RandomnessAlreadyRequested,

    #[msg("Randomness has not been requested")]
    RandomnessNotRequested,

    #[msg("Randomness request has not timed out")]
    RandomnessNotTimedOut,

    #[msg("Round has already been resolved")]
    RoundAlreadyResolved,

    #[msg("Round account is not prepared")]
    RoundNotPrepared,

    #[msg("Miner must be settled before leaving the rollup")]
    MinerNotSettled,
}
