use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct MerkleTreeTmpPda {
    pub node_left: [u8;32],
    pub node_right: [u8;32],
    pub leaf_left: [u8;32],
    pub leaf_right: [u8;32],
    pub relayer: Pubkey,
    pub merkle_tree_pda_pubkey: Pubkey,
    //
    pub state: [u8;96],
    pub current_round: u64,
    pub current_round_index: u64,
    pub current_instruction_index: u64,
    pub current_index: u64,
    pub current_level: u64,
    pub current_level_hash: [u8;32],
    pub tmp_leaves_index: u64,

    pub leaves: [[[u8;32]; 2];16],
    pub merkle_tree_index: u8,
    pub number_of_leaves: u8,
    pub insert_leaves_index: u8,
    pub found_root: u8,
}
