import { readFileSync, writeFileSync } from "fs";
import path from "path";
import type {
  TransactionHash,
  GenLayerClient,
} from "genlayer-js/types";

type FeeProfile = {
  deploy?: Record<string, string | number>;
};

function readBigInt(value: string | number | undefined, fallback = "0"): bigint {
  return BigInt(value ?? fallback);
}

function deploymentAddress(transaction: any): string | undefined {
  const decoded = transaction.txDataDecoded;
  if (decoded && "contractAddress" in decoded) {
    return decoded.contractAddress;
  }
  return transaction.recipient;
}

function isFinalized(transaction: any): boolean {
  const status = transaction?.statusName ?? transaction?.status;
  return status === "FINALIZED" || status === "Finalized" || status === 7 || status === "7";
}

function receiptMatchesHash(transaction: any, expectedHash: TransactionHash): boolean {
  if (!transaction || typeof transaction !== "object") return false;
  const expected = String(expectedHash).toLowerCase();
  const identifiers = ["hash", "txId", "tx_id", "transactionHash"]
    .map((key) => transaction[key])
    .filter((value): value is string => value !== undefined && value !== null && value !== "")
    .map((value) => String(value).toLowerCase());
  return identifiers.length > 0 && identifiers.every((identifier) => identifier === expected);
}

function hasSuccessfulExecution(transaction: any): boolean {
  if (transaction?.txExecutionResultName === "FINISHED_WITH_RETURN") return true;

  const leaderReceipt = transaction?.consensus_data?.leader_receipt?.find(
    (receipt: any) => receipt.mode === "leader",
  );
  return Boolean(
    leaderReceipt?.execution_result === "SUCCESS" &&
      leaderReceipt?.genvm_result?.raw_error == null &&
      leaderReceipt?.result?.status === "return",
  );
}

function isSuccessful(transaction: any): boolean {
  return isFinalized(transaction) && hasSuccessfulExecution(transaction);
}

function writeDeploymentState(statePath: string, state: Record<string, unknown>): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

async function waitForFinalization(runtimeClient: any, hash: TransactionHash): Promise<any> {
  if (typeof runtimeClient.waitForFinalization === "function") {
    return runtimeClient.waitForFinalization({ hash });
  }
  if (typeof runtimeClient.waitForTransactionReceipt === "function") {
    try {
      return await runtimeClient.waitForTransactionReceipt({ hash });
    } catch {
      return runtimeClient.waitForTransactionReceipt(hash);
    }
  }
  if (typeof runtimeClient.waitForDecision === "function") {
    try {
      return await runtimeClient.waitForDecision({ hash });
    } catch {
      return runtimeClient.waitForDecision(hash);
    }
  }
  throw new Error("The connected GenLayer CLI does not expose a transaction wait method");
}

export default async function main(client: GenLayerClient<any>) {
  const filePath = path.resolve(process.cwd(), "contracts/stratasure.py");
  const profilePath = path.resolve(process.cwd(), "frontend/fee-profile.json");
  const statePath = path.resolve(process.cwd(), "deploy/.last-deployment.json");

  try {
    const contractCode = new Uint8Array(readFileSync(filePath));
    const profile = JSON.parse(readFileSync(profilePath, "utf8")) as FeeProfile;
    const deployProfile = profile.deploy;
    if (!deployProfile) {
      throw new Error(`Fee profile is missing deploy data: ${profilePath}`);
    }

    const rotation = readBigInt(deployProfile.rotationsPerRound);
    const profileOptions = {
      leaderTimeunitsAllocation: readBigInt(deployProfile.leaderTimeunitsAllocation),
      validatorTimeunitsAllocation: readBigInt(deployProfile.validatorTimeunitsAllocation),
      executionBudgetPerRound: readBigInt(deployProfile.executionBudgetPerRound),
      totalMessageFees: readBigInt(deployProfile.totalMessageFees),
      rotations: [rotation, rotation],
    };
    const runtimeClient = client as any;
    let fees: { distribution: any; feeValue?: any } | undefined;
    if (typeof runtimeClient.estimateTransactionFees === "function") {
      try {
        const estimate = await runtimeClient.estimateTransactionFees(profileOptions);
        fees = { distribution: estimate.distribution, feeValue: estimate.feeValue };
      } catch (error) {
        if (!String(error).includes("sim_getFeeConfig")) {
          throw error;
        }
        console.warn("The selected Studio network is gasless or does not expose fee configuration; submitting with network defaults.");
      }
    } else if (typeof runtimeClient.estimateFeesDistribution === "function") {
      fees = { distribution: await runtimeClient.estimateFeesDistribution(profileOptions) };
    } else {
      console.warn("The connected GenLayer CLI does not expose fee estimation; submitting with network defaults.");
    }

    const deployTransaction = await client.deployContract({
      code: contractCode,
      args: [],
      ...(fees ? { fees } : {}),
    });
    const submittedHash = deployTransaction as TransactionHash;

    writeDeploymentState(statePath, { hash: submittedHash, status: "submitted" });

    let transaction: any;
    try {
      transaction = await waitForFinalization(runtimeClient, submittedHash);
    } catch (waitError) {
      writeDeploymentState(statePath, {
        hash: submittedHash,
        status: "pending_receipt",
        error: `Deployment receipt is pending: ${String(waitError)}`,
      });
      throw new Error(`Deployment receipt is pending for transaction ${submittedHash}: ${String(waitError)}`);
    }

    if (!isFinalized(transaction)) {
      writeDeploymentState(statePath, {
        hash: submittedHash,
        status: "pending_receipt",
        error: "Deployment transaction has not reached FINALIZED.",
      });
      throw new Error(`Deployment transaction ${submittedHash} has not reached FINALIZED.`);
    }

    if (!receiptMatchesHash(transaction, submittedHash)) {
      writeDeploymentState(statePath, {
        hash: submittedHash,
        status: "pending_receipt",
        error: "Receipt identifier did not match the submitted deployment transaction.",
      });
      throw new Error(`Receipt for deployment transaction ${submittedHash} did not match the submitted hash.`);
    }

    if (!isSuccessful(transaction)) {
      writeDeploymentState(statePath, { hash: submittedHash, status: "failed" });
      throw new Error(`Deployment failed. Transaction: ${JSON.stringify(transaction)}`);
    }

    const contractAddress = deploymentAddress(transaction);
    if (!contractAddress) {
      writeDeploymentState(statePath, { hash: submittedHash, status: "pending_receipt" });
      throw new Error("Deployment transaction did not contain a contract address");
    }

    if (typeof runtimeClient.getContractSchema !== "function" || typeof runtimeClient.getContractCode !== "function") {
      writeDeploymentState(statePath, {
        hash: submittedHash,
        status: "pending_receipt",
        contractAddress,
        error: "The connected client cannot verify deployed schema and code.",
      });
      throw new Error("The connected client cannot verify deployed schema and code.");
    }

    let schema: any;
    let code: any;
    try {
      schema = await runtimeClient.getContractSchema(contractAddress);
      code = await runtimeClient.getContractCode(contractAddress);
    } catch (verificationError) {
      writeDeploymentState(statePath, {
        hash: submittedHash,
        status: "pending_receipt",
        contractAddress,
        error: `Deployed metadata verification failed: ${String(verificationError)}`,
      });
      throw new Error(`Deployed metadata verification failed: ${String(verificationError)}`);
    }

    if (!schema || typeof schema !== "object" || !schema.methods || typeof schema.methods !== "object" || Object.keys(schema.methods).length === 0) {
      writeDeploymentState(statePath, {
        hash: submittedHash,
        status: "pending_receipt",
        contractAddress,
        error: "Deployed contract schema contains no methods.",
      });
      throw new Error("Deployed contract schema contains no methods.");
    }

    if (typeof code !== "string" || code.length === 0) {
      writeDeploymentState(statePath, {
        hash: submittedHash,
        status: "pending_receipt",
        contractAddress,
        error: "Deployed contract code is empty or unavailable.",
      });
      throw new Error("Deployed contract code is empty or unavailable.");
    }

    writeDeploymentState(statePath, {
      hash: submittedHash,
      status: "finalized",
      contractAddress,
      schemaMethods: Object.keys(schema.methods),
      codeLength: code.length,
    });

    console.log(`Contract deployed at address: ${contractAddress}`);
  } catch (error) {
    throw new Error(`Error during deployment: ${error}`);
  }
}
