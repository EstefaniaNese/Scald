import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import {
  getDetalleHoja,
  getHoja,
  listBultos,
  listHojas,
  listIncidencias,
  reasignarBulto,
  registrarPistoleo,
  resolverIncidencia,
  updateHoja,
} from '../api/services'
import type { Bulto, HojaEstado, HojaRuta, HojaRutaInput, HojaTipo, Incidencia, ReporteHoja } from '../api/types'
import ResolverIncidencia from '../components/ResolverIncidencia'
import { formatDate, formatNumber, formatRoute } from '../format'

type Props = {
  token: string
  hojaId: number
  canEdit: boolean
  focusPistoleo: boolean
}

export default function HojaDetallePage({ token, hojaId, canEdit, focusPistoleo }: Props) {
  const [hoja, setHoja] = useState<HojaRuta | null>(null)
  const [hojas, setHojas] = useState<HojaRuta[]>([])
  const [bultos, setBultos] = useState<Bulto[]>([])
  const [incidencias, setIncidencias] = useState<Incidencia[]>([])
  const [reporte, setReporte] = useState<ReporteHoja | null>(null)
  const [search, setSearch] = useState('')
  const [codigo, setCodigo] = useState('')
  const [origen, setOrigen] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [migrateMessage, setMigrateMessage] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolviendo, setResolviendo] = useState<Incidencia | null>(null)
  const [resolverError, setResolverError] = useState('')

  const reload = useCallback(() => {
    return Promise.all([getHoja(token, hojaId), listHojas(token), listBultos(token), listIncidencias(token), getDetalleHoja(token, hojaId)])
      .then(([nextHoja, nextHojas, nextBultos, nextIncidencias, nextReporte]) => {
        setHoja(nextHoja)
        setHojas(nextHojas)
        setBultos(nextBultos)
        setIncidencias(nextIncidencias.filter((item) => item.hoja_ruta_id === hojaId))
        setReporte(nextReporte)
        setError('')
      })
      .catch((reason: Error) => setError(reason.message))
  }, [token, hojaId])

  useEffect(() => {
    reload().catch(() => undefined)
  }, [reload])

  const propios = useMemo(() => bultos.filter((bulto) => bulto.hoja_ruta_id === hojaId), [bultos, hojaId])
  const visibles = propios.filter((bulto) => bulto.codigo.toLowerCase().includes(search.trim().toLowerCase()))
  const codigosPistoleo = codigosDePistoleo(codigo)
  const encontrados = codigosPistoleo.filter((lectura) => propios.some((bulto) => bulto.codigo === lectura)).length
  const avisoLectura = avisoDePistoleo(encontrados, codigosPistoleo.length)
  const incidenciasHoja = incidencias.filter((item) => item.estado === 'PENDIENTE')
  const bultoPorId = new Map(bultos.map((bulto) => [bulto.id, bulto]))

  const separarLectura = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== ' ') return
    event.preventDefault()
    const lecturas = codigosDePistoleo(event.currentTarget.value)
    if (!lecturas.length) return
    setCodigo(`${lecturas.join(', ')}, `)
  }

  const escanear = (event: FormEvent) => {
    event.preventDefault()
    const lecturas = codigosDePistoleo(codigo)
    if (!lecturas.length) return
    setBusy(true)
    setScanMessage('')
    lecturas
      .reduce<Promise<Array<{ codigo: string; estado: string } | { error: string }>>>(
        (cadena, lectura) =>
          cadena.then((acumulado) =>
            registrarPistoleo(token, lectura, hojaId)
              .then((pistoleo) => [...acumulado, { codigo: pistoleo.codigo_bulto, estado: pistoleo.estado }])
              .catch((reason: Error) => [...acumulado, { error: reason.message }]),
          ),
        Promise.resolve([]),
      )
      .then(async (resultados) => {
        const registrados = resultados.filter((item) => 'estado' in item)
        const fallidos = resultados.filter((item) => 'error' in item)
        const detalle = registrados.map((item) => `${item.codigo} ${item.estado}`).join(', ')
        const error = fallidos[0] && 'error' in fallidos[0] ? fallidos[0].error : ''
        setScanMessage(
          `Se registraron ${registrados.length} de ${lecturas.length} bultos.${detalle ? ` ${detalle}.` : ''}${error ? ` ${error}` : ''}`,
        )
        setCodigo('')
        await reload()
      })
      .finally(() => setBusy(false))
  }

  const migrar = (event: FormEvent) => {
    event.preventDefault()
    if (!hoja) return
    const codigoOrigen = origen.trim().toUpperCase()
    const hojaOrigen = hojas.find((item) => item.codigo === codigoOrigen)
    if (!hojaOrigen) {
      setMigrateMessage('No existe una hoja con ese código')
      return
    }
    if (hojaOrigen.id === hoja.id) {
      setMigrateMessage('La hoja de origen y la actual son la misma')
      return
    }
    const aMover = bultos.filter((bulto) => bulto.hoja_ruta_id === hojaOrigen.id)
    if (!aMover.length) {
      setMigrateMessage('La hoja de origen no tiene bultos para migrar')
      return
    }
    setBusy(true)
    setMigrateMessage('')
    const motivo = `Migración desde ${hojaOrigen.codigo}`.slice(0, 200)
    Promise.allSettled(aMover.map((bulto) => reasignarBulto(token, bulto.id, hoja.id, motivo)))
      .then(async (results) => {
        const ok = results.filter((result) => result.status === 'fulfilled').length
        const fallidos = results.filter((result) => result.status === 'rejected')
        const detalle = fallidos[0]?.status === 'rejected' ? messageOf(fallidos[0].reason) : ''
        const pistoleados = aMover.filter((bulto) => bulto.pistoleado).length
        setMigrateMessage(
          `Se migraron ${ok} de ${aMover.length} bultos (${pistoleados} ya pistoleados).${detalle ? ` ${detalle}` : ''}`,
        )
        setOrigen('')
        await reload()
      })
      .finally(() => setBusy(false))
  }

  const abrirResolver = (incidencia: Incidencia) => {
    setResolverError('')
    setResolviendo(incidencia)
  }

  const cerrarResolver = () => {
    if (busy) return
    setResolviendo(null)
    setResolverError('')
  }

  const confirmarResolucion = (accion: 'ELIMINAR_PISTOLEO' | 'ANADIR_BULTO') => {
    if (!resolviendo) return
    setBusy(true)
    setResolverError('')
    resolverIncidencia(token, resolviendo.id, accion)
      .then(() => {
        setResolviendo(null)
        return reload()
      })
      .catch((reason: Error) => setResolverError(reason.message))
      .finally(() => setBusy(false))
  }

  if (!hoja) {
    return <p className="empty">{error || 'Cargando hoja de ruta…'}</p>
  }

  const esperados = reporte?.total_bultos_esperados ?? propios.length
  const pistoleados = propios.filter((bulto) => bulto.pistoleado).length

  return (
    <div className="stack">
      <header className="detail-head">
        <div>
          <div className="title-row">
            <h1>{hoja.codigo}</h1>
            <span className={`badge ${hoja.estado === 'ACTIVA' ? 'ok' : hoja.estado === 'CERRADA' ? 'closed' : 'muted'}`}>{hoja.estado}</span>
            {canEdit && <button className="button primary" onClick={() => setEditing(true)} type="button">Editar</button>}
          </div>
          <dl className="sheet-facts">
            <div>
              <dt>Ruta</dt>
              <dd>{formatRoute(hoja.ruta).trim() || '—'}</dd>
            </div>
            <div>
              <dt>Registro</dt>
              <dd>{formatDate(hoja.fecha_registro)}</dd>
            </div>
            <div>
              <dt>Emisión</dt>
              <dd>{formatDate(hoja.fecha)}</dd>
            </div>
            <div>
              <dt>Transporte</dt>
              <dd>{hoja.transporte?.trim() || '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="detail-stats">
          <div><strong>{formatNumber(esperados)}</strong><span>Esperados</span></div>
          <div><strong className="green">{formatNumber(pistoleados)}</strong><span>Pistoleados</span></div>
          <div><strong className="alert">{formatNumber(reporte?.incidencias_pendientes ?? incidenciasHoja.length)}</strong><span>Incidencias</span></div>
        </div>
      </header>
      {error && <p className="form-error">{error}</p>}
      {editing && (
        <EditHoja
          canEdit={canEdit}
          hoja={hoja}
          onCancel={() => setEditing(false)}
          onSave={(payload) => {
            setBusy(true)
            return updateHoja(token, hoja.id, payload)
              .then(() => reload())
              .then(() => setEditing(false))
              .finally(() => setBusy(false))
          }}
        />
      )}
      <div className="workspace-grid">
        <section className="card bultos-card">
          <div className="card-header">
            <h2>Bultos: Esperados vs Pistoleados</h2>
            <input aria-label="Buscar bulto" onChange={(event) => setSearch(event.target.value)} placeholder="Buscar bulto..." value={search} />
          </div>
          <div className={`table-wrap${propios.length > 7 ? ' bultos-scroll' : ''}`}>
            <table>
              <thead>
                <tr>
                  <th>Código Bulto</th>
                  <th>Esperado</th>
                  <th>Pistoleado</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((bulto) => (
                  <tr key={bulto.id}>
                    <td className="code">{bulto.codigo}</td>
                    <td className="mark ok">✓</td>
                    <td className={`mark ${bulto.pistoleado ? 'ok' : 'bad'}`}>{bulto.pistoleado ? '✓' : '✕'}</td>
                    <td>{formatDate(bulto.fecha)}</td>
                    <td><span className={`badge ${bulto.pistoleado && bulto.estado === 'OK' ? 'ok' : bulto.estado === 'FALTANTE' || !bulto.pistoleado ? 'closed' : 'warn'}`}>{bulto.pistoleado ? bulto.estado : 'FALTANTE'}</span></td>
                  </tr>
                ))}
                {!visibles.length && <tr><td colSpan={5}>No hay bultos para este filtro.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <div className="side-stack">
          <section className="card">
            <div className="card-header"><h2>Registrar Pistoleo</h2></div>
            <form className="panel-form" onSubmit={escanear}>
              <label>Código de Bulto
                <input autoFocus={focusPistoleo} onChange={(event) => setCodigo(event.target.value)} onKeyDown={separarLectura} value={codigo} />
              </label>
              <p className="hint">Pistolea uno o varios códigos seguidos. Cada lectura se separa con una coma al pulsar espacio y se registran juntas al pulsar Registrar.</p>
              {avisoLectura && <p className={claseDePistoleo(encontrados, codigosPistoleo.length)}>{avisoLectura}</p>}
              {scanMessage && <p className="notice">{scanMessage}</p>}
              <button className="button primary wide" disabled={busy || codigosPistoleo.length === 0} type="submit">Registrar</button>
            </form>
          </section>
          <section className="card">
            <div className="card-header"><h2>Migrar Bulto</h2></div>
            <form className="panel-form" onSubmit={migrar}>
              <label>Código de hoja de ruta de origen
                <input onChange={(event) => setOrigen(event.target.value)} placeholder="HRD-2026-042" value={origen} />
              </label>
              <p className="hint">Mueve todos los bultos de esa hoja a esta, estén pistoleados o no.</p>
              {migrateMessage && <p className="notice">{migrateMessage}</p>}
              <button className="button primary wide" disabled={busy || origen.trim().length < 5} type="submit">Migrar</button>
            </form>
          </section>
          <section className="card">
            <div className="card-header"><h2>Incidencias pendientes ({incidenciasHoja.length})</h2></div>
            <ul className="incident-list">
              {!incidenciasHoja.length && <li className="muted">Sin incidencias en esta hoja.</li>}
              {incidenciasHoja.map((item) => (
                <li key={item.id}>
                  <div className="incident-copy">
                    <strong>{item.tipo}</strong>
                    <span>{bultoPorId.get(item.bulto_id ?? -1)?.codigo ?? 'Sin bulto'}</span>
                  </div>
                  {item.estado === 'PENDIENTE' && (
                    <button className="button tiny" disabled={busy} onClick={() => abrirResolver(item)} type="button">Resolver</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      {resolviendo && (
        <ResolverIncidencia
          busy={busy}
          codigo={bultoPorId.get(resolviendo.bulto_id ?? -1)?.codigo ?? 'este bulto'}
          duplicado={resolviendo.tipo === 'DUPLICADO'}
          error={resolverError}
          onAdd={() => confirmarResolucion('ANADIR_BULTO')}
          onClose={cerrarResolver}
          onDelete={() => confirmarResolucion('ELIMINAR_PISTOLEO')}
        />
      )}
    </div>
  )
}

function avisoDePistoleo(encontrados: number, total: number) {
  const faltantes = total - encontrados
  if (total === 0) return ''
  if (faltantes === 0) return total === 1 ? 'Bulto encontrado' : `${total} bultos encontrados`
  if (encontrados === 0) return total === 1 ? 'Bulto no encontrado' : `${total} bultos no encontrados`
  const hallados = encontrados === 1 ? '1 bulto encontrado' : `${encontrados} bultos encontrados`
  const ausentes = faltantes === 1 ? '1 no encontrado' : `${faltantes} no encontrados`
  return `${hallados} y ${ausentes}`
}

function claseDePistoleo(encontrados: number, total: number) {
  if (encontrados === total) return 'found'
  if (encontrados === 0) return 'missing'
  return 'partial'
}

function codigosDePistoleo(valor: string) {
  return valor
    .split(/[,;\n]+/)
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length >= 3)
}

function messageOf(reason: unknown) {
  if (reason instanceof ApiError || reason instanceof Error) return reason.message
  return 'Algunos bultos no se pudieron migrar'
}

type EditProps = {
  hoja: HojaRuta
  canEdit: boolean
  onCancel: () => void
  onSave: (payload: HojaRutaInput) => Promise<unknown>
}

function EditHoja({ hoja, canEdit, onCancel, onSave }: EditProps) {
  const [form, setForm] = useState<HojaRutaInput>({
    codigo: hoja.codigo,
    tipo: hoja.tipo,
    fecha: hoja.fecha.slice(0, 10),
    ruta: hoja.ruta,
    transporte: hoja.transporte,
    cantidad_declarada: hoja.cantidad_declarada,
    estado: hoja.estado,
  })
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canEdit) {
      setError('Solo un administrador puede editar la hoja')
      return
    }
    setError('')
    onSave({
      ...form,
      codigo: form.codigo.trim().toUpperCase(),
      transporte: form.transporte?.trim() || null,
    }).catch((reason: Error) => setError(reason.message))
  }

  return (
    <section className="card">
      <div className="card-header"><h2>Editar hoja de ruta</h2></div>
      <form className="edit-grid" onSubmit={submit}>
        <label>Código<input onChange={(event) => setForm({ ...form, codigo: event.target.value })} required value={form.codigo} /></label>
        <label>Tipo
          <select onChange={(event) => setForm({ ...form, tipo: event.target.value as HojaTipo })} value={form.tipo}>
            <option value="HRD">HRD</option>
            <option value="HRE">HRE</option>
          </select>
        </label>
        <label>Fecha de emisión<input onChange={(event) => setForm({ ...form, fecha: event.target.value })} required type="date" value={form.fecha} /></label>
        <label>Estado
          <select onChange={(event) => setForm({ ...form, estado: event.target.value as HojaEstado })} value={form.estado}>
            <option value="ACTIVA">ACTIVA</option>
            <option value="INACTIVA">INACTIVA</option>
            <option value="CERRADA">CERRADA</option>
          </select>
        </label>
        <label className="span-2">Ruta<input onChange={(event) => setForm({ ...form, ruta: event.target.value })} required value={form.ruta} /></label>
        <label>Transporte<input onChange={(event) => setForm({ ...form, transporte: event.target.value })} value={form.transporte ?? ''} /></label>
        <label>Cantidad declarada<input min={0} onChange={(event) => setForm({ ...form, cantidad_declarada: Number(event.target.value) })} required type="number" value={form.cantidad_declarada} /></label>
        {error && <p className="form-error span-2">{error}</p>}
        {!canEdit && <p className="hint span-2">Tu rol puede ver la hoja. La API solo permite guardar cambios a un administrador.</p>}
        <div className="form-actions span-2">
          <button className="button" onClick={onCancel} type="button">Cancelar</button>
          <button className="button primary" disabled={!canEdit} type="submit">Guardar</button>
        </div>
      </form>
    </section>
  )
}
