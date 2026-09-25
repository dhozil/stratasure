import json
from datetime import date, timedelta

import pytest
from gltest import get_contract_factory, get_validator_factory
from gltest.assertions import tx_execution_failed, tx_execution_succeeded


GEN = 10**18
COVERAGE_START = "2026-06-01"
COVERAGE_END = "2026-08-31"
EVALUATION_TIME = "2026-09-01T00:00:00Z"
DROUGHT_URL = (
    "https://power.larc.nasa.gov/api/temporal/daily/point"
    "?parameters=PRECTOTCORR&community=AG&latitude=-6.69&longitude=107"
    "&start=20260601&end=20260831&format=JSON"
)
EARTHQUAKE_URL = (
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
    "&starttime=2026-06-01T00:00:00&endtime=2026-08-31T23:59:59"
    "&latitude=-6.69&longitude=107&maxradiuskm=100"
    "&minmagnitude=6&orderby=time-asc&limit=20000"
)


def _nasa_precipitation(start="2026-06-01", end="2026-08-31", value="100.0"):
    current = date.fromisoformat(start)
    last = date.fromisoformat(end)
    values = {}
    while current <= last:
        values[current.strftime("%Y%m%d")] = value
        current += timedelta(days=1)
    return values


def make_web_mock(url, body, status=200):
    return {
        "nondet_web_request": {
            url: {
                "method": "GET",
                "status": status,
                "body": body if isinstance(body, str) else json.dumps(body),
            }
        }
    }


def make_context(mock_web_response, at=EVALUATION_TIME):
    validators = get_validator_factory().batch_create_mock_validators(
        count=5,
        mock_web_response=mock_web_response,
    )
    return {
        "validators": [validator.to_dict() for validator in validators],
        "genvm_datetime": at,
    }


def deploy_policy(context, peril="DROUGHT", threshold=250, radius_km=100):
    create_context = {**context, "genvm_datetime": "2026-01-01T00:00:00Z"}
    contract = get_contract_factory("StrataSure").deploy(
        wait_until="finalized",
        transaction_context=create_context,
    )
    fund_result = contract.fund_pool(args=[]).transact(
        value=1000 * GEN,
        wait_until="finalized",
        transaction_context=create_context,
    )
    assert tx_execution_succeeded(fund_result), fund_result
    create_result = contract.create_policy(
        args=[
            peril,
            "Bandung",
            -6690000,
            107000000,
            COVERAGE_START,
            COVERAGE_END,
            threshold,
            radius_km,
            10 * GEN,
            500 * GEN,
        ]
    ).transact(
        value=10 * GEN,
        wait_until="finalized",
        transaction_context=create_context,
    )
    assert tx_execution_succeeded(create_result), create_result
    return contract


@pytest.mark.integration
def test_fund_pool_and_create_policy():
    context = make_context({})
    contract = deploy_policy(context)

    assert contract.get_contract_info().call()["name"] == "StrataSure"
    assert contract.get_risk_summary().call()["policy_count"] == 1
    assert contract.get_source_catalog().call()[0]["source_id"] == "NASA_POWER"
    assert contract.get_source_catalog().call()[0]["source_url"] == (
        "https://power.larc.nasa.gov/api/temporal/daily/point"
    )
    assert contract.get_policy_count().call() == 1
    policy = contract.get_policy([0]).call()
    assert policy["peril"] == "DROUGHT"
    assert policy["source_id"] == "NASA_POWER"
    assert policy["source_url"] == DROUGHT_URL
    assert policy["terms_commitment"]
    assert policy["status"] == "ACTIVE"

    withdrawal = contract.withdraw_excess(100 * GEN).transact(
        wait_until="finalized",
        transaction_context=context,
    )
    assert tx_execution_succeeded(withdrawal), withdrawal
    assert contract.get_pool_balance().call() == 910 * GEN
    assert contract.get_withdrawable_balance().call() == 410 * GEN


@pytest.mark.integration
def test_drought_evaluation_persists_evidence_and_finalizes_payout():
    context = make_context(
        make_web_mock(
            DROUGHT_URL,
            {
                "properties": {
                    "parameter": {
                        "PRECTOTCORR": _nasa_precipitation(value="1.0")
                    }
                }
            },
        )
    )
    contract = deploy_policy(context)

    result = contract.evaluate_policy(args=[0]).transact(
        wait_until="finalized",
        transaction_context=context,
    )
    assert tx_execution_succeeded(result), result
    assert result["lifecycle"]["state"] == "finalized"

    evaluation = contract.get_evaluation([0]).call()
    assert evaluation["decision"] == "TRIGGERED"
    assert evaluation["observed_value"] == 92000
    assert evaluation["source_id"] == "NASA_POWER"
    assert evaluation["source_confirmed"] is True
    assert evaluation["source_url"] == DROUGHT_URL
    assert evaluation["terms_commitment"] == contract.get_policy([0]).call()["terms_commitment"]
    assert evaluation["evidence_commitment"] == json.dumps(
        _nasa_precipitation(value="1.0"),
        separators=(",", ":"),
        sort_keys=True,
    )
    assert evaluation["verification_id"]
    assert evaluation["evidence_id"] == "NASA:20260601:20260831:-6.69:107"
    assert evaluation["payout_amount"] == 500 * GEN

    policy = contract.get_policy([0]).call()
    assert policy["status"] == "TRIGGERED"
    assert policy["payout_processed"] is True
    assert policy["payout_amount_actual"] == 500 * GEN
    assert contract.get_total_coverage().call() == 0
    assert contract.get_pool_balance().call() == 510 * GEN

    duplicate = contract.evaluate_policy(args=[0]).transact(
        wait_until="finalized",
        transaction_context=context,
    )
    assert tx_execution_failed(duplicate, match_std_err="Policy is not active")


@pytest.mark.integration
def test_expiry_does_not_preempt_available_evaluation():
    context = make_context(
        make_web_mock(
            DROUGHT_URL,
            {
                "properties": {
                    "parameter": {
                        "PRECTOTCORR": _nasa_precipitation(value="1.0")
                    }
                }
            },
        )
    )
    contract = deploy_policy(context)

    blocked_expiry = contract.expire_policy(args=[0]).transact(
        wait_until="finalized",
        transaction_context=context,
    )
    assert tx_execution_failed(blocked_expiry, match_std_err="Evaluation grace period is active")

    result = contract.evaluate_policy(args=[0]).transact(
        wait_until="finalized",
        transaction_context=context,
    )
    assert tx_execution_succeeded(result), result
    assert contract.get_policy([0]).call()["status"] == "TRIGGERED"


def test_incomplete_nasa_evidence_rolls_back_evaluation():
    context = make_context(
        make_web_mock(
            DROUGHT_URL,
            {
                "properties": {
                    "parameter": {
                        "PRECTOTCORR": {
                            "20260601": "1.0",
                            "20260602": "1.0",
                        }
                    }
                }
            },
        )
    )
    contract = deploy_policy(context)
    before_policy = contract.get_policy([0]).call()
    before_pool = contract.get_pool_balance().call()
    before_coverage = contract.get_total_coverage().call()

    result = contract.evaluate_policy(args=[0]).transact(
        wait_until="finalized",
        transaction_context=context,
    )

    assert tx_execution_failed(result, match_std_err="did not cover every required day")
    assert contract.get_policy([0]).call() == before_policy
    assert contract.get_pool_balance().call() == before_pool
    assert contract.get_total_coverage().call() == before_coverage


def test_earthquake_evaluation_persists_event_evidence():
    context = make_context(
        make_web_mock(
            EARTHQUAKE_URL,
            {
                "features": [
                    {
                        "id": "us7000event",
                        "properties": {
                            "mag": 6.4,
                            "time": "2026-07-15T12:00:00Z",
                        },
                    }
                ]
            },
        )
    )
    contract = deploy_policy(context, peril="EARTHQUAKE", threshold=6000)

    result = contract.evaluate_policy(args=[0]).transact(
        wait_until="finalized",
        transaction_context=context,
    )
    assert tx_execution_succeeded(result), result
    assert result["lifecycle"]["state"] == "finalized"

    evaluation = contract.get_evaluation([0]).call()
    assert evaluation["decision"] == "TRIGGERED"
    assert evaluation["observed_value"] == 6400
    assert evaluation["source_id"] == "USGS"
    assert evaluation["source_url"] == EARTHQUAKE_URL
    assert evaluation["verification_id"]
    assert evaluation["evidence_id"] == "us7000event"
    assert evaluation["evidence_timestamp"] == "2026-07-15T12:00:00Z"
    assert evaluation["payout_amount"] == 500 * GEN

    policy = contract.get_policy([0]).call()
    assert policy["status"] == "TRIGGERED"
    assert policy["payout_amount_actual"] == 500 * GEN


@pytest.mark.integration
def test_malformed_web_evidence_rolls_back_evaluation():
    context = make_context(make_web_mock(DROUGHT_URL, "not-json"))
    contract = deploy_policy(context)
    before_policy = contract.get_policy([0]).call()
    before_pool = contract.get_pool_balance().call()
    before_coverage = contract.get_total_coverage().call()

    result = contract.evaluate_policy(args=[0]).transact(
        wait_until="finalized",
        transaction_context=context,
    )

    assert tx_execution_failed(result, match_std_err="Source returned malformed JSON")
    assert contract.get_policy([0]).call() == before_policy
    assert contract.get_pool_balance().call() == before_pool
    assert contract.get_total_coverage().call() == before_coverage
