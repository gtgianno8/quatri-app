// Quatri · versión 0
// Flujo de alta: grado -> asignaturas -> grupos -> tu semana. Los datos del alumno se guardan en su dispositivo.

// Escuelas disponibles (data/escuelas.json) y, de cada una, su archivo de horarios, temarios y evaluación
const ESC_URL = 'data/escuelas.json';
const ESC_DEF = '205'; // ESEIAAT: la de quien ya usaba Quatri antes de que hubiera más escuelas
let ESC = null;
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
  PLAN_CACHE = {}; // cualquier cambio puede mover el estudio colocado en la semana
  // El estudio se recoloca desde el día en que cambiaste algo de verdad (no por pasar de día):
  // así el plan que ves y los avisos que ya están programados en el servidor coinciden.
  const sig = planSig();
  if (sig !== S._planSig) { S._planSig = sig; S.planDesde = dkey(new Date()); }
  if (USER) S._sync = { ...(S._sync || {}), uid: USER.id, dirty: true };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { toast('No se ha podido guardar en este dispositivo.'); }
  if (USER) { clearTimeout(SYNC_T); SYNC_T = setTimeout(push, 1500); } // sube los cambios a tu cuenta
}
let PLAN_CACHE = {};
// huella de todo lo que puede mover el estudio (sin lo que solo es de pantalla o de avisos)
function planSig() {
  const skip = ['planDesde', '_planSig', 'avisos'];
  const str = JSON.stringify(Object.entries(forCloud()).filter(([k]) => !skip.includes(k)));
  let h = 5381; for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) | 0;
  return h;
}

/* ---------- cuenta y sincronización (Supabase) ----------
   Sin cuenta, todo vive en este dispositivo. Con cuenta, el estado se guarda también en la tabla
   quatri_datos (una fila por persona, protegida para que solo la vea su dueño) y se comparte
   entre el móvil y el ordenador. Gana lo último que se cambió. */
const SB_URL = 'https://zoswzpewqehvdkewvbls.supabase.co';
const SB_KEY = 'sb_publishable_PctIIFGPaAgc0HR9wi0jAQ_Lwd0t86s'; // clave pública: puede ir en la web
const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
const SB_STORE = 'sb-zoswzpewqehvdkewvbls-auth-token';
let SB = null, USER = null, SYNC_T = null;
// cosas de cada dispositivo que no se suben (qué día estás mirando, el modo claro/oscuro...)
const LOCAL_ONLY = ['dia', 'calSemana', 'calMes', 'calVista', 'temCode', 'estOff', 'estAdv', 'semana', 'tema', '_sync'];
const forCloud = () => Object.fromEntries(Object.entries(S).filter(([k]) => !LOCAL_ONLY.includes(k)));
const authRedirect = () => location.origin + location.pathname;

async function sb() {
  if (SB) return SB;
  const { createClient } = await import(SB_LIB);
  SB = createClient(SB_URL, SB_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  SB.auth.onAuthStateChange((ev, session) => {
    const u = session?.user || null, nuevo = u && u.id !== USER?.id;
    USER = u;
    if (nuevo) { setTimeout(() => pull(), 0); vigilarCambios(); }
    if (['ajustes', 'bienvenida', 'listo'].includes(current())) render();
  });
  return SB;
}
// Arranque: solo se carga Supabase si hay sesión guardada o vienes de iniciar sesión
async function initCuenta() {
  const vuelta = /[?&]code=/.test(location.search) || /access_token=/.test(location.hash);
  let tiene = false; try { tiene = !!localStorage.getItem(SB_STORE); } catch {}
  if (!vuelta && !tiene) return;
  try {
    const c = await sb();
    const { data } = await c.auth.getSession();
    USER = data.session?.user || null;
    if (vuelta) { history.replaceState(null, '', location.pathname + (location.hash.includes('access_token') ? '' : location.hash)); if (USER) toast('¡Dentro! Tu quatri ya se guarda en tu cuenta'); }
    if (USER) { await pull(); programarAvisos(); } // al abrir, se rehacen los avisos de los próximos días
  } catch { /* sin conexión: seguimos con lo de este dispositivo */ }
  vigilarCambios();
}
// Trae lo último de tu cuenta: al volver a la app o a la ventana, y cada 15 s mientras la tienes delante
function vigilarCambios() {
  if (vigilarCambios.on) return; vigilarCambios.on = true;
  const mira = () => { if (USER && document.visibilityState === 'visible' && !document.querySelector('.ov')) pull(); };
  document.addEventListener('visibilitychange', mira);
  window.addEventListener('focus', mira);
  setInterval(mira, 15000);
}
async function push() {
  if (!USER || !SB) return;
  const at = new Date().toISOString();
  const { error } = await SB.from('quatri_datos').upsert({ user_id: USER.id, datos: forCloud(), actualizado: at });
  if (error) return; // se reintentará en el próximo cambio
  S._sync = { uid: USER.id, at, dirty: false };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {}
  programarAvisos(); // tus cambios pueden mover clases, estudio o exámenes: se rehace la lista de avisos
}
async function pull() {
  if (!USER || !SB) return;
  const { data, error } = await SB.from('quatri_datos').select('datos, actualizado').eq('user_id', USER.id).maybeSingle();
  if (error) return;
  const sy = S._sync || {};
  if (!data) { if (S.listo) push(); else S._sync = { uid: USER.id, dirty: false }; return; } // primera vez: sube lo que hay aquí
  if (sy.uid === USER.id) {
    if (sy.dirty && (!sy.at || data.actualizado <= sy.at)) { push(); return; } // cambios de aquí sin subir
    if (!sy.at || data.actualizado > sy.at) applyRemote(data);             // hay algo más nuevo en tu cuenta
    return;
  }
  // este dispositivo aún no estaba unido a esta cuenta
  if (!S.listo) { applyRemote(data); return; }
  askWhich(data);
}
function applyRemote(data) {
  const keep = {};
  for (const k of LOCAL_ONLY) if (k !== '_sync' && S[k] !== undefined) keep[k] = S[k];
  S = { ...(data.datos || {}), ...keep, _sync: { uid: USER.id, at: data.actualizado, dirty: false } };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {}
  PLAN_CACHE = {}; colorCache = null; applyTheme();
  // en tu cuenta estás en otra escuela: primero se cargan sus horarios
  if (D && D._id !== escId()) { loadEscuela(escId()).then(() => applyRemote(data)).catch(() => {}); return; }
  if (S.listo && !STEPS.includes(current())) { if (!['hoy', 'calendario', 'estudio', 'ajustes', 'temario', 'rutinaex'].includes(location.hash.slice(1))) location.hash = 'hoy'; }
  // en un paso del alta (formularios) no se repinta para no borrar lo que estás escribiendo
  if (STEPS.includes(current())) return;
  const y = window.scrollY; render(); window.scrollTo(0, y); // repinta sin moverte de donde estabas
}
// En la cuenta hay datos y en este dispositivo también: que elija la persona
function askWhich(data) {
  const r = data.datos || {}, d = new Date(data.actualizado);
  const g = D?.grados.find(x => x.id === r.grado);
  const { q, close } = sheet(`
    <header><h2>¿Con qué datos te quedas?</h2></header>
    <p style="margin:0">En tu cuenta ya hay un quatri guardado y en este dispositivo también.</p>
    <ul class="plain">
      <li><b>En tu cuenta:</b> ${esc(g ? g.n : 'tu grado')} · ${(r.asignaturas || []).length} asignaturas · guardado el ${d.getDate()}/${d.getMonth() + 1} a las ${fmt(d.getHours() * 60 + d.getMinutes())}</li>
      <li><b>En este dispositivo:</b> ${esc(grado()?.n || '')} · ${(S.asignaturas || []).length} asignaturas</li>
    </ul>
    <small class="hint">Los que no elijas se sustituyen.</small>
    <footer><button type="button" class="btn" id="wLocal">Los de este dispositivo</button><span class="sp"></span><button type="button" class="btn primary" id="wCloud">Los de mi cuenta</button></footer>`);
  q('#wCloud').onclick = () => { close(); applyRemote(data); toast('Usando los datos de tu cuenta'); };
  q('#wLocal').onclick = () => { close(); S._sync = { uid: USER.id, dirty: true }; push(); toast('Tu cuenta usa ahora los datos de este dispositivo'); };
}

// Entrar: Google o código por correo (el código sirve también en la app instalada del iPhone)
function openLogin() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), app = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const { q, close } = sheet(`
    <header><h2>Entrar en Quatri</h2><button type="button" class="icon" data-x aria-label="Cerrar">${ico('x')}</button></header>
    <p style="margin:0">Guarda tu quatri en tu cuenta y tenlo igual en el móvil y en el ordenador.</p>
    <button type="button" class="btn gbtn primary-g" id="lG"><span class="g" aria-hidden="true">G</span>Continuar con Google</button>
    <div class="or"><span>o con tu correo</span></div>
    <label class="field"><span>Correo</span><input type="email" id="lE" autocomplete="email" inputmode="email" placeholder="tu@correo.com"></label>
    <button type="button" class="btn" id="lSend">Enviarme un enlace para entrar</button>
    ${ios && app ? '<small class="hint">En la app del iPhone, el enlace del correo se abre en Safari: entra mejor con Google.</small>' : ''}
    <div id="lCodeBox" class="stack" hidden>
      <div class="notice good" id="lInfo"></div>
      <button type="button" class="link" id="lHave" style="align-self:flex-start">Me ha llegado un código</button>
      <div id="lCodeIn" class="stack" hidden>
        <label class="field"><span>Código del correo</span><input id="lC" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
        <button type="button" class="btn primary" id="lOk">Entrar</button>
      </div>
    </div>
    <p class="err" id="lErr" hidden></p>
    <small class="hint">Al entrar aceptas la <a href="privacidad.html" target="_blank" rel="noopener">política de privacidad</a>. Sin anuncios; tus datos solo los ves tú.</small>`);
  const err = m => { q('#lErr').textContent = m; q('#lErr').hidden = !m; };
  q('#lG').onclick = async () => {
    err('');
    try { const c = await sb(); const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirect() } }); if (error) err('No se ha podido abrir Google. Prueba otra vez.'); }
    catch { err('Sin conexión. Conéctate a internet para entrar.'); }
  };
  q('#lSend').onclick = async () => {
    const email = q('#lE').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Escribe un correo válido.');
    err(''); q('#lSend').disabled = true; q('#lSend').textContent = 'Enviando…';
    try {
      const c = await sb();
      const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: authRedirect(), shouldCreateUser: true } });
      if (error) throw error;
      q('#lCodeBox').hidden = false; q('#lSend').textContent = 'Reenviar el enlace';
      q('#lInfo').innerHTML = `Te hemos enviado un enlace a <b>${esc(email)}</b>. Ábrelo <b>en este mismo navegador</b> y entrarás solo. Si no llega en un minuto, mira en spam.`;
    } catch (e) {
      q('#lSend').textContent = 'Enviarme un enlace para entrar';
      err(/rate|limit|seconds/i.test(e?.message || '') ? 'Se han enviado varios correos seguidos. Espera un rato (o entra con Google) y vuelve a probar.' : 'No se ha podido enviar el correo. Revisa tu conexión.');
    } finally { q('#lSend').disabled = false; }
  };
  // si algún día el correo trae también un código (con un servicio de correo propio), se puede escribir aquí
  q('#lHave').onclick = () => { q('#lCodeIn').hidden = false; q('#lHave').hidden = true; setTimeout(() => q('#lC').focus(), 50); };
  q('#lOk').onclick = async () => {
    const email = q('#lE').value.trim(), token = q('#lC').value.replace(/\D/g, '');
    if (token.length < 6) return err('Escribe el código que te ha llegado.');
    err('');
    try {
      const c = await sb();
      const { data, error } = await c.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      USER = data.user; close(); toast('¡Dentro! Tu quatri ya se guarda en tu cuenta');
      // onAuthStateChange se encarga de traer o subir tus datos
    } catch { err('El código no es correcto o ha caducado. Pide otro.'); }
  };
}
/* ---------- avisos (notificaciones) ----------
   La app prepara la lista de avisos de los próximos días y la guarda en quatri_avisos;
   un proceso en Supabase los envía a su hora a los dispositivos guardados en quatri_push.
   S.avisos = { on, clase: minutos antes (0 = no), estudio, examen, resumen: 'HH:MM' | '' } */
const VAPID_PUBLIC = 'BBGa8KHym0LVQk8PAyzxAMznuL22QSXvSjRWkTuZ-4u7LZFq6_9utkeYE7qC3ikDyIq68xd7Ubys7HuJL6gmmRQ';
const AVISOS_DEF = { on: false, clase: 10, estudio: true, examen: true, examenHora: '20:00', resumen: '08:00' };
const avisosCfg = () => ({ ...AVISOS_DEF, ...(S.avisos || {}) });
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };

async function activarAvisos() {
  if (!USER) { openLogin(); return false; }
  if (!pushOk()) { toast(/iPhone|iPad/.test(navigator.userAgent) ? 'En el iPhone, los avisos funcionan con Quatri añadida a la pantalla de inicio.' : 'Este navegador no admite avisos.'); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Sin permiso no podemos avisarte. Puedes darlo en los ajustes del navegador.'); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) });
    const j = sub.toJSON(), c = await sb();
    const { error } = await c.from('quatri_push').upsert({ user_id: USER.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
    if (error) throw error;
  } catch { toast('No se han podido activar los avisos en este dispositivo.'); return false; }
  S.avisos = { ...avisosCfg(), on: true }; save(); programarAvisos(true);
  return true;
}
async function desactivarAvisos() {
  S.avisos = { ...avisosCfg(), on: false }; save();
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { const c = await sb(); await c.from('quatri_push').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch {}
  programarAvisos(true);
}
// Lista de avisos de las próximas 2 semanas, según tu horario, tu estudio propuesto y tus exámenes
// (se rehace cada vez que abres Quatri o cambias algo; así siguen llegando aunque pases días sin abrirla)
function listaAvisos() {
  const A = avisosCfg(), out = [], now = Date.now();
  if (!A.on || !S.listo) return out;
  const at = (ds, min) => { const d = dparse(ds); d.setMinutes(min); return d; };
  const add = (d, titulo, cuerpo, ds) => { if (d.getTime() > now + 30000) out.push({ at: d.toISOString(), titulo, cuerpo, url: './#hoy' }); };
  for (let i = 0; i < 14; i++) {
    const ds = dkey(addDays(new Date(), i)), p = dayView(ds);
    if (A.clase) for (const b of p.blocks.filter(b => b.kind === 'clase' || b.kind === 'examen'))
      add(at(ds, b.s - A.clase), `${b.kind === 'examen' ? b.label : subj(b.code).n} a las ${fmt(b.s)}`, `${b.sub ? b.sub + ' · ' : ''}empieza en ${A.clase} min`);
    if (A.estudio) for (const b of p.blocks.filter(b => b.kind === 'plan'))
      add(at(ds, b.s), `Hora de estudiar: ${subj(b.code).n}`, `${b.tema ? b.tema + ' · ' : ''}${dur(b.e - b.s)}. Márcalo como hecho cuando acabes.`);
    if (A.resumen) {
      const est = p.blocks.filter(b => b.kind === 'plan').reduce((n, b) => n + b.e - b.s, 0);
      add(at(ds, toMin(A.resumen)), 'Tu día en Quatri', [p.classMin ? `${dur(p.classMin)} de clase` : 'Sin clases', `${dur(p.freeMin)} libres de verdad`, est ? `${dur(est)} de estudio` : ''].filter(Boolean).join(' · '));
    }
  }
  if (A.examen) {
    const hoy = dkey(new Date());
    for (const c of S.asignaturas || []) for (const e of examsOf(c)) {
      const dias = Math.round((dparse(e[1]) - dparse(hoy)) / 864e5);
      if (dias < 1 || dias > 21) continue;
      const nom = `${exName(e)} de ${subj(c).n}`;
      for (const antes of [7, 3, 1]) if (dias >= antes) add(at(dkey(addDays(dparse(e[1]), -antes)), toMin(A.examenHora || '20:00')),
        antes === 1 ? `Mañana: ${nom}` : `En ${antes} días: ${nom}`, `${e[2] ? `${e[2]}–${e[3]}` : 'Sin hora'}${e[4] ? ' · ' + e[4] : ''}`);
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 400);
}
// Sube la lista nueva (sustituye los avisos aún no enviados). force: ahora mismo; si no, espera un poco.
let AV_T = null;
function programarAvisos(force) {
  if (!USER) return;
  clearTimeout(AV_T);
  AV_T = setTimeout(async () => {
    try {
      const c = await sb(), lista = listaAvisos();
      await c.from('quatri_avisos').delete().eq('user_id', USER.id).eq('enviado', false);
      if (lista.length) await c.from('quatri_avisos').insert(lista.map(x => ({ ...x, user_id: USER.id })));
    } catch {}
  }, force ? 0 : 4000);
}
// solo en la copia de pruebas del ordenador: para revisar la lista de avisos sin enviarlos
if (location.hostname === 'localhost') window.__quatri = { listaAvisos, setAvisos: a => { S.avisos = { ...avisosCfg(), ...a }; }, probar: (...a) => probarUsuarios(...a), dia: ds => dayPlan(ds) };

/* ---------- prueba automática (solo en localhost) ----------
   Simula alumnos nuevos de distintas escuelas (grado, cursos, asignaturas, grupos, rutina, eventos)
   y recorre los días y las pantallas buscando errores. Deja los datos del dispositivo como estaban. */
async function probarUsuarios(n = 20, seed = 7) {
  let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const backup = localStorage.getItem(STORE_KEY), D0 = D._id, hash0 = location.hash;
  const user0 = USER; USER = null; // que nada de la prueba se suba a la cuenta
  const ids = ESC.escuelas.map(e => e.id);
  const orden = [...ids,'205', '270', '295', '330', '340', '250', '230', '205'].slice(0, n);
  const tipos = ['un curso', 'curso + adelantadas', 'repetidor', 'pocas', 'dos cursos', 'optativas', 'curso + 1', 'mismo grupo'];
  const hoyK = dkey(new Date()), informe = [];
  for (let u = 0; u < orden.length; u++) {
    const id = orden[u], fallos = [], avisos = [];
    const err = (m) => { if (fallos.length < 12) fallos.push(m); };
    try {
      await loadEscuela(id); await loadEval();
      const g = pick(D.grados), con = g.a.filter(c => hasSchedule(c));
      const cursos = [...new Set(con.map(c => subj(c).c))].sort();
      const c0 = pick(cursos), tipo = tipos[u % tipos.length];
      const del = k => con.filter(c => subj(c).c === k && subj(c).t !== 'OP');
      let asig = del(c0);
      if (tipo === 'curso + adelantadas' && cursos.includes(c0 + 1)) asig = [...asig, ...del(c0 + 1).slice(0, 2)];
      if (tipo === 'repetidor' && cursos.includes(c0 - 1)) asig = [...del(c0 - 1).slice(0, 2), ...asig.slice(0, 3)];
      if (tipo === 'pocas') asig = asig.slice(0, 2);
      if (tipo === 'dos cursos' && cursos.length > 1) asig = [...asig, ...del(cursos.find(k => k !== c0))];
      if (tipo === 'optativas') asig = [...asig.slice(0, 2), ...con.filter(c => subj(c).t === 'OP').slice(0, 3)];
      if (tipo === 'curso + 1') asig = [...asig, pick(con)];
      asig = [...new Set(asig.length ? asig : con.slice(0, 4))];
      // grupos: el mismo subgrupo en todas si existe, si no uno al azar de cada una
      const comun = options(asig[0]).find(o => asig.every(c => options(c).includes(o)));
      const grupos = Object.fromEntries(asig.map(c => [c, tipo === 'mismo grupo' && comun ? comun : pick(options(c))]));
      const evs = {};
      if (rnd() < 0.5) evs.t1 = { titulo: 'Entreno', tipo: 'entreno', fecha: hoyK, todoDia: false, ini: '19:00', fin: '20:30', trayecto: 15, lugar: '', repite: { dias: [1, 3], hasta: '' }, excepciones: [] };
      if (rnd() < 0.4) { const v = dkey(addDays(mondayOf(new Date()), 11)); evs.t2 = { titulo: 'Viaje', tipo: 'viaje', fecha: v, ini: '16:00', fechaFin: dkey(addDays(dparse(v), 2)), fin: '18:00', todoDia: false, trayecto: 0, lugar: '', repite: null, excepciones: [] }; }
      if (rnd() < 0.5) evs.t4 = { titulo: 'Academia', tipo: 'academia', asig: '', modo: pick(['uni', 'otro', 'online']), fecha: hoyK, todoDia: false, ini: '08:00', fin: '09:30', trayecto: 20, lugar: '', repite: { dias: [1, 4], hasta: '' }, excepciones: [] };
      if (rnd() < 0.3) evs.t3 ={ titulo: 'Cumple', tipo: 'plan', fecha: dkey(addDays(new Date(), 3)), todoDia: true, ini: '', fin: '', trayecto: 0, lugar: '', repite: null, excepciones: [] };
      S = { escuela: id, grado: g.id, asignaturas: asig, grupos, listo: true, eventos: evs,
        rutina: { trayecto: pick([10, 20, 30, 45, 60, 75]), estudiaNoche: rnd() < 0.4, volverCasa: pick([0, 0, 120]), merienda: rnd() < 0.5 },
        estMax: { semana: pick([1, 2, 3, 4]), finde: pick([0, 2, 3, 4, 6]) }, estPref: pick(['libre', 'repartido', 'manana', 'tarde', 'noche']),
        avisos: { on: true, clase: 10, estudio: true, examen: true, examenHora: '20:00', resumen: '08:00' } };
      PLAN_CACHE = {}; colorCache = null;
      const sinHorario = g.a.length - con.length;
      if (clashes(mySessions()).length) avisos.push(`${clashes(mySessions()).length} clases se pisan`);
      // 1) cada día de las próximas 3 semanas
      let estudioTotal = 0;
      for (let i = 0; i < 21; i++) {
        const ds = dkey(addDays(new Date(), i)), p = dayView(ds);
        const nums = [...p.blocks, ...p.free].flatMap(b => [b.s, b.e]);
        if (nums.some(x => !Number.isFinite(x))) err(`${ds}: horas no válidas`);
        for (const b of p.blocks) if (b.e < b.s) err(`${ds}: bloque al revés (${b.label})`);
        const plan = p.blocks.filter(b => b.kind === 'plan');
        estudioTotal += plan.reduce((m, b) => m + b.e - b.s, 0);
        for (const b of plan) {
          const pisa = p.blocks.find(o => o !== b && o.kind !== 'noche' && o.s < b.e && b.s < o.e);
          if (pisa) err(`${ds}: estudio ${fmt(b.s % 1440)} pisa ${pisa.kind} «${pisa.label}»`);
          if (b.s < p.wake || b.e > p.sleep) err(`${ds}: estudio fuera del día (${fmt(b.s % 1440)})`);
          const ex = examsOf(b.code).filter(e => e[1] <= ds && e[0] !== 'entrega');
          if (ex.length && ex.some(e => e[1] === ds)) err(`${ds}: estudio de ${subj(b.code).s} el día de su examen`);
          if (visorConExamenes() && !nextExam(b.code, ds) && !(S.estudio?.nivel || {})[b.code]) err(`${ds}: estudio de ${subj(b.code).s}, que no tiene examen por delante`);
        }
        const yaHecho = p.blocks.filter(b => b.kind === 'estudio' && b.doneId).reduce((m, b) => m + b.e - b.s, 0);
        const planMin = plan.reduce((m, b) => m + b.e - b.s, 0);
        if (planMin + yaHecho > estMax(ds) * 60 + 1 && plan.length) err(`${ds}: ${planMin} min de estudio con máximo ${estMax(ds)} h`);
        if (p.fuera && plan.some(b => !b.fijoId)) err(`${ds}: estudio un día que está fuera`);
      }
      // 2) semanas
      for (let w = 0; w < 3; w++) {
        const W = weekPlan(estStart(w));
        if (![W.total, W.sugerido, W.tope].every(Number.isFinite)) err(`semana ${w}: números no válidos`);
        if (W.sugerido > W.tope + 0.01) err(`semana ${w}: propone ${W.sugerido} h con tope ${W.tope}`);
      }
      // 3) pantallas
      const mira = async (nombre, fn) => {
        try { await fn(); const h = $('#view').innerHTML; if (/undefined|NaN|\[object Object\]/.test(h)) err(`${nombre}: texto raro (${(h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,20}/) || [''])[0].replace(/<[^>]+>/g, ' ')})`); }
        catch (e) { err(`${nombre}: ${e.message}`); }
      };
      for (let i = 0; i < 7; i++) { S.dia = dkey(addDays(new Date(), i * 3)); await mira(`Hoy +${i * 3}`, viewHoy); }
      S.calVista = 'semana'; S.calSemana = estStart(0); await mira('Calendario semana', viewCalendario);
      S.calSemana = estStart(1); await mira('Calendario semana 2', viewCalendario);
      S.calVista = 'mes'; await mira('Calendario mes', viewCalendario);
      for (let w = 0; w < 3; w++) { S.estOff = w; await mira(`Estudio semana ${w}`, viewEstudio); }
      for (const c of asig) { S.temCode = c; await mira(`Exámenes ${subj(c).s}`, viewTemario); }
      await mira('Ajustes', viewAjustes);
      await mira('Grupos', viewGrupos); await mira('Semana de clases', viewSemana);
      await mira('Escuela y grado', viewGrado); await mira('Asignaturas', viewAsignaturas); await mira('Rutina', viewRutina);
      // 4) avisos
      const L = listaAvisos();
      if (L.some(a => isNaN(Date.parse(a.at)))) err('avisos con fecha no válida');
      informe.push({ usuario: u + 1, escuela: D.escuela.s, grado: g.n, tipo, curso: c0, asignaturas: asig.length, sinHorario,
        grupos: [...new Set(Object.values(grupos))].join(','), estudio_3sem: hfmt(estudioTotal / 60), avisos: L.length, notas: avisos.join('; '), fallos });
    } catch (e) { informe.push({ usuario: u + 1, escuela: id, fallos: ['EXCEPCIÓN: ' + e.message + ' ' + (e.stack || '').split('\n')[1]] }); }
  }
  // todo como estaba
  USER = user0;
  try { if (backup) localStorage.setItem(STORE_KEY, backup); else localStorage.removeItem(STORE_KEY); } catch {}
  S = load(); await loadEscuela(S.escuela || D0); location.hash = hash0; render();
  return informe;
}
async function avisoPrueba() {
  try {
    const c = await sb();
    const { error } = await c.from('quatri_avisos').insert({ user_id: USER.id, at: new Date().toISOString(), titulo: 'Quatri funciona', cuerpo: 'Así te llegarán los avisos.', url: './#ajustes' });
    if (error) throw error;
    toast('Aviso de prueba enviado: llega en menos de un minuto');
  } catch { toast('No se ha podido enviar el aviso de prueba.'); }
}

async function logout() {
  try { const c = await sb(); await c.auth.signOut(); } catch {}
  USER = null;
  // por privacidad, al salir se borran los datos de este dispositivo (en tu cuenta siguen guardados)
  try { localStorage.removeItem(STORE_KEY); } catch {}
  S = {}; location.hash = ''; render(); toast('Has cerrado sesión');
}
async function borrarCuenta() {
  try {
    const c = await sb();
    const r = await c.rpc('borrar_mi_cuenta');
    if (r.error) throw r.error;
    await c.auth.signOut({ scope: 'local' }).catch(() => {});
  } catch { toast('No se ha podido borrar la cuenta. Revisa tu conexión.'); return; }
  USER = null;
  try { localStorage.removeItem(STORE_KEY); } catch {}
  S = {}; location.hash = ''; render(); toast('Cuenta borrada');
}
// Bocadillo de información: se cierra solo a los 4 s o al tocarlo.
// undo: si se pasa, el aviso lleva un botón "Deshacer" y dura más
function toast(msg, undo) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  if (!t.dataset.tap) { t.dataset.tap = 1; t.onclick = () => { t.hidden = true; clearTimeout(toast.t); }; }
  if (undo) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-undo'; b.textContent = 'Deshacer';
    b.onclick = e => { e.stopPropagation(); t.hidden = true; clearTimeout(toast.t); undo(); };
    t.append(' ', b);
  }
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, undo ? 8000 : 4000);
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
    // sesiones con fechas propias que no coinciden en el tiempo (p. ej. una solo en octubre y otra solo en diciembre)
    if (a[6] && b[6] && ((a[7] || a[6]) < b[6] || (b[7] || b[6]) < a[6])) continue;
    if (a[8] && b[8] && !a[8].some(d => b[8].includes(d))) continue; // días sueltos que no coinciden
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
  if (h === 'temario') return S.listo && S.temCode && subj(S.temCode) ? h : (S.listo ? 'estudio' : 'grado');
  if (['hoy', 'calendario', 'estudio', 'ajustes', 'rutinaex'].includes(h)) return S.listo ? h : 'grado';
  return S.listo ? 'hoy' : (S.asignaturas?.length ? 'asignaturas' : 'grado');
}
function render() {
  const step = current();
  const i = STEPS.indexOf(step);
  $('#steps').innerHTML = i >= 0 ? STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('') : '';
  $('#view')._swipe = null;
  if ($('#fab')) $('#fab').hidden = true;
  ({ bienvenida: viewBienvenida, listo: viewListo, grado: viewGrado, asignaturas: viewAsignaturas, grupos: viewGrupos, semana: viewSemana, rutina: viewRutina,
     hoy: viewHoy, calendario: viewCalendario, estudio: viewEstudio, ajustes: viewAjustes, temario: viewTemario, rutinaex: viewRutinaEx })[step]();
  window.scrollTo(0, 0);
}
function actions(html) {
  let bar = $('#actions');
  if (!bar) { bar = document.createElement('div'); bar.id = 'actions'; bar.className = 'actions'; document.body.appendChild(bar); }
  bar.innerHTML = `<div class="actions-in">${html}</div>`;
  bar.hidden = !html;
  // en pantallas grandes, las pestañas pasan a un menú lateral
  document.body.classList.toggle('has-side', html.includes('class="tabs"'));
  if ($('#gear')) $('#gear').hidden = !html.includes('class="tabs"'); // el engranaje solo con la app ya configurada
}

/* ---------- 1. Grado ---------- */
// Dibujo propio de la ciudad de cada campus (sin logos de la UPC: Quatri no es una app oficial)
const CIUDAD_ILU = {
  'Barcelona': `<path class="c" d="M0 128c30-8 50 8 80 0s50-8 80 0 50 8 80 0v32H0z"/><rect class="a" x="34" y="58" width="34" height="70" rx="3"/><rect class="b" x="74" y="34" width="26" height="94" rx="3"/>
    <path class="a" d="M112 128V52l12-30 12 30v76z"/><rect class="b" x="146" y="70" width="40" height="58" rx="3"/><circle class="y" cx="206" cy="36" r="16"/><path class="sd" d="M40 74h22M40 92h22M40 110h22"/>`,
  'Terrassa': `<rect class="b" x="40" y="20" width="16" height="100" rx="3"/><rect class="d" x="40" y="20" width="16" height="10"/><path class="a" d="M22 128V84l30-20 30 20 30-20 30 20 30-20 30 20v44z"/>
    <path class="sd" d="M60 104h20M120 104h20M180 104h20"/><circle class="y" cx="200" cy="34" r="16"/><path class="sb" d="M52 10c10-6 20 6 30 0"/>`,
  'Castelldefels': `<circle class="y" cx="190" cy="34" r="18"/><path class="a" d="M150 22l40 8-40 8-20 18-8-2 12-18-24-4-6 8h-6l4-12-4-12h6l6 8 24-4-12-18 8-2z" transform="translate(-90 6)"/>
    <path class="c" d="M0 112c30-10 60 10 90 0s60-10 90 0 40 8 60 4v44H0z"/><path class="b" d="M150 112V80h10v-8h8v8h8v-8h8v8h10v32z"/><path class="a" d="M0 136h240v24H0z" opacity=".5"/>`,
  'Manresa': `<path class="b" d="M0 128l26-52 14 20 18-44 16 30 14-40 18 36 14-24 20 44 16-18 24 48z"/><path class="a" d="M150 128V92h60v36z"/><path class="a" d="M162 92l18-20 18 20z"/><circle class="y" cx="206" cy="30" r="14"/>`,
  'Vilanova i la Geltrú': `<path class="c" d="M0 118c30-10 60 10 90 0s60-10 90 0 40 8 60 4v38H0z"/><path class="a" d="M108 118l8-80h24l8 80z"/><rect class="d" x="112" y="66" width="32" height="10"/><rect class="y" x="116" y="24" width="24" height="16" rx="3"/>
    <path class="sy" d="M100 30l-28-8M156 30l28-8"/><path class="b" d="M180 104l18-26v26zM188 104h30"/>`,
  'Sant Cugat del Vallès': `<path class="a" d="M70 128V66a50 50 0 0 1 100 0v62h-26V74a24 24 0 0 0-48 0v54z"/><rect class="b" x="110" y="20" width="20" height="30" rx="3"/>
    <circle class="c" cx="34" cy="100" r="24"/><rect class="d" x="31" y="112" width="6" height="18"/><circle class="c" cx="206" cy="96" r="22"/><rect class="d" x="203" y="108" width="6" height="20"/><circle class="y" cx="200" cy="30" r="13"/>`
};
// Cambiar de escuela o de grado con la app ya en marcha: lo de antes se guarda en S._antes hasta que acabes,
// así puedes volver atrás en cualquier paso sin perder nada. La rutina, tus planes y el estudio hecho no se tocan nunca.
function empezarCambio() {
  if (S.listo && !S._antes) S._antes = { escuela: S.escuela, grado: S.grado, asignaturas: [...(S.asignaturas || [])], grupos: { ...(S.grupos || {}) }, grupoComun: S.grupoComun, mismo: S.mismo };
}
async function deshacerCambio() {
  const a = S._antes; if (!a) return;
  Object.assign(S, a); delete S._antes; S.listo = true; save();
  try { if (D._id !== S.escuela) await loadEscuela(S.escuela); } catch {}
  toast('Todo sigue como estaba'); go('ajustes');
}
const avisoCambio = () => S._antes ? `<div class="notice cambio"><span>Estás cambiando de ${S._antes.escuela !== S.escuela ? 'escuela' : 'grado'}. Hasta que guardes, tus clases de antes siguen ahí.</span>
  <button type="button" class="btn small" id="deshacer">Dejarlo como estaba</button></div>` : '';
const bindCambio = () => { const b = $('#deshacer'); if (b) b.onclick = deshacerCambio; };

function viewGrado() {
  const v = $('#view'), ciudad = escInfo(D._id).ciudad;
  v.innerHTML = `
    <h1>¿Qué estudias?</h1>
    <p class="lead">${S.listo ? 'Puedes mirar otras escuelas tranquilamente: no se cambia nada hasta que tocas un grado.' : 'Elige tu escuela y tu grado, y cargamos tus clases, festivos y exámenes.'}</p>
    ${avisoCambio()}
    ${CIUDAD_ILU[ciudad] ? `<div class="escban"><svg class="ill" viewBox="0 0 240 160" aria-hidden="true">${CIUDAD_ILU[ciudad]}</svg>
      <div><b>${esc(escInfo(D._id).s)}</b><span>${esc(ciudad)}</span></div></div>` : ''}
    <label class="field"><span>Escuela (UPC)</span>
      <select id="escSel">${ESC.escuelas.map(e => `<option value="${esc(e.id)}" ${e.id === D._id ? 'selected' : ''}>${esc(e.s)} · ${esc(e.ciudad)}</option>`).join('')}</select>
      <small>${esc(escInfo(D._id).n)}</small>
    </label>
    ${D.escuela?.aprox ? `<p class="notice">Para esta escuela, los festivos y las semanas A/B son aproximados: las clases y los exámenes sí son los oficiales. Si ves algo raro, se puede cambiar.</p>` : ''}
    <div class="fixed">
      <span class="pill">Curso <b>${esc(D.periodo.curso.replace('-', '/'))} · ${esc(D.periodo.q)}</b></span>
    </div>
    <div class="stack" id="grados">
      ${D.grados.map(g => `
        <button class="choice" data-g="${esc(g.id)}" aria-pressed="${S.grado === g.id}">
          <span><b>${esc(g.n.replace(/^Grau (\(Fase Comuna\) )?en /, m => m.includes('Fase') ? 'Fase común: ' : ''))}</b>
          <span class="code">${esc(g.id)} · ${g.a.length} asignaturas</span></span>
        </button>`).join('')}
    </div>`;
  $('#escSel').onchange = async e => {
    const id = e.target.value;
    try { await loadEscuela(id); } catch { toast('No se han podido cargar los horarios de esa escuela.'); e.target.value = D._id; return; }
    // con la app en marcha, solo mirar otra escuela no cambia nada: el cambio empieza al tocar un grado
    if (!S.listo && S.escuela !== id) { S.escuela = id; S.grado = null; S.asignaturas = []; S.grupos = {}; save(); }
    viewGrado();
  };
  v.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    const g = b.dataset.g;
    if (S.listo && D._id === S.escuela && g === S.grado) { go('asignaturas'); return; } // mismo grado: solo revisar asignaturas
    empezarCambio();
    if (S.escuela !== D._id || S.grado !== g) {
      S.escuela = D._id; S.grado = g;
      // las asignaturas que también están en el nuevo grado se quedan marcadas, con su grupo
      const enGrado = new Set(grado().a);
      S.asignaturas = (S.asignaturas || []).filter(c => enGrado.has(c) && subj(c));
      S.grupos = Object.fromEntries(Object.entries(S.grupos || {}).filter(([c]) => S.asignaturas.includes(c)));
      S.listo = false; save();
    }
    go('asignaturas');
  });
  actions(`<button class="btn" id="back">${S._antes ? 'Cancelar' : 'Atrás'}</button><span class="info">Toca tu grado para seguir</span>`);
  bindCambio();
  $('#back').onclick = async () => {
    if (S._antes) return deshacerCambio();
    if (S.listo) { try { if (D._id !== S.escuela) await loadEscuela(S.escuela); } catch {} go('ajustes'); return; }
    go('bienvenida');
  };
}

/* ---------- 2. Asignaturas ---------- */
function viewAsignaturas() {
  const g = grado();
  S.asignaturas = S.asignaturas || [];
  const byCurso = {};
  for (const code of g.a) { const a = subj(code); (byCurso[a.c] = byCurso[a.c] || []).push(code); }
  const v = $('#view');
  v.innerHTML = `
    <h1>¿Qué asignaturas haces este cuatrimestre?</h1>
    <p class="lead">Marca un curso entero con un toque y luego añade o quita las que no encajen: repetidas, adelantadas u optativas.</p>
    ${avisoCambio()}
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
  bindCambio();
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
      <h1>¿En qué grupos estás?</h1>
      <p class="lead">El grupo de teoría se pone solo según tu subgrupo: los que empiezan por 1 van con la teoría 1 y los que empiezan por 2, con la 2.</p>
      ${avisoCambio()}
      <div class="toggle" role="group">
        <button data-m="1" aria-pressed="${S.mismo}">Mismo grupo en todas</button>
        <button data-m="0" aria-pressed="${!S.mismo}">Distinto en cada una</button>
      </div>
      ${S.mismo ? `<div class="card stack">
          <h2 class="card-t">Tu subgrupo</h2>
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
    bindCambio();
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
    <h1>Tu semana de clases</h1>
    <p class="lead">Las marcas A y B son laboratorios que solo tienes en semanas alternas. Toca un bloque para ver el detalle.</p>
    ${avisoCambio()}
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
    ${exams.length ? `<div class="card" style="margin-top:14px"><h2 class="card-t" style="margin-bottom:8px">Tus finales</h2>
      <div class="stack">${exams.map(({ c, e }) => { const d = new Date(e[1] + 'T12:00'); return `<div class="row" style="${colorVars(c)}"><span class="pill" style="font-family:var(--mono)">${DAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}</span><span>${esc(subj(c).n)}</span><span style="color:var(--muted);font-size:13px;font-family:var(--mono)">${e[2]}–${e[3]}</span></div>`; }).join('')}</div></div>` : ''}`;
  v.querySelectorAll('.blk').forEach(b => b.onclick = () => toast(b.title));
  bindCambio();
  // si estabas cambiando de escuela o grado, aquí acaba: tu rutina y lo demás ya estaban
  const cambio = !!S._antes;
  actions(`<button class="btn" id="back">Atrás</button><span class="info"></span><button class="btn primary" id="next">${S.listo || cambio ? 'Guardar' : 'Siguiente'}</button>`);
  $('#back').onclick = () => go('grupos');
  $('#next').onclick = () => {
    S.guardado = new Date().toISOString();
    if (cambio) { delete S._antes; S.listo = true; }
    save();
    if (S.listo) { toast(cambio ? 'Cambio guardado' : 'Horario guardado'); go('hoy'); } else go('rutina');
  };
}

/* ---------- 5. Rutina ---------- */
function viewRutina() {
  const R = S.rutina = { ...RUTINA_DEF, ...(S.rutina || {}) };
  const v = $('#view');
  const mins = (id, label, vals, val, hint = '') => `<label class="field"><span>${label}</span>
    <select id="${id}">${vals.map(m => `<option value="${m}" ${m === val ? 'selected' : ''}>${m === 0 ? 'Sin descanso' : dur(m)}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const time = (id, label, val, hint = '') => `<label class="field"><span>${label}</span><input type="time" id="${id}" value="${val}" step="300">${hint ? `<small>${hint}</small>` : ''}</label>`;
  v.innerHTML = `
    <h1>Tu día a día</h1>
    <p class="lead">Con esto calculamos tus horas libres de verdad, no solo los huecos entre clases. Son valores aproximados: los podrás cambiar cuando quieras.</p>
    <div class="stack">
      <section class="card stack"><h2 class="card-t">Ir a la uni</h2>
        <div class="fields">
          ${mins('trayecto', '¿Cuánto tardas en llegar?', [5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120], R.trayecto, 'Lo mismo a la vuelta.')}
          <label class="field"><span>Si tienes un hueco largo entre clases</span>
            <select id="volverCasa">${[[0, 'Me quedo en la uni'], [120, 'Vuelvo a casa si es de 2 h o más'], [180, 'Vuelvo a casa si es de 3 h o más'], [240, 'Vuelvo a casa si es de 4 h o más']]
              .map(([m, t]) => `<option value="${m}" ${m === Number(R.volverCasa) ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <small>Si vuelves, contamos la vuelta y la nueva ida.</small></label>
          ${mins('prep', 'Levantarte, prepararte y desayunar', [15, 30, 45, 60, 75, 90], R.prep)}
          ${time('despertarLibre', 'Días sin clase te levantas a las', R.despertarLibre)}
        </div></section>
      <section class="card stack"><h2 class="card-t">Academia</h2>
        <p class="hint" style="margin:0">¿Vas a academia? Añade tus clases: si es cerca de la uni, va con tu viaje a la uni (sin otra ida y vuelta).</p>
        ${Object.entries(S.eventos || {}).filter(([, e]) => e.tipo === 'academia').map(([id, e]) => `
          <button class="asrow" data-acad="${id}" style="--c:${evColor('academia')}"><span class="dot"></span><span class="asn"><b>${esc(e.titulo)}</b>
            <small>${e.repite ? e.repite.dias.map(i => DAYS_SHORT[i]).join(', ') : e.fecha} · ${e.ini}–${e.fin} · ${(ACAD_MODOS.find(m => m[0] === e.modo) || ACAD_MODOS[0])[1].toLowerCase()}</small></span>${ico('right')}</button>`).join('')}
        <button class="btn" id="addAcad" type="button">+ Añadir clase de academia</button>
      </section>
      <section class="card stack"><h2 class="card-t">Comidas y descansos</h2>
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
      <section class="card stack"><h2 class="card-t">Estudio</h2>
        <div class="fields">
          <label class="field"><span>Un día normal te ves estudiando</span><select id="estS">${[1, 1.5, 2, 3, 4].map(h => `<option value="${h}" ${(S.estMax?.semana ?? 2) === h ? 'selected' : ''}>${hfmt(h)}</option>`).join('')}</select></label>
          <label class="field"><span>Un día de fin de semana</span><select id="estF">${[0, 1, 2, 3, 4, 5].map(h => `<option value="${h}" ${(S.estMax?.finde ?? 3) === h ? 'selected' : ''}>${h ? hfmt(h) : 'Nada'}</option>`).join('')}</select></label>
          <label class="field wide"><span>¿Cuándo prefieres estudiar?</span><select id="estPref">${[['libre', 'Donde tenga más tiempo libre'], ['repartido', 'Repartido: mañana y tarde'], ['manana', 'Por la mañana'], ['tarde', 'Por la tarde'], ['noche', 'Por la noche']]
            .map(([k, t]) => `<option value="${k}" ${(S.estPref || 'libre') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </div>
        <small class="hint">Quatri te propone el estudio en tus huecos libres a esas horas, sin pasar de esto al día (en exámenes, más). Siempre lo puedes mover.</small></section>
      <section class="card stack"><h2 class="card-t">La noche</h2>
        <div class="fields">${time('dormir', 'Te vas a dormir a las', R.dormir)}</div>
        <label class="check"><input type="checkbox" id="estudiaNoche" ${R.estudiaNoche ? 'checked' : ''}> Estudio después de cenar</label>
        <small class="hint">Si no lo marcas, de la cena a la hora de dormir es tiempo libre para ti: no te ponemos estudio ahí.</small>
      </section>
    </div>`;
  const read = () => {
    for (const k of Object.keys(RUTINA_DEF)) {
      const el = $('#' + k); if (!el) continue;
      R[k] = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' ? Number(el.value) : el.value || RUTINA_DEF[k]);
    }
    $('#mBox').hidden = !R.merienda;
    S.estMax = { semana: Number($('#estS').value), finde: Number($('#estF').value) };
    S.estPref = $('#estPref').value;
    // estudiar por la noche implica poder estudiar después de cenar
    if (S.estPref === 'noche' && !R.estudiaNoche) { R.estudiaNoche = true; $('#estudiaNoche').checked = true; toast('Marcado «Estudio después de cenar» para poder estudiar por la noche'); }
    save();
  };
  v.querySelectorAll('input,select').forEach(el => el.onchange = read);
  $('#addAcad').onclick = () => openEvent(null, null, 17 * 60, 18 * 60 + 30, 'academia');
  v.querySelectorAll('[data-acad]').forEach(b => b.onclick = () => openEvent(b.dataset.acad));
  actions(`<button class="btn" id="back">Atrás</button><span class="info"></span><button class="btn primary" id="next">${S.listo ? 'Guardar' : 'Empezar'}</button>`);
  $('#back').onclick = () => go(S.listo ? 'hoy' : 'semana');
  $('#next').onclick = () => {
    read();
    if (S.listo) { toast('Rutina guardada'); go('hoy'); return; }
    S.listo = true; delete S._antes; save(); go('listo');
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
    <div class="welcome-top">
    <section class="hero">
      <h1 class="hero-t">Tu quatri,<br>bajo control<span class="dot">.</span></h1>
      <p class="lead">Quatri monta tu horario de la uni en dos minutos y te dice cuánto <b>tiempo libre te queda de verdad</b>: para estudiar, entrenar, trabajar o simplemente descansar.</p>
    </section>

    <div class="demo" aria-label="Ejemplo de un día en Quatri">
      <div class="demo-head"><span class="demo-t">Ejemplo · un martes cualquiera</span><span class="pill free-pill">3 h 45 min libres de verdad</span></div>
      <ul class="timeline">${demo.map(([a, b, k, t, s, col]) => `
        <li class="it ${k}" style="${col ? `--c:${col[1]};--cb:${col[0]}` : k === 'evento' ? '--ev:#E8590C' : ''}"><span class="t">${a}<br><small>${b}</small></span>
        <span class="n"><b>${t}</b>${s ? `<small>${s}</small>` : ''}</span></li>`).join('')}</ul>
    </div>
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
      <li><b>Tu escuela y tu grado</b><span>Para saber qué asignaturas y horarios cargar.</span></li>
      <li><b>Tus asignaturas</b><span>Las de este cuatrimestre, aunque sean de cursos distintos.</span></li>
      <li><b>Tus grupos</b><span>Tu subgrupo de laboratorio o problemas; la teoría se pone sola.</span></li>
      <li><b>Revisa tu semana</b><span>Ves tu horario y te avisamos si alguna clase se pisa.</span></li>
      <li><b>Tu día a día</b><span>Cuánto tardas en llegar, a qué hora comes, cenas y duermes.</span></li>
    </ol>

    <div class="trust">
      <span>${ico('check')}Gratis y sin anuncios</span>
      <span>${ico('check')}Con tu cuenta de Google o tu correo, lo tienes igual en el móvil y el ordenador</span>
      <span>${ico('check')}Horarios oficiales del Visor d'Horaris UPC</span>
    </div>
    <p class="hint" style="margin-top:12px">Ahora mismo, Quatri tiene los horarios de ${ESC.escuelas.length} escuelas de la UPC (${ESC.escuelas.map(e => esc(e.s)).join(', ')}) para el ${esc(D.periodo.curso.replace('-', '/'))} ${esc(D.periodo.q)}.</p>`;
  if (S.listo) {
    actions(`<span class="info">Así funciona Quatri</span><button class="btn primary" id="next">Volver</button>`);
    $('#next').onclick = () => go('ajustes');
  } else {
    // quien ya tiene cuenta (por ejemplo, la usa en el móvil y ahora abre el ordenador) entra y recupera todo
    actions(USER ? `<span class="info">Conectado · ${esc(USER.email)}</span><button class="btn primary" id="next">Empezar</button>`
      : `<button class="btn" id="login">Ya tengo cuenta</button><span class="info"></span><button class="btn primary" id="next">Empezar</button>`);
    $('#next').onclick = () => go('grado');
    if ($('#login')) $('#login').onclick = openLogin;
  }
}

/* ---------- todo listo ---------- */
// Se ve una vez, al terminar el alta: lo que ya tienes y cómo se usa cada pestaña.
function viewListo() {
  const today = new Date(), mon = mondayOf(today);
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => dayPlan(dkey(addDays(mon, i))));
  const freeMin = week.reduce((n, p) => n + p.freeMin, 0), classMin = week.reduce((n, p) => n + p.classMin, 0);
  const tk = dkey(today);
  const ex = (S.asignaturas || []).flatMap(c => examsOf(c).filter(e => e[1] >= tk).map(e => ({ c, e })))
    .sort((a, b) => a.e[1].localeCompare(b.e[1]))[0];
  const exDays = ex ? Math.round((dparse(ex.e[1]) - dparse(tk)) / 864e5) : null;
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const tour = [
    ['hoy', 'Hoy', 'Tu día hora a hora. Los huecos verdes son tiempo libre: tócalos para añadir algo. Desliza para cambiar de día.'],
    ['cal', 'Calendario', 'Tu semana y tu mes de un vistazo, con festivos, semanas A/B y exámenes.'],
    ['est', 'Estudio', 'Dinos cómo llevas cada asignatura y te proponemos cuántas horas dedicarle esta semana.'],
    ['gear', 'Ajustes', 'Cambia tu rutina, grupos o asignaturas cuando quieras, y elige modo claro u oscuro.'],
  ];
  const v = $('#view');
  v.innerHTML = `
    <section class="hero">
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
      ${tour.map(([ic, t, d]) => `<div class="feat"><span class="num ic" aria-hidden="true">${ico(ic)}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
      <div class="feat hi"><span class="num ic" aria-hidden="true">+</span><div><b>Añade tu vida</b>
        <p>Con el botón + apuntas entrenos, trabajo o planes. Si les pones trayecto, también lo descontamos de tu tiempo libre.</p></div></div>
    </div>
    ${USER ? '' : `<section class="card stack" style="margin-top:14px"><b>Guarda tu quatri en tu cuenta</b>
      <span class="hint" style="margin:0">Así no lo pierdes si cambias de móvil y lo tienes también en el ordenador. Con Google es un toque.</span>
      <button class="btn" id="lsIn" style="align-self:flex-start">Entrar o crear cuenta</button></section>`}
    ${installed ? '' : `<div class="notice warn" style="margin-top:14px"><b>Tenla a mano como una app.</b> ${ios
      ? 'En Safari, toca Compartir y luego «Añadir a pantalla de inicio».'
      : 'En el menú del navegador, elige «Instalar app» o «Añadir a pantalla de inicio».'}</div>`}`;
  actions(`<span class="info"></span><button class="btn primary" id="next">Ir a mi día</button>`);
  $('#next').onclick = () => { S.dia = dkey(new Date()); save(); go('hoy'); };
  if ($('#lsIn')) $('#lsIn').onclick = openLogin;
}

/* ---------- eventos propios ---------- */
const EV_TYPES = [['academia', 'Academia', '#9C36B5'], ['entreno', 'Entreno', '#E8590C'], ['trabajo', 'Trabajo', '#5F3DC4'], ['partido', 'Partido', '#C2255C'],
  ['plan', 'Plan', '#1971C2'], ['viaje', 'Viaje', '#2B8A3E'], ['estudio', 'Estudio', '#0B7285'], ['otro', 'Otro', '#495057']];
const EV_NAME = Object.fromEntries(EV_TYPES.map(t => [t[0], t[1]]));
// Academia: dónde es. "uni" = cerca de la uni (comparte el viaje a la uni), "otro" = con su propio trayecto, "online" = desde casa
const ACAD_MODOS = [['uni', 'Cerca de la uni'], ['otro', 'En otro sitio'], ['online', 'Online']];
const evColor = tipo => (EV_TYPES.find(t => t[0] === tipo) || EV_TYPES.find(t => t[0] === 'otro'))[2];
function eventsOn(ds) {
  const out = [], wd = (dparse(ds).getDay() + 6) % 7;
  for (const [id, ev] of Object.entries(S.eventos || {})) {
    // un viaje va de un día y hora a otro día y hora: los días de en medio quedan enteros
    if (ev.tipo === 'viaje' && ev.fechaFin) {
      if (ds >= ev.fecha && ds <= ev.fechaFin) out.push({ id, ev, s: ds === ev.fecha ? toMin(ev.ini) : 0, e: ds === ev.fechaFin ? toMin(ev.fin) : 1440 });
      continue;
    }
    let hit;
    if (ev.repite) hit = ds >= ev.fecha && (!ev.repite.hasta || ds <= ev.repite.hasta) && ev.repite.dias.includes(wd) && !(ev.excepciones || []).includes(ds);
    else hit = ev.fecha === ds;
    if (hit) out.push({ id, ev, s: ev.todoDia ? 0 : toMin(ev.ini), e: ev.todoDia ? 1440 : (ev.fin === '00:00' ? 1440 : toMin(ev.fin)) });
  }
  return out.sort((a, b) => a.s - b.s);
}
const newId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function openEvent(id, ds, sMin, eMin, tipo0) {
  const ev = id ? S.eventos[id] : null;
  ds = ds || dkey(new Date());
  const F = { tipo: ev?.tipo || tipo0 || 'plan', dias: new Set(ev?.repite?.dias || []), modo: ev?.modo || 'uni' };
  // una clase de academia nueva se repite cada semana ese día (lo normal)
  const repIni = !!ev?.repite || (!ev && tipo0 === 'academia');
  if (!ev && tipo0 === 'academia') F.dias.add(wdOf(dparse(ds)));
  const s0 = sMin ?? 17 * 60, e0 = eMin ?? Math.min(s0 + 60, 23 * 60 + 55);
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `
    <form class="sheet" novalidate>
      <header><h2>${ev ? 'Editar evento' : 'Nuevo evento'}</h2><button type="button" class="icon" data-x aria-label="Cerrar">${ico('x')}</button></header>
      <label class="field"><span>Qué es</span><input id="evT" maxlength="60" placeholder="Ej.: Entreno en pista" value="${esc(ev?.titulo || '')}" autocomplete="off"></label>
      <div class="field"><span>Tipo</span><div class="evtypes">${EV_TYPES.map(([k, n, c]) => `<button type="button" data-t="${k}" style="--ev:${c}" aria-pressed="${F.tipo === k}">${n}</button>`).join('')}</div></div>
      <div id="evAcad" class="stack" hidden>
        <label class="field"><span>Asignatura</span><select id="evA"><option value="">Otra / varias</option>${(S.asignaturas || []).filter(c => subj(c)).map(c => `<option value="${c}" ${ev?.asig === c ? 'selected' : ''}>${esc(subj(c).n)}</option>`).join('')}</select></label>
        <div class="field"><span>Dónde es</span><div class="seg2" role="group" style="margin:0">${ACAD_MODOS.map(([k, n]) => `<button type="button" data-m="${k}">${n}</button>`).join('')}</div>
          <small id="evAHint"></small></div>
      </div>
      <div id="evViaje" class="stack" hidden>
        <div class="fields">
          <label class="field"><span>Te vas el</span><input type="date" id="evVD" value="${ev?.fecha || ds}"></label>
          <label class="field"><span>a las</span><input type="time" id="evVI" step="300" value="${ev?.tipo === 'viaje' && ev.ini ? ev.ini : '16:00'}"></label>
          <label class="field"><span>Vuelves el</span><input type="date" id="evVF" value="${ev?.fechaFin || dkey(addDays(dparse(ds), 2))}"></label>
          <label class="field"><span>a las</span><input type="time" id="evVH" step="300" value="${ev?.tipo === 'viaje' && ev.fin ? ev.fin : '18:00'}"></label>
        </div>
        <small class="hint">Mientras estás fuera no te proponemos estudio: las horas de esa semana se recolocan en los otros días.</small>
      </div>
      <div id="evNormal" class="stack">
      <label class="field"><span>Día</span><input type="date" id="evD" value="${ev?.fecha || ds}"></label>
      <label class="check"><input type="checkbox" id="evAll" ${ev?.todoDia ? 'checked' : ''}> Todo el día</label>
      <div class="fields" id="evTimes" ${ev?.todoDia ? 'hidden' : ''}>
        <label class="field"><span>Empieza</span><input type="time" id="evI" step="300" value="${ev?.ini || fmt(s0)}"></label>
        <label class="field"><span>Acaba</span><input type="time" id="evF" step="300" value="${ev?.fin || fmt(e0 % 1440)}"></label>
        <label class="field wide" id="evTrBox"><span>Tardas en llegar</span><select id="evTr">${[0, 5, 10, 15, 20, 25, 30, 40, 45, 60, 75, 90].map(m => `<option value="${m}" ${Number(ev?.trayecto || 0) === m ? 'selected' : ''}>${m ? dur(m) : 'Es en casa / no cuenta'}</option>`).join('')}</select><small>Se añade la ida antes y la vuelta después.</small></label>
      </div>
      <label class="check"><input type="checkbox" id="evRep" ${repIni ? 'checked' : ''}> Se repite cada semana</label>
      <div id="evRepBox" class="stack" ${repIni ? '' : 'hidden'}>
        <div class="evdays">${DAYS_SHORT.map((d, i) => `<button type="button" data-d="${i}" aria-pressed="${F.dias.has(i)}">${d}</button>`).join('')}</div>
        <label class="field"><span>Hasta (opcional)</span><input type="date" id="evH" value="${ev?.repite?.hasta || ''}"></label>
      </div>
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
  // el viaje tiene salida y vuelta (puede durar varios días); el resto, día y horas
  // academia: asignatura y dónde es; si es cerca de la uni u online, no lleva trayecto propio
  const modo = () => {
    const v = F.tipo === 'viaje', ac = F.tipo === 'academia';
    q('#evViaje').hidden = !v; q('#evNormal').hidden = v; q('#evAcad').hidden = !ac;
    q('#evTrBox').hidden = ac && F.modo !== 'otro';
    ov.querySelectorAll('[data-m]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === F.modo)));
    q('#evAHint').textContent = F.modo === 'uni' ? 'Va con tu viaje a la uni: una sola ida y una sola vuelta ese día.'
      : F.modo === 'online' ? 'Desde casa: sin trayecto.' : 'Pon abajo cuánto tardas en llegar.';
  };
  ov.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { F.modo = b.dataset.m; modo(); });
  ov.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { F.tipo = b.dataset.t; ov.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); modo(); });
  modo();
  ov.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const i = +b.dataset.d; F.dias.has(i) ? F.dias.delete(i) : F.dias.add(i); b.setAttribute('aria-pressed', String(F.dias.has(i))); });
  q('#evAll').onchange = () => { q('#evTimes').hidden = q('#evAll').checked; };
  // para poder deshacer: cómo estaban tus eventos antes de este cambio
  const antes = JSON.stringify(S.eventos || {});
  const deshacer = () => { S.eventos = JSON.parse(antes); save(); render(); toast('Deshecho'); };
  q('#evRep').onchange = () => {
    q('#evRepBox').hidden = !q('#evRep').checked;
    if (q('#evRep').checked && !F.dias.size && q('#evD').value) { const i = wdOf(dparse(q('#evD').value)); F.dias.add(i); q(`[data-d="${i}"]`).setAttribute('aria-pressed', 'true'); }
  };
  const err = m => { q('#evErr').textContent = m; q('#evErr').hidden = false; };
  q('form').onsubmit = e => {
    e.preventDefault();
    if (F.tipo === 'viaje') {
      const titulo = q('#evT').value.trim() || 'Viaje', a = q('#evVD').value, ai = q('#evVI').value, b = q('#evVF').value, bi = q('#evVH').value;
      if (!a || !b || !ai || !bi) return err('Indica cuándo te vas y cuándo vuelves.');
      if (b + bi <= a + ai) return err('La vuelta tiene que ser después de la salida.');
      S.eventos = S.eventos || {};
      S.eventos[id || newId()] = { titulo, tipo: 'viaje', fecha: a, ini: ai, fechaFin: b, fin: bi, todoDia: false, trayecto: 0, lugar: q('#evL').value.trim(), repite: null, excepciones: [] };
      save(); close(); toast(id ? 'Viaje actualizado' : 'Viaje guardado', id ? deshacer : null); render();
      return;
    }
    const ac = F.tipo === 'academia', asig = ac ? q('#evA').value : '';
    const titulo = q('#evT').value.trim() || (ac ? `Academia${asig ? ' · ' + (subj(asig).s || subj(asig).n) : ''}` : ''), fecha = q('#evD').value, todoDia = q('#evAll').checked;
    const ini = q('#evI').value, fin = q('#evF').value;
    if (!titulo) return err('Ponle un nombre, por ejemplo "Entreno" o "Trabajo".');
    if (!fecha) return err('Elige el día.');
    if (!todoDia && (!ini || !fin)) return err('Indica la hora de inicio y de fin.');
    if (!todoDia && fin !== '00:00' && toMin(fin) <= toMin(ini)) return err('La hora de fin tiene que ser posterior a la de inicio.');
    const data = { titulo, tipo: F.tipo, fecha, todoDia, ini: todoDia ? '' : ini, fin: todoDia ? '' : fin,
      trayecto: todoDia || (ac && F.modo !== 'otro') ? 0 : Number(q('#evTr').value), lugar: q('#evL').value.trim(), repite: null, excepciones: ev?.excepciones || [] };
    if (ac) { data.asig = asig; data.modo = F.modo; }
    if (q('#evRep').checked) {
      if (!F.dias.size) return err('Elige al menos un día de la semana.');
      const hasta = q('#evH').value;
      if (hasta && hasta < fecha) return err('La fecha "hasta" tiene que ser posterior al primer día.');
      data.repite = { dias: [...F.dias].sort(), hasta };
    } else data.excepciones = [];
    S.eventos = S.eventos || {};
    S.eventos[id || newId()] = data;
    save(); close(); toast(id ? 'Evento actualizado' : 'Evento guardado', id ? deshacer : null); render();
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
    q('#dAll').onclick = () => { delete S.eventos[id]; save(); close(); toast('Evento eliminado', deshacer); render(); };
    if (q('#dOne')) q('#dOne').onclick = () => { ev.excepciones = [...new Set([...(ev.excepciones || []), ds])]; save(); close(); toast('Eliminado solo ese día', deshacer); render(); };
  };
  setTimeout(() => { if (!ev) q('#evT').focus(); }, 50);
}
/* ---------- ¿vas a esta clase? ---------- */
function openClase(ds, ck) {
  const s = mySessions().find(x => clsKey(x) === ck);
  if (!s) return;
  const x = s.x, a = subj(s.code), d = dparse(ds);
  S.faltas = S.faltas || {}; S.noVoy = S.noVoy || {};
  const dk = ds + '|' + ck, punt = S.faltas[dk], reg = S.noVoy[ck];
  const F = {
    siempre: !!reg,
    hoy: punt ? (punt.voy ? 'voy' : 'no') : (reg ? 'no' : 'voy'),
    estudio: (punt && !punt.voy ? punt.estudio : reg?.estudio) || 'no',
    est: (punt && !punt.voy ? punt.est : reg?.est) || s.code,
  };
  const dia = DAYS[x[0]].toLowerCase();
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `
    <form class="sheet" novalidate style="${colorVars(s.code)}">
      <header><h2>${esc(a.n)}</h2><button type="button" class="icon" data-x aria-label="Cerrar">${ico('x')}</button></header>
      <p class="hint" style="margin:-6px 0 0">${TYPE[x[3]] || x[3]} · ${x[1]}–${x[2]} · grupo ${esc(s.group)} · ${esc(x[4].replace(/ - Lab\..*/, ''))}</p>
      <div class="field"><span>El ${dia} ${d.getDate()} de ${MONTHS[d.getMonth()]}</span>
        <div class="seg2" role="group" style="margin:0">
          <button type="button" data-hoy="voy">Voy a clase</button>
          <button type="button" data-hoy="no">No voy</button>
        </div></div>
      <label class="check"><input type="checkbox" id="cSiempre" ${F.siempre ? 'checked' : ''}> No voy nunca a esta clase (todos los ${dia} a las ${hh(x[1])})</label>
      <div class="field" id="cEst"><span>En vez de la clase</span>
        <div class="seg2 three" role="group" style="margin:0">
          <button type="button" data-est="no">Tiempo libre</button>
          <button type="button" data-est="casa">Estudiar en casa</button>
          <button type="button" data-est="uni">Estudiar en la uni</button>
        </div>
        <small>Si ese día no tienes nada más en la uni y no vas, tampoco contamos el trayecto.</small></div>
      <label class="field" id="cEstCode"><span>¿Qué estudias?</span>
        <select id="cEc">${(S.asignaturas || []).map(c => `<option value="${c}" ${c === F.est ? 'selected' : ''}>${esc(subj(c).n)}${c === s.code ? ' (esta clase)' : ''}</option>`).join('')}</select>
        <small>Cuenta como horas de estudio de esa asignatura en la pestaña Estudio.</small></label>
      <footer><span class="sp"></span>
        <button type="button" class="btn" data-x>Cancelar</button>
        <button type="submit" class="btn primary">Guardar</button>
      </footer>
    </form>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const q = sel => ov.querySelector(sel);
  const close = () => { ov.remove(); document.body.style.overflow = ''; };
  ov.querySelectorAll('[data-x]').forEach(b => b.onclick = close);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  const paint = () => {
    ov.querySelectorAll('[data-hoy]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.hoy === F.hoy)));
    ov.querySelectorAll('[data-est]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.est === F.estudio)));
    q('#cEst').hidden = F.hoy === 'voy' && !F.siempre;
    q('#cEstCode').hidden = q('#cEst').hidden || F.estudio === 'no';
  };
  ov.querySelectorAll('[data-hoy]').forEach(b => b.onclick = () => { F.hoy = b.dataset.hoy; paint(); });
  ov.querySelectorAll('[data-est]').forEach(b => b.onclick = () => { F.estudio = b.dataset.est; paint(); });
  q('#cSiempre').onchange = () => { F.siempre = q('#cSiempre').checked; F.hoy = F.siempre ? 'no' : 'voy'; paint(); };
  paint();
  q('form').onsubmit = e => {
    e.preventDefault();
    delete S.faltas[dk];
    if (F.siempre) {
      S.noVoy[ck] = { estudio: F.estudio, est: q('#cEc').value };
      if (F.hoy === 'voy') S.faltas[dk] = { voy: true }; // este día sí vas, aunque normalmente no
    } else {
      delete S.noVoy[ck];
      if (F.hoy === 'no') S.faltas[dk] = { estudio: F.estudio, est: q('#cEc').value };
    }
    save(); close();
    toast(F.siempre ? `Guardado para todos los ${dia}` : F.hoy === 'no' ? 'Guardado solo para este día' : 'Vas a clase');
    render();
  };
}

/* ---------- bloques de estudio propuestos por Quatri ---------- */
function sheet(html) {
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `<form class="sheet" novalidate>${html}</form>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const close = () => { ov.remove(); document.body.style.overflow = ''; };
  ov.querySelectorAll('[data-x]').forEach(b => b.onclick = close);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  return { q: s => ov.querySelector(s), close };
}
function openPlan(ds, s, e, code, tema, fijoId) {
  const d = dparse(ds), len = e - s, today = dkey(new Date());
  // días a los que se puede mover: los de su ventana de 7 días, desde hoy
  const st = estStartOf(ds) || today;
  const dias = [0, 1, 2, 3, 4, 5, 6].map(i => dkey(addDays(dparse(st), i))).filter(k => k >= today);
  const { q, close } = sheet(`
    <header><h2>Estudio · ${esc(subj(code).n)}</h2><button type="button" class="icon" data-x aria-label="Cerrar">${ico('x')}</button></header>
    <p class="hint" style="margin:-6px 0 0">${DAYS[wdOf(d)]} ${d.getDate()} · ${fmt(s % 1440)}–${fmt(e % 1440)}${tema ? ` · ${esc(tema)}` : ''}</p>
    <p style="margin:0">${fijoId && !S.estFijo?.[fijoId]?.auto ? 'Lo moviste tú a esta hora.' : nextExam(code, ds) ? 'Es una propuesta de Quatri para llegar bien al examen.' : 'Es una propuesta de Quatri para llevar la asignatura al día.'} Cuando lo hayas hecho, márcalo; si prefieres otra asignatura u otro rato, cámbialo.</p>
    <div id="pMove" class="stack" hidden>
      <label class="field"><span>Asignatura</span><select id="pA">${(S.asignaturas || []).filter(c => subj(c)).map(c => `<option value="${c}" ${c === code ? 'selected' : ''}>${esc(subj(c).n)}</option>`).join('')}</select></label>
      <div class="fields">
        <label class="field"><span>Día</span><select id="pD">${dias.map(k => { const x = dparse(k); return `<option value="${k}" ${k === ds ? 'selected' : ''}>${k === today ? 'Hoy' : DAYS[wdOf(x)]} ${x.getDate()}</option>`; }).join('')}</select></label>
        <label class="field"><span>Empieza</span><input type="time" id="pI" step="300" value="${fmt(s % 1440)}"></label>
      </div>
      <div class="adj-row"><span class="adj-n">Duración<small id="pFin"></small></span>
        <div class="stepper"><button type="button" data-dl="-15" aria-label="Acortar 15 minutos">−</button><output id="pL"></output><button type="button" data-dl="15" aria-label="Alargar 15 minutos">+</button></div></div>
      <small class="hint">El resto de tu estudio se recoloca solo: si lo alargas, a otros días les toca algo menos; si cambias de asignatura, las horas de la otra van a otro hueco.</small>
      <p class="err" id="pErr" hidden></p>
    </div>
    <footer>
      <button type="button" class="btn" id="pSkip">${fijoId ? 'Quitar' : 'Saltar'}</button>
      <button type="button" class="btn" id="pCancel" hidden>Cancelar</button>
      <span class="sp"></span>
      <button type="button" class="btn" id="pMv">Cambiar</button>
      <button type="button" class="btn primary" id="pDone">${ico('check')} Hecho</button>
    </footer>`);
  const quitarFijo = () => { if (fijoId && S.estFijo) delete S.estFijo[fijoId]; };
  // duración: de 15 en 15 min, entre 30 min y 4 h
  let dl = len;
  const pintaDl = () => {
    q('#pL').textContent = dur(dl);
    const i = q('#pI').value; q('#pFin').textContent = i ? `Hasta las ${fmt((toMin(i) + dl) % 1440)}` : '';
    q('[data-dl="-15"]').disabled = dl <= 30; q('[data-dl="15"]').disabled = dl >= 240;
  };
  q('#pMove').querySelectorAll('[data-dl]').forEach(b => b.onclick = () => { dl = Math.min(240, Math.max(30, dl + Number(b.dataset.dl))); pintaDl(); });
  q('#pI').oninput = pintaDl;
  pintaDl();
  q('#pDone').onclick = () => { close(); marcarHecho(ds, s, e, code, fijoId); };
  q('#pCancel').onclick = () => {
    q('#pMove').hidden = true; q('#pErr').hidden = true; q('#pMv').textContent = 'Cambiar'; q('#pMv').classList.remove('primary');
    q('#pDone').hidden = q('#pSkip').hidden = false; q('#pCancel').hidden = true;
  };
  q('#pSkip').onclick = () => {
    // bloques de esa asignatura en la semana, para decir luego adónde ha ido (o que no cabe)
    const semana = () => { const w = weekSchedule(estStartOf(ds) || estStart()); return Object.keys(w).filter(k => k !== '_sinHueco')
      .flatMap(k => w[k].filter(b => b.code === code).map(b => ({ k, s: b.s, e: b.e, id: `${k}|${b.s}|${b.e}` }))); };
    const antes = new Set(semana().map(b => b.id));
    S.estSkip = S.estSkip || {};
    (S.estSkip[ds] = S.estSkip[ds] || []).push({ s, e });
    quitarFijo();
    save(); close();
    const nuevo = semana().find(b => !antes.has(b.id) && !(b.k === ds && b.s === s));
    if (nuevo) {
      const x = dparse(nuevo.k), dia = nuevo.k === dkey(new Date()) ? 'hoy' : nuevo.k === dkey(addDays(new Date(), 1)) ? 'mañana' : `el ${DAYS[wdOf(x)].toLowerCase()} ${x.getDate()}`;
      toast(`Recolocado ${dia} a las ${fmt(nuevo.s % 1440)}`);
    } else toast(`${fijoId ? 'Quitado' : 'Saltado'}. Esta semana no queda otro hueco libre para ${subj(code).s || 'esta asignatura'}: esas horas se quedan sin hacer.`);
    render();
  };
  q('#pMv').onclick = () => {
    const box = q('#pMove');
    // al cambiar, solo quedan "Cancelar" y "Guardar" (sin "Hecho", para no confundirlos)
    if (box.hidden) {
      box.hidden = false; q('#pMv').textContent = 'Guardar'; q('#pMv').classList.add('primary');
      q('#pDone').hidden = q('#pSkip').hidden = true; q('#pCancel').hidden = false; return;
    }
    const nd = q('#pD').value, ni = q('#pI').value, nc = q('#pA').value || code;
    const err = m => { q('#pErr').textContent = m; q('#pErr').hidden = false; };
    if (!ni) return err('Elige la hora.');
    const ns = toMin(ni), ne = ns + dl;
    // no puede pisar clases, comidas, eventos ni otros bloques tuyos
    const p = dayPlan(nd);
    const choque = p.blocks.find(b => b.kind !== 'noche' && b.s < ne && ns < b.e);
    if (choque) return err(`A esa hora tienes ${choque.kind === 'clase' ? 'clase de ' + choque.label : choque.label.toLowerCase()} (${fmt(choque.s % 1440)}–${fmt(choque.e % 1440)}).`);
    const otro = Object.entries(S.estFijo || {}).find(([id, f]) => id !== fijoId && f.ds === nd && f.s < ne && ns < f.e);
    if (otro) return err('A esa hora ya tienes otro bloque de estudio que has movido.');
    if (ne > p.sleep) return err('Acabaría después de tu hora de dormir.');
    S.estFijo = S.estFijo || {};
    if (nc !== code && examsOf(nc).some(x => x[1] === nd && x[0] !== 'entrega')) return err(`Ese día tienes el examen de ${subj(nc).n}.`);
    if (nd === ds && ns === s && ne === e && nc === code) { close(); return; }
    S.estFijo[fijoId || newId()] = { ds: nd, s: ns, e: ne, code: nc, t: '' };
    save(); close();
    toast(nc !== code ? `Ahora estudias ${subj(nc).n}` : nd === ds && ns === s ? (dl > len ? `Alargado a ${dur(dl)}` : `Acortado a ${dur(dl)}`) : 'Bloque movido'); render();
  };
}
function openDone(id) {
  const h = (S.estDone || {})[id];
  if (!h) return;
  const { q, close } = sheet(`
    <header><h2>Estudio · ${esc(subj(h.code).n)}</h2><button type="button" class="icon" data-x aria-label="Cerrar">${ico('x')}</button></header>
    <p style="margin:0">Hecho: ${fmt(h.s % 1440)}–${fmt(h.e % 1440)}${h.t ? ` · ${esc(h.t)}` : ''}. Cuenta como horas de estudio de la semana.</p>
    <footer><button type="button" class="btn" id="dUndo">No lo hice, deshacer</button><span class="sp"></span><button type="button" class="btn primary" data-x>Cerrar</button></footer>`);
  q('#dUndo').onclick = () => { delete S.estDone[id]; save(); close(); toast('Deshecho'); render(); };
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
      <header><h2>Tu rutina del ${DAYS[wdOf(d)].toLowerCase()} ${d.getDate()}</h2><button type="button" class="icon" data-x aria-label="Cerrar">${ico('x')}</button></header>
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
  if (!b) { b = document.createElement('button'); b.id = 'fab'; b.className = 'fab'; b.setAttribute('aria-label', 'Nuevo evento'); b.innerHTML = ico('plus'); document.body.appendChild(b); }
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
  const d = dparse(ds), mon = dkey(mondayOf(d)), sem = D.calendario.semanas || {}; // hay escuelas sin semanas A/B
  for (const t of ['A', 'B']) for (const start of sem[t] || []) {
    if (dkey(mondayOf(dparse(start))) === mon && ds >= start) return t;
  }
  return null;
}
// Último día del primer bimestre: el que diga el calendario o, si no, el final de los parciales (o la mitad del cuatrimestre)
function finBimestre1() {
  const c = D.calendario;
  if (c.fin_bimestre1) return c.fin_bimestre1;
  if (c.periodo_parciales) return c.periodo_parciales[1];
  const a = dparse(c.inicio_clases), b = dparse(c.fin_clases);
  return dkey(new Date((a.getTime() + b.getTime()) / 2));
}
// ¿Esta sesión toca este día? Semanas A/B, bimestres (B1 / B2) y sesiones con fechas propias (x[6] a x[7])
function sesionHoy(x, ds, info) {
  const p = x[5];
  if (p && p.length === 1 && p !== info.week) return false;
  if (p === 'B1' && ds > finBimestre1()) return false;
  if (p === 'B2' && ds <= finBimestre1()) return false;
  if (x[6] && (ds < x[6] || ds > (x[7] || x[6]))) return false;
  // días exactos (MMDD): laboratorios de días sueltos, o escuelas que publican cada clase con su fecha
  if (x[8] && !x[8].includes(+ds.slice(5, 7) * 100 + +ds.slice(8, 10))) return false;
  return true;
}
function dayInfo(ds) {
  const c = D.calendario, d = dparse(ds), wd = wdOf(d);
  const inPeriod = ds >= c.inicio_clases && ds <= c.fin_clases;
  const lective = inPeriod && wd < 5 && !(c.dias_sin_clase || []).includes(ds);
  const finales = c.periodo_finales && ds >= c.periodo_finales[0] && ds <= c.periodo_finales[1];
  // días con horario de otro día ("el miércoles 14 tiene horario de lunes")
  const cambio = (c.cambio_dia || {})[ds];
  let note = '';
  if (wd >= 5) note = 'Fin de semana';
  else if (inPeriod && !lective) note = 'Día sin clases';
  else if (finales) note = 'Período de exámenes finales';
  else if (!inPeriod && ds > c.fin_clases) note = 'Sin clases (vacaciones o exámenes)';
  else if (lective && cambio != null) note = `Hoy va con horario de ${DAYS[cambio].toLowerCase()}`;
  return { d, wd, clsWd: lective && cambio != null ? cambio : wd, lective, week: lective ? weekType(ds) : null, note };
}
// Clases a las que no vas. S.noVoy[clave] = siempre (cada semana); S.faltas['fecha|clave'] = solo ese día.
// { estudio: 'no' | 'casa' | 'uni' }, o { voy: true } para ir un día concreto aunque normalmente no vayas.
const clsKey = s => [s.code, s.group, s.x[0], s.x[1], s.x[3], s.x[5] || ''].join('|');
function clsSkip(ds, ck) {
  const d = (S.faltas || {})[ds + '|' + ck], r = (S.noVoy || {})[ck];
  if (d) return d.voy ? null : { ...d, siempre: false };
  return r ? { ...r, siempre: true } : null;
}
/* ---------- rutina de exámenes ----------
   Se aplica sola en época de parciales y desde que acaban las clases hasta el último final.
   S.rutinaEx = { activa, estudiaNoche, cena, dormir, maxSemana, maxFinde, pausar: [tipos de evento] } */
const RUTINA_EX_DEF = { activa: true, estudiaNoche: true, cena: '', dormir: '', maxSemana: 6, maxFinde: 6, pausar: [] };
const rutinaEx = () => ({ ...RUTINA_EX_DEF, ...(S.rutinaEx || {}) });
function examPeriods() {
  const c = D.calendario, out = [];
  if (c.periodo_parciales) out.push({ n: 'parciales', a: c.periodo_parciales[0], b: c.periodo_parciales[1] });
  if (c.periodo_finales) out.push({ n: 'finales', a: dkey(addDays(dparse(c.fin_clases), 1)), b: c.periodo_finales[1] });
  return out;
}
const exRut = ds => { const X = rutinaEx(); return X.activa && examPeriods().some(p => ds >= p.a && ds <= p.b) ? X : null; };
// Tope de estudio al día que coloca Quatri (horas): normal o el de la rutina de exámenes
function estMax(ds) {
  const fin = wdOf(dparse(ds)) >= 5, X = exRut(ds);
  if (X) return fin ? X.maxFinde : X.maxSemana;
  const m = S.estMax || {};
  return fin ? (m.finde ?? 3) : (m.semana ?? 2);
}

function dayPlan(ds) {
  const X = exRut(ds);
  const R = { ...RUTINA_DEF, ...(S.rutina || {}) };
  if (X) { R.estudiaNoche = X.estudiaNoche; if (X.cena) R.cena = X.cena; if (X.dormir) R.dormir = X.dormir; }
  const info = dayInfo(ds);
  const blocks = [], skipped = [];
  if (info.lective) {
    const hoy = mySessions().filter(s => s.x[0] === info.clsWd && sesionHoy(s.x, ds, info));
    // laboratorios que se turnan en el mismo hueco (EEBE: Cinemàtica en sus fechas, Resistència el resto de
    // semanas B): si una sesión con fecha concreta coincide a la misma hora con otra semanal, ese día va la de la fecha
    const conFecha = hoy.filter(s => s.x[8]);
    const tapada = s => !s.x[8] && conFecha.some(t => t.code !== s.code && toMin(t.x[1]) < toMin(s.x[2]) && toMin(s.x[1]) < toMin(t.x[2]));
    for (const s of hoy) {
      const x = s.x;
      if (tapada(s)) continue;
      const ck = clsKey(s), f = clsSkip(ds, ck);
      const base = { s: toMin(x[1]), e: toMin(x[2]), code: s.code, ck, label: `${subj(s.code).n}`, sub: `${TYPE[x[3]] || x[3]} · grupo ${s.group} · ${x[4].replace(/ - Lab\..*/, '')}` };
      if (!f) { blocks.push({ ...base, kind: 'clase' }); continue; }
      // no vas a esta clase: queda libre o la cambias por estudio (en casa o en la uni)
      skipped.push({ ...base, kind: 'saltada', siempre: f.siempre });
      // se puede estudiar otra asignatura en ese rato (f.est); por defecto, la misma de la clase
      const ec = f.est && subj(f.est) ? f.est : s.code;
      if (f.estudio === 'casa' || f.estudio === 'uni') blocks.push({ ...base, code: ec, kind: 'estudio', uni: f.estudio === 'uni',
        label: `Estudio · ${subj(ec).n}`, sub: `${f.estudio === 'uni' ? 'En la uni' : 'En casa'}, en vez de ir a ${ec === s.code ? 'clase' : `${subj(s.code).s} ${x[3]}`}` });
    }
  }
  for (const c of S.asignaturas || []) for (const e of examsOf(c)) {
    if (e[1] !== ds || !e[2] || !e[3]) continue; // las entregas sin hora no ocupan tiempo
    blocks.push({ s: toMin(e[2]), e: toMin(e[3]), kind: 'examen', code: c, exId: e[5] || null,
      label: e[5] ? `${exName(e)} · ${subj(c).n}` : `Examen ${e[0]} · ${subj(c).n}`, sub: e[4] });
  }
  const T = Number(R.trayecto), P = Number(R.prep);
  let sleep = toMin(R.dormir || '00:00'); if (sleep < 6 * 60) sleep += 1440;
  let wake;
  // solo hay trayecto a la uni si ese día tienes algo allí (clase, examen, estudio en la uni o academia al lado)
  const acadUni = eventsOn(ds).filter(x => x.ev.tipo === 'academia' && x.ev.modo === 'uni' && !x.ev.todoDia && !(X && (X.pausar || []).includes('academia')))
    .map(x => ({ s: x.s, e: x.e, acad: true }));
  const atUni = [...blocks.filter(b => b.kind === 'clase' || b.kind === 'examen' || b.uni), ...acadUni];
  if (atUni.length) {
    const first = Math.min(...atUni.map(b => b.s)), last = Math.max(...atUni.map(b => b.e));
    blocks.push({ s: first - T, e: first, kind: 'trayecto', label: atUni.every(b => b.acad) ? 'Ida a la academia' : 'Ida a la uni' });
    blocks.push({ s: last, e: last + T, kind: 'trayecto', label: 'Vuelta a casa' });
    // huecos largos entre clases: si el alumno vuelve a casa, son dos trayectos más
    const VC = Number(R.volverCasa) || 0;
    if (VC) {
      const uni = atUni.slice().sort((a, b) => a.s - b.s);
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
  // el estudio en casa no puede coincidir con el trayecto a la uni: se recorta (y si no queda nada, se quita)
  for (const b of blocks.filter(b => b.kind === 'estudio' && !b.uni)) {
    for (const t of blocks.filter(t => t.kind === 'trayecto')) {
      if (t.s < b.e && b.s < t.e) { if (t.s <= b.s) b.s = Math.min(b.e, t.e); else b.e = Math.max(b.s, t.s); }
    }
  }
  for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].kind === 'estudio' && blocks[i].e - blocks[i].s < 15) blocks.splice(i, 1);
  // estudio que ya marcaste como hecho ese día (ocupa su rato y cuenta para la semana)
  for (const [id, h] of Object.entries(S.estDone || {})) if (h.ds === ds && subj(h.code)) blocks.push({ s: h.s, e: h.e, code: h.code, kind: 'estudio', doneId: id,
    label: `Estudio · ${subj(h.code).n}`, sub: `${h.t ? h.t + ' · ' : ''}hecho` });
  // eventos propios del alumno (entrenos, trabajo, planes...) y sus trayectos; en exámenes se pueden dejar en pausa
  const evs = eventsOn(ds).filter(x => !(X && (X.pausar || []).includes(x.ev.tipo)));
  const entero = x => x.ev.todoDia || (x.s <= 0 && x.e >= 1440); // todo el día, o un día en medio de un viaje
  const allDay = evs.filter(entero);
  for (const x of evs.filter(x => !entero(x))) {
    // la academia cerca de la uni va con el viaje a la uni, y la online es desde casa: sin trayecto propio
    const Te = x.ev.tipo === 'academia' && x.ev.modo !== 'otro' ? 0 : Number(x.ev.trayecto) || 0;
    // día de salida o de vuelta de un viaje: ocupa desde que te vas hasta dormir, o desde levantarte hasta que vuelves
    const vj = x.ev.tipo === 'viaje' ? (x.s <= 0 ? 'vuelta' : x.e >= 1440 ? 'ida' : 'corto') : null;
    blocks.push({ s: x.s, e: vj === 'ida' ? Math.max(sleep, x.s + 15) : x.e, kind: 'evento', id: x.id, tipo: x.ev.tipo, label: x.ev.titulo, viaje: vj,
      sub: vj === 'ida' ? ['Viaje', `te vas a las ${x.ev.ini}`, x.ev.lugar].filter(Boolean).join(' · ')
        : vj === 'vuelta' ? ['Viaje', `vuelves a las ${x.ev.fin}`, x.ev.lugar].filter(Boolean).join(' · ')
        : x.ev.tipo === 'academia' ? ['Academia', subj(x.ev.asig)?.n, x.ev.modo === 'online' ? 'online' : 'presencial', x.ev.lugar].filter(Boolean).join(' · ')
        : [EV_NAME[x.ev.tipo], x.ev.lugar, x.ev.repite ? 'cada semana' : ''].filter(Boolean).join(' · ') });
    if (Te) {
      blocks.push({ s: x.s - Te, e: x.s, kind: 'trayecto', label: `Ida · ${x.ev.titulo}` });
      blocks.push({ s: x.e, e: x.e + Te, kind: 'trayecto', label: `Vuelta · ${x.ev.titulo}` });
    }
  }
  // un plan de todo el día (viaje, estás fuera...) ocupa el día entero: sin rato libre ni estudio propuesto
  const fuera = allDay.length > 0;
  if (fuera) {
    // se ve como un evento que llena el día, de levantarte a dormir
    const x = allDay[0];
    blocks.push({ s: wake, e: sleep, kind: 'evento', id: x.id, tipo: x.ev.tipo, label: x.ev.titulo,
      sub: [x.ev.tipo === 'viaje' ? 'Viaje · todo el día' : 'Todo el día', x.ev.tipo === 'viaje' ? '' : EV_NAME[x.ev.tipo], x.ev.lugar].filter(Boolean).join(' · ') });
    blocks.sort((a, b) => a.s - b.s || a.e - b.e);
    return { info, blocks, free: [], skipped, wake, sleep, allDay: allDay.filter(y => y !== x), fuera, exRut: !!X, freeMin: 0,
      classMin: blocks.filter(b => b.kind === 'clase').reduce((n, b) => n + b.e - b.s, 0) };
  }
  // si algo empieza antes de lo habitual, te levantas antes
  const enCasa = blocks.filter(b => b.viaje !== 'vuelta');
  if (enCasa.length) wake = Math.min(wake, Math.min(...enCasa.map(b => b.s)) - P);
  // cambios de rutina solo para este día (comer fuera, merendar antes...): mandan sobre lo habitual
  const O = (S.diaRutina || {})[ds] || {};
  let wakeLen = P;
  if (O.despertar && !O.despertar.off) { wake = toMin(O.despertar.ini); wakeLen = Number(O.despertar.dur); }
  // el día que vuelves de viaje te levantas fuera: el viaje ocupa desde que te levantas
  const vuelta = blocks.find(b => b.viaje === 'vuelta');
  if (vuelta) vuelta.s = wake;
  else blocks.push({ s: wake, e: wake + wakeLen, kind: 'rutina', label: RUT_LABEL.despertar, rk: 'despertar', mod: !!O.despertar });
  const fixed = k => { const o = O[k]; if (!o || o.off) return null;
    const b = { s: toMin(o.ini), e: toMin(o.ini) + Number(o.dur), kind: 'rutina', label: RUT_LABEL[k], rk: k, mod: true }; blocks.push(b); return b; };
  const fx = { comida: fixed('comida'), descanso: fixed('descanso'), merienda: fixed('merienda'), cena: fixed('cena') };
  // maxShift: cuánto se puede retrasar como mucho (la merienda no tiene sentido a las 22:00)
  const place = (start, len, label, kind = 'rutina', maxShift = Infinity, rk = null) => {
    let t = start, moved = true;
    // si cae mientras estás de viaje, esa comida la haces fuera: no se coloca
    if (blocks.some(b => b.viaje && start < b.e && b.s < start + len)) return null;
    while (moved) { moved = false; for (const b of blocks) if (t < b.e && b.s < t + len) { t = b.e; moved = true; } }
    if (t + len > sleep || t - start > maxShift) return null;
    const b = { s: t, e: t + len, kind, label, rk }; blocks.push(b); return b;
  };
  const com = O.comida ? fx.comida : place(toMin(R.comida), Number(R.comidaDur), RUT_LABEL.comida, 'rutina', Infinity, 'comida');
  if (!O.descanso && com && Number(R.descanso)) place(com.e, Number(R.descanso), RUT_LABEL.descanso, 'rutina', Infinity, 'descanso');
  // la merienda va antes de la cena, así que si no cabe cerca de su hora ese día se salta
  if (!O.merienda && R.merienda) place(toMin(R.meriendaHora), 30, RUT_LABEL.merienda, 'rutina', 90, 'merienda');
  const cen = O.cena ? fx.cena : place(toMin(R.cena), Number(R.cenaDur), RUT_LABEL.cena, 'rutina', Infinity, 'cena');
  // si no estudias después de cenar, ese rato es tiempo libre de verdad, pero Quatri no te pone estudio ahí (noche: true)
  const noche = cen && !R.estudiaNoche ? cen.e : Infinity;
  blocks.sort((a, b) => a.s - b.s || a.e - b.e);
  // huecos libres entre levantarte y dormir (partidos a la hora de acabar de cenar)
  const free = [];
  const addFree = (s, e) => {
    if (e - s < 15) return;
    if (s < noche && noche < e) { if (noche - s >= 15) free.push({ s, e: noche, kind: 'libre' }); if (e - noche >= 15) free.push({ s: noche, e, kind: 'libre', noche: true }); }
    else free.push({ s, e, kind: 'libre', noche: s >= noche });
  };
  let t = wake;
  for (const b of blocks) { if (b.s > t) addFree(t, b.s); t = Math.max(t, b.e); }
  if (sleep > t) addFree(t, sleep);
  return { info, blocks, free, skipped, wake, sleep, allDay, exRut: !!X, freeMin: free.reduce((n, f) => n + f.e - f.s, 0),
    freeEstMin: free.filter(f => !f.noche).reduce((n, f) => n + f.e - f.s, 0),
    classMin: blocks.filter(b => b.kind === 'clase').reduce((n, b) => n + b.e - b.s, 0) };
}

/* ---------- Tu día ----------
   Arriba, lo que toca ahora en un campo de color (como un reel: nombre en grande, cuánto falta, acciones a la derecha
   y lo siguiente asomando); debajo, el día entero con la rutina, en una lista limpia. Tocar la tarjeta abre el día
   a pantalla completa, una cosa por pantalla (openFeed). */
const ICO = {
  check: '<path d="M5 12l5 5L20 7"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  skip: '<path d="M5 6l7 6-7 6zM13 6l7 6-7 6z"/>', eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  day: '<rect x="6" y="3" width="12" height="18" rx="3"/><path d="M10 17h4"/>', up: '<path d="M6 15l6-6 6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
  hoy: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', cal: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  est: '<path d="M5 19.5V5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5 1.5 1.5 0 0 0 6.5 21H19"/><path d="M9 8h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
};
const ico = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICO[n]}</svg>`;
// color del campo de cada bloque (texto blanco encima)
function kindColor(it) {
  if (it.kind === 'clase') return 'var(--k-clase)';
  if (it.kind === 'examen') return 'var(--k-examen)';
  if (it.kind === 'plan' || it.kind === 'estudio') return 'var(--k-estudio)';
  if (it.kind === 'libre') return 'var(--k-libre)';
  if (it.kind === 'evento') return it.tipo === 'academia' ? 'var(--k-acad)' : evColor(it.tipo);
  return 'var(--k-rut)';
}
// el punto de cada fila: el color de la asignatura en clases y estudio; el del tipo en lo demás
const dotStyle = it => it.code ? colorVars(it.code) : `--c:${kindColor(it)}`;
const itemLabel = it => it.kind === 'libre' ? 'Libre' : it.kind === 'saltada' ? `No vas · ${it.label}` : it.label;
function itemSub(it) {
  if (it.kind === 'saltada') return `${it.sub} · ${it.siempre ? 'no vas nunca' : 'solo este día'}`;
  if (it.kind === 'libre') return it.skip ? `En vez de ${it.skip.label} · toca para cambiarlo` : it.noche ? 'Después de cenar · aquí no te ponemos estudio' : 'Toca para añadir algo aquí';
  return [it.sub, it.mod ? 'cambiado solo este día' : ''].filter(Boolean).join(' · ');
}
// qué puedes hacer con cada bloque (en la tarjeta de ahora y en el día a pantalla completa)
function itemActions(it, ds) {
  const A = [];
  if (it.kind === 'plan') {
    A.push({ l: 'Hecho', i: 'check', f: () => marcarHecho(ds, it.s, it.e, it.code, it.fijoId) });
    A.push({ l: 'Cambiar', i: 'swap', f: () => openPlan(ds, it.s, it.e, it.code, it.tema, it.fijoId) });
  } else if (it.kind === 'clase' && it.ck) A.push({ l: 'No voy', i: 'x', f: () => openClase(ds, it.ck) });
  else if (it.kind === 'libre' && it.skip) A.push({ l: 'Cambiar', i: 'swap', f: () => openClase(ds, it.skip.ck) });
  else if (it.kind === 'libre') A.push({ l: 'Añadir', i: 'plus', f: () => openEvent(null, ds, Math.ceil(it.s / 15) * 15, Math.min(Math.ceil(it.s / 15) * 15 + 60, it.e)) });
  else if (it.kind === 'estudio' && it.ck && !it.doneId) A.push({ l: 'Cambiar', i: 'swap', f: () => openClase(ds, it.ck) });
  else if (it.kind === 'evento' && it.id) A.push({ l: 'Editar', i: 'edit', f: () => openEvent(it.id, ds) });
  else if (it.rk) A.push({ l: 'Cambiar', i: 'edit', f: () => openRutinaDia(ds, it.rk) });
  else if (it.exId) A.push({ l: 'Ver', i: 'eye', f: () => openExamen(it.code, it.exId) });
  else if (it.doneId) A.push({ l: 'Deshacer', i: 'x', f: () => openDone(it.doneId) });
  return A;
}
const nowMin = p => { const n = new Date(); let m = n.getHours() * 60 + n.getMinutes(); if (m < p.wake && m + 1440 < p.sleep + 1) m += 1440; return m; };
const left = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) : ''}` : `${m} min`;
function dayItems(p) {
  // las clases a las que no vas no se ven: en su lugar está lo que haces (estudio o rato libre).
  // El rato libre que deja una clase recuerda cuál era, para poder cambiarlo o volver a ir.
  for (const f of p.free) f.skip = p.skipped.find(k => k.s < f.e && f.s < k.e) || null;
  return [...p.blocks, ...p.free].sort((a, b) => a.s - b.s);
}

function viewHoy() {
  S.dia = S.dia || dkey(new Date());
  const ds = S.dia, p = dayView(ds), d = p.info.d, today = dkey(new Date());
  const rel = ds === today ? 'Hoy' : ds === dkey(addDays(new Date(), 1)) ? 'Mañana' : ds === dkey(addDays(new Date(), -1)) ? 'Ayer' : DAYS[p.info.wd];
  const items = dayItems(p);
  const vivos = items.filter(it => it.kind !== 'saltada');
  // lo que toca ahora (o lo siguiente); solo en el día de hoy
  let cur = null, nxt = null, nm = 0;
  if (ds === today) {
    nm = nowMin(p);
    const i = vivos.findIndex(it => it.s <= nm && nm < it.e);
    if (i >= 0) { cur = vivos[i]; nxt = vivos[i + 1] || null; }
    else { cur = vivos.find(it => it.s > nm) || null; nxt = cur ? vivos[vivos.indexOf(cur) + 1] || null : null; }
  }
  const enCurso = cur && cur.s <= nm;
  const ahora = cur ? (() => {
    const meta = [itemSub(cur) && cur.kind !== 'libre' ? itemSub(cur) : '', `${fmt(cur.s % 1440)}–${fmt(cur.e % 1440)}`, cur.kind === 'libre' ? dur(cur.e - cur.s) : ''].filter(Boolean).join(' · ');
    const falta = enCurso ? cur.e - nm : cur.s - nm;
    const A = [...itemActions(cur, ds), { l: 'Mi día', i: 'day', f: () => openFeed(ds, vivos.indexOf(cur)) }];
    return `<section class="nowcard" style="--k:${kindColor(cur)}" data-feed="${vivos.indexOf(cur)}">
      <h2>${esc(itemLabel(cur))}</h2>
      <p class="nc-meta">${esc(meta)}</p>
      <p class="nc-left"><b>${left(falta)}</b><span>${enCurso ? 'para acabar' : 'para empezar'}</span></p>
      ${enCurso ? `<div class="nc-bar"><i style="width:${Math.round((nm - cur.s) / (cur.e - cur.s) * 100)}%"></i></div>` : ''}
      <div class="nc-rail">${A.map((a, k) => `<button data-act="${k}" aria-label="${a.l}">${ico(a.i)}<span>${a.l}</span></button>`).join('')}</div>
      ${nxt ? `<button class="nc-next" data-feed="${vivos.indexOf(nxt)}"><i class="nc-dot" style="background:${kindColor(nxt)}"></i><small>${fmt(nxt.s % 1440)}</small><b>${esc(itemLabel(nxt))}${nxt.kind === 'libre' ? ` · ${dur(nxt.e - nxt.s)}` : ''}</b>${ico('up')}</button>` : ''}
    </section>`;
  })() : '';
  const mon = mondayOf(d);
  const strip = [0, 1, 2, 3, 4, 5, 6].map(i => { const x = addDays(mon, i), k = dkey(x);
    return `<button class="ds${k === ds ? ' on' : ''}${k === today ? ' today' : ''}" data-day="${k}" aria-label="${DAYS[wdOf(x)]} ${x.getDate()}"><span>${DOW1[i]}</span><b>${x.getDate()}</b></button>`; }).join('');
  const row = it => {
    const data = it.kind === 'evento' ? `data-ev="${it.id}"` : it.kind === 'libre' ? (it.skip ? `data-cls="${esc(it.skip.ck)}"` : `data-free="${it.s},${it.e}"`) : it.rk ? `data-rut="${it.rk}"`
      : it.kind === 'plan' ? `data-plan="${it.s},${it.e},${it.code},${it.fijoId || ''}" data-tema="${esc(it.tema || '')}"` : it.doneId ? `data-done="${it.doneId}"` : it.exId ? `data-exam="${it.exId}" data-code="${it.code}"` : it.ck ? `data-cls="${esc(it.ck)}"` : '';
    const sub = itemSub(it);
    return `<li class="it ${it.kind}${it.mod ? ' mod' : ''}${it === cur && enCurso ? ' cur' : ''}" style="${dotStyle(it)}" ${data}>
      <span class="t">${fmt(it.s % 1440)}<small>${fmt(it.e % 1440)}</small></span><span class="dot" aria-hidden="true"></span>
      <span class="n"><b>${esc(itemLabel(it))}${it.kind === 'libre' ? ` · ${dur(it.e - it.s)}` : ''}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <span class="du">${it.kind === 'libre' ? '' : dur(it.e - it.s)}</span></li>`;
  };
  const v = $('#view');
  v.innerHTML = `
    <div class="hoyhead">
      <div><h1>${rel}</h1><p>${DAYS[p.info.wd]} ${d.getDate()} de ${MONTHS[d.getMonth()]}${p.info.week ? ` · semana ${p.info.week}` : ''}</p></div>
      ${ds !== today ? '<button class="todaybtn" id="today">Volver a hoy</button>' : ''}
    </div>
    <div class="hoy-grid">
    <div class="hoy-main">
      <div class="dstrip">${strip}</div>
      ${ahora}
      <p class="daysum"><span class="l"><b>${dur(p.freeMin)}</b>libres de verdad</span><span><b>${p.classMin ? dur(p.classMin) : '0 h'}</b>de clase</span><span><b>${dur(p.planMin || 0)}</b>de estudio</span></p>
      ${p.info.note ? `<div class="notice warn">${esc(p.info.note)}</div>` : ''}
      ${p.exRut ? `<button class="notice exrut" id="exRutGo">Rutina de exámenes activa · <span>cambiarla</span>${ico('right')}</button>` : ''}
      ${p.allDay.map(x => `<div class="allday" style="--ev:${evColor(x.ev.tipo)}" data-ev="${x.id}"><b>${esc(x.ev.titulo)}</b><small>Todo el día${x.ev.lugar ? ' · ' + esc(x.ev.lugar) : ''}</small></div>`).join('')}
      ${!cur && vivos.length ? `<button class="btn feedbtn" data-feed="0">${ico('day')} Ver el día a pantalla completa</button>` : ''}
      <ul class="timeline">${items.map(row).join('')}</ul>
    </div>
    <aside class="hoy-side">${(() => {
      // solo en pantallas grandes: los próximos exámenes, para aprovechar el espacio de la columna
      const ex = (S.asignaturas || []).flatMap(c => examsOf(c).filter(e => e[1] >= today).map(e => ({ c, e })))
        .sort((x, y) => x.e[1].localeCompare(y.e[1])).slice(0, 5);
      if (!ex.length) return '';
      return `<section class="card desk-only next-ex"><h2 class="sec" style="margin:0 0 4px">Próximos exámenes</h2>
        ${ex.map(({ c, e }) => { const dd = dparse(e[1]), n = Math.round((dd - dparse(today)) / 864e5); return `<div class="nx" style="${colorVars(c)}"><i></i>
          <span><b>${esc(exName(e))} · ${esc(subj(c).s)}</b><small>${esc(subj(c).n)}</small></span>
          <span class="nx-d">${DAYS_SHORT[wdOf(dd)]} ${dd.getDate()}/${dd.getMonth() + 1}<small>${n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`}</small></span></div>`; }).join('')}
      </section>`;
    })()}</aside>
    </div>`;
  const shift = n => { S.dia = dkey(addDays(dparse(S.dia), n)); save(); viewHoy(); };
  v.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { const k = b.dataset.day; if (k === ds) return; slideTo(v, k > ds ? 1 : -1, () => { S.dia = k; save(); viewHoy(); }); });
  if ($('#today')) $('#today').onclick = () => slideTo(v, ds > today ? -1 : 1, () => { S.dia = today; save(); viewHoy(); });
  v.querySelectorAll('.timeline [data-ev], .allday[data-ev]').forEach(el => el.onclick = () => openEvent(el.dataset.ev, ds));
  v.querySelectorAll('.timeline [data-rut]').forEach(el => el.onclick = () => openRutinaDia(ds, el.dataset.rut));
  v.querySelectorAll('.timeline [data-cls]').forEach(el => el.onclick = () => openClase(ds, el.dataset.cls));
  v.querySelectorAll('.timeline [data-exam]').forEach(el => el.onclick = () => openExamen(el.dataset.code, el.dataset.exam));
  v.querySelectorAll('.timeline [data-plan]').forEach(el => el.onclick = () => { const [s, e, c, fid] = el.dataset.plan.split(','); openPlan(ds, +s, +e, c, el.dataset.tema, fid); });
  v.querySelectorAll('.timeline [data-done]').forEach(el => el.onclick = () => openDone(el.dataset.done));
  v.querySelectorAll('.timeline [data-free]').forEach(el => el.onclick = () => {
    const [a, b] = el.dataset.free.split(',').map(Number);
    openEvent(null, ds, Math.ceil(a / 15) * 15, Math.min(Math.ceil(a / 15) * 15 + 60, b));
  });
  if ($('#exRutGo')) $('#exRutGo').onclick = () => go('rutinaex');
  // tarjeta de ahora: sus botones hacen la acción; tocar el resto abre el día a pantalla completa
  if (cur) {
    const A = [...itemActions(cur, ds), { f: () => openFeed(ds, vivos.indexOf(cur)) }];
    v.querySelectorAll('.nowcard [data-act]').forEach(b => b.onclick = e => { e.stopPropagation(); A[+b.dataset.act].f(); });
  }
  v.querySelectorAll('[data-feed]').forEach(el => el.onclick = e => { e.stopPropagation(); openFeed(ds, +el.dataset.feed); });
  // línea con la hora actual (solo en el día de hoy); se mueve cada minuto
  clearInterval(viewHoy.t);
  if (ds === today) {
    const ul = $('.timeline', v);
    const putNow = () => {
      if (!document.body.contains(ul)) { clearInterval(viewHoy.t); return; }
      ul.querySelectorAll('.nowline,.nowrow').forEach(e => e.remove());
      const m = nowMin(p);
      const lis = [...ul.children];
      let k = -1; items.forEach((it, i) => { if (it.kind !== 'saltada' && it.s <= m && m < it.e) k = i; });
      if (k >= 0) {
        const it = items[k];
        lis[k].insertAdjacentHTML('beforeend', `<i class="nowline" style="top:${((m - it.s) / (it.e - it.s) * 100).toFixed(1)}%"></i>`);
      } else {
        const r = '<li class="nowrow" aria-hidden="true"><i class="nowline"></i></li>';
        const j = items.findIndex(it => it.s > m);
        if (j >= 0) lis[j].insertAdjacentHTML('beforebegin', r); else ul.insertAdjacentHTML('beforeend', r);
      }
    };
    putNow();
    viewHoy.t = setInterval(putNow, 60000);
  }
  swipe(v, shift);
  tabs('hoy');
  fab(() => S.dia);
}

// El día a pantalla completa: una cosa por pantalla, en su color; se desliza hacia arriba para pasar a la siguiente.
// Ilustraciones planas del scroll del día. Solo blanco y negro con transparencia (más un amarillo),
// para que encajen sobre el color de cualquier bloque. Clases: a=blanco fuerte, b=blanco medio, c=blanco suave, d=sombra, y=amarillo
const ILU = {
  clase: `<rect class="d" x="40" y="14" width="160" height="80" rx="8"/><path class="sb" d="M60 38h70M60 56h110M60 72h46"/><rect class="y" x="150" y="76" width="30" height="6" rx="3"/>
    <rect class="c" x="22" y="128" width="58" height="12" rx="4"/><rect class="c" x="91" y="128" width="58" height="12" rx="4"/><rect class="c" x="160" y="128" width="58" height="12" rx="4"/>
    <circle class="a" cx="51" cy="114" r="11"/><circle class="a" cx="120" cy="114" r="11"/><circle class="a" cx="189" cy="114" r="11"/>`,
  examen: `<rect class="a" x="62" y="10" width="104" height="134" rx="8" transform="rotate(-6 114 77)"/><path class="sd" d="M82 42h56M84 62h50M86 82h56M88 102h36" transform="rotate(-6 114 77)"/>
    <circle class="y" cx="176" cy="112" r="26"/><path class="sd" d="M176 96v16l10 7" />`,
  estudio: `<path class="a" d="M48 126 L120 110 L192 126 L192 64 L120 48 L48 64 Z"/><path class="sk" d="M120 48v62"/><path class="sc" d="M62 76l42-9M62 90l42-9M62 104l42-9M136 67l42 9M136 81l42 9"/>
    <g transform="rotate(40 196 40)"><rect class="y" x="188" y="2" width="16" height="62" rx="3"/><path class="a" d="M188 64h16l-8 16z"/><rect class="d" x="188" y="2" width="16" height="10" rx="3"/></g>
    <rect class="d" x="28" y="134" width="184" height="10" rx="5"/>`,
  trayecto: `<circle class="y" cx="196" cy="30" r="17"/><rect class="a" x="22" y="58" width="180" height="60" rx="16"/><rect class="d" x="38" y="72" width="30" height="22" rx="4"/><rect class="d" x="78" y="72" width="30" height="22" rx="4"/>
    <rect class="d" x="118" y="72" width="30" height="22" rx="4"/><rect class="d" x="158" y="72" width="30" height="22" rx="4"/><rect class="c" x="22" y="102" width="180" height="6"/>
    <path class="sd" d="M0 138h240"/><circle class="d" cx="58" cy="126" r="8"/><circle class="d" cx="168" cy="126" r="8"/>`,
  despertar: `<path class="y" d="M70 112a50 50 0 0 1 100 0z"/><path class="sy" d="M120 34v-18M74 52l-12-12M166 52l12-12M50 92H32M190 92h18"/><rect class="a" x="20" y="112" width="200" height="10" rx="5"/>
    <path class="c" d="M76 140h88a10 10 0 0 0 10-10H66a10 10 0 0 0 10 10z"/>`,
  comida: `<ellipse class="c" cx="120" cy="100" rx="78" ry="40"/><ellipse class="a" cx="120" cy="96" rx="58" ry="28"/><ellipse class="y" cx="104" cy="92" rx="18" ry="10"/><circle class="d" cx="134" cy="96" r="9"/><circle class="d" cx="150" cy="88" r="6"/>
    <path class="sa" d="M24 50v80M18 50v22a6 6 0 0 0 12 0V50M214 50c-12 10-12 34 0 40v40"/>`,
  merienda: `<rect class="a" x="56" y="58" width="76" height="72" rx="10"/><path class="sa" d="M132 74h10a14 14 0 0 1 0 28h-10"/><path class="sb" d="M80 22c-8 10 8 16 0 26M104 22c-8 10 8 16 0 26"/>
    <path class="y" d="M156 112c0-22 56-22 56 0z"/><rect class="c" x="156" y="112" width="56" height="18" rx="4"/><rect class="d" x="40" y="136" width="180" height="8" rx="4"/>`,
  descanso: `<rect class="a" x="72" y="62" width="80" height="70" rx="12"/><path class="sa" d="M152 78h10a16 16 0 0 1 0 32h-10"/><rect class="y" x="72" y="84" width="80" height="12"/>
    <path class="sb" d="M96 22c-8 10 8 16 0 28M128 22c-8 10 8 16 0 28"/><ellipse class="c" cx="118" cy="140" rx="70" ry="9"/>`,
  cena: `<path class="y" d="M200 18a24 24 0 1 0 22 32 20 20 0 0 1-22-32z"/><circle class="a" cx="40" cy="30" r="3"/><circle class="b" cx="76" cy="16" r="2.5"/><circle class="b" cx="160" cy="22" r="2.5"/>
    <ellipse class="c" cx="120" cy="112" rx="78" ry="34"/><ellipse class="a" cx="120" cy="108" rx="56" ry="22"/><ellipse class="d" cx="120" cy="106" rx="30" ry="10"/>`,
  libre: `<circle class="y" cx="184" cy="40" r="24"/><path class="c" d="M0 126c40-26 80-26 120-6s80 20 120-4v44H0z"/><path class="a" d="M86 18l30 26-30 38-30-38z"/><path class="d" d="M86 18v64L56 44z"/>
    <path class="sb" d="M86 82c-6 16 14 22 4 40"/><path class="y" d="M84 96l12 4-10 6zM88 112l12 2-11 8z"/>`,
  noche: `<path class="y" d="M182 20a30 30 0 1 0 30 42 26 26 0 0 1-30-42z"/><circle class="a" cx="40" cy="34" r="3"/><circle class="b" cx="80" cy="20" r="2.5"/><circle class="b" cx="120" cy="44" r="2"/>
    <rect class="a" x="36" y="96" width="168" height="40" rx="14"/><rect class="c" x="24" y="84" width="32" height="56" rx="12"/><rect class="c" x="184" y="84" width="32" height="56" rx="12"/><rect class="d" x="60" y="104" width="56" height="16" rx="6"/>`,
  academia: `<rect class="d" x="56" y="16" width="128" height="74" rx="8"/><path class="sy" d="M76 40h40M76 60h70"/><circle class="a" cx="120" cy="116" r="16"/><path class="a" d="M88 150a32 26 0 0 1 64 0z"/><rect class="c" x="30" y="140" width="180" height="10" rx="5"/>`,
  viaje: `<rect class="a" x="62" y="50" width="116" height="86" rx="12"/><path class="sa" d="M98 50V34h44v16"/><rect class="y" x="62" y="80" width="116" height="10"/><circle class="d" cx="84" cy="142" r="7"/><circle class="d" cx="156" cy="142" r="7"/>`,
  evento: `<rect class="a" x="56" y="30" width="128" height="110" rx="12"/><rect class="d" x="56" y="30" width="128" height="30" rx="12"/><path class="sa" d="M86 20v20M154 20v20"/>
    <path class="y" d="M120 74l9 18 20 3-14 14 3 20-18-9-18 9 3-20-14-14 20-3z"/>`
};
function iluOf(it) {
  if (it.kind === 'plan' || it.kind === 'estudio') return 'estudio';
  if (it.kind === 'libre') return it.noche ? 'noche' : 'libre';
  if (it.kind === 'rutina') return { despertar: 'despertar', comida: 'comida', merienda: 'merienda', descanso: 'descanso', cena: 'cena' }[it.rk] || 'descanso';
  if (it.kind === 'evento') return it.tipo === 'academia' ? 'academia' : it.tipo === 'viaje' ? 'viaje' : 'evento';
  if (it.kind === 'noche') return 'noche';
  return ILU[it.kind] ? it.kind : 'evento';
}
const iluSvg = (n, cls = 'fd-ill') => `<svg class="${cls}" viewBox="0 0 240 160" aria-hidden="true">${ILU[n] || ''}</svg>`;

function openFeed(ds, start = 0) {
  const p = dayView(ds), vivos = dayItems(p).filter(it => it.kind !== 'saltada');
  if (!vivos.length) return;
  const today = dkey(new Date()), nm = ds === today ? nowMin(p) : -1, d = dparse(ds);
  const ov = document.createElement('div');
  ov.className = 'feed';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Tu día, una cosa por pantalla');
  ov.innerHTML = `
    <div class="fd-top"><span>${ds === today ? 'Hoy' : `${DAYS[wdOf(d)]} ${d.getDate()}`} · <b id="fdN">${start + 1}</b> de ${vivos.length}</span>
      <button class="fd-x" aria-label="Cerrar">${ico('x')}</button></div>
    <div class="fd-prog">${vivos.map((_, i) => `<i data-i="${i}"></i>`).join('')}</div>
    <div class="fd-scroll">${vivos.map((it, i) => {
      const A = itemActions(it, ds), sub = itemSub(it), on = nm >= it.s && nm < it.e;
      return `<section class="fd-item" style="--k:${kindColor(it)}" data-i="${i}">
        ${iluSvg(iluOf(it))}
        <div class="fd-body">
          <p class="fd-when">${on ? 'Ahora · ' : ''}${fmt(it.s % 1440)}–${fmt(it.e % 1440)} · ${dur(it.e - it.s)}</p>
          <h2>${esc(itemLabel(it))}</h2>
          ${sub && it.kind !== 'libre' ? `<p class="fd-sub">${esc(sub)}</p>` : ''}
          ${it.kind === 'libre' ? `<p class="fd-sub">Tiempo libre de verdad hasta las ${fmt(it.e % 1440)}: ya descontados trayectos, comidas y descansos.</p>` : ''}
          ${it.kind === 'plan' && it.code ? `<p class="fd-sub">${esc(porQueCorto(it.code))}</p>` : ''}
        </div>
        <div class="fd-rail">${A.map((a, k) => `<button data-a="${i},${k}" aria-label="${a.l}">${ico(a.i)}<span>${a.l}</span></button>`).join('')}</div>
        ${vivos[i + 1] ? `<button class="fd-peek" style="--k:${kindColor(vivos[i + 1])}" data-go="${i + 1}"><small>Después · ${fmt(vivos[i + 1].s % 1440)}</small><b>${esc(itemLabel(vivos[i + 1]))}</b>${ico('up')}</button>`
          : '<p class="fd-end">Fin del día</p>'}
      </section>`; }).join('')}</div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const sc = ov.querySelector('.fd-scroll');
  const close = () => { ov.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  ov.querySelector('.fd-x').onclick = close;
  ov.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const [i, k] = b.dataset.a.split(',').map(Number); close(); itemActions(vivos[i], ds)[k].f(); });
  ov.querySelectorAll('[data-go]').forEach(b => b.onclick = () => sc.scrollTo({ top: +b.dataset.go * sc.clientHeight, behavior: reduceMotion() ? 'auto' : 'smooth' }));
  const mark = i => { ov.querySelector('#fdN').textContent = i + 1; ov.querySelectorAll('.fd-prog i').forEach(x => x.classList.toggle('d', +x.dataset.i <= i)); };
  sc.addEventListener('scroll', () => mark(Math.round(sc.scrollTop / sc.clientHeight)), { passive: true });
  sc.scrollTop = start * sc.clientHeight; mark(start);
  setTimeout(() => ov.querySelector('.fd-x').focus(), 30);
}
// "6 créditos · te cuesta · final en 63 días" para un bloque de estudio
function porQueCorto(code) {
  const r = weekPlan(estStart()).rows.find(x => x.c === code);
  return r ? porQue(r) : '';
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
  // abajo, lo de cada día; Ajustes va aparte: engranaje arriba en el móvil, al final del menú lateral en el ordenador
  const t = [['hoy', 'Hoy', 'hoy'], ['calendario', 'Calendario', 'cal'], ['estudio', 'Estudio', 'est']];
  const btn = ([id, label, ic], cls = '') => `<button data-tab="${id}" class="${cls}" aria-current="${id === active ? 'page' : 'false'}">${ico(ic)}${label}</button>`;
  actions(`<nav class="tabs"><div class="side-brand"><span>quatri<span class="dot">.</span></span><span class="beta">${esc($('.brand .beta')?.textContent || '')}</span></div>${t.map(x => btn(x)).join('')}${btn(['ajustes', 'Ajustes', 'gear'], 'side-only')}</nav>`);
  const gear = $('#gear');
  if (gear) { gear.hidden = false; gear.setAttribute('aria-current', active === 'ajustes' ? 'page' : 'false'); gear.onclick = () => go('ajustes'); }
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    // tocar la pestaña en la que ya estás te devuelve a hoy / esta semana
    if (b.dataset.tab === active && active === 'hoy') { S.dia = dkey(new Date()); save(); viewHoy(); return; }
    if (b.dataset.tab === active && active === 'estudio') { S.estOff = 0; save(); viewEstudio(); return; }
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
      <button class="icon" id="prev" aria-label="Anterior">${ico('left')}</button>
      <div class="dh"><h1>${title}</h1><p class="dsub">${eyebrow}</p>
        ${atToday ? '' : `<button class="todaybtn" id="back">${isWeek ? 'Volver a esta semana' : 'Volver a este mes'}</button>`}</div>
      <button class="icon" id="next" aria-label="Siguiente">${ico('right')}</button>
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
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => { const ds = dkey(addDays(mon, i)); return { ds, p: dayView(ds) }; });
  // la rutina se ve por defecto (es lo que hace realista el tiempo libre); se puede ocultar
  const showRut = S.calRutina !== false;
  let h0 = 24, h1 = 0;
  for (const { p } of days) {
    const items = showRut ? [...p.blocks, ...p.free] : [...p.blocks.filter(b => b.kind === 'clase' || b.kind === 'examen' || b.kind === 'estudio' || b.kind === 'plan' || b.kind === 'evento'), ...p.free];
    for (const b of items) { h0 = Math.min(h0, Math.floor(b.s / 60)); h1 = Math.max(h1, Math.ceil(b.e / 60)); }
  }
  if (h0 >= h1) { h0 = 8; h1 = 22; }
  const hpx = window.innerWidth < 600 ? 34 : 42, px = m => (m - h0 * 60) / 60 * hpx, H = (h1 - h0) * hpx;
  const narrow = window.innerWidth < 600;
  const freeWeek = days.reduce((n, d) => n + d.p.freeMin, 0);
  const cols = days.map(({ ds, p }) => {
    const items = [];
    for (const f of p.free) if (f.e - f.s >= 30) items.push({ ...f });
    for (const b of p.blocks) if (b.kind === 'clase' || b.kind === 'examen' || b.kind === 'estudio' || b.kind === 'plan' || b.kind === 'evento' || showRut) items.push(b);
    const html = items.map(b => {
      const top = px(b.s), h = Math.max(px(b.e) - top - 1, 6);
      if (b.kind === 'libre') {
        const d = dur(b.e - b.s).replace(' min', 'm').replace(' h', 'h').replace(' ', '');
        return `<div class="cblk libre" style="top:${top}px;height:${h}px" data-free="${b.s},${b.e}" data-ds="${ds}">${h >= 13 ? `<b>Libre</b>` : ''}${h >= 26 ? `<small>${d}</small>` : ''}</div>`;
      }
      if (b.kind === 'evento') return `<div class="cblk evento" style="--ev:${evColor(b.tipo)};top:${top}px;height:${h}px" data-evid="${b.id}" data-ds="${ds}">
          <b>${esc(b.label.split(' ')[0].slice(0, 9))}</b>${h > 24 ? `<small>${fmt(b.s % 1440)}</small>` : ''}</div>`;
      if (b.kind === 'estudio' || b.kind === 'plan') return `<div class="cblk ${b.kind === 'plan' ? 'estudio plan' : 'estudio'}" style="${colorVars(b.code)};top:${top}px;height:${h}px" data-info="${esc(b.label)} · ${fmt(b.s)}–${fmt(b.e)} · ${esc(b.sub)}">
          <b>${esc(subj(b.code).s)}</b>${h > 36 ? '<small>Estudio</small>' : ''}</div>`;
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
    <p class="hint" style="margin-top:10px">Las clases van rellenas de color; el estudio, con el borde del color de su asignatura. En verde, tus huecos libres de al menos 30 min. Toca un bloque para ver el detalle o un día para abrirlo.</p>`;
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
    const classCodes = info.lective ? [...new Set(mySessions().filter(s => s.x[0] === info.clsWd && sesionHoy(s.x, ds, info)).map(s => s.code))] : [];
    const exams = codes.flatMap(c => examsOf(c).filter(e => e[1] === ds).map(e => ({ c, e })));
    const nolect = info.wd < 5 && !info.lective;
    if (inMonth) {
      for (const { c, e } of exams) events.push({ ds, kind: 'examen', c, txt: `${exName(e)} · ${subj(c).n}`, sub: e[2] ? `${e[2]}–${e[3]}` : '' });
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
    ${events.length ? `<section class="card stack" style="margin-top:12px"><h2 class="card-t">Este mes</h2>
      <ul class="mlist">${events.map(ev => { const d = dparse(ev.ds); return `<li class="${ev.kind}" ${ev.c ? `style="${colorVars(ev.c)}"` : ''} data-day="${ev.ds}">
        <span class="md">${ev.hasta ? `${d.getDate()}–${dparse(ev.hasta).getDate()}` : `${DAYS_SHORT[wdOf(d)]} ${d.getDate()}`}</span><span>${esc(ev.txt)}${ev.sub ? ` <small>${esc(ev.sub)}</small>` : ''}</span></li>`; }).join('')}</ul></section>` : ''}`;
}

/* ---------- cuánto prepararte y exámenes propios ---------- */
// Las horas de la guía docente son generosas: el alumno elige qué parte de ellas quiere cubrir.
const RITMOS = [[0.45, 'Lo justo'], [0.6, 'Normal'], [0.8, 'Bien preparado'], [1, 'Lo que dice la guía']];
// si no lo ha elegido, sale de cuánto se ve estudiando al día (1 h -> lo justo … 4 h -> lo que dice la guía)
const ritmo = () => { if (S.ritmo != null) return S.ritmo; const h = S.estMax?.semana ?? 2; return h <= 1 ? 0.45 : h <= 2 ? 0.6 : h <= 3 ? 0.8 : 1; };
// Exámenes que añade el alumno (controles, evaluación continua...): S.examenes[id] = { code, tipo, nombre, fecha, ini, fin, temas: [ids] }
const EX_TIPOS = [['control', 'Control'], ['parcial', 'Parcial'], ['final', 'Final'], ['entrega', 'Entrega']];
// Todos los exámenes de una asignatura con el mismo formato: [tipo, fecha, ini, fin, aulas, id propio, nombre, temas]
function examsOf(c) {
  const own = Object.entries(S.examenes || {}).filter(([, x]) => x.code === c)
    .map(([id, x]) => [x.tipo, x.fecha, x.ini || '', x.fin || '', x.lugar || '', id, x.nombre || '', x.temas || []]);
  return [...subj(c).e, ...own];
}
const exName = e => e[6] || (EX_TIPOS.find(t => t[0] === e[0])?.[1] || e[0]);
// "el parcial" / "el final" para los oficiales; «Control 1» para los que añade el alumno
const exRef = e => e[5] ? `«${exName(e)}»` : `el ${e[0]}`;

/* ---------- plan de estudio semanal ---------- */
// ¿Estudias esta asignatura? Por defecto sí si tiene exámenes (Ampliació d'Informàtica no tiene: empieza en "no").
// Se estudia si tiene exámenes. Sin exámenes:
//  - en escuelas cuyo visor trae los exámenes (casi todas sus asignaturas los tienen), es que no tiene examen
//    (evaluación continua, proyectos...): no se propone estudio, salvo que digas que la estudias;
//  - en escuelas que no publican las fechas (Camins, ETSAV), se estudia por defecto (se puede quitar).
const visorConExamenes = () => {
  if (D._cob == null) {
    const con = Object.values(D.asignaturas).filter(a => Object.values(a.g).some(g => g.x.length));
    D._cob = con.length ? con.filter(a => a.e.length).length / con.length : 0;
  }
  return D._cob >= 0.5;
};
const levelOf = c => {
  const n = (S.estudio?.nivel || {})[c];
  if (n === 'no') return 'no';
  if (n) return 'si';
  // con exámenes: se estudia mientras quede alguno por hacer
  if (examsOf(c).length) return examsOf(c).some(e => e[1] >= dkey(new Date())) ? 'si' : 'no';
  return visorConExamenes() ? 'no' : 'si';
};
// Semana de estudio: de lunes a domingo (off = 0 esta semana, 1 la siguiente…)
const estStart = (off = 0) => dkey(addDays(mondayOf(new Date()), 7 * off));
// semana a la que pertenece un día (null si ya ha pasado: no se coloca estudio en el pasado)
const estStartOf = ds => ds < dkey(new Date()) ? null : dkey(mondayOf(dparse(ds)));
function classWeeks() {
  const c = D.calendario;
  return Math.max(1, (dparse(c.fin_clases) - dparse(c.inicio_clases)) / (7 * 864e5));
}
function nextExam(code, fromKey) {
  return examsOf(code).filter(e => e[1] >= fromKey).sort((a, b) => a[1].localeCompare(b[1]))[0] || null;
}
const CUESTA = [['cuesta', 'Me cuesta'], ['', 'Normal'], ['bien', 'La llevo bien']];
const CUESTA_F = { cuesta: 1.35, bien: 0.7 };
function weekPlan(monKey) {
  S.estudio = S.estudio || { nivel: {}, ajuste: {} };
  const E = S.estudio;
  const mon = dparse(monKey);
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => dayPlan(dkey(addDays(mon, i))));
  // para estudiar solo cuenta el libre de antes de cenar (si no estudias por la noche)
  const freeMin = days.reduce((n, p) => n + (p.freeEstMin ?? p.freeMin), 0);
  // estudio ya hecho (marcado): cuenta como horas de estudio de esa asignatura.
  // El que haces en la hora de una clase a la que no vas NO cuenta: sustituye a la clase, no al estudio de después.
  const hecho = {};
  for (const p of days) for (const b of p.blocks) if (b.kind === 'estudio' && b.doneId) hecho[b.code] = (hecho[b.code] || 0) + (b.e - b.s) / 60;
  const estMin = Object.values(hecho).reduce((n, h) => n + h * 60, 0);
  const enEx = days.some(p => p.exRut);
  const codes = (S.asignaturas || []).slice();
  const rows = codes.map(c => {
    const a = subj(c), lv = levelOf(c);
    const oficial = (a.h || (a.cr || 0) * 15) / classWeeks();
    const ex = nextExam(c, monKey);
    const daysTo = ex ? Math.round((dparse(ex[1]) - mon) / 864e5) : null;
    // el examen pesa poco a poco: desde 6 semanas antes sube cada día, hasta +80 % (finales y parciales) o +40 % (controles y entregas)
    const amp = ex && (ex[0] === 'final' || ex[0] === 'parcial') ? 0.8 : 0.4;
    const urg = daysTo == null ? 1 : 1 + amp * Math.max(0, 1 - daysTo / 42);
    // cómo la llevas: lo dice el alumno (me cuesta +35 %, la llevo bien -30 %)
    const cu = (E.cuesta || {})[c], fc = CUESTA_F[cu] ?? 1;
    return { c, a, lv, oficial, ex, daysTo, need: null, urg, cu, w: oficial * urg * fc };
  });
  const oficialTotal = rows.filter(r => r.lv !== 'no').reduce((n, r) => n + r.oficial, 0);
  // lo ya hecho ocupó huecos libres, así que se suma al tiempo disponible.
  // Nunca más de una parte de tu tiempo libre, y esa parte depende de lo que elijas (poco 30 %, normal 40 %, mucho 55 %)
  const rt = ritmo(), parte = rt <= 0.5 ? 0.3 : rt <= 0.7 ? 0.4 : 0.55;
  let sugerido = Math.max(1, Math.min(Math.round((freeMin + estMin) / 60 * parte), Math.round(oficialTotal * rt)));
  if (enEx) {
    const need = rows.filter(r => r.lv !== 'no').reduce((n, r) => n + (r.need ?? r.oficial * rt), 0);
    sugerido = Math.max(1, Math.min(Math.round((freeMin + estMin) / 60 * parte * 1.5), Math.round(need)));
  }
  // nunca más de lo que tú has dicho que quieres estudiar al día (2 h × 5 + 4 h × 2 = 18 h, por ejemplo)
  // (los días que estás fuera todo el día no cuentan)
  const tope = [0, 1, 2, 3, 4, 5, 6].reduce((n, i) => n + (days[i]?.fuera ? 0 : estMax(dkey(addDays(mon, i)))), 0);
  sugerido = Math.min(sugerido, tope);
  const objetivo = E.objetivo ?? sugerido;
  const fixed = rows.filter(r => r.lv !== 'no' && E.ajuste[r.c] != null);
  const auto = rows.filter(r => r.lv !== 'no' && E.ajuste[r.c] == null);
  const fixedSum = fixed.reduce((n, r) => n + E.ajuste[r.c], 0);
  const rest = Math.max(0, objetivo - fixedSum), wsum = auto.reduce((n, r) => n + r.w, 0);
  for (const r of rows) {
    if (r.lv === 'no') r.horas = 0;
    else if (E.ajuste[r.c] != null) { r.horas = E.ajuste[r.c]; r.manual = true; }
    else r.horas = wsum ? Math.round(rest * r.w / wsum * 2) / 2 : 0;
    // nunca menos de lo que ya has hecho; lo que falta es lo que queda por colocar en tus huecos
    r.hecho = Math.round((hecho[r.c] || 0) * 2) / 2;
    if (r.horas < r.hecho) r.horas = r.hecho;
    r.pend = Math.max(0, r.horas - r.hecho);
  }
  const total = rows.reduce((n, r) => n + r.horas, 0);
  const llevas = Object.values(hecho).reduce((n, h) => n + h, 0);
  return { days, freeMin, rows, objetivo, sugerido, oficialTotal, total, enEx, tope, llevas };
}
const hfmt = h => num(Math.round(h * 2) / 2) + ' h';

/* ---------- estudio colocado en tus huecos ----------
   Reparte las horas de estudio que faltan de cada asignatura en los huecos libres de la semana, desde hoy:
   bloques de 30 min a 1 h 30, con 15 min de pausa entre bloques, un tope por día y alternando asignaturas.
   Los bloques son una propuesta: puedes marcarlos como hechos (S.estDone) o saltarlos (S.estSkip) y se recolocan. */
function weekSchedule(monKey) {
  // se coloca desde el último día en que cambiaste algo (o desde hoy); los días de antes de hoy ya no se ven
  const hoyK = dkey(new Date()), todayK = S.planDesde && S.planDesde < hoyK ? S.planDesde : hoyK, key = monKey + '|' + todayK;
  if (PLAN_CACHE[key]) return PLAN_CACHE[key];
  const W = weekPlan(monKey), mon = dparse(monKey);
  const pend = {}, lim = {};
  for (const r of W.rows) {
    if (r.lv === 'no' || r.pend <= 0) continue;
    pend[r.c] = Math.round(r.pend * 60);
    if (r.ex) lim[r.c] = r.ex[1]; // no tiene sentido estudiarla el día del examen ni después
  }
  const skips = S.estSkip || {};
  const days = W.days.map((p, i) => ({ ds: dkey(addDays(mon, i)), p })).filter(d => d.ds >= todayK);
  for (const d of days) {
    // huecos libres, sin los ratos que has saltado
    // 15 min de margen al llegar de un trayecto (no te pones a estudiar nada más cruzar la puerta)
    // (y 30 min al volver de un viaje)
    let gaps = d.p.free.filter(f => !f.noche).map(f => ({ s: f.s + (d.p.blocks.some(b => b.viaje === 'vuelta' && b.e === f.s) ? 30 : d.p.blocks.some(b => b.kind === 'trayecto' && b.e === f.s) ? 15 : 0), e: f.e }));
    for (const k of skips[d.ds] || []) gaps = gaps.flatMap(g => g.e <= k.s || g.s >= k.e ? [g] : [{ s: g.s, e: k.s }, { s: k.e, e: g.e }]);
    d.gaps = gaps.filter(g => g.e - g.s >= 30);
    // el tope del día descuenta el estudio ya hecho (no el que haces en vez de una clase)
    const ya = d.p.blocks.filter(b => b.kind === 'estudio' && b.doneId).reduce((n, b) => n + b.e - b.s, 0);
    d.cap = Math.max(0, Math.min(estMax(d.ds) * 60 - ya, Math.floor(d.gaps.reduce((n, g) => n + g.e - g.s, 0) * 0.8 / 15) * 15));
  }
  // bloques que has movido tú a un día y hora: se quedan ahí, ocupan su rato y cuentan para su asignatura
  for (const [id, f] of Object.entries(S.estFijo || {})) {
    const d = days.find(x => x.ds === f.ds);
    if (!d || !subj(f.code)) continue;
    d.gaps = d.gaps.flatMap(g => g.e <= f.s || g.s >= f.e ? [g] : [{ s: g.s, e: f.s }, { s: f.e, e: g.e }]).filter(g => g.e - g.s >= 30);
    d.cap = Math.max(0, d.cap - (f.e - f.s));
    if (pend[f.code] != null) pend[f.code] -= f.e - f.s;
    (d.fixed = d.fixed || []).push({ s: f.s, e: f.e, code: f.code, kind: 'plan', label: `Estudio · ${subj(f.code).n}`,
      sub: f.auto ? 'Propuesta · toca para marcarlo o moverlo' : 'Propuesta · movida por ti', tema: '', ds: f.ds, fijoId: id, auto: f.auto });
  }
  // si el examen de una asignatura cae esta semana, sus horas solo caben en los días de antes
  const okDay = (c, ds) => !lim[c] || ds < lim[c];
  for (const c of Object.keys(pend)) if (!days.some(d => okDay(c, d.ds))) delete pend[c]; // su examen ya ha pasado
  const total = Object.values(pend).reduce((a, b) => a + b, 0), capSum = days.reduce((n, d) => n + d.cap, 0);
  const out = {};
  for (const d of days) {
    // cuota del día, proporcional a lo que cabe ese día
    let quota = capSum ? Math.min(d.cap, Math.round(total * d.cap / capSum / 15) * 15) : 0;
    const blocks = [], usedToday = {};
    // cada hueco se parte en mañana (hasta las 14), tarde (14–20) y noche (desde las 20)
    // y se ordenan según cuándo prefieres estudiar. Por defecto ("libre"), donde más tiempo libre tienes:
    // primero el hueco más largo del día. "repartido" alterna mañana, tarde y noche.
    // En todos, dentro de cada franja van antes los huecos largos, y los ratos cortos entre clases (< 1 h) al final.
    const pieces = [];
    d.gaps.forEach((g, gi) => [[0, 840, 'm'], [840, 1200, 't'], [1200, 2880, 'n']].forEach(([a, b, w]) => {
      const s = Math.max(g.s, a), e = Math.min(g.e, b);
      if (e - s >= 30) pieces.push({ s, e, w, gi });
    }));
    const largo = p => d.gaps[p.gi].e - d.gaps[p.gi].s;
    const pref = S.estPref || 'libre', by = w => pieces.filter(p => p.w === w).sort((a, b) => largo(b) - largo(a));
    let order;
    if (pref === 'manana') order = [...by('m'), ...by('t'), ...by('n')];
    else if (pref === 'tarde') order = [...by('t'), ...by('n'), ...by('m')];
    else if (pref === 'noche') order = [...by('n'), ...by('t'), ...by('m')];
    else if (pref === 'repartido') { // un bloque por franja y vuelta
      const q = { m: by('m'), t: by('t'), n: by('n') }; order = [];
      while (q.m.length || q.t.length || q.n.length) for (const w of ['m', 't', 'n']) if (q[w].length) order.push(q[w].shift());
    } else order = d.gaps.map((g, gi) => ({ s: g.s, e: g.e, gi })).sort((a, b) => (b.e - b.s) - (a.e - a.s));
    order = [...order.filter(p => largo(p) >= 60), ...order.filter(p => largo(p) < 60)];
    const place = p => {
      if (quota < 30) return false;
      // el primer rato libre de esa franja, dejando 15 min de pausa con los bloques ya puestos en el mismo hueco
      let segs = [{ s: p.s, e: p.e }];
      for (const b of blocks.filter(b => b.gi === p.gi)) segs = segs.flatMap(x => x.e <= b.s - 15 || x.s >= b.e + 15 ? [x] : [{ s: x.s, e: b.s - 15 }, { s: b.e + 15, e: x.e }]);
      const seg = segs.find(x => x.e - x.s >= 30);
      if (!seg) return false;
      const t = seg.s, lim = seg.e;
      const cands = Object.keys(pend).filter(c => pend[c] >= 15 && okDay(c, d.ds))
        .sort((a, b) => (usedToday[a] || 0) - (usedToday[b] || 0) || pend[b] - pend[a]);
      if (!cands.length) return false;
      const c = cands[0];
      // en "libre", como mucho la mitad de cada hueco (o 1 h 30 si es corto) es estudio: el resto sigue libre
      const usado = blocks.filter(b => b.gi === p.gi).reduce((n, b) => n + b.e - b.s, 0);
      const tope = pref === 'libre' ? Math.max(90, (d.gaps[p.gi].e - d.gaps[p.gi].s) / 2) - usado : Infinity;
      const len = Math.floor(Math.min(90, pend[c] < 30 ? 30 : pend[c], quota, lim - t, tope) / 15) * 15;
      if (len < 30) return false;
      blocks.push({ s: t, e: t + len, code: c, kind: 'plan', label: `Estudio · ${subj(c).n}`, sub: 'Propuesta · toca para marcarlo o moverlo', tema: '', ds: d.ds, gi: p.gi });
      pend[c] -= len; quota -= len; usedToday[c] = (usedToday[c] || 0) + 1;
      return true;
    };
    if (pref === 'repartido') {
      // vueltas: un bloque en cada franja, hasta llenar la cuota del día
      let otra = true;
      while (otra && quota >= 30) { otra = false; for (const p of order) if (place(p)) otra = true; }
    } else for (const p of order) while (place(p)) { /* llena esa franja antes de pasar a la siguiente */ }
    out[d.ds] = [...(d.fixed || []), ...blocks].sort((x, y) => x.s - y.s);
  }
  out._sinHueco = Math.max(0, Object.values(pend).reduce((a, b) => a + Math.max(0, b), 0));
  return (PLAN_CACHE[key] = out);
}
// El día tal como se ve en Hoy y en Calendario: dayPlan + el estudio colocado por Quatri
function dayView(ds) {
  const p = dayPlan(ds);
  if (!S.listo || !(S.asignaturas || []).length) return { ...p, plan: [], planMin: 0 };
  const st = estStartOf(ds), plan = st ? weekSchedule(st)[ds] || [] : [];
  let free = p.free.map(f => ({ ...f }));
  for (const b of plan) free = free.flatMap(f => f.e <= b.s || f.s >= b.e ? [f] : [{ ...f, e: b.s }, { ...f, s: b.e }]);
  free = free.filter(f => f.e - f.s >= 15);
  // "libres de verdad" = la suma de los ratos libres que se ven (ya sin el estudio que propone Quatri)
  return { ...p, blocks: [...p.blocks, ...plan].sort((a, b) => a.s - b.s), free, plan, planMin: plan.reduce((n, b) => n + b.e - b.s, 0),
    freeMin: free.reduce((n, f) => n + f.e - f.s, 0) };
}

// Estudio por días: lo que toca estudiar cada día de la semana, con su hora; se marca como hecho tocando el círculo.
// Lo de cada asignatura (exámenes, horas a mano, "no la estudio") está dentro de la asignatura.
const NIVELES = [[0.45, 'Poco'], [0.6, 'Normal'], [0.8, 'Mucho']];
const nivelAct = () => { const r = ritmo(); return r <= 0.5 ? 0.45 : r <= 0.7 ? 0.6 : 0.8; };
function marcarHecho(ds, s, e, code, fijoId) {
  S.estDone = S.estDone || {};
  const id = newId(), fijo = fijoId && S.estFijo ? S.estFijo[fijoId] : null;
  // los demás bloques de ese día se quedan donde estaban (si no, al marcar uno se recolocaría el resto)
  const resto = (dayView(ds).plan || []).filter(b => !b.fijoId && !(b.s === s && b.e === e && b.code === code));
  S.estFijo = S.estFijo || {};
  const fijados = resto.map(b => { const k = newId(); S.estFijo[k] = { ds, s: b.s, e: b.e, code: b.code, t: '', auto: true }; return k; });
  S.estDone[id] = { ds, s, e, code, t: '' };
  if (fijo) delete S.estFijo[fijoId];
  save(); render();
  toast('Hecho', () => { delete S.estDone[id]; fijados.forEach(k => delete S.estFijo[k]); if (fijo) S.estFijo[fijoId] = fijo; save(); render(); });
}
function viewEstudio() {
  const off = Math.max(0, S.estOff || 0), start = estStart(off);
  const W = weekPlan(start), E = S.estudio, a = dparse(start), b = addDays(a, 6);
  const sin = weekSchedule(start)._sinHueco;
  const m3 = d => MONTHS[d.getMonth()].slice(0, 3);
  const today = dkey(new Date()), manana = dkey(addDays(new Date(), 1));
  // cada día: lo hecho (o estudiado en vez de clase) y lo propuesto
  const dias = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const ds = dkey(addDays(a, i)), p = dayView(ds);
    // estudio fuera de clase: lo hecho y lo propuesto (el de una clase a la que no vas va en Hoy, como la clase)
    const its = p.blocks.filter(x => ((x.kind === 'estudio' && x.doneId) || x.kind === 'plan') && subj(x.code));
    return { ds, its };
  }).filter(d => d.its.length);
  const mins = x => x.e - x.s;
  const total = dias.reduce((n, d) => n + d.its.reduce((m, x) => m + mins(x), 0), 0) / 60;
  const hecho = dias.reduce((n, d) => n + d.its.filter(x => x.kind === 'estudio').reduce((m, x) => m + mins(x), 0), 0) / 60;
  const pct = total ? Math.round(hecho / total * 100) : 0;
  const nomDia = ds => { const d = dparse(ds); return ds === today ? 'Hoy' : ds === manana ? 'Mañana' : `${DAYS[wdOf(d)]} ${d.getDate()}`; };
  const fila = (x, ds) => {
    const ok = x.kind === 'estudio', past = ds < today;
    const data = ok ? (x.doneId ? `data-done="${x.doneId}"` : '') : `data-plan="${ds},${x.s},${x.e},${x.code},${x.fijoId || ''}"`;
    return `<div class="erow${ok ? ' ok' : ''}${past && !ok ? ' past' : ''}" style="${colorVars(x.code)}">
      ${ok ? `<span class="eck on" aria-label="Hecho">${ico('check')}</span>`
        : `<button class="eck" data-ck="${ds},${x.s},${x.e},${x.code},${x.fijoId || ''}" aria-label="Marcar como hecho"></button>`}
      <button class="emain" ${data}><span class="dot"></span><span class="asn"><b>${esc(subj(x.code).n)}</b><small>${fmt(x.s % 1440)} · ${dur(mins(x))}</small></span></button>
    </div>`;
  };
  const X = W.enEx ? rutinaEx() : null, maxS = X ? X.maxSemana : (S.estMax?.semana ?? 2);
  const v = $('#view');
  v.innerHTML = `
    <div class="dayhead">
      <button class="icon" id="prev" aria-label="Semana anterior" ${off ? '' : 'disabled'}>${ico('left')}</button>
      <div class="dh"><h1>${a.getDate()} ${m3(a)} – ${b.getDate()} ${m3(b)}</h1>
        <p class="dsub">${off === 0 ? 'Esta semana' : off === 1 ? 'La semana que viene' : 'Más adelante'}</p>
        ${off ? '<button class="todaybtn" id="thisweek">Volver a esta semana</button>' : ''}</div>
      <button class="icon" id="next" aria-label="Semana siguiente">${ico('right')}</button>
    </div>
    <section class="est-top">
      <div class="est-big"><b>${hfmt(total)}</b><span>de estudio</span></div>
      ${total ? `<div class="est-prog"><div class="pbar"><i style="width:${pct}%"></i></div><span>${hfmt(hecho)} hecho</span></div>` : ''}
    </section>
    ${sin >= 30 && E.objetivo != null ? `<div class="notice warn stack"><span>No cabe todo: faltan ${hfmt(sin / 60)}.</span>
      <div class="row" style="flex-wrap:wrap;gap:8px">${maxS < (X ? 10 : 5) ? `<button class="btn small primary" id="avUp">Subir a ${hfmt(maxS + 1)} al día</button>` : ''}
      <button class="btn small" id="avOk">Así está bien</button></div></div>` : ''}
    <div class="elist">
      ${dias.map(d => `<div class="eday${d.ds === today ? ' hoy' : ''}">${nomDia(d.ds)}</div>${d.its.map(x => fila(x, d.ds)).join('')}`).join('')
        || '<p class="lead" style="margin:18px 0">Nada que estudiar esta semana.</p>'}
    </div>
    <button class="btn est-cambiar" id="cambiar">Cambiar cuánto estudio</button>
    <div class="eday" style="margin-top:22px">Asignaturas</div>
    <div class="elist">${W.rows.map(r => `
      <button class="asrow${r.lv === 'no' ? ' off' : ''}" data-tem="${r.c}" style="${colorVars(r.c)}">
        <span class="dot"></span><span class="asn"><b>${esc(r.a.n)}</b><small>${r.lv === 'no' ? (examsOf(r.c).length ? 'No la estudias' : 'Sin examen') : r.manual ? 'Horas puestas por ti' : porQue(r) || 'Sin examen a la vista'}</small></span>
        ${ico('right')}</button>`).join('')}</div>
    <p class="hint" style="margin-top:8px">Toca una asignatura para decir cómo la llevas, ver sus horas o sus exámenes.</p>`;
  const rerender = () => { save(); const y = window.scrollY; viewEstudio(); window.scrollTo(0, y); };
  v.querySelectorAll('[data-ck]').forEach(el => el.onclick = () => { const [ds, s, e, c, f] = el.dataset.ck.split(','); marcarHecho(ds, +s, +e, c, f); });
  v.querySelectorAll('[data-plan]').forEach(el => el.onclick = () => { const [ds, s, e, c, f] = el.dataset.plan.split(','); openPlan(ds, +s, +e, c, '', f); });
  v.querySelectorAll('[data-done]').forEach(el => el.onclick = () => openDone(el.dataset.done));
  v.querySelectorAll('[data-tem]').forEach(el => el.onclick = () => openTemario(el.dataset.tem));
  $('#cambiar').onclick = openCuanto;
  if ($('#avUp')) $('#avUp').onclick = () => {
    if (X) S.rutinaEx = { ...rutinaEx(), maxSemana: X.maxSemana + 1, maxFinde: Math.max(X.maxFinde, X.maxSemana + 1) };
    else { const m = S.estMax || {}; S.estMax = { semana: maxS + 1, finde: Math.max(m.finde ?? 3, maxS + 1) }; }
    toast(`Ahora hasta ${hfmt(maxS + 1)} de estudio al día`); rerender();
  };
  if ($('#avOk')) $('#avOk').onclick = () => { delete E.objetivo; toast('Te proponemos solo lo que cabe'); rerender(); };
  const shiftW = n => { S.estOff = Math.max(0, off + n); save(); viewEstudio(); };
  $('#prev').onclick = () => { if (off) slideTo(v, -1, shiftW); };
  $('#next').onclick = () => slideTo(v, 1, shiftW);
  if ($('#thisweek')) $('#thisweek').onclick = () => slideTo(v, -1, () => { S.estOff = 0; save(); viewEstudio(); });
  swipe(v, n => { if (n < 0 && !off) { viewEstudio(); return; } shiftW(n); });
  tabs('estudio');
}
// Cuánto estudiar: tres niveles y el máximo al día. Nada más.
function openCuanto() {
  S.estudio = S.estudio || { nivel: {}, ajuste: {} };
  const m = S.estMax || {}, F = { n: nivelAct(), s: m.semana ?? 2, f: m.finde ?? 3 };
  const { q, close } = sheet(`
    <header><h2>Cuánto estudio</h2><button type="button" class="icon" data-x aria-label="Cerrar">${ico('x')}</button></header>
    <div class="seg2" role="group" style="margin:0">${NIVELES.map(([f, t]) => `<button type="button" data-niv="${f}">${t}<small data-nh="${f}"></small></button>`).join('')}</div>
    <small class="hint" id="cHint"></small>
    <div class="adj-row"><span class="adj-n">Máximo al día<small>De lunes a viernes</small></span>
      <div class="stepper"><button type="button" data-st="s,-0.5" aria-label="Menos">−</button><output id="cS"></output><button type="button" data-st="s,0.5" aria-label="Más">+</button></div></div>
    <div class="adj-row"><span class="adj-n">Máximo al día<small>Sábado y domingo</small></span>
      <div class="stepper"><button type="button" data-st="f,-0.5" aria-label="Menos">−</button><output id="cF"></output><button type="button" data-st="f,0.5" aria-label="Más">+</button></div></div>
    <footer><span class="sp"></span><button type="submit" class="btn primary">Guardar</button></footer>`);
  // horas que daría cada opción esta semana (con los máximos que tengas puestos en la ventana)
  const prevista = () => {
    const st = estStart(Math.max(0, S.estOff || 0)), old = { r: S.ritmo, m: S.estMax, o: S.estudio.objetivo };
    delete S.estudio.objetivo; S.estMax = { semana: F.s, finde: F.f };
    const out = NIVELES.map(([f]) => { S.ritmo = f; const W = weekPlan(st); return { f, h: W.sugerido, tope: W.tope }; });
    if (old.r === undefined) delete S.ritmo; else S.ritmo = old.r;
    if (old.m === undefined) delete S.estMax; else S.estMax = old.m;
    if (old.o != null) S.estudio.objetivo = old.o;
    PLAN_CACHE = {};
    return out;
  };
  const paint = () => {
    document.querySelectorAll('[data-niv]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.niv) === F.n)));
    q('#cS').textContent = hfmt(F.s); q('#cF').textContent = hfmt(F.f);
    const P = prevista();
    P.forEach(p => { const el = q(`[data-nh="${p.f}"]`); if (el) el.textContent = hfmt(p.h) + ' a la semana'; });
    const igual = P[1].h === P[2].h || P[0].h === P[1].h;
    q('#cHint').textContent = igual && P[2].h >= P[2].tope ? `Tu máximo al día no deja más de ${hfmt(P[2].tope)} a la semana: súbelo para estudiar más.`
      : igual ? 'Esta semana tienes poco tiempo libre: casi no hay diferencia entre opciones.' : '';
  };
  document.querySelectorAll('[data-niv]').forEach(b => b.onclick = () => { F.n = Number(b.dataset.niv); paint(); });
  document.querySelectorAll('.sheet [data-st]').forEach(b => b.onclick = () => {
    const [k, d] = b.dataset.st.split(','); F[k] = Math.min(10, Math.max(0, F[k] + Number(d))); paint();
  });
  paint();
  q('form').onsubmit = e => {
    e.preventDefault();
    S.ritmo = F.n; delete S.estudio.objetivo;
    S.estMax = { semana: F.s, finde: F.f };
    PLAN_CACHE = {};
    save(); close(); toast('Guardado'); render();
  };
}

/* ---------- cada asignatura: sus exámenes y cuánto la estudias ----------
   Los exámenes oficiales salen del calendario de la escuela; el alumno añade sus controles y entregas.
   Quatri no propone temas: qué entra en cada examen lo dice el profesor en clase. */
let EV = {};      // evaluación de la guía: código -> [final, pesos]
let EV_ID = null; // escuela de la que es EV
async function loadEval() {
  const id = D._id;
  if (EV_ID === id) return EV;
  try {
    const r = await fetch(`data/evaluacion-${id}.json`), e = r.ok ? await r.json() : {};
    if (D._id === id) { EV = e; EV_ID = id; } // si mientras tanto has cambiado de escuela, no sirve
  } catch { /* sin conexión: sin pesos */ }
  return EV;
}

// Por qué una asignatura tiene esas horas: créditos, cómo la llevas y lo cerca que está el examen
function porQue(r) {
  const p = [];
  if (r.a.cr) p.push(`${num(r.a.cr)} créditos`);
  if (r.cu === 'cuesta') p.push('te cuesta (+35 %)'); else if (r.cu === 'bien') p.push('la llevas bien (−30 %)');
  if (r.ex) p.push(`${exName(r.ex).toLowerCase()} en ${r.daysTo} días${r.urg > 1.04 ? ` (+${Math.round((r.urg - 1) * 100)} %)` : ''}`);
  return p.join(' · ');
}
function openTemario(code) { S.temCode = code; save(); go('temario'); }

async function viewTemario() {
  const code = S.temCode, a = subj(code), v = $('#view');
  tabs('estudio');
  if (EV_ID !== D._id) {
    v.innerHTML = '<p class="lead">Cargando…</p>';
    await loadEval();
    if (S.temCode !== code || current() !== 'temario') return;
  }
  S.estudio = S.estudio || { nivel: {}, ajuste: {} };
  const E = S.estudio, today = dkey(new Date());
  const r = weekPlan(estStart()).rows.find(x => x.c === code);
  const ex = examsOf(code).sort((x, y) => x[1].localeCompare(y[1]));
  v.innerHTML = `
    <button class="link back" id="tBack">${ico('left')} Estudio</button>
    <div class="tem-head" style="${colorVars(code)}"><span class="bar"></span><div>
      <h1>${esc(a.n)}</h1></div></div>
    <div class="eday">Esta semana</div>
    ${r && r.lv !== 'no' ? `<div class="field" style="margin:0 0 6px"><span>¿Cómo la llevas?</span>
        <div class="seg2" role="group" style="margin:0">${CUESTA.map(([k, t]) => `<button data-cu="${k}" aria-pressed="${(r.cu || '') === k}">${t}</button>`).join('')}</div></div>
      <div class="adj-row"><span class="adj-n">Horas de estudio<small style="white-space:normal">${r.manual ? 'Puestas por ti' : porQue(r)}</small></span>
        <div class="stepper"><button data-m aria-label="Menos">−</button><output>${hfmt(r.horas)}</output><button data-p aria-label="Más">+</button></div></div>
      <div class="row" style="gap:14px;flex-wrap:wrap">${r.manual ? '<button class="link" id="tAuto">Que lo calcule Quatri</button>' : ''}<button class="link" id="tNo">No la estudio</button></div>`
      : `<p class="hint" style="margin:0 0 6px">${examsOf(code).length ? 'No le pones horas de estudio.' : 'No tiene examen: no te ponemos horas de estudio.'}</p>
         <button class="btn small" id="tSi">La estudio</button>`}
    <div class="eday" style="margin-top:22px">Exámenes</div>
    <div class="stack">${ex.map(e => { const d = dparse(e[1]); return `
      <button class="exrow${e[1] < today ? ' past' : ''}" style="${colorVars(code)}" ${e[5] ? `data-exid="${e[5]}"` : ''}>
        <span class="md">${DAYS_SHORT[wdOf(d)]} ${d.getDate()}/${d.getMonth() + 1}</span>
        <span><b>${esc(exName(e))}</b><small>${e[2] ? `${e[2]}–${e[3]}` : 'Sin hora'}${e[5] ? '' : ' · oficial'}</small></span>
        ${e[5] ? ico('right') : ''}</button>`; }).join('') || '<p class="hint">No hay exámenes en el calendario.</p>'}</div>
    ${(EV[code] || [])[1] ? `<p class="hint" style="margin:8px 0 0">Nota final: ${esc(EV[code][1])}</p>` : ''}
    <button class="btn" id="tAddEx" style="margin-top:10px">+ Añadir control o entrega</button>`;
  const rerender = () => { save(); const y = window.scrollY; viewTemario(); window.scrollTo(0, y); };
  const step = d => { E.ajuste = E.ajuste || {}; E.ajuste[code] = Math.max(0, Math.round((r.horas + d) * 2) / 2); rerender(); };
  if ($('[data-m]')) $('[data-m]').onclick = () => step(-0.5);
  if ($('[data-p]')) $('[data-p]').onclick = () => step(0.5);
  v.querySelectorAll('[data-cu]').forEach(b => b.onclick = () => {
    E.cuesta = E.cuesta || {}; if (b.dataset.cu) E.cuesta[code] = b.dataset.cu; else delete E.cuesta[code];
    PLAN_CACHE = {}; rerender();
  });
  if ($('#tAuto')) $('#tAuto').onclick = () => { delete E.ajuste[code]; rerender(); };
  if ($('#tNo')) $('#tNo').onclick = () => { E.nivel = E.nivel || {}; E.nivel[code] = 'no'; delete (E.ajuste || {})[code]; rerender(); };
  if ($('#tSi')) $('#tSi').onclick = () => { E.nivel = E.nivel || {}; E.nivel[code] = 'si'; rerender(); };
  $('#tBack').onclick = () => go('estudio');
  $('#tAddEx').onclick = () => openExamen(code, null);
  v.querySelectorAll('[data-exid]').forEach(b => b.onclick = () => openExamen(code, b.dataset.exid));
}

// Añadir o editar un control / examen propio
function openExamen(code, id, after) {
  S.examenes = S.examenes || {};
  const x = id ? S.examenes[id] : null;
  const F = { tipo: x?.tipo || 'control' };
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `
    <form class="sheet" novalidate style="${colorVars(code)}">
      <header><h2>${x ? 'Editar' : 'Nuevo'} examen · ${esc(subj(code).s)}</h2><button type="button" class="icon" data-x aria-label="Cerrar">${ico('x')}</button></header>
      <div class="field"><span>Tipo</span><div class="seg2 four" role="group" style="margin:0">${EX_TIPOS.map(([k, n]) => `<button type="button" data-tipo="${k}">${n}</button>`).join('')}</div></div>
      <label class="field"><span>Nombre (opcional)</span><input id="xN" maxlength="50" value="${esc(x?.nombre || '')}" placeholder="Ej.: Control 2 · Tema 3" autocomplete="off"></label>
      <label class="field"><span>Día</span><input type="date" id="xD" value="${x?.fecha || ''}"></label>
      <div class="fields">
        <label class="field"><span>Empieza</span><input type="time" id="xI" step="300" value="${x?.ini || ''}"></label>
        <label class="field"><span>Acaba</span><input type="time" id="xF" step="300" value="${x?.fin || ''}"></label>
      </div>
      <small class="hint" id="xHint"></small>
      <p class="err" id="xErr" hidden></p>
      <div class="confirm" id="xDelC" hidden></div>
      <footer>
        ${x ? '<button type="button" class="btn danger" id="xDel">Eliminar</button>' : ''}
        <span class="sp"></span>
        <button type="button" class="btn" data-x>Cancelar</button>
        <button type="submit" class="btn primary">Guardar</button>
      </footer>
    </form>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const q = s => ov.querySelector(s);
  const close = () => { ov.remove(); document.body.style.overflow = ''; };
  const done = msg => { save(); close(); toast(msg); if (after) after(); else { const y = window.scrollY; render(); window.scrollTo(0, y); } };
  ov.querySelectorAll('[data-x]').forEach(b => b.onclick = close);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  const paint = () => {
    ov.querySelectorAll('[data-tipo]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tipo === F.tipo)));
    q('#xHint').textContent = F.tipo === 'entrega' ? 'Para una entrega, la hora es opcional.' : 'Ocupa ese rato en tu día y cuenta el trayecto a la uni.';
  };
  ov.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => { F.tipo = b.dataset.tipo; paint(); });
  paint();
  const err = m => { q('#xErr').textContent = m; q('#xErr').hidden = false; };
  q('form').onsubmit = e => {
    e.preventDefault();
    const fecha = q('#xD').value, ini = q('#xI').value, fin = q('#xF').value;
    if (!fecha) return err('Elige el día.');
    if (F.tipo !== 'entrega' && (!ini || !fin)) return err('Indica a qué hora empieza y acaba.');
    if (ini && fin && toMin(fin) <= toMin(ini)) return err('La hora de fin tiene que ser posterior a la de inicio.');
    if (!!ini !== !!fin) return err('Pon la hora de inicio y la de fin, o ninguna.');
    S.examenes[id || newId()] = { code, tipo: F.tipo, nombre: q('#xN').value.trim(), fecha, ini, fin };
    done(x ? 'Examen actualizado' : 'Examen añadido');
  };
  if (q('#xDel')) q('#xDel').onclick = () => {
    const c = q('#xDelC'); c.hidden = false;
    c.innerHTML = `<span>¿Eliminar este examen?</span><div class="row"><button type="button" class="btn danger" id="dY">Sí, eliminar</button><button type="button" class="btn" id="dN">Cancelar</button></div>`;
    q('#dN').onclick = () => { c.hidden = true; };
    q('#dY').onclick = () => { delete S.examenes[id]; done('Examen eliminado'); };
  };
}

/* ---------- apariencia: automático / claro / oscuro ---------- */
function applyTheme() {
  const t = S.tema || 'auto', root = document.documentElement;
  if (t === 'claro') root.dataset.theme = 'light';
  else if (t === 'oscuro') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  const dark = t === 'oscuro' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // color de la barra del sistema en el móvil
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.setAttribute('content', dark ? '#0E1014' : '#F3F4F7'); m.removeAttribute('media'); });
}

/* ---------- rutina de exámenes (pantalla) ---------- */
function viewRutinaEx() {
  const X = rutinaEx(), R = { ...RUTINA_DEF, ...(S.rutina || {}) }, v = $('#view');
  const fd = k => { const d = dparse(k); return `${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
  const per = examPeriods().map(p => `<li><b>${p.n === 'parciales' ? 'Parciales' : 'Finales'}:</b> del ${fd(p.a)} al ${fd(p.b)}${p.n === 'finales' ? ' (desde que acaban las clases)' : ''}</li>`).join('');
  const hs = (id, label, vals, val) => `<label class="field"><span>${label}</span><select id="${id}">${vals.map(h => `<option value="${h}" ${val === h ? 'selected' : ''}>${hfmt(h)}</option>`).join('')}</select></label>`;
  v.innerHTML = `
    <button class="link back" id="xBack">${ico('left')} Ajustes</button>
    <h1>Rutina de exámenes</h1>
    <p class="lead">En época de exámenes tu día cambia: estudias más, cenas más tarde, dejas cosas… Quatri usa esta rutina esos días y coloca más estudio.</p>
    <section class="card stack">
      <label class="check"><input type="checkbox" id="xA" ${X.activa ? 'checked' : ''}> <b>Usar la rutina de exámenes</b></label>
      <ul class="plain">${per}</ul>
    </section>
    <div id="xBox" class="stack" ${X.activa ? '' : 'hidden'} style="margin-top:12px">
      <section class="card stack"><h2 class="card-t">La noche</h2>
        <label class="check"><input type="checkbox" id="xN" ${X.estudiaNoche ? 'checked' : ''}> Estudio después de cenar</label>
        <div class="fields">
          <label class="field"><span>Cenas a las</span><input type="time" id="xC" step="300" value="${X.cena || R.cena}"></label>
          <label class="field"><span>Te vas a dormir a las</span><input type="time" id="xD" step="300" value="${X.dormir || R.dormir}"></label>
        </div></section>
      <section class="card stack"><h2 class="card-t">Estudio al día</h2>
        <div class="fields">
          ${hs('xS', 'Máximo entre semana', [3, 4, 5, 6, 7, 8], X.maxSemana)}
          ${hs('xF', 'Máximo el fin de semana', [3, 4, 5, 6, 7, 8], X.maxFinde)}
        </div></section>
      <section class="card stack"><h2 class="card-t">Dejar en pausa esos días</h2>
        ${EV_TYPES.filter(t => t[0] !== 'estudio' && t[0] !== 'otro').map(([k, n]) => `<label class="check"><input type="checkbox" data-pausa="${k}" ${X.pausar.includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}
        <small class="hint">Los eventos de ese tipo no aparecen ni ocupan tiempo durante los exámenes.</small>
      </section>
    </div>
    <p class="hint" style="margin-top:14px">Los cambios se guardan solos.</p>`;
  const read = () => {
    S.rutinaEx = { activa: $('#xA').checked, estudiaNoche: $('#xN').checked,
      cena: $('#xC').value !== R.cena ? $('#xC').value : '', dormir: $('#xD').value !== R.dormir ? $('#xD').value : '',
      maxSemana: Number($('#xS').value), maxFinde: Number($('#xF').value),
      pausar: [...v.querySelectorAll('[data-pausa]:checked')].map(c => c.dataset.pausa) };
    $('#xBox').hidden = !S.rutinaEx.activa;
    save();
  };
  v.querySelectorAll('input,select').forEach(el => el.onchange = read);
  $('#xBack').onclick = () => go('ajustes');
  tabs('ajustes');
}

/* ---------- ajustes ---------- */
function viewAjustes() {
  const g = grado();
  const v = $('#view');
  const tema = S.tema || 'auto';
  v.innerHTML = `
    <h1>Tu Quatri</h1>
    <p class="lead">${esc(g.n)} · ${S.asignaturas.length} asignaturas · ${esc(D.periodo.curso)} ${esc(D.periodo.q)}</p>
    <section class="card stack cuenta" style="margin-bottom:12px">
      <h2 class="card-t">Cuenta</h2>
      ${USER ? `
        <div><b>${esc(USER.user_metadata?.full_name || USER.email)}</b><br><small class="hint">${esc(USER.email)} · ${S._sync?.dirty ? 'guardando cambios…' : 'todo guardado en tu cuenta'}</small></div>
        <div class="row"><button class="btn small" id="aOut">Cerrar sesión</button><button class="btn small danger" id="aDel">Borrar mi cuenta</button></div>
        <div class="confirm" id="aConf" hidden></div>`
      : `<p style="margin:0">Ahora tus datos solo están en este dispositivo. Entra para guardarlos y tener lo mismo en el móvil y en el ordenador.</p>
        <button class="btn primary" id="aIn">Entrar o crear cuenta</button>`}
    </section>
    ${(() => {
      const A = avisosCfg();
      const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, t]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
      return `<section class="card stack" style="margin-bottom:12px">
        <h2 class="card-t">Avisos</h2>
        ${!USER ? `<p style="margin:0">Entra en tu cuenta para recibir avisos de clases, estudio y exámenes, aunque tengas Quatri cerrada.</p>`
        : `<p style="margin:0" id="avDev">Comprobando este dispositivo…</p>
          <div id="avOpts" class="stack" ${A.on ? '' : 'hidden'}>
            <div class="fields">
              <label class="field"><span>Antes de cada clase</span>${sel('avC', [[0, 'No avisar'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes']], A.clase)}</label>
              <label class="field"><span>Resumen del día</span>${sel('avR', [['', 'No'], ['07:00', 'A las 7:00'], ['07:30', 'A las 7:30'], ['08:00', 'A las 8:00'], ['08:30', 'A las 8:30'], ['09:00', 'A las 9:00']], A.resumen)}</label>
            </div>
            <label class="check"><input type="checkbox" id="avE" ${A.estudio ? 'checked' : ''}> Cuando empieza un bloque de estudio</label>
            <label class="check"><input type="checkbox" id="avX" ${A.examen ? 'checked' : ''}> Exámenes y controles (7, 3 y 1 día antes)</label>
            <div class="fields" id="avXBox" ${A.examen ? '' : 'hidden'}>
              <label class="field"><span>Avisos de exámenes a las</span>${sel('avXH', [['09:00', '9:00 (mañana)'], ['14:00', '14:00 (mediodía)'], ['18:00', '18:00 (tarde)'], ['20:00', '20:00 (noche)'], ['21:00', '21:00 (noche)']], A.examenHora)}</label>
            </div>
            <button class="btn small" id="avTest" style="align-self:flex-start">Enviarme un aviso de prueba</button>
          </div>`}
      </section>`;
    })()}
    <section class="card stack" style="margin-bottom:12px">
      <h2 class="card-t">Apariencia</h2>
      <div class="seg2" role="group" aria-label="Modo de color" style="margin:0">
        <button data-tema="auto" aria-pressed="${tema === 'auto'}">Automático</button>
        <button data-tema="claro" aria-pressed="${tema === 'claro'}">Claro</button>
        <button data-tema="oscuro" aria-pressed="${tema === 'oscuro'}">Oscuro</button>
      </div>
      <small class="hint">Automático sigue el modo de tu móvil.</small>
    </section>
    <div class="stack">
      <button class="choice" data-go="rutinaex"><span><b>Rutina de exámenes</b><span class="code">Cómo cambia tu día en parciales y finales</span></span></button>
      <button class="choice" data-go="rutina"><span><b>Mi rutina</b><span class="code">Trayecto, comidas, sueño y cuánto estudias al día</span></span></button>
      <button class="choice" data-go="semana"><span><b>Mi horario de clases</b><span class="code">Semana tipo y avisos de solapes</span></span></button>
      <button class="choice" data-go="grupos"><span><b>Mis grupos</b><span class="code">Cambiar de subgrupo en alguna asignatura</span></span></button>
      <button class="choice" data-go="asignaturas"><span><b>Mis asignaturas</b><span class="code">Añadir o quitar asignaturas</span></span></button>
      <button class="choice" data-go="grado"><span><b>Cambiar de escuela o de grado</b><span class="code">${esc(D.escuela?.s || '')} · ${esc(grado()?.n || '')}</span></span></button>
      <button class="choice" data-go="bienvenida"><span><b>Cómo funciona Quatri</b><span class="code">Vuelve a ver la presentación</span></span></button>
    </div>
    <p class="hint" style="margin-top:18px">Horarios: Visor d'Horaris UPC · Créditos y evaluación: guías docentes UPC · <a href="privacidad.html" target="_blank" rel="noopener">Privacidad</a></p>`;
  v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  if ($('#aIn')) $('#aIn').onclick = openLogin;
  // avisos: ¿está activado en ESTE dispositivo? (cada móvil u ordenador se activa por separado)
  if ($('#avDev')) (async () => {
    let sub = null;
    try { if (pushOk()) sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch {}
    const on = avisosCfg().on && sub && Notification.permission === 'granted';
    const el = $('#avDev'); if (!el) return;
    el.innerHTML = on ? `<b>Activados en este dispositivo.</b> <button class="link" id="avOff">Desactivar</button>`
      : `${avisosCfg().on ? 'Tienes los avisos activados en otro dispositivo, pero no en este.' : 'Te avisamos antes de clase, al empezar a estudiar y antes de los exámenes.'}
        <br><button class="btn primary small" id="avOn" style="margin-top:8px">Activar avisos aquí</button>`;
    if ($('#avOn')) $('#avOn').onclick = async () => { if (await activarAvisos()) { toast('Avisos activados'); viewAjustes(); } };
    if ($('#avOff')) $('#avOff').onclick = async () => { await desactivarAvisos(); toast('Avisos desactivados'); viewAjustes(); };
  })();
  const avSave = () => {
    S.avisos = { ...avisosCfg(), clase: Number($('#avC').value), resumen: $('#avR').value, estudio: $('#avE').checked, examen: $('#avX').checked, examenHora: $('#avXH').value };
    $('#avXBox').hidden = !S.avisos.examen;
    save(); programarAvisos(true); toast('Guardado');
  };
  ['#avC', '#avR', '#avE', '#avX', '#avXH'].forEach(id => { if ($(id)) $(id).onchange = avSave; });
  if ($('#avTest')) $('#avTest').onclick = avisoPrueba;
  if ($('#aOut')) $('#aOut').onclick = () => {
    const c = $('#aConf'); c.hidden = false;
    c.innerHTML = `<span>Se borrarán los datos de este dispositivo. En tu cuenta siguen guardados y vuelven al entrar.</span><div class="row"><button class="btn" id="oY">Cerrar sesión</button><button class="btn" id="oN">Cancelar</button></div>`;
    $('#oN').onclick = () => { c.hidden = true; }; $('#oY').onclick = logout;
  };
  if ($('#aDel')) $('#aDel').onclick = () => {
    const c = $('#aConf'); c.hidden = false;
    c.innerHTML = `<span><b>Se borrará tu cuenta y todo lo que tienes guardado, para siempre.</b> No se puede deshacer.</span><div class="row"><button class="btn danger" id="dY">Sí, borrar mi cuenta</button><button class="btn" id="dN">Cancelar</button></div>`;
    $('#dN').onclick = () => { c.hidden = true; }; $('#dY').onclick = borrarCuenta;
  };
  v.querySelectorAll('[data-tema]').forEach(b => b.onclick = () => { S.tema = b.dataset.tema; save(); applyTheme(); viewAjustes(); });
  tabs('ajustes');
}

/* ---------- arranque ---------- */
const escId = () => S.escuela || ESC_DEF;
const escInfo = id => (ESC?.escuelas || []).find(x => x.id === (id || escId()));
// carga los horarios de una escuela (y olvida el temario de la anterior)
async function loadEscuela(id) {
  if (!ESC) { const r = await fetch(ESC_URL); if (!r.ok) throw new Error(r.status); ESC = await r.json(); }
  const e = escInfo(id) || escInfo(ESC_DEF);
  const r = await fetch('data/' + e.archivo);
  if (!r.ok) throw new Error(r.status);
  D = await r.json(); D._id = e.id;
  EV = {}; EV_ID = null; PLAN_CACHE = {}; colorCache = null;
}
async function start() {
  try {
    await loadEscuela(escId());
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
  initCuenta();
}
start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
  // cuando se instala una versión nueva, recarga una vez para usarla
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
