"""Descriptive EMM-inspired varying-order transition contrast.

This is *not* an implementation of Exceptional Model Mining (EMM).  It is a
small, dependency-free screen for sequence contexts whose next-token rate
contrasts with the rate for the immediate shorter context.  It is suitable for
LAB exploration only: it reports observed contrast statistics, not discoveries
or causal effects.

The result summary deliberately contains only compact, one-way token hashes and
aggregate counts.  Raw track strings, source members, set IDs, and selectors
stay inside the supplied :class:`lab.core.Corpus`.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import hashlib
import math
from typing import Any, Mapping

from lab.core import Corpus, MethodAdapter, MethodResult, MethodRegistry, RunStatus

METHOD_ID = "exceptional-transition-mining-varying-order"
ALGORITHM_ID = "emm-inspired-varying-order-transition-contrast/v1"
_DESCRIPTION = (
    "Descriptive varying-order next-token contrasts; explicitly not an "
    "implementation of Exceptional Model Mining."
)
_TOKEN_DOMAIN = b"jukebox-lab/emm-token/v1\0"
_HASH_PREFIX = "th_"
_CONTRAST_PREFIX = "ec_"


@dataclass(frozen=True, slots=True)
class _Options:
    max_order: int
    min_context_count: int
    min_transition_count: int
    top_k: int
    direction: str


def _positive_int(config: Mapping[str, Any], key: str, default: int, maximum: int) -> int:
    value = config.get(key, default)
    # bool is an int subclass but never a useful tuning value.
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f"{key} must be an integer from 1 to {maximum}")
    return value


def _options(config: Mapping[str, Any]) -> _Options:
    max_order = _positive_int(config, "max_order", 3, 5)
    direction = config.get("direction", "both")
    if direction not in {"both", "positive", "negative"}:
        raise ValueError("direction must be one of: both, positive, negative")
    return _Options(
        max_order=max_order,
        min_context_count=_positive_int(config, "min_context_count", 3, 1_000_000),
        min_transition_count=_positive_int(config, "min_transition_count", 2, 1_000_000),
        top_k=_positive_int(config, "top_k", 50, 1_000),
        direction=direction,
    )


def _token_id(raw_token: str) -> str:
    """Return a compact stable identifier without retaining raw token text."""
    digest = hashlib.sha256(_TOKEN_DOMAIN + raw_token.encode("utf-8", "surrogatepass")).hexdigest()
    return _HASH_PREFIX + digest[:16]


def _contrast_id(order: int, context: tuple[str, ...], next_token: str) -> str:
    payload = f"{order}\0".encode("ascii") + "\0".join((*context, next_token)).encode("ascii")
    return _CONTRAST_PREFIX + hashlib.sha256(payload).hexdigest()[:16]


def _ordered_sequences(corpus: Corpus) -> list[tuple[str, ...]]:
    """Build local sequences, retaining no raw values past token hashing."""
    known_set_ids = {record.id for record in corpus.sets}
    grouped: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
    for input_index, occurrence in enumerate(corpus.ordered_occurrences):
        if len(occurrence) != 3:
            continue
        set_id, ordinal, raw_token = occurrence
        if set_id not in known_set_ids or isinstance(ordinal, bool) or not isinstance(ordinal, int):
            continue
        if not isinstance(raw_token, str) or not raw_token:
            continue
        grouped[set_id].append((ordinal, input_index, _token_id(raw_token)))

    if grouped:
        return [
            tuple(token for _, _, token in sorted(grouped[set_id]))
            for set_id in sorted(grouped)
            if grouped[set_id]
        ]

    # The normal core reader supplies ordered_occurrences.  This fallback keeps
    # the adapter usable with manually constructed Corpora in focused tests.
    return [tuple(_token_id(track) for track in record.tracks if track) for record in corpus.sets]


def _z_for_two_rates(observed: int, total: int, background_observed: int, background_total: int) -> float:
    """Pooled two-proportion z statistic, guarded for degenerate rates."""
    if total <= 0 or background_total <= 0:
        return 0.0
    pooled = (observed + background_observed) / (total + background_total)
    variance = pooled * (1.0 - pooled) * ((1.0 / total) + (1.0 / background_total))
    return 0.0 if variance <= 0.0 else ((observed / total) - (background_observed / background_total)) / math.sqrt(variance)


def _round(value: float) -> float:
    # Receipt JSON stays compact and deterministic across Python versions.
    return round(value, 6)


def run(corpus: Corpus, config: Mapping[str, Any] | None = None) -> MethodResult:
    """Score exceptional-looking next-token transitions across context orders.

    For a context ``a,b`` and next token ``c``, the baseline is the observed
    ``c`` rate after the suffix context ``b`` *excluding* events after ``a,b``.
    At order one the baseline is all other transition events.  This makes each
    result an explicit varying-order contrast rather than a claim of an EMM
    quality function or a statistically validated finding.
    """
    try:
        options = _options(config or {})
    except (AttributeError, TypeError, ValueError) as exc:
        return MethodResult(RunStatus.FAILED, error=str(exc), algorithm_identity=ALGORITHM_ID)
    sequences = _ordered_sequences(corpus)
    usable_sequences = [sequence for sequence in sequences if len(sequence) >= 2]
    base_summary: dict[str, Any] = {
        "method_family": "EMM-inspired varying-order transition contrast",
        "is_exceptional_model_mining": False,
        "token_id_scheme": "sha256-64bit-prefix, domain-separated",
        "max_order": options.max_order,
        "min_context_count": options.min_context_count,
        "min_transition_count": options.min_transition_count,
        "direction": options.direction,
        "sequence_count": len(sequences),
        "usable_sequence_count": len(usable_sequences),
    }
    if not usable_sequences:
        return MethodResult(RunStatus.NO_DATA, base_summary, algorithm_identity=ALGORITHM_ID)

    # Totals at each context length provide the shorter-context baselines.
    totals: dict[int, Counter[tuple[str, ...]]] = {order: Counter() for order in range(options.max_order + 1)}
    transitions: dict[int, Counter[tuple[tuple[str, ...], str]]] = {
        order: Counter() for order in range(1, options.max_order + 1)
    }
    # A backoff distribution is counted at the same eligible positions as its
    # longer context.  It therefore does not include early sequence positions
    # that cannot possibly have had the longer history.
    backoff_totals: dict[int, Counter[tuple[str, ...]]] = {
        order: Counter() for order in range(1, options.max_order + 1)
    }
    backoff_transitions: dict[int, Counter[tuple[tuple[str, ...], str]]] = {
        order: Counter() for order in range(1, options.max_order + 1)
    }
    for sequence in usable_sequences:
        for position, next_token in enumerate(sequence):
            for order in range(0, min(options.max_order, position) + 1):
                context = sequence[position - order:position] if order else ()
                totals[order][context] += 1
                if order:
                    transitions[order][(context, next_token)] += 1
                    shorter_context = context[1:]
                    backoff_totals[order][shorter_context] += 1
                    backoff_transitions[order][(shorter_context, next_token)] += 1

    base_summary["transition_event_count_by_order"] = {
        str(order): int(sum(totals[order].values())) for order in range(1, options.max_order + 1)
    }

    candidates: list[dict[str, Any]] = []
    examined = 0
    for order in range(1, options.max_order + 1):
        for (context, next_token), observed in transitions[order].items():
            context_total = totals[order][context]
            if observed < options.min_transition_count or context_total < options.min_context_count:
                continue
            shorter_context = context[1:]
            baseline_total = backoff_totals[order][shorter_context] - context_total
            baseline_observed = backoff_transitions[order][(shorter_context, next_token)] - observed
            if baseline_total <= 0:
                continue
            examined += 1
            rate = observed / context_total
            baseline_rate = baseline_observed / baseline_total
            delta = rate - baseline_rate
            if options.direction == "positive" and delta <= 0:
                continue
            if options.direction == "negative" and delta >= 0:
                continue
            z_score = _z_for_two_rates(observed, context_total, baseline_observed, baseline_total)
            log2_lift = math.log2((rate + 1e-12) / (baseline_rate + 1e-12))
            candidates.append({
                "contrast_id": _contrast_id(order, context, next_token),
                "order": order,
                "context_token_ids": list(context),
                "next_token_id": next_token,
                "context_event_count": context_total,
                "next_event_count": observed,
                "baseline_event_count": baseline_total,
                "baseline_next_event_count": baseline_observed,
                "conditional_rate": _round(rate),
                "baseline_rate": _round(baseline_rate),
                "rate_difference": _round(delta),
                "log2_rate_ratio": _round(log2_lift),
                "z_score": _round(z_score),
            })

    candidates.sort(
        key=lambda item: (-abs(item["z_score"]), -item["next_event_count"], item["contrast_id"])
    )
    base_summary["eligible_contrast_count"] = examined
    base_summary["returned_contrast_count"] = min(len(candidates), options.top_k)
    base_summary["contrasts"] = candidates[: options.top_k]
    status = RunStatus.SUCCESS if candidates else RunStatus.NO_DATA
    return MethodResult(status, base_summary, algorithm_identity=ALGORITHM_ID)


def register(registry: MethodRegistry) -> None:
    """Register this optional method with a LAB registry."""
    registry.register(MethodAdapter(METHOD_ID, ALGORITHM_ID, run, _DESCRIPTION))


ADAPTER = MethodAdapter(METHOD_ID, ALGORITHM_ID, run, _DESCRIPTION)
