// IRIS v0.4.1 - hold Space to talk, or press Enter to type. Brain, search, and ElevenLabs voice included.
const bar = document.getElementById('bar');
const box = document.getElementById('q');
const cap = document.getElementById('cap');
const hint = document.getElementById('label');
const SHOW_CAPTION = true; // true = also show text on screen; false = voice only
const PRO_VOICE = true;    // true = ElevenLabs voice (falls back to the Windows voice if it fails)
const MAX_CHARS = 450;     // longest text sent to ElevenLabs per answer (protects your free credits)
const PULSE = 0.45;        // eye pulse strength: 0.2 gentle, 0.45 medium, 0.8 strong
const MIC_GAIN = 8;        // how strongly the eye reacts to your voice while you talk
const MIN_MS = 500;        // recordings shorter than this are ignored (accidental taps)
const MAX_MS = 60000;      // safety limit for one recording
const MIN_LEVEL = 0.012;   // recordings quieter than this are treated as silence and not sent
const MIC_NAME = '';       // optional: part of your microphone's name, e.g. 'Realtek' or 'USB'
const VOICE_HINT = '';     // Windows backup voice: part of a voice name to prefer
const FEMALE = /Aria|Jenny|Michelle|Ava|Emma|Sonia|Libby|Ana|Zira|Hazel|Susan|Eva|Catherine|Heera|Linda|Female/i;
const AUDIO_IN = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const I = () => window.IRIS;
let busy = false, capTimer, started = false, tgt = 0, lvl = 0, reqId = 0, peak = 0;
let actx = null, analyser = null, current = null, proPlaying = false;
let listening = false, holding = false, discard = false, micStream = null, micAnalyser = null, rec = null, chunks = [], recStart = 0, maxTimer;

function caption(text, ms) {
  clearTimeout(capTimer);
  cap.textContent = text;
  cap.style.opacity = text && SHOW_CAPTION ? 0.8 : 0;
  if (ms) capTimer = setTimeout(() => (cap.style.opacity = 0), ms);
}
const isOpen = () => bar.classList.contains('on');

function openBar() {
  try { actx = actx || new AudioContext(); } catch (e) { /* audio set up later */ }
  caption('', 0);
  box.value = '';
  bar.classList.add('on');
  box.focus();
  I().setState('listening');
}
function closeBar() {
  bar.classList.remove('on');
  box.blur();
  if (!busy) I().setState('idle');
}

function fail(msg) {
  busy = false; proPlaying = false; current = null; started = false;
  I().useReal = false;
  I().setState('idle');
  I().setMood('warning');
  cap.textContent = msg; cap.style.opacity = 0.9;
  clearTimeout(capTimer);
  capTimer = setTimeout(() => { cap.style.opacity = 0; I().setMood('normal'); }, 7000);
}
function finish() { // normal end of an answer
  if (!busy) return;
  busy = false; proPlaying = false; current = null; started = false;
  tgt = 0; I().useReal = false;
  I().setState('idle');
  capTimer = setTimeout(() => (cap.style.opacity = 0), 3000);
}
function cancelAll() { // stop whatever IRIS is doing right now
  reqId++;
  speechSynthesis.cancel();
  if (current) { current.onended = null; try { current.stop(); } catch (e) { /* already stopped */ } }
  busy = false; proPlaying = false; current = null; started = false; tgt = 0;
  I().useReal = false;
  I().setState('idle');
}

const tidy = (t) => t.replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_#`>~]/g, '').replace(/\s+/g, ' ').trim();
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : cut;
}

// ---- Windows backup voice ----
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  const by = (re) => vs.find((v) => re.test(v.name));
  const natural = vs.filter((v) => /Natural|Online/i.test(v.name) && FEMALE.test(v.name));
  return (VOICE_HINT && by(new RegExp(VOICE_HINT, 'i'))) || natural[0] || by(FEMALE) || vs[0] || null;
}
function speakWindows(clean, id) {
  const parts = (clean.match(/[^.!?]+[.!?]*/g) || [clean]).map((p) => p.trim()).filter(Boolean);
  const voice = pickVoice();
  started = false;
  speechSynthesis.cancel();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    if (voice) u.voice = voice;
    u.rate = 1; u.pitch = 1.05;
    if (i === 0) u.onstart = () => { if (id === reqId) { started = true; I().setState('speaking'); } };
    u.onboundary = () => { if (id === reqId) { I().useReal = true; tgt = PULSE * (0.6 + Math.random() * 0.4); } };
    if (i === parts.length - 1) u.onend = u.onerror = () => { if (id === reqId) finish(); };
    speechSynthesis.speak(u);
  });
  setTimeout(() => { if (id === reqId && busy && !started) { speechSynthesis.cancel(); fail('IRIS could not speak. Check that Windows has an English voice installed.'); } }, 6000);
}

// ---- ElevenLabs voice, played through Web Audio so the eye can follow the real loudness ----
async function playAudio(b64, id) {
  actx = actx || new AudioContext();
  if (actx.state === 'suspended') await actx.resume();
  if (!analyser) { analyser = actx.createAnalyser(); analyser.fftSize = 512; analyser.connect(actx.destination); }
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buf = await actx.decodeAudioData(bytes.buffer);
  if (id !== reqId) return;
  const src = actx.createBufferSource();
  src.buffer = buf; src.connect(analyser);
  current = src; proPlaying = true; started = true;
  I().useReal = true; I().setState('speaking');
  src.onended = () => { if (id === reqId) finish(); };
  src.start();
  // safety net: never get stuck if the end event is missed
  setTimeout(() => { if (id === reqId && busy) finish(); }, (buf.duration + 2) * 1000);
}

async function speak(text, id) {
  const clean = tidy(text);
  const spoken = PRO_VOICE ? clip(clean, MAX_CHARS) : clean;
  caption(spoken, 0);
  if (!PRO_VOICE) return speakWindows(spoken, id);
  const r = await window.irisBridge.tts(spoken);
  if (id !== reqId) return;
  if (!r.ok) { console.log('IRIS: pro voice unavailable, using the Windows voice.', r.error); return speakWindows(spoken, id); }
  try { await playAudio(r.audio, id); } catch (e) { console.log('IRIS audio error:', e && e.message); if (id === reqId) speakWindows(spoken, id); }
}

// ---- Brain ----
async function askBrain(text, id) {
  busy = true; started = false;
  I().setState('thinking');
  const r = await window.irisBridge.ask(text);
  if (id !== reqId) return; // cancelled or replaced
  if (!r.ok) fail(r.error); else speak(r.text, id);
}

function submit() { // typed question
  const text = box.value.trim();
  if (!text) { closeBar(); return; }
  bar.classList.remove('on'); box.blur();
  askBrain(text, ++reqId);
}

// ---- Microphone ----
async function initMic() {
  try {
    actx = actx || new AudioContext();
    let stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_IN });
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    console.log('IRIS microphones:', devs.map((d) => d.label || '(unnamed)').join(' | '));
    const wanted = MIC_NAME && devs.find((d) => d.label.toLowerCase().includes(MIC_NAME.toLowerCase()));
    if (wanted) {
      stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ audio: Object.assign({ deviceId: { exact: wanted.deviceId } }, AUDIO_IN) });
    }
    micStream = stream;
    console.log('IRIS using microphone:', stream.getAudioTracks()[0].label);
    micAnalyser = actx.createAnalyser(); micAnalyser.fftSize = 512;
    actx.createMediaStreamSource(stream).connect(micAnalyser);
  } catch (e) {
    console.log('IRIS microphone error:', e && e.name, e && e.message);
  }
}
let micReady = initMic();

async function startListening() {
  if (listening) return;
  if (busy) cancelAll(); // talking over IRIS interrupts her, at any stage
  listening = true; holding = true; discard = false;
  if (!micStream) { await micReady; if (!micStream) { micReady = initMic(); await micReady; } }
  if (!micStream) {
    listening = false;
    return fail('IRIS cannot use the microphone. Check Windows Settings > Privacy > Microphone.');
  }
  if (!holding) { listening = false; return; } // you let go before the mic was ready
  if (actx.state === 'suspended') await actx.resume();
  chunks = []; peak = 0;
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
  rec = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  rec.onstop = onRecorded;
  rec.start();
  recStart = performance.now();
  caption('', 0);
  I().useReal = true; I().setState('listening');
  maxTimer = setTimeout(stopListening, MAX_MS);
}
function stopListening() {
  holding = false;
  clearTimeout(maxTimer);
  if (listening && rec && rec.state !== 'inactive') rec.stop();
}
async function onRecorded() {
  listening = false; I().useReal = false;
  const ms = performance.now() - recStart;
  const blob = new Blob(chunks, { type: (rec && rec.mimeType) || 'audio/webm' });
  console.log(`IRIS recorded ${(ms / 1000).toFixed(1)}s, ${(blob.size / 1024).toFixed(0)} KB, loudest level ${peak.toFixed(3)}`);
  if (discard || ms < MIN_MS || blob.size < 1000) { I().setState('idle'); return; }
  if (peak < MIN_LEVEL) {
    I().setState('idle');
    caption("I couldn't hear anything. Check your microphone.", 4000);
    if (peak < 0.001) { // a completely dead signal: reopen the mic for next time
      if (micStream) micStream.getTracks().forEach((t) => t.stop());
      micStream = null; micReady = initMic();
    }
    return;
  }
  const id = ++reqId;
  busy = true; started = false;
  I().setState('thinking');
  const r = await window.irisBridge.transcribe(await blob.arrayBuffer(), blob.type);
  if (id !== reqId) return;
  if (!r.ok) return fail(r.error);
  if (!r.text) { busy = false; I().setState('idle'); caption("I didn't catch that.", 2500); return; }
  caption('\u201C' + r.text + '\u201D', 0);
  askBrain(r.text, id);
}

// ---- Eye pulse: follows real loudness (your mic, or ElevenLabs) or word timing (Windows voice) ----
const wave = new Uint8Array(512);
let lastT = performance.now();
(function decay(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05); lastT = now;
  const src = proPlaying && analyser ? analyser : listening && micAnalyser ? micAnalyser : null;
  let goal;
  if (src) {
    src.getByteTimeDomainData(wave);
    let s = 0;
    for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; s += v * v; }
    const rms = Math.sqrt(s / wave.length);
    if (src === micAnalyser) peak = Math.max(peak, rms);
    goal = Math.min(1, rms * (src === micAnalyser ? MIC_GAIN : 5)) * PULSE;
  } else {
    tgt *= Math.exp(-dt * 2.2);
    goal = Math.max(tgt, busy && started ? PULSE * 0.35 : 0);
  }
  lvl += (goal - lvl) * (1 - Math.exp(-dt * (goal > lvl ? 12 : 4)));
  if (window.IRIS) window.IRIS.speakLevel = lvl < 0.01 ? 0 : lvl;
  requestAnimationFrame(decay);
})(lastT);

// ---- Keys: hold Space = talk, Enter = type, Esc = close / cancel / stop / quit ----
addEventListener('keydown', (e) => {
  if (actx && actx.state === 'suspended') actx.resume();
  if (e.code === 'Space' && !e.repeat && !isOpen()) { e.preventDefault(); startListening(); }
  else if (e.key === 'Enter' && !isOpen() && !busy && !listening) { e.preventDefault(); openBar(); }
});
addEventListener('keyup', (e) => { if (e.code === 'Space' && !isOpen()) stopListening(); });
box.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
});
window.irisBridge.onEsc(() => {
  if (isOpen()) closeBar();
  else if (listening) { discard = true; stopListening(); }
  else if (busy) cancelAll();
  else window.irisBridge.quit();
});

hint.textContent = 'hold space to talk  \u00B7  enter to type';
hint.style.opacity = 0.5;
setTimeout(() => (hint.style.opacity = 0), 6000);