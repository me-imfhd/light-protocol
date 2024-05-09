use std::vec;

use anchor_lang::{
    prelude::borsh, solana_program::pubkey::Pubkey, AnchorDeserialize, AnchorSerialize,
};
use light_hasher::{errors::HasherError, DataHasher};
use light_utils::hash_to_bn254_field_size_be;

#[derive(Clone, Copy, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
#[repr(u8)]
pub enum AccountState {
    Initialized,
    Frozen,
}

#[derive(Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct TokenData {
    /// The mint associated with this account
    pub mint: Pubkey,
    /// The owner of this account.
    pub owner: Pubkey,
    /// The amount of tokens this account holds.
    pub amount: u64,
    /// If `delegate` is `Some` then `delegated_amount` represents
    /// the amount authorized by the delegate
    pub delegate: Option<Pubkey>,
    /// The account's state
    pub state: AccountState,
    /// If is_some, this is a native token, and the value logs the rent-exempt
    /// reserve. An Account is required to be rent-exempt, so the value is
    /// used by the Processor to ensure that wrapped SOL accounts do not
    /// drop below this threshold.
    pub is_native: Option<u64>,
    /// The amount delegated
    pub delegated_amount: u64, // TODO: make instruction data optional
                               // TODO: validate that we don't need close authority
                               // /// Optional authority to close the account.
                               // pub close_authority: Option<Pubkey>,
}

// keeping this client struct for now because ts encoding is complaining about the enum, state is replaced with u8 in this struct
#[derive(Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct TokenDataClient {
    /// The mint associated with this account
    pub mint: Pubkey,
    /// The owner of this account.
    pub owner: Pubkey,
    /// The amount of tokens this account holds.
    pub amount: u64,
    /// If `delegate` is `Some` then `delegated_amount` represents
    /// the amount authorized by the delegate
    pub delegate: Option<Pubkey>,
    /// The account's state
    pub state: u8,
    /// If is_some, this is a native token, and the value logs the rent-exempt
    /// reserve. An Account is required to be rent-exempt, so the value is
    /// used by the Processor to ensure that wrapped SOL accounts do not
    /// drop below this threshold.
    pub is_native: Option<u64>,
    /// The amount delegated
    pub delegated_amount: u64,
    // TODO: validate that we don't need close authority
    // /// Optional authority to close the account.
    // pub close_authority: Option<Pubkey>,
}

/// Hashing schema:
/// H(mint, owner, amount, delegate, delegated_amount, is_native, state)
/// delegate, delegated_amount, is_native and state have dynamic positions.
/// Always hash mint, owner and amount
/// If delegate hash delegate and delegated_amount together.
/// If is native hash is_native.
/// If frozen hash is frozen.
///
/// Security:
/// to prevent the possibility that different fields with the same value result in the same hash
/// we add a prefix to the delegated amount, is native and state fields.
/// This way we can have a dynamic hashing schema and hash only used values.
impl TokenData {
    /// We should not hash pubkeys multiple times.
    /// For all we can assume mints are equal.
    /// For all input compressed accounts we can assume owners are equal.
    pub fn hash_with_hashed_values<H: light_hasher::Hasher>(
        mint: &[u8; 32],
        owner: &[u8; 32],
        amount_bytes: &[u8; 8],
        native_amount: &Option<u64>,
    ) -> std::result::Result<[u8; 32], HasherError> {
        let mut hash_inputs = Vec::new();
        hash_inputs.push(mint.as_slice());
        hash_inputs.push(owner.as_slice());
        hash_inputs.push(amount_bytes.as_slice());
        let mut native_amount_bytes: [u8; 10] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        if native_amount.is_some() {
            native_amount_bytes[1] = match native_amount {
                Some(_) => 1,
                None => 0,
            };
            native_amount_bytes[2..]
                .copy_from_slice(&native_amount.unwrap_or_default().to_le_bytes());
            hash_inputs.push(native_amount_bytes.as_slice());
        }
        H::hashv(hash_inputs.as_slice())
    }

    pub fn hash_with_delegate_hashed_values<H: light_hasher::Hasher>(
        mint: &[u8; 32],
        owner: &[u8; 32],
        amount_bytes: &[u8; 8],
        native_amount: Option<u64>,
        hashed_delegate: &[u8; 32],
        delegated_amount: &[u8; 8],
    ) -> std::result::Result<[u8; 32], HasherError> {
        let mut hash_inputs = vec![
            mint.as_slice(),
            owner.as_slice(),
            amount_bytes.as_slice(),
            hashed_delegate.as_slice(),
        ];
        let mut prefixed_delegated_amount: [u8; 9] = [1, 0, 0, 0, 0, 0, 0, 0, 0];
        prefixed_delegated_amount[1..].copy_from_slice(delegated_amount.as_slice());
        hash_inputs.push(prefixed_delegated_amount.as_slice());
        let mut native_amount_bytes: [u8; 10] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        if native_amount.is_some() {
            native_amount_bytes[1] = match native_amount {
                Some(_) => 1,
                None => 0,
            };
            native_amount_bytes[2..]
                .copy_from_slice(&native_amount.unwrap_or_default().to_le_bytes());
            hash_inputs.push(native_amount_bytes.as_slice());
        }

        H::hashv(hash_inputs.as_slice())
    }
}

impl DataHasher for TokenData {
    fn hash<H: light_hasher::Hasher>(&self) -> std::result::Result<[u8; 32], HasherError> {
        let hashed_mint = hash_to_bn254_field_size_be(self.mint.to_bytes().as_slice())
            .unwrap()
            .0;
        let hashed_owner = hash_to_bn254_field_size_be(self.owner.to_bytes().as_slice())
            .unwrap()
            .0;
        let mut hash_inputs = Vec::new();
        hash_inputs.push(hashed_mint.as_slice());
        hash_inputs.push(hashed_owner.as_slice());
        let amount_bytes = self.amount.to_le_bytes();
        hash_inputs.push(amount_bytes.as_slice());
        let hashed_delegate;
        let mut delegated_amount: [u8; 9] = [1, 0, 0, 0, 0, 0, 0, 0, 0];

        if let Some(delegate) = self.delegate {
            hashed_delegate = hash_to_bn254_field_size_be(delegate.to_bytes().as_slice())
                .unwrap()
                .0;
            hash_inputs.push(hashed_delegate.as_slice());
            delegated_amount[1..].copy_from_slice(&self.delegated_amount.to_le_bytes());
            hash_inputs.push(delegated_amount.as_slice());
        };
        let mut native_amount: [u8; 10] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        if self.is_native.is_some() {
            native_amount[1] = match self.is_native {
                Some(_) => 1,
                None => 0,
            };
            native_amount[2..].copy_from_slice(&self.is_native.unwrap_or_default().to_le_bytes());
            hash_inputs.push(&native_amount[..]);
        }
        let state_bytes = [3, self.state as u8, 0, 0, 0, 0, 0, 0, 0];
        if self.state != AccountState::Initialized {
            hash_inputs.push(&state_bytes[..]);
        }
        // let close_authority = match self.close_authority {
        //     Some(close_authority) => {
        //         hash_to_bn254_field_size_be(close_authority.to_bytes().as_slice())
        //             .unwrap()
        //             .0
        //     }
        //     None => [0u8; 32],
        // };
        // TODO: implement a trait hash_default value for Option<u64> and use it for other optional values
        H::hashv(hash_inputs.as_slice())
    }
}

#[cfg(test)]
pub mod test {
    use super::*;
    use light_hasher::{Keccak, Poseidon};
    use rand::Rng;

    #[test]
    fn equivalency_of_hash_functions() {
        let token_data = TokenData {
            mint: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            amount: 100,
            delegate: Some(Pubkey::new_unique()),
            state: AccountState::Initialized,
            is_native: Some(100),
            delegated_amount: 100,
        };
        let hashed_token_data = token_data.hash::<Poseidon>().unwrap();
        let hashed_mint = hash_to_bn254_field_size_be(token_data.mint.to_bytes().as_slice())
            .unwrap()
            .0;
        let hashed_owner = hash_to_bn254_field_size_be(token_data.owner.to_bytes().as_slice())
            .unwrap()
            .0;
        let hashed_delegate =
            hash_to_bn254_field_size_be(token_data.delegate.unwrap().to_bytes().as_slice())
                .unwrap()
                .0;
        let hashed_token_data_with_hashed_values =
            TokenData::hash_with_delegate_hashed_values::<Poseidon>(
                &hashed_mint,
                &hashed_owner,
                &token_data.amount.to_le_bytes(),
                token_data.is_native,
                &hashed_delegate,
                &token_data.delegated_amount.to_le_bytes(),
            )
            .unwrap();
        assert_eq!(hashed_token_data, hashed_token_data_with_hashed_values);

        let token_data = TokenData {
            mint: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            amount: 101,
            delegate: None,
            state: AccountState::Initialized,
            is_native: None,
            delegated_amount: 0,
        };
        let hashed_token_data = token_data.hash::<Poseidon>().unwrap();
        let hashed_mint = hash_to_bn254_field_size_be(token_data.mint.to_bytes().as_slice())
            .unwrap()
            .0;
        let hashed_owner = hash_to_bn254_field_size_be(token_data.owner.to_bytes().as_slice())
            .unwrap()
            .0;
        let hashed_token_data_with_hashed_values = TokenData::hash_with_hashed_values::<Poseidon>(
            &hashed_mint,
            &hashed_owner,
            &token_data.amount.to_le_bytes(),
            &token_data.is_native,
        )
        .unwrap();
        assert_eq!(hashed_token_data, hashed_token_data_with_hashed_values);
    }

    fn equivalency_of_hash_functions_rnd_iters<H: light_hasher::Hasher, const ITERS: usize>() {
        let mut rng = rand::thread_rng();

        for _ in 0..ITERS {
            let token_data = TokenData {
                mint: Pubkey::new_unique(),
                owner: Pubkey::new_unique(),
                amount: rng.gen(),
                delegate: Some(Pubkey::new_unique()),
                state: AccountState::Initialized,
                is_native: Some(rng.gen()),
                delegated_amount: rng.gen(),
            };
            let hashed_token_data = token_data.hash::<H>().unwrap();
            let hashed_mint = hash_to_bn254_field_size_be(token_data.mint.to_bytes().as_slice())
                .unwrap()
                .0;
            let hashed_owner = hash_to_bn254_field_size_be(token_data.owner.to_bytes().as_slice())
                .unwrap()
                .0;
            let hashed_delegate =
                hash_to_bn254_field_size_be(token_data.delegate.unwrap().to_bytes().as_slice())
                    .unwrap()
                    .0;
            let hashed_token_data_with_hashed_values =
                TokenData::hash_with_delegate_hashed_values::<H>(
                    &hashed_mint,
                    &hashed_owner,
                    &token_data.amount.to_le_bytes(),
                    token_data.is_native,
                    &hashed_delegate,
                    &token_data.delegated_amount.to_le_bytes(),
                )
                .unwrap();
            assert_eq!(hashed_token_data, hashed_token_data_with_hashed_values);

            let token_data = TokenData {
                mint: Pubkey::new_unique(),
                owner: Pubkey::new_unique(),
                amount: rng.gen(),
                delegate: None,
                state: AccountState::Initialized,
                is_native: None,
                delegated_amount: 0,
            };
            let hashed_token_data = token_data.hash::<H>().unwrap();
            let hashed_mint = hash_to_bn254_field_size_be(token_data.mint.to_bytes().as_slice())
                .unwrap()
                .0;
            let hashed_owner = hash_to_bn254_field_size_be(token_data.owner.to_bytes().as_slice())
                .unwrap()
                .0;
            let hashed_token_data_with_hashed_values: [u8; 32] =
                TokenData::hash_with_hashed_values::<H>(
                    &hashed_mint,
                    &hashed_owner,
                    &token_data.amount.to_le_bytes(),
                    &token_data.is_native,
                )
                .unwrap();
            assert_eq!(hashed_token_data, hashed_token_data_with_hashed_values);
        }
    }

    #[test]
    fn equivalency_of_hash_functions_iters_poseidon() {
        equivalency_of_hash_functions_rnd_iters::<Poseidon, 10_000>();
    }

    #[test]
    fn equivalency_of_hash_functions_iters_keccak() {
        equivalency_of_hash_functions_rnd_iters::<Keccak, 100_000>();
    }
}