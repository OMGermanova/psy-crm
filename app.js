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
  const hay = parts.filter(Boolean).join(' ').toLowerCase();
  // каждое слово запроса должно встретиться хотя бы где-то
  return q.split(/\s+/).every(word => hay.includes(word));
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
    { id: 'c1',  name: 'Анна Петрова',      phone: '+7 000 000-00-01', email: 'anna.petrova@example.com',   status: 'active', price: 4000, note: 'Тревожность, отношения с матерью. Раз в неделю, вторник утром.', createdAt: day(-120) },
    { id: 'c2',  name: 'Дмитрий Соколов',   phone: '+7 000 000-00-02', email: 'd.sokolov@example.com',      status: 'active', price: 4500, note: 'Выгорание на руководящей должности. Раз в неделю, вторник днём.', createdAt: day(-64) },
    { id: 'c3',  name: 'Марина Ильина',     phone: '+7 000 000-00-03', email: '',                           status: 'new',    price: 3500, note: 'Запрос про самооценку, первичная консультация.', createdAt: day(-6) },
    { id: 'c4',  name: 'Игорь Величко',     phone: '+7 000 000-00-04', email: 'i.velichko@example.com',     status: 'paused', price: 4000, note: 'Командировка до конца месяца, вернётся в работу.', createdAt: day(-200) },
    { id: 'c5',  name: 'Ольга Наумова',     phone: '+7 000 000-00-05', email: '',                           status: 'done',   price: 3800, note: 'Работа завершена после 14 сессий. Запрос про отношения с деньгами.', createdAt: day(-420) },
    { id: 'c6',  name: 'Тимур Асланов',     phone: '+7 000 000-00-06', email: 't.aslanov@example.com',      status: 'active', price: 4000, note: 'Подросток, 16 лет. Контакт — мать, Эльмира, +7 000 000-00-16. Запрос: отказ ходить в школу, конфликты дома.', createdAt: day(-45) },
    { id: 'c7',  name: 'Вера Крылова',      phone: '+7 000 000-00-07', email: 'v.krylova@example.com',      status: 'active', price: 4200, note: 'Горе: потеря мужа полтора года назад. Пришла по своей инициативе, говорит «застряла».', createdAt: day(-88) },
    { id: 'c8',  name: 'Павел Дёмин',       phone: '+7 000 000-00-08', email: 'p.demin@example.com',        status: 'active', price: 4500, note: 'Переезд в другой город два года назад. Запрос: «не понимаю, кто я здесь». Работал по специальности, сейчас нет.', createdAt: day(-30) },
    { id: 'c9',  name: 'Наталья Гордеева',  phone: '+7 000 000-00-09', email: 'n.gordeeva@example.com',     status: 'active', price: 4000, note: 'Медсестра в отделении реанимации. Выгорание, срывы на близких. График сложный — встречи раз в две недели.', createdAt: day(-150) },
    { id: 'c10', name: 'Ксения Литвинова',  phone: '+7 000 000-00-10', email: 'k.litvinova@example.com',    status: 'active', price: 4800, note: 'Пищевое поведение: эпизоды переедания на фоне стресса. Направлена гастроэнтерологом. Работаем с триггерами, не с весом.', createdAt: day(-70) },
    { id: 'c11', name: 'Роман Ефимов',      phone: '+7 000 000-00-11', email: '',                           status: 'active', price: 4000, note: 'Вернулся после перерыва в 8 месяцев. Изначально — панические атаки, сейчас реже. Восстанавливаем регулярность.', createdAt: day(-300) },
    { id: 'c12', name: 'Светлана Ковалёва', phone: '+7 000 000-00-12', email: 's.kovaleva@example.com',     status: 'active', price: 3800, note: 'Платит нерегулярно: «переведу после зарплаты», задерживает на 1–2 недели. Обсуждали, договорились на предоплату, пока не вышло.', createdAt: day(-95) },
    { id: 'c13', name: 'Артём Гусев',       phone: '+7 000 000-00-13', email: 'a.gusev@example.com',        status: 'paused', price: 4000, note: 'Пауза по деньгам: потерял работу, попросил приостановить на два месяца. Договорились созвониться в ноябре.', createdAt: day(-110) },
    { id: 'c14', name: 'Лидия Чернова',     phone: '+7 000 000-00-14', email: '',                           status: 'done',   price: 4000, note: 'Завершена успешно: 22 сессии за год. Запрос был про созависимость, вышла с ощущением «я справляюсь». Ушла с благодарностью.', createdAt: day(-500) },
    { id: 'c15', name: 'Егор Малышев',      phone: '+7 000 000-00-15', email: 'e.malyshev@example.com',     status: 'new',    price: 4000, note: 'Написал в мессенджер, сомневается: «не уверен, что мне это нужно». Первая встреча назначена, но дважды переносил.', createdAt: day(-14) },
  ];

  state.sessions = [
    // сегодня
    { id: 's1',  clientId: 'c1',  date: day(0),   time: '10:00', topic: 'Границы с матерью', note: 'Разбирали эпизод на выходных: мать без предупреждения приехала. Анна промолчала, потом весь вечер злилась на себя. Вышли на формулировку «мне нужно знать заранее».', plan: 'Проверить, сказала ли она матери про предупреждение. Если нет — разобрать, что остановило.', amount: 4000, paid: false },
    { id: 's2',  clientId: 'c2',  date: day(0),   time: '15:30', topic: 'Восстановление ресурса', note: 'Первая неделя после отпуска. Говорит, что отдохнул, но к среде вернулось то же ощущение. Обсудили разницу между «отдохнуть» и «разгрузиться».', plan: 'Посмотреть, какие задачи он берёт на себя добровольно, хотя мог бы не брать.', amount: 4500, paid: false },

    // ближайшие
    { id: 's3',  clientId: 'c7',  date: day(1),   time: '11:00', topic: 'Годовщина', note: '', plan: '', amount: 4200, paid: false },
    { id: 's4',  clientId: 'c3',  date: day(2),   time: '12:00', topic: 'Знакомство, сбор анамнеза', note: '', plan: '', amount: 3500, paid: false },
    { id: 's5',  clientId: 'c6',  date: day(2),   time: '17:00', topic: 'Школа: что происходит на самом деле', note: '', plan: '', amount: 4000, paid: false },
    { id: 's6',  clientId: 'c10', date: day(3),   time: '18:30', topic: 'Триггеры переедания', note: '', plan: '', amount: 4800, paid: false },
    { id: 's7',  clientId: 'c1',  date: day(7),   time: '10:00', topic: 'Продолжение работы', note: '', plan: '', amount: 4000, paid: false },
    { id: 's8',  clientId: 'c9',  date: day(8),   time: '19:00', topic: 'Смены и восстановление', note: '', plan: '', amount: 4000, paid: false },

    // прошедшие
    { id: 's9',  clientId: 'c1',  date: day(-7),  time: '10:00', topic: 'Телесные реакции на стресс', note: 'Замечает сжатие в плечах перед звонком матери. Работали с дыханием, но говорит «не помогает, потому что злюсь».', plan: 'Вернуться к злости: что она хочет сделать.', amount: 4000, paid: true },
    { id: 's10', clientId: 'c2',  date: day(-7),  time: '15:30', topic: 'Границы в коллективе', note: 'Согласился вести ещё один проект, хотя не хотел. Разбирали, что было страшно отказать. Сформулировал: «боюсь, что сочтут нелояльным».', plan: 'Спросить, пробовал ли отказать хоть раз за неделю.', amount: 4500, paid: true },
    { id: 's11', clientId: 'c7',  date: day(-9),  time: '11:00', topic: 'Как говорить о нём в настоящем времени', note: 'Впервые заговорила о муже без слёз, но потом извинялась за это. Отметили: «мне стыдно, что я живу дальше».', plan: 'Не торопить. Спросить, что значит «жить дальше» для неё самой.', amount: 4200, paid: true },
    { id: 's12', clientId: 'c8',  date: day(-6),  time: '14:00', topic: 'Работа как потерянная опора', note: 'Впервые назвал вслух: «я никто без должности». Много про отца, который спрашивает только про работу.', plan: 'Развести «я» и «моя профессия». Начать с того, что он делал хорошо до переезда.', amount: 4500, paid: false },
    { id: 's13', clientId: 'c10', date: day(-5),  time: '18:30', topic: 'Что происходит перед эпизодом', note: 'Проследили цепочку: вечер, пустая квартира, телефон, ощущение «день прошёл зря». Согласилась, что дело не в еде, а в этом ощущении.', plan: 'Попробовать замечать момент «день прошёл зря» и записывать, что было до него.', amount: 4800, paid: true },
    { id: 's14', clientId: 'c9',  date: day(-8),  time: '19:00', topic: 'После смены с потерей', note: 'Рассказала про пациента, которого не смогли спасти. Дома накричала на сына из-за мелочи, потом плакала. Сказала: «я так больше не могу, но уйти некуда».', plan: 'Обсудить, есть ли в отделении хоть кто-то, с кем можно говорить о таких случаях.', amount: 4000, paid: true },
    { id: 's15', clientId: 'c6',  date: day(-5),  time: '17:00', topic: 'Разговор с матерью', note: 'Пришёл мрачный, говорил мало. На прямой вопрос ответил: «дома опять про оценки». Сам предложил: «может, поговорите с ней?»', plan: 'Отдельная встреча с матерью — обсудить, что происходит с требованиями. Тимуру сказать, что разговор будет.', amount: 4000, paid: true },
    { id: 's16', clientId: 'c11', date: day(-11), time: '16:00', topic: 'Возвращение после перерыва', note: 'Паники стали реже, но появился страх, что «вернётся». Проверяли, что изменилось за 8 месяцев: научился замечать начало и выходить из ситуации.', plan: 'Сместить фокус с «как не допустить» на «что я делаю, когда начинается».', amount: 4000, paid: true },
    { id: 's17', clientId: 'c12', date: day(-13), time: '12:00', topic: 'Деньги и стыд', note: 'Опять пришла без оплаты за прошлый раз. Сама заговорила первой: «мне очень неудобно». Разбирали, что мешает сказать прямо, что сейчас трудно.', plan: 'Предложить конкретный вариант: оплата в день встречи или пауза до стабилизации. Без осуждения.', amount: 3800, paid: false },
    { id: 's18', clientId: 'c14', date: day(-40), time: '10:00', topic: 'Последняя встреча', note: 'Подводили итоги за год. Сказала, что впервые не боится остаться одна. Договорились, что может вернуться, если понадобится, — без объяснений и обязательств.', plan: '', amount: 4000, paid: true },
    { id: 's19', clientId: 'c15', date: day(-12), time: '13:00', topic: 'Первая встреча не состоялась', note: 'Не пришёл, написал через два часа: «простите, не смог». Не переносили — предложил сам «может, позже».', plan: 'Написать один раз, коротко, без давления. Если не ответит — оставить.', amount: 0, paid: false },
    { id: 's20', clientId: 'c13', date: day(-60), time: '18:00', topic: 'Пауза в работе', note: 'Сообщил о потере работы. Предложил паузу сам, я согласилась. Договорились, что напишет, когда сможет вернуться.', plan: '', amount: 4000, paid: false },
    { id: 's21', clientId: 'c4',  date: day(-25), time: '19:00', topic: 'Командировка', note: 'Уезжает на месяц, встречи возобновим по возвращении. Состояние стабильное, запрос был про тревогу перед поездками — с этим поработали.', plan: '', amount: 4000, paid: true },
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

  const total = state.sessions.filter(s => s.date >= days[0] && s.date <= end);
  const busiest = days
    .map(day => ({ day, count: total.filter(s => s.date === day).length }))
    .sort((a, b) => b.count - a.count)[0];

  /* --- полный календарь --- */
  const calTitle = $('#calTitle');
  if (calTitle) {
    const d1 = start;
    const d2 = parseDate(end);
    const sameMonth = d1.getMonth() === d2.getMonth();
    const label = sameMonth
      ? `${d1.getDate()}–${d2.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} ${d2.getFullYear()}`
      : `${d1.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} — `
        + `${d2.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} ${d2.getFullYear()}`;
    calTitle.textContent = label;

    const sub = $('#calSub');
    if (sub) {
      const parts = [`${total.length} ${plural(total.length, 'встреча', 'встречи', 'встреч')}`];
      const booked = new Set(total.map(s => s.date)).size;
      parts.push(`${booked} ${plural(booked, 'день', 'дня', 'дней')} с встречами`);
      if (busiest && busiest.count) {
        const bd = parseDate(busiest.day);
        parts.push('загруженнее всего ' + bd.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric' }) + ` (${busiest.count})`);
      }
      sub.textContent = parts.join(' · ');
    }
  }

  const listEl = $('#weekList');
  if (listEl) {
    listEl.innerHTML = days.map(day => {
      const list = state.sessions
        .filter(s => s.date === day)
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      const isToday = day === t;
      const isPast = day < t;
      const isBusiest = busiest && busiest.day === day && busiest.count > 0;
      const isPicked = calDay === day;

      return `
        <div class="week-day${isToday ? ' is-today' : ''}${isPast ? ' is-past' : ''}${isBusiest ? ' is-busiest' : ''}${isPicked ? ' is-picked' : ''}">
          <div class="week-day-top">
            <button class="week-day-head" data-pick-day="${day}" type="button" title="Показать день по часам">
              <span class="week-dow">${parseDate(day).toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
              <span class="week-num">${parseDate(day).getDate()}</span>
              ${isBusiest ? '<span class="week-peak">пик</span>' : ''}
              <span class="week-count">${list.length || ''}</span>
            </button>
            <button class="week-add" data-add-day="${day}" type="button" title="Добавить встречу на этот день"${isPast ? ' hidden' : ''}>+</button>
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
  }

  renderCalDay();

  /* --- краткий вид на главной --- */
  const brief = $('#weekBrief');
  if (brief) {
    const busyDays = days.filter(day => state.sessions.some(s => s.date === day));
    brief.innerHTML = `
      <div class="brief-row">
        ${days.map(day => {
          const count = state.sessions.filter(s => s.date === day).length;
          const isToday = day === t;
          const isPast = day < t;
          return `
            <button class="brief-day${isToday ? ' is-today' : ''}${isPast ? ' is-past' : ''}${count ? ' has-items' : ''}"
              data-open-day="${day}" type="button" title="${count ? count + ' встреч' : 'свободно'}">
              <span class="brief-dow">${parseDate(day).toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
              <span class="brief-num">${parseDate(day).getDate()}</span>
              <span class="brief-dot${count ? ' is-on' : ''}">${count || ''}</span>
            </button>`;
        }).join('')}
      </div>
      <p class="brief-sum">
        ${total.length
          ? `${total.length} ${plural(total.length, 'встреча', 'встречи', 'встреч')} · ${busyDays.length} ${plural(busyDays.length, 'день', 'дня', 'дней')} занято`
          : 'На этой неделе пока пусто'}
      </p>
    `;
  }
}

/* ---------- выбранный день: разбивка по времени ---------- */

let calDay = null; // выбранная дата (YYYY-MM-DD) или null

function renderCalDay() {
  const panel = $('#calDayPanel');
  if (!panel) return;

  if (!calDay) {
    panel.hidden = true;
    const cols = panel.closest('.cal-cols');
    if (cols) cols.classList.remove('has-day');
    return;
  }
  panel.hidden = false;
  const cols = panel.closest('.cal-cols');
  if (cols) cols.classList.add('has-day');

  const d = parseDate(calDay);
  const isPastDay = calDay < today();

  $('#calDayTitle').textContent = d.toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const list = state.sessions
    .filter(s => s.date === calDay)
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));

  const withTime = list.filter(s => s.time);
  const noTime = list.filter(s => !s.time);

  // рабочие часы: 9:00–21:00, но расширяем, если встречи выходят за рамки
  const HOUR_FROM = 9;
  const HOUR_TO = 21;
  const usedHours = withTime.map(s => Number(String(s.time).slice(0, 2))).filter(h => !isNaN(h));
  const from = Math.min(HOUR_FROM, ...(usedHours.length ? usedHours : [HOUR_FROM]));
  const to = Math.max(HOUR_TO, ...(usedHours.length ? usedHours : [HOUR_TO]));

  let rows = '';

  for (let h = from; h <= to; h++) {
    const hh = pad(h) + ':00';
    const inHour = withTime.filter(s => Number(String(s.time).slice(0, 2)) === h);

    if (!inHour.length) {
      // свободный час: в прошлом — просто пометка, в будущем — можно записать
      rows += isPastDay
        ? `<div class="cal-slot is-free is-past">
             <span class="cal-hour">${hh}</span>
             <span class="cal-free-text">свободно</span>
           </div>`
        : `<div class="cal-slot is-free">
             <span class="cal-hour">${hh}</span>
             <button class="cal-free-add" data-add-day="${calDay}" data-add-time="${hh}" type="button">свободно — добавить</button>
           </div>`;
      continue;
    }

    inHour.forEach(s => {
      const c = clientById(s.clientId) || {};
      rows += `
        <div class="cal-slot is-busy">
          <span class="cal-hour">${esc(s.time)}</span>
          <button class="cal-event" data-open-session="${s.id}" type="button">
            <strong>${esc(c.name || 'Клиент удалён')}</strong>
            <span>${esc(s.topic || 'без темы')}</span>
          </button>
        </div>`;
    });
  }

  if (noTime.length) {
    rows += `
      <div class="cal-slot is-untimed">
        <span class="cal-hour">—</span>
        <div class="cal-untimed">
          ${noTime.map(s => {
            const c = clientById(s.clientId) || {};
            return `<button class="cal-event" data-open-session="${s.id}" type="button">
              <strong>${esc(c.name || 'Клиент удалён')}</strong>
              <span>время не задано</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  if (isPastDay) {
    rows += `<p class="cal-past-note">День уже прошёл — записать встречу нельзя.</p>`;
  }

  $('#calSlots').innerHTML = rows;
}

/* ---------- «мостик»: о чём договорились в прошлый раз ---------- */

function bridgeFor(clientId) {
  const t = today();
  const all = state.sessions
    .filter(s => s.clientId === clientId && (s.note || s.topic || s.plan))
    .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

  // сначала ищем именно прошедшие встречи, и только потом сегодняшние
  const last = all.find(s => s.date < t) || all.find(s => s.date === t);
  if (!last) return '';

  const text = (last.note || last.topic || '').trim();
  const plan = (last.plan || '').trim();
  if (!text && !plan) return '';

  const when = last.date === t ? 'сегодня' : humanDateShort(last.date);
  return `<div class="bridge">
    <span class="bridge-label">Прошлый раз · ${esc(when)}</span>
    ${text ? `<span class="bridge-text">${esc(text)}</span>` : ''}
    ${plan ? `<span class="bridge-plan"><b>План:</b> ${esc(plan)}</span>` : ''}
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
  face.classList.toggle('is-running', timerRunning);
  face.classList.toggle('is-warning', timerLeft <= 600 && timerLeft > 0);
  face.classList.toggle('is-over', timerLeft <= 0);

  const btn = $('#timerBtn');
  if (btn) btn.classList.toggle('is-running', timerRunning);

  if (typeof livePaint === 'function') livePaint();
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
  timerPaint();
  if (typeof livePaint === 'function') livePaint();
}

function timerReset(minutes = TIMER_MINUTES) {
  timerStop();
  timerLeft = minutes * 60;
  $('#timerToggle').textContent = 'Старт';
  $('#timerHint').textContent = 'Готов, когда будешь готова.';
  timerPaint();
}

/* ---------- колода: вопросы для психолога ---------- */

const DECK_KEY = 'psy-crm-deck';
const DECK_CATS = [
  ['anxiety', 'Тревога'],
  ['relations', 'Отношения'],
  ['borders', 'Границы'],
  ['critic', 'Внутренний критик'],
  ['work', 'Работа и выгорание'],
  ['stuck', 'Застряла'],
];

const DECK_BASE = {
  anxiety: [
    'Что случится, если худшее произойдёт? А что тогда?',
    'Где в теле это живёт прямо сейчас?',
    'О чём тревога пытается тебя предупредить?',
    'Что уже помогало — и что общего у этих случаев?',
  ],
  relations: [
    'Что ты не говоришь, но хотела бы сказать?',
    'Кем ты становишься рядом с этим человеком?',
    'Что ты прощаешь, а что уже нет?',
    'Если бы он изменился завтра — что бы ты почувствовала?',
  ],
  borders: [
    'Что происходит с тобой в момент, когда ты соглашаешься?',
    'Чей голос звучит, когда ты говоришь «надо»?',
    'Что страшнее: отказать сейчас или злиться потом?',
  ],
  critic: [
    'Чьим голосом это сказано?',
    'Что бы ты сказала подруге в этой же ситуации?',
    'За что ты себя не хвалишь — и почему это «не считается»?',
  ],
  work: [
    'Когда ты последний раз чувствовала, что сделала достаточно?',
    'Что ты делаешь, потому что надо, а не потому что хочешь?',
    'Что случится, если ты остановишься на неделю?',
  ],
  stuck: [
    'О чём я сейчас не спрашиваю?',
    'Что мы обходим?',
    'Что изменилось за эту встречу?',
    'Если бы это была последняя встреча — что бы ты сказала?',
  ],
};

function deckLoad() {
  try {
    const raw = localStorage.getItem(DECK_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* нет хранилища */ }
  return null;
}

function deckSave(data) {
  try { localStorage.setItem(DECK_KEY, JSON.stringify(data)); } catch (e) { /* нет хранилища */ }
}

let deckData = deckLoad() || JSON.parse(JSON.stringify(DECK_BASE));
let deckCat = 'anxiety';

function deckCatLabel(key) {
  const found = DECK_CATS.find(([k]) => k === key);
  return found ? found[1] : key;
}

function deckRenderCats() {
  const box = $('#deckCats');
  if (!box) return;

  const keys = Object.keys(deckData);
  if (!keys.includes(deckCat)) deckCat = keys[0] || '';

  box.innerHTML = keys.map(key =>
    `<button class="chip${deckCat === key ? ' is-active' : ''}" data-deck-cat="${esc(key)}" type="button">${esc(deckCatLabel(key))}</button>`
  ).join('');
}

function deckRenderList() {
  const box = $('#deckList');
  if (!box) return;

  const list = deckData[deckCat] || [];
  box.innerHTML = list.length
    ? list.map((q, i) => `
        <div class="deck-item">
          <span class="deck-text">${esc(q)}</span>
          <button class="deck-del" data-deck-del="${i}" type="button" title="Удалить">×</button>
        </div>`).join('')
    : '<div class="empty" style="padding:12px">В этой категории пока пусто</div>';
}

function deckRenderAll() {
  deckRenderCats();
  deckRenderList();
}

function deckAddQuestion(text) {
  const q = String(text || '').trim();
  if (!q || !deckCat) return false;
  deckData[deckCat] = deckData[deckCat] || [];
  deckData[deckCat].push(q);
  deckSave(deckData);
  deckRenderList();
  return true;
}

function deckAddCategory(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  const key = 'c' + Date.now().toString(36);
  deckData[key] = [];
  DECK_CATS.push([key, n]);
  deckSave(deckData);
  deckCat = key;
  deckRenderAll();
  return true;
}

function deckDelete(index) {
  const list = deckData[deckCat] || [];
  if (index < 0 || index >= list.length) return;
  const text = list[index];
  if (!confirm('Удалить вопрос безвозвратно?\n\n«' + text + '»')) return;
  list.splice(index, 1);
  deckSave(deckData);
  deckRenderList();
}

/* ---------- подсказки из данных ---------- */

function hintsFor(clientId) {
  const out = [];
  const c = clientById(clientId);
  if (!c) return out;

  const t = today();
  const sessions = sessionsOf(clientId).filter(s => s.date <= t);
  const last = sessions[sessions.length - 1];
  const next = sessionsOf(clientId).find(s => s.date > t);
  const debt = state.sessions.filter(s => s.clientId === clientId && !s.paid && s.date <= t);

  if (last) {
    const gap = Math.round((parseDate(t) - parseDate(last.date)) / 86400000);
    // «пора написать» — только для тех, кто в работе; в паузе причина обычно известна
    if (gap >= 21 && !next && c.status === 'active') {
      out.push({ tone: 'warm', text: `Не было ${gap} ${plural(gap, 'день', 'дня', 'дней')}, следующей записи нет — возможно, пора написать.` });
    }
    if ((last.plan || '').trim() && last.date < t) {
      out.push({ tone: 'calm', text: 'С прошлой встречи остался план — проверьте, закрыт ли он.' });
    }
  }

  if (debt.length >= 2) {
    const sum = debt.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
    out.push({ tone: 'warm', text: `Не оплачено ${debt.length} ${plural(debt.length, 'сессия', 'сессии', 'сессий')} на ${money(sum)}.` });
  } else if (debt.length === 1 && debt[0].date < t) {
    out.push({ tone: 'calm', text: `Не оплачена встреча от ${humanDateShort(debt[0].date)}.` });
  }

  // подсказки про этап — только для тех, кто ещё в работе
  if (c.status === 'new' || (c.status === 'active' && sessions.length === 0)) {
    out.push({ tone: 'calm', text: 'Первая встреча: рамки, контракт, чего человек ждёт.' });
  } else if (c.status === 'active' && sessions.length === 3) {
    out.push({ tone: 'calm', text: 'Идёт четвёртая встреча — обычно здесь решается, продолжит ли человек.' });
  }

  if (c.status === 'paused' && last) {
    const gap = Math.round((parseDate(t) - parseDate(last.date)) / 86400000);
    if (gap >= 30) out.push({ tone: 'calm', text: `В паузе ${gap} ${plural(gap, 'день', 'дня', 'дней')} — можно деликатно напомнить о себе.` });
  }

  return out;
}

/* ---------- режим сессии ---------- */

let liveSessionId = null;
let liveDirty = false;
let liveSaveTimer = null;

function liveEl() { return $('#live'); }

function liveOpen(sessionId) {
  const s = state.sessions.find(x => x.id === sessionId);
  if (!s) return;
  const c = clientById(s.clientId);

  liveSessionId = sessionId;
  liveDirty = false;

  $('#liveName').textContent = (c && c.name) || 'Клиент удалён';
  $('#liveNote').value = s.note || '';
  $('#livePlan').value = s.plan || '';
  $('#liveSaved').textContent = 'Сохранено';

  const bridge = bridgeFor(s.clientId);
  $('#liveBridge').innerHTML = bridge || '<span class="live-empty">Прошлых записей нет — это начало.</span>';

  const hints = hintsFor(s.clientId);
  const hintBox = $('#liveHints');
  if (hintBox) {
    hintBox.innerHTML = hints.length
      ? hints.map(h => `<div class="hint hint-${h.tone}">${esc(h.text)}</div>`).join('')
      : '';
    hintBox.hidden = !hints.length;
  }

  deckRenderAll();
  $('#liveDeckBox').hidden = true;

  liveEl().hidden = false;
  document.body.classList.add('is-live');

  timerReset(TIMER_MINUTES);
  timerStop();
  $('#liveTimerToggle').textContent = 'Старт';
  livePaint();

  // запоминаем открытую сессию, чтобы вернуться, если окно случайно закрыли
  try { localStorage.setItem('psy-crm-live', sessionId); } catch (e) { /* нет хранилища */ }

  setTimeout(() => $('#liveNote').focus(), 60);
}

function liveSave() {
  if (!liveSessionId) return;
  const s = state.sessions.find(x => x.id === liveSessionId);
  if (!s) return;

  s.note = $('#liveNote').value;
  s.plan = $('#livePlan').value;

  save();
  liveDirty = false;
  $('#liveSaved').textContent = 'Сохранено';
}

function liveQueueSave() {
  liveDirty = true;
  $('#liveSaved').textContent = 'Сохраняю…';
  clearTimeout(liveSaveTimer);
  liveSaveTimer = setTimeout(liveSave, 700);
}

function liveClose(silent) {
  if (liveSessionId && liveDirty) liveSave();
  timerStop();

  liveEl().hidden = true;
  document.body.classList.remove('is-live');
  liveSessionId = null;

  // сессия не завершена — помним её, чтобы можно было вернуться
  try {
    if (silent) localStorage.removeItem('psy-crm-live');
  } catch (e) { /* нет хранилища */ }

  if (!silent) render();
}

function liveFinish() {
  try { localStorage.removeItem('psy-crm-live'); } catch (e) { /* нет хранилища */ }
  liveEl().hidden = true;
  document.body.classList.remove('is-live');
  liveSessionId = null;
  timerStop();
  render();
}

function liveResumeId() {
  try {
    const id = localStorage.getItem('psy-crm-live');
    if (!id) return null;
    const s = state.sessions.find(x => x.id === id);
    return s ? id : null;
  } catch (e) { return null; }
}

function livePaint() {
  const m = Math.floor(timerLeft / 60);
  const s = timerLeft % 60;
  const clock = $('#liveClock');
  if (!clock) return;
  clock.textContent = `${pad(m)}:${pad(s)}`;
  clock.classList.toggle('is-running', timerRunning);
  clock.classList.toggle('is-warning', timerLeft <= 600 && timerLeft > 0);
  clock.classList.toggle('is-over', timerLeft <= 0);
}

/* ---------- старт сессии для любого клиента ---------- */

function sessionForNow(clientId) {
  const t = today();
  // берём сегодняшнюю незавершённую встречу, иначе создаём новую
  const existing = state.sessions.find(s => s.clientId === clientId && s.date === t);
  if (existing) return existing;

  const c = clientById(clientId);
  const session = {
    id: uid(),
    clientId,
    date: t,
    time: `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`,
    topic: '',
    note: '',
    plan: '',
    amount: c ? (Number(c.price) || 0) : 0,
    paid: false,
  };
  state.sessions.push(session);
  save();
  return session;
}

function startSessionWith(clientId) {
  const session = sessionForNow(clientId);
  render();
  liveOpen(session.id);
}

function openStartDialog() {
  const dlg = $('#startDialog');
  if (!dlg) return;

  if (!state.clients.length) {
    openClientForm(null);
    return;
  }

  $('#startSearch').value = '';
  renderStartList('');
  dlg.showModal();
  setTimeout(() => $('#startSearch').focus(), 60);
}

function renderStartList(query) {
  const box = $('#startList');
  if (!box) return;

  const q = String(query || '').trim().toLowerCase();
  const list = state.clients
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  box.innerHTML = list.length
    ? list.map(c => {
        const todaySession = state.sessions.find(s => s.clientId === c.id && s.date === today());
        const st = STATUS[c.status] || { label: '—', className: 'st-done' };
        return `
          <button class="start-item" data-start-client="${c.id}" type="button">
            <span class="avatar">${esc(initials(c.name))}</span>
            <span class="start-body">
              <span class="start-name">${esc(c.name)}</span>
              <span class="start-meta">${todaySession ? 'встреча сегодня' : 'сегодня встречи нет'}</span>
            </span>
            <span class="pill ${st.className}">${esc(st.label)}</span>
          </button>`;
      }).join('')
    : '<div class="empty" style="padding:14px">Никого не нашлось</div>';
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
  if (s.missed) return 'missed';
  if (s.done) return 'done';
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
  if (s.missed) return '<span class="pill pill-missed">Не состоялась</span>';
  if (s.paid) return '<span class="pill pill-paid">Оплачено</span>';

  const st = sessionState(s);
  if (st === 'now') return '<span class="pill pill-now">Сейчас идёт</span>';
  if (st === 'past') return '<span class="pill pill-unpaid">Не оплачено</span>';
  if (st === 'soon') return '<span class="pill pill-soon">Скоро</span>';
  if (st === 'done') return '<span class="pill pill-paid">Проведена</span>';
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
  const todaysLeft = todays.filter(s => sessionState(s) !== 'past');
  const active = state.clients.filter(c => c.status === 'active');
  const fresh = state.clients.filter(c => c.status === 'new');
  const paused = state.clients.filter(c => c.status === 'paused');
  const income = state.sessions.filter(s => s.paid && s.date.slice(0, 7) === month)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const debt = state.sessions.filter(s => !s.paid && s.date <= t)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  // ближайшая — только та, что ещё не закончилась и не отменена
  const next = [...state.sessions]
    .filter(s => ['past', 'missed', 'done'].indexOf(sessionState(s)) === -1)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];

  const nextToday = todaysLeft[0];
  const todayHint = !todays.length
    ? 'Свободный день'
    : nextToday
      ? `дальше: ${nextToday.time || '—'} · ${(clientById(nextToday.clientId) || {}).name || ''}`.trim()
      : 'все встречи прошли';

  const monthLabel = now.toLocaleDateString('ru-RU', { month: 'long' });
  const nextHint = next
    ? `${next.time || 'без времени'} · ${(clientById(next.clientId) || {}).name || 'клиент не найден'}`
    : 'Пока ничего не запланировано';

  const clientHint = [
    fresh.length ? `новых: ${fresh.length}` : '',
    paused.length ? `на паузе: ${paused.length}` : '',
  ].filter(Boolean).join(' · ') || `всего в базе: ${state.clients.length}`;

  $('#stats').innerHTML = `
    <button class="stat" data-stat="today" type="button">
      <span class="stat-label">Сессий сегодня</span>
      <strong class="stat-value">${todays.length}</strong>
      <span class="stat-hint">${esc(todayHint)}</span>
    </button>
    <button class="stat" data-stat="clients" type="button">
      <span class="stat-label">Клиентов в работе</span>
      <strong class="stat-value">${active.length}</strong>
      <span class="stat-hint">${esc(clientHint)}</span>
    </button>
    <button class="stat${debt ? ' is-warm' : ''}" data-stat="money" type="button">
      <span class="stat-label">Оплачено за ${monthLabel}</span>
      <strong class="stat-value">${money(income)}</strong>
      <span class="stat-hint">${debt ? `не оплачено: ${money(debt)}` : 'долгов нет'}</span>
    </button>
    <button class="stat" data-stat="next" type="button" ${next ? `data-session="${next.id}"` : 'disabled'}>
      <span class="stat-label">Ближайшая встреча</span>
      <strong class="stat-value">${next ? esc(relDay(next.date)) : '—'}</strong>
      <span class="stat-hint">${esc(nextHint)}</span>
    </button>
  `;

  const q = state.query.trim();
  // при поиске смотрим по всем встречам, включая прошедшие
  const pool = state.sessions.filter(s => ['past', 'missed', 'done'].indexOf(sessionState(s)) === -1);

  const upcoming = [...pool]
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
    .slice(0, 6);

  $('#upcoming').innerHTML = upcoming.length
    ? upcoming.map(s => {
        const c = clientById(s.clientId) || {};
        const badge = sessionBadge(s);
        const nowClass = sessionState(s) === 'now' ? ' is-now' : '';
        return `
          <div class="session-row${nowClass}">
            <button class="session-hit" data-open-session="${s.id}" type="button">
              <span class="session-date"><strong>${esc(relDay(s.date))}</strong><span>${s.time ? esc(s.time) : 'время не задано'}</span></span>
              <span class="session-main">
                <strong>${esc(c.name || 'Клиент удалён')}</strong>
                <span>${esc(s.topic || 'без темы')}</span>
              </span>
              ${badge}
            </button>
            <button class="session-start" data-start-session="${s.id}" type="button" title="Начать сессию">Начать</button>
          </div>`;
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
  let list = [...state.sessions].sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  // поиск работает только по клиентам: если он активен — показываем только их встречи
  const q = state.query.trim();
  if (q) {
    const found = state.clients.filter(c => matchesQuery(c.name, c.phone, c.email, c.note)).map(c => c.id);
    list = list.filter(s => found.indexOf(s.clientId) >= 0);
  }

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
        <button class="s-hit" data-open-session="${s.id}" type="button" title="Открыть сессию">
          <span class="s-date"><strong>${humanDateShort(s.date)}</strong><span>${weekday(s.date)}${s.time ? ', ' + esc(s.time) : ''}</span></span>
          <span class="s-client">${esc(c.name || 'клиент удалён')}</span>
          <span class="s-topic">${esc(s.topic || '—')}</span>
          <span class="s-amount">${s.amount ? money(s.amount) : '—'}</span>
        </button>
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

function openSessionForm(session, presetClientId, presetDate, presetTime) {
  if (!state.clients.length) { openClientForm(null); return; }

  const selected = session ? session.clientId : (presetClientId || state.clients[0].id);
  $('#sessionFormTitle').textContent = session ? 'Сессия' : 'Новая сессия';
  $('#sessionId').value = session ? session.id : '';
  $('#sessionClient').innerHTML = state.clients.map(c =>
    `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  $('#sessionDate').value = session ? session.date : (presetDate || today());
  $('#sessionTime').value = session ? session.time || '' : (presetTime || '');
  $('#sessionTopic').value = session ? session.topic || '' : '';
  $('#sessionNote').value = session ? session.note || '' : '';
  $('#sessionPlan').value = session ? session.plan || '' : '';
  $('#sessionAmount').value = session ? (session.amount ?? '') : ((clientById(selected) || {}).price || '');
  $('#sessionPaid').checked = session ? !!session.paid : false;

  renderSessionClientInfo(selected);
  sessionDialog.showModal();
}

/* краткая карточка клиента прямо в форме сессии */
function renderSessionClientInfo(clientId) {
  const box = $('#sessionClientInfo');
  if (!box) return;

  const c = clientById(clientId);
  if (!c) { box.hidden = true; return; }
  box.hidden = false;

  const sessions = sessionsOf(clientId);
  const past = sessions.filter(s => s.date <= today());
  const debt = sessions.filter(s => !s.paid && s.date <= today())
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const last = [...sessions].filter(s => s.date < today()).pop();
  const st = STATUS[c.status] || { label: '—', className: 'st-done' };
  const hints = hintsFor(clientId);

  const facts = [
    c.phone ? esc(c.phone) : '',
    c.price ? money(c.price) : '',
    `${past.length} ${plural(past.length, 'сессия', 'сессии', 'сессий')}`,
  ].filter(Boolean).join(' · ');

  box.innerHTML = `
    <div class="sci-top">
      <span class="avatar avatar-sm">${esc(initials(c.name))}</span>
      <div class="sci-main">
        <strong>${esc(c.name)}</strong>
        <span class="pill ${st.className}">${esc(st.label)}</span>
      </div>
      <span class="sci-facts">${facts}</span>
    </div>
    ${last ? `<div class="sci-line">Прошлая встреча: ${esc(humanDateShort(last.date))}${last.topic ? ' — ' + esc(last.topic) : ''}</div>` : ''}
    ${(last && (last.plan || '').trim()) ? `<div class="sci-line sci-plan">План с прошлого раза: ${esc(last.plan)}</div>` : ''}
    ${debt ? `<div class="sci-line sci-debt">Ждёт оплаты: ${money(debt)}</div>` : ''}
    ${hints.length ? `<div class="sci-line sci-hint">${esc(hints[0].text)}</div>` : ''}
    ${c.note ? `<div class="sci-line sci-note">${esc(c.note)}</div>` : ''}
  `;
}

function openClientCard(id) {
  const c = clientById(id);
  if (!c) return;

  const sessions = sessionsOf(id);
  const past = sessions.filter(s => s.date <= today());
  const paidSum = sessions.filter(s => s.paid).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const debt = sessions.filter(s => !s.paid && s.date <= today()).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const next = sessions.find(s => sessionState(s) !== 'past');
  const st = STATUS[c.status] || { label: '—', className: 'st-done' };
  const hints = hintsFor(c.id);
  const todaySession = sessions.find(s => s.date === today());

  $('#cardBody').innerHTML = `
    ${bridgeFor(c.id)}
    ${hints.length ? `<div class="hints">${hints.map(h => `<div class="hint hint-${h.tone}">${esc(h.text)}</div>`).join('')}</div>` : ''}
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
      <button class="btn btn-primary" data-action="start-live" data-client-id="${c.id}" type="button">Начать сессию</button>
      <button class="btn btn-soft" data-action="add-session" data-client-id="${c.id}" type="button">+ Сессия</button>
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

$('#sessionClient').addEventListener('change', e => {
  renderSessionClientInfo(e.target.value);
  const c = clientById(e.target.value);
  if (c && !$('#sessionId').value) $('#sessionAmount').value = Number(c.price) || '';
});

$('#search').addEventListener('input', e => {
  state.query = e.target.value;
  // поиск по клиентам — сразу переключаемся на раздел «Клиенты», иначе результат не виден
  if (state.query.trim() && state.view !== 'clients') setView('clients');
  render();
});

$$('[data-reset-demo]').forEach(btn => btn.addEventListener('click', () => {
  if (!confirm('Вернуть демонстрационные данные? Всё, что ты добавила, будет удалено.')) return;
  seed();
  save();
  render();
}));

document.addEventListener('click', e => {
  const target = e.target.closest('[data-status],[data-open-client],[data-open-session],[data-start-session],[data-toggle-paid],[data-del-session],[data-action],[data-close],[data-close-card]');
  if (!target) return;

  if (target.dataset.status) {
    state.statusFilter = target.dataset.status;
    renderClients();
    return;
  }

  if (target.dataset.openClient) { openClientCard(target.dataset.openClient); return; }

  if (target.dataset.startSession) {
    const session = state.sessions.find(s => s.id === target.dataset.startSession);
    if (session) {
      if (liveResumeId() === session.id) liveOpen(session.id);
      else liveOpen(session.id);
    }
    return;
  }

  if (target.dataset.openSession) {
    const session = state.sessions.find(s => s.id === target.dataset.openSession);
    if (!session) return;
    // если эта сессия была открыта в режиме сессии — возвращаемся в неё
    if (liveResumeId() === session.id) {
      liveOpen(session.id);
      return;
    }
    openSessionForm(session);
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

  if (target.dataset.action === 'start-live') {
    cardDialog.close();
    startSessionWith(target.dataset.clientId);
    return;
  }

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

/* «Начать встречу» из формы сессии: сохраняем введённое и входим в режим сессии */
$('#sessionStartLive').addEventListener('click', () => {
  const clientId = $('#sessionClient').value;
  if (!clientId) return;

  const id = $('#sessionId').value;
  const client = clientById(clientId);
  const data = {
    clientId,
    date: $('#sessionDate').value || today(),
    time: $('#sessionTime').value,
    topic: $('#sessionTopic').value.trim(),
    note: $('#sessionNote').value.trim(),
    plan: $('#sessionPlan').value.trim(),
    amount: Number($('#sessionAmount').value) || (client ? Number(client.price) || 0 : 0),
    paid: $('#sessionPaid').checked,
  };

  let sessionId = id;
  if (id) {
    const session = state.sessions.find(s => s.id === id);
    if (session) Object.assign(session, data);
  } else {
    const created = { id: uid(), ...data };
    state.sessions.push(created);
    sessionId = created.id;
  }

  save();
  sessionDialog.close();
  if (cardDialog.open) cardDialog.close();
  render();
  liveOpen(sessionId);
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
    plan: $('#sessionPlan').value.trim(),
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

document.addEventListener('click', e => {
  if (e.target.closest('[data-close-list]')) $('#listDialog').close();
});

/* закрыть меню по клику мимо */
document.addEventListener('click', e => {
  const menu = $('#dataMenu');
  if (menu && menu.hasAttribute('open') && !menu.contains(e.target)) menu.removeAttribute('open');
});

/* ---------- неделя: переключение ---------- */

$('#weekPrev').addEventListener('click', () => { weekOffset -= 1; renderWeek(); });
$('#weekNext').addEventListener('click', () => { weekOffset += 1; renderWeek(); });

const calTodayBtn = $('#calToday');
if (calTodayBtn) calTodayBtn.addEventListener('click', () => {
  weekOffset = 0;
  calDay = today();
  renderWeek();
});

const openCalBtn = $('#openCalendar');
if (openCalBtn) openCalBtn.addEventListener('click', () => setView('calendar'));

const calAddBtn = $('#calAdd');
if (calAddBtn) calAddBtn.addEventListener('click', () => openSessionForm(null, null, calDay || today()));

const calDayCloseBtn = $('#calDayClose');
if (calDayCloseBtn) calDayCloseBtn.addEventListener('click', () => { calDay = null; renderWeek(); });

const moreBtn = $('#upcomingMore');
if (moreBtn) moreBtn.addEventListener('click', () => setView('sessions'));

document.addEventListener('click', e => {
  const dayBtn = e.target.closest('[data-open-day]');
  if (!dayBtn) return;
  weekOffset = 0;
  calDay = dayBtn.dataset.openDay;
  setView('calendar');
  renderWeek();
});

document.addEventListener('click', e => {
  // клик по любому месту дня (кроме встреч и плюсика) раскрывает день по часам
  const dayCard = e.target.closest('.week-day');
  if (!dayCard) return;
  if (e.target.closest('[data-open-session]') || e.target.closest('[data-add-day]')) return;
  const head = dayCard.querySelector('[data-pick-day]');
  if (!head) return;
  const day = head.dataset.pickDay;
  calDay = calDay === day ? null : day;
  renderWeek();
});

document.addEventListener('click', e => {
  const addBtn = e.target.closest('[data-add-day]');
  if (!addBtn) return;
  const day = addBtn.dataset.addDay;
  const time = addBtn.dataset.addTime || '';
  openSessionForm(null, null, day, time);
});

/* ---------- плитки статистики ---------- */

$('#stats').addEventListener('click', e => {
  const tile = e.target.closest('[data-stat]');
  if (!tile) return;

  if (tile.dataset.session) {
    const session = state.sessions.find(s => s.id === tile.dataset.session);
    if (session) openSessionForm(session);
    return;
  }

  if (tile.dataset.stat === 'today') {
    // показываем только сегодняшние встречи
    const t = today();
    const rows = state.sessions.filter(s => s.date === t)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    showListDialog('Сегодня', rows);
    return;
  }

  if (tile.dataset.stat === 'clients') {
    state.statusFilter = 'active';
    state.query = '';
    $('#search').value = '';
    setView('clients');
    render();
    return;
  }

  if (tile.dataset.stat === 'money') {
    const month = today().slice(0, 7);
    const rows = state.sessions.filter(s => s.date.slice(0, 7) === month)
      .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
    showListDialog('Оплаты за месяц', rows);
    return;
  }
});

/* ---------- список встреч в окне ---------- */

function showListDialog(title, rows) {
  const body = $('#listBody');
  if (!body) return;

  $('#listTitle').textContent = title;
  body.innerHTML = rows.length
    ? rows.map(s => {
        const c = clientById(s.clientId) || {};
        return `
          <button class="session-line" data-open-session="${s.id}" type="button">
            <span class="s-date"><strong>${humanDateShort(s.date)}</strong><span>${weekday(s.date)}${s.time ? ', ' + esc(s.time) : ''}</span></span>
            <span class="s-client">${esc(c.name || 'клиент удалён')}</span>
            <span class="s-topic">${esc(s.topic || '—')}</span>
            <span class="s-amount">${s.amount ? money(s.amount) : '—'}</span>
            <span class="pill ${s.paid ? 'pill-paid' : 'pill-unpaid'}">${s.paid ? 'оплачено' : 'долг'}</span>
            <span></span>
          </button>`;
      }).join('')
    : '<div class="empty">Здесь пока пусто</div>';

  $('#listDialog').showModal();
}

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

document.addEventListener('click', e => {
  if (e.target.closest('[data-close-timer]')) $('#timerDialog').close();
});

$$('[data-timer]').forEach(btn => btn.addEventListener('click', () => {
  const minutes = Number(btn.dataset.timer);
  timerReset(minutes);
  timerStart(minutes);
}));

/* ---------- режим сессии: события ---------- */

$('#liveNote').addEventListener('input', liveQueueSave);
$('#livePlan').addEventListener('input', liveQueueSave);

$('#liveExit').addEventListener('click', () => {
  liveSave();
  liveClose();
  toast('Заметка сохранена');
});

$('#liveDone').addEventListener('click', () => {
  liveSave();
  const s = state.sessions.find(x => x.id === liveSessionId);
  if (s) {
    if (!s.topic) s.topic = 'Сессия';
    s.done = true;
    s.missed = false;
    save();
  }
  liveFinish();
  toast('Сессия завершена');
});

$('#liveMissed').addEventListener('click', () => {
  if (!confirm('Отметить, что встреча не состоялась? Время останется в расписании, оплата не начислится.')) return;
  const s = state.sessions.find(x => x.id === liveSessionId);
  if (s) {
    s.note = $('#liveNote').value || 'Встреча не состоялась.';
    s.plan = $('#livePlan').value;
    s.amount = 0;
    s.paid = false;
    s.missed = true;
    s.done = false;
    save();
  }
  liveFinish();
  toast('Отмечено: не состоялась');
});

$('#liveDeck').addEventListener('click', () => {
  const box = $('#liveDeckBox');
  box.hidden = !box.hidden;
  if (!box.hidden) deckRenderAll();
});

/* таймер внутри режима сессии */
$('#liveTimerToggle').addEventListener('click', () => {
  if (timerRunning) { timerStop(); $('#liveTimerToggle').textContent = 'Продолжить'; }
  else { timerStart(); $('#liveTimerToggle').textContent = 'Пауза'; }
});

$('#liveTimerReset').addEventListener('click', () => {
  timerReset(TIMER_MINUTES);
  timerStop();
  $('#liveTimerToggle').textContent = 'Старт';
  livePaint();
});

/* колода: категории, добавление и удаление */
document.addEventListener('click', e => {
  const cat = e.target.closest('[data-deck-cat]');
  if (cat) {
    deckCat = cat.dataset.deckCat;
    deckRenderAll();
    return;
  }

  const del = e.target.closest('[data-deck-del]');
  if (del) {
    deckDelete(Number(del.dataset.deckDel));
    return;
  }
});

$('#deckAddForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#deckNewQ');
  if (deckAddQuestion(input.value)) input.value = '';
});

$('#deckCatForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#deckNewCat');
  if (deckAddCategory(input.value)) input.value = '';
});

/* старт сессии */
$('#startSessionBtn').addEventListener('click', openStartDialog);

$('#startSearch').addEventListener('input', e => renderStartList(e.target.value));

$('#startNewClient').addEventListener('click', () => {
  $('#startDialog').close();
  openClientForm(null);
});

document.addEventListener('click', e => {
  if (e.target.closest('[data-close-start]')) $('#startDialog').close();

  const pick = e.target.closest('[data-start-client]');
  if (pick) {
    $('#startDialog').close();
    startSessionWith(pick.dataset.startClient);
  }
});

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
