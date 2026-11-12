"""Offline regression tests for the RSS news collector."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from collect_hsinchu_news import combine, feed_url, parse_feed

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)
RSS = b'''<?xml version="1.0"?><rss><channel>
<item><title>\xe6\x96\xb0\xe7\xab\xb9\xe5\xb8\x82\xe9\x81\x93\xe8\xb7\xaf\xe5\xb7\xa5\xe7\xa8\x8b - \xe6\xb8\xac\xe8\xa9\xa6\xe5\xaa\x92\xe9\xab\x94</title><link>https://news.google.com/rss/articles/one</link><pubDate>Thu, 12 Nov 2026 09:00:00 GMT</pubDate><source url="https://example.com">\xe6\xb8\xac\xe8\xa9\xa6\xe5\xaa\x92\xe9\xab\x94</source></item>
<item><title>\xe5\x85\xa8\xe5\x9c\x8b\xe6\x96\xb0\xe8\x81\x9e</title><link>https://news.google.com/rss/articles/two</link><pubDate>Thu, 12 Nov 2026 09:30:00 GMT</pubDate></item>
<item><title>\xe6\x96\xb0\xe7\xab\xb9\xe7\xb8\xa3\xe6\x95\x99\xe8\x82\xb2</title><link>http://unsafe.example/path</link><pubDate>Thu, 12 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>'''


class NewsTests(unittest.TestCase):
    def test_parse_and_region(self):
        articles = parse_feed(RSS, 'city', NOW)
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]['title'], '新竹市道路工程')
        self.assertEqual(articles[0]['region'], '新竹市')
        self.assertEqual(articles[0]['verification_status'], 'unreviewed')

    def test_query_encoding(self):
        self.assertIn('hl=zh-TW', feed_url('新竹 when:7d'))
        self.assertIn('when%3A7d', feed_url('新竹 when:7d'))

    def test_deduplicate_and_preserve(self):
        item = parse_feed(RSS, 'city', NOW)[0]
        another = dict(item, feed_queries=['transport'])
        latest, history, count = combine([item, another], [], NOW)
        self.assertEqual(len(latest), 1)
        self.assertEqual(count, 1)
        self.assertEqual(latest[0]['feed_queries'], ['city', 'transport'])
        later, _, count2 = combine([item], history, NOW)
        self.assertEqual(count2, 0)
        self.assertEqual(later[0]['feed_queries'], ['city', 'transport'])

    def test_no_future_articles(self):
        item = dict(parse_feed(RSS, 'city', NOW)[0], published_at='2027-11-12T10:00:00Z')
        self.assertEqual(combine([item], [], NOW)[0], [])


if __name__ == '__main__':
    unittest.main()
