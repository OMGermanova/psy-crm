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
  } catch (e) {
    console.warn('Браузер не даёт сохранить данные:', e);
  }
}

function seed() {
  const base = new Date();
  const day = off => iso(new Date(base.getFullYear(), base.getMonth(), base.getDate() + off));

  state.clients = [
    { id: 'c1', name: 'Анна Петрова',   phone: '+7 921 145-22-08', email: 'anna.p@mail.ru',    status: 'active', price: 4000, note: 'Тревожность, отношения с матерью. Раз в неделю, вторник вечером.', createdAt: day(-120) },
    { id: 'c2', name: 'Дмитрий Соколов', phone: '+7 916 733-10-45', email: 'd.sokolov@mail.ru', status: 'active', price: 4500, note: 'Выгорание на работе. Раз в неделю, пятница.', createdAt: day(-64) },
    { id: 'c3', name: 'Марина Ильина',  phone: '+7 903 218-77-31', email: '',                  status: 'new',    price: 3500, note: 'Запрос про самооценку, первичная консультация.', createdAt: day(-6) },
    { id: 'c4', name: 'Игорь Величко',  phone: '+7 985 402-19-63', email: 'igor.v@yandex.ru',  status: 'paused', price: 4000, note: 'Командировка до конца месяца, вернётся в работу.', createdAt: day(-200) },
    { id: 'c5', name: 'Ольга Наумова',  phone: '+7 962 330-84-12', email: '',                  status: 'done',   price: 3800, note: 'Работа завершена после 14 сессий.', createdAt: day(-420) },
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

/* ---------- отрисовка ---------- */

function render() {
  renderToday();
  renderClients();
  renderSessions();
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
        const badge = s.paid
          ? '<span class="pill pill-paid">Оплачено</span>'
          : (s.date < t ? '<span class="pill pill-unpaid">Не оплачено</span>' : '<span></span>');
        return `
          <button class="session-row" data-open-session="${s.id}" type="button">
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

/* ---------- старт ---------- */

load();
setView('today');
render();
