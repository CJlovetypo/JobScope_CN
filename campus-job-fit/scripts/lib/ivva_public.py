"""Read BioMap's public IVVA API with stdlib HTTP parsing and verified TLS."""
import hashlib
import json
import pathlib
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def collect(config):
    source, options = config['source'], config.get('options', {})
    entry = urllib.parse.urlparse(source['primary_entry_url'])
    if entry.scheme != 'https' or entry.netloc != 'talent.biomap-inc.com':
        raise ValueError('Unsupported IVVA public portal')
    origin = 'https://' + entry.netloc
    seed = entry.path.rstrip('/').split('/')[-1]
    directory = pathlib.Path(options['evidenceDir']).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    records, pages, rows, seen = [], [], [], set()
    session = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')

    def request(route, params, method='GET'):
        if route not in ('/companyPortal/getCompOfficialWebsiteToken', '/companyPortal/positionSearchByPortal'):
            raise ValueError('Only public portal reads are allowed')
        encoded = urllib.parse.urlencode(params).encode()
        url = origin + route + ('?' + encoded.decode() if method == 'GET' else '')
        headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': source['primary_entry_url']}
        if method == 'POST':
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        record = {'url': url, 'method': method, 'body': params if method == 'POST' else None,
                  'purpose': 'public_portal_configuration' if method == 'GET' else 'job_list',
                  'checked_at': datetime.now(timezone.utc).isoformat(), 'transport': 'python_stdlib_urllib',
                  'anonymous_session_from_scratch': True, 'tls_verification': True}
        records.append(record)
        try:
            req = urllib.request.Request(url, headers=headers, data=encoded if method == 'POST' else None, method=method)
            with urllib.request.urlopen(req, timeout=options.get('timeoutMs', 20000)/1000) as response:
                raw = response.read()
                file = directory / (session + '-' + str(len(records)) + '.json')
                file.write_bytes(raw)
                data = json.loads(raw)
                record.update(http_status=response.status, response_is_json=True, response_file=str(file),
                              response_sha256=hashlib.sha256(raw).hexdigest())
                if response.status != 200 or data.get('success') is not True:
                    raise ValueError('Public IVVA API did not return success')
                return data, str(file)
        except Exception as exc:
            record['error'] = str(exc)
            raise

    total, complete, reason = None, False, 'max_pages_reached'
    try:
        bootstrap, _ = request('/companyPortal/getCompOfficialWebsiteToken', {'token': seed, 'isSchoolRecruit': 0})
        token = bootstrap.get('data', {}).get('token1')
        if not token:
            raise ValueError('Public campus portal identifier missing')
        for page in range(1, int(options.get('maxPages', 1000)) + 1):
            data, file = request('/companyPortal/positionSearchByPortal',
                                 {'token': token, 'isSchoolRecruit': 1, 'pageIndex': page,
                                  'pageSize': 30, 'position_recruitStatus_i': 1}, 'POST')
            items, model = data.get('listData'), data.get('pageModel', {})
            if not isinstance(items, list) or not isinstance(model.get('rowCount'), int):
                raise ValueError('IVVA list/page totals missing')
            if total is not None and total != model['rowCount']:
                reason = 'server_total_changed'
                break
            total = model['rowCount']
            fresh = 0
            for item in items:
                identifier = str(item.get('positionId', ''))
                if not identifier:
                    raise ValueError('Position ID missing')
                if identifier not in seen:
                    seen.add(identifier)
                    fields = ('positionId', 'positionName', 'positionNature', 'positionDesc',
                              'isSchoolRecruit', 'recruitStatus', 'workingPlace', 'updateTime')
                    row = {key: item.get(key) for key in fields}
                    row.update(_raw_file=file, _portal_token=token)
                    rows.append(row)
                    fresh += 1
            pages.append({'page': page, 'server_total': total, 'new_ids': fresh,
                          'job_ids': [str(item.get('positionId')) for item in items], 'response_file': file})
            if len(seen) == total:
                complete, reason = True, 'unique_ids_reconcile_server_total'
                break
            if not items or not fresh:
                reason = 'empty_or_repeated_page_before_total'
                break
    except Exception as exc:
        reason = str(exc)
    return {'rows': rows, 'requests': records, 'coverage': {'status': 'complete' if complete else 'partial' if pages else 'failed',
            'pages': len(pages), 'server_total': total, 'jobs_observed': len(rows),
            'list_complete': complete, 'reason': reason, 'page_evidence': pages}}


if __name__ == '__main__':
    print(json.dumps(collect(json.load(sys.stdin)), ensure_ascii=False))
