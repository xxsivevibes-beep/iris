const fs = require('fs');
const path = require('path');

// Load the .env file (your API keys) into process.env
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* no .env file yet */ }

// Brain adapter. To switch brains, change BRAIN in .env (groq or gemini).
// To force a specific model, add GROQ_MODEL=... (or GEMINI_MODEL=...) to .env.
// If the model is missing, IRIS asks the provider for its model list and picks one itself.
const PROVIDERS = {
  groq: {
    base: 'https://api.groq.com/openai/v1', keyName: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL',
    model: 'openai/gpt-oss-20b',
    prefer: [/gpt-oss-20b/, /gpt-oss-120b/, /llama-3\.3-70b/, /llama-4-maverick/, /llama-4-scout/, /llama-3\.1-8b/, /qwen/],
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyName: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL',
    model: 'gemini-2.5-flash',
    prefer: [/gemini-2\.5-flash$/, /flash/],
  },
};

const SYSTEM = 'You are IRIS, a female voice-first AI presence living on Victor\'s computer. ' +
  'Your answers are spoken aloud, so talk like a person in conversation: short, natural, usually one to three short sentences. ' +
  'Never use markdown, bullet points, numbered lists, emojis, or code blocks. ' +
  'If the question needs a long answer, give the key idea and offer to go deeper. Be warm, sharp, and direct.';

const SEARCH_RULE = ' For anything that depends on current events or may have changed recently (news, today, latest, sports scores, prices, who currently holds a job), ' +
  'call the web_search tool, then answer from the results. Use topic "news" only for news stories and "general" for weather, facts, and everything else. Search once, and search a second time only if the first results did not help. ' +
  'Never search for the current date or time: use the date and time given above. ' +
  'Summarize in natural spoken sentences, mention a source name only when it helps, and never read out links. For a news request, cover the top two or three stories briefly.';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the live web for current information such as news, today\'s events, sports scores, prices, and recent facts.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A short search query' },
        topic: { type: 'string', enum: ['general', 'news'], description: 'Use news for news and current events' },
      },
      required: ['query'],
    },
  },
}];

const history = [];
const chosen = {}; // remembers the model that worked for each provider
let searches = 0;
let noReasoning = false;

async function webSearch(query, topic, signal) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return 'Web search is not set up.';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, topic: topic === 'news' ? 'news' : 'general', search_depth: 'basic', max_results: 3 }),
    });
    if (!res.ok) {
      console.log('IRIS search error', res.status, (await res.text()).slice(0, 200));
      return `The search failed (status ${res.status}).`;
    }
    const data = await res.json();
    searches++;
    console.log(`IRIS search: "${query}" (${topic || 'general'}) - ${searches} this session`);
    const rows = (data.results || []).slice(0, 3).map((r, i) => {
      let host = '';
      try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
      return `${i + 1}. ${r.title}${r.published_date ? ` [${r.published_date}]` : ''}\n${String(r.content || '').slice(0, 280)}\n(source: ${host})`;
    });
    return rows.length ? rows.join('\n\n') : 'No results found.';
  } catch (e) {
    return 'The search failed: could not reach the search service.';
  }
}

async function listModels(p, key, signal) {
  const res = await fetch(p.base + '/models', { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map((m) => String(m.id).replace(/^models\//, ''));
}

function pickModel(ids, prefer) {
  const ok = ids.filter((id) => !/whisper|tts|guard|playai|orpheus|embed|image|safeguard|distil/i.test(id));
  for (const re of prefer) { const f = ok.find((id) => re.test(id)); if (f) return f; }
  return ok[0] || null;
}

async function call(p, key, model, messages, signal, tools) {
  const body = { model, messages, temperature: 0.7, max_tokens: 700 };
  if (/gpt-oss/.test(model) && !noReasoning) body.reasoning_effort = 'low'; // less thinking: faster, fewer tokens
  if (tools) { body.tools = TOOLS; body.tool_choice = 'auto'; }
  const res = await fetch(p.base + '/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { ok: res.ok, status: res.status, data, text };
}

const cleanReply = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

async function ask(text) {
  const name = (process.env.BRAIN || 'groq').toLowerCase();
  const p = PROVIDERS[name];
  if (!p) return { ok: false, error: 'Unknown BRAIN in the .env file. Use groq or gemini.' };
  const key = process.env[p.keyName];
  if (!key) return { ok: false, error: `No API key found. Add ${p.keyName}=your-key to the .env file, then restart IRIS.` };

  history.push({ role: 'user', content: text });
  while (history.length > 8) history.shift();

  const canSearch = !!process.env.TAVILY_API_KEY;
  const now = new Date();
  const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const clock = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const system = SYSTEM + ` Today's date is ${today}. The current local time is ${clock}.` +
    (canSearch ? SEARCH_RULE : ' You cannot browse the web, so for live news or current events, say briefly that you cannot check live information right now.');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  const fail = (r) => {
    history.pop();
    console.log('IRIS brain error', r.status, String(r.text).slice(0, 200));
    const errs = {
      401: 'The API key was rejected. Check the key in your .env file.',
      404: 'No working model was found. Look at the terminal for the list of available models.',
      429: 'Rate limit reached. Wait a minute and try again.',
    };
    return { ok: false, error: errs[r.status] || `The brain returned an error (${r.status}).` };
  };

  try {
    let model = chosen[name] || process.env[p.modelEnv] || p.model;
    let rediscovered = false;

    // Sends a request. If the model is missing or retired, asks the provider for its list and picks one.
    const request = async (messages, tools) => {
      let r = await call(p, key, model, messages, ctl.signal, tools);
      if (!r.ok && (r.status === 404 || /model_not_found|decommission|does not exist/i.test(r.text)) && !rediscovered) {
        rediscovered = true;
        const ids = await listModels(p, key, ctl.signal);
        console.log('IRIS: model "' + model + '" failed. Available models:', ids.join(', '));
        const alt = pickModel(ids, p.prefer);
        if (alt && alt !== model) {
          model = alt;
          r = await call(p, key, model, messages, ctl.signal, tools);
          if (r.ok) { chosen[name] = model; console.log('IRIS: now using model', model); }
        }
      }
      if (!r.ok && r.status === 400 && /reasoning/i.test(r.text) && !noReasoning) {
        noReasoning = true; // this model doesn't accept that setting
        r = await call(p, key, model, messages, ctl.signal, tools);
      }
      if (r.status === 429) { // too many tokens this minute: wait the time Groq asks for, then retry once
        const m = /try again in ([\d.]+)\s*(ms|s)/i.exec(r.text);
        const wait = m ? (m[2].toLowerCase() === 'ms' ? parseFloat(m[1]) / 1000 : parseFloat(m[1])) : 0;
        if (wait > 0 && wait <= 15) {
          console.log(`IRIS: rate limit, waiting ${Math.ceil(wait)}s and retrying.`);
          await new Promise((res) => setTimeout(res, (wait + 0.5) * 1000));
          r = await call(p, key, model, messages, ctl.signal, tools);
        }
      }
      return r;
    };

    let reply = '';
    const gathered = [];

    // Phase 1: let the brain use the search tool (at most two rounds, three searches)
    if (canSearch) {
      const msgs = [{ role: 'system', content: system }, ...history];
      const seen = new Set();
      let used = 0;
      for (let round = 0; round < 2; round++) {
        const r = await request(msgs, true);
        if (!r.ok) {
          if (r.status === 401 || r.status === 429 || r.status === 404) return fail(r);
          console.log('IRIS: the search step failed, answering without it.', String(r.text).slice(0, 120));
          break;
        }
        const msg = (r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message) || {};
        if (msg.tool_calls && msg.tool_calls.length) {
          msgs.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
          for (const tc of msg.tool_calls) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { /* bad arguments */ }
            const sig = String(args.query || '') + '|' + (args.topic || '');
            let out;
            if (tc.function.name !== 'web_search' || !args.query) out = 'That tool is not available.';
            else if (seen.has(sig)) out = 'You already searched for that. Use the earlier results.';
            else if (used >= 3) out = 'Search limit reached. Answer with what you have.';
            else {
              seen.add(sig); used++;
              out = await webSearch(args.query, args.topic, ctl.signal);
              gathered.push(`Search "${args.query}":\n${out}`);
            }
            msgs.push({ role: 'tool', tool_call_id: tc.id, content: out });
          }
          continue;
        }
        reply = cleanReply(msg.content);
        break;
      }
    }

    // Phase 2: no answer yet, so answer from whatever was gathered (no tools involved)
    if (!reply) {
      const msgs = [{ role: 'system', content: system }, ...history];
      if (gathered.length) {
        msgs.push({ role: 'user', content: 'Search results you gathered:\n\n' + gathered.join('\n\n---\n\n') +
          '\n\nNow answer my question above in short spoken sentences, using these results. Do not search again.' });
      }
      const r = await request(msgs, false);
      if (!r.ok) return fail(r);
      const msg = (r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message) || {};
      reply = cleanReply(msg.content);
    }

    if (!reply) { history.pop(); return { ok: false, error: 'The brain sent an empty answer.' }; }
    history.push({ role: 'assistant', content: reply });
    return { ok: true, text: reply };
  } catch (e) {
    history.pop();
    return { ok: false, error: e.name === 'AbortError' ? 'The brain took too long to answer.' : 'Could not reach the brain. Check your internet connection.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ask };