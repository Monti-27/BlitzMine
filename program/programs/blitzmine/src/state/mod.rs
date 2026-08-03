pub mod board;
pub mod config;
pub mod miner;
pub mod round;

pub use board::*;
pub use config::*;
pub use miner::*;
pub use round::*;

use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Treasury {
    pub motherlode: u64,
    pub total_vaulted: u64,
    pub admin_fees: u64,
    pub bump: u8,
}

impl Treasury {
    pub const SIZE: usize = 8 + 8 + 8 + 8 + 1;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::NUM_SQUARES;

    #[test]
    fn account_sizes_match_serialized_data() {
        assert_eq!(
            Board::default().try_to_vec().unwrap().len() + 8,
            Board::SIZE
        );
        assert_eq!(
            Config::default().try_to_vec().unwrap().len() + 8,
            Config::SIZE
        );
        assert_eq!(
            Miner::default().try_to_vec().unwrap().len() + 8,
            Miner::SIZE
        );
        assert_eq!(
            Round::default().try_to_vec().unwrap().len() + 8,
            Round::SIZE
        );
        assert_eq!(
            Treasury::default().try_to_vec().unwrap().len() + 8,
            Treasury::SIZE
        );
    }

    #[test]
    fn randomness_draws_are_deterministic_and_bounded() {
        let round = Round {
            id: 42,
            randomness: [7; 32],
            ..Default::default()
        };
        let first = round.rng();
        let second = round.rng();
        assert_eq!(first, second);
        assert!(first < NUM_SQUARES as u64);
    }

    #[test]
    fn every_vrf_output_is_a_valid_draw() {
        for randomness in [[0; 32], [u8::MAX; 32], [1; 32], [127; 32]] {
            let round = Round {
                id: 9,
                randomness,
                ..Default::default()
            };
            assert!(round.rng() < NUM_SQUARES as u64);
        }
    }
}
