# AGENTS.md — StrataSure

## Project Identity

- Project: StrataSure
- Working project name: `stratasure`
- Contract name: `StrataSure`
- Workspace: `D:\Genlayer-project\paramatic-insurance`
- First implementation milestone: Phase 1 official GenLayer boilerplate scaffold, followed by a deterministic policy skeleton.
- Current status: Stable Studionet MVP contract and hosted smoke tests are complete; evidence commitments, full validator comparison, excess withdrawal, receipt recovery, and stable-runner direct-test compatibility are implemented. Fee-enabled profiling, keeper scheduling, source fallback, and production hardening are pending.
- Created: 2026-09-24
- Primary language for contract: Python
- Primary chain/protocol: GenLayer
- Primary execution environment: GenVM

## Mission

Build a parametric insurance application that pays policyholders when a predefined real-world event or measurable condition is met, using reliable public data and GenLayer validator consensus.

Initial product direction:

- Pay based on an objective trigger rather than manual assessment of actual physical loss.
- Support drought and natural-disaster conditions.
- Fetch external evidence directly from allowlisted public web APIs.
- Have GenLayer validators independently verify the proposed result.
- Enforce an automatic on-chain payout after finalization.
- Keep the trigger, payout formula, source selection, and evidence auditable.

This is a technical settlement and adjudication system. It is not a replacement for insurance regulation, legal agreements, underwriting, solvency capital, or a court process.

## Current Workspace State

The workspace now contains the official GenLayer project boilerplate structure and the full MVP `StrataSure` contract.

Implemented files:

- `contracts/stratasure.py`
- `tests/direct/test_stratasure.py`
- `tests/integration/test_stratasure.py`
- `deploy/deployScript.ts`
- `README.md`
- `CLAUDE.md`
- Updated frontend scaffold and package metadata

The contract now fetches NASA POWER precipitation data and USGS earthquake data inside non-deterministic blocks, stores immutable policy terms and canonical source URLs, creates evidence commitments and verification IDs, runs complete leader/validator comparison, updates policy status, accounts for risk-pool coverage and excess withdrawals, and emits GEN payouts only on finalized execution.

The project uses the official `v2-dev` contract API with pinned runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`. Do not mix the v0.2 `from genlayer import *` API with the v0.3 `import genlayer as gl` API.

The project currently uses immutable release-candidate pins `genlayer-py v0.19.0-rc.2`, `genlayer-test v0.30.0-rc.2`, and `genvm-linter v0.11.1-rc.2`, corresponding to the active GenLayer development branches. These pins must be reviewed against the target network before production deployment.

## Confirmed Technology Direction

### Intelligent Contract

- Use Python Intelligent Contracts executed in GenVM.
- Use `gl.nondet.web` for external HTTP/API access.
- Use `gl.nondet.exec_prompt` only when natural-language interpretation is genuinely required.
- Use `gl.vm.run_nondet` with an explicit leader/validator implementation for the primary evidence workflow. In the v0.3 API, this is the unsafe custom leader/validator path.
- Use `gl.vm.run_nondet` or an explicitly justified equivalence wrapper.
- Use `strict_eq` only for stable, canonicalized deterministic outputs.
- Never use `strict_eq` for live weather readings, changing API responses, random data, or LLM output.
- Use `gl.u256` for GEN amounts and persistent numeric values.
- Use `gl.storage.TreeMap`, `gl.storage.DynArray`, fixed-size integer types, and storage-compatible custom types for persistent state.
- Use `@gl.public.write.payable` for premium and risk-pool funding methods.
- Send external payouts only after finalization using `on="finalized"`.
- Make payout processing idempotent and prevent duplicate policy evaluation payouts.

### Frontend and SDK

- Use the current official GenLayer project boilerplate.
- Prefer the current official stack documented by the boilerplate: Next.js, TypeScript, and GenLayerJS.
- Use GenLayerJS for contract reads, writes, transaction tracking, decision waiting, and finalization.
- Treat `ACCEPTED` or `FINALIZED` transaction status as insufficient proof of successful execution; also verify the transaction execution result.
- Persist transaction IDs immediately after submission and resume tracking after timeouts or process restarts.
- Use a checked-in fee profile for repeatable deployment and write fee estimates when applicable.

### Testing

Use the following progression whenever contract behavior changes:

```text
genvm-lint check contracts/<contract-file>.py
pytest tests/direct/ -v
gltest tests/integration/ -v -s
```

Additional test environments:

- Direct mode for fast tests with mocked web and LLM calls.
- Local GLSim for fast integration iteration when compatible.
- Local GenLayer Studio for real GenVM and consensus behavior.
- Public testnet only after local and Studio tests pass.

## MVP Scope

The recommended MVP is deliberately narrow:

1. Drought insurance.
2. Earthquake insurance as the second peril.
3. Indonesia as the initial geographic context, unless requirements change.
4. GEN as the initial payout asset.
5. One risk pool funded by an underwriter or fund manager.
6. Permissionless evaluation after the observation period.
7. Binary or small tiered payout formula with no AI-selected payout amount.

The following MVP details are proposed defaults and must be confirmed before implementation:

- Target location: Indonesia.
- Initial peril: drought.
- Additional peril: earthquake.
- Primary drought sources: NASA POWER and NOAA CHIRPS.
- SPI may be used as an additional reference or later trigger.
- Earthquake source: USGS Earthquake Catalog API.
- Multi-hazard source: GDACS.
- Payout asset: native GEN.
- Evaluation trigger: keeper/relayer or any authorized caller submits `evaluate_policy`.
- Payout timing: only after GenLayer finalization.
- Product mode: prototype/MVP unless legal and risk requirements are separately approved.

## Proposed System Architecture

```text
Frontend / DApp
      |
      | create policy, fund pool, submit evaluation
      v
StrataSure Intelligent Contract
      |
      | non-deterministic block
      +--> Fetch allowlisted NASA/USGS/GDACS/other API
      +--> Parse response
      +--> Extract stable structured evidence
      +--> Calculate trigger result
      |
      v
Leader result
      |
      v
Validator committee
      |
      +--> Independently fetch same evidence
      +--> Independently calculate trigger
      +--> Compare decision-bearing fields
      |
      v
GenLayer consensus
      |
      +--> Not triggered: no payout
      +--> Triggered: update state and emit finalized payout
      +--> Undetermined: no unsafe state transition
```

The contract must own consensus-critical state transitions. The frontend may prepare inputs, display evidence, and improve UX, but it must not compute the final trusted result and submit that result as if the contract had verified it.

## Policy Lifecycle

The intended lifecycle is:

1. Underwriter funds the risk pool.
2. Policyholder pays a premium.
3. Policy is created with immutable coverage terms.
4. Observation period begins.
5. Evaluation is submitted after the observation period.
6. Leader fetches and evaluates evidence.
7. Validators independently evaluate the evidence.
8. Consensus accepts, rejects, or leaves the transaction undetermined.
9. If triggered, the policy status becomes `TRIGGERED`.
10. Payout is emitted only after finalization.
11. If not triggered, the policy becomes `NOT_TRIGGERED`.
12. If the policy expires without a valid evaluation, it becomes `EXPIRED` only when the contract's expiration rules allow it.

A protocol-level `UNDETERMINED` result must not be confused with a successful no-payout result. If consensus is not reached, unsafe financial state must not change.

Suggested policy state values:

```text
ACTIVE
TRIGGERED
NOT_TRIGGERED
EXPIRED
```

If additional states are introduced, define exactly when they are written and whether they are protocol statuses or persistent policy states.

## Core Data Model

A policy should preserve at least:

```text
policy_id
insured_address
peril
location
latitude
longitude
coverage_start
coverage_end
source_id
source_policy_version
observation_window
threshold
payout_amount
premium
status
evaluation_timestamp
evidence_timestamp
evidence_id
observed_value
triggered
payout_amount_actual
```

Design rules:

- Fix the source and trigger when the policy is created.
- Do not allow the insured or evaluator to submit arbitrary source URLs after purchase.
- Do not silently change the source, geography, period, or threshold.
- Store only compact evidence and decision fields, not complete HTML pages or large API responses.
- Keep audit information sufficient to reconstruct why the payout was or was not made.
- Use fixed-size integer types and storage-compatible structures for all persistent numeric values.

## Drought Design

Recommended initial trigger:

```text
total precipitation during the observation window
< policy.threshold_mm
```

The observation window and threshold must be chosen through historical analysis before production use.

Candidate data sources:

- NASA POWER for meteorological and precipitation data.
- NOAA CHIRPS for independent rainfall cross-checking.
- NOAA CPC Standardized Precipitation Index for drought classification or later product design.

For the MVP, prefer deterministic calculation over an LLM decision:

```text
fetch data
validate data shape
calculate total precipitation
compare total precipitation with threshold
return TRIGGERED or NOT_TRIGGERED
```

Only add an LLM when the product deliberately uses natural-language policy terms or conflicting-source interpretation.

## Earthquake Design

Recommended initial trigger:

```text
an event exists within the policy window and region
AND magnitude >= policy.threshold
```

Primary source:

- USGS Earthquake Catalog API.

Required evidence fields:

- Stable event identifier.
- Event timestamp.
- Latitude and longitude.
- Magnitude.
- Source URL or source identifier.
- Whether the event is within the policy region and time window.

Validators should independently derive the same decision. Do not let an LLM decide the magnitude threshold when the API already provides a structured magnitude value.

## Natural-Disaster Expansion

After the MVP is stable, add other perils one at a time:

- Flood.
- Tropical cyclone.
- Extreme heat.
- Wildfire.
- Volcano.

Use a fixed peril registry inside the contract or a fixed source mapping. Do not permit arbitrary URL interpretation in early versions.

GDACS can be used for multi-hazard alerts and geospatial event information. NOAA or other official agencies can be used where they provide a more authoritative trigger for a specific peril.

## Equivalence and Consensus Rules

The default consensus pattern is:

1. `leader_fn` fetches the same allowlisted source or sources.
2. The leader extracts only stable, decision-relevant fields.
3. The leader calculates the trigger and payout tier.
4. The leader returns a small structured result.
5. `validator_fn` fetches the evidence independently.
6. The validator calculates the result independently.
7. The validator compares decision fields, not incidental prose.
8. The validator rejects malformed or unsupported results.
9. A majority accepts the leader result only when the contract's equivalence condition is satisfied.

Compare these fields strictly:

- Triggered or not triggered.
- Payout tier.
- Source-confirmed status.
- Event identifier when it is stable and necessary.
- Observed value only when it is stable.

Use tolerance for values that can legitimately vary, such as:

- Current temperature.
- Current rainfall.
- Current wind.
- Rounded model outputs.

Do not use broad numeric tolerance for a critical binary trigger near the threshold. Define a deterministic boundary and fail safely when the result is ambiguous.

### LLM Policy

- Use LLM output only when the decision is genuinely subjective or natural-language based.
- Request JSON with a fixed schema.
- Validate types, ranges, and allowed enum values.
- Treat web content and user-submitted text as untrusted.
- Do not allow web content to redefine the contract's payout rules.
- Do not use a schema-only validator as a substitute for independent evidence verification.
- Prefer programmatic checks before LLM judgment.
- Return concise reasoning only when needed; compare decision fields, not prose.

## Web Data Safety

Every web integration must:

- Use a fixed allowlist or fixed source mapping.
- Check HTTP status codes.
- Handle timeouts and transient failures.
- Handle empty responses and malformed JSON.
- Validate the expected response shape.
- Reject unexpected data types.
- Avoid comparing timestamps, cache values, counters, or other volatile fields.
- Store only the evidence fields needed for the decision.
- Use multiple independent sources for high-value policies where practical.
- Define a fallback when a primary source is unavailable.
- Never treat unavailable evidence as a confirmed denial unless the policy explicitly defines that rule.
- Use source timestamps and the policy observation window, not only the current transaction time.

GenLayer consensus validates an output under the contract's equivalence rule. It does not automatically make an external API correct, immutable, or trustworthy.

## Time and Scheduling

GenVM transaction time is deterministic and pinned to the transaction timestamp. It is not the validator's real wall-clock time.

Rules:

- Use the transaction timestamp for deterministic expiry arithmetic.
- Use evidence timestamps from the external source for observation validity.
- Do not assume `datetime.now()` means the current real-world time at validator execution.
- Add a keeper/relayer/backend service to submit evaluations after observation windows.
- Keep the evaluation method permissionless where possible, but protect policy creation and risk-pool administration.

## Financial and Product Safety

Parametric insurance has basis risk: the trigger can fire without equivalent actual loss, or fail to fire despite real loss.

Before production, define and test:

- Geographic basis risk.
- Temporal basis risk.
- Data gaps.
- Source outages.
- Model error.
- Threshold calibration.
- Payout tier fairness.
- Maximum aggregate exposure.
- Risk-pool solvency.
- Reinsurance or capital backstop.
- Expiry behavior.
- Refund behavior.
- Duplicate evaluation behavior.
- Appeal behavior.

The contract must not create insurance solvency by itself. An underwriter or capital provider must fund the risk pool.

## Suggested Contract API

The exact API should be finalized from the current official GenLayer documentation before implementation. A likely API shape is:

### Administrative and funding

```text
fund_pool()
withdraw_owner_funds()
```

Use only if the product requires a managed risk pool and ownership rules are explicit.

### Policy

```text
create_policy(...)
cancel_policy(policy_id)
expire_policy(policy_id)
```

Policy creation should validate:

- Valid peril.
- Valid source mapping.
- Valid coordinates.
- Valid observation window.
- Positive threshold.
- Positive coverage amount.
- Positive premium.
- Sufficient pool exposure.
- Owner or underwriter authorization.

### Evaluation

```text
evaluate_policy(policy_id)
```

Evaluation should be permissionless after the observation period unless the product requires a different rule.

### Views

```text
get_policy(policy_id)
get_pool_balance()
get_total_policies()
get_policy_count()
get_evaluation(policy_id)
```

Do not expose an arbitrary URL evaluation method in the MVP.

## Error Handling

Classify errors into categories:

- Expected business errors: invalid policy, expired policy, insufficient pool, duplicate payout.
- External data errors: HTTP 4xx, malformed source, missing required field.
- Transient errors: timeout, HTTP 5xx, rate limit, temporary source outage.
- Consensus errors: validators cannot agree.
- LLM errors: malformed or unsupported model output.

Expected business errors should be deterministic and clearly defined. Transient source failures should normally cause disagreement or retry rather than a false denial. LLM output errors should usually be rejected so a different leader or model can be selected.

## GenLayer Documentation Compliance Rule

Before implementing or changing any GenLayer feature, consult the current official documentation. Do not rely only on this file or on memory.

Primary documentation:

- Main documentation: https://docs.genlayer.com/
- Developer documentation: https://docs.genlayer.com/developers
- Introduction to Intelligent Contracts: https://docs.genlayer.com/developers/intelligent-contracts/introduction
- When to use GenLayer: https://docs.genlayer.com/developers/intelligent-contracts/when-to-use-genlayer
- First contract: https://docs.genlayer.com/developers/intelligent-contracts/first-intelligent-contract
- Web access: https://docs.genlayer.com/developers/intelligent-contracts/features/web-access
- Calling LLMs: https://docs.genlayer.com/developers/intelligent-contracts/features/calling-llms
- Non-determinism: https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism
- Equivalence Principle: https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle
- Prompt and data techniques: https://docs.genlayer.com/developers/intelligent-contracts/crafting-prompts
- Storage: https://docs.genlayer.com/developers/intelligent-contracts/storage
- Error handling: https://docs.genlayer.com/developers/intelligent-contracts/features/error-handling
- Value transfers: https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers
- Messages: https://docs.genlayer.com/developers/intelligent-contracts/features/messages
- Transaction context and time: https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context
- Tooling setup: https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup
- Testing: https://docs.genlayer.com/developers/decentralized-applications/testing
- Writing data: https://docs.genlayer.com/developers/decentralized-applications/writing-data
- Querying transactions: https://docs.genlayer.com/developers/decentralized-applications/querying-a-transaction
- Deploying: https://docs.genlayer.com/developers/intelligent-contracts/deploying
- Fees and fee profiles: https://docs.genlayer.com/developers/decentralized-applications/fee-profiling-and-estimation

Documentation precedence rules:

1. Current official GenLayer documentation wins over this file.
2. Current official SDK/API reference wins over old examples.
3. Current official boilerplate wins over older community projects.
4. If a previously documented API has changed, update this file and the implementation together.
5. Do not copy deprecated or unverified patterns merely because they appear in a community repository.
6. Record important documentation changes in the activity log below.
7. When deployment, transaction execution, or contract tests fail, read the current official GenLayer documentation and SDK/runtime references first, inspect the exact receipt/error, and compare the runner, contract API, network, and CLI versions before retrying.

## Development Workflow

For every implementation change:

1. Read this file.
2. Read the relevant current GenLayer documentation.
3. Inspect neighboring project code and tests.
4. Identify whether the operation is deterministic or non-deterministic.
5. Define the leader/validator behavior before writing the contract.
6. Implement the smallest testable change.
7. Add direct tests, including web/LLM mocks where relevant.
8. Run `genvm-lint`.
9. Run direct tests.
10. Run integration tests against Studio or the appropriate test environment.
11. Check transaction execution result, not only consensus status.
12. Update this file if the architecture, scope, source, or public API changes.
13. Add an activity-log entry for meaningful work.

Never:

- Add non-deterministic web or LLM calls outside the required non-deterministic block.
- Write storage from inside a non-deterministic block.
- Emit messages from inside a non-deterministic block.
- Trust the leader result without independent verification.
- Use `strict_eq` for variable external data.
- Allow users to choose arbitrary source URLs.
- Store private keys, seed phrases, API secrets, or credentials in the repository.
- Add comments unless the user or project owner explicitly requests them.
- Claim the project is production-ready before legal, actuarial, security, and integration review.

## Implementation Roadmap

### Phase 0 — Requirements and risk specification

- Confirm initial geography.
- Confirm first peril.
- Confirm trigger formula.
- Confirm payout asset.
- Confirm risk-pool funding model.
- Confirm whether the MVP is a demo, pilot, or production product.
- Define source outage and expiry behavior.
- Define basis-risk tolerance.

### Phase 1 — Official project scaffold

- Clone or use the official GenLayer project boilerplate.
- Verify current Python, Node, GenLayer CLI, GenLayer test, and Studio requirements.
- Keep the project structure aligned with the current official boilerplate.
- Remove or replace the boilerplate football example only after understanding its conventions.
- Record the pinned GenLayer runner and dependency versions used by the project.

### Phase 2 — Product and source specification

- Define the peril registry.
- Define source IDs and fixed source URLs.
- Define the policy schema.
- Define the payout formula.
- Define the state machine.
- Define error behavior.
- Define evidence retention and audit fields.
- Perform historical data analysis and threshold backtesting.

### Phase 3 — Contract implementation

- Implement deterministic policy and pool logic.
- Implement one drought data adapter.
- Implement leader and validator functions.
- Implement structured evidence output.
- Implement consensus-safe state updates.
- Implement finalized payout messaging.
- Implement expiry and duplicate-payout protection.

### Phase 4 — Test suite

- Add direct tests for all deterministic policy rules.
- Add mocked web tests for valid, missing, malformed, and failed API responses.
- Add mocked source-conflict tests.
- Add threshold-boundary tests.
- Add consensus disagreement tests.
- Add integration tests for finalization and payout.
- Add transaction result verification tests.

### Phase 5 — Frontend

- Build policy creation UI.
- Add location and coordinate input.
- Display fixed source and trigger terms.
- Add premium and pool status.
- Add policy history and evidence display.
- Add transaction lifecycle tracking.
- Add finalized payout status.
- Add clear handling for `UNDETERMINED` and failed execution.

### Phase 6 — Deployment readiness

- Run local Studio and public testnet tests.
- Generate and review fee profiles.
- Perform security review.
- Perform actuarial and basis-risk review.
- Perform legal and regulatory review.
- Define monitoring, incident response, and source fallback procedures.
- Do not enable real-value payouts until all required approvals are complete.

## Official References

### GenLayer

- https://docs.genlayer.com/
- https://docs.genlayer.com/developers
- https://docs.genlayer.com/understand-genlayer-protocol/typical-use-cases
- https://docs.genlayer.com/developers/intelligent-contracts/when-to-use-genlayer
- https://github.com/genlayerlabs/genlayer-project-boilerplate

### Data sources

- NASA POWER API documentation: https://power.larc.nasa.gov/docs/services/api
- NASA POWER API pages: https://power.larc.nasa.gov/api/pages
- USGS Earthquake Catalog API: https://earthquake.usgs.gov/fdsnws/event/1/
- GDACS API Swagger: https://www.gdacs.org/gdacsapi/swagger/index.html
- NOAA CPC Standardized Precipitation Index: https://www.cpc.ncep.noaa.gov/products/Drought/Monitoring/spi-global.shtml

### Parametric insurance research

- World Bank Global Index Insurance Facility: https://documents.worldbank.org/en/publication/documents-reports/documentdetail/099059208162458731
- World Bank parametric disaster insurance: https://thedocs.worldbank.org/en/doc/955891559250091694-0340022019/original/publicationdiasterinsurancenewparametriccontractsbasedonsatelliteimagesbestpapericlr201905.pdf
- IAIS parametric insurance research: https://www.iais.org/uploads/2024/12/FSI-IAIS-Insights-on-parametric-insurance.pdf
- CRS parametric disaster insurance: https://www.congress.gov/crs-product/IN12670

### Community examples — reference only

These repositories are not official GenLayer documentation and are not automatically production-safe:

- https://github.com/wwh001217/genlayer-insurance-adjudicator
- https://github.com/GIFTEDLOV/genlayer-weather-insurance

Use them only to study possible patterns. Verify every API, runner version, consensus rule, storage type, and payout mechanism against current official documentation.

## Open Decisions

These decisions are not finalized:

- Initial country and exact coverage area.
- First peril: drought, earthquake, or both.
- Whether drought uses cumulative precipitation, SPI, soil moisture, temperature, or a multi-trigger rule.
- Exact observation period and threshold.
- Primary and fallback sources.
- Payout formula: binary, linear, tiered, or layered.
- Payout asset: GEN only or EVM token support.
- Risk-pool owner and capital model.
- Whether the policyholder files a claim or evaluation is fully automatic.
- Whether a keeper/relayer is required.
- Whether policy creation is permissioned or public.
- Whether the first release includes a frontend.
- Whether the product is a demo, pilot, or production deployment.

Do not silently resolve these decisions in code. Record the decision and its rationale in this file before implementing the affected behavior.

## Activity Log

### 2026-09-24 — Research and planning

- Read the current GenLayer documentation home page and developer documentation.
- Mapped GenLayer Chain, validator nodes, GenVM, Intelligent Contracts, non-deterministic blocks, and the Equivalence Principle.
- Reviewed web access, LLM calls, storage, value transfers, messages, transaction context, testing, deployment, and fee profiling.
- Reviewed GenLayer's parametric insurance use case and identified it as a valid technical fit when the result requires external evidence and shared adjudication.
- Reviewed parametric insurance references from the World Bank, IAIS, and CRS.
- Reviewed official data-source references from NASA POWER, NOAA CHIRPS/CPC, USGS, and GDACS.
- Recommended a narrow MVP focused on drought insurance, with earthquake insurance added after the first flow is stable.
- Decided that numeric trigger evaluation should be deterministic where possible and that LLM output should not directly choose the payout amount.
- Created this `AGENTS.md` to preserve the project plan and enforce current GenLayer documentation usage.

### 2026-09-24 — Official scaffold and deterministic skeleton

- Copied the official GenLayer project boilerplate from the `main` branch without its `.git` directory.
- Replaced the football contract and football-specific tests with `contracts/parametric_insurance.py` and `tests/direct/test_parametric_insurance.py`.
- Added owner-only risk-pool funding, fixed peril-to-source mapping, coordinate and coverage-window validation, premium validation, coverage accounting, and policy views.
- Added a Studio integration skeleton at `tests/integration/test_parametric_insurance.py`.
- Updated the deployment script, README, frontend placeholder, package names, and environment template for Parametric Insurance.
- Ran `genvm-lint lint contracts/parametric_insurance.py` successfully.
- Ran `pytest tests/direct/ -v` successfully with 39 passing tests.
- Ran `npm run lint` and `npm run build` successfully.
- Semantic `genvm-lint check` was attempted but could not complete because it began downloading a large GenVM SDK artifact; the fast linter and direct tests passed.

### 2026-09-24 — Full MVP contract implementation

- Migrated the contract to the official GenLayer `v2-dev` v0.3 API using `import genlayer as gl`, `gl.contract.Contract`, `gl.storage`, and the pinned `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` runner.
- Updated development dependencies to `genlayer-py v0.19-dev`, `genlayer-test v0.30-dev`, and `genvm-linter v0.11-dev`.
- Implemented NASA POWER precipitation evaluation with fixed-point parsing and threshold comparison.
- Implemented USGS earthquake evaluation with fixed geographic and magnitude queries.
- Implemented custom leader/validator comparison through `gl.vm.run_nondet`; validators independently re-fetch evidence and compare decision-bearing fields.
- Implemented policy states, evaluation storage, coverage accounting, expiry, duplicate-evaluation protection, and finalized GEN payout messages.
- Added direct tests for drought trigger/no-trigger, threshold boundary, earthquake trigger/no-trigger, evidence fields, expiry, validator agreement/disagreement, and malformed source rollback.
- `pytest tests/direct/test_parametric_insurance.py` passed with 20 tests.
- `npm run lint` and `npm run build` passed.
- `genvm-lint lint` passed; semantic `genvm-lint check` remains blocked because the local linter cache does not contain the pinned runner artifact.
- Added a Windows direct-runner workaround in `tests/direct/conftest.py` for `genlayer-test` deleting an open temporary message file after stdin replacement.
- `gltest tests/integration/ -v -s` was attempted but could not connect to Studio at `127.0.0.1:4000`; Studio is not running in the current environment.
- Starting `genlayer up --headless` was attempted but Docker Desktop is not running (`//./pipe/docker_engine` unavailable).
- `genvm-lint lint` passes with 3 checks; `validate`, `schema`, and `typecheck` require the missing pinned runner artifact. The linter's default Windows CP1252 output also needs `PYTHONIOENCODING=utf-8` to display its checkmark/cross symbols.
- GLSim was started on `127.0.0.1:4000` with five validators and reached consensus execution, but deployment failed because the Windows GenLayer test runner could not access its temporary runner file (`WinError 32`).
- Audited `genlayer-test 0.30.0rc2` and GLSim: Windows stdin unlink locking, v0.3 empty-string calldata selector handling, and GLSim transaction-value propagation are test-tool compatibility issues rather than contract issues. With process-local Windows patches, five-validator GLSim integration passed the fund-pool and policy-creation flow.
- Corrected the integration test's `gltest` view-call syntax to pass arguments as a list; the test now uses the current `genlayer-test` API.
- Final verification after the audit: `pytest tests/direct/ -v` passed 20 tests, `genvm-lint lint` passed, `npm run lint` passed, and `npm run build` passed.

### 2026-09-24 — Release-candidate dependency pin upgrade

- Replaced floating development-branch requirements with immutable tags: `genlayer-py v0.19.0-rc.2`, `genlayer-test v0.30.0-rc.2`, and `genvm-linter v0.11.1-rc.2`.
- Installed the pinned packages and verified `genvm-lint check` now completes successfully, including SDK validation for the pinned runner.
- Direct tests remain at 20 passing; `genvm-lint typecheck` and schema extraction complete with no blocking diagnostics; frontend lint and build pass.
- The pinned packages still contain the known Windows GLSim temporary-file issue; the process-local compatibility workaround remains required for integration testing on this host.

### 2026-09-24 — GLSim integration and fee workflow

- Added `tools/run_glsim_windows.py` to keep the Windows unlink, v0.3 calldata selector, and GLSim transaction-value compatibility patches process-local.
- Expanded integration coverage to four GLSim scenarios: fund/create, drought evaluation with evidence and finalized payout state, earthquake evidence, malformed-source rollback, and duplicate-evaluation protection.
- Added `npm run test:fees` and generated `frontend/fee-profile.json` from the finalized GLSim suite. The profile is explicitly a localnet, gasless profile with zero fee observations; it must be regenerated against fee-enabled Studio before production use.
- Updated `deploy/deployScript.ts` to estimate fees from the checked-in profile, persist the submitted transaction ID, verify finalized execution, and query deployed schema and code.
- Full Studio/GenVM validation and keeper/relayer scheduling remain pending; keeper authorization and account policy are still open product decisions.

### 2026-09-24 — StrataSure identity, contract redesign, and frontend

- Renamed the project and contract identity to `StrataSure`, moved the contract to `contracts/stratasure.py`, renamed direct/integration test files, and updated package, deployment, README, and frontend metadata.
- Product decisions confirmed for the redesign: two perils (`DROUGHT` and `EARTHQUAKE`), binary payout, permissionless evaluation, and an on-chain GEN risk pool.
- Added contract metadata views for protocol identity, source catalog, and risk summary while preserving fixed allowlisted sources and consensus-critical settlement rules.
- Rebuilt the frontend as a complete StrataSure experience with overview, policy creation, how-it-works, policy book, activity ledger, wallet/network states, evidence/source detail, transaction finalization, explorer links, and actionable error/empty states.
- Replaced the generic purple GenLayer scaffold styling with a geological strata visual system: basalt, lichen, copper, glacier, and field-instrument typography.
- Updated direct tests to the StrataSure path and verified the new contract views. Final verification after the rename passed: direct 20 tests, GLSim integration 4 tests, `genvm-lint check`, deploy TypeScript compile, frontend lint, and frontend build.
- Improved the StrataSure frontend layout to use a wider responsive content field and added animated evidence-flow lines plus a breathing objective-trigger core with reduced-motion support.
- Added a StrataSure favicon and web manifest, standardized cursor/focus behavior for interactive controls, audited disabled states and transaction guards, fixed stale threshold/radius behavior, and prevented no-op refresh/create actions.
- Replaced the single-provider wallet flow with MetaMask/Rabby provider detection, EIP-6963 announcements, explicit wallet selection, provider-specific network/account events, safe install links, and session-specific active-wallet persistence.
- Created and activated the dedicated `stratasure-deploy` GenLayer account for hosted deployment. The first hosted deploy transaction finalized with `invalid_contract`; the generated address has no deployed code, so it is not a successful deployment. Updated the deploy script to support older GenLayer CLI wait/estimation method variants for the next attempt.

### 2026-09-24 — Studionet deployment audit

- Read the current GenLayer network, deploy-script, fee-profiling, fee-outcome, and transaction-query documentation.
- Installed GenLayer CLI `0.40.0-rc.3` and explicitly retained the stable `studionet` preset at chain ID `61999`; no `studio-dev` deployment was performed.
- Studionet does not expose `sim_getFeeConfig`; the deploy script now treats that response as a gasless network condition and submits without a fee quote instead of failing before transaction creation.
- The new deployment transactions `0xa707d1f7e8cabc294e562eb917797b1a2beda859ac84e844a4a9f0d74b968d89` and `0x78de8dc041f941bcd078cfcccfc95ea6cbbe99784a4a5a8a79a99046391ad140` both finalized with `NO_MAJORITY`, zero rounds, and zero votes; neither produced a contract address.
- A leader-only deployment experiment was rejected as ineffective because Studionet returned `leader_only: false`; the workaround was reverted.
- Studionet deployment remains blocked by unavailable consensus execution, not by a verified contract execution result. Do not retry repeatedly until validator availability is confirmed.

### 2026-09-24 — Successful Studionet deployment

- Compared the successful Studionet deployment transaction `0x911f6da1b54e266a3165d1034375993bdb581133c1d59c2d1c830f76e167738d` and confirmed that `eth_getTransactionReceipt.contractAddress: null` is normal for GenLayer deploys; the created address is in `data.contract_address` and `recipient`.
- Migrated `contracts/stratasure.py` to the stable Studionet runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` and the stable `from genlayer import *` / `gl.Contract` API.
- Updated the deploy script to recognize legacy Studionet receipts where the leader receipt has `execution_result: SUCCESS` and `result.status: return`, while still accepting the newer top-level execution result.
- Deployed with `genlayer@0.39.2` to Studionet successfully: transaction `0x72031899ab566b06af8c3b1d6532d3bd04ccdb854767dac881ab18b39b4e0dd0`, contract address `0x5C378d9b5Bb9D8ad0D0b9E34BAdd1137c8961f4F`, status `FINALIZED`, consensus `MAJORITY_AGREE`, leader execution `SUCCESS`.
- `genvm-lint check contracts/stratasure.py` passes against runner `1jb45...`. Direct tests currently hit the known Windows direct-runner stdin issue with the stable runner and must not be treated as a hosted deployment failure.

### 2026-09-24 — Studionet full method smoke test and payout fix

- Exercised all public view methods, funding, policy creation, drought evaluation, earthquake evaluation, duplicate evaluation, expiry, and the finalized payout path on Studionet.
- Confirmed NASA POWER and USGS evidence reached consensus; the first drought trigger exposed a stable-runner incompatibility in the legacy `gl.chain.Account(...).emit_transfer` payout call.
- Updated payout settlement to use the documented external EVM interface for EOA recipients, passed `genvm-lint check`, and redeployed successfully with transaction `0xe3f88249dce0d5c5c4ddf1385458346b4661a88bd3f6951c646d9bf0be0103ea` at `0x2f17b55cAaa51b90762Eb68669Eb808b4766A847`.
- Re-tested the corrected contract: drought `TRIGGERED` finalized, policy payout state and pool accounting updated, child transfer `0xff9d040aea0e0e863f4c492ba988f97125388e1fb69cdc67bddc17fd9de70b1f` finalized, earthquake `NOT_TRIGGERED` finalized, and expired-policy coverage release finalized.
- Duplicate evaluation correctly rolled back with `[EXPECTED] Policy is not active`; the known CLI/SDK EVM receipt HTML issue remains, so `gen_getTransactionStatus` and safe GenLayerJS transaction reads were used for verification.

### 2026-09-24 — Evidence commitments, settlement controls, and receipt hardening

- Audited the project against prior GenLayer review feedback and applied the relevant insurance-specific controls without importing unrelated prediction, escrow, or dispute features.
- Added immutable canonical source URLs, policy terms commitments, evidence commitments, and verification IDs to the contract and evaluation responses; validators now compare all decision-bearing fields.
- Added owner-only excess withdrawal and withdrawable-balance view, with reserved coverage excluded from withdrawals.
- Hardened frontend and deployment receipt handling with persisted activity, pending-receipt recovery, finalized-state checks, and transaction hash correlation.
- Pinned Python GenLayer dependencies to commit SHAs, pinned the deployment CLI to `0.39.2`, aligned Node requirements with the frontend lockfile, and updated API documentation.
- Added adversarial validator, source-outage, withdrawal, URL, commitment, and fund-conservation test coverage; the improved contract is active on Studionet at `0x02fA974A11762521E31A17d1f29B3B4C940539CC`, with funding, policy creation, evidence, payout, and withdrawal smoke tests finalized on that address.
- The improved deployment transaction `0xc99ae7c90b72bc7a1af340f412d4ad23d2d6bf728427e6835bd084ce5519b881` remains `ACCEPTED`; both CLI and GenLayerJS public finalization attempts returned the Studionet RPC error `'dict' object has no attribute 'args'`, so deployment status must remain pending until network finalization is confirmed.
- Added frontend owner excess-withdrawal controls, local contract configuration for the active Studionet address, and post-finalization consensus result rendering with source and explorer links. Failed, pending, and finalized states remain distinct; the global button cursor is pointer with disabled-state handling.
- Aligned the frontend and root GenLayerJS dependency to `1.1.8`, the SDK used by the pinned Studionet deployment CLI. The previous `2.0.0-rc.1` client failed every `gen_call` against the active Studionet contract; the frontend now uses the stable SDK receipt/read path and passed local read verification.
- Made frontend fee estimation capability-aware: gasless Studionet submits omit the optional fee object when `estimateTransactionFees` is unavailable or fee configuration is absent, while fee-enabled networks still use the estimate.
- Corrected the explorer to `https://explorer-studio.genlayer.com/`, changed the default demo premium/payout to `1/1 GEN`, and added preflight coverage-capacity feedback so oversized policies fail before submission instead of consuming a transaction that rolls back with `Insufficient risk pool`.
- Corrected frontend amount handling for the stable Studionet client: contract `u256` reads and writes use whole GEN units, so the UI no longer divides or multiplies by `10^18`; available coverage now displays as `84 GEN` instead of `8.4e-17`.
- Added a same-origin Next.js GenLayer RPC proxy at `/api/genlayer-rpc` to avoid browser CORS/502 failures against the Studionet RPC; local proxy verification succeeds after dev-server reload.
- Create-policy finalization now returns success explicitly, navigates to the dedicated Policies page, reads the newly created policy ID, and highlights that row so the next Evaluate action is immediately visible.
- Added a dedicated Policies navigation view with My Policies, Active Policies, Settled Policies, and Expired Policies sections, preserving the existing StrataSure visual system.
- Matched the policy desk to contract timing rules: active policies whose coverage end date has not passed show an open-coverage state instead of an Evaluate action.
- Replaced the stacked policy sections with compact My Policies, Active, Settled, and Expired filter tabs to keep the policy desk focused and avoid excessive scrolling.
- Added evaluation loading state to the selected policy, persisted settled evaluation records across portfolio refreshes, and added a Detail modal with consensus, observed value, threshold, payout, source, evidence, and verification fields.
- Updated the README with the current initial StrataSure contract, deployment status, logo, at-a-glance table, lifecycle diagram, modern policy-desk workflow, and expanded project structure.
- Removed release-version labeling from user-facing README and protocol metadata display; the project is presented as the initial StrataSure release without a `v` prefix.
- Added a process-local `genlayer-test` compatibility bridge in `tests/direct/conftest.py` for the pinned stable runner, restoring direct contract loading, message values, storage allocation, mocked web access, non-deterministic leader/validator execution, and validator replay. All 26 direct tests now pass.

- Scope or peril selection.
- Data source or source mapping.
- Contract API or storage schema.
- Consensus strategy.
- Payout lifecycle.
- Network or runner version.
- Testing or deployment command.
- Known limitation or security decision.
- Official GenLayer documentation behavior that affects the implementation.

Add a short activity-log entry after every meaningful milestone.
