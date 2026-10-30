'use client';

// Equipo: cuentas del CRM, nombres, roles y acceso (solo administradores)
import { useCallback, useEffect, useState } from 'react';

type Cuenta = { id: string; email: string; nombre: string; rol: 'admin' | 'asesor' | 'sede'; sede: string | null; acceso: boolean; ultimo_ingreso: string | null; creado: string };

const fecha = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })
  : 'Nunca';

export default function EquipoPage() {
  const [equipo, setEquipo] = useState<Cuenta[]>([]);
  const [sedes, setSedes] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ email: '', nombre: '', password: '', rol: 'asesor', sede: '' });
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    const j = await fetch('/api/equipo').then((r) => r.json()).catch(() => null);
    if (j?.success) { setEquipo(j.equipo); setSedes(j.sedes || []); setError(''); } else setError(j?.error || 'No se pudo cargar el equipo');
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const actualizar = async (id: string, cambios: Record<string, any>) => {
    setMensaje('');
    const j = await fetch('/api/equipo', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...cambios }) })
      .then((r) => r.json()).catch(() => null);
    if (!j?.success) { setMensaje(j?.error || 'No se pudo guardar'); return; }
    setEditando(null);
    setMensaje('Cambios guardados. Se aplican la próxima vez que la persona inicie sesión.');
    cargar();
  };

  const crear = async () => {
    setGuardando(true); setMensaje('');
    const j = await fetch('/api/equipo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      .then((r) => r.json()).catch(() => null);
    setGuardando(false);
    if (!j?.success) { setMensaje(j?.error || 'No se pudo crear la cuenta'); return; }
    setMensaje(`Cuenta creada. Comparte con ${form.nombre} su correo y la contraseña temporal por un canal privado.`);
    setNuevo(false);
    setForm({ email: '', nombre: '', password: '', rol: 'asesor', sede: '' });
    cargar();
  };

  const generarClave = () => {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    setForm((f) => ({ ...f, password: Array.from(bytes, (b) => c[b % c.length]).join('') + '!' }));
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Equipo</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quién entra al CRM, con qué nombre aparece en el chat y qué puede hacer.</p>
        </div>
        {!error && (
          <button onClick={() => { setNuevo(true); generarClave(); }} className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold hover:bg-commerk-navy/90">
            + Agregar cuenta
          </button>
        )}
      </div>

      {mensaje && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{mensaje}</div>}

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">{error}</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Persona</th>
                <th className="text-left px-5 py-3 font-semibold">Rol</th>
                <th className="text-left px-5 py-3 font-semibold">Último ingreso</th>
                <th className="text-right px-5 py-3 font-semibold">Acceso</th>
              </tr>
            </thead>
            <tbody>
              {cargando && equipo.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400">Cargando…</td></tr>}
              {equipo.map((c) => (
                <tr key={c.id} className={`border-t border-slate-100 ${c.acceso ? '' : 'opacity-50'}`}>
                  <td className="px-5 py-3">
                    {editando === c.id ? (
                      <div className="flex gap-2">
                        <input value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} className="px-2 py-1 border border-slate-200 rounded-lg text-sm" autoFocus />
                        <button onClick={() => actualizar(c.id, { nombre: nombreEdit })} className="text-xs font-semibold text-commerk-navy">Guardar</button>
                        <button onClick={() => setEditando(null)} className="text-xs text-slate-400">Cancelar</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditando(c.id); setNombreEdit(c.nombre); }} className="text-left group">
                        <p className="font-semibold text-slate-800 group-hover:text-commerk-navy">{c.nombre} <span className="text-[10px] text-slate-300 group-hover:text-commerk-navy">✎</span></p>
                        <p className="text-xs text-slate-400">{c.email}</p>
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <select value={c.rol} disabled={!c.acceso}
                        onChange={(e) => e.target.value === 'sede'
                          ? actualizar(c.id, { rol: 'sede', sede: c.sede || sedes[0] })
                          : actualizar(c.id, { rol: e.target.value })}
                        className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white">
                        <option value="admin">Administrador</option>
                        <option value="asesor">Asesor</option>
                        <option value="sede">Sede</option>
                      </select>
                      {c.rol === 'sede' && (
                        <select value={c.sede || ''} disabled={!c.acceso} onChange={(e) => actualizar(c.id, { sede: e.target.value })}
                          className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white">
                          {!c.sede && <option value="">Elegir sede…</option>}
                          {sedes.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{fecha(c.ultimo_ingreso)}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => actualizar(c.id, { acceso: !c.acceso })}
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${c.acceso ? 'bg-emerald-50 text-emerald-700 hover:bg-red-50 hover:text-red-600' : 'bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'}`}>
                      {c.acceso ? 'Activo' : 'Sin acceso'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 py-3 text-[11px] text-slate-400 border-t border-slate-100">
            Administrador: gestiona el equipo y todo el CRM. Asesor: atiende conversaciones. Sede: la cuenta de una tienda, solo ve y gestiona sus leads mayoristas (sigue recibiendo el aviso por WhatsApp). Quitar el acceso no borra la cuenta ni su historial.
          </p>
        </div>
      )}

      {nuevo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setNuevo(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-commerk-navy">Agregar cuenta</h3>
            {(['nombre', 'email'] as const).map((k) => (
              <div key={k}>
                <label className="text-xs font-semibold text-slate-500">{k === 'nombre' ? (form.rol === 'sede' ? 'Nombre (ej. Tienda CC Tesoro)' : 'Nombre (así aparece en el chat)') : 'Correo'}</label>
                <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} type={k === 'email' ? 'email' : 'text'}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-commerk-navy/40" />
              </div>
            ))}
            <div>
              <label className="text-xs font-semibold text-slate-500">Contraseña temporal</label>
              <div className="flex gap-2 mt-1">
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none" />
                <button onClick={generarClave} className="px-3 rounded-xl border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">Generar</button>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Rol</label>
              <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
                <option value="asesor">Asesor</option>
                <option value="admin">Administrador</option>
                <option value="sede">Sede (solo sus leads mayoristas)</option>
              </select>
            </div>
            {form.rol === 'sede' && (
              <div>
                <label className="text-xs font-semibold text-slate-500">Sede</label>
                <select value={form.sede} onChange={(e) => setForm({ ...form, sede: e.target.value })} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
                  <option value="">Elegir sede…</option>
                  {sedes.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setNuevo(false)} className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600">Cancelar</button>
              <button onClick={crear} disabled={guardando || !form.email || !form.nombre || form.password.length < 10 || (form.rol === 'sede' && !form.sede)}
                className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold disabled:opacity-40">
                {guardando ? 'Creando…' : 'Crear cuenta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
