import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseUrl = process.env.DONE_MAIL_URL || 'http://127.0.0.1:8787';
const to = process.env.DONE_MAIL_TO || 'local@example.com';
const fixture = resolve(process.cwd(), process.argv[2] || 'fixtures/sample.eml');
const raw = readFileSync(fixture, 'utf8');

const response = await fetch(`${baseUrl}/api/dev/inject-email?to=${encodeURIComponent(to)}`, {
  method: 'POST',
  headers: {
    'content-type': 'text/plain; charset=utf-8'
  },
  body: raw
});

const text = await response.text();
if (!response.ok) {
  console.error(`inject failed (${response.status}): ${text}`);
  process.exit(1);
}

console.log(text);
