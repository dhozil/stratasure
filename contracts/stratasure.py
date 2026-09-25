# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from genlayer import *


ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
EVALUATION_GRACE_DAYS = 30
MAX_PREMIUM = 1000 * 10**18
MAX_PAYOUT = 1000 * 10**18
MAX_PAYOUT_MULTIPLIER = 100


def _evidence_format_coordinate(microdegrees: i64) -> str:
    sign = "-" if microdegrees < 0 else ""
    absolute = abs(int(microdegrees))
    whole = absolute // 1000000
    fraction = absolute % 1000000
    return f"{sign}{whole}.{fraction:06d}".rstrip("0").rstrip(".")


def _evidence_parse_fixed_milli(raw_value) -> int:
    if raw_value is None:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} Missing numeric evidence")
    value = str(raw_value).strip()
    if value == "" or value in ("-999", "-999.0", "-999.00", "-999.000"):
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} Missing numeric evidence")
    sign = 1
    if value.startswith("-"):
        sign = -1
        value = value[1:]
    parts = value.split(".")
    if len(parts) > 2 or not parts[0].isdigit():
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} Invalid numeric evidence")
    whole = int(parts[0] or "0")
    fraction = (parts[1] + "000")[:3] if len(parts) == 2 else "000"
    if not fraction.isdigit():
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} Invalid numeric evidence")
    return sign * (whole * 1000 + int(fraction))


def _evidence_response_json(url: str) -> dict:
    response = gl.nondet.web.get(url)
    if response.status >= 500:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} Source temporarily unavailable")
    if response.status >= 400:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} Source returned HTTP {response.status}")
    try:
        data = json.loads(response.body.decode("utf-8"))
    except Exception:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} Source returned malformed JSON")
    if not isinstance(data, dict):
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} Source returned an invalid payload")
    return data


def _evidence_required_date_keys(coverage_start: str, coverage_end: str) -> set[str]:
    try:
        start_date = date.fromisoformat(coverage_start)
        end_date = date.fromisoformat(coverage_end)
    except ValueError:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} Invalid evidence date window")
    required_keys = set()
    current_date = start_date
    while current_date <= end_date:
        required_keys.add(current_date.strftime("%Y%m%d"))
        current_date += timedelta(days=1)
    return required_keys


def _evidence_verification_id(
    peril: str,
    decision: str,
    observed_value: i64,
    threshold: i64,
    source_id: str,
    source_policy_version: str,
    source_url: str,
    evidence_id: str,
    evidence_timestamp: str,
    evidence_commitment: str,
    payout_amount: int,
    terms_commitment: str,
) -> str:
    return json.dumps(
        {
            "decision": decision,
            "evidence_commitment": evidence_commitment,
            "evidence_id": evidence_id,
            "evidence_timestamp": evidence_timestamp,
            "observed_value": int(observed_value),
            "payout_amount": int(payout_amount),
            "peril": peril,
            "source_id": source_id,
            "source_policy_version": source_policy_version,
            "source_url": source_url,
            "terms_commitment": terms_commitment,
            "threshold": int(threshold),
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def _evidence_fetch_drought(
    latitude_microdegrees: i64,
    longitude_microdegrees: i64,
    coverage_start: str,
    coverage_end: str,
    threshold: i64,
    payout_amount: int,
    source_url: str,
    terms_commitment: str,
) -> dict:
    start = coverage_start.replace("-", "")
    end = coverage_end.replace("-", "")
    latitude = _evidence_format_coordinate(latitude_microdegrees)
    longitude = _evidence_format_coordinate(longitude_microdegrees)
    data = _evidence_response_json(source_url)
    try:
        values = data["properties"]["parameter"]["PRECTOTCORR"]
    except Exception:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} NASA POWER payload is missing precipitation")
    if not isinstance(values, dict) or len(values) == 0:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} NASA POWER returned no precipitation data")
    required_keys = _evidence_required_date_keys(coverage_start, coverage_end)
    if set(values.keys()) != required_keys:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} NASA POWER did not cover every required day")
    total = 0
    for raw_value in values.values():
        total += _evidence_parse_fixed_milli(raw_value)
    if total < 0:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} NASA POWER returned invalid precipitation")
    evidence_commitment = json.dumps(values, separators=(",", ":"), sort_keys=True)
    source_policy_version = "NASA-POWER-MVP-1"
    triggered = total < int(threshold) * 1000
    decision = "TRIGGERED" if triggered else "NOT_TRIGGERED"
    evidence_id = f"NASA:{start}:{end}:{latitude}:{longitude}"
    payout_actual = payout_amount if triggered else 0
    return {
        "peril": "DROUGHT",
        "decision": decision,
        "observed_value": total,
        "threshold": int(threshold),
        "source_id": "NASA_POWER",
        "source_policy_version": source_policy_version,
        "source_url": source_url,
        "evidence_id": evidence_id,
        "evidence_timestamp": coverage_end,
        "evidence_commitment": evidence_commitment,
        "source_confirmed": True,
        "payout_amount": payout_actual,
        "terms_commitment": terms_commitment,
        "verification_id": _evidence_verification_id(
            "DROUGHT", decision, total, threshold, "NASA_POWER", source_policy_version,
            source_url, evidence_id, coverage_end, evidence_commitment, payout_actual, terms_commitment,
        ),
    }


def _evidence_fetch_earthquake(
    latitude_microdegrees: i64,
    longitude_microdegrees: i64,
    coverage_start: str,
    coverage_end: str,
    threshold: i64,
    radius_km: i64,
    payout_amount: int,
    source_url: str,
    terms_commitment: str,
) -> dict:
    data = _evidence_response_json(source_url)
    features = data.get("features")
    if not isinstance(features, list):
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} USGS payload is missing features")
    max_magnitude = 0
    evidence_id = "NONE"
    evidence_timestamp = coverage_end
    for feature in features:
        if not isinstance(feature, dict):
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} USGS feature is invalid")
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} USGS feature properties are invalid")
        magnitude = _evidence_parse_fixed_milli(properties.get("mag"))
        if magnitude > max_magnitude:
            max_magnitude = magnitude
            evidence_id = str(properties.get("id", feature.get("id", "")))
            evidence_timestamp = str(properties.get("time", coverage_end))
    evidence_commitment = json.dumps([evidence_id, evidence_timestamp, max_magnitude], separators=(",", ":"))
    source_policy_version = "USGS-CATALOG-MVP-1"
    triggered = max_magnitude >= int(threshold)
    decision = "TRIGGERED" if triggered else "NOT_TRIGGERED"
    payout_actual = payout_amount if triggered else 0
    return {
        "peril": "EARTHQUAKE",
        "decision": decision,
        "observed_value": max_magnitude,
        "threshold": int(threshold),
        "source_id": "USGS",
        "source_policy_version": source_policy_version,
        "source_url": source_url,
        "evidence_id": evidence_id,
        "evidence_timestamp": evidence_timestamp,
        "evidence_commitment": evidence_commitment,
        "source_confirmed": True,
        "payout_amount": payout_actual,
        "terms_commitment": terms_commitment,
        "verification_id": _evidence_verification_id(
            "EARTHQUAKE", decision, max_magnitude, threshold, "USGS", source_policy_version,
            source_url, evidence_id, evidence_timestamp, evidence_commitment, payout_actual, terms_commitment,
        ),
    }


def _evidence_fetch(
    peril: str,
    latitude_microdegrees: i64,
    longitude_microdegrees: i64,
    coverage_start: str,
    coverage_end: str,
    threshold: i64,
    radius_km: i64,
    payout_amount: int,
    source_url: str,
    terms_commitment: str,
) -> dict:
    if peril == "DROUGHT":
        return _evidence_fetch_drought(
            latitude_microdegrees, longitude_microdegrees, coverage_start, coverage_end,
            threshold, payout_amount, source_url, terms_commitment,
        )
    if peril == "EARTHQUAKE":
        return _evidence_fetch_earthquake(
            latitude_microdegrees, longitude_microdegrees, coverage_start, coverage_end,
            threshold, radius_km, payout_amount, source_url, terms_commitment,
        )
    raise gl.vm.UserError(f"{ERROR_EXPECTED} Unsupported peril")


def _evidence_compare(leader_data: dict, validator_data: dict, peril: str) -> bool:
    if not isinstance(leader_data, dict) or not isinstance(validator_data, dict):
        return False
    required_fields = (
        "peril", "decision", "observed_value", "threshold", "source_id",
        "source_policy_version", "source_url", "evidence_id", "evidence_timestamp",
        "evidence_commitment", "source_confirmed", "payout_amount", "terms_commitment",
        "verification_id",
    )
    if any(field not in leader_data or field not in validator_data for field in required_fields):
        return False
    if leader_data.get("peril") != peril:
        return False
    if leader_data.get("decision") not in ("TRIGGERED", "NOT_TRIGGERED"):
        return False
    if leader_data.get("source_confirmed") is not True:
        return False
    return all(leader_data[field] == validator_data[field] for field in required_fields)


@allow_storage
@dataclass
class Policy:
    policy_id: u256
    insured: Address
    peril: str
    location: str
    latitude_microdegrees: i64
    longitude_microdegrees: i64
    coverage_start: str
    coverage_end: str
    source_id: str
    source_policy_version: str
    threshold: i64
    threshold_unit: str
    radius_km: i64
    premium: u256
    payout_amount: u256
    payout_amount_actual: u256
    status: str
    evaluation_timestamp: str
    evidence_timestamp: str
    evidence_id: str
    observed_value: i64
    payout_processed: bool
    source_url: str
    terms_commitment: str


@allow_storage
@dataclass
class Evaluation:
    policy_id: u256
    decision: str
    observed_value: i64
    threshold: i64
    source_id: str
    evidence_id: str
    evidence_timestamp: str
    source_confirmed: bool
    payout_amount: u256
    source_policy_version: str
    source_url: str
    evidence_commitment: str
    terms_commitment: str
    verification_id: str


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


class StrataSure(gl.Contract):
    owner: Address
    policies: TreeMap[u256, Policy]
    evaluations: TreeMap[u256, Evaluation]
    pool_balance: u256
    total_coverage: u256
    total_premiums: u256
    next_policy_id: u256

    def __init__(self) -> None:
        self.owner = gl.message.sender_address

    def _require_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner can manage the risk pool")

    def _transaction_date(self) -> date:
        return datetime.now(timezone.utc).date()

    def _validate_coordinates(
        self, latitude_microdegrees: i64, longitude_microdegrees: i64
    ) -> None:
        if latitude_microdegrees < -90000000 or latitude_microdegrees > 90000000:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid latitude")
        if longitude_microdegrees < -180000000 or longitude_microdegrees > 180000000:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid longitude")

    def _validate_date(self, value: str, field: str) -> date:
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid {field}")
        if parsed.isoformat() != value:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid {field}")
        return parsed

    def _source_for_peril(self, peril: str) -> tuple[str, str, str]:
        if peril == "DROUGHT":
            return "NASA_POWER", "NASA-POWER-MVP-1", "MILLIMETERS"
        if peril == "EARTHQUAKE":
            return "USGS", "USGS-CATALOG-MVP-1", "MILLIMAGNITUDE"
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Unsupported peril")

    def _validate_policy_terms(
        self,
        peril: str,
        location: str,
        coverage_start: str,
        coverage_end: str,
        threshold: i64,
        radius_km: i64,
        premium: u256,
        payout_amount: u256,
    ) -> tuple[str, str, str]:
        if location == "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Location is required")
        start = self._validate_date(coverage_start, "coverage start")
        end = self._validate_date(coverage_end, "coverage end")
        if end <= start:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid coverage window")
        if (end - start).days > 366:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Coverage window is too long")
        if start < self._transaction_date():
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Coverage cannot start in the past")
        if threshold <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Threshold must be positive")
        if premium == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Premium must be positive")
        if payout_amount == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Payout must be positive")
        if premium > MAX_PREMIUM:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Premium exceeds product limit")
        if payout_amount > MAX_PAYOUT:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Payout exceeds product limit")
        if payout_amount > premium * MAX_PAYOUT_MULTIPLIER:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Payout exceeds premium multiple")

        source_id, source_policy_version, threshold_unit = self._source_for_peril(peril)
        if peril == "DROUGHT" and threshold > 1000000:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Drought threshold is too large")
        if peril == "EARTHQUAKE":
            if threshold > 10000:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Earthquake threshold is too large")
            if radius_km <= 0 or radius_km > 20000:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid earthquake radius")
        if peril == "DROUGHT" and radius_km < 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid radius")
        return source_id, source_policy_version, threshold_unit

    def _format_coordinate(self, microdegrees: i64) -> str:
        sign = "-" if microdegrees < 0 else ""
        absolute = abs(int(microdegrees))
        whole = absolute // 1000000
        fraction = absolute % 1000000
        return f"{sign}{whole}.{fraction:06d}".rstrip("0").rstrip(".")

    def _format_magnitude(self, milli_magnitude: i64) -> str:
        value = int(milli_magnitude)
        return f"{value // 1000}.{value % 1000:03d}".rstrip("0").rstrip(".")

    def _source_url_for_terms(
        self,
        peril: str,
        latitude_microdegrees: i64,
        longitude_microdegrees: i64,
        coverage_start: str,
        coverage_end: str,
        threshold: i64,
        radius_km: i64,
    ) -> str:
        latitude = self._format_coordinate(latitude_microdegrees)
        longitude = self._format_coordinate(longitude_microdegrees)
        if peril == "DROUGHT":
            return (
                "https://power.larc.nasa.gov/api/temporal/daily/point"
                f"?parameters=PRECTOTCORR&community=AG&latitude={latitude}"
                f"&longitude={longitude}&start={coverage_start.replace('-', '')}"
                f"&end={coverage_end.replace('-', '')}&format=JSON"
            )
        if peril == "EARTHQUAKE":
            minimum_magnitude = self._format_magnitude(threshold)
            return (
                "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
                f"&starttime={coverage_start}T00:00:00&endtime={coverage_end}T23:59:59"
                f"&latitude={latitude}&longitude={longitude}&maxradiuskm={int(radius_km)}"
                f"&minmagnitude={minimum_magnitude}&orderby=time-asc&limit=20000"
            )
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Unsupported peril")

    def _policy_commitment(
        self,
        peril: str,
        location: str,
        latitude_microdegrees: i64,
        longitude_microdegrees: i64,
        coverage_start: str,
        coverage_end: str,
        source_id: str,
        source_policy_version: str,
        source_url: str,
        threshold: i64,
        threshold_unit: str,
        radius_km: i64,
        premium: u256,
        payout_amount: u256,
    ) -> str:
        return json.dumps(
            {
                "coverage_end": coverage_end,
                "coverage_start": coverage_start,
                "latitude_microdegrees": int(latitude_microdegrees),
                "location": location,
                "longitude_microdegrees": int(longitude_microdegrees),
                "peril": peril,
                "payout_amount": int(payout_amount),
                "premium": int(premium),
                "radius_km": int(radius_km),
                "source_id": source_id,
                "source_policy_version": source_policy_version,
                "source_url": source_url,
                "threshold": int(threshold),
                "threshold_unit": threshold_unit,
            },
            separators=(",", ":"),
            sort_keys=True,
        )

    def _verification_id(
        self,
        peril: str,
        decision: str,
        observed_value: i64,
        threshold: i64,
        source_id: str,
        source_policy_version: str,
        source_url: str,
        evidence_id: str,
        evidence_timestamp: str,
        evidence_commitment: str,
        payout_amount: int,
        terms_commitment: str,
    ) -> str:
        return json.dumps(
            {
                "decision": decision,
                "evidence_commitment": evidence_commitment,
                "evidence_id": evidence_id,
                "evidence_timestamp": evidence_timestamp,
                "observed_value": int(observed_value),
                "payout_amount": int(payout_amount),
                "peril": peril,
                "source_id": source_id,
                "source_policy_version": source_policy_version,
                "source_url": source_url,
                "terms_commitment": terms_commitment,
                "threshold": int(threshold),
            },
            separators=(",", ":"),
            sort_keys=True,
        )

    @gl.public.write.payable
    def fund_pool(self) -> None:
        self._require_owner()
        if gl.message.value == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Funding amount must be positive")
        self.pool_balance = self.pool_balance + gl.message.value

    @gl.public.write.payable
    def create_policy(
        self,
        peril: str,
        location: str,
        latitude_microdegrees: i64,
        longitude_microdegrees: i64,
        coverage_start: str,
        coverage_end: str,
        threshold: i64,
        radius_km: i64,
        premium: u256,
        payout_amount: u256,
    ) -> u256:
        if gl.message.value != premium:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Sent value must equal premium")

        self._validate_coordinates(latitude_microdegrees, longitude_microdegrees)
        source_id, source_policy_version, threshold_unit = self._validate_policy_terms(
            peril,
            location,
            coverage_start,
            coverage_end,
            threshold,
            radius_km,
            premium,
            payout_amount,
        )
        source_url = self._source_url_for_terms(
            peril,
            latitude_microdegrees,
            longitude_microdegrees,
            coverage_start,
            coverage_end,
            threshold,
            radius_km,
        )
        terms_commitment = self._policy_commitment(
            peril,
            location,
            latitude_microdegrees,
            longitude_microdegrees,
            coverage_start,
            coverage_end,
            source_id,
            source_policy_version,
            source_url,
            threshold,
            threshold_unit,
            radius_km,
            premium,
            payout_amount,
        )

        required_balance = self.total_coverage + payout_amount
        if self.pool_balance < required_balance:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Insufficient risk pool")

        policy_id = self.next_policy_id
        self.policies[policy_id] = Policy(
            policy_id=policy_id,
            insured=gl.message.sender_address,
            peril=peril,
            location=location,
            latitude_microdegrees=latitude_microdegrees,
            longitude_microdegrees=longitude_microdegrees,
            coverage_start=coverage_start,
            coverage_end=coverage_end,
            source_id=source_id,
            source_policy_version=source_policy_version,
            threshold=threshold,
            threshold_unit=threshold_unit,
            radius_km=radius_km,
            premium=premium,
            payout_amount=payout_amount,
            payout_amount_actual=0,
            status="ACTIVE",
            evaluation_timestamp="",
            evidence_timestamp="",
            evidence_id="",
            observed_value=0,
            payout_processed=False,
            source_url=source_url,
            terms_commitment=terms_commitment,
        )
        self.next_policy_id = self.next_policy_id + 1
        self.total_coverage = self.total_coverage + payout_amount
        self.total_premiums = self.total_premiums + premium
        self.pool_balance = self.pool_balance + premium
        return policy_id

    @gl.public.write
    def evaluate_policy(self, policy_id: u256) -> dict:
        if policy_id not in self.policies:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Policy not found")
        policy = self.policies[policy_id]
        if policy.status != "ACTIVE":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Policy is not active")
        transaction_date = self._transaction_date()
        if transaction_date <= date.fromisoformat(policy.coverage_end):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Coverage period has not ended")
        if transaction_date > date.fromisoformat(policy.coverage_end) + timedelta(days=EVALUATION_GRACE_DAYS):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Evaluation window is closed")

        peril = policy.peril
        latitude_microdegrees = policy.latitude_microdegrees
        longitude_microdegrees = policy.longitude_microdegrees
        coverage_start = policy.coverage_start
        coverage_end = policy.coverage_end
        threshold = policy.threshold
        radius_km = policy.radius_km
        payout_amount = int(policy.payout_amount)
        source_url = policy.source_url
        terms_commitment = policy.terms_commitment

        def leader_fn() -> dict:
            return _evidence_fetch(
                peril,
                latitude_microdegrees,
                longitude_microdegrees,
                coverage_start,
                coverage_end,
                threshold,
                radius_km,
                payout_amount,
                source_url,
                terms_commitment,
            )

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                validator_data = leader_fn()
            except Exception:
                return False
            return _evidence_compare(leader_result.calldata, validator_data, peril)

        result = gl.vm.run_nondet(leader_fn, validator_fn)
        required_fields = (
            "peril",
            "decision",
            "observed_value",
            "threshold",
            "source_id",
            "source_policy_version",
            "source_url",
            "evidence_id",
            "evidence_timestamp",
            "evidence_commitment",
            "source_confirmed",
            "payout_amount",
            "terms_commitment",
            "verification_id",
        )
        if any(field not in result for field in required_fields):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Evidence result is incomplete")
        if (
            result["peril"] != policy.peril
            or result["source_id"] != policy.source_id
            or result["source_policy_version"] != policy.source_policy_version
            or result["source_url"] != policy.source_url
            or result["terms_commitment"] != policy.terms_commitment
            or result["threshold"] != int(policy.threshold)
        ):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Evidence commitment mismatch")
        if result["decision"] not in ("TRIGGERED", "NOT_TRIGGERED"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid evidence decision")
        if result["source_confirmed"] is not True:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Evidence source is not confirmed")
        if result["payout_amount"] < 0 or result["payout_amount"] > int(policy.payout_amount):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Evidence payout exceeds policy payout")
        if result["decision"] == "TRIGGERED" and result["payout_amount"] != int(policy.payout_amount):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Triggered evidence payout mismatch")
        if result["decision"] == "NOT_TRIGGERED" and result["payout_amount"] != 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Non-triggered evidence payout mismatch")
        expected_verification_id = self._verification_id(
            result["peril"],
            result["decision"],
            result["observed_value"],
            result["threshold"],
            result["source_id"],
            result["source_policy_version"],
            result["source_url"],
            result["evidence_id"],
            result["evidence_timestamp"],
            result["evidence_commitment"],
            result["payout_amount"],
            result["terms_commitment"],
        )
        if result["verification_id"] != expected_verification_id:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Evidence verification mismatch")
        evaluation_timestamp = datetime.now(timezone.utc).isoformat()
        self.evaluations[policy_id] = Evaluation(
            policy_id=policy_id,
            decision=result["decision"],
            observed_value=result["observed_value"],
            threshold=threshold,
            source_id=result["source_id"],
            evidence_id=result["evidence_id"],
            evidence_timestamp=result["evidence_timestamp"],
            source_confirmed=result["source_confirmed"],
            payout_amount=result["payout_amount"],
            source_policy_version=result["source_policy_version"],
            source_url=result["source_url"],
            evidence_commitment=result["evidence_commitment"],
            terms_commitment=result["terms_commitment"],
            verification_id=result["verification_id"],
        )
        self.policies[policy_id].status = result["decision"]
        self.policies[policy_id].evaluation_timestamp = evaluation_timestamp
        self.policies[policy_id].evidence_timestamp = result["evidence_timestamp"]
        self.policies[policy_id].evidence_id = result["evidence_id"]
        self.policies[policy_id].observed_value = result["observed_value"]
        self.policies[policy_id].payout_amount_actual = result["payout_amount"]
        self.total_coverage = self.total_coverage - policy.payout_amount
        if result["decision"] == "TRIGGERED":
            self.policies[policy_id].payout_processed = True
            self.pool_balance = self.pool_balance - result["payout_amount"]
            _Recipient(policy.insured).emit_transfer(value=result["payout_amount"])
        return self.get_evaluation(policy_id)

    @gl.public.write
    def expire_policy(self, policy_id: u256) -> None:
        if policy_id not in self.policies:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Policy not found")
        policy = self.policies[policy_id]
        if policy.status != "ACTIVE":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Policy is not active")
        transaction_date = self._transaction_date()
        coverage_end = date.fromisoformat(policy.coverage_end)
        if transaction_date <= coverage_end:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Coverage period has not ended")
        if transaction_date <= coverage_end + timedelta(days=EVALUATION_GRACE_DAYS):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Evaluation grace period is active")
        self.policies[policy_id].status = "EXPIRED"
        self.total_coverage = self.total_coverage - policy.payout_amount

    @gl.public.write
    def withdraw_excess(self, amount: u256) -> None:
        self._require_owner()
        if amount == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Withdrawal amount must be positive")
        available = self.pool_balance - self.total_coverage
        if amount > available:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Withdrawal exceeds excess pool balance")
        self.pool_balance = self.pool_balance - amount
        _Recipient(self.owner).emit_transfer(value=amount)

    @gl.public.view
    def get_withdrawable_balance(self) -> u256:
        return self.pool_balance - self.total_coverage

    @gl.public.view
    def get_policy(self, policy_id: u256) -> dict:
        if policy_id not in self.policies:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Policy not found")
        policy = self.policies[policy_id]
        return {
            "policy_id": policy.policy_id,
            "insured": policy.insured.as_hex,
            "peril": policy.peril,
            "location": policy.location,
            "latitude_microdegrees": policy.latitude_microdegrees,
            "longitude_microdegrees": policy.longitude_microdegrees,
            "coverage_start": policy.coverage_start,
            "coverage_end": policy.coverage_end,
            "source_id": policy.source_id,
            "source_policy_version": policy.source_policy_version,
            "threshold": policy.threshold,
            "threshold_unit": policy.threshold_unit,
            "radius_km": policy.radius_km,
            "premium": policy.premium,
            "payout_amount": policy.payout_amount,
            "payout_amount_actual": policy.payout_amount_actual,
            "status": policy.status,
            "evaluation_timestamp": policy.evaluation_timestamp,
            "evidence_timestamp": policy.evidence_timestamp,
            "evidence_id": policy.evidence_id,
            "observed_value": policy.observed_value,
            "payout_processed": policy.payout_processed,
            "source_url": policy.source_url,
            "terms_commitment": policy.terms_commitment,
        }

    @gl.public.view
    def get_evaluation(self, policy_id: u256) -> dict:
        if policy_id not in self.evaluations:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Evaluation not found")
        evaluation = self.evaluations[policy_id]
        return {
            "policy_id": evaluation.policy_id,
            "decision": evaluation.decision,
            "observed_value": evaluation.observed_value,
            "threshold": evaluation.threshold,
            "source_id": evaluation.source_id,
            "evidence_id": evaluation.evidence_id,
            "evidence_timestamp": evaluation.evidence_timestamp,
            "source_confirmed": evaluation.source_confirmed,
            "payout_amount": evaluation.payout_amount,
            "source_policy_version": evaluation.source_policy_version,
            "source_url": evaluation.source_url,
            "evidence_commitment": evaluation.evidence_commitment,
            "terms_commitment": evaluation.terms_commitment,
            "verification_id": evaluation.verification_id,
        }

    @gl.public.view
    def get_pool_balance(self) -> u256:
        return self.pool_balance

    @gl.public.view
    def get_total_coverage(self) -> u256:
        return self.total_coverage

    @gl.public.view
    def get_total_premiums(self) -> u256:
        return self.total_premiums

    @gl.public.view
    def get_policy_count(self) -> u256:
        return self.next_policy_id

    @gl.public.view
    def get_contract_info(self) -> dict:
        return {
            "name": "StrataSure",
            "version": "2.2.0",
            "payout_asset": "GEN",
            "evaluation_access": "permissionless",
            "evaluation_grace_days": EVALUATION_GRACE_DAYS,
            "economic_rules": {
                "max_premium": MAX_PREMIUM,
                "max_payout": MAX_PAYOUT,
                "max_payout_multiplier": MAX_PAYOUT_MULTIPLIER,
            },
            "perils": ["DROUGHT", "EARTHQUAKE"],
        }

    @gl.public.view
    def get_source_catalog(self) -> list:
        return [
            {
                "peril": "DROUGHT",
                "source_id": "NASA_POWER",
                "source_policy_version": "NASA-POWER-MVP-1",
                "source_url": "https://power.larc.nasa.gov/api/temporal/daily/point",
                "threshold_unit": "MILLIMETERS",
            },
            {
                "peril": "EARTHQUAKE",
                "source_id": "USGS",
                "source_policy_version": "USGS-CATALOG-MVP-1",
                "source_url": "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson",
                "threshold_unit": "MILLIMAGNITUDE",
            },
        ]

    @gl.public.view
    def get_risk_summary(self) -> dict:
        return {
            "pool_balance": self.pool_balance,
            "total_coverage": self.total_coverage,
            "total_premiums": self.total_premiums,
            "policy_count": self.next_policy_id,
        }
