import { useCallback, useEffect, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Panel,
  ReactFlowProvider,
  useReactFlow,
  Handle,
  Position,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Maximize2 } from 'lucide-react'
import { toFaDigits } from '../../utils/format'

function pct(value) {
  if (value === null || value === undefined) return '—'
  return `${toFaDigits(value)}٪`
}

const GREEN = '#10b981'
const BLUE = '#0040FF'
const ORANGE = '#f59e0b'
const RED = '#ef4444'
const BRAND = '#0040FF'

function conversionColor(rate) {
  if (rate > 30) return GREEN
  if (rate >= 10) return ORANGE
  return RED
}

function StartNode({ data }) {
  return (
    <div className="min-w-[180px] rounded-xl border-2 border-brand-600 bg-brand-50 px-4 py-3 text-center shadow-sm">
      <Handle type="source" position={Position.Bottom} className="!bg-brand-600" />
      <p className="text-xs text-slate-500">ایجاد پرونده</p>
      <p className="mt-1 text-lg font-bold text-brand-700">{toFaDigits(data.count)}</p>
    </div>
  )
}

function StepNode({ data }) {
  const color = conversionColor(data.conversion_rate ?? 0)
  return (
    <div
      className="min-w-[210px] rounded-xl border-2 bg-white px-4 py-3 shadow-sm"
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <Handle type="source" position={Position.Bottom} id="next" className="!bg-slate-400" />
      <Handle type="source" position={Position.Right} id="full" className="!bg-emerald-500" style={{ top: '25%' }} />
      <Handle type="source" position={Position.Right} id="partial" className="!bg-blue-500" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Right} id="failure" className="!bg-orange-500" style={{ top: '75%' }} />
      <p className="text-sm font-bold text-slate-800">{data.label}</p>
      <p className="mt-1 text-xs text-slate-500">
        رسیده: {toFaDigits(data.reached_count)} ({pct(data.reached_percent)})
      </p>
    </div>
  )
}

function OutcomeNode({ data }) {
  const styles = {
    full: { border: 'border-emerald-300', bg: 'bg-emerald-50', text: 'text-emerald-800', sub: 'text-emerald-600' },
    partial: { border: 'border-blue-300', bg: 'bg-blue-50', text: 'text-blue-800', sub: 'text-blue-600' },
    failure: { border: 'border-orange-300', bg: 'bg-orange-50', text: 'text-orange-800', sub: 'text-orange-600' },
  }[data.kind]

  return (
    <div className={`min-w-[130px] rounded-xl border-2 px-3 py-2 text-center shadow-sm ${styles.border} ${styles.bg}`}>
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <p className={`text-[10px] font-medium ${styles.sub}`}>{data.title}</p>
      <p className={`mt-0.5 text-sm font-bold ${styles.text}`}>{toFaDigits(data.count)}</p>
    </div>
  )
}

function LegalNode({ data }) {
  return (
    <div className="min-w-[180px] rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-center shadow-sm">
      <Handle type="target" position={Position.Top} className="!bg-red-500" />
      <p className="text-xs text-red-700">در انتظار حقوقی</p>
      <p className="mt-1 text-lg font-bold text-red-800">{toFaDigits(data.count)}</p>
    </div>
  )
}

const nodeTypes = {
  start: StartNode,
  step: StepNode,
  outcome: OutcomeNode,
  legal: LegalNode,
}

function edgeStyle(count, maxFlow, color) {
  return {
    stroke: color,
    strokeWidth: Math.max(2, (count / maxFlow) * 10),
  }
}

function buildGraph(funnel) {
  const total = funnel?.total_cases ?? 0
  const steps = funnel?.steps ?? []
  const legalCount = funnel?.legal_cases ?? 0
  const maxFlow = Math.max(total, 1)

  const nodes = []
  const edges = []
  const rowHeight = 200
  const outcomeX = 560

  nodes.push({
    id: 'start',
    type: 'start',
    position: { x: 240, y: 0 },
    data: { count: total },
  })

  steps.forEach((step, i) => {
    const y = 100 + i * rowHeight
    const stepId = `step-${i}`

    nodes.push({
      id: stepId,
      type: 'step',
      position: { x: 220, y },
      data: step,
    })

    const outcomes = [
      { kind: 'full', id: `full-${i}`, title: 'پرداخت کامل', count: step.paid_full_count ?? 0, handle: 'full', color: GREEN },
      { kind: 'partial', id: `partial-${i}`, title: 'پرداخت جزئی', count: step.paid_partial_count ?? 0, handle: 'partial', color: BLUE },
      { kind: 'failure', id: `failure-${i}`, title: 'شکست استراتژی', count: step.strategy_failure_count ?? 0, handle: 'failure', color: ORANGE },
    ]

    outcomes.forEach((o, oi) => {
      if (o.count <= 0) return
      nodes.push({
        id: o.id,
        type: 'outcome',
        position: { x: outcomeX, y: y - 20 + oi * 58 },
        data: { kind: o.kind, title: o.title, count: o.count },
      })
      const pctOfReached = step.reached_count > 0 ? roundPct((o.count / step.reached_count) * 100) : 0
      edges.push({
        id: `e-${stepId}-${o.id}`,
        source: stepId,
        sourceHandle: o.handle,
        target: o.id,
        label: `${toFaDigits(o.count)} (${pct(pctOfReached)})`,
        style: edgeStyle(o.count, maxFlow, o.color),
        labelStyle: { fontSize: 10, fill: '#334155' },
      })
    })

    if (i === 0) {
      edges.push({
        id: 'e-start-step0',
        source: 'start',
        target: stepId,
        label: `${toFaDigits(total)} (${pct(100)})`,
        style: edgeStyle(total, maxFlow, BRAND),
        labelStyle: { fontSize: 10, fill: '#334155' },
      })
    } else {
      const prev = steps[i - 1]
      const flowCount = prev.continued_count ?? 0
      const flowPct = total > 0 ? roundPct((flowCount / total) * 100) : 0
      edges.push({
        id: `e-step${i - 1}-step${i}`,
        source: `step-${i - 1}`,
        sourceHandle: 'next',
        target: stepId,
        label: `${toFaDigits(flowCount)} (${pct(flowPct)})`,
        style: edgeStyle(flowCount, maxFlow, '#64748b'),
        labelStyle: { fontSize: 10, fill: '#334155' },
      })
    }
  })

  const lastStep = steps[steps.length - 1]
  const legalFlow = lastStep != null ? lastStep.continued_count ?? 0 : total
  const legalY = steps.length ? 100 + steps.length * rowHeight : 100

  nodes.push({
    id: 'legal',
    type: 'legal',
    position: { x: 240, y: legalY },
    data: { count: legalCount || legalFlow },
  })

  if (steps.length > 0) {
    const flowToLegal = legalCount || legalFlow
    edges.push({
      id: 'e-last-legal',
      source: `step-${steps.length - 1}`,
      sourceHandle: 'next',
      target: 'legal',
      label: `${toFaDigits(flowToLegal)} (${pct(total > 0 ? roundPct((flowToLegal / total) * 100) : 0)})`,
      style: edgeStyle(flowToLegal, maxFlow, RED),
      labelStyle: { fontSize: 10, fill: '#334155' },
    })
  } else if (total > 0) {
    edges.push({
      id: 'e-start-legal',
      source: 'start',
      target: 'legal',
      label: `${toFaDigits(legalCount || total)}`,
      style: edgeStyle(legalCount || total, maxFlow, RED),
      labelStyle: { fontSize: 10, fill: '#334155' },
    })
  }

  return { nodes, edges }
}

function roundPct(n) {
  return Math.round(n * 10) / 10
}

function FunnelFlowInner({ funnel, loading }) {
  const { fitView } = useReactFlow()
  const { nodes, edges } = useMemo(() => buildGraph(funnel), [funnel])

  useEffect(() => {
    if (!loading && nodes.length) {
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }))
    }
  }, [nodes, loading, fitView])

  const handleFit = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 })
  }, [fitView])

  if (loading) {
    return <div className="h-[600px] animate-pulse rounded-xl bg-slate-100" />
  }

  if (!funnel?.steps?.length && !funnel?.total_cases) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-400">
        داده‌ای برای Funnel وجود ندارد
      </div>
    )
  }

  return (
    <div className="h-[640px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50/30">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#e2e8f0" />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <button
            type="button"
            onClick={handleFit}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            نمایش کامل
          </button>
        </Panel>
      </ReactFlow>
    </div>
  )
}

export default function FunnelFlowChart(props) {
  return (
    <ReactFlowProvider>
      <FunnelFlowInner {...props} />
    </ReactFlowProvider>
  )
}
