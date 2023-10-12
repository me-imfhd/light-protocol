import * as anchor from "@coral-xyz/anchor";
import { Keypair as SolanaKeypair, PublicKey } from "@solana/web3.js";
import _ from "lodash";
import { assert } from "chai";
const token = require("@solana/spl-token");
const circomlibjs = require("circomlibjs");

import {
  Transaction,
  Account,
  Utxo,
  createMintWrapper,
  merkleTreeProgramId,
  ADMIN_AUTH_KEYPAIR,
  MINT,
  KEYPAIR_PRIVKEY,
  REGISTERED_VERIFIER_PDA,
  REGISTERED_VERIFIER_ONE_PDA,
  USER_TOKEN_ACCOUNT,
  createTestAccounts,
  userTokenAccount,
  recipientTokenAccount,
  FEE_ASSET,
  confirmConfig,
  TransactionParameters,
  Provider as LightProvider,
  newAccountWithTokens,
  Action,
  useWallet,
  TestRelayer,
  IDL_LIGHT_PSP2IN2OUT,
  IDL_LIGHT_PSP10IN2OUT,
  MerkleTreeConfig,
  User,
  sleep,
  getSystem,
  System,
  RELAYER_FEE,
  BN_0,
  closeVerifierState,
  Provider,
} from "../../src";

let POSEIDON, ACCOUNT, RELAYER, shieldUtxo1;
let SLEEP_BUFFER = 0;
const system = getSystem();
if (system === System.MacOsArm64) SLEEP_BUFFER = 400;

const transactions: Transaction[] = [];
console.log = () => {};
describe("Verifier Zero and One Tests", () => {
  // Configure the client to use the local cluster.
  process.env.ANCHOR_WALLET = process.env.HOME + "/.config/solana/id.json";

  const provider = anchor.AnchorProvider.local(
    "http://127.0.0.1:8899",
    confirmConfig,
  );
  anchor.setProvider(provider);
  process.env.ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899";

  let shieldAmount, shieldFeeAmount, lightProvider: Provider;
  const VERIFIER_IDLS = [IDL_LIGHT_PSP2IN2OUT, IDL_LIGHT_PSP10IN2OUT];

  before(async () => {
    await createTestAccounts(provider.connection, userTokenAccount);

    POSEIDON = await circomlibjs.buildPoseidonOpt();

    ACCOUNT = new Account({
      poseidon: POSEIDON,
      seed: KEYPAIR_PRIVKEY.toString(),
    });

    const relayerRecipientSol = SolanaKeypair.generate().publicKey;

    await provider.connection.requestAirdrop(
      relayerRecipientSol,
      2_000_000_000,
    );

    RELAYER = new TestRelayer({
      relayerPubkey: ADMIN_AUTH_KEYPAIR.publicKey,
      relayerRecipientSol,
      relayerFee: RELAYER_FEE,
      payer: ADMIN_AUTH_KEYPAIR,
    });

    shieldAmount =
      10_000 + (Math.floor(Math.random() * 1_000_000_000) % 1_100_000_000);
    shieldFeeAmount =
      10_000 + (Math.floor(Math.random() * 1_000_000_000) % 1_100_000_000);

    for (const verifier in VERIFIER_IDLS) {
      console.log("verifier ", verifier.toString());

      await token.approve(
        provider.connection,
        ADMIN_AUTH_KEYPAIR,
        userTokenAccount,
        Transaction.getSignerAuthorityPda(
          merkleTreeProgramId,
          new PublicKey(
            VERIFIER_IDLS[verifier].constants[0].value.slice(1, -1),
          ),
        ), //delegate
        USER_TOKEN_ACCOUNT, // owner
        shieldAmount * 10,
        [USER_TOKEN_ACCOUNT],
      );

      lightProvider = await LightProvider.init({
        wallet: ADMIN_AUTH_KEYPAIR,
        relayer: RELAYER,
        confirmConfig,
      });

      shieldUtxo1 = new Utxo({
        poseidon: POSEIDON,
        assets: [FEE_ASSET, MINT],
        amounts: [new anchor.BN(shieldFeeAmount), new anchor.BN(shieldAmount)],
        publicKey: ACCOUNT.pubkey,
        assetLookupTable: lightProvider.lookUpTables.assetLookupTable,
        verifierProgramLookupTable:
          lightProvider.lookUpTables.verifierProgramLookupTable,
      });

      const txParams = new TransactionParameters({
        outputUtxos: [shieldUtxo1],
        eventMerkleTreePubkey: MerkleTreeConfig.getEventMerkleTreePda(),
        transactionMerkleTreePubkey:
          MerkleTreeConfig.getTransactionMerkleTreePda(),
        senderSpl: userTokenAccount,
        senderSol: ADMIN_AUTH_KEYPAIR.publicKey,
        poseidon: POSEIDON,
        action: Action.SHIELD,
        verifierIdl: VERIFIER_IDLS[verifier],
        account: ACCOUNT,
      });
      const { rootIndex: rootIndex0, remainingAccounts: remainingAccounts0 } =
        await lightProvider.getRootIndex();
      const transaction = new Transaction({
        rootIndex: rootIndex0,
        nextTransactionMerkleTree: remainingAccounts0.nextTransactionMerkleTree,
        solMerkleTree: lightProvider.solMerkleTree!,
        params: txParams,
      });

      const instructions = await transaction.compileAndProve(POSEIDON, ACCOUNT);
      await lightProvider.provider.connection.confirmTransaction(
        await lightProvider.provider.connection.requestAirdrop(
          transaction.params.accounts.authority,
          1_000_000_000,
        ),
        "confirmed",
      );
      // does one successful transaction
      await lightProvider.sendAndConfirmTransaction(instructions);
      await lightProvider.relayer.updateMerkleTree(lightProvider);

      // Shield
      const shieldUtxo2 = new Utxo({
        poseidon: POSEIDON,
        assets: [FEE_ASSET, MINT],
        amounts: [new anchor.BN(shieldFeeAmount), new anchor.BN(shieldAmount)],
        publicKey: ACCOUNT.pubkey,
        assetLookupTable: lightProvider.lookUpTables.assetLookupTable,
        verifierProgramLookupTable:
          lightProvider.lookUpTables.verifierProgramLookupTable,
      });

      const txParams1 = new TransactionParameters({
        outputUtxos: [shieldUtxo2],
        eventMerkleTreePubkey: MerkleTreeConfig.getEventMerkleTreePda(),
        transactionMerkleTreePubkey:
          MerkleTreeConfig.getTransactionMerkleTreePda(),
        senderSpl: userTokenAccount,
        senderSol: ADMIN_AUTH_KEYPAIR.publicKey,
        poseidon: POSEIDON,
        action: Action.SHIELD,
        verifierIdl: VERIFIER_IDLS[verifier],
        account: ACCOUNT,
      });
      await lightProvider.latestMerkleTree();
      const { rootIndex, remainingAccounts } =
        await lightProvider.getRootIndex();
      const transaction1 = new Transaction({
        rootIndex,
        nextTransactionMerkleTree: remainingAccounts.nextTransactionMerkleTree,
        solMerkleTree: lightProvider.solMerkleTree!,
        params: txParams1,
      });
      await transaction1.compileAndProve(POSEIDON, ACCOUNT);
      transactions.push(transaction1);

      // Unshield
      const tokenRecipient = recipientTokenAccount;

      const lightProviderUnshield = await LightProvider.init({
        wallet: ADMIN_AUTH_KEYPAIR,
        relayer: RELAYER,
        confirmConfig,
      });

      const relayerRecipientSol = SolanaKeypair.generate().publicKey;
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(relayerRecipientSol, 10000000),
      );

      const user: User = await User.init({
        provider: lightProviderUnshield,
        account: ACCOUNT,
      });
      const inputUtxos: Utxo[] = [
        user.balance.tokenBalances.get(MINT.toBase58()).utxos.values().next()
          .value,
      ];

      const txParams2 = new TransactionParameters({
        inputUtxos,
        eventMerkleTreePubkey: MerkleTreeConfig.getEventMerkleTreePda(),
        transactionMerkleTreePubkey:
          MerkleTreeConfig.getTransactionMerkleTreePda(),
        recipientSpl: tokenRecipient,
        recipientSol: ADMIN_AUTH_KEYPAIR.publicKey,
        relayer: RELAYER,
        poseidon: POSEIDON,
        action: Action.UNSHIELD,
        verifierIdl: VERIFIER_IDLS[verifier],
        account: ACCOUNT,
      });
      await lightProvider.latestMerkleTree();
      const { rootIndex: rootIndex1, remainingAccounts: remainingAccounts1 } =
        await lightProvider.getRootIndex();
      const tx = new Transaction({
        rootIndex: rootIndex1,
        nextTransactionMerkleTree: remainingAccounts1.nextTransactionMerkleTree,
        solMerkleTree: lightProvider.solMerkleTree!,
        params: txParams2,
      });

      await tx.compileAndProve(POSEIDON, ACCOUNT);
      transactions.push(tx);
    }
  });

  async function sendTestTx(tx: Transaction, type: string, account?: string) {
    const instructions = await tx.getInstructions(tx.params);
    console.log("aftere instructions");
    const provider = anchor.AnchorProvider.local(
      "http://127.0.0.1:8899",
      confirmConfig,
    );
    lightProvider.provider = provider;
    let e;
    try {
      e = await lightProvider.sendAndConfirmTransaction(instructions);
    } catch (error) {
      e = error;
    }

    if (type === "ProofVerificationFails") {
      assert.isTrue(
        e.logs.includes("Program log: error ProofVerificationFailed"),
      );
    } else if (type === "Account") {
      assert.isTrue(
        e.logs.includes(
          `Program log: AnchorError caused by account: ${account}. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.`,
        ),
      );
    } else if (type === "preInsertedLeavesIndex") {
      assert.isTrue(
        e.logs.includes(
          "Program log: AnchorError caused by account: pre_inserted_leaves_index. Error Code: AccountDiscriminatorMismatch. Error Number: 3002. Error Message: 8 byte discriminator did not match what was expected.",
        ),
      );
    } else if (type === "Includes") {
      assert.isTrue(e.logs.includes(account));
    }
    if (instructions.length > 1) {
      await closeVerifierState(
        lightProvider,
        tx.params.verifierIdl,
        tx.params.accounts.verifierState,
      );
    }
  }

  it("Wrong amount", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);

      const wrongAmount = new anchor.BN("123213").toArray();
      tmp_tx.transactionInputs.publicInputs.publicAmountSpl = Array.from([
        ...new Array(29).fill(0),
        ...wrongAmount,
      ]);
      console.log("before sendTestTxs");

      await sendTestTx(tmp_tx, "ProofVerificationFails");
    }
  });

  it("Wrong publicAmountSol", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      const wrongFeeAmount = new anchor.BN("123213").toArray();
      tmp_tx.transactionInputs.publicInputs.publicAmountSol = Array.from([
        ...new Array(29).fill(0),
        ...wrongFeeAmount,
      ]);
      await sendTestTx(tmp_tx, "ProofVerificationFails");
    }
  });

  it("Wrong Mint", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      const relayer = SolanaKeypair.generate();
      const newMintKeypair = SolanaKeypair.generate();
      await createMintWrapper({
        authorityKeypair: ADMIN_AUTH_KEYPAIR,
        mintKeypair: newMintKeypair,
        connection: provider.connection,
      });
      tmp_tx.params.accounts.senderSpl = await newAccountWithTokens({
        connection: provider.connection,
        MINT: newMintKeypair.publicKey,
        ADMIN_AUTH_KEYPAIR,
        userAccount: relayer,
        amount: BN_0,
      });
      await sendTestTx(tmp_tx, "ProofVerificationFails");
    }
  });

  it("Wrong encryptedUtxos", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      tmp_tx.params.encryptedUtxos = new Uint8Array(174).fill(2);
      await sendTestTx(tmp_tx, "ProofVerificationFails");
    }
  });

  it("Wrong relayerFee", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      tmp_tx.params.relayer.relayerFee = new anchor.BN("9000");
      await sendTestTx(tmp_tx, "ProofVerificationFails");
    }
  });

  it("Wrong nullifier", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      for (const i in tmp_tx.transactionInputs.publicInputs.inputNullifier) {
        tmp_tx.transactionInputs.publicInputs.inputNullifier[i] = new Array(
          32,
        ).fill(2);
        await sleep(SLEEP_BUFFER);
        await sendTestTx(tmp_tx, "ProofVerificationFails");
      }
    }
  });

  it("Wrong leaves", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      for (const i in tmp_tx.transactionInputs.publicInputs.outputCommitment) {
        tmp_tx.transactionInputs.publicInputs.outputCommitment[i] = new Array(
          32,
        ).fill(2);
        await sleep(SLEEP_BUFFER);
        await sendTestTx(tmp_tx, "ProofVerificationFails");
      }
    }
  });

  // doesn't work sig verify error
  it.skip("Wrong signer", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      const wrongSinger = SolanaKeypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          wrongSinger.publicKey,
          1_000_000_000,
        ),
        "confirmed",
      );
      lightProvider.wallet = useWallet(wrongSinger);
      tmp_tx.params.relayer.accounts.relayerPubkey = wrongSinger.publicKey;
      await sendTestTx(tmp_tx, "ProofVerificationFails");
    }
  });

  it("Wrong recipientSol", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      tmp_tx.params.accounts.recipientSol = SolanaKeypair.generate().publicKey;
      await sendTestTx(tmp_tx, "ProofVerificationFails");
    }
  });

  it("Wrong recipientSpl", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      tmp_tx.params.accounts.recipientSpl = SolanaKeypair.generate().publicKey;
      await sendTestTx(tmp_tx, "ProofVerificationFails");
    }
  });

  it("Wrong registeredVerifierPda", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      if (
        tmp_tx.params.accounts.registeredVerifierPda.toBase58() ==
        REGISTERED_VERIFIER_ONE_PDA.toBase58()
      ) {
        tmp_tx.params.accounts.registeredVerifierPda = REGISTERED_VERIFIER_PDA;
      } else {
        tmp_tx.params.accounts.registeredVerifierPda =
          REGISTERED_VERIFIER_ONE_PDA;
      }
      await sendTestTx(tmp_tx, "Account", "registered_verifier_pda");
    }
  });

  it("Wrong authority", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      tmp_tx.params.accounts.authority = Transaction.getSignerAuthorityPda(
        merkleTreeProgramId,
        SolanaKeypair.generate().publicKey,
      );
      await sendTestTx(tmp_tx, "Account", "authority");
    }
  });

  it("Wrong nullifier accounts", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      tmp_tx.getPdaAddresses();
      for (
        let i = 0;
        i < tmp_tx.remainingAccounts.nullifierPdaPubkeys.length;
        i++
      ) {
        tmp_tx.remainingAccounts.nullifierPdaPubkeys[i] =
          tmp_tx.remainingAccounts.nullifierPdaPubkeys[
            (i + 1) % tmp_tx.remainingAccounts.nullifierPdaPubkeys.length
          ];
        await sleep(SLEEP_BUFFER);

        await sendTestTx(
          tmp_tx,
          "Includes",
          "Program log: Passed-in pda pubkey != on-chain derived pda pubkey.",
        );
      }
    }
  });

  it("Wrong leavesPdaPubkeys accounts", async () => {
    for (const tx in transactions) {
      const tmp_tx: Transaction = _.cloneDeep(transactions[tx]);
      tmp_tx.getPdaAddresses();
      for (
        let i = 0;
        i < tmp_tx.remainingAccounts.leavesPdaPubkeys.length;
        i++
      ) {
        tmp_tx.remainingAccounts.leavesPdaPubkeys[i] = {
          isSigner: false,
          isWritable: true,
          pubkey: SolanaKeypair.generate().publicKey,
        };
        await sleep(SLEEP_BUFFER);

        await sendTestTx(
          tmp_tx,
          "Includes",
          "Program log: AnchorError caused by account: two_leaves_pda. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.",
        );
      }
    }
  });
});