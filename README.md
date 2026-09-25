<div align="center">
  <img src="frontend/public/favicon.svg" alt="StrataSure logo" width="88" />
  <h1>StrataSure</h1>
  <p>Evidence-led parametric insurance on GenLayer.</p>
</div>

StrataSure is a GenLayer parametric insurance protocol that settles policies from objective, independently verified real-world evidence.

## At a glance

| Area | Current implementation |
| --- | --- |
| Contract | Initial `StrataSure` release in `contracts/stratasure.py` |
| Runtime | GenLayer `GenVM` with pinned Studionet runner |
| Evidence | NASA POWER drought and USGS earthquake sources |
| Settlement | Binary GEN payout after finalized consensus |
| Frontend | Next.js policy desk with evidence and transaction activity |
| Network | Studionet, chain ID `61999` |
| Latest contract | `0xDa96b0e8EaD84f2bFDC984d13710D42B620Ea0a9` |

## Current status

The current Studionet deployment under test is `0xDa96b0e8EaD84f2bFDC984d13710D42B620Ea0a9`, running the initial `StrataSure` release. Deployment transaction `0x9580af882cd1e658deb43aada45c2104afefd5ee1764a710ff63976ef5275afc` finalized successfully; deployed schema and code were verified.

Implemented now:

- Stable Studionet `py-genlayer:1jb45...` contract API and pinned deployment CLI.
- Frontend and deployment scripts use the compatible `genlayer-js 1.1.8` client.
- `StrataSure` Intelligent Contract with fixed NASA POWER drought and USGS earthquake sources.
- Owner-controlled risk pool funding, excess withdrawal, and coverage accounting.
- Immutable policy terms, canonical source URLs, evidence commitments, and verification IDs.
- Leader/validator evaluation with independent web fetches and complete decision-field comparison.
- Drought precipitation and earthquake magnitude evaluation.
- Policy state transitions for `TRIGGERED`, `NOT_TRIGGERED`, and `EXPIRED`.
- Finalized GEN payout messages, duplicate-evaluation protection, and owner-only settlement controls.
- Hosted Studionet smoke tests for funding, policy creation, evidence, payout, expiry, and rollback paths.
- Persistent frontend transaction activity with receipt recovery and hash correlation.
- Modern StrataSure policy desk with Overview, Policies, Create policy, How it works, and Activity views.
- My Policies, Active, Settled, and Expired filter tabs with focused post-create navigation.
- Coverage-aware Evaluate controls: locked before the end date, loading during evaluation, and consensus Detail modal after settlement.
- Direct tests with mocked source responses and validator disagreement checks.
- Direct tests run against the pinned stable runner with a process-local `genlayer-test` compatibility bridge.
- GLSim integration tests with deterministic NASA/USGS web mocks, finalized evaluation, payout-state, and rollback checks.
- Windows GLSim compatibility launcher and repeatable fee-profile workflow.

Pending:

- Post-deployment write smoke tests with a funded operational account.
- Fee-enabled Studio profiling; the checked-in localnet profile is zero-valued because GLSim is gasless.
- Keeper/relayer scheduling.
- Production DApp workflows, independent fallback sources, and source-outage policy.
- Security, actuarial, and legal review.

## Project structure

```text
contracts/
tests/
  direct/
  integration/
frontend/
  app/
  components/
  lib/
  public/
deploy/
tools/
config/
gltest.config.yaml
AGENTS.md
```

## Requirements

- Python 3.12+
- Node.js 20.9+
- GenLayer CLI for Studio and deployment
- Docker for local GenLayer Studio

Install Python dependencies:

```shell
python -m pip install -r requirements.txt
```

## Contract

The current contract is `contracts/stratasure.py`.

Current methods:

```text
fund_pool()
create_policy(...)
evaluate_policy(policy_id)
expire_policy(policy_id)
withdraw_excess(amount)
get_policy(policy_id)
get_evaluation(policy_id)
get_pool_balance()
get_withdrawable_balance()
get_total_coverage()
get_total_premiums()
get_policy_count()
get_contract_info()
get_source_catalog()
get_risk_summary()
```

The current source mapping is fixed in the contract:

```text
DROUGHT -> NASA_POWER
EARTHQUAKE -> USGS
```

External evidence is fetched only inside non-deterministic blocks from fixed canonical URLs. The stored policy terms include the exact source URL and terms commitment; evaluations return an evidence commitment and verification ID. Validators independently re-fetch and compare all decision-bearing fields before deterministic state changes or finalized payouts occur.

## Policy lifecycle

```text
Fund risk pool
      ↓
Create policy → ACTIVE
      ↓
Coverage end date reached
      ↓
Evaluate evidence → leader + validators reach consensus
      ↓
TRIGGERED → finalized GEN payout
NOT_TRIGGERED → no payout
      ↓
EXPIRED when coverage ends without evaluation
```

The frontend keeps policy state, evidence commitments, verification IDs, transaction hashes, and receipt status visible without asking users to infer settlement from a success label.

## Development workflow

Lint the contract:

```shell
genvm-lint check contracts/stratasure.py
```

Run direct tests:

```shell
pytest tests/direct/ -v
```

Run integration tests with GLSim without Docker:

```shell
python tools/run_glsim_windows.py --no-browser --validators 5
```

In a second terminal:

```shell
gltest tests/integration/ -v -s
```

Generate or refresh the fee profile:

```shell
npm run test:fees
```

Run the same tests against Studio or another configured network:

```shell
gltest tests/integration/ -v -s --network localnet
```

Start the frontend after installing its dependencies:

```shell
cd frontend
npm install
npm run dev
```

## Vercel deployment

Import `https://github.com/dhozil/stratasure` as a Vercel project with these settings:

- Root Directory: `frontend`
- Framework Preset: Next.js
- Install Command: `npm install`
- Build Command: `npm run build`
- Output: Next.js default output
- Node.js: 20 or newer

Add these environment variables in Vercel for Preview and Production:

```text
NEXT_PUBLIC_GENLAYER_RPC_URL=/api/genlayer-rpc
GENLAYER_RPC_URL=https://studio.genlayer.com/api
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61999
NEXT_PUBLIC_GENLAYER_CHAIN_NAME=GenLayer Studio Network
NEXT_PUBLIC_GENLAYER_SYMBOL=GEN
NEXT_PUBLIC_CONTRACT_ADDRESS=0xDa96b0e8EaD84f2bFDC984d13710D42B620Ea0a9
NEXT_PUBLIC_EXPLORER_URL=https://explorer-studio.genlayer.com/
```

Do not commit `.env.local`. The checked-in `frontend/.env.example` is the deployment template; replace the contract address if a different network or contract is selected.

## Documentation

- GenLayer documentation: https://docs.genlayer.com/
- GenLayer web access: https://docs.genlayer.com/developers/intelligent-contracts/features/web-access
- Equivalence Principle: https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle
- GenLayerJS: https://docs.genlayer.com/api-references/genlayer-js

## License

This project uses the repository license in `LICENSE`.
