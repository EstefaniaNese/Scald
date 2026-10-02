import { useEffect, useState } from 'react'
import { IconBell, IconFileCheck, IconScan, IconAnalyze } from '@tabler/icons-react'
import { listAuditoria, listBultos, listIncidencias, listPistoleos, getResumen, listHojas } from '../api/services'
import type { Auditoria, Bulto, HojaRuta, Incidencia, Pistoleo, ReporteResumen } from '../api/types'
import { formatDate, formatNumber, formatPercent } from '../format'
import HojaTable from '../components/HojaTable'
import ImportarPdfButton from '../components/ImportarPdfButton'

type Props = {
  token: string
  isAdmin: boolean
  onOpenHoja: (hojaId: number) => void
  onPistoleo: (hojaId: number) => void
  onIncidencias: () => void
  onReporte: () => void
  onVerTodas: () => void
}

export default function DashboardPage({ token, isAdmin, onOpenHoja, onPistoleo, onIncidencias, onReporte, onVerTodas }: Props) {
  const [hojas, setHojas] = useState<HojaRuta[]>([])
  const [resumen, setResumen] = useState<ReporteResumen | null>(null)
  const [incidencias, setIncidencias] = useState<Incidencia[]>([])
  const [actividad, setActividad] = useState<Auditoria[]>([])
  const [bultos, setBultos] = useState<Bulto[]>([])
  const [pistoleos, setPistoleos] = useState<Pistoleo[]>([])
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([
      listHojas(token),
      getResumen(token),
      listIncidencias(token),
      listBultos(token),
      listPistoleos(token, 30),
      isAdmin ? listAuditoria(token, 30).catch(() => [] as Auditoria[]) : Promise.resolve([] as Auditoria[]),
    ])
      .then(([nextHojas, nextResumen, nextIncidencias, nextBultos, nextPistoleos, nextActividad]) => {
        if (!alive) return
        setHojas(nextHojas)
        setResumen(nextResumen)
        setIncidencias(nextIncidencias)
        setBultos(nextBultos)
        setPistoleos(nextPistoleos)
        setActividad(nextActividad)
        setError('')
      })
      .catch((reason: Error) => {
        if (alive) setError(reason.message)
      })
    return () => {
      alive = false
    }
  }, [token, isAdmin, version])

  const activas = hojas.filter((hoja) => hoja.activo && hoja.estado === 'ACTIVA').length
  const esperados = resumen?.total_bultos_esperados ?? 0
  const pistoleados = Math.max(esperados - (resumen?.faltantes ?? 0), 0)
  const pendingByHoja = new Map<number, number>()
  incidencias.filter((item) => item.estado === 'PENDIENTE' && item.hoja_ruta_id).forEach((item) => {
    pendingByHoja.set(item.hoja_ruta_id as number, (pendingByHoja.get(item.hoja_ruta_id as number) ?? 0) + 1)
  })
  const recientes = [...hojas].sort((a, b) => b.fecha_registro.localeCompare(a.fecha_registro))
  const bultoPorId = new Map(bultos.map((bulto) => [bulto.id, bulto.codigo]))
  const hojaPorId = new Map(hojas.map((hoja) => [hoja.id, hoja.codigo]))
  const actividadVisible = actividad.length
    ? actividad.map((item) => ({
        id: `a-${item.id}`,
        tone: actividadTono(item),
        text: actividadTexto(item),
        time: formatDate(item.fecha_hora),
        sort: item.fecha_hora,
      }))
    : [
        ...pistoleos.map((item) => ({
          id: `p-${item.id}`,
          tone: item.estado === 'OK' ? 'ok' : 'alert',
          text: pistoleoTexto(item, hojaPorId.get(item.hoja_ruta_id ?? -1)),
          time: formatDate(item.fecha_hora),
          sort: item.fecha_hora,
        })),
        ...incidencias.map((item) => ({
          id: `i-${item.id}`,
          tone: item.estado === 'PENDIENTE' ? 'alert' : item.estado === 'REASIGNADO' ? 'warn' : 'ok',
          text: incidenciaTexto(item, bultoPorId.get(item.bulto_id ?? -1), hojaPorId.get(item.hoja_ruta_id ?? -1)),
          time: formatDate(item.fecha_creacion),
          sort: item.fecha_creacion,
        })),
      ]
        .sort((a, b) => b.sort.localeCompare(a.sort))
        .slice(0, 30)

  return (
    <div className="stack">
      <div className="page-heading">
        <h1>Dashboard</h1>
        <ImportarPdfButton onImported={() => setVersion((value) => value + 1)} token={token} />
      </div>
      {error && <p className="form-error">{error}</p>}
      <section className="metrics" aria-label="Indicadores">
        <article className="metric">
          <div className="metric-top"><span>Hojas Activas</span><IconFileCheck className="metric-icon orange" size={18} stroke={1.75} /></div>
          <strong>{formatNumber(activas)}</strong>
          <small>{formatNumber(resumen?.total_hojas ?? hojas.length)} hojas en el sistema</small>
        </article>
        <article className="metric">
          <div className="metric-top"><span>Pistoleos</span><IconScan className="metric-icon green" size={18} stroke={1.75} /></div>
          <strong>{formatNumber(resumen?.total_pistoleos ?? 0)}</strong>
          <small>{formatNumber(resumen?.ok ?? 0)} en estado OK</small>
        </article>
        <article className="metric">
          <div className="metric-top"><span>Incidencias Pendientes</span><IconBell className="metric-icon red" size={18} stroke={1.75} /></div>
          <strong>{formatNumber(resumen?.incidencias_pendientes ?? 0)}</strong>
          <small>{formatNumber(resumen?.incidencias_regularizadas ?? 0)} regularizadas</small>
        </article>
        <article className="metric">
          <div className="metric-top"><span>Eficiencia</span><IconAnalyze className="metric-icon ink" size={18} stroke={1.75} /></div>
          <strong>{formatPercent(pistoleados, esperados)}</strong>
          <small>{formatNumber(pistoleados)} de {formatNumber(esperados)} bultos</small>
        </article>
      </section>
      <div className="workspace-grid">
        <section className="card hojas-card">
          <div className="card-header">
            <h2>Hojas de Ruta Recientes</h2>
            <button className="text-link" onClick={onVerTodas} type="button">Ver todas</button>
          </div>
          <HojaTable hojas={recientes} linkRows maxVisible={5} onOpen={onOpenHoja} pendingByHoja={pendingByHoja} />
        </section>
        <div className="side-stack">
          <section className="card">
            <div className="card-header">
              <h2>Actividad en Vivo</h2>
              <i className="dot green" />
            </div>
            <ul className="activity-list">
              {actividadVisible.length === 0 && <li className="muted">Sin movimientos registrados.</li>}
              {actividadVisible.map((item) => (
                <li key={item.id}><i className={`dot ${item.tone}`} /> <span title={item.text}>{item.text}</span> <time>{item.time}</time></li>
              ))}
            </ul>
          </section>
          <section className="card">
            <div className="card-header"><h2>Acciones Rápidas</h2></div>
            <div className="quick-actions">
              <button disabled={!recientes.length} onClick={() => recientes[0] && onPistoleo(recientes[0].id)} type="button"><i className="dot orange" /> Registrar Pistoleo</button>
              <button onClick={onIncidencias} type="button"><i className="dot yellow" /> Ver Incidencias</button>
              <button onClick={onReporte} type="button"><i className="dot green" /> Generar Reporte</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function texto(datos: Record<string, unknown>, clave: string): string | undefined {
  const valor = datos[clave]
  return typeof valor === 'string' && valor ? valor : undefined
}

function referencia(codigoBulto?: string, codigoHoja?: string) {
  return codigoBulto || codigoHoja
}

function actividadTono(item: Auditoria): string {
  const datos = item.datos_nuevos ?? {}
  const estado = String(datos.estado ?? '')
  if (item.entidad === 'PISTOLEO') return estado === 'OK' ? 'ok' : 'alert'
  if (item.entidad === 'HOJA_RUTA') return 'ok'
  if (item.entidad === 'REASIGNACION') return 'warn'
  if (item.entidad === 'INCIDENCIA') {
    if (item.accion === 'REGULARIZAR' || estado === 'REGULARIZADO') return 'ok'
    if (item.accion === 'ANULAR' || estado === 'ANULADO') return 'muted'
    return 'alert'
  }
  return 'alert'
}

function actividadTexto(item: Auditoria): string {
  const datos = item.datos_nuevos ?? {}
  const codigoBulto = texto(datos, 'codigo_bulto')
  const codigoHoja = texto(datos, 'codigo_hoja') ?? texto(datos, 'codigo')
  const sujeto = referencia(codigoBulto, codigoHoja)

  if (item.entidad === 'HOJA_RUTA' && item.accion === 'IMPORTAR_PDF') {
    const bultos = datos.bultos
    const extra = typeof bultos === 'number' ? ` · ${bultos} bultos` : ''
    return codigoHoja ? `Hoja ${codigoHoja} importada${extra}` : 'Hoja de ruta importada'
  }

  if (item.entidad === 'PISTOLEO') {
    const estado = String(datos.estado ?? '')
    const bulto = codigoBulto ?? 'Bulto'
    if (estado === 'OK') return `${bulto} pistoleado`
    if (estado === 'DUPLICADO') return `${bulto} duplicado`
    if (estado === 'SIN LISTA ESPERADA') return `${bulto} sin lista esperada`
    if (estado === 'NO PERTENECE') return codigoHoja ? `${bulto} no pertenece a ${codigoHoja}` : `${bulto} no pertenece a la hoja`
    return `${bulto} pistoleado`
  }

  if (item.entidad === 'REASIGNACION') {
    const bulto = codigoBulto ?? 'Bulto'
    const destino = texto(datos, 'codigo_hoja_destino')
    const origen = texto(datos, 'codigo_hoja_origen')
    if (destino && origen) return `${bulto} migrado de ${origen} a ${destino}`
    if (destino) return `${bulto} migrado a ${destino}`
    return `${bulto} migrado de hoja`
  }

  if (item.entidad === 'INCIDENCIA') {
    const destino = sujeto ?? 'bulto desconocido'
    if (item.accion === 'ANULAR') return `Incidencia anulada en ${destino}`
    if (item.accion === 'REGULARIZAR') return `Incidencia regularizada en ${destino}`
    return `Incidencia en ${destino}`
  }

  return sujeto ? `${item.entidad.toLowerCase()} · ${sujeto}` : `${item.entidad.toLowerCase()} · ${item.accion.toLowerCase()}`
}

function pistoleoTexto(item: Pistoleo, codigoHoja: string | undefined): string {
  const bulto = item.codigo_bulto
  if (item.estado === 'DUPLICADO') return `${bulto} duplicado`
  if (item.estado === 'SIN LISTA ESPERADA') return `${bulto} sin lista esperada`
  if (item.estado === 'NO PERTENECE') return codigoHoja ? `${bulto} no pertenece a ${codigoHoja}` : `${bulto} no pertenece a la hoja`
  return codigoHoja ? `${bulto} pistoleado en ${codigoHoja}` : `${bulto} pistoleado`
}

function incidenciaTexto(item: Incidencia, codigoBulto: string | undefined, codigoHoja: string | undefined): string {
  const destino = referencia(codigoBulto, codigoHoja) ?? 'bulto desconocido'
  if (item.tipo === 'REASIGNADO') return `${destino} migrado exitosamente.`
  if (item.tipo === 'DUPLICADO') return `${destino} duplicado.`
  if (item.tipo === 'SIN LISTA ESPERADA') return `${destino} sin lista esperada.`
  if (item.tipo === 'NO PERTENECE') return `${destino} no encontrado .`
  if (item.estado === 'ANULADO') return `Incidencia anulada en ${destino}.`
  if (item.estado === 'REGULARIZADO') return `Incidencia regularizada en ${destino}.`
  return `Incidencia en ${destino}.`
}
