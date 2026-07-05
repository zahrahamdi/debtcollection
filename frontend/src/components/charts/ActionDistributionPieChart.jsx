import { useMemo } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
} from 'recharts'
import { ChartContainer, CHART_FONT, formatChartAxisNumber, formatChartPercent } from './chartUtils'
import {
  ACTION_COLORS,
  ACTION_LABELS,
  ACTION_TYPE_ORDER,
  SMALL_SLICE_RATIO,
  computePieLabelLayout,
  prepareActionPieData,
} from './actionPieConfig'

const PIE_CX_RATIO = 0.36
const PIE_OUTER_RADIUS = 108
const CHART_HEIGHT = 400

function ActionLegendList({ pieData }) {
  const activeTypes = new Set(pieData.map((d) => d.action_type))

  return (
    <ul className="flex flex-col gap-1.5 pr-2 text-xs text-slate-600">
      {ACTION_TYPE_ORDER.map((action_type) => {
        const active = activeTypes.has(action_type)
        return (
          <li
            key={action_type}
            className={active ? 'flex items-center gap-2' : 'flex items-center gap-2 opacity-35'}
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: ACTION_COLORS[action_type] }}
            />
            <span style={{ direction: 'rtl', fontFamily: CHART_FONT }}>{ACTION_LABELS[action_type]}</span>
          </li>
        )
      })}
    </ul>
  )
}

export default function ActionDistributionPieChart({ distribution, tooltipFormatter, height = CHART_HEIGHT }) {
  const pieData = useMemo(() => prepareActionPieData(distribution), [distribution])

  const labelLayout = useMemo(() => {
    const chartWidth = 520
    const cx = chartWidth * PIE_CX_RATIO
    const cy = height / 2
    return { map: computePieLabelLayout(pieData, { cx, cy, outerRadius: PIE_OUTER_RADIUS }), cx }
  }, [pieData, height])

  const renderOutsideLabel = useMemo(
    () =>
      function OutsideLabel(props) {
        const { percent, payload, cx } = props
        if (percent < SMALL_SLICE_RATIO) return null

        const layout = labelLayout.map.get(payload.action_type)
        if (!layout) return null

        return (
          <text
            x={layout.x}
            y={layout.y}
            fill="#334155"
            textAnchor={layout.x >= cx ? 'start' : 'end'}
            dominantBaseline="central"
            fontSize={11}
            fontFamily={CHART_FONT}
            style={{ direction: 'ltr' }}
          >
            {formatChartPercent(Number((percent * 100).toFixed(1)))}
          </text>
        )
      },
    [labelLayout]
  )

  const renderLabelLine = useMemo(
    () =>
      function LabelLine(props) {
        const { cx, cy, midAngle, outerRadius, percent, payload, stroke } = props
        if (percent < SMALL_SLICE_RATIO) return null

        const layout = labelLayout.map.get(payload.action_type)
        if (!layout) return null

        const RADIAN = Math.PI / 180
        const cos = Math.cos(-midAngle * RADIAN)
        const sin = Math.sin(-midAngle * RADIAN)
        const elbow = percent < 0.08 ? 26 : 18
        const sx = cx + (outerRadius + 2) * cos
        const sy = cy + (outerRadius + 2) * sin
        const mx = cx + (outerRadius + elbow) * cos
        const my = cy + (outerRadius + elbow) * sin

        return (
          <path
            d={`M${sx},${sy}L${mx},${my}L${layout.x},${layout.y}`}
            stroke={stroke || '#94a3b8'}
            strokeWidth={1}
            fill="none"
          />
        )
      },
    [labelLayout]
  )

  if (!pieData.length) return null

  return (
    <ChartContainer style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 28, right: 150, bottom: 28, left: 12 }}>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx={`${PIE_CX_RATIO * 100}%`}
            cy="50%"
            outerRadius={PIE_OUTER_RADIUS}
            labelLine={renderLabelLine}
            label={renderOutsideLabel}
            isAnimationActive={false}
          >
            {pieData.map((entry) => (
              <Cell key={entry.action_type} fill={entry.fill} />
            ))}
          </Pie>
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            content={() => <ActionLegendList pieData={pieData} />}
          />
          <Tooltip
            formatter={(v, _name, item) => [
              tooltipFormatter ? tooltipFormatter(v) : formatChartAxisNumber(v),
              item?.payload?.name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}
