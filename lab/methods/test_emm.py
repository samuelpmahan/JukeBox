from __future__ import annotations

import unittest
from pathlib import Path

from lab.core import Corpus, RunStatus, SetRecord
from lab.methods.emm import ALGORITHM_ID, run


class EMMContrastTests(unittest.TestCase):
    def test_returns_only_hashed_tokens_and_an_explicit_shorter_context_contrast(self) -> None:
        records = (
            SetRecord("s1", "one", None, None, ("alpha", "beta", "omega"), "hidden-a.csv"),
            SetRecord("s2", "two", None, None, ("alpha", "beta", "omega"), "hidden-b.csv"),
            SetRecord("s3", "three", None, None, ("gamma", "beta", "theta"), "hidden-c.csv"),
            SetRecord("s4", "four", None, None, ("gamma", "beta", "theta"), "hidden-d.csv"),
        )
        occurrences = tuple(
            (record.id, ordinal, track)
            for record in records
            for ordinal, track in enumerate(record.tracks, start=1)
        )
        corpus = Corpus(Path("private.zip"), "0" * 64, records, occurrences)

        result = run(corpus, {"max_order": 2, "min_context_count": 2, "min_transition_count": 2})

        self.assertEqual(result.status, RunStatus.SUCCESS)
        self.assertEqual(result.algorithm_identity, ALGORITHM_ID)
        self.assertFalse(result.summary["is_exceptional_model_mining"])
        rendered = repr(result.summary)
        for raw in ("alpha", "beta", "omega", "gamma", "theta", "hidden"):
            self.assertNotIn(raw, rendered)
        self.assertTrue(result.summary["contrasts"])
        first = result.summary["contrasts"][0]
        self.assertTrue(first["contrast_id"].startswith("ec_"))
        self.assertTrue(first["next_token_id"].startswith("th_"))
        self.assertGreater(first["context_event_count"], 0)
        self.assertGreater(first["baseline_event_count"], 0)

    def test_no_data_for_singletons(self) -> None:
        record = SetRecord("s1", "one", None, None, ("alpha",), "hidden.csv")
        corpus = Corpus(Path("private.zip"), "0" * 64, (record,), (("s1", 1, "alpha"),))
        self.assertEqual(run(corpus).status, RunStatus.NO_DATA)


    def test_does_not_create_transition_across_set_boundaries(self) -> None:
        records = (
            SetRecord("a1", "a", None, None, ("alpha",), "private-a1"),
            SetRecord("a2", "a", None, None, ("alpha",), "private-a2"),
            SetRecord("b1", "b", None, None, ("beta", "theta"), "private-b1"),
            SetRecord("b2", "b", None, None, ("beta", "theta"), "private-b2"),
        )
        occurrences = tuple((row.id, ordinal, track) for row in records for ordinal, track in enumerate(row.tracks, 1))
        corpus = Corpus(Path("private.zip"), "0" * 64, records, occurrences)
        result = run(corpus, {"max_order": 1, "min_context_count": 1, "min_transition_count": 1})
        alpha, beta = __import__('lab.methods.emm', fromlist=['_token_id'])._token_id("alpha"), __import__('lab.methods.emm', fromlist=['_token_id'])._token_id("beta")
        self.assertFalse(any(item["context_token_ids"] == [alpha] and item["next_token_id"] == beta for item in result.summary["contrasts"]))


if __name__ == "__main__":
    unittest.main()
