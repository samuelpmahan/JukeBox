from pathlib import Path
import unittest

from lab.core import Corpus, SetRecord
from lab.providers.squish_subdue import _subdue_graph, _token


class SubdueGraphTests(unittest.TestCase):
    def test_repeated_ordered_fixture_is_set_local_and_track_exact(self):
        first = SetRecord("set-a", "dj", None, None, ("alpha", "beta", "alpha"), "fixture-a")
        second = SetRecord("set-b", "dj", None, None, ("alpha", "beta", "alpha"), "fixture-b")
        corpus = Corpus(Path("fixture.zip"), "fixture", (first, second), ())
        graph, vertices, edges = _subdue_graph(corpus)
        self.assertEqual((vertices, edges), (6, 4))
        node_rows = [row["vertex"] for row in graph if "vertex" in row]
        edge_rows = [row["edge"] for row in graph if "edge" in row]
        self.assertEqual([node["attributes"]["track"] for node in node_rows].count(_token("alpha")), 4)
        self.assertTrue(all(edge["source"].split("_")[1] == edge["target"].split("_")[1] for edge in edge_rows))
        self.assertEqual({edge["attributes"]["relation"] for edge in edge_rows}, {"follows"})


if __name__ == "__main__":
    unittest.main()
