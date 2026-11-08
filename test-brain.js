// Standalone test: checks your Groq key and models WITHOUT opening IRIS.
// Run it with:  node test-brain.js
const fs = require('fs');
const path = require('path');

try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  console.log('.env file: found');
} catch (e) { console.log('.env file: NOT FOUND in', __dirname); }

const key = process.env.GROQ_API_KEY;
console.log('Key:', key ? 'found, starts with "' + key.slice(0, 4) + '", length ' + key.length : 'MISSING');
console.log('GROQ_MODEL line:', process.env.GROQ_MODEL ? '"' + process.env.GROQ_MODEL + '"' : '(not set)');

(async () => {
  const base = 'https://api.groq.com/openai/v1';
  const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
  console.log('\nModel list request, status:', r.status);
  const t = await r.text();
  try { console.log((JSON.parse(t).data || []).map((m) => m.id).join('\n') || t.slice(0, 600)); } catch (e) { console.log(t.slice(0, 600)); }

  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const c = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say hello in five words.' }], max_tokens: 30 }),
  });
  console.log('\nChat request with model "' + model + '", status:', c.status);
  console.log((await c.text()).slice(0, 700));
})().catch((e) => console.log('\nFAILED to reach Groq:', e.message));