import json

from tests.direct.conftest import to_hex


GEN = 10**18


def _deploy(direct_deploy):
    return direct_deploy("contracts/stratasure.py")


def _fund(contract, direct_vm, direct_owner, amount):
    direct_vm.sender = direct_owner
    direct_vm.value = amount
    contract.fund_pool()
    direct_vm.value = 0


def _create_policy(
    contract,
    direct_vm,
    direct_owner,
    direct_alice,
    peril="DROUGHT",
    threshold=250,
    radius_km=100,
    payout_amount=500 * GEN,
):
    _fund(contract, direct_vm, direct_owner, 1000 * GEN)
    direct_vm.sender = direct_alice
    direct_vm.value = 10 * GEN
    return contract.create_policy(
        peril,
        "Jakarta",
        -6100000,
        106000000,
        "2026-06-01",
        "2026-08-31",
        threshold,
        radius_km,
        10 * GEN,
        payout_amount,
    )


def test_initial_state(direct_deploy):
    contract = _deploy(direct_deploy)

    assert contract.get_policy_count() == 0
    assert contract.get_pool_balance() == 0
    assert contract.get_total_coverage() == 0
    assert contract.get_total_premiums() == 0
    assert contract.get_contract_info()["name"] == "StrataSure"
    assert contract.get_risk_summary()["policy_count"] == 0
    assert contract.get_source_catalog()[0]["source_id"] == "NASA_POWER"
    assert contract.get_source_catalog()[1]["source_id"] == "USGS"


def test_owner_can_fund_pool(direct_vm, direct_deploy, direct_owner):
    contract = _deploy(direct_deploy)

    _fund(contract, direct_vm, direct_owner, 100 * GEN)

    assert contract.get_pool_balance() == 100 * GEN


def test_non_owner_cannot_fund_pool(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _fund(contract, direct_vm, direct_owner, 100 * GEN)

    direct_vm.sender = direct_alice
    direct_vm.value = 1 * GEN

    with direct_vm.expect_revert("Only owner can manage the risk pool"):
        contract.fund_pool()


def test_create_drought_policy(direct_vm, direct_deploy, direct_owner, direct_alice):
    contract = _deploy(direct_deploy)
    policy_id = _create_policy(contract, direct_vm, direct_owner, direct_alice)

    assert policy_id == 0
    assert contract.get_policy_count() == 1
    assert contract.get_total_coverage() == 500 * GEN
    assert contract.get_total_premiums() == 10 * GEN
    assert contract.get_pool_balance() == 1010 * GEN

    policy = contract.get_policy(policy_id)
    assert policy["insured"] == to_hex(direct_alice)
    assert policy["peril"] == "DROUGHT"
    assert policy["source_id"] == "NASA_POWER"
    assert policy["source_url"] == (
        "https://power.larc.nasa.gov/api/temporal/daily/point"
        "?parameters=PRECTOTCORR&community=AG&latitude=-6.1&longitude=106"
        "&start=20260601&end=20260831&format=JSON"
    )
    assert policy["terms_commitment"]
    assert policy["threshold_unit"] == "MILLIMETERS"
    assert policy["status"] == "ACTIVE"
    assert policy["payout_processed"] is False


def test_earthquake_source_is_fixed(direct_vm, direct_deploy, direct_owner, direct_alice):
    contract = _deploy(direct_deploy)
    policy_id = _create_policy(
        contract,
        direct_vm,
        direct_owner,
        direct_alice,
        peril="EARTHQUAKE",
        threshold=6000,
        radius_km=150,
    )

    policy = contract.get_policy(policy_id)
    assert policy["source_id"] == "USGS"
    assert policy["source_policy_version"] == "USGS-CATALOG-MVP-1"
    assert policy["threshold_unit"] == "MILLIMAGNITUDE"
    assert policy["radius_km"] == 150


def test_invalid_peril_is_rejected(direct_vm, direct_deploy, direct_owner, direct_alice):
    contract = _deploy(direct_deploy)
    _fund(contract, direct_vm, direct_owner, 1000 * GEN)

    direct_vm.sender = direct_alice
    direct_vm.value = 10 * GEN

    with direct_vm.expect_revert("Unsupported peril"):
        contract.create_policy(
            "FLOOD",
            "Jakarta",
            -6100000,
            106000000,
            "2026-06-01",
            "2026-08-31",
            100,
            100,
            10 * GEN,
            500 * GEN,
        )


def test_invalid_coordinates_are_rejected(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _fund(contract, direct_vm, direct_owner, 1000 * GEN)

    direct_vm.sender = direct_alice
    direct_vm.value = 10 * GEN

    with direct_vm.expect_revert("Invalid latitude"):
        contract.create_policy(
            "DROUGHT",
            "Jakarta",
            91000000,
            106000000,
            "2026-06-01",
            "2026-08-31",
            100,
            100,
            10 * GEN,
            500 * GEN,
        )


def test_invalid_coverage_window_is_rejected(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _fund(contract, direct_vm, direct_owner, 1000 * GEN)

    direct_vm.sender = direct_alice
    direct_vm.value = 10 * GEN

    with direct_vm.expect_revert("Invalid coverage window"):
        contract.create_policy(
            "DROUGHT",
            "Jakarta",
            -6100000,
            106000000,
            "2026-08-31",
            "2026-06-01",
            100,
            100,
            10 * GEN,
            500 * GEN,
        )


def test_premium_value_must_match(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _fund(contract, direct_vm, direct_owner, 1000 * GEN)

    direct_vm.sender = direct_alice
    direct_vm.value = 9 * GEN

    with direct_vm.expect_revert("Sent value must equal premium"):
        contract.create_policy(
            "DROUGHT",
            "Jakarta",
            -6100000,
            106000000,
            "2026-06-01",
            "2026-08-31",
            100,
            100,
            10 * GEN,
            500 * GEN,
        )


def test_policy_requires_risk_pool(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _fund(contract, direct_vm, direct_owner, 100 * GEN)

    direct_vm.sender = direct_alice
    direct_vm.value = 10 * GEN

    with direct_vm.expect_revert("Insufficient risk pool"):
        contract.create_policy(
            "DROUGHT",
            "Jakarta",
            -6100000,
            106000000,
            "2026-06-01",
            "2026-08-31",
            100,
            100,
            10 * GEN,
            500 * GEN,
        )


def test_evaluation_is_blocked_before_coverage_end(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-08-30T00:00:00Z")

    with direct_vm.expect_revert("Coverage period has not ended"):
        contract.evaluate_policy(0)


def test_drought_trigger_payouts_and_locks_policy(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {
            "status": 200,
            "body": json.dumps(
                {
                    "properties": {
                        "parameter": {
                            "PRECTOTCORR": {
                                "20260601": "100.0",
                                "20260602": "100.0",
                            }
                        }
                    }
                }
            ),
        },
    )

    evaluation = contract.evaluate_policy(0)

    assert evaluation["decision"] == "TRIGGERED"
    assert evaluation["observed_value"] == 200000
    assert evaluation["payout_amount"] == 500 * GEN
    assert evaluation["source_id"] == "NASA_POWER"
    assert evaluation["source_url"].startswith(
        "https://power.larc.nasa.gov/api/temporal/daily/point?"
    )
    assert evaluation["evidence_commitment"]
    assert evaluation["verification_id"]

    policy = contract.get_policy(0)
    assert policy["status"] == "TRIGGERED"
    assert policy["payout_amount_actual"] == 500 * GEN
    assert policy["payout_processed"] is True
    assert contract.get_total_coverage() == 0
    assert contract.get_pool_balance() == 510 * GEN

    with direct_vm.expect_revert("Policy is not active"):
        contract.evaluate_policy(0)


def test_drought_threshold_boundary_does_not_trigger(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {
            "status": 200,
            "body": json.dumps(
                {
                    "properties": {
                        "parameter": {
                            "PRECTOTCORR": {
                                "20260601": "125.0",
                                "20260602": "125.0",
                            }
                        }
                    }
                }
            ),
        },
    )

    evaluation = contract.evaluate_policy(0)

    assert evaluation["decision"] == "NOT_TRIGGERED"
    assert evaluation["observed_value"] == 250000
    assert evaluation["payout_amount"] == 0
    assert contract.get_policy(0)["status"] == "NOT_TRIGGERED"
    assert contract.get_pool_balance() == 1010 * GEN


def test_earthquake_trigger_returns_event_evidence(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(
        contract,
        direct_vm,
        direct_owner,
        direct_alice,
        peril="EARTHQUAKE",
        threshold=6000,
        radius_km=150,
    )
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*earthquake\.usgs\.gov.*",
        {
            "status": 200,
            "body": json.dumps(
                {
                    "features": [
                        {
                            "id": "event-1",
                            "properties": {
                                "id": "event-1",
                                "mag": 6.7,
                                "time": "2026-02-01T00:00:00.000Z",
                            },
                        }
                    ]
                }
            ),
        },
    )

    evaluation = contract.evaluate_policy(0)

    assert evaluation["decision"] == "TRIGGERED"
    assert evaluation["observed_value"] == 6700
    assert evaluation["evidence_id"] == "event-1"
    assert evaluation["source_id"] == "USGS"


def test_earthquake_without_matching_event_does_not_trigger(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(
        contract,
        direct_vm,
        direct_owner,
        direct_alice,
        peril="EARTHQUAKE",
        threshold=6000,
        radius_km=150,
    )
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*earthquake\.usgs\.gov.*",
        {"status": 200, "body": json.dumps({"features": []})},
    )

    evaluation = contract.evaluate_policy(0)

    assert evaluation["decision"] == "NOT_TRIGGERED"
    assert evaluation["observed_value"] == 0
    assert evaluation["payout_amount"] == 0


def test_fund_conservation_across_multiple_policies(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.sender = direct_alice
    direct_vm.value = 10 * GEN
    contract.create_policy(
        "DROUGHT",
        "Jakarta",
        -6100000,
        106000000,
        "2026-06-01",
        "2026-08-31",
        250,
        0,
        10 * GEN,
        300 * GEN,
    )
    direct_vm.value = 0

    assert contract.get_pool_balance() == 1020 * GEN
    assert contract.get_total_coverage() == 800 * GEN
    assert contract.get_withdrawable_balance() == 220 * GEN
    direct_vm.warp("2026-09-01T00:00:00Z")

    contract.expire_policy(0)

    assert contract.get_pool_balance() == 1020 * GEN
    assert contract.get_total_coverage() == 300 * GEN
    assert contract.get_withdrawable_balance() == 720 * GEN


def test_owner_can_withdraw_only_excess_pool_balance(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)

    assert contract.get_withdrawable_balance() == 510 * GEN
    direct_vm.sender = direct_owner
    contract.withdraw_excess(100 * GEN)

    assert contract.get_pool_balance() == 910 * GEN
    assert contract.get_withdrawable_balance() == 410 * GEN


def test_owner_cannot_withdraw_reserved_coverage(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.sender = direct_owner

    with direct_vm.expect_revert("Withdrawal exceeds excess pool balance"):
        contract.withdraw_excess(511 * GEN)


def test_non_owner_cannot_withdraw_pool(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("Only owner can manage the risk pool"):
        contract.withdraw_excess(1 * GEN)


def test_expired_policy_releases_coverage_without_payout(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-09-01T00:00:00Z")

    contract.expire_policy(0)

    assert contract.get_policy(0)["status"] == "EXPIRED"
    assert contract.get_total_coverage() == 0
    assert contract.get_pool_balance() == 1010 * GEN


def test_validator_reproduces_the_leader_decision(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {
            "status": 200,
            "body": json.dumps(
                {
                    "properties": {
                        "parameter": {
                            "PRECTOTCORR": {
                                "20260601": "100.0",
                                "20260602": "100.0",
                            }
                        }
                    }
                }
            ),
        },
    )

    contract.evaluate_policy(0)

    assert direct_vm.run_validator() is True


def test_validator_rejects_a_different_decision(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {
            "status": 200,
            "body": json.dumps(
                {
                    "properties": {
                        "parameter": {
                            "PRECTOTCORR": {
                                "20260601": "100.0",
                                "20260602": "100.0",
                            }
                        }
                    }
                }
            ),
        },
    )

    contract.evaluate_policy(0)
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {
            "status": 200,
            "body": json.dumps(
                {
                    "properties": {
                        "parameter": {
                            "PRECTOTCORR": {
                                "20260601": "300.0",
                                "20260602": "300.0",
                            }
                        }
                    }
                }
            ),
        },
    )

    assert direct_vm.run_validator() is False


def test_validator_rejects_changed_observed_value_with_same_decision(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {
            "status": 200,
            "body": json.dumps(
                {
                    "properties": {
                        "parameter": {
                            "PRECTOTCORR": {
                                "20260601": "100.0",
                                "20260602": "100.0",
                            }
                        }
                    }
                }
            ),
        },
    )

    contract.evaluate_policy(0)
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {
            "status": 200,
            "body": json.dumps(
                {
                    "properties": {
                        "parameter": {
                            "PRECTOTCORR": {
                                "20260601": "120.0",
                                "20260602": "120.0",
                            }
                        }
                    }
                }
            ),
        },
    )

    assert direct_vm.run_validator() is False


def test_missing_evaluation_is_rejected(direct_vm, direct_deploy):

    contract = _deploy(direct_deploy)

    with direct_vm.expect_revert("Evaluation not found"):
        contract.get_evaluation(0)


def test_transient_source_failure_does_not_mutate_policy(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {"status": 503, "body": ""},
    )

    with direct_vm.expect_revert("Source temporarily unavailable"):
        contract.evaluate_policy(0)

    assert contract.get_policy(0)["status"] == "ACTIVE"
    assert contract.get_total_coverage() == 500 * GEN
    assert contract.get_pool_balance() == 1010 * GEN


def test_malformed_source_fails_without_policy_mutation(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    contract = _deploy(direct_deploy)
    _create_policy(contract, direct_vm, direct_owner, direct_alice)
    direct_vm.warp("2026-09-01T00:00:00Z")
    direct_vm.mock_web(
        r".*power\.larc\.nasa\.gov.*",
        {"status": 200, "body": "not-json"},
    )

    with direct_vm.expect_revert("malformed JSON"):
        contract.evaluate_policy(0)

    assert contract.get_policy(0)["status"] == "ACTIVE"
    assert contract.get_total_coverage() == 500 * GEN
    assert contract.get_pool_balance() == 1010 * GEN
