import { useState } from 'react'
import type { HojaRuta } from '../api/types'
import { formatDate, formatNumber } from '../format'

type Props = {
  hojas: HojaRuta[]
  pendingByHoja: Map<number, number>
  onOpen: (hojaId: number) => void
  linkRows?: boolean
  maxVisible?: number
}

type SortKey = 'registro' | 'emision' | 'ruta' | 'estado'
type SortDir = 'asc' | 'desc'

export default function HojaTable({ hojas, pendingByHoja, onOpen, linkRows = false, maxVisible }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null)

  const ordenar = (key: SortKey) => {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: 'asc' }
      return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    })
  }

  const filas = [...hojas].sort((a, b) => {
    if (!sort) return 0
    const factor = sort.dir === 'asc' ? 1 : -1
    return valorOrden(a, sort.key, pendingByHoja).localeCompare(valorOrden(b, sort.key, pendingByHoja), 'es', { sensitivity: 'base' }) * factor
  })

  if (!hojas.length) {
    return <p className="empty">No hay hojas de ruta cargadas.</p>
  }

  return (
    <div className={`table-wrap${maxVisible && hojas.length > maxVisible ? ' hojas-scroll' : ''}`}>
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <SortHeader column="registro" label="Registro" onSort={ordenar} sort={sort} />
            <SortHeader column="emision" label="Emisión" onSort={ordenar} sort={sort} />
            <SortHeader column="ruta" label="Ruta" onSort={ordenar} sort={sort} />
            <th>Bultos</th>
            <SortHeader column="estado" label="Estado" onSort={ordenar} sort={sort} />
          </tr>
        </thead>
        <tbody className={linkRows ? 'clickable row-link' : 'clickable'}>
          {filas.map((hoja) => {
            const pending = pendingByHoja.get(hoja.id) ?? 0
            const badge = badgeFor(hoja, pending)
            return (
              <tr key={hoja.id} onClick={() => onOpen(hoja.id)}>
                <td className="code">{hoja.codigo}</td>
                <td>{formatDate(hoja.fecha_registro)}</td>
                <td>{formatDate(hoja.fecha)}</td>
                <td>{hoja.ruta}</td>
                <td>{formatNumber(hoja.cantidad_bultos)}</td>
                <td><span className={`badge ${badge.tone}`}>{badge.label}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string
  column: SortKey
  sort: { key: SortKey; dir: SortDir } | null
  onSort: (key: SortKey) => void
}) {
  const active = sort?.key === column
  return (
    <th aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="sort-header" onClick={() => onSort(column)} type="button">
        {label}
        <span aria-hidden="true">{active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
}

function valorOrden(hoja: HojaRuta, key: SortKey, pendingByHoja: Map<number, number>) {
  if (key === 'registro') return hoja.fecha_registro
  if (key === 'emision') return hoja.fecha
  if (key === 'ruta') return hoja.ruta
  return badgeFor(hoja, pendingByHoja.get(hoja.id) ?? 0).label
}

function badgeFor(hoja: HojaRuta, pending: number) {
  if (hoja.estado === 'CERRADA') return { label: 'Cerrada', tone: 'closed' }
  if (pending > 0) return { label: 'Con incidencias', tone: 'warn' }
  if (hoja.estado === 'ACTIVA') return { label: 'Activa', tone: 'ok' }
  return { label: 'Inactiva', tone: 'muted' }
}
