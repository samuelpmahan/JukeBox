from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile

from lab.core import MethodAdapter, MethodResult, RunStatus, compact_corpus_summary, read_zip_corpus, run_adapter

class LabCoreTests(unittest.TestCase):
    def make_zip(self, members: dict[str, str]) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "sets.zip"
        with zipfile.ZipFile(path, "w") as archive:
            for name, contents in members.items():
                archive.writestr(name, contents)
        return path

    def test_primary_tree_exact_tracks_dedup_and_filename_metadata(self) -> None:
        content = "  Original identity  \nsecond\n"
        corpus = read_zip_corpus(self.make_zip({
            "BigData415/Final/fests/lostlands/Alesso_12014-2018-09-14.csv": content,
            "BigData415/Final/fests/lostlands/Other_2018-09-15.csv": content,
            "BigData415/Final/a/lost-lands/mirror_2018-09-16.csv": "ignored\\n",
        }))
        self.assertEqual(corpus.nominal_csv_member_count, 2)
        self.assertEqual(len(corpus.sets), 1)
        self.assertEqual(corpus.content_duplicate_count, 1)
        self.assertEqual(corpus.empty_csv_member_count, 0)
        self.assertEqual(corpus.empty_content_duplicate_count, 0)
        record = corpus.sets[0]
        self.assertEqual(record.selector, "Alesso")
        self.assertEqual(record.date, "2018-09-14")
        self.assertEqual(record.festival, "lostlands")
        self.assertEqual(record.tracks, ("  Original identity  ", "second"))
        self.assertEqual(compact_corpus_summary(corpus)["dated_set_count"], 1)

    def test_receipt_has_deterministic_contract_without_raw_track(self) -> None:
        corpus = read_zip_corpus(self.make_zip({"x/DJ_2018-01-01.csv": "secret track\\n"}))
        adapter = MethodAdapter("probe", "probe/v1", lambda _c, _a: MethodResult(RunStatus.SUCCESS, {"count": 1}))
        receipt = run_adapter(tick_id="tick", adapter=adapter, corpus=corpus, args={"workdir": "/tmp/work"})
        self.assertEqual(receipt["status"], "SUCCESS")
        with corpus.input_path.open("rb") as source:
            self.assertEqual(receipt["input_sha256"], hashlib.file_digest(source, "sha256").hexdigest())
        self.assertNotIn("secret track", str(receipt))

    def test_empty_members_are_counted_separately_from_nonempty_duplicates(self) -> None:
        corpus = read_zip_corpus(self.make_zip({
            "BigData415/Final/fests/x/A_2018-01-01.csv": "track\n",
            "BigData415/Final/fests/x/B_2018-01-02.csv": "track\n",
            "BigData415/Final/fests/x/C_2018-01-03.csv": "\n",
            "BigData415/Final/fests/x/D_2018-01-04.csv": "\n",
        }))
        summary = compact_corpus_summary(corpus)
        self.assertEqual((summary["set_count"], summary["content_duplicate_count"]), (1, 1))
        self.assertEqual((summary["empty_csv_member_count"], summary["empty_content_duplicate_count"]), (2, 1))

if __name__ == "__main__":
    unittest.main()
