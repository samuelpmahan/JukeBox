from __future__ import annotations

from itertools import product
from pathlib import Path
import unittest

from lab.core import Corpus, RunStatus, SetRecord
from lab.methods.kleinberg import _decode_states, _emission_cost, run

class KleinbergTests(unittest.TestCase):
    def test_dp_matches_bruteforce_tiny_state_paths(self) -> None:
        counts, denominators, rates, gamma = [0, 2, 1], [2, 2, 2], [0.2, 0.6], 0.8
        states, score = _decode_states(counts, denominators, rates, gamma)
        unit = gamma * __import__('math').log(len(counts) + 1.0)
        def cost(path: tuple[int, ...]) -> float:
            return sum(_emission_cost(count, total, rates[state]) for count, total, state in zip(counts, denominators, path)) + sum(
                unit * (later - earlier) for earlier, later in zip(path, path[1:]) if later > earlier)
        candidates = list(product(range(len(rates)), repeat=len(counts)))
        best = min(candidates, key=lambda path: (cost(path), path))
        self.assertEqual(tuple(states), best)
        self.assertAlmostEqual(score, cost(best))

    def test_uses_set_denominator_and_excludes_missing_dates(self) -> None:
        records = (
            SetRecord("one", "a", "2018-01-01", None, ("needle", "needle"), "private-a"),
            SetRecord("two", "b", "2018-01-01", None, ("other",), "private-b"),
            SetRecord("three", "c", "2018-01-02", None, ("needle",), "private-c"),
            SetRecord("four", "d", None, None, ("needle",), "private-d"),
        )
        corpus = Corpus(Path("private.zip"), "0" * 64, records, ())
        result = run(corpus, {"binning": "day", "max_states": 1, "gamma": 0, "max_results": 10})
        self.assertEqual(result.status, RunStatus.SUCCESS)
        self.assertEqual(result.summary["dated_set_count"], 3)
        self.assertEqual(result.summary["undated_set_count"], 1)
        self.assertEqual(result.summary["candidate_token_count"], 2)
        needle = next(item for item in result.summary["bursts"] if item["present_set_count"] == 2)
        self.assertEqual(needle["eligible_set_count"], 3)
        self.assertNotIn("needle", repr(result.summary))

if __name__ == "__main__":
    unittest.main()
