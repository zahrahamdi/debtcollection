import { useMemo } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LabelList,
} from 'recharts'
import {
  ChartContainer,
  computeNumericDomain,
  createCategoryXAxisTick,
  estimateNumericAxisWidth,
  formatChartRial,
  numericAxisTickProps,
} from './chartUtils'

const RED = '#ef4444'
const GREEN = '#10b981'

/** نگاشت صریح: محور X = name، سری‌ها = cost / collected با همان ترتیب ایندکس */
function buildChartRows(actionStats) {
  return (actionStats ?? []).map((row) => ({
    id: row.action_type,
    name: String(row.label ?? row.action_type ?? ''),
    cost: Number(row.total_cost) || 0,
    collected: Number(row.total_collected) || 0,
  }))
}

export default function CostByActionChart({ actionStats, height = 360 }) {
  const chartData = useMemo(() => buildChartRows(actionStats), [actionStats])

  const categoryNames = useMemo(() => chartData.map((row) => row.name), [chartData])

  const yDomain = useMemo(() => computeNumericDomain(chartData, ['cost', 'collected']), [chartData])
  const yAxisWidth = useMemo(
    () => estimateNumericAxisWidth(yDomain[1], formatChartRial),
    [yDomain]
  )

  const xAxisHeight = useMemo(() => {
    const longest = categoryNames.reduce((max, label) => Math.max(max, label.length), 0)
    if (longest > 18) return 80
    if (longest > 12) return 68
    return 52
  }, [categoryNames])

  const tickWidth = useMemo(() => {
    const count = Math.max(categoryNames.length, 1)
    return Math.min(120, Math.max(72, Math.floor(640 / count)))
  }, [categoryNames.length])

  if (!chartData.length) return null

  return (
    <ChartContainer style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 28, right: 16, left: 8, bottom: xAxisHeight + 44 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            type="category"
            interval={0}
            height={xAxisHeight}
            tick={createCategoryXAxisTick(tickWidth)}
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            tick={numericAxisTickProps()}
            tickFormatter={formatChartRial}
            width={yAxisWidth}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(v, name) => [formatChartRial(v), name]}
            labelFormatter={(label) => label}
          />
          <Legend
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{ paddingTop: 12, lineHeight: '24px' }}
          />
          <Bar name="هزینه" dataKey="cost" fill={RED} radius={[4, 4, 0, 0]} minPointSize={2}>
            <LabelList
              dataKey="cost"
              position="top"
              formatter={formatChartRial}
              style={{ fontSize: 9, fill: '#334155' }}
            />
          </Bar>
          <Bar name="وصول" dataKey="collected" fill={GREEN} radius={[4, 4, 0, 0]} minPointSize={2}>
            <LabelList
              dataKey="collected"
              position="top"
              formatter={formatChartRial}
              style={{ fontSize: 9, fill: '#334155' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}
