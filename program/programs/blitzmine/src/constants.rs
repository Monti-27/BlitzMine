use anchor_lang::prelude::*;

pub const ONE_MINUTE: i64 = 60;
pub const ONE_HOUR: i64 = 60 * ONE_MINUTE;
pub const ONE_DAY: i64 = 24 * ONE_HOUR;
pub const ONE_WEEK: i64 = 7 * ONE_DAY;
#[cfg(not(feature = "local-e2e"))]
pub const ROUND_DURATION_SECONDS: i64 = ONE_MINUTE;
#[cfg(feature = "local-e2e")]
pub const ROUND_DURATION_SECONDS: i64 = 5;
pub const INTERMISSION_SECONDS: i64 = 15;
pub const CLAIM_WINDOW_SECONDS: i64 = ONE_DAY;
pub const BOT_CHECKPOINT_WINDOW_SECONDS: i64 = 12 * ONE_HOUR;
pub const VRF_TIMEOUT_SECONDS: i64 = 30;
pub const NUM_SQUARES: usize = 25;
pub const CHECKPOINT_FEE: u64 = 10_000;
pub const ADMIN_FEE: u64 = 100;
pub const DENOMINATOR_BPS: u64 = 10_000;
pub const MOTHERLODE_FEE: u64 = 1_000;
pub const MOTHERLODE_ODDS: u64 = 625;
pub const VALID_SQUARE_MASK: u64 = (1u64 << NUM_SQUARES) - 1;
pub const SEED_BOARD: &[u8] = b"board";
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_MINER: &[u8] = b"miner";
pub const SEED_ROUND: &[u8] = b"round";
pub const SEED_TREASURY: &[u8] = b"treasury";
#[cfg(not(any(feature = "local-e2e", feature = "local-ui")))]
pub const ADMIN_ADDRESS: Pubkey = pubkey!("2W6NfyAnBghnUrksXxaQukyhVsH84YxmyTKxLXQiWM4M");
#[cfg(any(feature = "local-e2e", feature = "local-ui"))]
pub const ADMIN_ADDRESS: Pubkey = pubkey!("9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj");
#[cfg(not(any(feature = "local-e2e", feature = "local-ui")))]
pub const ADMIN_FEE_COLLECTOR: Pubkey = pubkey!("2W6NfyAnBghnUrksXxaQukyhVsH84YxmyTKxLXQiWM4M");
#[cfg(any(feature = "local-e2e", feature = "local-ui"))]
pub const ADMIN_FEE_COLLECTOR: Pubkey = pubkey!("9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj");
