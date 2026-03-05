'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'

const API = 'http://localhost:3001/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeType = 'rectangle' | 'diamond' | 'oval'

interface FlowNode {
  id: string
  type: NodeType
  x: number
  y: number
  label: string
}

interface Connection {
  id: string
  source: string
  target: string
}

// ── Node size helpers ─────────────────────────────────────────────────────────

const NODE_W = 140
const NODE_H = 60
const DIAMOND_W = 150
const DIAMOND_H = 70
const OVAL_W = 140
const OVAL_H = 56

function getNodeSize(node: FlowNode) {
  if (node.type === 'diamond') return { w: DIAMOND_W, h: DIAMOND_H }
  if (node.type === 'oval') return { w: OVAL_W, h: OVAL_H }
  return { w: NODE_W, h: NODE_H }
}

function getEdgePoint(node: FlowNode, side: 'top' | 'bottom' | 'left' | 'right') {
  const { w, h } = getNodeSize(node)
  const cx = node.x + w / 2
  const cy = node.y + h / 2
  if (side === 'top') return { x: cx, y: node.y }
  if (side === 'bottom') return { x: cx, y: node.y + h }
  if (side === 'left') return { x: node.x, y: cy }
  return { x: node.x + w, y: cy }
}

function nearestSide(
  src: FlowNode,
  tgt: FlowNode,
): { srcSide: 'top' | 'bottom' | 'left' | 'right'; tgtSide: 'top' | 'bottom' | 'left' | 'right' } {
  const sw = getNodeSize(src)
  const tw = getNodeSize(tgt)
  const scx = src.x + sw.w / 2
  const scy = src.y + sw.h / 2
  const tcx = tgt.x + tw.w / 2
  const tcy = tgt.y + tw.h / 2
  const dx = tcx - scx
  const dy = tcy - scy
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? { srcSide: 'right', tgtSide: 'left' } : { srcSide: 'left', tgtSide: 'right' }
  }
  return dy > 0 ? { srcSide: 'bottom', tgtSide: 'top' } : { srcSide: 'top', tgtSide: 'bottom' }
}

// ── ASCII generation ──────────────────────────────────────────────────────────

function generateAscii(nodes: FlowNode[], connections: Connection[]): string {
  if (nodes.length === 0) return ''

  const CW = 10  // pixels per char (width)
  const CH = 18  // pixels per char (height)
  const PAD = 3  // extra chars around content

  // Build per-node ASCII blocks
  type Block = { gx: number; gy: number; lines: string[]; w: number; h: number; cx: number; cy: number }
  const blocks = new Map<string, Block>()

  for (const node of nodes) {
    const label = node.label || ' '
    const labelLen = label.length
    let lines: string[]

    if (node.type === 'rectangle') {
      const inner = Math.max(labelLen, 6)
      const top = '+' + '-'.repeat(inner + 2) + '+'
      const mid = '| ' + label.padEnd(inner, ' ') + ' |'
      const bot = '+' + '-'.repeat(inner + 2) + '+'
      lines = [top, mid, bot]
    } else if (node.type === 'diamond') {
      const inner = Math.max(labelLen, 4)
      const total = inner + 4
      const spaces = Math.floor(total / 2)
      const top    = ' '.repeat(spaces) + '/\\'
      const upper  = ' '.repeat(spaces - 1) + '/' + ' '.repeat(inner + 2) + '\\'
      const mid    = '/' + ' ' + label.padEnd(inner + 2, ' ') + '\\'
      const lower  = ' '.repeat(spaces - 1) + '\\' + ' '.repeat(inner + 2) + '/'
      const bot    = ' '.repeat(spaces) + '\\/'
      lines = [top, upper, mid, lower, bot]
    } else {
      // oval
      const inner = Math.max(labelLen, 4)
      const top = ' (' + '-'.repeat(inner + 2) + ')'
      const mid = '(  ' + label.padEnd(inner, ' ') + '  )'
      const bot = ' (' + '-'.repeat(inner + 2) + ')'
      lines = [top, mid, bot]
    }

    const w = Math.max(...lines.map(l => l.length))
    const h = lines.length
    const gx = Math.round(node.x / CW)
    const gy = Math.round(node.y / CH)
    blocks.set(node.id, { gx, gy, lines, w, h, cx: gx + Math.floor(w / 2), cy: gy + Math.floor(h / 2) })
  }

  // Compute grid dimensions
  let maxGx = 0; let maxGy = 0
  for (const b of blocks.values()) {
    maxGx = Math.max(maxGx, b.gx + b.w + PAD)
    maxGy = Math.max(maxGy, b.gy + b.h + PAD)
  }
  const gridW = Math.max(maxGx + 10, 80)
  const gridH = Math.max(maxGy + 6, 20)

  // Allocate grid
  const grid: string[][] = Array.from({ length: gridH }, () => Array(gridW).fill(' '))

  function setChar(x: number, y: number, ch: string) {
    if (x >= 0 && x < gridW && y >= 0 && y < gridH) grid[y][x] = ch
  }

  // Place node blocks
  for (const b of blocks.values()) {
    for (let r = 0; r < b.lines.length; r++) {
      for (let c = 0; c < b.lines[r].length; c++) {
        setChar(b.gx + c, b.gy + r, b.lines[r][c])
      }
    }
  }

  // Draw connections
  for (const conn of connections) {
    const srcBlock = blocks.get(conn.source)
    const tgtBlock = blocks.get(conn.target)
    if (!srcBlock || !tgtBlock) continue

    const { srcSide, tgtSide } = nearestSide(
      nodes.find(n => n.id === conn.source)!,
      nodes.find(n => n.id === conn.target)!,
    )

    // Source attachment point in grid coords
    const srcNode = nodes.find(n => n.id === conn.source)!
    const tgtNode = nodes.find(n => n.id === conn.target)!

    let sx: number, sy: number, tx: number, ty: number
    if (srcSide === 'right') {
      sx = srcBlock.gx + srcBlock.w; sy = srcBlock.cy
    } else if (srcSide === 'left') {
      sx = srcBlock.gx - 1; sy = srcBlock.cy
    } else if (srcSide === 'bottom') {
      sx = srcBlock.cx; sy = srcBlock.gy + srcBlock.h
    } else {
      sx = srcBlock.cx; sy = srcBlock.gy - 1
    }

    if (tgtSide === 'left') {
      tx = tgtBlock.gx - 1; ty = tgtBlock.cy
    } else if (tgtSide === 'right') {
      tx = tgtBlock.gx + tgtBlock.w; ty = tgtBlock.cy
    } else if (tgtSide === 'top') {
      tx = tgtBlock.cx; ty = tgtBlock.gy - 1
    } else {
      tx = tgtBlock.cx; ty = tgtBlock.gy + tgtBlock.h
    }

    // Draw the path: horizontal then vertical (elbow routing)
    const arrowChar = tgtSide === 'left' ? '>' : tgtSide === 'right' ? '<' : tgtSide === 'top' ? 'v' : '^'

    if (srcSide === 'right' || srcSide === 'left') {
      // Horizontal segment from sx to midX, then vertical to ty, then horizontal to tx
      const midX = Math.round((sx + tx) / 2)
      const step = sx < midX ? 1 : -1
      for (let x = sx; x !== midX; x += step) setChar(x, sy, '-')
      const vstep = sy < ty ? 1 : sy > ty ? -1 : 0
      if (vstep !== 0) {
        for (let y = sy; y !== ty; y += vstep) setChar(midX, y, '|')
      }
      const hstep2 = midX < tx ? 1 : -1
      for (let x = midX; x !== tx; x += hstep2) setChar(x, ty, '-')
      setChar(tx, ty, arrowChar)
    } else {
      // Vertical segment from sy to midY, then horizontal to tx, then vertical to ty
      const midY = Math.round((sy + ty) / 2)
      const vstep = sy < midY ? 1 : -1
      for (let y = sy; y !== midY; y += vstep) setChar(sx, y, '|')
      const hstep = sx < tx ? 1 : sx > tx ? -1 : 0
      if (hstep !== 0) {
        for (let x = sx; x !== tx; x += hstep) setChar(x, midY, '-')
      }
      const vstep2 = midY < ty ? 1 : -1
      for (let y = midY; y !== ty; y += vstep2) setChar(tx, y, '|')
      setChar(tx, ty, arrowChar)
    }
  }

  return grid.map(row => row.join('').trimEnd()).filter((_, i) => {
    // trim leading/trailing empty lines
    return true
  }).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

// ── Main App ──────────────────────────────────────────────────────────────────

let nodeSeq = 0
function newId() { return `n${++nodeSeq}` }
let connSeq = 0
function newConnId() { return `c${++connSeq}` }

const CANVAS_W = 900
const CANVAS_H = 540

export default function App() {
  const [nodes, setNodes] = useState<FlowNode[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [asciiOutput, setAsciiOutput] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [flowName, setFlowName] = useState('')
  const [savedFlowcharts, setSavedFlowcharts] = useState<string[]>([])
  const [selectedFlow, setSelectedFlow] = useState('')

  // Drag state
  const dragging = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null)
  // Connection-drawing state
  const connecting = useRef<{ nodeId: string; side: string; startX: number; startY: number } | null>(null)
  const [connPreview, setConnPreview] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  // Load saved flowcharts list on mount
  useEffect(() => {
    fetch(`${API}/flowcharts/`)
      .then(r => r.json())
      .then((data: { name: string }[]) => setSavedFlowcharts(data.map(d => d.name)))
      .catch(() => {})
  }, [])

  // ── Add node ────────────────────────────────────────────────────────────────

  function addNode(type: NodeType) {
    const id = newId()
    // 2-column grid: col 0 (x=80) left, col 1 (x=350) right; rows spaced 170px apart
    const col = nodes.length % 2
    const row = Math.floor(nodes.length / 2)
    const defaultX = col === 0 ? 80 : 350
    const defaultY = 80 + row * 170
    setNodes(prev => [...prev, { id, type, x: defaultX, y: defaultY, label: '' }])
  }

  // ── Inline label edit ───────────────────────────────────────────────────────

  function startEdit(nodeId: string, currentLabel: string) {
    setEditingId(nodeId)
    setEditValue(currentLabel)
  }

  function commitEdit() {
    if (editingId == null) return
    setNodes(prev => prev.map(n => n.id === editingId ? { ...n, label: editValue } : n))
    setEditingId(null)
  }

  // ── SVG mouse events for drag & connect ─────────────────────────────────────

  function getSvgPoint(e: React.MouseEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onHandleMouseDown(e: React.MouseEvent, nodeId: string, side: string) {
    e.stopPropagation()
    e.preventDefault()
    const pt = getSvgPoint(e)
    connecting.current = { nodeId, side, startX: pt.x, startY: pt.y }
    setConnPreview({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y })
  }

  function onNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    if (connecting.current) return
    e.stopPropagation()
    const pt = getSvgPoint(e)
    const node = nodes.find(n => n.id === nodeId)!
    dragging.current = { nodeId, offsetX: pt.x - node.x, offsetY: pt.y - node.y }
  }

  function onSvgMouseMove(e: React.MouseEvent) {
    const pt = getSvgPoint(e)
    if (dragging.current) {
      const { nodeId, offsetX, offsetY } = dragging.current
      setNodes(prev => prev.map(n =>
        n.id === nodeId
          ? { ...n, x: Math.max(0, pt.x - offsetX), y: Math.max(0, pt.y - offsetY) }
          : n,
      ))
    }
    if (connecting.current) {
      setConnPreview(prev => prev ? { ...prev, x2: pt.x, y2: pt.y } : null)
    }
  }

  function onSvgMouseUp(e: React.MouseEvent) {
    dragging.current = null
    if (connecting.current) {
      const { nodeId: srcId } = connecting.current
      const pt = getSvgPoint(e)
      // Find target node under cursor
      const target = nodes.find(n => {
        if (n.id === srcId) return false
        const { w, h } = getNodeSize(n)
        return pt.x >= n.x && pt.x <= n.x + w && pt.y >= n.y && pt.y <= n.y + h
      })
      if (target) {
        const connId = newConnId()
        setConnections(prev => [...prev, { id: connId, source: srcId, target: target.id }])
      }
      connecting.current = null
      setConnPreview(null)
    }
  }

  // ── Generate ASCII ───────────────────────────────────────────────────────────

  function handleGenerateAscii() {
    setAsciiOutput(generateAscii(nodes, connections))
  }

  // ── Save / Load ──────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!flowName.trim()) { alert('Please enter a flowchart name'); return }
    const res = await fetch(`${API}/flowcharts/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: flowName.trim(), nodes, connections }),
    })
    if (!res.ok) { alert('Save failed'); return }
    // Refresh dropdown
    const list = await fetch(`${API}/flowcharts/`).then(r => r.json()) as { name: string }[]
    setSavedFlowcharts(list.map(d => d.name))
  }

  async function handleLoad() {
    if (!selectedFlow) { alert('Select a flowchart to load'); return }
    const res = await fetch(`${API}/flowcharts/${encodeURIComponent(selectedFlow)}/`)
    if (!res.ok) { alert('Load failed'); return }
    const data = await res.json()
    setNodes(data.nodes || [])
    setConnections(data.connections || [])
    setFlowName(data.name)
    setAsciiOutput(null)
    setEditingId(null)
  }

  // ── Copy / Export ────────────────────────────────────────────────────────────

  function handleCopy() {
    if (asciiOutput == null) return
    navigator.clipboard.writeText(asciiOutput)
  }

  function handleExport() {
    if (asciiOutput == null) return
    const blob = new Blob([asciiOutput], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (flowName.trim() || 'flowchart') + '.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Keyboard: delete selected connection ─────────────────────────────────────

  const [selectedConn, setSelectedConn] = useState<string | null>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConn) {
        setConnections(prev => prev.filter(c => c.id !== selectedConn))
        setSelectedConn(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedConn])

  // ── Render ───────────────────────────────────────────────────────────────────

  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Toolbar */}
      <div style={{
        background: '#1e293b', color: '#fff', padding: '10px 16px',
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <strong style={{ marginRight: 8 }}>ASCII Flowchart</strong>
        {(['rectangle', 'diamond', 'oval'] as NodeType[]).map(type => (
          <button
            key={type}
            data-testid={`add-${type}`}
            onClick={() => addNode(type)}
            style={btnStyle}
          >
            + {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
        <button
          data-testid="generate-ascii"
          onClick={handleGenerateAscii}
          style={{ ...btnStyle, background: '#0ea5e9' }}
        >
          Generate ASCII
        </button>
      </div>

      {/* Main area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Canvas */}
        <svg
          ref={svgRef}
          data-testid="canvas"
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ background: '#fff', border: '1px solid #cbd5e1', cursor: 'default', flexShrink: 0 }}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
        >
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#475569" />
            </marker>
          </defs>

          {/* Connections */}
          {connections.map(conn => {
            const src = nodes.find(n => n.id === conn.source)
            const tgt = nodes.find(n => n.id === conn.target)
            if (!src || !tgt) return null
            const { srcSide, tgtSide } = nearestSide(src, tgt)
            const sp = getEdgePoint(src, srcSide)
            const tp = getEdgePoint(tgt, tgtSide)
            return (
              <line
                key={conn.id}
                x1={sp.x} y1={sp.y}
                x2={tp.x} y2={tp.y}
                stroke={selectedConn === conn.id ? '#ef4444' : '#475569'}
                strokeWidth={2}
                markerEnd="url(#arrow)"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedConn(conn.id === selectedConn ? null : conn.id)}
              />
            )
          })}

          {/* Connection preview */}
          {connPreview && (
            <line
              x1={connPreview.x1} y1={connPreview.y1}
              x2={connPreview.x2} y2={connPreview.y2}
              stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 3"
            />
          )}

          {/* Nodes */}
          {nodes.map(node => {
            const { w, h } = getNodeSize(node)
            const isHovered = hoveredNode === node.id
            const isEditing = editingId === node.id

            return (
              <g
                key={node.id}
                data-testid="node"
                transform={`translate(${node.x},${node.y})`}
                onMouseDown={e => onNodeMouseDown(e, node.id)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'move' }}
              >
                {/* Shape */}
                {node.type === 'rectangle' && (
                  <rect x={0} y={0} width={w} height={h} rx={4}
                    fill="#f8fafc" stroke="#475569" strokeWidth={2} style={{ pointerEvents: 'none' }} />
                )}
                {node.type === 'diamond' && (
                  <polygon
                    points={`${w/2},0 ${w},${h/2} ${w/2},${h} 0,${h/2}`}
                    fill="#fefce8" stroke="#a16207" strokeWidth={2}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {node.type === 'oval' && (
                  <ellipse cx={w/2} cy={h/2} rx={w/2} ry={h/2}
                    fill="#f0fdf4" stroke="#166534" strokeWidth={2} style={{ pointerEvents: 'none' }} />
                )}

                {/* Label */}
                {isEditing ? (
                  <foreignObject x={4} y={h/2 - 14} width={w - 8} height={28}>
                    <input
                      // @ts-ignore
                      xmlns="http://www.w3.org/1999/xhtml"
                      autoFocus
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit() }}
                      style={{
                        width: '100%', border: 'none', outline: 'none',
                        background: 'transparent', textAlign: 'center',
                        fontSize: 13, fontFamily: 'sans-serif',
                      }}
                    />
                  </foreignObject>
                ) : (
                  <text
                    data-testid="node-label"
                    x={w / 2}
                    y={h / 2 + 5}
                    textAnchor="middle"
                    fontSize={13}
                    fontFamily="sans-serif"
                    fill="#1e293b"
                    style={{ userSelect: 'none', cursor: 'text' }}
                    onClick={e => { e.stopPropagation(); startEdit(node.id, node.label) }}
                  >
                    {node.label || <tspan fill="#94a3b8">label</tspan>}
                  </text>
                )}

                {/* Connection handles — visible on hover */}
                {isHovered && (['top', 'bottom', 'left', 'right'] as const).map(side => {
                  const hp = getEdgePoint({ ...node, x: 0, y: 0 } as FlowNode, side)
                  return (
                    <circle
                      key={side}
                      cx={hp.x} cy={hp.y} r={6}
                      fill="#3b82f6" stroke="#fff" strokeWidth={2}
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={e => onHandleMouseDown(e, node.id, side)}
                    />
                  )
                })}
              </g>
            )
          })}
        </svg>

        {/* Side panel */}
        <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          {/* Save / Load */}
          <div style={panelCard}>
            <h3 style={panelTitle}>Save / Load</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                data-testid="flowchart-name-input"
                value={flowName}
                onChange={e => setFlowName(e.target.value)}
                placeholder="Flowchart name"
                style={inputStyle}
              />
              <button data-testid="save-btn" onClick={handleSave} style={btnStyle}>Save</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                data-testid="flowchart-select"
                value={selectedFlow}
                onChange={e => setSelectedFlow(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">-- select --</option>
                {savedFlowcharts.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button data-testid="load-btn" onClick={handleLoad} style={btnStyle}>Load</button>
            </div>
          </div>

          {/* ASCII output */}
          {asciiOutput !== null && (
            <div style={panelCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ ...panelTitle, margin: 0 }}>ASCII Output</h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button data-testid="copy-ascii" onClick={handleCopy} style={btnStyle}>Copy</button>
                  <button data-testid="export-txt" onClick={handleExport} style={btnStyle}>Export .txt</button>
                </div>
              </div>
              <pre
                data-testid="ascii-output"
                style={{
                  width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 12,
                  background: '#0f172a', color: '#86efac', border: 'none', borderRadius: 6,
                  padding: 10, margin: 0, overflowX: 'auto', whiteSpace: 'pre', boxSizing: 'border-box',
                }}
              >{asciiOutput}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', background: '#334155', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
}

const panelCard: React.CSSProperties = {
  background: '#fff', borderRadius: 8, padding: 14,
  boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
}

const panelTitle: React.CSSProperties = {
  margin: '0 0 10px 0', fontSize: 14, fontWeight: 600, color: '#1e293b',
}

const inputStyle: React.CSSProperties = {
  flex: 1, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6,
  fontSize: 13, outline: 'none',
}
