"""Keep checked candidate roster identity separate from commentary and archives."""
from datetime import date
from urllib.parse import urlsplit


def validate(registry):
    date.fromisoformat(registry['checked_at'])
    races = {r['id'] for r in registry['races']}
    sources = {s['id']: s for s in registry['sources']}
    if len(races) != len(registry['races']) or len(sources) != len(registry['sources']):
        raise ValueError('Duplicate candidate registry reference')
    for source in sources.values():
        for field in ('url', 'listing_url'):
            url = urlsplit(source[field])
            if url.scheme != 'https' or url.hostname != 'web.cec.gov.tw' or url.username or url.password:
                raise ValueError('Candidate roster requires official election source')
        date.fromisoformat(source['checked_at'])
    identities, numbers = set(), set()
    for candidate in registry['candidates']:
        number = candidate['ballot_number']
        key = (candidate['race_id'], number)
        if (candidate['id'] in identities or key in numbers or type(number) is not int or number < 1
                or candidate['race_id'] not in races or candidate['roster_source_id'] not in sources
                or not candidate['name']):
            raise ValueError('Invalid or duplicate candidate identity/number')
        identities.add(candidate['id']); numbers.add(key)
    if {c['race_id'] for c in registry['candidates']} != races:
        raise ValueError('Candidate roster has an empty race')
