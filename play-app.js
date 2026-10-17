const VOSK_JS = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';
const VOSK_MODEL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let LESSON = { title: 'Speech Game', matchMode: 'normal', cards: [] };
let currentIndex = 0, score = 0, cardSolved = false, hintUsed = false;
let voskModel = null, voskReady = false, voskPromise = null, voskFailed = false;
let usingVosk = false, isListening = false, isStarting = false, listenToken = 0;
let voskRecognizer = null, voskAudioCtx = null, voskProcessor = null, voskSource = null, micStream = null;
let recognition = null, lastResultHandled = false, listenTimer = null;

function setStatus(msg) {
  const el = document.getElementById('status');
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.textContent = msg;
}
function setFeedback(msg, type) {
  const el = document.getElementById('feedback');
  el.textContent = msg || '';
  el.className = 'feedback' + (type ? ' ' + type : '');
}

function loadLessonFromHash() {
  try {
    const h = location.hash.replace(/^#/, '');
    if (!h) return false;
    const raw = decodeURIComponent(h.startsWith('L=') ? h.slice(2) : h);
    const data = JSON.parse(raw);
    if (data && data.cards && data.cards.length) { LESSON = data; return true; }
  } catch (e) { console.warn(e); }
  return false;
}

function buildGrammar() {
  const words = {};
  (LESSON.cards || []).forEach(c => {
    const t = String(c.targetWord || '').toLowerCase().trim();
    if (t) words[t] = true;
    String(c.aliases || '').split(',').forEach(a => { a = a.toLowerCase().trim(); if (a) words[a] = true; });
  });
  const list = Object.keys(words); list.push('[unk]');
  return JSON.stringify(list);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Vosk) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Vosk'));
    document.head.appendChild(s);
  });
}

function ensureVosk() {
  if (voskFailed) return Promise.resolve(false);
  if (voskReady && voskModel) return Promise.resolve(true);
  if (voskPromise) return voskPromise;
  voskPromise = (async () => {
    try {
      setStatus('Downloading offline voice model (once, ~40MB)…');
      await loadScript(VOSK_JS);
      voskModel = await Vosk.createModel(VOSK_MODEL);
      voskReady = true;
      setStatus('Offline voice ready ✓');
      setTimeout(() => setStatus(''), 3000);
      return true;
    } catch (e) {
      console.warn(e);
      voskFailed = true;
      setStatus('Offline voice unavailable. Mic needs internet, or use Type / Tiles.');
      return false;
    }
  })();
  return voskPromise;
}

function stopVoskListen() {
  clearTimeout(listenTimer);
  try { if (voskProcessor) { voskProcessor.onaudioprocess = null; voskProcessor.disconnect(); } } catch (e) {}
  try { if (voskSource) voskSource.disconnect(); } catch (e) {}
  try { if (voskRecognizer) voskRecognizer.remove(); } catch (e) {}
  try { if (micStream) micStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { if (voskAudioCtx && voskAudioCtx.state !== 'closed') voskAudioCtx.close(); } catch (e) {}
  voskProcessor = voskSource = voskRecognizer = voskAudioCtx = micStream = null;
  usingVosk = false;
}

async function startVoskListen(token) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: false, audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
  });
  if (token !== listenToken) { stream.getTracks().forEach(t => t.stop()); return; }
  micStream = stream;
  voskAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (voskAudioCtx.state === 'suspended') try { await voskAudioCtx.resume(); } catch (e) {}
  const rec = new voskModel.KaldiRecognizer(voskAudioCtx.sampleRate, buildGrammar());
  voskRecognizer = rec;
  lastResultHandled = false;
  rec.on('result', (message) => {
    if (token !== listenToken || lastResultHandled || rec !== voskRecognizer) return;
    let text = (message && message.result && message.result.text) ? message.result.text : '';
    text = text.split('[unk]').join(' ').replace(/ +/g, ' ').trim();
    if (!text) { setFeedback('Not sure I heard that. Try again!', 'retry'); return; }
    lastResultHandled = true;
    stopVoskListen(); stopListeningUI();
    handleResult([text]);
  });
  rec.on('partialresult', (message) => {
    if (token !== listenToken) return;
    const p = (message && message.result && message.result.partial) ? message.result.partial.split('[unk]').join(' ').trim() : '';
    if (p) document.getElementById('heardText').textContent = p;
  });
  voskSource = voskAudioCtx.createMediaStreamSource(stream);
  voskProcessor = voskAudioCtx.createScriptProcessor(4096, 1, 1);
  voskProcessor.onaudioprocess = (ev) => { try { rec.acceptWaveform(ev.inputBuffer); } catch (e) {} };
  voskSource.connect(voskProcessor);
  voskProcessor.connect(voskAudioCtx.destination);
  usingVosk = isListening = true; isStarting = false;
  document.getElementById('micBtn').classList.add('listening');
  document.getElementById('micBtn').textContent = '⏹';
  document.getElementById('micLabel').textContent = 'Offline mic on — say the word!';
  listenTimer = setTimeout(() => {
    if (token !== listenToken || !usingVosk) return;
    listenToken++; stopVoskListen(); stopListeningUI();
    setFeedback("Didn't catch that. Tap mic and try again.", 'retry');
  }, 10000);
}

function createCloudRec() {
  const rec = new SpeechRecognition();
  rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 5;
  rec.onstart = () => {
    isListening = true; isStarting = false;
    document.getElementById('micBtn').classList.add('listening');
    document.getElementById('micBtn').textContent = '⏹';
    document.getElementById('micLabel').textContent = 'Listening…';
  };
  rec.onresult = (event) => {
    let interim = '', finals = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript.trim();
      if (event.results[i].isFinal) finals.push(t); else interim = t;
    }
    if (interim) document.getElementById('heardText').textContent = interim;
    if (finals.length && !lastResultHandled) { lastResultHandled = true; handleResult(finals); }
  };
  rec.onerror = (e) => {
    isStarting = false; stopListeningUI();
    if (e.error === 'network') { setFeedback('No internet. Use Type or Tiles.', 'retry'); showTypeInput(); }
    else if (e.error !== 'aborted') setFeedback('Mic issue. Try Type / Tiles.', 'retry');
  };
  rec.onend = () => { isStarting = false; stopListeningUI(); };
  return rec;
}

function stopListeningUI() {
  isListening = isStarting = false;
  const btn = document.getElementById('micBtn');
  if (btn) { btn.classList.remove('listening'); btn.textContent = '🎤'; }
  document.getElementById('micLabel').textContent = 'Tap the mic & say the word';
}

function toggleListen() {
  if (cardSolved) return;
  if (isListening || isStarting || usingVosk) {
    listenToken++; try { if (recognition) recognition.abort(); } catch (e) {}
    stopVoskListen(); stopListeningUI(); return;
  }
  setFeedback(''); document.getElementById('typeArea').style.display = 'none';
  document.getElementById('tileArea').style.display = 'none';
  isStarting = true; lastResultHandled = false;
  const token = ++listenToken;
  document.getElementById('micLabel').textContent = 'Starting mic…';
  document.getElementById('micBtn').classList.add('listening');
  document.getElementById('micBtn').textContent = '…';

  if (!voskReady && SpeechRecognition && navigator.onLine) {
    try { if (!recognition) recognition = createCloudRec(); recognition.start(); } catch (e) {
      isStarting = false; stopListeningUI(); setFeedback('Could not start mic.', 'retry');
    }
    return;
  }
  ensureVosk().then(ok => {
    if (token !== listenToken) return;
    if (ok) return startVoskListen(token);
    if (SpeechRecognition && navigator.onLine) {
      try { if (!recognition) recognition = createCloudRec(); recognition.start(); } catch (e) {
        isStarting = false; stopListeningUI(); showTypeInput();
      }
      return;
    }
    isStarting = false; stopListeningUI();
    setFeedback('Offline and voice model not ready. Use Type or Tiles.', 'retry');
    showTypeInput();
  }).catch(() => {
    if (token !== listenToken) return;
    stopVoskListen(); stopListeningUI();
    setFeedback('Mic failed. Use Type or Tiles.', 'retry'); showTypeInput();
  });
}

const NUM = {0:'zero',1:'one',2:'two',3:'three',4:'four',5:'five',6:'six',7:'seven',8:'eight',9:'nine',10:'ten'};
function cleanText(s) {
  return String(s||'').toLowerCase().replace(/\d+/g, n => NUM[n]||n).replace(/[^a-z\s\-']/g,' ').replace(/\s+/g,' ').trim();
}
function lettersOnly(s) { return cleanText(s).replace(/[^a-z]/g,''); }
function lev(a,b) {
  if (a===b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  const row = Array.from({length:b.length+1},(_,j)=>j);
  for (let i=1;i<=a.length;i++){ let prev=i-1,cur=i; for(let j=1;j<=b.length;j++){ const next=a[i-1]===b[j-1]?prev:Math.min(prev,cur,row[j])+1; prev=row[j]; row[j]=next; cur=next;} }
  return row[b.length];
}
function isMatch(spoken, card, mode) {
  mode = mode || LESSON.matchMode || 'normal';
  const targets = [card.targetWord].concat(String(card.aliases||'').split(',').map(a=>a.trim()).filter(Boolean)).map(cleanText).filter(Boolean);
  const spokenClean = cleanText(spoken); if (!spokenClean) return false;
  const words = spokenClean.split(/\s+/);
  const candidates = words.concat([words.join(''), lettersOnly(spokenClean)]);
  return targets.some(t => {
    const tL = lettersOnly(t);
    return candidates.some(w => {
      const wL = lettersOnly(w); if (!wL||!tL) return false;
      if (wL===tL||w===t) return true;
      if (mode==='strict') return false;
      if (mode==='normal' && tL.length>=5 && lev(wL,tL)<=1) return true;
      if (mode==='lenient' && tL.length>=4 && lev(wL,tL)<=1) return true;
      if (mode==='lenient' && tL.length>=7 && lev(wL,tL)<=2) return true;
      return false;
    });
  });
}

function handleResult(transcripts, fromTyping) {
  lastResultHandled = true; stopVoskListen();
  try { if (recognition) recognition.stop(); } catch (e) {}
  stopListeningUI();
  const card = LESSON.cards[currentIndex];
  const heard = (transcripts||[]).filter(Boolean);
  if (heard[0]) document.getElementById('heardText').textContent = heard[0];
  const mode = fromTyping ? 'strict' : (LESSON.matchMode||'normal');
  if (heard.some(t => isMatch(t, card, mode))) onCorrect();
  else setFeedback("Hmm, that didn't quite match. Try again!", 'retry');
}

function renderWordSlots(card, revealAll) {
  const word = String(card.targetWord||'');
  const blanks = card.blanks||[];
  const display = document.getElementById('wordDisplay');
  display.innerHTML = '';
  let letterIdx = 0;
  for (let i=0;i<word.length;i++) {
    const ch = word[i];
    if (!/[A-Za-z]/.test(ch)) {
      const gap = document.createElement('div');
      gap.style.width = ch===' '?'14px':'8px'; gap.style.height='48px';
      if (ch==='-'||ch==="'") { gap.textContent=ch; gap.style.width='16px'; gap.style.display='flex'; gap.style.alignItems='center'; gap.style.justifyContent='center'; gap.style.fontWeight='800'; }
      display.appendChild(gap); continue;
    }
    const slot = document.createElement('div');
    slot.className = 'letter-slot';
    const isBlank = blanks[letterIdx]===true;
    if (revealAll || !isBlank) { slot.textContent = ch.toUpperCase(); slot.classList.add(revealAll&&isBlank?'revealed':'visible'); }
    else { slot.classList.add('blank'); }
    display.appendChild(slot); letterIdx++;
  }
}

function loadCard(idx) {
  listenToken++; try { if (recognition) recognition.abort(); } catch(e){}
  stopVoskListen(); stopListeningUI();
  currentIndex = idx; cardSolved = false; hintUsed = false; lastResultHandled = false;
  const card = LESSON.cards[idx]; const total = LESSON.cards.length;
  document.getElementById('progressText').textContent = (idx+1)+' / '+total;
  document.getElementById('progressFill').style.width = Math.round((idx/total)*100)+'%';
  document.getElementById('feedback').textContent = '';
  document.getElementById('typeArea').style.display = 'none';
  document.getElementById('tileArea').style.display = 'none';
  document.getElementById('heardText').textContent = '—';
  document.getElementById('question').textContent = 'Say the word!';
  document.getElementById('gameTitle').textContent = LESSON.title || 'Speech Game';
  const frame = document.getElementById('imageFrame');
  frame.innerHTML = card.imageData ? '<img src="'+card.imageData+'" alt=""/>' : '<div style="font-size:3rem;opacity:.4">📷</div>';
  renderWordSlots(card, false);
}

function onCorrect() {
  cardSolved = true;
  renderWordSlots(LESSON.cards[currentIndex], true);
  setFeedback('Awesome! You got it! 🎉', 'success');
  score += hintUsed ? 1 : 2;
  document.getElementById('score').textContent = score;
  setTimeout(() => {
    if (currentIndex+1 < LESSON.cards.length) loadCard(currentIndex+1);
    else {
      document.getElementById('gameArea').style.display = 'none';
      document.getElementById('endScreen').classList.add('show');
      document.getElementById('finalScore').textContent = score;
      document.getElementById('progressFill').style.width = '100%';
    }
  }, 1600);
}

function showHint() {
  if (cardSolved) return; hintUsed = true;
  const h = LESSON.cards[currentIndex].hint;
  const w = LESSON.cards[currentIndex].targetWord || '';
  setFeedback(h && h.trim() ? '💡 '+h : '💡 Starts with "'+w[0]+'", '+w.replace(/[^A-Za-z]/g,'').length+' letters', 'hint');
}
function speakWord() {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(LESSON.cards[currentIndex].targetWord);
  u.lang = 'en-US'; u.rate = 0.85; speechSynthesis.speak(u);
}
function showTypeInput() {
  if (cardSolved) return;
  listenToken++; stopVoskListen(); try{if(recognition)recognition.abort();}catch(e){}
  stopListeningUI();
  document.getElementById('typeArea').style.display = 'block';
  document.getElementById('tileArea').style.display = 'none';
  document.getElementById('typeInput').value = '';
  document.getElementById('typeInput').focus();
  setFeedback('Type the full word, then Check.', 'hint');
}
function submitTyped() {
  const val = document.getElementById('typeInput').value;
  if (!val.trim()) { setFeedback('Type a word first.', 'retry'); return; }
  handleResult([val], true);
  document.getElementById('typeArea').style.display = 'none';
}
function showTileMode() {
  if (cardSolved) return;
  listenToken++; stopVoskListen(); stopListeningUI();
  document.getElementById('typeArea').style.display = 'none';
  const card = LESSON.cards[currentIndex];
  const letters = lettersOnly(card.targetWord).toUpperCase().split('');
  const blanks = card.blanks||[];
  let pos = []; for (let i=0;i<letters.length;i++) if (blanks[i]) pos.push(i);
  if (!pos.length) pos = letters.map((_,i)=>i);
  let need = pos.map(p => letters[p]);
  for (let s=need.length-1;s>0;s--){ const j=Math.floor(Math.random()*(s+1)); const t=need[s]; need[s]=need[j]; need[j]=t; }
  window._tileLetters = letters; window._tilePos = pos; window._tileBuilt = [];
  document.getElementById('tileArea').style.display = 'block';
  document.getElementById('tileBuilt').textContent = ' ';
  document.getElementById('tileTray').innerHTML = need.map(ch =>
    '<button type="button" class="tile-btn" data-ch="'+ch+'" onclick="tapTile(this)">'+ch+'</button>'
  ).join('');
  setFeedback('Tap letters to fill the blanks.', 'hint');
}
function tapTile(btn) {
  if (cardSolved || btn.disabled) return;
  window._tileBuilt.push(btn.getAttribute('data-ch'));
  btn.disabled = true; btn.style.opacity = '0.35';
  document.getElementById('tileBuilt').textContent = window._tileBuilt.join(' ');
  if (window._tileBuilt.length >= window._tilePos.length) {
    const full = window._tileLetters.slice();
    window._tilePos.forEach((p,n) => { full[p] = window._tileBuilt[n]; });
    if (full.join('') === window._tileLetters.join('')) {
      document.getElementById('tileArea').style.display = 'none';
      handleResult([full.join('')], true);
    } else { showTileMode(); setFeedback('Not quite. Try again!', 'retry'); }
  }
}
function restartGame() {
  score = 0; document.getElementById('score').textContent = '0';
  document.getElementById('endScreen').classList.remove('show');
  document.getElementById('gameArea').style.display = 'flex';
  loadCard(0);
}

if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

if (!loadLessonFromHash()) {
  LESSON = {
    title: 'Demo',
    matchMode: 'normal',
    cards: [{ targetWord: 'FROG', blanks: [false, true, false, false], hint: 'A green animal that hops', aliases: '', imageData: null }]
  };
  setStatus('No lesson in the link — showing a demo card. Open a share link from the teacher dashboard.');
}
document.getElementById('gameTitle').textContent = LESSON.title || 'Speech Game';
loadCard(0);
if (location.protocol.indexOf('http') === 0) setTimeout(() => ensureVosk(), 500);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('typeArea').style.display === 'block') submitTyped();
});
