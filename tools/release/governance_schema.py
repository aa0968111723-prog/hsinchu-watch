"""Validate portable governance payloads before publication."""
import re
from datetime import date
from urllib.parse import urlsplit


def validate(data, registry):
    def dated(value, optional=False):
        if value is None and optional:
            return
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}(?:-\d{2})?', value):
            raise ValueError('Invalid governance date')
        date.fromisoformat(value + '-01' if len(value) == 7 else value)

    dated(data['reviewed_at'])
    dated(registry['reviewed_at'])
    sources = {row['id']: row for row in registry['sources']}
    regions = {row['id'] for row in registry['regions']}
    topics = {row['id'] for row in registry['topics']}
    if len(sources) != len(registry['sources']):
        raise ValueError('Duplicate governance source')
    for source in sources.values():
        url = urlsplit(source['url'])
        if url.scheme != 'https' or not url.hostname or url.username or url.password:
            raise ValueError('Invalid governance source URL')
        dated(source['checked_at'])
        dated(source['source_updated_at'], optional=True)
    ids = set()
    for project in data['projects']:
        if not re.fullmatch(r'[a-z0-9-]+', project['id']) or project['id'] in ids:
            raise ValueError('Invalid governance project ID')
        ids.add(project['id'])
        if project['region_id'] not in regions or project['topic_id'] not in topics:
            raise ValueError('Unknown governance region/topic')
        dated(project['phase_as_of'], optional=True)
        if not project['events']:
            raise ValueError('Governance evidence is required')
        for event in project['events']:
            dated(event['date'])
            if event['source_id'] not in sources or event['precision'] not in ('day', 'month') or len(event['date']) != (7 if event['precision'] == 'month' else 10):
                raise ValueError('Invalid governance evidence')
        progress = project['progress']
        if progress is not None:
            if type(progress['value']) not in (int, float) or not 0 <= progress['value'] <= 100 or progress['source_id'] not in sources:
                raise ValueError('Invalid governance progress')
            dated(progress['as_of'], optional=True)
        target = project['target']
        if target is not None:
            dated(target['value'])
            if target['precision'] not in ('day', 'month') or len(target['value']) != (7 if target['precision'] == 'month' else 10):
                raise ValueError('Invalid governance target precision')
        budget = project['budget']
        if budget is not None:
            if budget['source_id'] not in sources:
                raise ValueError('Missing governance budget source')
            for key in ('approved_twd', 'contract_twd', 'spent_twd'):
                value = budget[key]
                if value is not None and (type(value) is not int or value < 0):
                    raise ValueError('Invalid governance budget')
