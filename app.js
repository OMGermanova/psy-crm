'use strict';

/* ============================================================
   Кабинет — простая CRM для психолога.
   Данные лежат в localStorage браузера, сервер не нужен.
   ============================================================ */

const STORE_KEY = 'psy-crm-v1';

const STATUS = {
  new:    { label: 'Новый',    className: 'st-new' },
  active: { label: 'В работе', className: 'st-active' },
  paused: { label: 'Пауза',    className: 'st-paused' },
  done:   { label: 'Завершён', className: 'st-done' },
};

const state = {
  clients: [],
  sessions: [],
  view: 'today',
  query: '',
  statusFilter: 'all',
};

/* ---------- мелкие помощники ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const money = n => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' ₽';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parseDate(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}
const humanDate = s => parseDate(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const humanDateShort = s => parseDate(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const weekday = s => parseDate(s).toLocaleDateString('ru-RU', { weekday: 'short' });

function relDay(s) {
  const t = today();
  if (s === t) return 'Сегодня';
  const diff = Math.round((parseDate(s) - parseDate(t)) / 86400000);
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  if (diff > 1 && diff < 7) return parseDate(s).toLocaleDateString('ru-RU', { weekday: 'long' });
  return humanDate(s);
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).slice(0, 2);
  const out = parts.map(w => (w[0] ? w[0].toUpperCase() : '')).join('');
  return out || '—';
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const clientById = id => state.clients.find(c => c.id === id);
const sessionsOf = id => state.sessions
  .filter(s => s.clientId === id)
  .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

function matchesQuery(...parts) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return parts.filter(Boolean).join(' ').toLowerCase().includes(q);
}

/* ---------- хранилище ---------- */

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* file:// без хранилища */ }
  if (!raw) { seed(); save(); return; }
  try {
    const data = JSON.parse(raw);
    state.clients = Array.isArray(data.clients) ? data.clients : [];
    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  } catch (e) {
    console.warn('Не удалось прочитать сохранённые данные, начинаем с демо-набора.', e);
    seed();
    save();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ clients: state.clients, sessions: state.sessions }));
    rememberSnapshot();
  } catch (e) {
    console.warn('Браузер не даёт сохранить данные:', e);
  }
}

/* ---------- снимки состояния (страховка от случайного удаления) ---------- */

const SNAP_KEY = 'psy-crm-snapshots';
const SNAP_LIMIT = 10;
const SNAP_MIN_GAP = 120000; // не чаще одного снимка в 2 минуты

let lastSnapAt = 0;
let lastSnapHash = '';

function dataHash() {
  return JSON.stringify({ clients: state.clients, sessions: state.sessions });
}

function readSnapshots() {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeSnapshots(list) {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(list.slice(0, SNAP_LIMIT)));
  } catch (e) {
    console.warn('Не удалось сохранить снимок:', e);
  }
}

function rememberSnapshot(force = false) {
  const hash = dataHash();
  const now = Date.now();
  if (hash === lastSnapHash) return;
  if (!force && now - lastSnapAt < SNAP_MIN_GAP) return;

  const list = readSnapshots();
  list.unshift({
    at: now,
    clients: state.clients.length,
    sessions: state.sessions.length,
    data: JSON.parse(hash),
  });
  writeSnapshots(list);
  lastSnapHash = hash;
  lastSnapAt = now;
}

function restoreSnapshot(index) {
  const list = readSnapshots();
  const snap = list[index];
  if (!snap) return false;
  state.clients = snap.data.clients || [];
  state.sessions = snap.data.sessions || [];
  save();
  render();
  return true;
}

function snapshotTime(ts) {
  const d = new Date(ts);
  const t = today();
  const day = iso(d);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (day === t) return `сегодня, ${time}`;
  const diff = Math.round((parseDate(day) - parseDate(t)) / 86400000);
  if (diff === -1) return `вчера, ${time}`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ', ' + time;
}

function seed() {
  const base = new Date();
  const day = off => iso(new Date(base.getFullYear(), base.getMonth(), base.getDate() + off));

  // Контакты намеренно несуществующие: диапазон 000 в номерах и домен example.com
  // зарезервированы специально для примеров и не могут принадлежать реальному человеку.
  state.clients = [
    { id: 'c1', name: 'Анна Петрова',   phone: '+7 000 000-00-01', email: 'anna.petrova@example.com', status: 'active', price: 4000, note: 'Тревожность, отношения с матерью. Раз в неделю, вторник вечером.', createdAt: day(-120) },
    { id: 'c2', name: 'Дмитрий Соколов', phone: '+7 000 000-00-02', email: 'd.sokolov@example.com',    status: 'active', price: 4500, note: 'Выгорание на работе. Раз в неделю, пятница.', createdAt: day(-64) },
    { id: 'c3', name: 'Марина Ильина',  phone: '+7 000 000-00-03', email: '',                         status: 'new',    price: 3500, note: 'Запрос про самооценку, первичная консультация.', createdAt: day(-6) },
    { id: 'c4', name: 'Игорь Величко',  phone: '+7 000 000-00-04', email: 'i.velichko@example.com',   status: 'paused', price: 4000, note: 'Командировка до конца месяца, вернётся в работу.', createdAt: day(-200) },
    { id: 'c5', name: 'Ольга Наумова',  phone: '+7 000 000-00-05', email: '',                         status: 'done',   price: 3800, note: 'Работа завершена после 14 сессий.', createdAt: day(-420) },
  ];

  state.sessions = [
    { id: 's1', clientId: 'c1', date: day(0),   time: '10:00', topic: 'Границы с матерью',        note: '',                                    amount: 4000, paid: false },
    { id: 's2', clientId: 'c2', date: day(0),   time: '15:30', topic: 'Восстановление ресурса',   note: '',                                    amount: 4500, paid: false },
    { id: 's3', clientId: 'c3', date: day(1),   time: '12:00', topic: 'Знакомство, сбор анамнеза', note: '',                                   amount: 3500, paid: false },
    { id: 's4', clientId: 'c1', date: day(7),   time: '10:00', topic: 'Продолжение работы',       note: '',                                    amount: 4000, paid: false },
    { id: 's5', clientId: 'c1', date: day(-7),  time: '10:00', topic: 'Телесные реакции на стресс', note: 'Договорились вести дневник состояния.', amount: 4000, paid: true },
    { id: 's6', clientId: 'c2', date: day(-5),  time: '15:30', topic: 'Границы в коллективе',     note: '',                                    amount: 4500, paid: true },
    { id: 's7', clientId: 'c4', date: day(-12), time: '19:00', topic: 'Пауза в работе',           note: 'Возвращение через месяц.',            amount: 4000, paid: false },
    { id: 's8', clientId: 'c3', date: day(-6),  time: '12:30', topic: 'Первичная встреча',        note: 'Запрос: «не могу себя хвалить».',     amount: 3500, paid: true },
  ];
}

/* ---------- таблица для Excel ---------- */

function csvCell(value) {
  const s = String(value ?? '');
  // защита от «съедания» длинных номеров и от формул в Excel
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function downloadFile(name, text, mime) {
  const blob = new Blob(['\uFEFF' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCsv() {
  const clientRows = [
    ['Имя', 'Телефон', 'Почта', 'Статус', 'Стоимость', 'Заметка', 'Клиент с'],
    ...state.clients.map(c => [
      c.name,
      c.phone,
      c.email,
      (STATUS[c.status] || {}).label || '',
      c.price || 0,
      c.note,
      c.createdAt,
    ]),
  ];

  const sessionRows = [
    ['Дата', 'Время', 'Клиент', 'Тема', 'Сумма', 'Оплачено', 'Заметка'],
    ...[...state.sessions]
      .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')))
      .map(s => {
        const c = clientById(s.clientId);
        return [
          s.date,
          s.time,
          c ? c.name : 'клиент удалён',
          s.topic,
          s.amount || 0,
          s.paid ? 'да' : 'нет',
          s.note,
        ];
      }),
  ];

  const toText = rows => rows.map(r => r.map(csvCell).join(';')).join('\r\n');
  downloadFile(`kabinet-klienty-${today()}.csv`, toText(clientRows), 'text/csv;charset=utf-8');
  setTimeout(() => downloadFile(`kabinet-sessii-${today()}.csv`, toText(sessionRows), 'text/csv;charset=utf-8'), 350);
  toast('Две таблицы сохранены в загрузки');
}

/* ---------- версия для печати ---------- */

function exportPrint() {
  const t = today();
  const month = t.slice(0, 7);
  const inMonth = state.sessions.filter(s => s.date.slice(0, 7) === month);
  const paid = inMonth.filter(s => s.paid).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const debt = inMonth.filter(s => !s.paid).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  const rows = state.clients.map(c => {
    const all = sessionsOf(c.id);
    const past = all.filter(s => s.date <= t);
    const unpaid = all.filter(s => !s.paid && s.date <= t).length;
    const st = STATUS[c.status] || { label: '—' };
    return `
      <tr>
        <td>${esc(c.name)}</td>
        <td>${esc(st.label)}</td>
        <td>${esc(c.phone || '—')}</td>
        <td>${esc(c.email || '—')}</td>
        <td class="num">${c.price ? money(c.price) : '—'}</td>
        <td class="num">${past.length}</td>
        <td class="num">${unpaid || '—'}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Кабинет — сводка на ${t}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #2b2925; margin: 32px; }
  h1 { font-size: 21px; margin: 0 0 4px; letter-spacing: -.02em; }
  .sub { color: #7a736a; margin: 0 0 22px; }
  .totals { display: flex; gap: 26px; margin-bottom: 22px; flex-wrap: wrap; }
  .totals div { font-size: 12px; color: #7a736a; }
  .totals strong { display: block; font-size: 17px; color: #2b2925; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #e8e4dc; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #7a736a; border-bottom: 1px solid #d8d2c6; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: 0; }
  .foot { margin-top: 26px; font-size: 11.5px; color: #9a938a; }
  @media print { body { margin: 0; } .foot { position: fixed; bottom: 0; } }
</style>
</head>
<body>
  <h1>Кабинет — сводка</h1>
  <p class="sub">${esc(new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>

  <div class="totals">
    <div>Клиентов<strong>${state.clients.length}</strong></div>
    <div>Сессий в этом месяце<strong>${inMonth.length}</strong></div>
    <div>Оплачено за месяц<strong>${money(paid)}</strong></div>
    <div>Не оплачено<strong>${money(debt)}</strong></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Клиент</th><th>Статус</th><th>Телефон</th><th>Почта</th>
        <th class="num">Стоимость</th><th class="num">Сессий</th><th class="num">Долги</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <p class="foot">Демонстрационные данные. Сформировано автоматически, ${esc(new Date().toLocaleString('ru-RU'))}.</p>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Браузер заблокировал новое окно. Разреши всплывающие окна для этого сайта.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  toast('Сводка открыта в новом окне');
}

/* ---------- копия данных: экспорт и импорт ---------- */

function exportData() {
  const payload = {
    app: 'Кабинет',
    version: 1,
    exportedAt: new Date().toISOString(),
    clients: state.clients,
    sessions: state.sessions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kabinet-kopiya-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Копия сохранена в загрузки');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const clients = Array.isArray(data.clients) ? data.clients : null;
      const sessions = Array.isArray(data.sessions) ? data.sessions : null;
      if (!clients || !sessions) throw new Error('в файле нет клиентов и сессий');

      if (!confirm(`Заменить текущие данные копией?\n\nВ копии: клиентов — ${clients.length}, сессий — ${sessions.length}.\nТекущие данные можно будет вернуть через «Историю».`)) return;

      rememberSnapshot(true);
      state.clients = clients;
      state.sessions = sessions;
      save();
      render();
      toast('Данные загружены из копии');
    } catch (e) {
      alert('Не получилось прочитать файл. Похоже, это не копия данных «Кабинета».\n\n' + e.message);
    }
  };
  reader.onerror = () => alert('Не удалось открыть файл.');
  reader.readAsText(file);
}

/* ---------- история изменений ---------- */

function renderHistory() {
  const list = readSnapshots();
  const box = $('#historyList');
  if (!box) return;

  box.innerHTML = list.length
    ? list.map((s, i) => `
        <div class="history-row">
          <span class="history-when">${esc(snapshotTime(s.at))}</span>
          <span class="history-count">${s.clients} ${plural(s.clients, 'клиент', 'клиента', 'клиентов')} · ${s.sessions} ${plural(s.sessions, 'сессия', 'сессии', 'сессий')}</span>
          <button class="btn btn-soft btn-sm" data-restore="${i}" type="button">Вернуть</button>
        </div>`).join('')
    : `<div class="empty">Пока нет снимков. Они появятся, как только ты что-нибудь изменишь.</div>`;
}

/* ---------- уведомление ---------- */

let toastTimer = null;

function toast(text) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}

/* ---------- расписание недели ---------- */

let weekOffset = 0;

function weekStart(offset) {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // понедельник = 0
  d.setDate(d.getDate() - dow + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderWeek() {
  const start = weekStart(weekOffset);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return iso(d);
  });
  const t = today();

  const end = days[6];
  const label = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    + ' — ' + parseDate(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  $('#weekTitle').textContent = weekOffset === 0 ? 'Расписание недели' : 'Неделя ' + label;

  const total = state.sessions.filter(s => s.date >= days[0] && s.date <= end);
  const busy = total.length;
  const free = state.clients.filter(c => c.status === 'active' || c.status === 'new').length;

  $('#weekList').innerHTML = days.map(day => {
    const list = state.sessions
      .filter(s => s.date === day)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const isToday = day === t;
    const isPast = day < t;

    return `
      <div class="week-day${isToday ? ' is-today' : ''}${isPast ? ' is-past' : ''}">
        <div class="week-day-head">
          <span class="week-dow">${parseDate(day).toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
          <span class="week-num">${parseDate(day).getDate()}</span>
        </div>
        <div class="week-slots">
          ${list.length
            ? list.map(s => {
                const c = clientById(s.clientId) || {};
                return `
                  <button class="week-slot" data-open-session="${s.id}" type="button">
                    <span class="week-time">${esc(s.time || '—')}</span>
                    <span class="week-name">${esc(c.name || 'Клиент удалён')}</span>
                  </button>`;
              }).join('')
            : '<span class="week-free">свободно</span>'}
        </div>
      </div>`;
  }).join('');

  const summary = $('#week');
  if (summary) {
    summary.innerHTML = `
      <div class="week-stat"><strong>${busy}</strong><span>${plural(busy, 'встреча', 'встречи', 'встреч')} на неделе</span></div>
      <div class="week-stat"><strong>${free}</strong><span>клиентов в работе</span></div>
      <div class="week-stat"><strong>${busy ? (busy / 5).toFixed(1) : '0'}</strong><span>встреч в день</span></div>
    `;
  }
}

/* ---------- «мостик»: о чём договорились в прошлый раз ---------- */

function bridgeFor(clientId) {
  const t = today();
  const all = state.sessions
    .filter(s => s.clientId === clientId && (s.note || s.topic))
    .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

  // сначала ищем именно прошедшие встречи, и только потом сегодняшние
  const last = all.find(s => s.date < t) || all.find(s => s.date === t);
  if (!last) return '';
  const text = (last.note || last.topic || '').trim();
  if (!text) return '';
  const when = last.date === t ? 'сегодня' : humanDateShort(last.date);
  return `<div class="bridge">
    <span class="bridge-label">Прошлый раз · ${esc(when)}</span>
    <span class="bridge-text">${esc(text)}</span>
  </div>`;
}

/* ---------- таймер сессии ---------- */

const TIMER_MINUTES = 50;
let timerLeft = TIMER_MINUTES * 60;
let timerRunning = false;
let timerId = null;

function timerPaint() {
  const m = Math.floor(timerLeft / 60);
  const s = timerLeft % 60;
  $('#timerFace').textContent = `${pad(m)}:${pad(s)}`;

  const total = TIMER_MINUTES * 60;
  const done = Math.max(0, Math.min(100, ((total - timerLeft) / total) * 100));
  $('#timerBar').style.width = done + '%';

  const face = $('#timerFace');
  face.classList.toggle('is-warning', timerLeft <= 600 && timerLeft > 0);
  face.classList.toggle('is-over', timerLeft <= 0);
}

function timerTick() {
  if (!timerRunning) return;
  timerLeft -= 1;
  if (timerLeft === 600) toast('Осталось 10 минут');
  if (timerLeft <= 0) {
    timerLeft = 0;
    timerRunning = false;
    clearInterval(timerId);
    timerId = null;
    $('#timerToggle').textContent = 'Заново';
    $('#timerHint').textContent = 'Время вышло.';
    toast('Время сессии истекло');
  }
  timerPaint();
}

function timerStart(minutes) {
  if (typeof minutes === 'number') timerLeft = minutes * 60;
  timerRunning = true;
  $('#timerToggle').textContent = 'Пауза';
  $('#timerHint').textContent = 'Сессия идёт. За 10 минут до конца подам знак.';
  clearInterval(timerId);
  timerId = setInterval(timerTick, 1000);
  timerPaint();
}

function timerStop() {
  timerRunning = false;
  clearInterval(timerId);
  timerId = null;
  $('#timerToggle').textContent = 'Продолжить';
}

function timerReset(minutes = TIMER_MINUTES) {
  timerStop();
  timerLeft = minutes * 60;
  $('#timerToggle').textContent = 'Старт';
  $('#timerHint').textContent = 'Готов, когда будешь готова.';
  timerPaint();
}

/* ---------- режим «босс»: скрыть имена и суммы ---------- */

let bossMode = false;

function applyBoss() {
  document.body.classList.toggle('is-boss', bossMode);
  const btn = $('#bossMode');
  if (btn) btn.setAttribute('aria-pressed', bossMode ? 'true' : 'false');
  try { localStorage.setItem('psy-crm-boss', bossMode ? '1' : '0'); } catch (e) { /* нет хранилища */ }
}

/* ---------- состояние встречи по времени ---------- */

const SESSION_MINUTES = 50;

function sessionState(s) {
  if (s.date < today()) return 'past';
  if (s.date > today()) return 'future';
  if (!s.time) return 'today';

  const [h, m] = String(s.time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 'today';

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const end = new Date(start.getTime() + SESSION_MINUTES * 60000);

  if (now < start) return 'soon';
  if (now < end) return 'now';
  return 'past';
}

function sessionBadge(s) {
  if (s.paid) return '<span class="pill pill-paid">Оплачено</span>';

  const st = sessionState(s);
  if (st === 'now') return '<span class="pill pill-now">Сейчас идёт</span>';
  if (st === 'past') return '<span class="pill pill-unpaid">Не оплачено</span>';
  if (st === 'soon') return '<span class="pill pill-soon">Скоро</span>';
  return '<span></span>';
}

/* ---------- отрисовка ---------- */

function render() {
  renderToday();
  renderClients();
  renderSessions();
  renderWeek();
}

function setView(view) {
  state.view = view;
  $$('.nav-item').forEach(btn => btn.classList.toggle('is-active', btn.dataset.view === view));
  $$('.view').forEach(section => section.classList.toggle('is-active', section.id === `view-${view}`));
}

function renderToday() {
  const now = new Date();
  const h = now.getHours();
  const hello = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';

  $('#greeting').textContent = hello;
  $('#todayDate').textContent = now.toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  $('#navClients').textContent = state.clients.length;

  const t = today();
  const month = t.slice(0, 7);
  const todays = state.sessions.filter(s => s.date === t).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const inWork = state.clients.filter(c => c.status === 'active' || c.status === 'new');
  const paused = state.clients.filter(c => c.status === 'paused');
  const income = state.sessions.filter(s => s.paid && s.date.slice(0, 7) === month)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const debt = state.sessions.filter(s => !s.paid && s.date <= t)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const next = [...state.sessions].filter(s => s.date >= t)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];

  const todayHint = todays.length
    ? todays.map(s => `${s.time || ''} ${(clientById(s.clientId) || {}).name || ''}`.trim()).join(' · ')
    : 'Свободный день';
  const monthLabel = now.toLocaleDateString('ru-RU', { month: 'long' });
  const nextHint = next
    ? `${next.time || 'без времени'} · ${(clientById(next.clientId) || {}).name || 'клиент не найден'}`
    : 'Пока ничего не запланировано';

  $('#stats').innerHTML = `
    <div class="stat">
      <span class="stat-label">Сессий сегодня</span>
      <strong class="stat-value">${todays.length}</strong>
      <span class="stat-hint">${esc(todayHint)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Клиентов в работе</span>
      <strong class="stat-value">${inWork.length}</strong>
      <span class="stat-hint">всего в базе: ${state.clients.length}${paused.length ? `, на паузе: ${paused.length}` : ''}</span>
    </div>
    <div class="stat${debt ? ' is-warm' : ''}">
      <span class="stat-label">Оплачено за ${monthLabel}</span>
      <strong class="stat-value">${money(income)}</strong>
      <span class="stat-hint">${debt ? `не оплачено: ${money(debt)}` : 'долгов нет'}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Ближайшая встреча</span>
      <strong class="stat-value">${next ? esc(relDay(next.date)) : '—'}</strong>
      <span class="stat-hint">${esc(nextHint)}</span>
    </div>
  `;

  const upcoming = [...state.sessions]
    .filter(s => s.date >= t)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
    .slice(0, 6);

  $('#upcoming').innerHTML = upcoming.length
    ? upcoming.map(s => {
        const c = clientById(s.clientId) || {};
        const badge = sessionBadge(s);
        const nowClass = sessionState(s) === 'now' ? ' is-now' : '';
        return `
          <button class="session-row${nowClass}" data-open-session="${s.id}" type="button">
            <span class="session-date"><strong>${esc(relDay(s.date))}</strong><span>${s.time ? esc(s.time) : 'время не задано'}</span></span>
            <span class="session-main">
              <strong>${esc(c.name || 'Клиент удалён')}</strong>
              <span>${esc(s.topic || 'без темы')}</span>
            </span>
            ${badge}
          </button>`;
      }).join('')
    : '<div class="empty">Запланированных встреч нет. Добавь сессию кнопкой «+ Сессия».</div>';
}

function renderClients() {
  const filters = [['all', 'Все'], ['active', 'В работе'], ['new', 'Новые'], ['paused', 'Пауза'], ['done', 'Завершённые']];
  $('#statusFilter').innerHTML = filters.map(([key, label]) =>
    `<button class="chip${state.statusFilter === key ? ' is-active' : ''}" data-status="${key}" type="button">${label}</button>`
  ).join('');

  const list = state.clients.filter(c =>
    (state.statusFilter === 'all' || c.status === state.statusFilter) &&
    matchesQuery(c.name, c.phone, c.email, c.note));

  $('#clientsSub').textContent = `${list.length} ${plural(list.length, 'клиент', 'клиента', 'клиентов')}`
    + (state.query.trim() ? ` по запросу «${state.query.trim()}»` : '');

  $('#clientsGrid').innerHTML = list.length
    ? list.map(c => {
        const sessions = sessionsOf(c.id);
        const past = sessions.filter(s => s.date <= today());
        const next = sessions.find(s => s.date >= today());
        const contacts = [c.phone, c.email].filter(Boolean).join(' · ') || 'контакты не заполнены';
        const st = STATUS[c.status] || { label: '—', className: 'st-done' };
        return `
          <button class="client-card" data-open-client="${c.id}" type="button">
            <span class="avatar">${esc(initials(c.name))}</span>
            <span class="client-body">
              <span class="client-top">
                <strong>${esc(c.name)}</strong>
                <span class="pill ${st.className}">${esc(st.label)}</span>
              </span>
              <span class="client-meta">${esc(contacts)}</span>
              <span class="client-meta">${past.length} ${plural(past.length, 'сессия', 'сессии', 'сессий')}${next ? ` · след. ${humanDateShort(next.date)}` : ''}</span>
            </span>
          </button>`;
      }).join('')
    : `<div class="empty">Никого не нашлось. <button class="link-btn" data-action="new-client" type="button">Добавить клиента</button></div>`;
}

function renderSessions() {
  const q = state.query.trim();
  let list = [...state.sessions].sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  if (q) list = list.filter(s => {
    const c = clientById(s.clientId) || {};
    return matchesQuery(c.name, s.topic, s.note);
  });

  $('#sessionsSub').textContent = `${list.length} ${plural(list.length, 'сессия', 'сессии', 'сессий')}`
    + (q ? ` по запросу «${q}»` : ' — все, новые сверху');

  if (!list.length) {
    $('#sessionsList').innerHTML = '<div class="empty">Сессий пока нет. Добавь первую кнопкой «+ Сессия» на главной.</div>';
    return;
  }

  const head = `<div class="sessions-head">
      <span>Дата</span><span>Клиент</span><span>Тема</span><span>Стоимость</span><span></span><span></span>
    </div>`;

  const rows = list.map(s => {
    const c = clientById(s.clientId) || {};
    return `
      <div class="session-line">
        <span class="s-date"><strong>${humanDateShort(s.date)}</strong><span>${weekday(s.date)}${s.time ? ', ' + esc(s.time) : ''}</span></span>
        <span class="s-client">${esc(c.name || 'клиент удалён')}</span>
        <span class="s-topic">${esc(s.topic || '—')}</span>
        <span class="s-amount">${s.amount ? money(s.amount) : '—'}</span>
        <button class="pill ${s.paid ? 'pill-paid' : 'pill-unpaid'}" data-toggle-paid="${s.id}" type="button"
          title="Нажми, чтобы отметить оплату">${s.paid ? 'Оплачено' : 'Не оплачено'}</button>
        <button class="icon-btn" data-del-session="${s.id}" type="button" title="Удалить сессию">×</button>
      </div>`;
  }).join('');

  $('#sessionsList').innerHTML = head + rows;
}

/* ---------- диалоги ---------- */

const clientDialog = $('#clientDialog');
const sessionDialog = $('#sessionDialog');
const cardDialog = $('#cardDialog');

function fillStatuses(select, value) {
  select.innerHTML = Object.entries(STATUS).map(([key, v]) =>
    `<option value="${key}"${key === value ? ' selected' : ''}>${v.label}</option>`).join('');
}

function openClientForm(client) {
  $('#clientFormTitle').textContent = client ? 'Клиент' : 'Новый клиент';
  $('#clientId').value = client ? client.id : '';
  $('#clientName').value = client ? client.name : '';
  $('#clientPhone').value = client ? client.phone || '' : '';
  $('#clientEmail').value = client ? client.email || '' : '';
  $('#clientPrice').value = client ? client.price || '' : '';
  $('#clientNote').value = client ? client.note || '' : '';
  fillStatuses($('#clientStatus'), client ? client.status : 'new');
  clientDialog.showModal();
  setTimeout(() => $('#clientName').focus(), 40);
}

function openSessionForm(session, presetClientId) {
  if (!state.clients.length) { openClientForm(null); return; }

  const selected = session ? session.clientId : (presetClientId || state.clients[0].id);
  $('#sessionFormTitle').textContent = session ? 'Сессия' : 'Новая сессия';
  $('#sessionId').value = session ? session.id : '';
  $('#sessionClient').innerHTML = state.clients.map(c =>
    `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  $('#sessionDate').value = session ? session.date : today();
  $('#sessionTime').value = session ? session.time || '' : '';
  $('#sessionTopic').value = session ? session.topic || '' : '';
  $('#sessionNote').value = session ? session.note || '' : '';
  $('#sessionAmount').value = session ? (session.amount ?? '') : ((clientById(selected) || {}).price || '');
  $('#sessionPaid').checked = session ? !!session.paid : false;

  sessionDialog.showModal();
}

function openClientCard(id) {
  const c = clientById(id);
  if (!c) return;

  const sessions = sessionsOf(id);
  const past = sessions.filter(s => s.date <= today());
  const paidSum = sessions.filter(s => s.paid).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const debt = sessions.filter(s => !s.paid && s.date <= today()).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const next = sessions.find(s => s.date >= today());
  const st = STATUS[c.status] || { label: '—', className: 'st-done' };

  $('#cardBody').innerHTML = `
    ${bridgeFor(c.id)}
    <div class="card-head">
      <span class="avatar">${esc(initials(c.name))}</span>
      <div>
        <h2>${esc(c.name)}</h2>
        <span class="pill ${st.className}">${esc(st.label)}</span>
      </div>
    </div>

    <dl class="card-facts">
      <div><dt>Телефон</dt><dd>${esc(c.phone || '—')}</dd></div>
      <div><dt>E-mail</dt><dd>${esc(c.email || '—')}</dd></div>
      <div><dt>Стоимость сессии</dt><dd>${c.price ? money(c.price) : '—'}</dd></div>
      <div><dt>Проведено сессий</dt><dd>${past.length}</dd></div>
      <div><dt>Оплачено всего</dt><dd>${money(paidSum)}</dd></div>
      <div><dt>Ближайшая</dt><dd>${next ? `${esc(relDay(next.date))}${next.time ? ', ' + esc(next.time) : ''}` : '—'}</dd></div>
    </dl>

    ${c.note ? `<div class="card-note">${esc(c.note)}</div>` : ''}
    ${debt ? `<div class="card-note">Ждёт оплаты: <strong>${money(debt)}</strong></div>` : ''}

    <div>
      <h3 style="margin:0 0 8px;font-size:14px;">История сессий</h3>
      <div class="card-sessions">
        ${sessions.length
          ? [...sessions].reverse().map(s => `
              <div class="card-session">
                <span class="s-date"><strong>${humanDateShort(s.date)}</strong><span>${weekday(s.date)}</span></span>
                <span class="s-topic">${esc(s.topic || 'без темы')}</span>
                <span class="pill ${s.paid ? 'pill-paid' : 'pill-unpaid'}">${s.paid ? 'оплачено' : 'долг'}</span>
              </div>`).join('')
          : '<div class="empty" style="padding:14px">Сессий ещё не было</div>'}
      </div>
    </div>

    <div class="card-actions">
      <button class="btn btn-primary" data-action="add-session" data-client-id="${c.id}" type="button">+ Сессия</button>
      <button class="btn btn-soft" data-action="edit-client" data-client-id="${c.id}" type="button">Редактировать</button>
      <button class="btn btn-danger" data-action="delete-client" data-client-id="${c.id}" type="button">Удалить</button>
      <button class="btn btn-ghost" data-close-card type="button" style="margin-left:auto">Закрыть</button>
    </div>
  `;

  cardDialog.showModal();
}

/* ---------- события ---------- */

$$('.nav-item').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
$('#brandHome').addEventListener('click', () => setView('today'));

$('#newClient').addEventListener('click', () => openClientForm(null));
$('#quickSession').addEventListener('click', () => openSessionForm(null));

$('#search').addEventListener('input', e => {
  state.query = e.target.value;
  render();
});

$$('[data-reset-demo]').forEach(btn => btn.addEventListener('click', () => {
  if (!confirm('Вернуть демонстрационные данные? Всё, что ты добавила, будет удалено.')) return;
  seed();
  save();
  render();
}));

document.addEventListener('click', e => {
  const target = e.target.closest('[data-status],[data-open-client],[data-open-session],[data-toggle-paid],[data-del-session],[data-action],[data-close],[data-close-card]');
  if (!target) return;

  if (target.dataset.status) {
    state.statusFilter = target.dataset.status;
    renderClients();
    return;
  }

  if (target.dataset.openClient) { openClientCard(target.dataset.openClient); return; }

  if (target.dataset.openSession) {
    const session = state.sessions.find(s => s.id === target.dataset.openSession);
    if (session) openSessionForm(session);
    return;
  }

  if (target.dataset.togglePaid) {
    const session = state.sessions.find(s => s.id === target.dataset.togglePaid);
    if (session) { session.paid = !session.paid; save(); render(); }
    return;
  }

  if (target.dataset.delSession) {
    const session = state.sessions.find(s => s.id === target.dataset.delSession);
    if (session && confirm('Удалить эту сессию?')) {
      state.sessions = state.sessions.filter(s => s.id !== session.id);
      save();
      render();
    }
    return;
  }

  if (target.dataset.action === 'new-client') { openClientForm(null); return; }

  if (target.dataset.action === 'add-session') {
    const clientId = target.dataset.clientId;
    cardDialog.close();
    openSessionForm(null, clientId);
    return;
  }

  if (target.dataset.action === 'edit-client') {
    const client = clientById(target.dataset.clientId);
    cardDialog.close();
    if (client) openClientForm(client);
    return;
  }

  if (target.dataset.action === 'delete-client') {
    const client = clientById(target.dataset.clientId);
    if (!client) return;
    if (confirm(`Удалить клиента «${client.name}» вместе со всеми сессиями?`)) {
      state.clients = state.clients.filter(c => c.id !== client.id);
      state.sessions = state.sessions.filter(s => s.clientId !== client.id);
      save();
      cardDialog.close();
      render();
    }
    return;
  }

  if (target.hasAttribute('data-close-card')) { cardDialog.close(); return; }
  if (target.hasAttribute('data-close')) { target.closest('dialog').close(); }
});

/* закрытие по клику на тёмный фон */
$$('.dialog').forEach(dialog => {
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
});

$('#clientForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = $('#clientId').value;
  const data = {
    name: $('#clientName').value.trim(),
    phone: $('#clientPhone').value.trim(),
    email: $('#clientEmail').value.trim(),
    status: $('#clientStatus').value,
    price: Number($('#clientPrice').value) || 0,
    note: $('#clientNote').value.trim(),
  };
  if (!data.name) return;

  if (id) {
    const client = clientById(id);
    if (client) Object.assign(client, data);
  } else {
    state.clients.push({ id: uid(), createdAt: today(), ...data });
  }

  save();
  clientDialog.close();
  render();
});

$('#sessionForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = $('#sessionId').value;
  const clientId = $('#sessionClient').value;
  const client = clientById(clientId);

  const data = {
    clientId,
    date: $('#sessionDate').value || today(),
    time: $('#sessionTime').value,
    topic: $('#sessionTopic').value.trim(),
    note: $('#sessionNote').value.trim(),
    amount: Number($('#sessionAmount').value) || (client ? Number(client.price) || 0 : 0),
    paid: $('#sessionPaid').checked,
  };

  if (id) {
    const session = state.sessions.find(s => s.id === id);
    if (session) Object.assign(session, data);
  } else {
    state.sessions.push({ id: uid(), ...data });
  }

  save();
  sessionDialog.close();
  render();

  if (cardDialog.open) openClientCard(clientId);
});

/* ---------- часы ---------- */

const clockEl = $('#clock');
let clockDay = today();

function tickClock() {
  const now = new Date();
  clockEl.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');

  // если наступил новый день — обновляем дату, приветствие и списки
  if (today() !== clockDay) {
    clockDay = today();
    render();
  }
}

tickClock();
setInterval(tickClock, 1000);

/* ---------- данные: копия и история ---------- */
const historyDialog = $('#historyDialog');

$('#exportData').addEventListener('click', () => {
  $('#dataMenu').removeAttribute('open');
  exportData();
});

$('#importData').addEventListener('click', () => {
  $('#dataMenu').removeAttribute('open');
  $('#importFile').click();
});

$('#importFile').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (file) importData(file);
  e.target.value = '';
});

$('#openHistory').addEventListener('click', () => {
  $('#dataMenu').removeAttribute('open');
  renderHistory();
  historyDialog.showModal();
});

$('#exportCsv').addEventListener('click', () => {
  $('#dataMenu').removeAttribute('open');
  exportCsv();
});

$('#exportPrint').addEventListener('click', () => {
  $('#dataMenu').removeAttribute('open');
  exportPrint();
});

historyDialog.addEventListener('click', e => {
  const btn = e.target.closest('[data-restore]');
  if (btn) {
    const i = Number(btn.dataset.restore);
    const snap = readSnapshots()[i];
    if (!snap) return;
    if (!confirm(`Вернуть состояние от ${snapshotTime(snap.at)}?\n\nКлиентов — ${snap.clients}, сессий — ${snap.sessions}.\nТекущие данные сначала сохранятся в историю.`)) return;
    rememberSnapshot(true);
    restoreSnapshot(i);
    historyDialog.close();
    toast('Состояние восстановлено');
    return;
  }
  if (e.target.closest('[data-close-history]')) historyDialog.close();
});

/* закрыть меню по клику мимо */
document.addEventListener('click', e => {
  const menu = $('#dataMenu');
  if (menu && menu.hasAttribute('open') && !menu.contains(e.target)) menu.removeAttribute('open');
});

/* ---------- неделя: переключение ---------- */

$('#weekPrev').addEventListener('click', () => { weekOffset -= 1; renderWeek(); });
$('#weekNext').addEventListener('click', () => { weekOffset += 1; renderWeek(); });

/* ---------- таймер ---------- */

$('#timerBtn').addEventListener('click', () => {
  if (timerLeft <= 0) timerReset();
  else if (!timerRunning && !timerId) timerReset();
  timerPaint();
  $('#timerDialog').showModal();
});

$('#timerToggle').addEventListener('click', () => {
  if (timerRunning) timerStop();
  else if (timerLeft <= 0) { timerReset(); timerStart(); }
  else timerStart();
});

$('#timerReset').addEventListener('click', () => timerReset());

$$('[data-timer]').forEach(btn => btn.addEventListener('click', () => {
  const minutes = Number(btn.dataset.timer);
  timerReset(minutes);
  timerStart(minutes);
}));

/* ---------- режим «босс» ---------- */

$('#bossMode').addEventListener('click', () => {
  bossMode = !bossMode;
  applyBoss();
  toast(bossMode ? 'Имена и суммы скрыты' : 'Имена и суммы снова видны');
});

try { bossMode = localStorage.getItem('psy-crm-boss') === '1'; } catch (e) { bossMode = false; }

/* ---------- старт ---------- */

load();
rememberSnapshot(true);
setView('today');
render();
applyBoss();
