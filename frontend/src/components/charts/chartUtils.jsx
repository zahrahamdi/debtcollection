/** ابزارهای مشترک نمودار Recharts — LTR برای محورها، RTL برای برچسب‌های فارسی */

export const CHART_FONT = 'Vazirmatn, Tahoma, sans-serif'

export const CHART_LTR_STYLE = { direction: 'ltr', width: '100%' }

const AXIS_TICK = { fontSize: 11, fontFamily: CHART_FONT, fill: '#64748b' }

export function formatChartAxisNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return ''
  const num = Number(value)
  if (Number.isInteger(num)) return num.toLocaleString('en-US')
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function formatChartPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return ''
  return `${formatChartAxisNumber(value)}%`
}

export function formatChartRial(value) {
  if (value == null || value === '') return ''
  const num = Number(value)
  if (Number.isNaN(num)) return ''
  return num.toLocaleString('en-US')
}

export function estimateCategoryAxisWidth(labels, { min = 128, max = 320, charWidth = 8, padding = 32 } = {}) {
  if (!labels?.length) return min
  const longest = labels.reduce((maxLen, label) => Math.max(maxLen, String(label).length), 0)
  return Math.min(max, Math.max(min, longest * charWidth + padding))
}

export function estimateNumericAxisWidth(maxValue, formatter = formatChartAxisNumber) {
  const label = formatter(maxValue)
  return Math.max(52, label.length * 7 + 16)
}

export function computeNumericDomain(data, keys) {
  let max = 0
  for (const row of data) {
    for (const key of keys) {
      const n = Number(row[key])
      if (!Number.isNaN(n)) max = Math.max(max, n)
    }
  }
  if (max <= 0) return [0, 1]
  const padded = max * 1.12
  return [0, padded]
}

export function createCategoryXAxisTick(tickWidth = 88) {
  return function CategoryXAxisTick({ x, y, payload }) {
    const label = String(payload?.value ?? '')
    return (
      <g transform={`translate(${x},${y})`}>
        <foreignObject x={-tickWidth / 2} y={6} width={tickWidth} height={52}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              direction: 'rtl',
              textAlign: 'center',
              fontSize: 10,
              fontFamily: CHART_FONT,
              color: '#64748b',
              lineHeight: 1.35,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
            }}
            title={label}
          >
            {label}
          </div>
        </foreignObject>
      </g>
    )
  }
}

export function createCategoryYAxisTick(axisWidth) {
  return function CategoryYAxisTick({ x, y, payload }) {
    return (
      <g transform={`translate(${x},${y})`}>
        <foreignObject x={-(axisWidth - 10)} y={-12} width={axisWidth - 14} height={24}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              direction: 'rtl',
              textAlign: 'right',
              fontSize: 11,
              fontFamily: CHART_FONT,
              color: '#64748b',
              lineHeight: '24px',
              overflow: 'visible',
              whiteSpace: 'nowrap',
            }}
          >
            {payload.value}
          </div>
        </foreignObject>
      </g>
    )
  }
}

export function numericAxisTickProps() {
  return { ...AXIS_TICK, style: { direction: 'ltr' } }
}

export function ChartContainer({ children, style, className = '' }) {
  return (
    <div className={className} style={{ ...CHART_LTR_STYLE, ...style }}>
      {children}
    </div>
  )
}

export function HorizontalBarValueLabel({ x, y, width, height, value, formatter }) {
  if (value == null || Number.isNaN(Number(value))) return null
  const display = formatter ? formatter(value) : formatChartAxisNumber(value)
  return (
    <text
      x={x + width + 12}
      y={y + height / 2}
      textAnchor="start"
      dominantBaseline="middle"
      fill="#334155"
      fontSize={11}
      fontFamily={CHART_FONT}
      style={{ direction: 'ltr' }}
    >
      {display}
    </text>
  )
}

export function VerticalBarLabels({ x, y, width, height, value, payload, showTitle, valueFormatter }) {
  if (value == null || Number.isNaN(Number(value))) return null
  const display = valueFormatter ? valueFormatter(value) : formatChartAxisNumber(value)
  return (
    <g>
      {showTitle && payload?.name && (
        <foreignObject x={x - 4} y={y - 30} width={width + 8} height={22}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              direction: 'rtl',
              textAlign: 'center',
              fontSize: 10,
              fontFamily: CHART_FONT,
              color: '#64748b',
              lineHeight: '22px',
              overflow: 'visible',
              whiteSpace: 'nowrap',
            }}
          >
            {payload.name}
          </div>
        </foreignObject>
      )}
      <text
        x={x + width / 2}
        y={y + height + 18}
        textAnchor="middle"
        fill="#334155"
        fontSize={10}
        fontFamily={CHART_FONT}
        style={{ direction: 'ltr' }}
      >
        {display}
      </text>
    </g>
  )
}
