// Speech-to-text through Groq's hosted Whisper (runs in the app's background so your key stays private).
// brain.js loads the .env file first, so process.env already has your keys.
const URL_STT = 'https://api.groq.com/openai/v1/audio/transcriptions';

async function transcribe(data, mime) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, error: 'No GROQ_API_KEY in the .env file.' };
  const buf = Buffer.from(data);
  if (buf.length > 24 * 1024 * 1024) return { ok: false, error: 'That recording was too long.' };
  const type = mime || 'audio/webm';
  const ext = /ogg/.test(type) ? 'ogg' : 'webm';
  const models = [process.env.WHISPER_MODEL || 'whisper-large-v3', 'whisper-large-v3-turbo'];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    for (const model of models) {
      const form = new FormData();
      form.append('file', new Blob([buf], { type }), `speech.${ext}`);
      form.append('model', model);
      form.append('language', process.env.WHISPER_LANGUAGE || 'en');
      form.append('response_format', 'json');
      form.append('temperature', '0');
      form.append('prompt', process.env.WHISPER_PROMPT ||
        ('Victor is talking to his assistant, Iris. Hey Iris.' + (process.env.IRIS_LOCATION ? ` Places: ${process.env.IRIS_LOCATION}.` : '')));
      const res = await fetch(URL_STT, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: ctl.signal });
      if (res.ok) {
        const d = await res.json();
        let text = String((d && d.text) || '').trim();
        // Whisper sometimes "hears" words in silence
        if (/^[\W_]*$/.test(text) || /^(thanks for watching[.!]*|you[.!]*)$/i.test(text)) text = '';
        console.log('IRIS heard:', text ? `"${text}"` : '(nothing)');
        return { ok: true, text };
      }
      console.log('IRIS speech error', res.status, (await res.text()).slice(0, 200));
      if (res.status === 401) return { ok: false, error: 'The Groq key was rejected for speech.' };
      if (res.status === 429) return { ok: false, error: 'Speech rate limit reached. Wait a minute and try again.' };
      if (res.status !== 400 && res.status !== 404) return { ok: false, error: `Speech recognition failed (${res.status}).` };
    }
    return { ok: false, error: 'Speech recognition failed. Look at the terminal for details.' };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Speech recognition took too long.' : 'Could not reach the speech service.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { transcribe };