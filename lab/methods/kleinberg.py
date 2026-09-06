"""Date-binned, set-presence burst detection.

This is a *binned adaptation* of Kleinberg-style burst detection, not an
implementation of Kleinberg's original continuous stream model.  A track is
an event at most once per set, bins use binomial likelihoods over eligible
sets, and the dynamic program penalizes upward state changes.  The public
result deliberately exposes only SHA-256 token identifiers and aggregates;
it never emits track strings, set IDs, or source paths.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta
import hashlib
import math
from typing import Any, Iterable, Mapping

from lab.core import MethodAdapter, MethodResult, MethodRegistry, RunStatus


ALGORITHM_IDENTITY = "kleinberg-binned-binomial-dp/v1"
METHOD_ID = "kleinberg-binned"
_EPSILON = 1e-9


def _as_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be an integer")
    number = int(value)
    if number < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return number


def _as_float(value: Any, name: str, *, greater_than: float = 0.0) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    number = float(value)
    if not math.isfinite(number) or number <= greater_than:
        raise ValueError(f"{name} must be greater than {greater_than}")
    return number


def _options(config: Mapping[str, Any]) -> dict[str, Any]:
    """Read a small, explicit configuration surface with conservative defaults."""
    binning = str(config.get("binning", config.get("bin_size", "month"))).lower()
    if binning not in {"day", "week", "month"}:
        raise ValueError("binning must be one of: day, week, month")
    growth = _as_float(config.get("s", config.get("state_growth", 2.0)), "s")
    if growth <= 1.0:
        raise ValueError("s must be greater than 1")
    gamma_value = config.get("gamma", 1.0)
    if isinstance(gamma_value, bool):
        raise ValueError("gamma must be a number")
    gamma = float(gamma_value)
    if not math.isfinite(gamma) or gamma < 0:
        raise ValueError("gamma must be at least 0")
    return {
        "binning": binning,
        "s": growth,
        "gamma": gamma,
        "max_states": _as_int(config.get("max_states", 4), "max_states", minimum=1),
        "min_token_sets": _as_int(config.get("min_token_sets", 1), "min_token_sets", minimum=1),
        "max_results": _as_int(config.get("max_results", config.get("max_patterns", 50)), "max_results", minimum=0),
        "include_empty_bins": bool(config.get("include_empty_bins", False)),
    }


def _bin_start(observed: date, binning: str) -> date:
    if binning == "day":
        return observed
    if binning == "week":
        return observed - timedelta(days=observed.weekday())
    return observed.replace(day=1)


def _next_bin(start: date, binning: str) -> date:
    if binning == "day":
        return start + timedelta(days=1)
    if binning == "week":
        return start + timedelta(days=7)
    return date(start.year + (start.month == 12), 1 if start.month == 12 else start.month + 1, 1)


def _date_bins(starts: Iterable[date], *, binning: str, include_empty: bool) -> list[date]:
    present = sorted(set(starts))
    if not present or not include_empty:
        return present
    bins = [present[0]]
    while bins[-1] < present[-1]:
        bins.append(_next_bin(bins[-1], binning))
    return bins


def _token_digest(track: str) -> str:
    return hashlib.sha256(track.encode("utf-8", errors="surrogatepass")).hexdigest()


def _state_rates(baseline: float, growth: float, max_states: int) -> list[float]:
    rates = [min(max(baseline, _EPSILON), 1.0 - _EPSILON)]
    for _ in range(max_states):
        rate = min(rates[-1] * growth, 1.0 - _EPSILON)
        if rate <= rates[-1] + _EPSILON:
            break
        rates.append(rate)
    return rates


def _emission_cost(present: int, eligible: int, rate: float) -> float:
    # Binomial coefficients cancel across states and therefore across each DP
    # comparison; omitting them is exact for choosing the state path.
    return -(present * math.log(rate) + (eligible - present) * math.log1p(-rate))


def _decode_states(counts: list[int], denominators: list[int], rates: list[float], gamma: float) -> tuple[list[int], float]:
    """Viterbi-style DP with Kleinberg's upward transition-cost form."""
    state_count = len(rates)
    transition_unit = gamma * math.log(len(counts) + 1.0)
    previous = [0.0] + [math.inf] * (state_count - 1)
    backpointers: list[list[int]] = []
    for present, eligible in zip(counts, denominators):
        current: list[float] = [math.inf] * state_count
        pointer: list[int] = [0] * state_count
        for target in range(state_count):
            best_cost = math.inf
            best_source = 0
            for source in range(state_count):
                transition = transition_unit * (target - source) if target > source else 0.0
                candidate = previous[source] + transition
                # Deterministic tie-breaking prefers a lower previous state.
                if candidate < best_cost - _EPSILON or (abs(candidate - best_cost) <= _EPSILON and source < best_source):
                    best_cost, best_source = candidate, source
            current[target] = best_cost + _emission_cost(present, eligible, rates[target])
            pointer[target] = best_source
        previous = current
        backpointers.append(pointer)
    final_state = min(range(state_count), key=lambda state: (previous[state], state))
    states = [final_state]
    for pointer in reversed(backpointers[1:]):
        states.append(pointer[states[-1]])
    states.reverse()
    return states, previous[final_state]


def _intervals(states: list[int], bins: list[date], counts: list[int], denominators: list[int], *, binning: str) -> list[dict[str, Any]]:
    """Return threshold intervals, splitting ranges over calendar gaps."""
    output: list[dict[str, Any]] = []
    maximum = max(states, default=0)
    for level in range(1, maximum + 1):
        start_index: int | None = None
        end_index: int | None = None
        for index, state in enumerate(states + [0]):
            contiguous = (
                start_index is not None
                and index < len(bins)
                and _next_bin(bins[index - 1], binning) == bins[index]
            )
            if index < len(states) and state >= level and (start_index is None or contiguous):
                if start_index is None:
                    start_index = index
                end_index = index
                continue
            if start_index is not None and end_index is not None:
                numerator = sum(counts[start_index : end_index + 1])
                eligible = sum(denominators[start_index : end_index + 1])
                output.append({
                    "level": level,
                    "start": bins[start_index].isoformat(),
                    "end": bins[end_index].isoformat(),
                    "bin_count": end_index - start_index + 1,
                    "present_set_count": numerator,
                    "eligible_set_count": eligible,
                    "selection_share": round(numerator / eligible, 8) if eligible else None,
                })
            start_index = index if index < len(states) and state >= level else None
            end_index = start_index
    return output


def run(corpus: Any, config: Mapping[str, Any] | None = None) -> MethodResult:
    """Run the binned burst DP against ``corpus.sets``.

    ``corpus`` is intentionally accessed by duck typing so that the method can
    be exercised against small fixtures.  In normal LAB use each set has an ISO
    ``date`` and a ``tracks`` iterable.  Repeated track rows in one set count
    once, because this method models selection presence rather than plays.
    """
    try:
        options = _options(config or {})
    except (AttributeError, TypeError, ValueError) as exc:
        return MethodResult(RunStatus.FAILED, error=str(exc), algorithm_identity=ALGORITHM_IDENTITY)

    records = getattr(corpus, "sets", None)
    if records is None:
        return MethodResult(RunStatus.FAILED, error="corpus must provide sets", algorithm_identity=ALGORITHM_IDENTITY)

    bin_tokens: dict[date, Counter[str]] = defaultdict(Counter)
    bin_set_counts: Counter[date] = Counter()
    undated_sets = 0
    invalid_dates = 0
    dated_sets = 0
    for record in records:
        value = getattr(record, "date", None)
        if not value:
            undated_sets += 1
            continue
        try:
            observed = date.fromisoformat(str(value))
        except ValueError:
            invalid_dates += 1
            continue
        tracks = getattr(record, "tracks", ())
        try:
            selected = {_token_digest(str(track)) for track in tracks}
        except TypeError:
            return MethodResult(RunStatus.FAILED, error="each set tracks value must be iterable", algorithm_identity=ALGORITHM_IDENTITY)
        start = _bin_start(observed, options["binning"])
        bin_set_counts[start] += 1
        dated_sets += 1
        for token in selected:
            bin_tokens[start][token] += 1

    bins = _date_bins(bin_set_counts, binning=options["binning"], include_empty=options["include_empty_bins"])
    summary_base = {
        "method": "kleinberg_binned_set_presence",
        "model_note": "Date-binned Kleinberg-style binomial dynamic program; this is not the original continuous stream model.",
        "binning": options["binning"],
        "set_presence": True,
        "dated_set_count": dated_sets,
        "undated_set_count": undated_sets,
        "invalid_date_count": invalid_dates,
        "bin_count": len(bins),
        "state_growth": options["s"],
        "gamma": options["gamma"],
    }
    if not bins:
        return MethodResult(RunStatus.NO_DATA, summary={**summary_base, "candidate_token_count": 0, "bursts": []}, algorithm_identity=ALGORITHM_IDENTITY)

    denominators = [bin_set_counts[bin_start] for bin_start in bins]
    support = Counter()
    for token_counts in bin_tokens.values():
        for token, count in token_counts.items():
            support[token] += count
    candidates = [token for token, count in support.items() if count >= options["min_token_sets"]]
    candidate_results: list[dict[str, Any]] = []
    total_eligible = sum(denominators)
    for token in candidates:
        counts = [bin_tokens[bin_start][token] for bin_start in bins]
        total_present = sum(counts)
        baseline = total_present / total_eligible
        rates = _state_rates(baseline, options["s"], options["max_states"])
        states, path_cost = _decode_states(counts, denominators, rates, options["gamma"])
        intervals = _intervals(states, bins, counts, denominators, binning=options["binning"])
        if not intervals:
            continue
        base_cost = sum(_emission_cost(present, eligible, rates[0]) for present, eligible in zip(counts, denominators))
        candidate_results.append({
            "token_sha256": token,
            "baseline_selection_share": round(baseline, 8),
            "present_set_count": total_present,
            "eligible_set_count": total_eligible,
            "max_level": max(states),
            # Likelihood-cost reduction includes transition penalties.  It is a
            # ranking diagnostic, not a p-value or a claim of significance.
            "path_gain": round(base_cost - path_cost, 8),
            "intervals": intervals,
        })
    candidate_results.sort(key=lambda item: (-item["max_level"], -item["path_gain"], item["token_sha256"]))
    returned = candidate_results[: options["max_results"]]
    return MethodResult(
        RunStatus.SUCCESS,
        summary={
            **summary_base,
            "candidate_token_count": len(candidates),
            "burst_token_count": len(candidate_results),
            "returned_burst_token_count": len(returned),
            "max_results": options["max_results"],
            "bursts": returned,
        },
        algorithm_identity=ALGORITHM_IDENTITY,
    )


def register(registry: MethodRegistry) -> None:
    """Register the date-binned adaptation under the LAB runner's method ID."""
    registry.register(MethodAdapter(
        METHOD_ID,
        ALGORITHM_IDENTITY,
        run,
        "Date-binned Kleinberg-style binomial burst DP over set presence; not the original continuous model.",
    ))
