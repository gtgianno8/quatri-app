// Quatri · versión 0
// Flujo de alta: grado -> asignaturas -> grupos -> tu semana. Los datos del alumno se guardan en su dispositivo.

const DATA_URL = 'data/eseiaat-2026-27-q1.json';
const STORE_KEY = 'quatri.v1';
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const TYPE = { T: 'Teoría', P: 'Problemas', L: 'Laboratorio' };
const STEPS = ['grado', 'asignaturas', 'grupos', 'semana', 'rutina'];
const RUT_LABEL = { despertar: 'Levantarte y desayunar', comida: 'Comida', descanso: 'Descanso', merienda: 'Merienda y pausa', cena: 'Cena' };
const RUTINA_DEF = { trayecto: 30, prep: 60, volverCasa: 0, despertarLibre: '08:30', comida: '14:30', comidaDur: 30, descanso: 30,
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
// Bocadillo de información: se cierra solo a los 4 s o al tocarlo.
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  if (!t.dataset.tap) { t.dataset.tap = 1; t.onclick = () => { t.hidden = true; clearTimeout(toast.t); }; }
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4000);
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

/* ---------- colores por asignatura ----------
   Los mismos que el Visor d'Horaris UPC: 8 colores repartidos en orden entre las asignaturas del grado,
   ordenadas por semestre del plan y luego alfabéticamente. Así cada asignatura tiene siempre su color. */
const UPC_COLORS = [ // [fondo (200), color fuerte (600)]: azul, índigo, rojo, naranja, amarillo, verde, verde azulado, cian
  ['#9EC5FE', '#0A58CA'], ['#C29FFA', '#520DC2'], ['#F1AEB5', '#B02A37'], ['#FECBA1', '#CA6510'],
  ['#E3D19B', '#957105'], ['#A3CFBB', '#146C43'], ['#D4E6B3', '#769A35'], ['#9EEAF9', '#0AA2C0']];
const collator = new Intl.Collator('ca');
let colorCache = null;
function colorVars(code) {
  if (!colorCache || colorCache.grado !== S.grado) {
    const order = grado().a.filter(c => subj(c).v > 0)
      .sort((a, b) => subj(a).v - subj(b).v || collator.compare(subj(a).n.toUpperCase(), subj(b).n.toUpperCase()));
    colorCache = { grado: S.grado, idx: Object.fromEntries(order.map((c, i) => [c, i])) };
  }
  const [bg, strong] = UPC_COLORS[(colorCache.idx[code] ?? 0) % UPC_COLORS.length];
  return `--c:${strong};--cb:${bg}`;
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
  if (h === 'bienvenida') return h;
  if (!S.grado) return h === 'grado' ? 'grado' : 'bienvenida';
  if (h === 'listo' && S.listo) return h;
  if (STEPS.includes(h)) return h;
  if (['hoy', 'calendario', 'estudio', 'ajustes'].includes(h)) return S.listo ? h : 'grado';
  return S.listo ? 'hoy' : (S.asignaturas?.length ? 'asignaturas' : 'grado');
}
function render() {
  const step = current();
  const i = STEPS.indexOf(step);
  $('#steps').innerHTML = i >= 0 ? STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('') : '';
  $('#view')._swipe = null;
  if ($('#fab')) $('#fab').hidden = true;
  ({ bienvenida: viewBienvenida, listo: viewListo, grado: viewGrado, asignaturas: viewAsignaturas, grupos: viewGrupos, semana: viewSemana, rutina: viewRutina,
     hoy: viewHoy, calendario: viewCalendario, estudio: viewEstudio, ajustes: viewAjustes })[step]();
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
  actions(`<button class="btn" id="back">Atrás</button><span class="info">Toca tu grado para seguir</span>`);
  $('#back').onclick = () => go(S.listo ? 'ajustes' : 'bienvenida');
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
    // ¿todas sus clases empiezan a partir de las 14:00? (las que se dan fuera de su cuatrimestre suelen ir por la tarde)
    const afternoon = list => { const xs = list.flatMap(c => Object.values(subj(c).g).flatMap(g => g.x)); return xs.length > 0 && xs.every(x => toMin(x[1]) >= 14 * 60); };
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
        ${other.length ? `<details class="opt" ${q || other.some(x => S.asignaturas.includes(x)) ? 'open' : ''}><summary>Del Q${3 - qn} de ${c}º, que también se dan ahora${afternoon(other) ? ' por la tarde' : ''} (${other.length})</summary>${otherHtml}</details>` : ''}
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
          return `<div class="card gsubj" style="${colorVars(c)}"><span class="bar"></span><div>
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
      return `<div class="blk ${clashSet.has(i) ? 'clash' : ''}" style="${colorVars(s.code)};top:${px(a) + 1}px;height:${Math.max(px(b) - px(a) - 2, 18)}px;left:calc(${k * w}% + 2px);width:calc(${w}% - 4px)" title="${esc(sub.n)} · ${TYPE[x[3]] || x[3]} · grupo ${esc(s.group)} · ${x[1]}–${x[2]} · ${esc(x[4])}">
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
    <div class="legend">${S.asignaturas.filter(hasSchedule).map(c => `<span style="${colorVars(c)}"><i></i>${esc(subj(c).s)} · ${esc(subj(c).n)}</span>`).join('')}</div>
    ${weekGrid(list, clashSet)}
    ${exams.length ? `<div class="card" style="margin-top:14px"><div class="eyebrow" style="margin-bottom:8px">Tus finales</div>
      <div class="stack">${exams.map(({ c, e }) => { const d = new Date(e[1] + 'T12:00'); return `<div class="row" style="${colorVars(c)}"><span class="pill" style="font-family:var(--mono)">${DAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}</span><span>${esc(subj(c).n)}</span><span style="color:var(--muted);font-size:13px;font-family:var(--mono)">${e[2]}–${e[3]}</span></div>`; }).join('')}</div></div>` : ''}`;
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
          <label class="field"><span>Si tienes un hueco largo entre clases</span>
            <select id="volverCasa">${[[0, 'Me quedo en la uni'], [120, 'Vuelvo a casa si es de 2 h o más'], [180, 'Vuelvo a casa si es de 3 h o más'], [240, 'Vuelvo a casa si es de 4 h o más']]
              .map(([m, t]) => `<option value="${m}" ${m === Number(R.volverCasa) ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <small>Si vuelves, contamos la vuelta y la nueva ida.</small></label>
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
  $('#next').onclick = () => {
    read();
    if (S.listo) { toast('Rutina guardada'); go('hoy'); return; }
    S.listo = true; save(); go('listo');
  };
}

/* ---------- bienvenida ---------- */
// Lo primero que ve alguien nuevo: qué es Quatri, qué hace por ti y qué tienes que hacer para dejarlo listo.
function viewBienvenida() {
  const c = UPC_COLORS;
  const demo = [
    ['08:00', '08:45', 'trayecto', 'Ida a la uni', ''],
    ['09:00', '11:00', 'clase', 'Física', 'Teoría · aula TR2 · 0.15', c[0]],
    ['11:00', '13:00', 'clase', 'Química', 'Laboratorio · semana A', c[5]],
    ['13:00', '13:45', 'trayecto', 'Vuelta a casa', ''],
    ['14:30', '15:30', 'rutina', 'Comida y descanso', ''],
    ['15:30', '17:45', 'libre', 'Libre · 2 h 15 min', 'Para estudiar lo que toca hoy'],
    ['18:00', '19:30', 'evento', 'Entreno', 'Lo añades tú · cada martes'],
  ];
  const v = $('#view');
  v.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Para estudiantes de la UPC · ESEIAAT</div>
      <h1 class="hero-t">Tu quatri,<br>bajo control<span class="dot">.</span></h1>
      <p class="lead">Quatri monta tu horario de la uni en dos minutos y te dice cuánto <b>tiempo libre te queda de verdad</b>: para estudiar, entrenar, trabajar o simplemente descansar.</p>
    </section>

    <div class="demo" aria-label="Ejemplo de un día en Quatri">
      <div class="demo-head"><span class="eyebrow">Ejemplo · un martes cualquiera</span><span class="pill free-pill">3 h 45 min libres de verdad</span></div>
      <ul class="timeline">${demo.map(([a, b, k, t, s, col]) => `
        <li class="it ${k}" style="${col ? `--c:${col[1]};--cb:${col[0]}` : k === 'evento' ? '--ev:#E8590C' : ''}"><span class="t">${a}<br><small>${b}</small></span>
        <span class="n"><b>${t}</b>${s ? `<small>${s}</small>` : ''}</span></li>`).join('')}</ul>
    </div>

    <h2 class="sec">Qué hace por ti</h2>
    <div class="feats">
      <div class="feat"><span class="num">01</span><div><b>Tu horario, sin teclear nada</b>
        <p>Clases, aulas, festivos y exámenes del horario oficial.</p></div></div>
      <div class="feat"><span class="num">02</span><div><b>Tu tiempo libre real</b>
        <p>Descontando trayectos, comidas y descansos.</p></div></div>
      <div class="feat"><span class="num">03</span><div><b>Tu vida también cuenta</b>
        <p>Entrenos, trabajo o planes, en el mismo sitio.</p></div></div>
      <div class="feat"><span class="num">04</span><div><b>Un plan de estudio a tu medida</b>
        <p>Cuántas horas dedicar a cada asignatura. Tú decides.</p></div></div>
    </div>

    <h2 class="sec">Cómo lo dejas listo</h2>
    <p class="lead" style="margin-bottom:10px">Cinco pasos, unos dos minutos. Lo puedes cambiar todo después.</p>
    <ol class="howto">
      <li><b>Tu grado</b><span>Para saber qué asignaturas y horarios cargar.</span></li>
      <li><b>Tus asignaturas</b><span>Las de este cuatrimestre, aunque sean de cursos distintos.</span></li>
      <li><b>Tus grupos</b><span>Tu subgrupo de laboratorio o problemas; la teoría se pone sola.</span></li>
      <li><b>Revisa tu semana</b><span>Ves tu horario y te avisamos si alguna clase se pisa.</span></li>
      <li><b>Tu día a día</b><span>Cuánto tardas en llegar, a qué hora comes, cenas y duermes.</span></li>
    </ol>

    <div class="trust">
      <span><i aria-hidden="true">✓</i>Gratis y sin anuncios</span>
      <span><i aria-hidden="true">✓</i>Sin cuenta: tus datos se quedan en tu móvil</span>
      <span><i aria-hidden="true">✓</i>Horarios oficiales del Visor d'Horaris UPC</span>
    </div>
    <p class="hint" style="margin-top:12px">Ahora mismo, Quatri tiene los horarios de la ESEIAAT (Terrassa) para el ${esc(D.periodo.curso.replace('-', '/'))} ${esc(D.periodo.q)}.</p>`;
  if (S.listo) {
    actions(`<span class="info">Así funciona Quatri</span><button class="btn primary" id="next">Volver</button>`);
    $('#next').onclick = () => go('ajustes');
  } else {
    actions(`<span class="info">Unos 2 minutos</span><button class="btn primary" id="next">Empezar</button>`);
    $('#next').onclick = () => go('grado');
  }
}

/* ---------- todo listo ---------- */
// Se ve una vez, al terminar el alta: lo que ya tienes y cómo se usa cada pestaña.
function viewListo() {
  const today = new Date(), mon = mondayOf(today);
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => dayPlan(dkey(addDays(mon, i))));
  const freeMin = week.reduce((n, p) => n + p.freeMin, 0), classMin = week.reduce((n, p) => n + p.classMin, 0);
  const tk = dkey(today);
  const ex = (S.asignaturas || []).flatMap(c => subj(c).e.filter(e => e[1] >= tk).map(e => ({ c, e })))
    .sort((a, b) => a.e[1].localeCompare(b.e[1]))[0];
  const exDays = ex ? Math.round((dparse(ex.e[1]) - dparse(tk)) / 864e5) : null;
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const tour = [
    ['◷', 'Hoy', 'Tu día hora a hora. Los huecos verdes son tiempo libre: tócalos para añadir algo. Desliza para cambiar de día.'],
    ['▦', 'Calendario', 'Tu semana y tu mes de un vistazo, con festivos, semanas A/B y exámenes.'],
    ['✎', 'Estudio', 'Dinos cómo llevas cada asignatura y te proponemos cuántas horas dedicarle esta semana.'],
    ['⚙', 'Ajustes', 'Cambia tu rutina, grupos o asignaturas cuando quieras, y elige modo claro u oscuro.'],
  ];
  const v = $('#view');
  v.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Todo listo</div>
      <h1 class="hero-t">Ya tienes<br>tu quatri<span class="dot">.</span></h1>
      <p class="lead">Tus clases, exámenes y rutina ya están dentro. Esto es lo que te queda esta semana:</p>
    </section>
    <div class="stats">
      <div class="stat free"><b>${dur(freeMin)}</b><span>libres de verdad esta semana</span></div>
      <div class="stat"><b>${classMin ? dur(classMin) : '—'}</b><span>de clase esta semana</span></div>
      ${ex ? `<div class="stat wide" style="${colorVars(ex.c)}"><b>${exDays === 0 ? 'Hoy' : exDays === 1 ? 'Mañana' : `${exDays} días`}</b><span>para tu próximo examen: ${esc(subj(ex.c).n)}</span></div>` : ''}
    </div>
    <h2 class="sec">Así se usa</h2>
    <div class="feats">
      ${tour.map(([ic, t, d]) => `<div class="feat"><span class="num ic" aria-hidden="true">${ic}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
      <div class="feat hi"><span class="num ic" aria-hidden="true">+</span><div><b>Añade tu vida</b>
        <p>Con el botón + apuntas entrenos, trabajo o planes. Si les pones trayecto, también lo descontamos de tu tiempo libre.</p></div></div>
    </div>
    ${installed ? '' : `<div class="notice warn" style="margin-top:14px"><b>Tenla a mano como una app.</b> ${ios
      ? 'En Safari, toca Compartir y luego «Añadir a pantalla de inicio».'
      : 'En el menú del navegador, elige «Instalar app» o «Añadir a pantalla de inicio».'}</div>`}`;
  actions(`<span class="info"></span><button class="btn primary" id="next">Ir a mi día</button>`);
  $('#next').onclick = () => { S.dia = dkey(new Date()); save(); go('hoy'); };
}

/* ---------- eventos propios ---------- */
const EV_TYPES = [['entreno', 'Entreno', '#E8590C'], ['trabajo', 'Trabajo', '#5F3DC4'], ['partido', 'Partido', '#C2255C'],
  ['plan', 'Plan', '#1971C2'], ['estudio', 'Estudio', '#0B7285'], ['otro', 'Otro', '#495057']];
const EV_NAME = Object.fromEntries(EV_TYPES.map(t => [t[0], t[1]]));
const evColor = tipo => (EV_TYPES.find(t => t[0] === tipo) || EV_TYPES[5])[2];
function eventsOn(ds) {
  const out = [], wd = (dparse(ds).getDay() + 6) % 7;
  for (const [id, ev] of Object.entries(S.eventos || {})) {
    let hit;
    if (ev.repite) hit = ds >= ev.fecha && (!ev.repite.hasta || ds <= ev.repite.hasta) && ev.repite.dias.includes(wd) && !(ev.excepciones || []).includes(ds);
    else hit = ev.fecha === ds;
    if (hit) out.push({ id, ev, s: ev.todoDia ? 0 : toMin(ev.ini), e: ev.todoDia ? 1440 : (ev.fin === '00:00' ? 1440 : toMin(ev.fin)) });
  }
  return out.sort((a, b) => a.s - b.s);
}
const newId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function openEvent(id, ds, sMin, eMin) {
  const ev = id ? S.eventos[id] : null;
  const F = { tipo: ev?.tipo || 'plan', dias: new Set(ev?.repite?.dias || []) };
  const s0 = sMin ?? 17 * 60, e0 = eMin ?? Math.min(s0 + 60, 23 * 60 + 55);
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `
    <form class="sheet" novalidate>
      <header><h2>${ev ? 'Editar evento' : 'Nuevo evento'}</h2><button type="button" class="icon" data-x aria-label="Cerrar">×</button></header>
      <label class="field"><span>Qué es</span><input id="evT" maxlength="60" placeholder="Ej.: Entreno en pista" value="${esc(ev?.titulo || '')}" autocomplete="off"></label>
      <div class="field"><span>Tipo</span><div class="evtypes">${EV_TYPES.map(([k, n, c]) => `<button type="button" data-t="${k}" style="--ev:${c}" aria-pressed="${F.tipo === k}">${n}</button>`).join('')}</div></div>
      <label class="field"><span>Día</span><input type="date" id="evD" value="${ev?.fecha || ds}"></label>
      <label class="check"><input type="checkbox" id="evAll" ${ev?.todoDia ? 'checked' : ''}> Todo el día</label>
      <div class="fields" id="evTimes" ${ev?.todoDia ? 'hidden' : ''}>
        <label class="field"><span>Empieza</span><input type="time" id="evI" step="300" value="${ev?.ini || fmt(s0)}"></label>
        <label class="field"><span>Acaba</span><input type="time" id="evF" step="300" value="${ev?.fin || fmt(e0 % 1440)}"></label>
        <label class="field wide"><span>Tardas en llegar</span><select id="evTr">${[0, 5, 10, 15, 20, 25, 30, 40, 45, 60, 75, 90].map(m => `<option value="${m}" ${Number(ev?.trayecto || 0) === m ? 'selected' : ''}>${m ? dur(m) : 'Es en casa / no cuenta'}</option>`).join('')}</select><small>Se añade la ida antes y la vuelta después.</small></label>
      </div>
      <label class="check"><input type="checkbox" id="evRep" ${ev?.repite ? 'checked' : ''}> Se repite cada semana</label>
      <div id="evRepBox" class="stack" ${ev?.repite ? '' : 'hidden'}>
        <div class="evdays">${DAYS_SHORT.map((d, i) => `<button type="button" data-d="${i}" aria-pressed="${F.dias.has(i)}">${d}</button>`).join('')}</div>
        <label class="field"><span>Hasta (opcional)</span><input type="date" id="evH" value="${ev?.repite?.hasta || ''}"></label>
      </div>
      <label class="field"><span>Lugar (opcional)</span><input id="evL" maxlength="60" value="${esc(ev?.lugar || '')}" autocomplete="off"></label>
      <p class="err" id="evErr" hidden></p>
      <div class="confirm" id="evConf" hidden></div>
      <footer>
        ${ev ? '<button type="button" class="btn danger" id="evDel">Eliminar</button>' : ''}
        <span class="sp"></span>
        <button type="button" class="btn" data-x>Cancelar</button>
        <button type="submit" class="btn primary">Guardar</button>
      </footer>
    </form>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden'; // la página de detrás no se mueve mientras el formulario está abierto
  const q = s => ov.querySelector(s);
  const close = () => { ov.remove(); document.body.style.overflow = ''; };
  ov.querySelectorAll('[data-x]').forEach(b => b.onclick = close);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { F.tipo = b.dataset.t; ov.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  ov.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const i = +b.dataset.d; F.dias.has(i) ? F.dias.delete(i) : F.dias.add(i); b.setAttribute('aria-pressed', String(F.dias.has(i))); });
  q('#evAll').onchange = () => { q('#evTimes').hidden = q('#evAll').checked; };
  q('#evRep').onchange = () => {
    q('#evRepBox').hidden = !q('#evRep').checked;
    if (q('#evRep').checked && !F.dias.size && q('#evD').value) { const i = wdOf(dparse(q('#evD').value)); F.dias.add(i); q(`[data-d="${i}"]`).setAttribute('aria-pressed', 'true'); }
  };
  const err = m => { q('#evErr').textContent = m; q('#evErr').hidden = false; };
  q('form').onsubmit = e => {
    e.preventDefault();
    const titulo = q('#evT').value.trim(), fecha = q('#evD').value, todoDia = q('#evAll').checked;
    const ini = q('#evI').value, fin = q('#evF').value;
    if (!titulo) return err('Ponle un nombre, por ejemplo "Entreno" o "Trabajo".');
    if (!fecha) return err('Elige el día.');
    if (!todoDia && (!ini || !fin)) return err('Indica la hora de inicio y de fin.');
    if (!todoDia && fin !== '00:00' && toMin(fin) <= toMin(ini)) return err('La hora de fin tiene que ser posterior a la de inicio.');
    const data = { titulo, tipo: F.tipo, fecha, todoDia, ini: todoDia ? '' : ini, fin: todoDia ? '' : fin,
      trayecto: todoDia ? 0 : Number(q('#evTr').value), lugar: q('#evL').value.trim(), repite: null, excepciones: ev?.excepciones || [] };
    if (q('#evRep').checked) {
      if (!F.dias.size) return err('Elige al menos un día de la semana.');
      const hasta = q('#evH').value;
      if (hasta && hasta < fecha) return err('La fecha "hasta" tiene que ser posterior al primer día.');
      data.repite = { dias: [...F.dias].sort(), hasta };
    } else data.excepciones = [];
    S.eventos = S.eventos || {};
    S.eventos[id || newId()] = data;
    save(); close(); toast(id ? 'Evento actualizado' : 'Evento guardado'); render();
  };
  if (q('#evDel')) q('#evDel').onclick = () => {
    const c = q('#evConf'); c.hidden = false;
    const one = ev.repite && ds;
    c.innerHTML = ev.repite
      ? `<span>Se repite cada semana. ¿Qué quieres eliminar?</span><div class="row">
          ${one ? `<button type="button" class="btn" id="dOne">Solo el ${dparse(ds).getDate()}/${dparse(ds).getMonth() + 1}</button>` : ''}
          <button type="button" class="btn danger" id="dAll">Toda la serie</button><button type="button" class="btn" id="dNo">Cancelar</button></div>`
      : `<span>¿Eliminar «${esc(ev.titulo)}»?</span><div class="row"><button type="button" class="btn danger" id="dAll">Sí, eliminar</button><button type="button" class="btn" id="dNo">Cancelar</button></div>`;
    q('#dNo').onclick = () => { c.hidden = true; };
    q('#dAll').onclick = () => { delete S.eventos[id]; save(); close(); toast('Evento eliminado'); render(); };
    if (q('#dOne')) q('#dOne').onclick = () => { ev.excepciones = [...new Set([...(ev.excepciones || []), ds])]; save(); close(); toast('Eliminado solo ese día'); render(); };
  };
  setTimeout(() => { if (!ev) q('#evT').focus(); }, 50);
}
/* ---------- rutina de un día concreto ---------- */
// Cambia comidas, descansos o la hora de levantarte solo para ese día; lo habitual sigue en Ajustes → Mi rutina.
function openRutinaDia(ds, focus) {
  const R = { ...RUTINA_DEF, ...(S.rutina || {}) }, p = dayPlan(ds), d = dparse(ds);
  const had = (S.diaRutina || {})[ds];
  const cur = k => p.blocks.find(b => b.rk === k);
  const com = cur('comida');
  const defs = {
    despertar: [fmt(p.wake % 1440), Number(R.prep)],
    comida: [R.comida, Number(R.comidaDur)],
    descanso: [com ? fmt(com.e % 1440) : R.comida, Number(R.descanso) || 30],
    merienda: [R.meriendaHora, 30],
    cena: [R.cena, Number(R.cenaDur)],
  };
  const durs = [15, 30, 45, 60, 75, 90, 120];
  const rows = Object.keys(RUT_LABEL).map(k => {
    const b = cur(k), on = !!b, ini = b ? fmt(b.s % 1440) : defs[k][0], du = b ? b.e - b.s : defs[k][1];
    const opts = [...new Set([...durs, du])].sort((a, z) => a - z);
    return `<div class="rrow${focus === k ? ' focus' : ''}" data-k="${k}">
      ${k === 'despertar' ? `<b class="rname">${RUT_LABEL[k]}</b>` : `<label class="check"><input type="checkbox" data-on ${on ? 'checked' : ''}> <b>${RUT_LABEL[k]}</b></label>`}
      <div class="fields" ${on ? '' : 'hidden'}>
        <label class="field"><span>A las</span><input type="time" data-ini step="300" value="${ini}"></label>
        <label class="field"><span>Dura</span><select data-dur>${opts.map(m => `<option value="${m}" ${m === du ? 'selected' : ''}>${dur(m)}</option>`).join('')}</select></label>
      </div></div>`;
  }).join('');
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `
    <form class="sheet" novalidate>
      <header><h2>Tu rutina del ${DAYS[wdOf(d)].toLowerCase()} ${d.getDate()}</h2><button type="button" class="icon" data-x aria-label="Cerrar">×</button></header>
      <p class="hint" style="margin:0">Solo cambia este día. Lo de siempre se edita en Ajustes → Mi rutina.</p>
      <div class="stack">${rows}</div>
      <footer>
        ${had ? '<button type="button" class="btn" id="rReset">Volver a lo habitual</button>' : ''}
        <span class="sp"></span>
        <button type="button" class="btn" data-x>Cancelar</button>
        <button type="submit" class="btn primary">Guardar</button>
      </footer>
    </form>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const q = s => ov.querySelector(s);
  const close = () => { ov.remove(); document.body.style.overflow = ''; };
  ov.querySelectorAll('[data-x]').forEach(b => b.onclick = close);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  const dirty = new Set();
  ov.querySelectorAll('.rrow').forEach(r => {
    r.querySelectorAll('input,select').forEach(el => el.addEventListener('change', () => {
      dirty.add(r.dataset.k);
      const on = r.querySelector('[data-on]');
      if (on) r.querySelector('.fields').hidden = !on.checked;
    }));
  });
  if (q('#rReset')) q('#rReset').onclick = () => { delete S.diaRutina[ds]; save(); close(); toast('Este día vuelve a tu rutina de siempre'); render(); };
  q('form').onsubmit = e => {
    e.preventDefault();
    if (!dirty.size) { close(); return; }
    const O = { ...(had || {}) };
    for (const k of dirty) {
      const r = q(`.rrow[data-k="${k}"]`), on = r.querySelector('[data-on]');
      if (on && !on.checked) O[k] = { off: true };
      else O[k] = { ini: r.querySelector('[data-ini]').value || defs[k][0], dur: Number(r.querySelector('[data-dur]').value) };
    }
    S.diaRutina = S.diaRutina || {};
    S.diaRutina[ds] = O;
    save(); close(); toast('Cambiado solo para este día'); render();
  };
  setTimeout(() => { const f = q('.rrow.focus'); if (f) f.scrollIntoView({ block: 'nearest' }); }, 50);
}

function fab(ds) {
  let b = $('#fab');
  if (!b) { b = document.createElement('button'); b.id = 'fab'; b.className = 'fab'; b.setAttribute('aria-label', 'Nuevo evento'); b.textContent = '+'; document.body.appendChild(b); }
  b.hidden = false;
  b.onclick = () => openEvent(null, ds());
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
    // huecos largos entre clases: si el alumno vuelve a casa, son dos trayectos más
    const VC = Number(R.volverCasa) || 0;
    if (VC) {
      const uni = blocks.filter(b => b.kind === 'clase' || b.kind === 'examen').sort((a, b) => a.s - b.s);
      let end = uni[0].e;
      for (const b of uni.slice(1)) {
        const gap = b.s - end;
        if (gap >= VC && gap >= 2 * T + 30) {
          blocks.push({ s: end, e: end + T, kind: 'trayecto', label: 'Vuelta a casa' });
          blocks.push({ s: b.s - T, e: b.s, kind: 'trayecto', label: 'Ida a la uni' });
        }
        end = Math.max(end, b.e);
      }
    }
    wake = first - T - P;
  } else wake = toMin(R.despertarLibre);
  // eventos propios del alumno (entrenos, trabajo, planes...) y sus trayectos
  const evs = eventsOn(ds);
  const allDay = evs.filter(x => x.ev.todoDia);
  for (const x of evs.filter(x => !x.ev.todoDia)) {
    const Te = Number(x.ev.trayecto) || 0;
    blocks.push({ s: x.s, e: x.e, kind: 'evento', id: x.id, tipo: x.ev.tipo, label: x.ev.titulo,
      sub: [EV_NAME[x.ev.tipo], x.ev.lugar, x.ev.repite ? 'cada semana' : ''].filter(Boolean).join(' · ') });
    if (Te) {
      blocks.push({ s: x.s - Te, e: x.s, kind: 'trayecto', label: `Ida · ${x.ev.titulo}` });
      blocks.push({ s: x.e, e: x.e + Te, kind: 'trayecto', label: `Vuelta · ${x.ev.titulo}` });
    }
  }
  // si algo empieza antes de lo habitual, te levantas antes
  if (blocks.length) wake = Math.min(wake, Math.min(...blocks.map(b => b.s)) - P);
  // cambios de rutina solo para este día (comer fuera, merendar antes...): mandan sobre lo habitual
  const O = (S.diaRutina || {})[ds] || {};
  let wakeLen = P;
  if (O.despertar && !O.despertar.off) { wake = toMin(O.despertar.ini); wakeLen = Number(O.despertar.dur); }
  blocks.push({ s: wake, e: wake + wakeLen, kind: 'rutina', label: RUT_LABEL.despertar, rk: 'despertar', mod: !!O.despertar });
  const fixed = k => { const o = O[k]; if (!o || o.off) return null;
    const b = { s: toMin(o.ini), e: toMin(o.ini) + Number(o.dur), kind: 'rutina', label: RUT_LABEL[k], rk: k, mod: true }; blocks.push(b); return b; };
  const fx = { comida: fixed('comida'), descanso: fixed('descanso'), merienda: fixed('merienda'), cena: fixed('cena') };
  // maxShift: cuánto se puede retrasar como mucho (la merienda no tiene sentido a las 22:00)
  const place = (start, len, label, kind = 'rutina', maxShift = Infinity, rk = null) => {
    let t = start, moved = true;
    while (moved) { moved = false; for (const b of blocks) if (t < b.e && b.s < t + len) { t = b.e; moved = true; } }
    if (t + len > sleep || t - start > maxShift) return null;
    const b = { s: t, e: t + len, kind, label, rk }; blocks.push(b); return b;
  };
  const com = O.comida ? fx.comida : place(toMin(R.comida), Number(R.comidaDur), RUT_LABEL.comida, 'rutina', Infinity, 'comida');
  if (!O.descanso && com && Number(R.descanso)) place(com.e, Number(R.descanso), RUT_LABEL.descanso, 'rutina', Infinity, 'descanso');
  // la merienda va antes de la cena, así que si no cabe cerca de su hora ese día se salta
  if (!O.merienda && R.merienda) place(toMin(R.meriendaHora), 30, RUT_LABEL.merienda, 'rutina', 90, 'merienda');
  const cen = O.cena ? fx.cena : place(toMin(R.cena), Number(R.cenaDur), RUT_LABEL.cena, 'rutina', Infinity, 'cena');
  if (cen && !R.estudiaNoche && cen.e < sleep) blocks.push({ s: cen.e, e: sleep, kind: 'noche', label: 'Desconexión', sub: 'Después de cenar no cuenta para estudiar' });
  blocks.sort((a, b) => a.s - b.s || a.e - b.e);
  // huecos libres entre levantarte y dormir
  const free = []; let t = wake;
  for (const b of blocks) { if (b.s - t >= 15) free.push({ s: t, e: b.s, kind: 'libre' }); t = Math.max(t, b.e); }
  if (sleep - t >= 15) free.push({ s: t, e: sleep, kind: 'libre' });
  return { info, blocks, free, wake, sleep, allDay, freeMin: free.reduce((n, f) => n + f.e - f.s, 0),
    classMin: blocks.filter(b => b.kind === 'clase').reduce((n, b) => n + b.e - b.s, 0) };
}

/* ---------- Tu día ---------- */
function viewHoy() {
  S.dia = S.dia || dkey(new Date());
  const ds = S.dia, p = dayPlan(ds), d = p.info.d, today = dkey(new Date());
  const rel = ds === today ? 'Hoy' : ds === dkey(addDays(new Date(), 1)) ? 'Mañana' : ds === dkey(addDays(new Date(), -1)) ? 'Ayer' : DAYS[p.info.wd];
  const items = [...p.blocks, ...p.free].sort((a, b) => a.s - b.s);
  const row = it => {
    const style = it.kind === 'clase' || it.kind === 'examen' ? `${colorVars(it.code)}` : it.kind === 'evento' ? `--ev:${evColor(it.tipo)}` : '';
    const label = it.kind === 'libre' ? `Libre · ${dur(it.e - it.s)}` : esc(it.label);
    const data = it.kind === 'evento' ? `data-ev="${it.id}"` : it.kind === 'libre' ? `data-free="${it.s},${it.e}"` : it.rk ? `data-rut="${it.rk}"` : '';
    return `<li class="it ${it.kind}${it.mod ? ' mod' : ''}" style="${style}" ${data}><span class="t">${fmt(it.s % 1440)}<br><small>${fmt(it.e % 1440)}</small></span>
      <span class="n"><b>${label}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}${it.kind === 'libre' ? '<small>Toca para añadir algo aquí</small>' : ''}${it.mod ? '<small>Cambiado solo este día</small>' : ''}</span></li>`;
  };
  const v = $('#view');
  v.innerHTML = `
    <div class="dayhead">
      <button class="icon" id="prev" aria-label="Día anterior">‹</button>
      <div class="dh"><div class="eyebrow">${rel}${p.info.week ? ` · semana ${p.info.week}` : ''}</div>
        <h1>${DAYS[p.info.wd]} ${d.getDate()} de ${MONTHS[d.getMonth()]}</h1>
        ${ds !== today ? '<button class="todaybtn" id="today">Volver a hoy</button>' : ''}</div>
      <button class="icon" id="next" aria-label="Día siguiente">›</button>
    </div>
    <div class="stats">
      <div class="stat free"><b>${dur(p.freeMin)}</b><span>libres de verdad</span></div>
      <div class="stat"><b>${p.classMin ? dur(p.classMin) : '—'}</b><span>de clase</span></div>
    </div>
    ${p.info.note ? `<div class="notice warn" style="margin-top:12px">${esc(p.info.note)}</div>` : ''}
    ${p.allDay.map(x => `<div class="allday" style="--ev:${evColor(x.ev.tipo)}" data-ev="${x.id}"><b>${esc(x.ev.titulo)}</b><small>Todo el día${x.ev.lugar ? ' · ' + esc(x.ev.lugar) : ''}</small></div>`).join('')}
    <ul class="timeline">${items.map(row).join('')}</ul>`;
  const shift = n => { S.dia = dkey(addDays(dparse(S.dia), n)); save(); viewHoy(); };
  $('#prev').onclick = () => slideTo(v, -1, shift);
  $('#next').onclick = () => slideTo(v, 1, shift);
  if ($('#today')) $('#today').onclick = () => slideTo(v, ds > today ? -1 : 1, () => { S.dia = today; save(); viewHoy(); });
  v.querySelectorAll('[data-ev]').forEach(el => el.onclick = () => openEvent(el.dataset.ev, ds));
  v.querySelectorAll('[data-rut]').forEach(el => el.onclick = () => openRutinaDia(ds, el.dataset.rut));
  v.querySelectorAll('[data-free]').forEach(el => el.onclick = () => {
    const [a, b] = el.dataset.free.split(',').map(Number);
    openEvent(null, ds, Math.ceil(a / 15) * 15, Math.min(Math.ceil(a / 15) * 15 + 60, b));
  });
  // línea roja con la hora actual (solo en el día de hoy); se mueve cada minuto
  clearInterval(viewHoy.t);
  if (ds === today) {
    const ul = $('.timeline', v);
    const putNow = () => {
      if (!document.body.contains(ul)) { clearInterval(viewHoy.t); return; }
      ul.querySelectorAll('.nowline,.nowrow').forEach(e => e.remove());
      const n = new Date(); let nm = n.getHours() * 60 + n.getMinutes();
      if (nm < p.wake && nm + 1440 < p.sleep + 1) nm += 1440; // pasada la medianoche, antes de dormir
      const lis = [...ul.children];
      let k = -1; items.forEach((it, i) => { if (it.s <= nm && nm < it.e) k = i; });
      if (k >= 0) {
        const it = items[k];
        lis[k].insertAdjacentHTML('beforeend', `<i class="nowline" style="top:${((nm - it.s) / (it.e - it.s) * 100).toFixed(1)}%"></i>`);
      } else {
        const row = '<li class="nowrow" aria-hidden="true"><i class="nowline"></i></li>';
        const j = items.findIndex(it => it.s > nm);
        if (j >= 0) lis[j].insertAdjacentHTML('beforebegin', row); else ul.insertAdjacentHTML('beforeend', row);
      }
    };
    putNow();
    viewHoy.t = setInterval(putNow, 60000);
  }
  swipe(v, shift);
  tabs('hoy');
  fab(() => S.dia);
}
// Deslizar el dedo a izquierda/derecha: la página sigue al dedo y, si pasas el umbral,
// sale por un lado y la nueva entra por el otro (día o semana siguiente/anterior).
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function slideTo(el, n, fn) {
  if (reduceMotion()) { fn(n); return; }
  const w = el.offsetWidth || window.innerWidth;
  el.style.transition = 'transform .17s ease-in, opacity .17s ease-in';
  el.style.transform = `translateX(${n > 0 ? -w * 0.6 : w * 0.6}px)`;
  el.style.opacity = '0';
  setTimeout(() => {
    fn(n);
    el.style.transition = 'none';
    el.style.transform = `translateX(${n > 0 ? w * 0.45 : -w * 0.45}px)`;
    el.style.opacity = '0';
    void el.offsetWidth; // aplica la posición de entrada antes de animar
    el.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1), opacity .24s ease-out';
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
  }, 170);
}
function swipe(el, fn) {
  el._swipe = fn;
  if (el.dataset.sw) return; el.dataset.sw = 1;
  let x0 = null, y0 = 0, t0 = 0, lock = null, dx = 0;
  const reset = (anim = true) => {
    el.style.transition = anim ? 'transform .2s ease-out, opacity .2s ease-out' : 'none';
    el.style.transform = 'translateX(0)'; el.style.opacity = '1';
  };
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || !el._swipe) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); lock = null; dx = 0;
    el.style.transition = 'none';
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (x0 == null) return;
    dx = e.touches[0].clientX - x0; const dy = e.touches[0].clientY - y0;
    if (!lock && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (lock !== 'x') return;
    e.preventDefault(); // en horizontal, la página no se desplaza arriba/abajo
    if (!reduceMotion()) { el.style.transform = `translateX(${dx * 0.85}px)`; el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 500)); }
  }, { passive: false });
  el.addEventListener('touchend', () => {
    if (x0 == null || !el._swipe) return; x0 = null;
    const fast = Math.abs(dx) > 40 && Date.now() - t0 < 300;
    if (lock === 'x' && (Math.abs(dx) > 70 || fast)) slideTo(el, dx < 0 ? 1 : -1, el._swipe);
    else reset();
  }, { passive: true });
  el.addEventListener('touchcancel', () => { x0 = null; reset(); }, { passive: true });
}

/* ---------- pestañas ---------- */
function tabs(active) {
  const t = [['hoy', 'Hoy', '◷'], ['calendario', 'Calendario', '▦'], ['estudio', 'Estudio', '✎'], ['ajustes', 'Ajustes', '⚙']];
  actions(`<nav class="tabs">${t.map(([id, label, ic]) => `<button data-tab="${id}" aria-current="${id === active ? 'page' : 'false'}"><span aria-hidden="true">${ic}</span>${label}</button>`).join('')}</nav>`);
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    // tocar la pestaña en la que ya estás te devuelve a hoy / esta semana
    if (b.dataset.tab === active && active === 'hoy') { S.dia = dkey(new Date()); save(); viewHoy(); return; }
    if (b.dataset.tab === active && active === 'estudio') { S.semana = dkey(mondayOf(new Date())); save(); viewEstudio(); return; }
    if (b.dataset.tab === active && active === 'calendario') { calToday(); viewCalendario(); return; }
    go(b.dataset.tab);
  });
}

/* ---------- calendario: semana y mes ---------- */
const DOW1 = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
// Abreviaturas cortas para los bloques que no son clases (caben en una columna estrecha del móvil)
const ABBR = { 'Ida a la uni': ['Ida', 'Ida'], 'Vuelta a casa': ['Vuelta', 'Vuelta'], 'Levantarte y desayunar': ['Desayuno', 'Desay.'],
  'Comida': ['Comida', 'Comida'], 'Descanso': ['Descanso', 'Desc.'], 'Merienda y pausa': ['Merienda', 'Mer.'], 'Cena': ['Cena', 'Cena'], 'Desconexión': ['Noche', 'Noche'] };
const abbr = label => { const a = ABBR[label]; return a ? a[window.innerWidth < 600 ? 1 : 0] : label.split(' ')[0]; };
function calToday() {
  const now = new Date();
  S.calSemana = dkey(mondayOf(now));
  S.calMes = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  save();
}
function viewCalendario() {
  if (!S.calSemana || !S.calMes) calToday();
  S.calVista = S.calVista || 'semana';
  const v = $('#view');
  const isWeek = S.calVista === 'semana';
  const now = new Date(), thisMon = dkey(mondayOf(now)), thisMes = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  let title, eyebrow, atToday;
  if (isWeek) {
    const mon = dparse(S.calSemana), sun = addDays(mon, 6), wt = weekType(S.calSemana) || weekType(dkey(addDays(mon, 2)));
    title = `${mon.getDate()} ${MONTHS[mon.getMonth()].slice(0, 3)} – ${sun.getDate()} ${MONTHS[sun.getMonth()].slice(0, 3)}`;
    eyebrow = `${S.calSemana === thisMon ? 'Esta semana' : 'Semana'}${wt ? ` · semana ${wt}` : ''}`;
    atToday = S.calSemana === thisMon;
  } else {
    const [y, m] = S.calMes.split('-').map(Number);
    title = `${MONTHS[m - 1].charAt(0).toUpperCase() + MONTHS[m - 1].slice(1)} ${y}`;
    eyebrow = S.calMes === thisMes ? 'Este mes' : 'Mes';
    atToday = S.calMes === thisMes;
  }
  v.innerHTML = `
    <div class="seg2" role="group" aria-label="Vista">
      <button data-vista="semana" aria-pressed="${isWeek}">Semana</button>
      <button data-vista="mes" aria-pressed="${!isWeek}">Mes</button>
    </div>
    <div class="dayhead">
      <button class="icon" id="prev" aria-label="Anterior">‹</button>
      <div class="dh"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>
        ${atToday ? '' : `<button class="todaybtn" id="back">${isWeek ? 'Volver a esta semana' : 'Volver a este mes'}</button>`}</div>
      <button class="icon" id="next" aria-label="Siguiente">›</button>
    </div>
    ${isWeek ? calWeek() : calMonth()}`;
  const shift = n => {
    if (isWeek) S.calSemana = dkey(addDays(dparse(S.calSemana), 7 * n));
    else { const [y, m] = S.calMes.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); S.calMes = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
    save(); viewCalendario();
  };
  $('#prev').onclick = () => slideTo(v, -1, shift);
  $('#next').onclick = () => slideTo(v, 1, shift);
  if ($('#back')) $('#back').onclick = () => {
    const ahead = isWeek ? S.calSemana > thisMon : S.calMes > thisMes;
    slideTo(v, ahead ? -1 : 1, () => { calToday(); viewCalendario(); });
  };
  v.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => {
    if (b.dataset.vista === S.calVista) return;
    // al cambiar de vista, mantener la fecha: la semana pasa a su mes y el mes a su primera semana (o la actual)
    if (b.dataset.vista === 'mes') { const d = addDays(dparse(S.calSemana), 3); S.calMes = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
    else S.calSemana = S.calMes === thisMes ? thisMon : dkey(mondayOf(dparse(S.calMes + '-01')));
    S.calVista = b.dataset.vista; save(); viewCalendario();
  });
  v.querySelectorAll('[data-day]').forEach(el => el.onclick = e => {
    if (e.target.closest('.cblk')) return;
    S.dia = el.dataset.day; save(); go('hoy');
  });
  v.querySelectorAll('.cblk').forEach(b => b.onclick = e => {
    e.stopPropagation();
    if (b.dataset.evid) return openEvent(b.dataset.evid, b.dataset.ds);
    if (b.dataset.free) { const [a, z] = b.dataset.free.split(',').map(Number), s = Math.ceil(a / 15) * 15; return openEvent(null, b.dataset.ds, s, Math.min(s + 60, z)); }
    toast(b.dataset.info);
  });
  fab(() => {
    const t = dkey(new Date());
    if (isWeek) return t >= S.calSemana && t <= dkey(addDays(dparse(S.calSemana), 6)) ? t : S.calSemana;
    return t.startsWith(S.calMes) ? t : S.calMes + '-01';
  });
  const rt = $('#rutinaToggle');
  if (rt) rt.onchange = () => { S.calRutina = rt.checked; save(); viewCalendario(); };
  swipe(v, shift);
  tabs('calendario');
}

function calWeek() {
  const mon = dparse(S.calSemana), today = dkey(new Date());
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => { const ds = dkey(addDays(mon, i)); return { ds, p: dayPlan(ds) }; });
  const showRut = !!S.calRutina;
  let h0 = 24, h1 = 0;
  for (const { p } of days) {
    const items = showRut ? [...p.blocks, ...p.free] : [...p.blocks.filter(b => b.kind === 'clase' || b.kind === 'examen' || b.kind === 'evento'), ...p.free];
    for (const b of items) { h0 = Math.min(h0, Math.floor(b.s / 60)); h1 = Math.max(h1, Math.ceil(b.e / 60)); }
  }
  if (h0 >= h1) { h0 = 8; h1 = 22; }
  const hpx = window.innerWidth < 600 ? 34 : 42, px = m => (m - h0 * 60) / 60 * hpx, H = (h1 - h0) * hpx;
  const narrow = window.innerWidth < 600;
  const freeWeek = days.reduce((n, d) => n + d.p.freeMin, 0);
  const cols = days.map(({ ds, p }) => {
    const items = [];
    for (const f of p.free) if (f.e - f.s >= 30) items.push({ ...f });
    for (const b of p.blocks) if (b.kind === 'clase' || b.kind === 'examen' || b.kind === 'evento' || showRut) items.push(b);
    const html = items.map(b => {
      const top = px(b.s), h = Math.max(px(b.e) - top - 1, 6);
      if (b.kind === 'libre') {
        const d = dur(b.e - b.s).replace(' min', 'm').replace(' h', 'h').replace(' ', '');
        return `<div class="cblk libre" style="top:${top}px;height:${h}px" data-free="${b.s},${b.e}" data-ds="${ds}">${h >= 13 ? `<b>Libre</b>` : ''}${h >= 26 ? `<small>${d}</small>` : ''}</div>`;
      }
      if (b.kind === 'evento') return `<div class="cblk evento" style="--ev:${evColor(b.tipo)};top:${top}px;height:${h}px" data-evid="${b.id}" data-ds="${ds}">
          <b>${esc(b.label.split(' ')[0].slice(0, 9))}</b>${h > 24 ? `<small>${fmt(b.s % 1440)}</small>` : ''}</div>`;
      if (b.kind === 'clase' || b.kind === 'examen') {
        const a = subj(b.code), ex = b.kind === 'examen';
        const tipo = ex ? 'EX' : (b.sub || '').charAt(0);
        return `<div class="cblk ${b.kind}" style="${colorVars(b.code)};top:${top}px;height:${h}px" data-info="${esc(b.label)} · ${fmt(b.s)}–${fmt(b.e)}${b.sub ? ' · ' + esc(b.sub) : ''}">
          <b>${esc(a.s)}</b>${h > 24 ? `<small>${ex ? 'Examen' : esc(tipo)}</small>` : ''}</div>`;
      }
      return `<div class="cblk rut ${b.kind}" style="top:${top}px;height:${h}px" data-info="${esc(b.label)} · ${fmt(b.s % 1440)}–${fmt(b.e % 1440)}">${h >= 12 ? `<b>${esc(abbr(b.label))}</b>` : ''}</div>`;
    }).join('');
    const nolect = p.info.wd < 5 && !p.info.lective;
    return `<div class="ccol ${ds === today ? 'is-today' : ''} ${p.info.wd > 4 ? 'we' : ''} ${nolect ? 'nolect' : ''}" data-day="${ds}" style="height:${H}px;--hpx:${hpx}px">${html}</div>`;
  }).join('');
  const heads = days.map(({ ds, p }) => {
    const d = p.info.d;
    return `<div class="chead ${ds === today ? 'is-today' : ''}" data-day="${ds}"><span>${narrow ? DOW1[p.info.wd] : DAYS_SHORT[p.info.wd]}</span><b>${d.getDate()}</b>
      <small>${p.freeMin ? dur(p.freeMin).replace(' min', 'm').replace(' h', 'h') : '—'}</small></div>`;
  }).join('');
  let hours = ''; for (let h = h0 + 1; h < h1; h++) hours += `<span style="top:${(h - h0) * hpx}px">${h}</span>`;
  let nowLine = '';
  const nowD = new Date(), ti = days.findIndex(x => x.ds === today), nm = nowD.getHours() * 60 + nowD.getMinutes();
  if (ti >= 0 && nm >= h0 * 60 && nm <= h1 * 60) nowLine = `<div class="cnow" style="top:${px(nm)}px;left:calc(30px + (100% - 30px) / 7 * ${ti});width:calc((100% - 30px) / 7)"></div>`;
  return `
    <div class="calbar">
      <span class="pill free-pill"><b>${dur(freeWeek)}</b> libres esta semana</span>
      <label class="check small"><input type="checkbox" id="rutinaToggle" ${showRut ? 'checked' : ''}> Ver rutina</label>
    </div>
    <div class="cweek">
      <div class="cgrid chead-row"><div></div>${heads}</div>
      <div class="cgrid cbody"><div class="chours" style="height:${H}px">${hours}</div>${cols}${nowLine}</div>
    </div>
    <p class="hint" style="margin-top:10px">En verde, tus huecos libres de al menos 30 min. Toca un bloque para ver el detalle o un día para abrirlo.</p>`;
}

function calMonth() {
  const [y, m] = S.calMes.split('-').map(Number);
  const first = new Date(y, m - 1, 1), start = mondayOf(first), today = dkey(new Date());
  const codes = S.asignaturas || [];
  const cells = [], events = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i % 7 === 0 && i > 0 && d > new Date(y, m, 0)) break; // la última fila llega hasta el domingo
    const ds = dkey(d), info = dayInfo(ds), inMonth = d.getMonth() === m - 1;
    const classCodes = info.lective ? [...new Set(mySessions().filter(s => s.x[0] === info.wd && (!(s.x[5] && s.x[5].length === 1) || s.x[5] === info.week)).map(s => s.code))] : [];
    const exams = codes.flatMap(c => subj(c).e.filter(e => e[1] === ds).map(e => ({ c, e })));
    const nolect = info.wd < 5 && !info.lective;
    if (inMonth) {
      for (const { c, e } of exams) events.push({ ds, kind: 'examen', c, txt: `${e[0] === 'final' ? 'Final' : 'Parcial'} · ${subj(c).n}`, sub: `${e[2]}–${e[3]}` });
      if (nolect && (D.calendario.dias_sin_clase || []).includes(ds)) {
        // días sin clase seguidos (saltando el fin de semana) se juntan en un solo aviso
        const pp = D.calendario.periodo_parciales, parc = pp && ds >= pp[0] && ds <= pp[1];
        const txt = parc ? 'Sin clases (exámenes parciales)' : 'Sin clases';
        const last = [...events].reverse().find(ev => ev.kind === 'festivo');
        const gap = last ? (dparse(ds) - dparse(last.hasta || last.ds)) / 864e5 : 99;
        if (last && last.txt === txt && (gap === 1 || (gap <= 3 && info.wd === 0))) last.hasta = ds;
        else events.push({ ds, kind: 'festivo', txt });
      }
    }
    const wk = info.wd === 0 ? weekType(ds) || weekType(dkey(addDays(d, 2))) : null;
    cells.push(`<button class="mcell ${inMonth ? '' : 'out'} ${ds === today ? 'is-today' : ''} ${nolect ? 'nolect' : ''} ${info.wd > 4 ? 'we' : ''}" data-day="${ds}" aria-label="${DAYS[info.wd]} ${d.getDate()}">
      <span class="mnum">${d.getDate()}${wk ? `<i class="wkab">${wk}</i>` : ''}</span>
      ${nolect && !exams.length ? `<span class="mtag">${(D.calendario.periodo_parciales && ds >= D.calendario.periodo_parciales[0] && ds <= D.calendario.periodo_parciales[1]) ? 'Parciales' : (D.calendario.periodo_finales && ds >= D.calendario.periodo_finales[0] && ds <= D.calendario.periodo_finales[1]) ? 'Finales' : 'Sin clase'}</span>` : ''}
      ${exams.length ? exams.map(({ c }) => `<span class="mex" style="${colorVars(c)}">${esc(subj(c).s)}</span>`).join('') : ''}
      ${eventsOn(ds).slice(0, 2).map(x => `<span class="mev" style="--ev:${evColor(x.ev.tipo)}">${esc(x.ev.titulo)}</span>`).join('')}
      <span class="mdots">${classCodes.slice(0, 6).map(c => `<i style="${colorVars(c)}"></i>`).join('')}</span>
    </button>`);
  }
  // fin de clases, inicio de finales, etc. del calendario académico
  const c = D.calendario, marks = [[c.inicio_clases, 'Empiezan las clases'], [c.fin_clases, 'Último día de clase'],
    [c.periodo_finales?.[0], 'Empieza el período de finales'], [c.periodo_finales?.[1], 'Acaba el período de finales']];
  for (const [ds, txt] of marks) if (ds && ds.startsWith(S.calMes)) events.push({ ds, kind: 'hito', txt });
  events.sort((a, b) => a.ds.localeCompare(b.ds));
  return `
    <div class="cmonth">
      ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div class="mdow">${d}</div>`).join('')}
      ${cells.join('')}
    </div>
    <div class="legend">${codes.filter(hasSchedule).map(c => `<span style="${colorVars(c)}"><i></i>${esc(subj(c).s)}</span>`).join('')}
      <span><i class="lg-nolect"></i>Sin clases</span></div>
    ${events.length ? `<section class="card stack" style="margin-top:12px"><div class="eyebrow">Este mes</div>
      <ul class="mlist">${events.map(ev => { const d = dparse(ev.ds); return `<li class="${ev.kind}" ${ev.c ? `style="${colorVars(ev.c)}"` : ''} data-day="${ev.ds}">
        <span class="md">${ev.hasta ? `${d.getDate()}–${dparse(ev.hasta).getDate()}` : `${DAYS_SHORT[wdOf(d)]} ${d.getDate()}`}</span><span>${esc(ev.txt)}${ev.sub ? ` <small>${esc(ev.sub)}</small>` : ''}</span></li>`; }).join('')}</ul></section>` : ''}`;
}

/* ---------- plan de estudio semanal ---------- */
const LEVELS = [['bien', 'Bien', 0.7], ['normal', 'Normal', 1], ['cuesta', 'Me cuesta', 1.4], ['no', 'No la estudio', 0]];
// Por defecto "Normal"; si la asignatura no tiene exámenes (como Ampliació d'Informàtica), empieza en "No la estudio".
const levelOf = c => (S.estudio?.nivel || {})[c] || (subj(c).e.length ? 'normal' : 'no');
function classWeeks() {
  const c = D.calendario;
  return Math.max(1, (dparse(c.fin_clases) - dparse(c.inicio_clases)) / (7 * 864e5));
}
function nextExam(code, fromKey) {
  return subj(code).e.filter(e => e[1] >= fromKey).sort((a, b) => a[1].localeCompare(b[1]))[0] || null;
}
function weekPlan(monKey) {
  S.estudio = S.estudio || { nivel: {}, ajuste: {} };
  const E = S.estudio;
  const mon = dparse(monKey);
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => dayPlan(dkey(addDays(mon, i))));
  const freeMin = days.reduce((n, p) => n + p.freeMin, 0);
  const codes = (S.asignaturas || []).slice();
  const rows = codes.map(c => {
    const a = subj(c), lv = levelOf(c), f = LEVELS.find(l => l[0] === lv)[2];
    const oficial = (a.h || (a.cr || 0) * 15) / classWeeks();
    const ex = nextExam(c, monKey);
    const daysTo = ex ? Math.round((dparse(ex[1]) - mon) / 864e5) : null;
    const urg = daysTo == null ? 1 : daysTo <= 14 ? 1.6 : daysTo <= 30 ? 1.25 : 1;
    return { c, a, lv, oficial, ex, daysTo, w: oficial * f * urg };
  });
  const oficialTotal = rows.filter(r => r.lv !== 'no').reduce((n, r) => n + r.oficial, 0);
  const sugerido = Math.max(1, Math.min(Math.round(freeMin / 60 * 0.4), Math.round(oficialTotal * 0.6)));
  const objetivo = E.objetivo ?? sugerido;
  const fixed = rows.filter(r => r.lv !== 'no' && E.ajuste[r.c] != null);
  const auto = rows.filter(r => r.lv !== 'no' && E.ajuste[r.c] == null);
  const fixedSum = fixed.reduce((n, r) => n + E.ajuste[r.c], 0);
  const rest = Math.max(0, objetivo - fixedSum), wsum = auto.reduce((n, r) => n + r.w, 0);
  for (const r of rows) {
    if (r.lv === 'no') r.horas = 0;
    else if (E.ajuste[r.c] != null) { r.horas = E.ajuste[r.c]; r.manual = true; }
    else r.horas = wsum ? Math.round(rest * r.w / wsum * 2) / 2 : 0;
  }
  const total = rows.reduce((n, r) => n + r.horas, 0);
  return { days, freeMin, rows, objetivo, sugerido, oficialTotal, total };
}
const hfmt = h => num(Math.round(h * 2) / 2) + ' h';

function viewEstudio() {
  S.semana = S.semana || dkey(mondayOf(new Date()));
  const W = weekPlan(S.semana), E = S.estudio, mon = dparse(S.semana), sun = addDays(mon, 6);
  const thisMon = dkey(mondayOf(new Date()));
  const label = S.semana === thisMon ? 'Esta semana' : S.semana === dkey(addDays(mondayOf(new Date()), 7)) ? 'La semana que viene' : 'Semana';
  const freeH = W.freeMin / 60, over = W.total > freeH;
  const v = $('#view');
  v.innerHTML = `
    <div class="dayhead">
      <button class="icon" id="prev" aria-label="Semana anterior">‹</button>
      <div class="dh"><div class="eyebrow">${label}</div>
        <h1>${mon.getDate()} ${MONTHS[mon.getMonth()].slice(0, 3)} – ${sun.getDate()} ${MONTHS[sun.getMonth()].slice(0, 3)}</h1>
        ${S.semana !== thisMon ? '<button class="todaybtn" id="thisweek">Volver a esta semana</button>' : ''}</div>
      <button class="icon" id="next" aria-label="Semana siguiente">›</button>
    </div>
    <div class="stats">
      <div class="stat free"><b>${dur(W.freeMin)}</b><span>libres de verdad esta semana</span></div>
      <div class="stat"><b>${hfmt(W.total)}</b><span>de estudio planificadas</span></div>
    </div>
    <section class="card stack" style="margin-top:12px">
      <div class="eyebrow">¿Cuántas horas quieres estudiar esta semana?</div>
      <div class="stepper big">
        <button id="oMinus" aria-label="Menos horas">−</button>
        <output id="obj">${hfmt(W.objetivo)}</output>
        <button id="oPlus" aria-label="Más horas">+</button>
      </div>
      <small class="hint">Te proponemos ${hfmt(W.sugerido)}: un 40 % de tus horas libres, sin pasar del 60 % de lo que pide la guía docente (${hfmt(W.oficialTotal)} a la semana).${E.objetivo != null && E.objetivo !== W.sugerido ? ' <button class="link" id="oReset">Volver a la propuesta</button>' : ''}</small>
      ${over ? `<div class="notice bad">Has planificado más horas de las que tienes libres. Baja el objetivo o revisa tu rutina.</div>` : ''}
      ${W.total !== W.objetivo ? `<div class="notice warn">Con tus ajustes suman ${hfmt(W.total)}, no ${hfmt(W.objetivo)}.</div>` : ''}
    </section>
    <h2 class="sec">Reparto por asignatura</h2>
    <p class="lead" style="margin-bottom:10px">Dinos cómo llevas cada una y ajusta las horas si lo ves distinto. Lo que no toques se reparte solo.</p>
    <div class="stack">
      ${W.rows.map(r => `
        <div class="card subjplan" style="${colorVars(r.c)}">
          <div class="sp-head">
            <span class="bar"></span>
            <div class="sp-name"><b>${esc(r.a.n)}</b>
              <small>${r.a.cr ? num(r.a.cr) + ' cr · ' : ''}guía: ${hfmt(r.oficial)}/sem${r.ex ? ` · ${r.ex[0]} en ${r.daysTo} días` : ''}</small></div>
            ${r.lv === 'no' ? '' : `<div class="stepper">
              <button data-m="${r.c}" aria-label="Menos">−</button><output>${hfmt(r.horas)}</output><button data-p="${r.c}" aria-label="Más">+</button></div>`}
          </div>
          <div class="levels" role="group" aria-label="Cómo la llevas">
            ${LEVELS.map(([id, txt]) => `<button data-l="${r.c}" data-v="${id}" aria-pressed="${r.lv === id}">${txt}</button>`).join('')}
          </div>
          ${r.manual ? `<small class="hint">Ajustada a mano · <button class="link" data-r="${r.c}">volver a automático</button></small>` : ''}
          ${r.daysTo != null && r.daysTo <= 30 && r.lv !== 'no' ? `<small class="hint urg">Examen cerca: le damos más peso.</small>` : ''}
        </div>`).join('')}
    </div>
    <p class="hint" style="margin-top:14px">Estas horas son tu objetivo para la semana. Tú decides cuándo: usa los huecos verdes de la pestaña Hoy.</p>`;
  const step = (cur, d) => Math.max(0, Math.round((cur + d) * 2) / 2);
  const rerender = () => { save(); const y = window.scrollY; viewEstudio(); window.scrollTo(0, y); };
  $('#oMinus').onclick = () => { E.objetivo = step(W.objetivo, -1); rerender(); };
  $('#oPlus').onclick = () => { E.objetivo = step(W.objetivo, 1); rerender(); };
  if ($('#oReset')) $('#oReset').onclick = () => { delete E.objetivo; rerender(); };
  v.querySelectorAll('[data-m],[data-p]').forEach(b => b.onclick = () => {
    const c = b.dataset.m || b.dataset.p, r = W.rows.find(x => x.c === c);
    E.ajuste[c] = step(r.horas, b.dataset.m ? -0.5 : 0.5); rerender();
  });
  v.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { delete E.ajuste[b.dataset.r]; rerender(); });
  v.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
    E.nivel[b.dataset.l] = b.dataset.v; if (b.dataset.v === 'no') delete E.ajuste[b.dataset.l]; rerender();
  });
  const shiftW = n => { S.semana = dkey(addDays(dparse(S.semana), 7 * n)); save(); viewEstudio(); };
  $('#prev').onclick = () => slideTo(v, -1, shiftW);
  $('#next').onclick = () => slideTo(v, 1, shiftW);
  if ($('#thisweek')) $('#thisweek').onclick = () => slideTo(v, S.semana > thisMon ? -1 : 1, () => { S.semana = thisMon; save(); viewEstudio(); });
  swipe(v, shiftW);
  tabs('estudio');
}

/* ---------- apariencia: automático / claro / oscuro ---------- */
function applyTheme() {
  const t = S.tema || 'auto', root = document.documentElement;
  if (t === 'claro') root.dataset.theme = 'light';
  else if (t === 'oscuro') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  const dark = t === 'oscuro' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // color de la barra del sistema en el móvil
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.setAttribute('content', dark ? '#16241F' : '#F1F5F2'); m.removeAttribute('media'); });
}

/* ---------- ajustes ---------- */
function viewAjustes() {
  const g = grado();
  const v = $('#view');
  const tema = S.tema || 'auto';
  v.innerHTML = `
    <div class="eyebrow">Ajustes</div>
    <h1>Tu Quatri</h1>
    <p class="lead">${esc(g.n)} · ${S.asignaturas.length} asignaturas · ${esc(D.periodo.curso)} ${esc(D.periodo.q)}</p>
    <section class="card stack" style="margin-bottom:12px">
      <div class="eyebrow">Apariencia</div>
      <div class="seg2" role="group" aria-label="Modo de color" style="margin:0">
        <button data-tema="auto" aria-pressed="${tema === 'auto'}">Automático</button>
        <button data-tema="claro" aria-pressed="${tema === 'claro'}">Claro</button>
        <button data-tema="oscuro" aria-pressed="${tema === 'oscuro'}">Oscuro</button>
      </div>
      <small class="hint">Automático sigue el modo de tu móvil.</small>
    </section>
    <div class="stack">
      <button class="choice" data-go="rutina"><span><b>Mi rutina</b><span class="code">Trayecto, comidas, descansos y sueño</span></span></button>
      <button class="choice" data-go="semana"><span><b>Mi horario de clases</b><span class="code">Semana tipo y avisos de solapes</span></span></button>
      <button class="choice" data-go="grupos"><span><b>Mis grupos</b><span class="code">Cambiar de subgrupo en alguna asignatura</span></span></button>
      <button class="choice" data-go="asignaturas"><span><b>Mis asignaturas</b><span class="code">Añadir o quitar asignaturas</span></span></button>
      <button class="choice" data-go="grado"><span><b>Cambiar de grado</b><span class="code">Empieza de nuevo con otro grado</span></span></button>
      <button class="choice" data-go="bienvenida"><span><b>Cómo funciona Quatri</b><span class="code">Vuelve a ver la presentación</span></span></button>
    </div>
    <p class="hint" style="margin-top:18px">Tus datos se guardan solo en este dispositivo. Horarios: Visor d'Horaris UPC · Créditos y horas: guías docentes UPC.</p>`;
  v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  v.querySelectorAll('[data-tema]').forEach(b => b.onclick = () => { S.tema = b.dataset.tema; save(); applyTheme(); viewAjustes(); });
  tabs('ajustes');
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
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
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
