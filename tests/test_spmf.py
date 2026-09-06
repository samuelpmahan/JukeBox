import os
import tempfile
import unittest
from pathlib import Path
from lab.core import Corpus, SetRecord, RunStatus
from lab.providers.spmf import execute, _witness

class SpmfTests(unittest.TestCase):
    def test_witness_requires_order_and_repeated_occurrences(self):
        self.assertEqual(_witness(('a','b','a'), ('a','a')), [1,3])
        self.assertIsNone(_witness(('a','b'), ('b','a')))
        self.assertIsNone(_witness(('a',), ('a','a')))

    @unittest.skipUnless(os.environ.get('JUKEBOX_SPMF_CLASSES'), 'optional upstream SPMF build')
    def test_originals_report_independently_verified_support(self):
        sequences = [('a','b','c'), ('a','b','c'), ('a','c'), ('b','a')]
        sets = tuple(SetRecord(str(i),'artist','2020-01-01','fixture',s,'fixture') for i,s in enumerate(sequences))
        corpus = Corpus(Path('fixture'), 'fixture', sets, ())
        with tempfile.TemporaryDirectory() as tmp:
            for method in ('closed','skopus'):
                result = execute(method,corpus,{'workdir':str(Path(tmp)/method), 'item_min_sets':1, 'min_support':0.5,'max_length':3,'top_k':3})
                self.assertEqual(result.status,RunStatus.SUCCESS,result.error)
                self.assertTrue(result.summary['occurrence_support_checked'])
                self.assertGreater(result.summary['pattern_count'],0)
