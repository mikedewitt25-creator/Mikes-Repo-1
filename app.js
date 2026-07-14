(function () {
  'use strict';

  const dateInput = document.getElementById('dateInput');
  const prevDayBtn = document.getElementById('prevDay');
  const nextDayBtn = document.getElementById('nextDay');
  const refreshBtn = document.getElementById('refreshBtn');
  const statusEl = document.getElementById('status');
  const workoutEl = document.getElementById('workout');
  const setupBanner = document.getElementById('setupBanner');
  const exerciseTpl = document.getElementById('exerciseTemplate');
  const logFormTpl = document.getElementById('logFormTemplate');

  let state = { date: todayIso(), prescribed: [], actuals: [], loading: false };

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function shiftDate(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function apiConfigured() {
    return typeof window.APPS_SCRIPT_URL === 'string' && window.APPS_SCRIPT_URL.length > 0;
  }

  async function apiGet(params) {
    const url = new URL(window.APPS_SCRIPT_URL);
    Object.keys(params).forEach((k) => url.searchParams.set(k, params[k]));
    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    return data;
  }

  async function apiPost(body, opts) {
    opts = opts || {};
    const timeoutMs = opts.timeoutMs || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(window.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Unknown error');
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Timed out after ' + Math.round(timeoutMs / 1000) + 's. Try a shorter message or try again.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function loadDay(date) {
    if (!apiConfigured()) {
      setupBanner.hidden = false;
      setStatus('Not connected to a sheet yet.', true);
      workoutEl.innerHTML = '';
      return;
    }
    setupBanner.hidden = true;
    state.loading = true;
    setStatus('Loading…');
    try {
      const data = await apiGet({ action: 'getWorkout', date: date });
      state.date = data.date;
      state.prescribed = data.prescribed || [];
      state.actuals = data.actuals || [];
      setStatus('');
      render();
    } catch (err) {
      setStatus('Failed to load: ' + err.message, true);
    } finally {
      state.loading = false;
    }
  }

  function actualsForExercise(name) {
    return state.actuals
      .filter((a) => a.exercise.toLowerCase() === name.toLowerCase())
      .sort((a, b) => a.setNumber - b.setNumber);
  }

  function render() {
    workoutEl.innerHTML = '';

    const exercises = [...state.prescribed];

    state.actuals.forEach((a) => {
      const known = exercises.some((p) => p.exercise.toLowerCase() === a.exercise.toLowerCase());
      if (!known) exercises.push({ exercise: a.exercise, sets: 0, reps: '', weight: '', notes: '', adHoc: true });
    });

    if (exercises.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No workout prescribed for this day yet. Add rows in the Prescribed tab of the sheet.';
      workoutEl.appendChild(empty);
      return;
    }

    exercises.forEach((ex) => workoutEl.appendChild(renderExercise(ex)));
  }

  function renderExercise(prescribed) {
    const node = exerciseTpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.exercise-name').textContent = prescribed.exercise || 'Exercise';

    const line = node.querySelector('.prescribed-line');
    if (prescribed.adHoc) {
      line.textContent = '(logged outside prescription)';
    } else {
      const parts = [];
      if (prescribed.sets) parts.push(`${prescribed.sets} sets`);
      if (prescribed.reps) parts.push(`${prescribed.reps} reps`);
      if (prescribed.weight) parts.push(`@ ${prescribed.weight}`);
      line.textContent = parts.join(' × ') || '—';
      if (prescribed.notes) {
        const small = document.createElement('div');
        small.style.marginTop = '4px';
        small.style.fontStyle = 'italic';
        small.textContent = prescribed.notes;
        line.appendChild(small);
      }
    }

    const setsEl = node.querySelector('.sets');
    const logBtn = node.querySelector('.log-btn');
    const actionsEl = node.querySelector('.exercise-actions');

    const logged = actualsForExercise(prescribed.exercise);
    logged.forEach((a) => setsEl.appendChild(renderSet(a)));

    logBtn.addEventListener('click', () => {
      logBtn.disabled = true;
      const form = logFormTpl.content.firstElementChild.cloneNode(true);

      const lastLogged = logged[logged.length - 1];
      const repsInput = form.querySelector('input[name="reps"]');
      const weightInput = form.querySelector('input[name="weight"]');
      if (lastLogged) {
        repsInput.value = lastLogged.reps;
        weightInput.value = lastLogged.weight;
      } else if (!prescribed.adHoc) {
        const repsGuess = parseInt(String(prescribed.reps).match(/\d+/) || [], 10);
        const weightGuess = parseFloat(String(prescribed.weight).match(/[\d.]+/) || []);
        if (!isNaN(repsGuess)) repsInput.value = repsGuess;
        if (!isNaN(weightGuess)) weightInput.value = weightGuess;
      }

      form.querySelector('.cancel-btn').addEventListener('click', () => {
        form.remove();
        logBtn.disabled = false;
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const reps = Number(repsInput.value);
        const weight = Number(weightInput.value);
        const setNumber = logged.length + 1;
        const payload = {
          action: 'logSet',
          date: state.date,
          exercise: prescribed.exercise,
          setNumber: setNumber,
          reps: reps,
          weight: weight,
        };
        form.querySelector('.save-btn').disabled = true;
        setStatus('Saving set…');
        try {
          await apiPost(payload);
          setStatus('');
          await loadDay(state.date);
        } catch (err) {
          setStatus('Failed to save: ' + err.message, true);
          form.querySelector('.save-btn').disabled = false;
        }
      });

      actionsEl.before(form);
      repsInput.focus();
    });

    return node;
  }

  function renderSet(actual) {
    const row = document.createElement('div');
    row.className = 'set-row';
    const left = document.createElement('div');
    left.innerHTML = `<strong>Set ${actual.setNumber}</strong> · ${actual.reps} reps @ ${actual.weight}`;
    const right = document.createElement('button');
    right.className = 'delete-btn';
    right.setAttribute('aria-label', 'Delete set');
    right.textContent = '×';
    right.addEventListener('click', async () => {
      if (!confirm('Delete this set?')) return;
      setStatus('Deleting…');
      try {
        await apiPost({ action: 'deleteSet', rowIndex: actual.rowIndex });
        setStatus('');
        await loadDay(state.date);
      } catch (err) {
        setStatus('Failed to delete: ' + err.message, true);
      }
    });
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  dateInput.addEventListener('change', () => {
    if (dateInput.value) loadDay(dateInput.value);
  });
  prevDayBtn.addEventListener('click', () => {
    const next = shiftDate(state.date, -1);
    dateInput.value = next;
    loadDay(next);
  });
  nextDayBtn.addEventListener('click', () => {
    const next = shiftDate(state.date, 1);
    dateInput.value = next;
    loadDay(next);
  });
  refreshBtn.addEventListener('click', () => loadDay(state.date));

  dateInput.value = state.date;
  loadDay(state.date);

  /* ================= Roman chat ================= */

  const romanBar = document.getElementById('romanBar');
  const romanPanel = document.getElementById('romanPanel');
  const workoutPanel = document.getElementById('workoutPanel');
  const tabWorkout = document.getElementById('tabWorkout');
  const tabRoman = document.getElementById('tabRoman');
  const romanMessages = document.getElementById('romanMessages');
  const romanForm = document.getElementById('romanForm');
  const romanInput = document.getElementById('romanInput');
  const romanSend = document.getElementById('romanSend');

  let romanHistoryRendered = false;

  // Persist Roman's conversation across page loads so context isn't lost when
  // Mike closes the tab mid-conversation.
  let romanHistory = loadRomanHistory();

  function loadRomanHistory() {
    try {
      const raw = localStorage.getItem('romanHistory');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRomanHistory() {
    try {
      // Trim to last 40 turns to keep localStorage + Claude context bounded.
      const trimmed = romanHistory.slice(-40);
      localStorage.setItem('romanHistory', JSON.stringify(trimmed));
      romanHistory = trimmed;
    } catch (e) { /* quota — ignore */ }
  }

  function renderRomanHistory() {
    romanMessages.innerHTML = '';
    romanHistory.forEach((m) => {
      const text = extractText(m);
      if (!text) return;
      appendRomanBubble(m.role === 'user' ? 'user' : 'assistant', text);
    });
    if (romanHistory.length === 0) {
      appendRomanBubble('assistant', "What are we doing today?");
    }
    scrollRomanToBottom();
  }

  function extractText(msg) {
    if (typeof msg.content === 'string') return msg.content;
    if (!Array.isArray(msg.content)) return '';
    let out = '';
    msg.content.forEach((b) => {
      if (b && b.type === 'text') out += b.text;
    });
    return out;
  }

  function appendRomanBubble(role, text) {
    const el = document.createElement('div');
    el.className = 'roman-msg ' + role;
    el.textContent = text;
    romanMessages.appendChild(el);
    return el;
  }

  function scrollRomanToBottom() {
    romanMessages.scrollTop = romanMessages.scrollHeight;
  }

  function switchTab(tab) {
    if (tab === 'roman') {
      workoutPanel.hidden = true;
      romanPanel.hidden = false;
      romanBar.hidden = false;
      tabWorkout.classList.remove('active');
      tabRoman.classList.add('active');
      if (!romanHistoryRendered) {
        renderRomanHistory();
        romanHistoryRendered = true;
      }
      scrollRomanToBottom();
      setTimeout(() => romanInput.focus(), 50);
    } else {
      romanPanel.hidden = true;
      workoutPanel.hidden = false;
      romanBar.hidden = true;
      tabRoman.classList.remove('active');
      tabWorkout.classList.add('active');
      // Stop mic if user switches tabs while it's listening.
      if (typeof userWantsListening !== 'undefined' && userWantsListening && recognition) {
        userWantsListening = false;
        try { recognition.stop(); } catch (err) { /* ignore */ }
        setMicUI(false);
      }
    }
  }

  tabWorkout.addEventListener('click', () => switchTab('workout'));
  tabRoman.addEventListener('click', () => switchTab('roman'));

  romanInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      romanForm.requestSubmit();
    }
  });

  // Auto-grow textarea.
  romanInput.addEventListener('input', () => {
    romanInput.style.height = 'auto';
    romanInput.style.height = Math.min(romanInput.scrollHeight, 120) + 'px';
  });

  /* ---- Voice input (Web Speech API) ---- */

  const romanMic = document.getElementById('romanMic');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let userWantsListening = false;   // true while the mic button is "on"
  let micBaseText = '';             // textarea content before this dictation started
  let micFinalTranscript = '';      // accumulated finalized speech during this dictation

  if (!SpeechRecognition) {
    romanMic.disabled = true;
    romanMic.title = 'Voice input not supported in this browser';
  } else {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          micFinalTranscript += r[0].transcript + ' ';
        } else {
          interim += r[0].transcript;
        }
      }
      romanInput.value = (micBaseText + micFinalTranscript + interim).trimStart();
      // Retrigger auto-grow.
      romanInput.style.height = 'auto';
      romanInput.style.height = Math.min(romanInput.scrollHeight, 120) + 'px';
    };

    recognition.onerror = (event) => {
      // 'no-speech' fires when a listening chunk timed out with silence — that's
      // normal on iOS, don't surface it as a hard error.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      userWantsListening = false;
      setMicUI(false);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        appendRomanBubble('error', 'Mic permission denied. Enable microphone access for this site in Safari settings, then try again.');
      } else if (event.error === 'audio-capture') {
        appendRomanBubble('error', 'No microphone found.');
      } else {
        appendRomanBubble('error', 'Voice input error: ' + event.error);
      }
    };

    recognition.onend = () => {
      // iOS Safari auto-ends after each utterance even with continuous=true.
      // Restart if the user hasn't tapped stop.
      if (userWantsListening) {
        // Preserve everything already captured so it becomes the new baseline.
        micBaseText = (micBaseText + micFinalTranscript).replace(/\s+$/, '') + (micFinalTranscript ? ' ' : '');
        micFinalTranscript = '';
        try {
          recognition.start();
        } catch (e) {
          userWantsListening = false;
          setMicUI(false);
        }
      } else {
        setMicUI(false);
      }
    };
  }

  function setMicUI(active) {
    if (active) {
      romanMic.classList.add('listening');
      romanMic.textContent = '⏹';
      romanMic.setAttribute('aria-label', 'Stop voice input');
    } else {
      romanMic.classList.remove('listening');
      romanMic.textContent = '🎤';
      romanMic.setAttribute('aria-label', 'Voice input');
    }
  }

  romanMic.addEventListener('click', () => {
    if (!recognition) return;
    if (userWantsListening) {
      userWantsListening = false;
      try { recognition.stop(); } catch (e) { /* ignore */ }
      setMicUI(false);
      return;
    }
    // Starting a fresh dictation — capture whatever's already typed as the base.
    micBaseText = romanInput.value ? romanInput.value.replace(/\s+$/, '') + ' ' : '';
    micFinalTranscript = '';
    try {
      recognition.start();
      userWantsListening = true;
      setMicUI(true);
    } catch (err) {
      appendRomanBubble('error', 'Could not start mic: ' + err.message);
    }
  });

  romanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = romanInput.value.trim();
    if (!text) return;
    if (!apiConfigured()) {
      appendRomanBubble('error', 'Not connected to sheet. Fix config.js first.');
      return;
    }
    // Stop mic if it was still recording.
    if (userWantsListening && recognition) {
      userWantsListening = false;
      try { recognition.stop(); } catch (err) { /* ignore */ }
      setMicUI(false);
    }

    appendRomanBubble('user', text);
    romanInput.value = '';
    romanInput.style.height = 'auto';
    scrollRomanToBottom();

    const thinking = appendRomanBubble('assistant thinking', 'thinking…');
    scrollRomanToBottom();
    romanSend.disabled = true;

    try {
      const priorForRequest = romanHistory.slice();
      const data = await apiPost({
        action: 'chat',
        userMessage: text,
        today: todayIso(),
        messages: priorForRequest,
      }, { timeoutMs: 120000 });
      thinking.remove();
      const reply = data.reply || '(no reply)';
      appendRomanBubble('assistant', reply);
      // Server returns the full canonical message history (including tool_use
      // and tool_result blocks) — trust it as the new state so tool context
      // carries across turns.
      if (Array.isArray(data.messages)) {
        romanHistory = data.messages;
        saveRomanHistory();
      }
      // If Roman wrote to the sheet, refresh the visible day.
      loadDay(state.date);
    } catch (err) {
      thinking.remove();
      appendRomanBubble('error', 'Roman failed: ' + err.message);
    } finally {
      romanSend.disabled = false;
      scrollRomanToBottom();
      romanInput.focus();
    }
  });
})();
