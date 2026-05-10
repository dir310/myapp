// ── Semáforo ZIPPY — Juego de reacción ──

let greenTime = 0;
let waiting = false;
let timeout = null;
let best = parseInt(localStorage.getItem('zippy_semaforo_best') || '0');

const $ = (id) => document.getElementById(id);

function openSemaforo() {
  $('semaforoOverlay').style.display = 'flex';
  $('semBest').textContent = best || '--';
  resetSemaforo();
}

function closeSemaforo() {
  $('semaforoOverlay').style.display = 'none';
  clearTimeout(timeout);
  waiting = false;
}

function resetSemaforo() {
  clearTimeout(timeout);
  waiting = false;
  const c = $('semCircle');
  c.className = 'sem-circle sem-off';
  c.textContent = '🏍️';
  $('semMsg').textContent = 'Toca el círculo para empezar';
  $('semResult').textContent = '';
}

function handleCircleTap() {
  const c = $('semCircle');
  const state = c.dataset.state || 'idle';

  if (state === 'idle') {
    // Start — show red, wait random time
    c.className = 'sem-circle sem-red';
    c.textContent = '🔴';
    c.dataset.state = 'waiting';
    $('semMsg').textContent = 'Espera el verde...';
    $('semResult').textContent = '';
    const delay = 1500 + Math.random() * 3000; // 1.5s to 4.5s
    timeout = setTimeout(() => {
      c.className = 'sem-circle sem-green';
      c.textContent = '🟢';
      c.dataset.state = 'green';
      greenTime = Date.now();
      $('semMsg').textContent = '¡¡TOCA AHORA!!';
    }, delay);

  } else if (state === 'waiting') {
    // Too early!
    clearTimeout(timeout);
    c.className = 'sem-circle sem-red';
    c.textContent = '😬';
    $('semMsg').textContent = '¡Muy pronto! Espera el verde';
    $('semResult').textContent = '';
    c.dataset.state = 'idle';

  } else if (state === 'green') {
    // Got it — measure reaction
    const reaction = Date.now() - greenTime;
    c.className = 'sem-circle sem-off';
    c.textContent = '🏍️';
    c.dataset.state = 'idle';
    $('semMsg').textContent = 'Toca para intentar de nuevo';

    let label = '';
    if (reaction < 250) label = '⚡ Increíble';
    else if (reaction < 400) label = '🔥 Muy rápido';
    else if (reaction < 600) label = '👍 Bien';
    else label = '🐢 Puedes mejorar';

    $('semResult').innerHTML = `<span style="font-size:28px;font-weight:900;color:#FF6B00;">${reaction}ms</span><br><span style="font-size:13px;">${label}</span>`;

    if (best === 0 || reaction < best) {
      best = reaction;
      localStorage.setItem('zippy_semaforo_best', String(best));
      $('semBest').textContent = best;
      $('semResult').innerHTML += '<br><span style="color:#30d158;font-size:12px;font-weight:bold;">🏆 ¡Nuevo récord!</span>';
    }
  }
}

window.openSemaforo = openSemaforo;
window.closeSemaforo = closeSemaforo;
window.handleCircleTap = handleCircleTap;
