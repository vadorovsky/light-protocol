import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  hashAndTruncateToCircuit,
  Provider,
  TransactionErrorCode,
  VerifierError,
  VerifierErrorCode,
  verifierStorageProgramId,
} from "../index";
import { Transaction } from "transaction";
import { Verifier, PublicInputs, VerifierConfig } from ".";
import {
  VerifierProgramStorage,
  IDL_VERIFIER_PROGRAM_STORAGE,
} from "../idls/index";

// TODO: define verifier with an Idl thus absorb this functionality into the Transaction class
export class VerifierStorage implements Verifier {
  verifierProgram?: Program<VerifierProgramStorage>;
  wtnsGenPath: String;
  zkeyPath: String;
  calculateWtns: NodeRequire;
  config: VerifierConfig;
  instructions?: anchor.web3.TransactionInstruction[];
  pubkey: anchor.BN;
  constructor(provider?: Provider) {
    try {
      this.verifierProgram = new Program(
        IDL_VERIFIER_PROGRAM_STORAGE,
        verifierStorageProgramId,
        // @ts-ignore
        provider,
      );
    } catch (error) {
      console.log(error);
    }
    // ./build-circuits/transactionMasp2_js/
    this.wtnsGenPath = "transactionMasp2_js/transactionMasp2.wasm";
    this.zkeyPath = `transactionMasp2.zkey`;
    this.calculateWtns = require("../../build-circuits/transactionMasp2_js/witness_calculator.js");
    this.config = { in: 2, out: 2, nrPublicInputs: 9, isAppVerifier: false };
    this.pubkey = hashAndTruncateToCircuit(verifierStorageProgramId.toBytes());
  }

  parsePublicInputsFromArray(
    publicInputsBytes: Array<Array<number>>,
  ): PublicInputs {
    if (!publicInputsBytes) {
      throw new VerifierError(
        VerifierErrorCode.PUBLIC_INPUTS_UNDEFINED,
        "parsePublicInputsFromArray",
        "verifier storage",
      );
    }
    if (publicInputsBytes.length != this.config.nrPublicInputs) {
      throw new VerifierError(
        VerifierErrorCode.INVALID_INPUTS_NUMBER,
        "parsePublicInputsFromArray",
        `verifier storage: publicInputsBytes.length invalid ${publicInputsBytes.length} != ${this.config.nrPublicInputs}`,
      );
    }
    return {
      root: publicInputsBytes[0],
      publicAmountSpl: publicInputsBytes[1],
      txIntegrityHash: publicInputsBytes[2],
      publicAmountSol: publicInputsBytes[3],
      publicMintPubkey: publicInputsBytes[4],
      nullifiers: [publicInputsBytes[5], publicInputsBytes[6]],
      leaves: [[publicInputsBytes[7], publicInputsBytes[8]]],
    };
  }

  async getInstructions(
    transaction: Transaction,
  ): Promise<anchor.web3.TransactionInstruction[]> {
    if (!transaction.params)
      throw new VerifierError(
        TransactionErrorCode.TX_PARAMETERS_UNDEFINED,
        "getInstructions",
      );
    if (!transaction.remainingAccounts)
      throw new VerifierError(
        TransactionErrorCode.REMAINING_ACCOUNTS_NOT_CREATED,
        "getInstructions",
        "verifier storage: remainingAccounts undefined",
      );
    if (!transaction.remainingAccounts.nullifierPdaPubkeys)
      throw new VerifierError(
        TransactionErrorCode.REMAINING_ACCOUNTS_NOT_CREATED,
        "getInstructions",
        "verifier storage: remainingAccounts.nullifierPdaPubkeys undefined",
      );
    if (!transaction.remainingAccounts.leavesPdaPubkeys)
      throw new VerifierError(
        TransactionErrorCode.REMAINING_ACCOUNTS_NOT_CREATED,
        "getInstructions",
        "verifier storage: remainingAccounts.leavesPdaPubkeys undefined",
      );
    if (!transaction.transactionInputs.publicInputs)
      throw new VerifierError(
        TransactionErrorCode.PUBLIC_INPUTS_UNDEFINED,
        "getInstructions",
        "verifier storage: params.publicInputs undefined",
      );
    if (!transaction.params.relayer)
      throw new VerifierError(
        TransactionErrorCode.RELAYER_UNDEFINED,
        "getInstructions",
        "verifier storage: params.params.relayer undefined",
      );
    if (!transaction.params.encryptedUtxos)
      throw new VerifierError(
        VerifierErrorCode.ENCRYPTING_UTXOS_UNDEFINED,
        "getInstructions",
        "verifier storage: params.encryptedUtxos undefined",
      );
    if (!transaction.provider.wallet) {
      throw new VerifierError(
        TransactionErrorCode.WALLET_UNDEFINED,
        "getInstructions",
        "verifier storage: Payer(wallet) not defined",
      );
    }
    if (!this.verifierProgram)
      throw new VerifierError(
        TransactionErrorCode.VERIFIER_PROGRAM_UNDEFINED,
        "getInstructions",
        "verifier storage: verifierProgram undefined",
      );
    if (!transaction.params.message)
      throw new VerifierError(
        TransactionErrorCode.MESSAGE_UNDEFINED,
        "getInstructions",
        "verifier storage: params.message undefined",
      );

    const ix1 = await this.verifierProgram.methods
      .shieldedTransferFirst(transaction.params.message)
      .accounts({
        ...transaction.params.accounts,
        ...transaction.params.relayer.accounts,
      })
      .instruction();

    const ix2 = await this.verifierProgram.methods
      .shieldedTransferSecond(
        transaction.transactionInputs.proofBytes.proofA,
        transaction.transactionInputs.proofBytes.proofB,
        transaction.transactionInputs.proofBytes.proofC,
        transaction.transactionInputs.publicInputs.nullifiers,
        transaction.transactionInputs.publicInputs.leaves[0],
        transaction.transactionInputs.publicInputs.publicAmountSol,
        new anchor.BN(transaction.transactionInputs.rootIndex.toString()),
        new anchor.BN(
          transaction.params.relayer
            .getRelayerFee(transaction.params.ataCreationFee)
            .toString(),
        ),
        Buffer.from(transaction.params.encryptedUtxos),
      )
      .accounts({
        ...transaction.params.accounts,
        ...transaction.params.relayer.accounts,
      })
      .remainingAccounts([
        ...transaction.remainingAccounts.nullifierPdaPubkeys,
        ...transaction.remainingAccounts.leavesPdaPubkeys,
      ])
      .instruction();

    this.instructions = [ix1, ix2];
    return [ix1, ix2];
  }
}
