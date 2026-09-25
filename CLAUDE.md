# StrataSure

This repository uses the official GenLayer project boilerplate as its base.

## Quick commands

```shell
genvm-lint check contracts/stratasure.py
pytest tests/direct/ -v
gltest tests/integration/ -v -s
```

## Structure

```text
contracts/
tests/direct/
tests/integration/
frontend/
deploy/
config/
```

## Contract development rules

- Read `AGENTS.md` before changing contract behavior.
- Check the current official GenLayer documentation before changing SDK APIs or runner versions.
- Keep web and LLM calls inside non-deterministic blocks.
- Keep storage updates and message emission outside non-deterministic blocks.
- Use `gl.u256` for persistent numeric values and GEN amounts.
- Use the stable Studionet contract API with `from genlayer import *`, `gl.Contract`, `TreeMap`, and the pinned `py-genlayer:1jb45...` runner; do not mix it with the v0.3 `import genlayer as gl` API.
- Use `gl.vm.run_nondet` for the custom leader/validator evidence workflow.
- Use a pinned GenVM runner dependency header in every contract.
- Do not use `strict_eq` for live variable data.
- Run `genvm-lint`, direct tests, and integration tests in that order.

## Current milestone

The stable Studionet MVP contract is implemented with NASA POWER and USGS evaluation flows, stored source URLs and terms commitments, complete leader/validator comparison, one-time policy settlement, expiry, excess withdrawal, and finalized GEN payouts. Hosted Studionet smoke tests cover the critical paths; Windows direct-runner compatibility, fee-enabled profiling, keeper scheduling, independent source fallback, and production hardening remain.
