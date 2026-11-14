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
  PLAN_CACHE = {}; // cualquier cambio puede mover el estudio colocado en la semana
  if (USER) S._sync = { ...(S._sync || {}), uid: USER.id, dirty: true };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { toast('No se ha podido guardar en este dispositivo.'); }
  if (USER) { clearTimeout(SYNC_T); SYNC_T = setTimeout(push, 1500); } // sube los cambios a tu cuenta
}
let PLAN_CACHE = {};

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
    <header><h2>Entrar en Quatri</h2><button type="button" class="icon" data-x aria-label="Cerrar">×</button></header>
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
if (location.hostname === 'localhost') window.__quatri = { listaAvisos, setAvisos: a => { S.avisos = { ...avisosCfg(), ...a }; } };
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
      <section class="card stack"><div class="eyebrow">Estudio</div>
        <div class="fields">
          <label class="field"><span>Un día normal te ves estudiando</span><select id="estS">${[1, 1.5, 2, 3, 4].map(h => `<option value="${h}" ${(S.estMax?.semana ?? 2) === h ? 'selected' : ''}>${hfmt(h)}</option>`).join('')}</select></label>
          <label class="field"><span>Un día de fin de semana</span><select id="estF">${[0, 1, 2, 3, 4, 5].map(h => `<option value="${h}" ${(S.estMax?.finde ?? 3) === h ? 'selected' : ''}>${h ? hfmt(h) : 'Nada'}</option>`).join('')}</select></label>
          <label class="field wide"><span>¿Cuándo prefieres estudiar?</span><select id="estPref">${[['repartido', 'Repartido: mañana y tarde'], ['manana', 'Por la mañana'], ['tarde', 'Por la tarde'], ['noche', 'Por la noche']]
            .map(([k, t]) => `<option value="${k}" ${(S.estPref || 'repartido') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </div>
        <small class="hint">Quatri te propone el estudio en tus huecos libres a esas horas, sin pasar de esto al día (en exámenes, más). Siempre lo puedes mover.</small></section>
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
    S.estMax = { semana: Number($('#estS').value), finde: Number($('#estF').value) };
    S.estPref = $('#estPref').value;
    // estudiar por la noche implica poder estudiar después de cenar
    if (S.estPref === 'noche' && !R.estudiaNoche) { R.estudiaNoche = true; $('#estudiaNoche').checked = true; toast('Marcado «Estudio después de cenar» para poder estudiar por la noche'); }
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
    <div class="welcome-top">
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
      <span><i aria-hidden="true">✓</i>Con tu cuenta de Google o tu correo, lo tienes igual en el móvil y el ordenador</span>
      <span><i aria-hidden="true">✓</i>Horarios oficiales del Visor d'Horaris UPC</span>
    </div>
    <p class="hint" style="margin-top:12px">Ahora mismo, Quatri tiene los horarios de la ESEIAAT (Terrassa) para el ${esc(D.periodo.curso.replace('-', '/'))} ${esc(D.periodo.q)}.</p>`;
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
      <header><h2>${esc(a.n)}</h2><button type="button" class="icon" data-x aria-label="Cerrar">×</button></header>
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
    <header><h2>Estudio · ${esc(subj(code).n)}</h2><button type="button" class="icon" data-x aria-label="Cerrar">×</button></header>
    <p class="hint" style="margin:-6px 0 0">${DAYS[wdOf(d)]} ${d.getDate()} · ${fmt(s % 1440)}–${fmt(e % 1440)}${tema ? ` · ${esc(tema)}` : ''}</p>
    <p style="margin:0">${fijoId ? 'Lo moviste tú a esta hora.' : 'Es una propuesta de Quatri para llegar bien al examen.'} Cuando lo hayas hecho, márcalo; si te va mejor otro rato, muévelo.</p>
    <div id="pMove" class="stack" hidden>
      <div class="fields">
        <label class="field"><span>Día</span><select id="pD">${dias.map(k => { const x = dparse(k); return `<option value="${k}" ${k === ds ? 'selected' : ''}>${k === today ? 'Hoy' : DAYS[wdOf(x)]} ${x.getDate()}</option>`; }).join('')}</select></label>
        <label class="field"><span>Empieza</span><input type="time" id="pI" step="300" value="${fmt(s % 1440)}"></label>
      </div>
      <small class="hint">Dura ${dur(len)}. El resto de tu estudio se recoloca alrededor.</small>
      <p class="err" id="pErr" hidden></p>
    </div>
    <footer>
      <button type="button" class="btn" id="pSkip">${fijoId ? 'Quitar' : 'Saltar'}</button>
      <button type="button" class="btn" id="pMv">Mover</button>
      <span class="sp"></span>
      <button type="button" class="btn primary" id="pDone">Hecho ✓</button>
    </footer>`);
  const quitarFijo = () => { if (fijoId && S.estFijo) delete S.estFijo[fijoId]; };
  q('#pDone').onclick = () => {
    S.estDone = S.estDone || {};
    S.estDone[newId()] = { ds, s, e, code, t: tema || '' };
    quitarFijo();
    save(); close(); toast('¡Bien! Cuenta para tu semana'); render();
  };
  q('#pSkip').onclick = () => {
    S.estSkip = S.estSkip || {};
    (S.estSkip[ds] = S.estSkip[ds] || []).push({ s, e });
    quitarFijo();
    save(); close(); toast('Recolocado en otro hueco'); render();
  };
  q('#pMv').onclick = () => {
    const box = q('#pMove');
    if (box.hidden) { box.hidden = false; q('#pMv').textContent = 'Guardar aquí'; q('#pMv').classList.add('primary'); return; }
    const nd = q('#pD').value, ni = q('#pI').value;
    const err = m => { q('#pErr').textContent = m; q('#pErr').hidden = false; };
    if (!ni) return err('Elige la hora.');
    const ns = toMin(ni), ne = ns + len;
    // no puede pisar clases, comidas, eventos ni otros bloques tuyos
    const p = dayPlan(nd);
    const choque = p.blocks.find(b => b.kind !== 'noche' && b.s < ne && ns < b.e);
    if (choque) return err(`A esa hora tienes ${choque.kind === 'clase' ? 'clase de ' + choque.label : choque.label.toLowerCase()} (${fmt(choque.s % 1440)}–${fmt(choque.e % 1440)}).`);
    const otro = Object.entries(S.estFijo || {}).find(([id, f]) => id !== fijoId && f.ds === nd && f.s < ne && ns < f.e);
    if (otro) return err('A esa hora ya tienes otro bloque de estudio que has movido.');
    if (ne > p.sleep) return err('Acabaría después de tu hora de dormir.');
    S.estFijo = S.estFijo || {};
    S.estFijo[fijoId || newId()] = { ds: nd, s: ns, e: ne, code, t: tema || '' };
    save(); close(); toast('Bloque movido'); render();
  };
}
function openDone(id) {
  const h = (S.estDone || {})[id];
  if (!h) return;
  const { q, close } = sheet(`
    <header><h2>Estudio · ${esc(subj(h.code).n)}</h2><button type="button" class="icon" data-x aria-label="Cerrar">×</button></header>
    <p style="margin:0">Hecho ✓ ${fmt(h.s % 1440)}–${fmt(h.e % 1440)}${h.t ? ` · ${esc(h.t)}` : ''}. Cuenta como horas de estudio de la semana.</p>
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
    for (const s of mySessions()) {
      const x = s.x;
      if (x[0] !== info.wd) continue;
      if (x[5] && x[5].length === 1 && x[5] !== info.week) continue; // laboratorios de semanas alternas
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
  // solo hay trayecto a la uni si ese día tienes algo allí (clase, examen o estudio en la uni)
  const atUni = blocks.filter(b => b.kind === 'clase' || b.kind === 'examen' || b.uni);
  if (atUni.length) {
    const first = Math.min(...atUni.map(b => b.s)), last = Math.max(...atUni.map(b => b.e));
    blocks.push({ s: first - T, e: first, kind: 'trayecto', label: 'Ida a la uni' });
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
    label: `Estudio · ${subj(h.code).n}`, sub: `${h.t ? h.t + ' · ' : ''}hecho ✓` });
  // eventos propios del alumno (entrenos, trabajo, planes...) y sus trayectos; en exámenes se pueden dejar en pausa
  const evs = eventsOn(ds).filter(x => !(X && (X.pausar || []).includes(x.ev.tipo)));
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
  return { info, blocks, free, skipped, wake, sleep, allDay, exRut: !!X, freeMin: free.reduce((n, f) => n + f.e - f.s, 0),
    classMin: blocks.filter(b => b.kind === 'clase').reduce((n, b) => n + b.e - b.s, 0) };
}

/* ---------- Tu día ---------- */
function viewHoy() {
  S.dia = S.dia || dkey(new Date());
  const ds = S.dia, p = dayView(ds), d = p.info.d, today = dkey(new Date());
  const rel = ds === today ? 'Hoy' : ds === dkey(addDays(new Date(), 1)) ? 'Mañana' : ds === dkey(addDays(new Date(), -1)) ? 'Ayer' : DAYS[p.info.wd];
  const items = [...p.blocks, ...p.free, ...p.skipped].sort((a, b) => a.s - b.s || (b.kind === 'saltada') - (a.kind === 'saltada'));
  const row = it => {
    const style = it.code ? `${colorVars(it.code)}` : it.kind === 'evento' ? `--ev:${evColor(it.tipo)}` : '';
    const label = it.kind === 'libre' ? `Libre · ${dur(it.e - it.s)}` : it.kind === 'saltada' ? `No vas · ${esc(it.label)}` : esc(it.label);
    if (it.kind === 'saltada') it = { ...it, sub: `${it.sub} · ${it.siempre ? 'no vas nunca' : 'solo este día'}` };
    const data = it.kind === 'evento' ? `data-ev="${it.id}"` : it.kind === 'libre' ? `data-free="${it.s},${it.e}"` : it.rk ? `data-rut="${it.rk}"`
      : it.kind === 'plan' ? `data-plan="${it.s},${it.e},${it.code},${it.fijoId || ''}" data-tema="${esc(it.tema || '')}"` : it.doneId ? `data-done="${it.doneId}"` : it.exId ? `data-exam="${it.exId}" data-code="${it.code}"` : it.ck ? `data-cls="${esc(it.ck)}"` : '';
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
    <div class="hoy-grid">
    <aside class="hoy-side">
    <div class="stats">
      <div class="stat free"><b>${dur(p.freeMin)}</b><span>libres de verdad</span></div>
      <div class="stat"><b>${p.classMin ? dur(p.classMin) : '—'}</b><span>de clase</span></div>
      ${p.planMin ? `<div class="stat"><b>${dur(p.planMin)}</b><span>de estudio propuesto</span></div>` : ''}
    </div>
    ${p.info.note ? `<div class="notice warn" style="margin-top:12px">${esc(p.info.note)}</div>` : ''}
    ${p.exRut ? `<button class="notice exrut" id="exRutGo" style="margin-top:8px">Rutina de exámenes activa · <span>cambiarla ›</span></button>` : ''}
    ${p.allDay.map(x => `<div class="allday" style="--ev:${evColor(x.ev.tipo)}" data-ev="${x.id}"><b>${esc(x.ev.titulo)}</b><small>Todo el día${x.ev.lugar ? ' · ' + esc(x.ev.lugar) : ''}</small></div>`).join('')}
    ${(() => {
      // solo en pantallas grandes: los próximos exámenes, para aprovechar el espacio de la columna
      const ex = (S.asignaturas || []).flatMap(c => examsOf(c).filter(e => e[1] >= today).map(e => ({ c, e })))
        .sort((x, y) => x.e[1].localeCompare(y.e[1])).slice(0, 5);
      if (!ex.length) return '';
      return `<section class="card desk-only next-ex"><div class="eyebrow">Próximos exámenes</div>
        ${ex.map(({ c, e }) => { const dd = dparse(e[1]), n = Math.round((dd - dparse(today)) / 864e5); return `<div class="nx" style="${colorVars(c)}"><i></i>
          <span><b>${esc(exName(e))} · ${esc(subj(c).s)}</b><small>${esc(subj(c).n)}</small></span>
          <span class="nx-d">${DAYS_SHORT[wdOf(dd)]} ${dd.getDate()}/${dd.getMonth() + 1}<small>${n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`}</small></span></div>`; }).join('')}
      </section>`;
    })()}
    </aside>
    <div class="hoy-main"><ul class="timeline">${items.map(row).join('')}</ul></div>
    </div>`;
  const shift = n => { S.dia = dkey(addDays(dparse(S.dia), n)); save(); viewHoy(); };
  $('#prev').onclick = () => slideTo(v, -1, shift);
  $('#next').onclick = () => slideTo(v, 1, shift);
  if ($('#today')) $('#today').onclick = () => slideTo(v, ds > today ? -1 : 1, () => { S.dia = today; save(); viewHoy(); });
  v.querySelectorAll('[data-ev]').forEach(el => el.onclick = () => openEvent(el.dataset.ev, ds));
  v.querySelectorAll('[data-rut]').forEach(el => el.onclick = () => openRutinaDia(ds, el.dataset.rut));
  v.querySelectorAll('[data-cls]').forEach(el => el.onclick = () => openClase(ds, el.dataset.cls));
  v.querySelectorAll('[data-exam]').forEach(el => el.onclick = () => openExamen(el.dataset.code, el.dataset.exam));
  v.querySelectorAll('[data-plan]').forEach(el => el.onclick = () => { const [s, e, c, fid] = el.dataset.plan.split(','); openPlan(ds, +s, +e, c, el.dataset.tema, fid); });
  v.querySelectorAll('[data-done]').forEach(el => el.onclick = () => openDone(el.dataset.done));
  if ($('#exRutGo')) $('#exRutGo').onclick = () => go('rutinaex');
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
  actions(`<nav class="tabs"><div class="side-brand"><span>quatri<span class="dot">.</span></span><span class="beta">${esc($('.brand .beta')?.textContent || '')}</span></div>${t.map(([id, label, ic]) => `<button data-tab="${id}" aria-current="${id === active ? 'page' : 'false'}"><span aria-hidden="true">${ic}</span>${label}</button>`).join('')}</nav>`);
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
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => { const ds = dkey(addDays(mon, i)); return { ds, p: dayView(ds) }; });
  const showRut = !!S.calRutina;
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
          <b>${esc(subj(b.code).s)}</b>${h > 24 ? '<small>Estudio</small>' : ''}</div>`;
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
    ${events.length ? `<section class="card stack" style="margin-top:12px"><div class="eyebrow">Este mes</div>
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
// Cómo la llevas ya no se pregunta: se deduce del temario (lo que te queda frente a lo que entra).
const levelOf = c => { const n = (S.estudio?.nivel || {})[c]; return n === 'no' ? 'no' : n ? 'si' : (examsOf(c).length ? 'si' : 'no'); };
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
function weekPlan(monKey) {
  S.estudio = S.estudio || { nivel: {}, ajuste: {} };
  const E = S.estudio;
  const mon = dparse(monKey);
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => dayPlan(dkey(addDays(mon, i))));
  const freeMin = days.reduce((n, p) => n + p.freeMin, 0);
  // estudio que ya tienes puesto en vez de ir a clase: cuenta como horas de estudio de esa asignatura
  const hecho = {};
  for (const p of days) for (const b of p.blocks) if (b.kind === 'estudio') hecho[b.code] = (hecho[b.code] || 0) + (b.e - b.s) / 60;
  const estMin = Object.values(hecho).reduce((n, h) => n + h * 60, 0);
  const enEx = days.some(p => p.exRut);
  const codes = (S.asignaturas || []).slice();
  const rows = codes.map(c => {
    const a = subj(c), lv = levelOf(c);
    const oficial = (a.h || (a.cr || 0) * 15) / classWeeks();
    const ex = nextExam(c, monKey);
    const daysTo = ex ? Math.round((dparse(ex[1]) - mon) / 864e5) : null;
    const urg = daysTo == null ? 1 : daysTo <= 14 ? 1.6 : daysTo <= 30 ? 1.25 : 1;
    // cómo la llevas, según el temario: de 0,7 (casi todo hecho) a 1,4 (todo por hacer)
    const P = TM && lv !== 'no' ? temasSemana(c, 0, monKey, ex, daysTo) : null;
    const f = P && P.full ? 0.7 + 0.7 * Math.min(1, P.total / P.full) : 1;
    // en época de exámenes manda lo que te queda de temario hasta el examen, no el ritmo del curso
    let need = null;
    if (enEx && P && P.semanas) need = P.total / P.semanas;
    return { c, a, lv, oficial, ex, daysTo, need, w: need != null ? need * f : oficial * f * urg };
  });
  const oficialTotal = rows.filter(r => r.lv !== 'no').reduce((n, r) => n + r.oficial, 0);
  // ese estudio sale de horas que no eran libres (eran de clase), así que se suma al tiempo disponible
  let sugerido = Math.max(1, Math.min(Math.round((freeMin + estMin) / 60 * 0.4), Math.round(oficialTotal * ritmo())));
  if (enEx) {
    const need = rows.filter(r => r.lv !== 'no').reduce((n, r) => n + (r.need ?? r.oficial * ritmo()), 0);
    sugerido = Math.max(1, Math.min(Math.round((freeMin + estMin) / 60 * 0.6), Math.round(need)));
  }
  // nunca más de lo que tú has dicho que quieres estudiar al día (2 h × 5 + 4 h × 2 = 18 h, por ejemplo)
  const tope = [0, 1, 2, 3, 4, 5, 6].reduce((n, i) => n + estMax(dkey(addDays(mon, i))), 0);
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
    // nunca menos de lo que ya estudias en vez de clase; lo que falta es lo que queda por colocar en tus huecos
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
  const todayK = dkey(new Date()), key = monKey + '|' + todayK;
  if (PLAN_CACHE[key]) return PLAN_CACHE[key];
  const W = weekPlan(monKey), mon = dparse(monKey);
  const pend = {}, tq = {}, lim = {};
  for (const r of W.rows) {
    if (r.lv === 'no' || r.pend <= 0) continue;
    pend[r.c] = Math.round(r.pend * 60);
    if (r.ex) lim[r.c] = r.ex[1]; // no tiene sentido estudiarla el día del examen ni después
    const P = TM ? temasSemana(r.c, r.pend, monKey, r.ex, r.daysTo) : null;
    tq[r.c] = P ? P.out.map(o => ({ t: o.t.t, m: o.h * 60 })) : [];
  }
  const skips = S.estSkip || {};
  const days = W.days.map((p, i) => ({ ds: dkey(addDays(mon, i)), p })).filter(d => d.ds >= todayK);
  for (const d of days) {
    // huecos libres, sin los ratos que has saltado
    // 15 min de margen al llegar de un trayecto (no te pones a estudiar nada más cruzar la puerta)
    let gaps = d.p.free.map(f => ({ s: f.s + (d.p.blocks.some(b => b.kind === 'trayecto' && b.e === f.s) ? 15 : 0), e: f.e }));
    for (const k of skips[d.ds] || []) gaps = gaps.flatMap(g => g.e <= k.s || g.s >= k.e ? [g] : [{ s: g.s, e: k.s }, { s: k.e, e: g.e }]);
    d.gaps = gaps.filter(g => g.e - g.s >= 30);
    // el tope del día descuenta el estudio que ya tiene (hecho o en vez de una clase)
    const ya = d.p.blocks.filter(b => b.kind === 'estudio').reduce((n, b) => n + b.e - b.s, 0);
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
      sub: f.t ? `${f.t} · movido por ti` : 'Movido por ti', tema: f.t || '', ds: f.ds, fijoId: id });
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
    // y se ordenan según cuándo prefieres estudiar; "repartido" alterna mañana, tarde y noche
    const pieces = [];
    d.gaps.forEach((g, gi) => [[0, 840, 'm'], [840, 1200, 't'], [1200, 2880, 'n']].forEach(([a, b, w]) => {
      const s = Math.max(g.s, a), e = Math.min(g.e, b);
      if (e - s >= 30) pieces.push({ s, e, w, gi });
    }));
    const pref = S.estPref || 'repartido', by = w => pieces.filter(p => p.w === w);
    let order;
    if (pref === 'manana') order = [...by('m'), ...by('t'), ...by('n')];
    else if (pref === 'tarde') order = [...by('t'), ...by('n'), ...by('m').reverse()];
    else if (pref === 'noche') order = [...by('n').reverse(), ...by('t').reverse(), ...by('m').reverse()];
    else { // repartido: un bloque por franja y vuelta
      const q = { m: by('m'), t: by('t'), n: by('n') }; order = [];
      while (q.m.length || q.t.length || q.n.length) for (const w of ['m', 't', 'n']) if (q[w].length) order.push(q[w].shift());
    }
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
      const len = Math.floor(Math.min(90, pend[c] < 30 ? 30 : pend[c], quota, lim - t) / 15) * 15;
      if (len < 30) return false;
      const q = tq[c] || [];
      const tema = q.length ? q[0].t : '';
      if (q.length) { q[0].m -= len; if (q[0].m <= 0) q.shift(); }
      blocks.push({ s: t, e: t + len, code: c, kind: 'plan', label: `Estudio · ${subj(c).n}`, sub: tema || 'Propuesta de Quatri', tema, ds: d.ds, gi: p.gi });
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
  return { ...p, blocks: [...p.blocks, ...plan].sort((a, b) => a.s - b.s), free, plan, planMin: plan.reduce((n, b) => n + b.e - b.s, 0) };
}

// "Estos días toca" de cada asignatura + si llegas al examen, en una línea
function temPlanHtml(r, start) {
  if (r.lv === 'no' || !r.horas || !TM) return '';
  const P = temasSemana(r.c, r.horas, start, r.ex, r.daysTo);
  if (!P || !P.out.length) return '';
  const ref = r.ex ? (r.ex[0] === 'final' && !r.ex[5] && finalModo(r.c) === 'segunda' ? 'el segundo parcial' : exRef(r.ex)) : null;
  const ST = Object.fromEntries(TEM_ST);
  let msg = '';
  // hasta que no marques cómo llevas los temas, no sabemos cuánto te queda de verdad
  const marcado = (temasOf(r.c) || []).some(t => t.st !== 'nuevo');
  if (!marcado) msg = `<small class="hint">Marca en el temario lo que ya tienes para saber si llegas.</small>`;
  else if (P.capacidad != null && ref) msg = P.total > P.capacidad + 0.5
    ? `<small class="hint urg">A este ritmo no llegas a ${ref}: te faltan unas ${hfmt(P.total - P.capacidad)}.</small>`
    : `<small class="hint ok">Vas bien para ${ref}.</small>`;
  return `<div class="tplan"><div class="eyebrow">Estos días toca</div>
    <ul>${P.out.map(x => `<li><span>${esc(x.t.t)}<small>${ST[x.t.st]}</small></span><b>${hfmt(x.h)}</b></li>`).join('')}</ul>${msg}</div>`;
}

// Estudio: lo importante a la vista (cuántas horas, qué toca, si llegas); lo demás, dentro de "Ajustar".
function viewEstudio() {
  // el temario de la guía se carga aparte; cuando llega, se vuelve a pintar con "Estos días toca"
  if (!TM) loadTemarios().then(() => { PLAN_CACHE = {}; if (current() === 'estudio') { const y = window.scrollY; viewEstudio(); window.scrollTo(0, y); } });
  const off = Math.max(0, S.estOff || 0), start = estStart(off);
  const W = weekPlan(start), E = S.estudio, a = dparse(start), b = addDays(a, 6);
  const sched = weekSchedule(start), sin = sched._sinHueco;
  const m3 = d => MONTHS[d.getMonth()].slice(0, 3);
  const si = W.rows.filter(r => r.lv !== 'no'), no = W.rows.filter(r => r.lv === 'no');
  // lo que queda de semana: tus máximos de hoy al domingo y lo que Quatri ya ha colocado en esos días
  const today = dkey(new Date());
  const quedan = [0, 1, 2, 3, 4, 5, 6].map(i => dkey(addDays(a, i))).filter(k => k >= today);
  const queda = quedan.reduce((n, k) => n + estMax(k), 0);
  const colocadas = quedan.reduce((n, k) => n + (sched[k] || []).reduce((m, x) => m + x.e - x.s, 0), 0) / 60;
  const pct = W.total ? Math.min(100, Math.round(W.llevas / W.total * 100)) : 0;
  // aviso con la solución en un toque: solo si has puesto tú más horas de las que caben con tu máximo diario
  const X = W.enEx ? rutinaEx() : null, maxS = X ? X.maxSemana : (S.estMax?.semana ?? 2);
  const aviso = sin < 30 || E.objetivo == null ? '' : `<div class="notice warn stack" style="margin-top:10px">
      <span>Has puesto más horas de las que caben con tu máximo al día: faltan unas ${hfmt(sin / 60)}.</span>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        ${maxS < (X ? 10 : 5) ? `<button class="btn small primary" id="avUp">Subir a ${hfmt(maxS + 1)} al día</button>` : ''}
        <button class="btn small" id="avOk">Así está bien</button>
      </div></div>`;
  const v = $('#view');
  v.innerHTML = `
    <div class="dayhead">
      <button class="icon" id="prev" aria-label="Semana anterior" ${off ? '' : 'disabled'}>‹</button>
      <div class="dh"><div class="eyebrow">${off === 0 ? 'Esta semana' : off === 1 ? 'La semana que viene' : 'Más adelante'}</div>
        <h1>${a.getDate()} ${m3(a)} – ${b.getDate()} ${m3(b)}</h1>
        ${off ? '<button class="todaybtn" id="thisweek">Volver a esta semana</button>' : ''}</div>
      <button class="icon" id="next" aria-label="Semana siguiente">›</button>
    </div>
    <section class="card est-sum">
      <div class="est-big"><b>${hfmt(W.total)}</b><span>de estudio esta semana</span></div>
      ${W.total ? `${off ? '' : `<div class="pbar"><i style="width:${pct}%"></i></div>
        <p style="margin:0">Llevas <b>${hfmt(W.llevas)}</b>. De hoy al domingo te quedan <b>${hfmt(colocadas)}</b> repartidas en tus huecos${quedan.length < 7 ? ` (tu máximo esos días: ${hfmt(queda)})` : ''}.</p>`}
        <p class="hint" style="margin:0">Las ves como «Propuesta» en Hoy y en Calendario: márcalas como hechas, muévelas o sáltalas.${W.enEx ? ' Época de exámenes: las horas salen de lo que te queda de temario.' : ''}</p>`
      : '<p class="hint" style="margin:0">No hay nada que estudiar esta semana.</p>'}
      ${!off && E.objetivo == null && sin >= 30 ? `<small class="hint">Lo que no estudiaste los días que ya han pasado no se acumula: nunca te ponemos más de tu máximo diario.</small>` : ''}
      ${aviso}
    </section>
    <div class="est-grid">
      ${si.map(r => `
        <div class="card subjplan" style="${colorVars(r.c)}">
          <div class="sp-head">
            <span class="bar"></span>
            <div class="sp-name"><b>${esc(r.a.n)}</b>
              <small>${r.ex ? `${esc(exName(r.ex))} en ${r.daysTo} días` : 'Sin examen a la vista'}${r.hecho ? ` · ya llevas ${hfmt(r.hecho)}` : ''}</small></div>
            <b class="sp-h">${hfmt(r.horas)}</b>
          </div>
          ${temPlanHtml(r, start)}
          <button class="temlink" data-tem="${r.c}"><span>Temario y exámenes${(() => { const p = temProgress(r.c); return p.n ? ` · ${p.ok} de ${p.n} temas que ya tienes` : ''; })()}</span><span aria-hidden="true">›</span></button>
        </div>`).join('')}
    </div>
    <button class="btn adj-btn" id="adjBtn" aria-expanded="${!!S.estAdv}">Ajustar ${S.estAdv ? '▴' : '▾'}</button>
    <div id="adv" class="stack" ${S.estAdv ? '' : 'hidden'}>
      <section class="card stack">
        <div class="eyebrow">Horas de estudio de la semana</div>
        <div class="stepper big">
          <button id="oMinus" aria-label="Menos horas">−</button>
          <output id="obj">${hfmt(W.objetivo)}</output>
          <button id="oPlus" aria-label="Más horas">+</button>
        </div>
        <small class="hint">Te proponemos ${hfmt(W.sugerido)}, sin pasar de la suma de tus máximos diarios (${hfmt(W.tope)}).${E.objetivo != null && E.objetivo !== W.sugerido ? ' <button class="link" id="oReset">Volver a la propuesta</button>' : ''}</small>
      </section>
      <section class="card stack">
        <div class="eyebrow">¿Cuánto quieres prepararte?</div>
        <div class="seg2 four" role="group" style="margin:0">${RITMOS.map(([f, t]) => `<button data-ritmo="${f}" aria-pressed="${ritmo() === f}">${t}<small>${Math.round(f * 100)} %</small></button>`).join('')}</div>
        <small class="hint">Parte de las horas de la guía docente que quieres cubrir. Casi nadie las hace todas.</small>
      </section>
      <section class="card stack">
        <div class="eyebrow">Horas por asignatura</div>
        ${W.rows.map(r => `<div class="adj-row" style="${colorVars(r.c)}"><span class="dot-c"></span><span class="adj-n">${esc(r.a.s)}<small>${esc(r.a.n)}</small></span>
          ${r.lv === 'no' ? `<button class="btn small" data-l="${r.c}" data-v="si">La estudio</button>`
            : `<div class="stepper"><button data-m="${r.c}" aria-label="Menos">−</button><output>${hfmt(r.horas)}</output><button data-p="${r.c}" aria-label="Más">+</button></div>`}
          </div>
          ${r.lv !== 'no' ? `<div class="adj-sub">${r.manual ? `Ajustada a mano · <button class="link" data-r="${r.c}">automático</button> · ` : ''}<button class="link" data-l="${r.c}" data-v="no">No la estudio</button></div>` : ''}`).join('')}
        <small class="hint">Lo que no toques se reparte solo, según cómo llevas el temario y lo cerca que está cada examen.</small>
      </section>
    </div>`;
  const step = (cur, d) => Math.max(0, Math.round((cur + d) * 2) / 2);
  const rerender = () => { save(); const y = window.scrollY; viewEstudio(); window.scrollTo(0, y); };
  $('#adjBtn').onclick = () => { S.estAdv = !S.estAdv; rerender(); };
  $('#oMinus').onclick = () => { E.objetivo = step(W.objetivo, -1); rerender(); };
  $('#oPlus').onclick = () => { E.objetivo = step(W.objetivo, 1); rerender(); };
  if ($('#oReset')) $('#oReset').onclick = () => { delete E.objetivo; rerender(); };
  if ($('#avUp')) $('#avUp').onclick = () => {
    if (X) S.rutinaEx = { ...rutinaEx(), maxSemana: X.maxSemana + 1, maxFinde: Math.max(X.maxFinde, X.maxSemana + 1) };
    else { const m = S.estMax || {}; S.estMax = { semana: maxS + 1, finde: Math.max(m.finde ?? 3, maxS + 1) }; }
    toast(`Ahora hasta ${hfmt(maxS + 1)} de estudio al día`); rerender();
  };
  if ($('#avOk')) $('#avOk').onclick = () => { E.objetivo = Math.max(1, Math.floor((W.total * 60 - sin) / 30) / 2); toast('Te proponemos solo lo que cabe'); rerender(); };
  v.querySelectorAll('[data-m],[data-p]').forEach(b => b.onclick = () => {
    const c = b.dataset.m || b.dataset.p, r = W.rows.find(x => x.c === c);
    E.ajuste[c] = step(r.horas, b.dataset.m ? -0.5 : 0.5); rerender();
  });
  v.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { delete E.ajuste[b.dataset.r]; rerender(); });
  v.querySelectorAll('[data-tem]').forEach(b => b.onclick = () => openTemario(b.dataset.tem));
  v.querySelectorAll('[data-ritmo]').forEach(b => b.onclick = () => { S.ritmo = Number(b.dataset.ritmo); rerender(); });
  v.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
    E.nivel[b.dataset.l] = b.dataset.v; if (b.dataset.v === 'no') delete E.ajuste[b.dataset.l]; rerender();
  });
  const shiftW = n => { S.estOff = Math.max(0, off + n); save(); viewEstudio(); };
  $('#prev').onclick = () => { if (off) slideTo(v, -1, shiftW); };
  $('#next').onclick = () => slideTo(v, 1, shiftW);
  if ($('#thisweek')) $('#thisweek').onclick = () => slideTo(v, -1, () => { S.estOff = 0; save(); viewEstudio(); });
  swipe(v, n => { if (n < 0 && !off) { viewEstudio(); return; } shiftW(n); });
  tabs('estudio');
}

/* ---------- temario de cada asignatura ----------
   Sale de la guía docente oficial (apartado CONTINGUTS) y el alumno lo puede editar.
   S.temario[código] = { temas: [{ id, t, d, h, ex: 'pf'|'p'|'f'|'', st: 'nuevo'|'viendo'|'ok'|'repasar' }] } */
const TEM_URL = 'data/temarios-eseiaat.json';
let TM = null; // temarios de la guía, se cargan la primera vez que hacen falta
let EV = {};   // evaluación de la guía: código -> [final: 'todo'|'segunda'|'elegir'|'', pesos]
async function loadTemarios() {
  if (TM) return TM;
  const get = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : {}; } catch { return {}; } };
  [TM, EV] = await Promise.all([get(TEM_URL), get('data/evaluacion-eseiaat.json')]);
  return TM;
}
const TEM_ST = [['nuevo', 'Sin empezar'], ['viendo', 'Viendo'], ['ok', 'Lo tengo'], ['repasar', 'Repasar']];
// Títulos de la guía en MAYÚSCULAS -> "Tema 2: Electrocinètica" (se respetan números romanos y siglas cortas)
const niceTitle = t => {
  t = t.replace(/^Títol contingut (\d+):\s*/i, 'Tema $1: ');
  const body = t.replace(/^(tema|mòdul|modul|bloc|part|contingut)\s*[\divx]+\s*[:.\-]\s*/i, '');
  if (body !== body.toUpperCase()) return t;
  const s = t.toLowerCase().replace(/^((?:tema|mòdul|modul|bloc|part)\s+)([ivx]+)\b/, (m, a, b) => a + b.toUpperCase());
  return s.replace(/(^|[:.]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
};
// Si la guía no dice en qué examen entra un tema, suponemos que entra en el final.
const fromGuia = code => (TM?.[code] || []).map(([t, d, h, ex], i) => ({ id: 'g' + i, t: niceTitle(t), d, h, ex: ex || 'f', st: 'nuevo' }));
function temasOf(code) { return S.temario?.[code]?.temas || null; }
function temProgress(code) {
  const ts = temasOf(code) || [];
  return { n: ts.length, ok: ts.filter(t => t.st === 'ok').length };
}
// ¿Qué temas tocar esta semana? Reparte las horas de la asignatura entre los temas que entran en el próximo examen,
// según cómo los llevas y hasta dónde ha llegado el curso (no tiene sentido estudiar lo que aún no se ha dado).
// Temas de la primera parte (los del parcial): los marcados "Parcial"; si no hay ninguno marcado,
// los que se habrán dado en clase el día del parcial.
function parcialSet(code, ts) {
  if (ts.some(t => (t.ex || '').includes('p'))) return new Set(ts.map((t, i) => (t.ex || '').includes('p') ? i : -1).filter(i => i >= 0));
  const p = examsOf(code).filter(e => e[0] === 'parcial').sort((a, b) => a[1].localeCompare(b[1]))[0];
  if (!p) return new Set();
  const c = D.calendario, ini = dparse(c.inicio_clases), fin = dparse(c.fin_clases);
  const prog = Math.min(1, Math.max(0, (dparse(p[1]) - ini) / (fin - ini)));
  const n = Math.round(ts.length * prog);
  return new Set([...Array(n).keys()]);
}
// En el final: 'todo' (final entero o recuperación del parcial) o 'segunda' (solo el segundo parcial).
// La guía dice cómo es en cada asignatura; si hay elección (dos parciales o recuperar el parcial el día del final),
// la decide el alumno tras el parcial. En el GRETI no hay recuperaciones después de los finales.
const finalGuia = code => (EV[code] || [])[0] || '';
const finalModo = code => (S.finalModo || {})[code] || (finalGuia(code) === 'segunda' ? 'segunda' : 'todo');
// ¿Este tema entra en el final? Con «Solo la 2ª parte» quedan fuera los del parcial;
// y siempre queda fuera si el alumno le ha quitado la etiqueta Final a mano.
const finalIn = (code, t, i, pset) => !t.noFinal && (finalModo(code) === 'segunda' ? !pset.has(i) : true);
const TEM_NEED = { nuevo: 1, viendo: 0.7, repasar: 0.45, ok: 0.1 };
const TEM_PRIO = { repasar: 0, viendo: 1, nuevo: 2, ok: 3 };
function temasSemana(code, horas, monKey, ex, daysTo) {
  const ts = temasOf(code) || fromGuia(code);
  if (!ts.length) return null;
  const c = D.calendario, ini = dparse(c.inicio_clases), fin = dparse(c.fin_clases);
  const prog = Math.min(1, Math.max(0, (addDays(dparse(monKey), 7) - ini) / (fin - ini)));
  const dados = Math.max(1, Math.ceil(ts.length * prog)); // temas que más o menos ya se han dado en clase
  const near = daysTo != null && daysTo <= 14;
  const sel = ex?.[7] || []; // temas que el alumno ha marcado para un control suyo
  const pset = parcialSet(code, ts);
  // qué entra: los temas elegidos; si no, en el parcial lo de la primera parte; en el final todo
  // o solo la segunda parte (según lo que elija el alumno); y en un control lo que se ha dado hasta ahora
  const entra = (t, i) => !ex ? true : sel.length ? sel.includes(t.id)
    : ex[0] === 'final' ? finalIn(code, t, i, pset)
    : ex[0] === 'parcial' ? (pset.size ? pset.has(i) : i < dados) : i < dados;
  const list = ts.map((t, i) => ({ t, i, dado: i < dados || t.st !== 'nuevo',
    need: (Number(t.h) || 3) * ritmo() * (t.st === 'ok' && !near ? 0 : TEM_NEED[t.st] ?? 1) }))
    .filter(x => entra(x.t, x.i) && x.need > 0);
  const total = list.reduce((n, x) => n + x.need, 0);
  const cand = list.slice().sort((a, b) => (b.dado - a.dado) || TEM_PRIO[a.t.st] - TEM_PRIO[b.t.st] || a.i - b.i);
  const out = []; let left = horas;
  // si hay varios temas pendientes, ninguno se lleva más del 60 % de la semana (mejor tocar dos que uno solo)
  const cap = cand.length > 1 ? Math.max(1, Math.round(horas * 0.6 * 2) / 2) : horas;
  for (const x of cand) {
    if (left < 0.5 || out.length >= 4) break;
    const give = Math.min(left, cap, Math.max(0.5, Math.round(x.need * 2) / 2));
    out.push({ t: x.t, h: give }); left -= give;
  }
  const semanas = daysTo == null ? null : Math.max(1, Math.ceil(daysTo / 7));
  // lo que pediría el temario entero que entra si no tuvieras nada hecho: sirve para saber cómo llevas la asignatura
  const full = ts.reduce((n, t, i) => n + (entra(t, i) ? (Number(t.h) || 3) * ritmo() : 0), 0);
  return { out, total, full, semanas, capacidad: semanas ? horas * semanas : null, n: list.length };
}

function openTemario(code) { S.temCode = code; save(); go('temario'); }

async function viewTemario() {
  const code = S.temCode, a = subj(code), v = $('#view');
  tabs('estudio');
  if (!TM) {
    v.innerHTML = '<p class="lead">Cargando el temario…</p>';
    await loadTemarios();
    if (S.temCode !== code || current() !== 'temario') return;
  }
  if (!temasOf(code) && TM[code]) { S.temario = S.temario || {}; S.temario[code] = { temas: fromGuia(code), guia: true }; save(); }
  // sin temario en la guía: lista vacía hasta que el alumno añada el primer tema
  const T = S.temario?.[code] || { temas: [], guia: false }, ts = T.temas;
  const tot = ts.reduce((n, t) => n + (Number(t.h) || 0), 0), pr = temProgress(code);
  const exams = a.e.map(e => e[0]);
  // etiquetas reales de cada tema: Parcial (calculado o marcado) y Final (según lo que elijas para el final)
  const psetT = parcialSet(code, ts), today = dkey(new Date());
  const parc = examsOf(code).filter(e => e[0] === 'parcial').sort((x, y) => x[1].localeCompare(y[1]))[0];
  const parcHecho = parc && parc[1] < today, hasFinal = examsOf(code).some(e => e[0] === 'final');
  const tagsOf = (t, i) => {
    const out = [];
    if (psetT.has(i)) out.push(parcHecho ? 'Parcial ✓' : 'Parcial');
    if (hasFinal && finalIn(code, t, i, psetT)) out.push('Final');
    return out;
  };
  // temas que ya no entran en ningún examen pendiente (p. ej. los del parcial si haces solo la 2ª parte)
  const fuera = (t, i) => hasFinal && parcHecho && !finalIn(code, t, i, psetT);
  v.innerHTML = `
    <button class="link back" id="tBack">‹ Estudio</button>
    <div class="tem-head" style="${colorVars(code)}"><span class="bar"></span><div>
      <div class="eyebrow">Temario</div><h1>${esc(a.n)}</h1></div></div>
    ${ts.length ? `<div class="tem-prog"><div><b>${pr.ok} de ${pr.n}</b> temas que ya tienes${tot ? ` · ${hfmt(tot)} de estudio según la guía` : ''}</div>
      <div class="pbar"><i style="width:${pr.n ? Math.round(pr.ok / pr.n * 100) : 0}%"></i></div></div>` : ''}
    ${T.guia ? `<p class="hint">Sacado de la guía docente oficial. Si tu profesor lo da distinto, toca un tema para cambiarlo.</p>`
      : `<div class="notice warn">Esta asignatura no tiene temario en la guía docente. Añade los temas que estáis dando.</div>`}
    <h2 class="sec">Exámenes</h2>
    ${(EV[code] || [])[1] ? `<p class="hint" style="margin:0 0 8px">Nota final según la guía: ${esc(EV[code][1])}</p>` : ''}
    <div class="stack">${examsOf(code).sort((x, y) => x[1].localeCompare(y[1])).map(e => { const d = dparse(e[1]); return `
      <button class="exrow${e[1] < dkey(new Date()) ? ' past' : ''}" style="${colorVars(code)}" ${e[5] ? `data-exid="${e[5]}"` : ''}>
        <span class="md">${DAYS_SHORT[wdOf(d)]} ${d.getDate()}/${d.getMonth() + 1}</span>
        <span><b>${esc(exName(e))}</b><small>${e[2] ? `${e[2]}–${e[3]}` : 'Sin hora'}${e[5] ? (e[7]?.length ? ` · ${e[7].length} temas` : '') : ' · oficial'}</small></span>
        ${e[5] ? '<span aria-hidden="true">›</span>' : ''}</button>`; }).join('') || '<p class="hint">No hay exámenes oficiales en el calendario.</p>'}</div>
    ${(() => {
      const ex = examsOf(code);
      if (!ex.some(e => e[0] === 'final') || !ex.some(e => e[0] === 'parcial') || !ts.length) return '';
      const ps = parcialSet(code, ts), m = finalModo(code), g = finalGuia(code);
      const rng = idx => idx.length ? (idx.length === 1 ? `el tema ${idx[0] + 1}` : `los temas ${idx[0] + 1} a ${idx[idx.length - 1] + 1}`) : 'ningún tema';
      const p1 = [...ps].sort((a, b) => a - b), p2 = ts.map((_, i) => i).filter(i => !ps.has(i));
      // la guía dice que el final es siempre igual: no hay nada que elegir (salvo que el profesor lo haga distinto)
      if ((g === 'todo' || g === 'segunda') && !(S.finalModo || {})[code]) return `<div class="card stack finalmodo">
        <div class="eyebrow">El final</div>
        <div>${g === 'todo' ? `Según la guía docente, el final es de <b>todo el temario</b>.` : `Según la guía docente, el final es solo de la <b>segunda parte</b>: ${rng(p2)}.`}</div>
        <button class="link" data-fm-edit="${g}" style="align-self:flex-start">Mi profesor lo hace distinto</button></div>`;
      return `<div class="card stack finalmodo">
        <div class="eyebrow">¿Qué harás en el final?</div>
        <div class="seg2" role="group" style="margin:0">
          <button data-fm="todo" aria-pressed="${m === 'todo'}">Todo el temario</button>
          <button data-fm="segunda" aria-pressed="${m === 'segunda'}">Solo la 2ª parte</button>
        </div>
        <small class="hint">${m === 'segunda'
          ? `Haces solo el segundo parcial: estudias ${rng(p2)} (la nota del parcial ya te cuenta).`
          : `Final entero o recuperar el parcial el mismo día: entra todo, ${rng(p1)} del parcial y ${rng(p2)} después. Si el parcial te va bien y puedes hacer solo el segundo parcial, elige «Solo la 2ª parte».`}</small>
        ${g === 'todo' || g === 'segunda' ? `<button class="link" data-fm-reset style="align-self:flex-start">Volver a lo que dice la guía</button>` : ''}
      </div>`;
    })()}
    <button class="btn" id="tAddEx" style="margin-top:8px">+ Añadir control o examen</button>
    <h2 class="sec">Temas</h2>
    <div class="stack" style="margin-top:8px">${ts.map((t, i) => `
      <div class="card tema st-${t.st}${fuera(t, i) ? ' fuera' : ''}" data-i="${i}">
        <button class="tema-main" data-edit="${i}">
          <b>${esc(t.t)}</b>
          ${t.d ? `<small>${esc(t.d)}</small>` : ''}
          <span class="tema-tags">${t.h ? `<span>${hfmt(Number(t.h))}</span>` : ''}${tagsOf(t, i).map(x => `<span class="ex">${x}</span>`).join('')}${fuera(t, i) ? '<span class="out">No entra en el final</span>' : ''}</span>
        </button>
        <div class="tema-st" role="group" aria-label="Cómo lo llevas">${TEM_ST.map(([id, txt]) => `<button data-st="${id}" aria-pressed="${t.st === id}">${txt}</button>`).join('')}</div>
      </div>`).join('')}
    </div>
    <div class="row" style="margin-top:14px;flex-wrap:wrap;gap:8px">
      <button class="btn" id="tAdd">+ Añadir tema</button>
      ${TM?.[code] && ts.length ? '<button class="btn" id="tReset">Volver al temario de la guía</button>' : ''}
    </div>
    ${exams.length ? `<p class="hint" style="margin-top:14px">Marca en cada tema si entra en el ${exams.includes('parcial') ? 'parcial, en el ' : ''}final: así sabremos qué preparar para cada examen.</p>` : ''}
    <div class="confirm" id="tConf" hidden style="margin-top:10px"></div>
    <div class="tem-foot">
      <small class="hint">Todo lo que cambias aquí se guarda solo.</small>
      <button class="btn primary" id="tBack2">‹ Volver a Estudio</button>
    </div>`;
  const rerender = () => { save(); const y = window.scrollY; viewTemario(); window.scrollTo(0, y); };
  $('#tBack').onclick = () => go('estudio');
  $('#tBack2').onclick = () => go('estudio');
  v.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
    const i = +b.closest('[data-i]').dataset.i; ts[i].st = b.dataset.st; rerender();
  });
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openTema(code, +b.dataset.edit));
  $('#tAdd').onclick = () => openTema(code, null);
  $('#tAddEx').onclick = () => openExamen(code, null);
  v.querySelectorAll('[data-fm]').forEach(b => b.onclick = () => { S.finalModo = S.finalModo || {}; S.finalModo[code] = b.dataset.fm; rerender(); });
  v.querySelectorAll('[data-fm-reset]').forEach(b => b.onclick = () => { delete S.finalModo[code]; rerender(); });
  v.querySelectorAll('[data-fm-edit]').forEach(b => b.onclick = () => { S.finalModo = S.finalModo || {}; S.finalModo[code] = b.dataset.fmEdit; rerender(); });
  v.querySelectorAll('[data-exid]').forEach(b => b.onclick = () => openExamen(code, b.dataset.exid));
  if ($('#tReset')) $('#tReset').onclick = async () => {
    const c = $('#tConf'); c.hidden = false;
    c.innerHTML = `<span>Se perderán tus cambios y lo que has marcado en cada tema. ¿Seguro?</span><div class="row">
      <button class="btn danger" id="rY">Sí, volver a la guía</button><button class="btn" id="rN">Cancelar</button></div>`;
    $('#rN').onclick = () => { c.hidden = true; };
    $('#rY').onclick = async () => { await loadTemarios(); S.temario[code] = { temas: fromGuia(code), guia: !!TM[code] }; rerender(); toast('Temario de la guía recuperado'); };
  };
}
function openTema(code, i) {
  S.temario = S.temario || {};
  S.temario[code] = S.temario[code] || { temas: [], guia: false };
  const ts = S.temario[code].temas, t = i == null ? null : ts[i];
  const pset = parcialSet(code, ts), inP = t ? pset.has(i) : false;
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `
    <form class="sheet" novalidate>
      <header><h2>${t ? 'Editar tema' : 'Nuevo tema'}</h2><button type="button" class="icon" data-x aria-label="Cerrar">×</button></header>
      <label class="field"><span>Tema</span><input id="tT" maxlength="90" value="${esc(t?.t || '')}" placeholder="Ej.: Tema 3 · Transformada de Laplace" autocomplete="off"></label>
      <label class="field"><span>Qué incluye (opcional)</span><textarea id="tD" rows="3" maxlength="300">${esc(t?.d || '')}</textarea></label>
      <label class="field"><span>Horas de estudio que crees que necesita</span><input id="tH" type="number" min="0" max="200" step="0.5" inputmode="decimal" value="${t?.h ?? ''}"></label>
      <div class="field"><span>Entra en</span>
        <label class="check"><input type="checkbox" id="tP" ${inP ? 'checked' : ''}> Parcial</label>
        <label class="check"><input type="checkbox" id="tF" ${!t?.noFinal ? 'checked' : ''}> Final</label>
        ${finalModo(code) === 'segunda' ? '<small>Como en el final haces solo la 2ª parte, los temas del parcial no cuentan para el final.</small>' : ''}</div>
      <p class="err" id="tErr" hidden></p>
      <div class="confirm" id="tDelC" hidden></div>
      <footer>
        ${t ? '<button type="button" class="btn danger" id="tDel">Eliminar</button>' : ''}
        <span class="sp"></span>
        <button type="button" class="btn" data-x>Cancelar</button>
        <button type="submit" class="btn primary">Guardar</button>
      </footer>
    </form>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const q = s => ov.querySelector(s);
  const close = () => { ov.remove(); document.body.style.overflow = ''; };
  const done = msg => { save(); close(); toast(msg); const y = window.scrollY; viewTemario(); window.scrollTo(0, y); };
  ov.querySelectorAll('[data-x]').forEach(b => b.onclick = close);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  q('form').onsubmit = e => {
    e.preventDefault();
    const title = q('#tT').value.trim();
    if (!title) { q('#tErr').textContent = 'Ponle un nombre al tema.'; q('#tErr').hidden = false; return; }
    const P = q('#tP').checked, Fi = q('#tF').checked;
    // si hasta ahora el parcial se calculaba solo, se fija esa lista antes de cambiar este tema (para no perder los demás)
    if (P !== inP && !ts.some(x => (x.ex || '').includes('p'))) ts.forEach((x, k) => { if (pset.has(k)) x.ex = 'p' + (x.ex || '').replace('p', ''); });
    const data = { t: title, d: q('#tD').value.trim(), h: q('#tH').value === '' ? 0 : Math.max(0, Number(q('#tH').value) || 0),
      ex: (P ? 'p' : '') + (Fi ? 'f' : ''), noFinal: !Fi };
    if (t) Object.assign(t, data); else ts.push({ id: newId(), st: 'nuevo', ...data });
    done(t ? 'Tema actualizado' : 'Tema añadido');
  };
  if (q('#tDel')) q('#tDel').onclick = () => {
    const c = q('#tDelC'); c.hidden = false;
    c.innerHTML = `<span>¿Eliminar «${esc(t.t)}»?</span><div class="row"><button type="button" class="btn danger" id="dY">Sí, eliminar</button><button type="button" class="btn" id="dN">Cancelar</button></div>`;
    q('#dN').onclick = () => { c.hidden = true; };
    q('#dY').onclick = () => { ts.splice(i, 1); done('Tema eliminado'); };
  };
  setTimeout(() => { if (!t) q('#tT').focus(); }, 50);
}

// Añadir o editar un control / examen propio, con los temas que entran
function openExamen(code, id, after) {
  S.examenes = S.examenes || {};
  const x = id ? S.examenes[id] : null, ts = temasOf(code) || [];
  const F = { tipo: x?.tipo || 'control', temas: new Set(x?.temas || []) };
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `
    <form class="sheet" novalidate style="${colorVars(code)}">
      <header><h2>${x ? 'Editar' : 'Nuevo'} examen · ${esc(subj(code).s)}</h2><button type="button" class="icon" data-x aria-label="Cerrar">×</button></header>
      <div class="field"><span>Tipo</span><div class="seg2 four" role="group" style="margin:0">${EX_TIPOS.map(([k, n]) => `<button type="button" data-tipo="${k}">${n}</button>`).join('')}</div></div>
      <label class="field"><span>Nombre (opcional)</span><input id="xN" maxlength="50" value="${esc(x?.nombre || '')}" placeholder="Ej.: Control 2 · Tema 3" autocomplete="off"></label>
      <label class="field"><span>Día</span><input type="date" id="xD" value="${x?.fecha || ''}"></label>
      <div class="fields">
        <label class="field"><span>Empieza</span><input type="time" id="xI" step="300" value="${x?.ini || ''}"></label>
        <label class="field"><span>Acaba</span><input type="time" id="xF" step="300" value="${x?.fin || ''}"></label>
      </div>
      <small class="hint" id="xHint"></small>
      ${ts.length ? `<div class="field"><span>Temas que entran</span>
        <div class="xtemas">${ts.map(t => `<label class="check"><input type="checkbox" data-t="${esc(t.id)}" ${F.temas.has(t.id) ? 'checked' : ''}> ${esc(t.t)}</label>`).join('')}</div>
        <small>Si no marcas ninguno, contamos lo que se ha dado en clase hasta ese día.</small></div>` : ''}
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
  ov.querySelectorAll('[data-t]').forEach(c => c.onchange = () => { c.checked ? F.temas.add(c.dataset.t) : F.temas.delete(c.dataset.t); });
  paint();
  const err = m => { q('#xErr').textContent = m; q('#xErr').hidden = false; };
  q('form').onsubmit = e => {
    e.preventDefault();
    const fecha = q('#xD').value, ini = q('#xI').value, fin = q('#xF').value;
    if (!fecha) return err('Elige el día.');
    if (F.tipo !== 'entrega' && (!ini || !fin)) return err('Indica a qué hora empieza y acaba.');
    if (ini && fin && toMin(fin) <= toMin(ini)) return err('La hora de fin tiene que ser posterior a la de inicio.');
    if (!!ini !== !!fin) return err('Pon la hora de inicio y la de fin, o ninguna.');
    S.examenes[id || newId()] = { code, tipo: F.tipo, nombre: q('#xN').value.trim(), fecha, ini, fin, temas: [...F.temas] };
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
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.setAttribute('content', dark ? '#16241F' : '#F1F5F2'); m.removeAttribute('media'); });
}

/* ---------- rutina de exámenes (pantalla) ---------- */
function viewRutinaEx() {
  const X = rutinaEx(), R = { ...RUTINA_DEF, ...(S.rutina || {}) }, v = $('#view');
  const fd = k => { const d = dparse(k); return `${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
  const per = examPeriods().map(p => `<li><b>${p.n === 'parciales' ? 'Parciales' : 'Finales'}:</b> del ${fd(p.a)} al ${fd(p.b)}${p.n === 'finales' ? ' (desde que acaban las clases)' : ''}</li>`).join('');
  const hs = (id, label, vals, val) => `<label class="field"><span>${label}</span><select id="${id}">${vals.map(h => `<option value="${h}" ${val === h ? 'selected' : ''}>${hfmt(h)}</option>`).join('')}</select></label>`;
  v.innerHTML = `
    <button class="link back" id="xBack">‹ Ajustes</button>
    <div class="eyebrow">Ajustes</div>
    <h1>Rutina de exámenes</h1>
    <p class="lead">En época de exámenes tu día cambia: estudias más, cenas más tarde, dejas cosas… Quatri usa esta rutina esos días y coloca más estudio.</p>
    <section class="card stack">
      <label class="check"><input type="checkbox" id="xA" ${X.activa ? 'checked' : ''}> <b>Usar la rutina de exámenes</b></label>
      <ul class="plain">${per}</ul>
    </section>
    <div id="xBox" class="stack" ${X.activa ? '' : 'hidden'} style="margin-top:12px">
      <section class="card stack"><div class="eyebrow">La noche</div>
        <label class="check"><input type="checkbox" id="xN" ${X.estudiaNoche ? 'checked' : ''}> Estudio después de cenar</label>
        <div class="fields">
          <label class="field"><span>Cenas a las</span><input type="time" id="xC" step="300" value="${X.cena || R.cena}"></label>
          <label class="field"><span>Te vas a dormir a las</span><input type="time" id="xD" step="300" value="${X.dormir || R.dormir}"></label>
        </div></section>
      <section class="card stack"><div class="eyebrow">Estudio al día</div>
        <div class="fields">
          ${hs('xS', 'Máximo entre semana', [3, 4, 5, 6, 7, 8], X.maxSemana)}
          ${hs('xF', 'Máximo el fin de semana', [3, 4, 5, 6, 7, 8], X.maxFinde)}
        </div></section>
      <section class="card stack"><div class="eyebrow">Dejar en pausa esos días</div>
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
    <div class="eyebrow">Ajustes</div>
    <h1>Tu Quatri</h1>
    <p class="lead">${esc(g.n)} · ${S.asignaturas.length} asignaturas · ${esc(D.periodo.curso)} ${esc(D.periodo.q)}</p>
    <section class="card stack cuenta" style="margin-bottom:12px">
      <div class="eyebrow">Cuenta</div>
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
        <div class="eyebrow">Avisos</div>
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
      <div class="eyebrow">Apariencia</div>
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
      <button class="choice" data-go="grado"><span><b>Cambiar de grado</b><span class="code">Empieza de nuevo con otro grado</span></span></button>
      <button class="choice" data-go="bienvenida"><span><b>Cómo funciona Quatri</b><span class="code">Vuelve a ver la presentación</span></span></button>
    </div>
    <p class="hint" style="margin-top:18px">Horarios: Visor d'Horaris UPC · Créditos, temario y evaluación: guías docentes UPC · <a href="privacidad.html" target="_blank" rel="noopener">Privacidad</a></p>`;
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
  initCuenta();
  // el temario hace falta para poner el tema en cada bloque de estudio; cuando llega, se repinta
  if (S.listo) loadTemarios().then(() => { PLAN_CACHE = {}; if (['hoy', 'calendario'].includes(current())) { const y = window.scrollY; render(); window.scrollTo(0, y); } });
}
start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
  // cuando se instala una versión nueva, recarga una vez para usarla
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
