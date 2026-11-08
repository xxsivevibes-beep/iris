// ElevenLabs voice (runs in the app's background so your key stays private).
// brain.js loads the .env file first, so process.env already has your keys.
const BASE = 'https://api.elevenlabs.io/v1';
const FALLBACK_VOICE = 'EXAVITQu4vr4xnSDxMaL'; // Sarah, a built-in voice that works on the free plan
let voiceId = null, blocked = false, used = 0;

async function pickVoice(key) {
  if (blocked) return FALLBACK_VOICE;
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  if (voiceId) return voiceId;
  try {
    const res = await fetch(BASE + '/voices', { headers: { 'xi-api-key': key } });
    if (res.ok) {
      const all = (await res.json()).voices || [];
      // Free plans can only use the built-in ("premade") voices through the API
      const list = all.filter((v) => !v.category || v.category === 'premade');
      const pool = list.length ? list : all;
      console.log('IRIS usable ElevenLabs voices:', pool.map((v) => `${v.name} (${(v.labels && v.labels.gender) || '?'})`).join(', '));
      const want = (process.env.ELEVENLABS_VOICE || '').toLowerCase();
      const f = (want && pool.find((v) => v.name.toLowerCase().includes(want))) ||
        pool.find((v) => v.labels && v.labels.gender === 'female') || pool[0];
      if (f) { console.log('IRIS voice chosen:', f.name); return (voiceId = f.voice_id); }
    }
  } catch (e) { /* use fallback */ }
  return (voiceId = FALLBACK_VOICE);
}

function send(id, key, text, signal) {
  return fetch(`${BASE}/text-to-speech/${id}?output_format=mp3_44100_128`, {
    method: 'POST',
    signal,
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5' }),
  });
}

async function speak(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, error: 'No ELEVENLABS_API_KEY in the .env file.' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    let id = await pickVoice(key);
    let res = await send(id, key, text, ctl.signal);
    if (res.status === 402 && id !== FALLBACK_VOICE) {
      console.log('IRIS: that voice needs a paid plan. Switching to the built-in voice Sarah.');
      blocked = true;
      res = await send(FALLBACK_VOICE, key, text, ctl.signal);
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      console.log('IRIS ElevenLabs error', res.status, body);
      const msgs = {
        401: 'ElevenLabs rejected the key.',
        402: 'ElevenLabs says this feature needs a paid plan.',
        429: 'ElevenLabs is busy or you are out of free credits.',
      };
      return { ok: false, error: msgs[res.status] || `ElevenLabs error ${res.status}.` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    used += text.length;
    console.log(`IRIS voice: sent ${text.length} characters (${used} this session)`);
    return { ok: true, audio: buf.toString('base64') };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'ElevenLabs took too long.' : 'Could not reach ElevenLabs.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { speak };