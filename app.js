// Quatri · versión 0
// Flujo de alta: grado -> asignaturas -> grupos -> tu semana. Los datos del alumno se guardan en su dispositivo.

const DATA_URL = 'data/eseiaat-2026-27-q1.json';
const STORE_KEY = 'quatri.v1';
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const TYPE = { T: 'Teoría', P: 'Problemas', L: 'Laboratorio' };
const STEPS = ['grado', 'asignaturas', 'grupos', 'semana', 'rutina'];
const RUTINA_DEF = { trayecto: 30, prep: 60, despertarLibre: '08:30', comida: '14:30', comidaDur: 30, descanso: 30,
  merienda: false, meriendaHora: '18:30', cena: '21:15', cenaDur: 30, estudiaNoche: false, dormir: '00:00' };

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hh = t => t.replace(/^0/, '').replace(':00', '');
const num = n => String(n).replace('.', ',');

let D = null; // datos del catálogo
let S = load(); // estado del alumno

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { toast('No se ha podido guardar en este dispositivo.'); }
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- catálogo ---------- */
const grado = () => D.grados.find(g => g.id === S.grado);
const subj = code => D.asignaturas[code];
const shortName = code => { const a = subj(code); return a.s || a.n; };

// Grupos que el alumno puede elegir en una asignatura: subgrupos si los hay; si no, grupos de teoría.
function options(code) {
  const g = subj(code).g;
  const ids = Object.keys(g);
  const subs = ids.filter(id => !g[id].te);
  return (subs.length ? subs : ids).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}
// Sesiones de un grupo elegido: las suyas + las de su grupo de teoría.
function sessions(code, id) {
  const g = subj(code).g;
  if (!g[id]) return [];
  const own = g[id].x.map(x => ({ code, group: id, x }));
  const p = g[id].p;
  const parent = (!g[id].te && p && p !== id && g[p]) ? g[p].x.map(x => ({ code, group: p, x })) : [];
  return [...parent, ...own];
}
function summary(code, id) {
  const ss = sessions(code, id);
  if (!ss.length) return 'Sin clases con horario';
  return ss.map(({ x }) => `${DAYS_SHORT[x[0]]} ${hh(x[1])}–${hh(x[2])} ${x[3]}${x[5] && x[5].length === 1 ? ` (${x[5]})` : ''}`).join(' · ');
}
// Semestre del plan que toca ahora en un curso: en Q1, 1º -> nivel 1, 2º -> nivel 3...
const nowLevel = c => 2 * Number(c) - (D.periodo.q === 'Q1' ? 1 : 0);
const hasSchedule = code => Object.values(subj(code).g).some(g => g.x.length);

/* ---------- colores por asignatura ---------- */
function colorOf(code) {
  const i = (S.asignaturas || []).indexOf(code);
  return `var(--s${(i % 10) + 1})`;
}

/* ---------- conflictos ---------- */
function weeksCompatible(a, b) {
  if (!a || !b) return true;
  return a === b; // A con B, o B1 con B2, nunca coinciden
}
function clashes(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i].x, b = list[j].x;
    if (list[i].code === list[j].code) continue;
    if (a[0] !== b[0] || !weeksCompatible(a[5], b[5])) continue;
    if (toMin(a[1]) < toMin(b[2]) && toMin(b[1]) < toMin(a[2])) out.push([list[i], list[j]]);
  }
  return out;
}

/* ---------- router ---------- */
function go(step) { location.hash = step; }
function current() {
  const h = location.hash.slice(1);
  if (!S.grado) return 'grado';
  if (STEPS.includes(h) || h === 'hoy') return h;
  return S.listo ? 'hoy' : (S.asignaturas?.length ? 'asignaturas' : 'grado');
}
function render() {
  const step = current();
  const i = STEPS.indexOf(step);
  $('#steps').innerHTML = i >= 0 ? STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('') : '';
  ({ grado: viewGrado, asignaturas: viewAsignaturas, grupos: viewGrupos, semana: viewSemana, rutina: viewRutina, hoy: viewHoy })[step]();
  window.scrollTo(0, 0);
}
function actions(html) {
  let bar = $('#actions');
  if (!bar) { bar = document.createElement('div'); bar.id = 'actions'; bar.className = 'actions'; document.body.appendChild(bar); }
  bar.innerHTML = `<div class="actions-in">${html}</div>`;
  bar.hidden = !html;
}

/* ---------- 1. Grado ---------- */
function viewGrado() {
  const v = $('#view');
  v.innerHTML = `
    <div class="eyebrow">Paso 1 de 5</div>
    <h1>¿Qué estudias?</h1>
    <p class="lead">Elige tu grado y cargamos tus clases, festivos y exámenes. Tus datos se guardan solo en este dispositivo.</p>
    <div class="fixed">
      <span class="pill">Universidad <b>UPC</b></span>
      <span class="pill">Escuela <b>ESEIAAT · Terrassa</b></span>
      <span class="pill">Curso <b>2026/27 · Q1</b></span>
    </div>
    <div class="stack" id="grados">
      ${D.grados.map(g => `
        <button class="choice" data-g="${esc(g.id)}" aria-pressed="${S.grado === g.id}">
          <span><b>${esc(g.n.replace(/^Grau (\(Fase Comuna\) )?en /, m => m.includes('Fase') ? 'Fase común: ' : ''))}</b>
          <span class="code">${esc(g.id)} · ${g.a.length} asignaturas</span></span>
        </button>`).join('')}
    </div>`;
  v.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    if (S.grado !== b.dataset.g) { S.grado = b.dataset.g; S.asignaturas = []; S.grupos = {}; S.listo = false; save(); }
    go('asignaturas');
  });
  actions('');
}

/* ---------- 2. Asignaturas ---------- */
function viewAsignaturas() {
  const g = grado();
  S.asignaturas = S.asignaturas || [];
  const byCurso = {};
  for (const code of g.a) { const a = subj(code); (byCurso[a.c] = byCurso[a.c] || []).push(code); }
  const v = $('#view');
  v.innerHTML = `
    <div class="eyebrow">Paso 2 de 5</div>
    <h1>¿Qué asignaturas haces este cuatrimestre?</h1>
    <p class="lead">Marca un curso entero con un toque y luego añade o quita las que no encajen: repetidas, adelantadas u optativas.</p>
    <input class="search" id="q" type="search" placeholder="Buscar asignatura" autocomplete="off">
    <div id="list"></div>`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const row = code => {
      const a = subj(code), on = S.asignaturas.includes(code);
      if (q && !(a.n.toLowerCase().includes(q) || (a.s || '').toLowerCase().includes(q))) return '';
      return `<label class="subj ${on ? 'on' : ''}">
        <input type="checkbox" data-c="${code}" ${on ? 'checked' : ''}>
        <span class="nm"><b>${esc(a.n)}</b><small>${esc(a.s)}${a.t === 'OP' ? ' · optativa' : ''}${hasSchedule(code) ? '' : ' · sin horario de clases'}</small></span>
        <span class="cr">${a.cr ? num(a.cr) + ' cr' : ''}</span></label>`;
    };
    const byName = (a, b) => subj(a).n.localeCompare(subj(b).n);
    $('#list').innerHTML = Object.keys(byCurso).sort().map(c => {
      const now = byCurso[c].filter(x => subj(x).t !== 'OP' && subj(x).v === nowLevel(c)).sort(byName);
      const other = byCurso[c].filter(x => subj(x).t !== 'OP' && subj(x).v !== nowLevel(c)).sort(byName);
      const op = byCurso[c].filter(x => subj(x).t === 'OP').sort(byName);
      const nowHtml = now.map(row).join(''), otherHtml = other.map(row).join(''), opHtml = op.map(row).join('');
      if (q && !nowHtml && !otherHtml && !opHtml) return '';
      const allOn = now.length && now.every(x => S.asignaturas.includes(x));
      const qn = D.periodo.q === 'Q1' ? 1 : 2;
      return `<section class="curso">
        <div class="curso-head"><h2>${c}º curso</h2>${now.length ? `<button class="btn small" data-all="${c}">${allOn ? 'Quitar' : 'Marcar'} ${c}º · Q${qn}</button>` : ''}</div>
        ${nowHtml}
        ${other.length ? `<details class="opt" ${q || other.some(x => S.asignaturas.includes(x)) ? 'open' : ''}><summary>Del Q${3 - qn} de ${c}º, que también se dan ahora (${other.length})</summary>${otherHtml}</details>` : ''}
        ${op.length ? `<details class="opt" ${q || op.some(x => S.asignaturas.includes(x)) ? 'open' : ''}><summary>Optativas (${op.length})</summary>${opHtml}</details>` : ''}
      </section>`;
    }).join('') || '<p class="lead">No hay ninguna asignatura con ese nombre.</p>';
    $('#list').querySelectorAll('[data-c]').forEach(cb => cb.onchange = () => {
      const c = cb.dataset.c;
      S.asignaturas = cb.checked ? [...S.asignaturas, c] : S.asignaturas.filter(x => x !== c);
      save(); draw(); bar();
    });
    $('#list').querySelectorAll('[data-all]').forEach(b => b.onclick = () => {
      const ob = byCurso[b.dataset.all].filter(x => subj(x).t !== 'OP' && subj(x).v === nowLevel(b.dataset.all));
      const allOn = ob.every(x => S.asignaturas.includes(x));
      S.asignaturas = allOn ? S.asignaturas.filter(x => !ob.includes(x)) : [...new Set([...S.asignaturas, ...ob])];
      save(); draw(); bar();
    });
  };
  const bar = () => {
    const n = S.asignaturas.length, cr = S.asignaturas.reduce((s, c) => s + (subj(c).cr || 0), 0);
    actions(`<button class="btn" id="back">Atrás</button>
      <span class="info">${n ? `${n} asignaturas · ${num(cr)} créditos` : 'Ninguna marcada'}</span>
      <button class="btn primary" id="next" ${n ? '' : 'disabled'}>Siguiente</button>`);
    $('#back').onclick = () => go('grado');
    $('#next').onclick = () => go('grupos');
  };
  $('#q').oninput = draw;
  draw(); bar();
}

/* ---------- 3. Grupos ---------- */
function viewGrupos() {
  S.grupos = S.grupos || {};
  const codes = S.asignaturas.filter(hasSchedule);
  const noSched = S.asignaturas.filter(c => !hasSchedule(c));
  const allIds = [...new Set(codes.flatMap(options))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  if (S.mismo === undefined) S.mismo = true;
  const v = $('#view');

  const applySame = id => {
    S.grupoComun = id;
    for (const c of codes) {
      const opts = options(c);
      if (opts.includes(id)) S.grupos[c] = id;
      else {
        // si la asignatura no tiene ese subgrupo, probamos con su grupo de teoría (1 o 2)
        const parent = subj(c).g[id]?.p || id.charAt(0);
        S.grupos[c] = opts.includes(parent) ? parent : (S.grupos[c] && opts.includes(S.grupos[c]) ? S.grupos[c] : null);
      }
    }
    save();
  };

  const draw = () => {
    const missing = codes.filter(c => !S.grupos[c] || !options(c).includes(S.grupos[c]));
    v.innerHTML = `
      <div class="eyebrow">Paso 3 de 5</div>
      <h1>¿En qué grupos estás?</h1>
      <p class="lead">El grupo de teoría se pone solo según tu subgrupo: los que empiezan por 1 van con la teoría 1 y los que empiezan por 2, con la 2.</p>
      <div class="toggle" role="group">
        <button data-m="1" aria-pressed="${S.mismo}">Mismo grupo en todas</button>
        <button data-m="0" aria-pressed="${!S.mismo}">Distinto en cada una</button>
      </div>
      ${S.mismo ? `<div class="card stack">
          <div class="eyebrow">Tu subgrupo</div>
          <div class="gchips">${allIds.map(id => `<button class="gchip" data-id="${esc(id)}" aria-pressed="${S.grupoComun === id}">${esc(id)}</button>`).join('')}</div>
        </div>` : ''}
      <div class="stack" style="margin-top:14px">
        ${codes.map(c => {
          const sel = S.grupos[c], opts = options(c), bad = !sel || !opts.includes(sel);
          return `<div class="card gsubj" style="--c:${colorOf(c)}"><span class="bar"></span><div>
            <b>${esc(subj(c).n)}</b>
            ${!S.mismo || bad ? `<select data-c="${c}" aria-label="Grupo de ${esc(subj(c).n)}">
                <option value="">Elige tu grupo</option>
                ${opts.map(id => `<option value="${esc(id)}" ${sel === id ? 'selected' : ''}>${esc(id)}${subj(c).g[id].te ? ' (teoría)' : ` · teoría ${esc(subj(c).g[id].p)}`}</option>`).join('')}
              </select>` : `<div class="row" style="margin-top:4px"><span class="pill">Grupo <b>${esc(sel)}</b></span>${subj(c).g[sel].te ? '' : `<span class="pill">Teoría <b>${esc(subj(c).g[sel].p)}</b></span>`}</div>`}
            ${bad && S.mismo && S.grupoComun ? `<div class="need">Esta asignatura no tiene el grupo ${esc(S.grupoComun)}: elige el tuyo.</div>` : ''}
            ${sel && opts.includes(sel) ? `<div class="sum">${esc(summary(c, sel))}</div>` : ''}
          </div></div>`;
        }).join('')}
        ${noSched.length ? `<div class="notice warn">Sin horario de clases en el visor: ${noSched.map(c => esc(subj(c).n)).join(', ')}. Las guardamos igualmente para el plan de estudio.</div>` : ''}
      </div>`;
    v.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { S.mismo = b.dataset.m === '1'; save(); draw(); bar(); });
    v.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { applySame(b.dataset.id); draw(); bar(); });
    v.querySelectorAll('select[data-c]').forEach(s => s.onchange = () => { S.grupos[s.dataset.c] = s.value || null; save(); draw(); bar(); });
    bar(missing.length);
  };
  const bar = (missing = codes.filter(c => !S.grupos[c] || !options(c).includes(S.grupos[c])).length) => {
    actions(`<button class="btn" id="back">Atrás</button>
      <span class="info">${missing ? `Faltan ${missing} por elegir` : 'Todo listo'}</span>
      <button class="btn primary" id="next" ${missing ? 'disabled' : ''}>Ver mi semana</button>`);
    $('#back').onclick = () => go('asignaturas');
    $('#next').onclick = () => go('semana');
  };
  draw();
}

/* ---------- 4. Tu semana ---------- */
function mySessions() {
  return S.asignaturas.filter(hasSchedule).flatMap(c => S.grupos[c] ? sessions(c, S.grupos[c]) : []);
}
function weekGrid(list, clashSet = new Set()) {
  const days = list.some(s => s.x[0] > 4) ? 7 : 5;
  let h0 = 8, h1 = 15;
  list.forEach(({ x }) => { h0 = Math.min(h0, Math.floor(toMin(x[1]) / 60)); h1 = Math.max(h1, Math.ceil(toMin(x[2]) / 60)); });
  const hpx = 46, px = m => (m - h0 * 60) / 60 * hpx, H = (h1 - h0) * hpx;
  const cols = [];
  for (let d = 0; d < days; d++) {
    const items = list.map((s, i) => ({ s, i })).filter(o => o.s.x[0] === d)
      .map(o => ({ ...o, a: toMin(o.s.x[1]), b: toMin(o.s.x[2]) })).sort((p, q) => p.a - q.a || q.b - p.b);
    // reparte en columnas las sesiones que se solapan en el mismo hueco
    const lanes = []; items.forEach(it => { let k = lanes.findIndex(e => e <= it.a); if (k < 0) { k = lanes.length; lanes.push(0); } lanes[k] = it.b; it.k = k; });
    items.forEach(it => { it.n = Math.max(1, ...items.filter(o => o.a < it.b && it.a < o.b).map(o => o.k + 1)); });
    cols.push(`<div class="wk-col" style="height:${H}px;--hpx:${hpx}px">${items.map(({ s, i, a, b, k, n }) => {
      const sub = subj(s.code), x = s.x, w = 100 / n;
      return `<div class="blk ${clashSet.has(i) ? 'clash' : ''}" style="--c:${colorOf(s.code)};top:${px(a) + 1}px;height:${Math.max(px(b) - px(a) - 2, 18)}px;left:calc(${k * w}% + 2px);width:calc(${w}% - 4px)" title="${esc(sub.n)} · ${TYPE[x[3]] || x[3]} · grupo ${esc(s.group)} · ${x[1]}–${x[2]} · ${esc(x[4])}">
        ${x[5] && x[5].length === 1 ? `<span class="ab">${x[5]}</span>` : ''}
        <b>${esc(sub.s)} ${x[3]}</b><small>${hh(x[1])}–${hh(x[2])} · ${esc(s.group)}</small><small>${esc(x[4].replace(/ - Lab\..*/, ''))}</small></div>`;
    }).join('')}</div>`);
  }
  let hours = ''; for (let h = h0 + 1; h < h1; h++) hours += `<span style="top:${(h - h0) * hpx}px">${h}:00</span>`;
  return `<div class="week"><div class="wk-scroll"><div class="wk" style="grid-template-columns:44px repeat(${days},minmax(96px,1fr))">
    <div class="wk-h"></div>${DAYS.slice(0, days).map(d => `<div class="wk-h">${d}</div>`).join('')}
    <div class="wk-hours" style="height:${H}px">${hours}</div>${cols.join('')}
  </div></div></div>`;
}
function viewSemana() {
  const list = mySessions();
  const cl = clashes(list);
  const clashSet = new Set(cl.flatMap(([a, b]) => [list.indexOf(a), list.indexOf(b)]));
  const mins = list.reduce((s, { x }) => s + (x[5] && x[5].length === 1 ? 0.5 : 1) * (toMin(x[2]) - toMin(x[1])), 0);
  const exams = S.asignaturas.flatMap(c => subj(c).e.map(e => ({ c, e }))).filter(o => o.e[0] === 'final').sort((a, b) => a.e[1].localeCompare(b.e[1]));
  const v = $('#view');
  v.innerHTML = `
    <div class="eyebrow">Paso 4 de 5</div>
    <h1>Tu semana de clases</h1>
    <p class="lead">Las marcas A y B son laboratorios que solo tienes en semanas alternas. Toca un bloque para ver el detalle.</p>
    <div class="stats">
      <div class="stat"><b>${S.asignaturas.length}</b><span>asignaturas</span></div>
      <div class="stat"><b>${num(Math.round(mins / 60 * 10) / 10)} h</b><span>de clase por semana (media)</span></div>
      <div class="stat"><b>${exams.length}</b><span>finales en enero</span></div>
    </div>
    ${cl.length ? `<div class="notice bad" style="margin-top:14px"><b>Hay clases que se pisan.</b> Revisa los grupos:<ul>${cl.map(([a, b]) =>
      `<li>${DAYS[a.x[0]]}: ${esc(shortName(a.code))} (${esc(a.group)}) ${a.x[1]}–${a.x[2]} con ${esc(shortName(b.code))} (${esc(b.group)}) ${b.x[1]}–${b.x[2]}</li>`).join('')}</ul></div>`
      : `<div class="notice good" style="margin-top:14px">Ninguna clase se pisa.</div>`}
    <div class="legend">${S.asignaturas.filter(hasSchedule).map(c => `<span style="--c:${colorOf(c)}"><i></i>${esc(subj(c).s)} · ${esc(subj(c).n)}</span>`).join('')}</div>
    ${weekGrid(list, clashSet)}
    ${exams.length ? `<div class="card" style="margin-top:14px"><div class="eyebrow" style="margin-bottom:8px">Tus finales</div>
      <div class="stack">${exams.map(({ c, e }) => { const d = new Date(e[1] + 'T12:00'); return `<div class="row" style="--c:${colorOf(c)}"><span class="pill" style="font-family:var(--mono)">${DAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}</span><span>${esc(subj(c).n)}</span><span style="color:var(--muted);font-size:13px;font-family:var(--mono)">${e[2]}–${e[3]}</span></div>`; }).join('')}</div></div>` : ''}`;
  v.querySelectorAll('.blk').forEach(b => b.onclick = () => toast(b.title));
  actions(`<button class="btn" id="back">Atrás</button><span class="info"></span><button class="btn primary" id="next">${S.listo ? 'Guardar' : 'Siguiente'}</button>`);
  $('#back').onclick = () => go('grupos');
  $('#next').onclick = () => { S.guardado = new Date().toISOString(); save(); if (S.listo) { toast('Horario guardado'); go('hoy'); } else go('rutina'); };
}

/* ---------- 5. Rutina ---------- */
function viewRutina() {
  const R = S.rutina = { ...RUTINA_DEF, ...(S.rutina || {}) };
  const v = $('#view');
  const mins = (id, label, vals, val, hint = '') => `<label class="field"><span>${label}</span>
    <select id="${id}">${vals.map(m => `<option value="${m}" ${m === val ? 'selected' : ''}>${m === 0 ? 'Sin descanso' : dur(m)}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const time = (id, label, val, hint = '') => `<label class="field"><span>${label}</span><input type="time" id="${id}" value="${val}" step="300">${hint ? `<small>${hint}</small>` : ''}</label>`;
  v.innerHTML = `
    <div class="eyebrow">Paso 5 de 5</div>
    <h1>Tu día a día</h1>
    <p class="lead">Con esto calculamos tus horas libres de verdad, no solo los huecos entre clases. Son valores aproximados: los podrás cambiar cuando quieras.</p>
    <div class="stack">
      <section class="card stack"><div class="eyebrow">Ir a la uni</div>
        <div class="fields">
          ${mins('trayecto', '¿Cuánto tardas en llegar?', [5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120], R.trayecto, 'Lo mismo a la vuelta.')}
          ${mins('prep', 'Levantarte, prepararte y desayunar', [15, 30, 45, 60, 75, 90], R.prep)}
          ${time('despertarLibre', 'Días sin clase te levantas a las', R.despertarLibre)}
        </div></section>
      <section class="card stack"><div class="eyebrow">Comidas y descansos</div>
        <div class="fields">
          ${time('comida', 'Sueles comer a las', R.comida, 'Si a esa hora estás en clase o volviendo, se mueve a cuando llegues.')}
          ${mins('comidaDur', 'La comida te lleva', [15, 30, 45, 60], R.comidaDur)}
          ${mins('descanso', 'Descanso después de comer', [0, 15, 30, 45, 60], R.descanso)}
          ${time('cena', 'Cenas a las', R.cena)}
          ${mins('cenaDur', 'La cena te lleva', [15, 30, 45, 60], R.cenaDur)}
        </div>
        <label class="check"><input type="checkbox" id="merienda" ${R.merienda ? 'checked' : ''}> Merienda o pausa por la tarde (30 min)</label>
        <div class="fields" id="mBox" ${R.merienda ? '' : 'hidden'}>${time('meriendaHora', 'Hacia las', R.meriendaHora)}</div>
      </section>
      <section class="card stack"><div class="eyebrow">La noche</div>
        <div class="fields">${time('dormir', 'Te vas a dormir a las', R.dormir)}</div>
        <label class="check"><input type="checkbox" id="estudiaNoche" ${R.estudiaNoche ? 'checked' : ''}> Estudio después de cenar</label>
        <small class="hint">Si no lo marcas, de la cena a la hora de dormir no cuenta como tiempo libre para estudiar.</small>
      </section>
    </div>`;
  const read = () => {
    for (const k of Object.keys(RUTINA_DEF)) {
      const el = $('#' + k); if (!el) continue;
      R[k] = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' ? Number(el.value) : el.value || RUTINA_DEF[k]);
    }
    $('#mBox').hidden = !R.merienda;
    save();
  };
  v.querySelectorAll('input,select').forEach(el => el.onchange = read);
  actions(`<button class="btn" id="back">Atrás</button><span class="info"></span><button class="btn primary" id="next">${S.listo ? 'Guardar' : 'Empezar'}</button>`);
  $('#back').onclick = () => go(S.listo ? 'hoy' : 'semana');
  $('#next').onclick = () => { read(); S.listo = true; save(); toast('Todo listo'); go('hoy'); };
}

/* ---------- motor del día ---------- */
const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dparse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const wdOf = d => (d.getDay() + 6) % 7;
const mondayOf = d => addDays(d, -wdOf(d));
const dur = m => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`; };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function weekType(ds) {
  const d = dparse(ds), mon = dkey(mondayOf(d)), sem = D.calendario.semanas;
  for (const t of ['A', 'B']) for (const start of sem[t] || []) {
    if (dkey(mondayOf(dparse(start))) === mon && ds >= start) return t;
  }
  return null;
}
function dayInfo(ds) {
  const c = D.calendario, d = dparse(ds), wd = wdOf(d);
  const inPeriod = ds >= c.inicio_clases && ds <= c.fin_clases;
  const lective = inPeriod && wd < 5 && !(c.dias_sin_clase || []).includes(ds);
  const finales = c.periodo_finales && ds >= c.periodo_finales[0] && ds <= c.periodo_finales[1];
  let note = '';
  if (wd >= 5) note = 'Fin de semana';
  else if (inPeriod && !lective) note = 'Día sin clases';
  else if (finales) note = 'Período de exámenes finales';
  else if (!inPeriod && ds > c.fin_clases) note = 'Sin clases (vacaciones o exámenes)';
  return { d, wd, lective, week: lective ? weekType(ds) : null, note };
}
function dayPlan(ds) {
  const R = { ...RUTINA_DEF, ...(S.rutina || {}) };
  const info = dayInfo(ds);
  const blocks = [];
  if (info.lective) {
    for (const s of mySessions()) {
      const x = s.x;
      if (x[0] !== info.wd) continue;
      if (x[5] && x[5].length === 1 && x[5] !== info.week) continue; // laboratorios de semanas alternas
      blocks.push({ s: toMin(x[1]), e: toMin(x[2]), kind: 'clase', code: s.code, label: `${subj(s.code).n}`, sub: `${TYPE[x[3]] || x[3]} · grupo ${s.group} · ${x[4].replace(/ - Lab\..*/, '')}` });
    }
  }
  for (const c of S.asignaturas || []) for (const e of subj(c).e) {
    if (e[1] === ds) blocks.push({ s: toMin(e[2]), e: toMin(e[3]), kind: 'examen', code: c, label: `Examen ${e[0]} · ${subj(c).n}`, sub: e[4] });
  }
  const T = Number(R.trayecto), P = Number(R.prep);
  let sleep = toMin(R.dormir || '00:00'); if (sleep < 6 * 60) sleep += 1440;
  let wake;
  if (blocks.length) {
    const first = Math.min(...blocks.map(b => b.s)), last = Math.max(...blocks.map(b => b.e));
    blocks.push({ s: first - T, e: first, kind: 'trayecto', label: 'Ida a la uni' });
    blocks.push({ s: last, e: last + T, kind: 'trayecto', label: 'Vuelta a casa' });
    wake = first - T - P;
  } else wake = toMin(R.despertarLibre);
  blocks.push({ s: wake, e: wake + P, kind: 'rutina', label: 'Levantarte y desayunar' });
  const place = (start, len, label, kind = 'rutina') => {
    let t = start, moved = true;
    while (moved) { moved = false; for (const b of blocks) if (t < b.e && b.s < t + len) { t = b.e; moved = true; } }
    if (t + len > sleep) return null;
    const b = { s: t, e: t + len, kind, label }; blocks.push(b); return b;
  };
  const com = place(toMin(R.comida), Number(R.comidaDur), 'Comida');
  if (com && Number(R.descanso)) place(com.e, Number(R.descanso), 'Descanso');
  if (R.merienda) place(toMin(R.meriendaHora), 30, 'Merienda y pausa');
  const cen = place(toMin(R.cena), Number(R.cenaDur), 'Cena');
  if (cen && !R.estudiaNoche && cen.e < sleep) blocks.push({ s: cen.e, e: sleep, kind: 'noche', label: 'Desconexión', sub: 'Después de cenar no cuenta para estudiar' });
  blocks.sort((a, b) => a.s - b.s || a.e - b.e);
  // huecos libres entre levantarte y dormir
  const free = []; let t = wake;
  for (const b of blocks) { if (b.s - t >= 15) free.push({ s: t, e: b.s, kind: 'libre' }); t = Math.max(t, b.e); }
  if (sleep - t >= 15) free.push({ s: t, e: sleep, kind: 'libre' });
  return { info, blocks, free, wake, sleep, freeMin: free.reduce((n, f) => n + f.e - f.s, 0),
    classMin: blocks.filter(b => b.kind === 'clase').reduce((n, b) => n + b.e - b.s, 0) };
}

/* ---------- Tu día ---------- */
function viewHoy() {
  S.dia = S.dia || dkey(new Date());
  const ds = S.dia, p = dayPlan(ds), d = p.info.d, today = dkey(new Date());
  const rel = ds === today ? 'Hoy' : ds === dkey(addDays(new Date(), 1)) ? 'Mañana' : ds === dkey(addDays(new Date(), -1)) ? 'Ayer' : DAYS[p.info.wd];
  const items = [...p.blocks, ...p.free].sort((a, b) => a.s - b.s);
  const row = it => {
    const style = it.kind === 'clase' || it.kind === 'examen' ? `--c:${colorOf(it.code)}` : '';
    const label = it.kind === 'libre' ? `Libre · ${dur(it.e - it.s)}` : esc(it.label);
    return `<li class="it ${it.kind}" style="${style}"><span class="t">${fmt(it.s % 1440)}<br><small>${fmt(it.e % 1440)}</small></span>
      <span class="n"><b>${label}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></li>`;
  };
  const v = $('#view');
  v.innerHTML = `
    <div class="dayhead">
      <button class="icon" id="prev" aria-label="Día anterior">‹</button>
      <div class="dh"><div class="eyebrow">${rel}${p.info.week ? ` · semana ${p.info.week}` : ''}</div>
        <h1>${DAYS[p.info.wd]} ${d.getDate()} de ${MONTHS[d.getMonth()]}</h1></div>
      <button class="icon" id="next" aria-label="Día siguiente">›</button>
    </div>
    <div class="stats">
      <div class="stat free"><b>${dur(p.freeMin)}</b><span>libres de verdad</span></div>
      <div class="stat"><b>${p.classMin ? dur(p.classMin) : '—'}</b><span>de clase</span></div>
    </div>
    ${p.info.note ? `<div class="notice warn" style="margin-top:12px">${esc(p.info.note)}</div>` : ''}
    <ul class="timeline">${items.map(row).join('')}</ul>
    <div class="row" style="margin-top:16px">
      ${ds !== today ? '<button class="btn small" id="today">Volver a hoy</button>' : ''}
      <button class="btn small" id="eRut">Mi rutina</button>
      <button class="btn small" id="eSem">Mi horario</button>
      <button class="btn small" id="eAsg">Asignaturas y grupos</button>
    </div>`;
  const shift = n => { S.dia = dkey(addDays(dparse(S.dia), n)); save(); viewHoy(); };
  $('#prev').onclick = () => shift(-1);
  $('#next').onclick = () => shift(1);
  if ($('#today')) $('#today').onclick = () => { S.dia = today; save(); viewHoy(); };
  $('#eRut').onclick = () => go('rutina');
  $('#eSem').onclick = () => go('semana');
  $('#eAsg').onclick = () => go('asignaturas');
  swipe(v, shift);
  actions('');
}
function swipe(el, fn) {
  if (el.dataset.sw) return; el.dataset.sw = 1;
  let x0 = null, y0 = 0, t0 = 0;
  el.addEventListener('touchstart', e => { if (e.touches.length !== 1 || current() !== 'hoy') { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return; const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.6 * Math.abs(dy) && Date.now() - t0 < 800) fn(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* ---------- arranque ---------- */
async function start() {
  try {
    const r = await fetch(DATA_URL);
    if (!r.ok) throw new Error(r.status);
    D = await r.json();
  } catch (e) {
    $('#view').innerHTML = `<h1>No se han podido cargar los horarios</h1><p class="lead">Revisa tu conexión y vuelve a abrir la app.</p>`;
    return;
  }
  if (S.grado && !grado()) S = {};
  S.dia = dkey(new Date()); // al abrir la app, siempre empieza en hoy
  window.addEventListener('hashchange', render);
  render();
}
start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
  // cuando se instala una versión nueva, recarga una vez para usarla
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
