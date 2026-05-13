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

  async function apiPost(body) {
    const res = await fetch(window.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    return data;
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
})();
