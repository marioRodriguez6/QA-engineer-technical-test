"""Oculta credenciales en copias publicables de las trazas de API."""
import json
import re
import sys
import zipfile
from pathlib import Path

sensitive = {'authorization', 'proxyauthorization', 'password', 'passwordhash', 'token', 'accesstoken', 'refreshtoken', 'apikey', 'xapikey', 'idtoken', 'clientsecret', 'secret', 'cookie', 'setcookie'}
def key(value):
    return re.sub(r'[^a-z]', '', str(value).lower())

def scrub(value):
    if isinstance(value, dict):
        result = {k: '[REDACTED]' if key(k) in sensitive else scrub(v) for k, v in value.items()}
        if key(value.get('name', '')) in sensitive and 'value' in result:
            result['value'] = '[REDACTED]'
        return result
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        try:
            nested = json.loads(value)
            if isinstance(nested, (dict, list)):
                return json.dumps(scrub(nested), ensure_ascii=False)
        except (ValueError, TypeError):
            pass
        value = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED]', value)
        return re.sub(r'(?i)Bearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED]', value)
    return value

def sanitize_bytes(data):
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return data
    try:
        parsed = json.loads(text)
        cleaned = scrub(parsed)
        return data if cleaned == parsed else (json.dumps(cleaned, ensure_ascii=False) + '\n').encode()
    except ValueError:
        lines = []
        for line in text.splitlines(keepends=True):
            try:
                parsed = json.loads(line)
                cleaned = scrub(parsed)
                lines.append(line if cleaned == parsed else json.dumps(cleaned, ensure_ascii=False) + '\n')
            except ValueError:
                lines.append(scrub(line))
        return ''.join(lines).encode()

def sanitize(root):
    for path in Path(root).rglob('*'):
        if not path.is_file():
            continue
        if path.suffix == '.zip':
            with zipfile.ZipFile(path) as archive:
                entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
            temporary = path.with_suffix('.sanitized')
            with zipfile.ZipFile(temporary, 'w') as archive:
                for info, data in entries:
                    archive.writestr(info, sanitize_bytes(data))
            temporary.replace(path)
        elif path.suffix in ('.json', '.trace', '.network', '.txt', '.log'):
            path.write_bytes(sanitize_bytes(path.read_bytes()))

if __name__ == '__main__':
    sanitize(sys.argv[1])
