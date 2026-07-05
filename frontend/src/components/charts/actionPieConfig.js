/** ترتیب، برچسب و رنگ ثابت اقدامات — مشترک بین نمودارهای توزیع هزینه و وصول */

export const ACTION_TYPE_ORDER = [
  'warning_sms',
  'threatening_sms',
  'warning_autocall',
  'threatening_autocall',
  'negotiator_call',
]

export const ACTION_LABELS = {
  warning_sms: 'ارسال پیامک هشدار',
  threatening_sms: 'ارسال پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
  negotiator_call: 'تماس مذاکره‌کننده',
}

/** نگاشت ثابت رنگ — یکسان در هر دو pie chart */
export const ACTION_COLORS = {
  warning_sms: '#3b82f6',
  threatening_sms: '#10b981',
  warning_autocall: '#f59e0b',
  threatening_autocall: '#f97316',
  negotiator_call: '#ef4444',
}

const SMALL_SLICE_RATIO = 0.04

/** مرتب‌سازی و رنگ‌دهی ثابت؛ فقط دسته‌های با value > 0 */
export function prepareActionPieData(distribution) {
  const byType = Object.fromEntries((distribution ?? []).map((d) => [d.action_type, d]))

  return ACTION_TYPE_ORDER.map((action_type) => {
    const item = byType[action_type]
    const value = Number(item?.value) || 0
    if (value <= 0) return null
    return {
      action_type,
      name: item?.label || ACTION_LABELS[action_type] || action_type,
      value,
      fill: ACTION_COLORS[action_type],
    }
  }).filter(Boolean)
}

/** لیست legend ثابت (همه دسته‌ها به ترتیب تعریف‌شده) — برای مرجع خارجی */
export function buildActionLegendPayload(pieData) {
  const valueByType = Object.fromEntries(pieData.map((d) => [d.action_type, d.value]))
  return ACTION_TYPE_ORDER.map((action_type) => ({
    value: ACTION_LABELS[action_type],
    type: 'square',
    color: ACTION_COLORS[action_type],
    inactive: !valueByType[action_type],
  }))
}

export function computeMidAngles(data, startAngle = 0, endAngle = 360) {
  const total = data.reduce((sum, row) => sum + row.value, 0)
  if (!total) return []

  let angle = startAngle
  const span = endAngle - startAngle

  return data.map((row) => {
    const delta = (row.value / total) * span
    const midAngle = angle + delta / 2
    const slice = {
      ...row,
      midAngle,
      percent: row.value / total,
    }
    angle += delta
    return slice
  })
}

/** جای‌گذاری برچسب بیرونی با جابه‌جایی عمودی برای جلوگیری از هم‌پوشانی */
export function computePieLabelLayout(data, { cx, cy, outerRadius }) {
  const RADIAN = Math.PI / 180
  const slices = computeMidAngles(data)

  const labels = slices
    .filter((s) => s.percent >= SMALL_SLICE_RATIO)
    .map((s) => {
      const extraRadius = s.percent < 0.08 ? 46 : 34
      const radius = outerRadius + extraRadius
      return {
        key: s.action_type,
        midAngle: s.midAngle,
        percent: s.percent,
        x: cx + radius * Math.cos(-s.midAngle * RADIAN),
        y: cy + radius * Math.sin(-s.midAngle * RADIAN),
      }
    })

  const shiftGroup = (group) => {
    group.sort((a, b) => a.y - b.y)
    for (let i = 1; i < group.length; i += 1) {
      if (group[i].y - group[i - 1].y < 15) {
        group[i].y = group[i - 1].y + 15
      }
    }
  }

  shiftGroup(labels.filter((l) => l.x >= cx))
  shiftGroup(labels.filter((l) => l.x < cx))

  return new Map(labels.map((l) => [l.key, l]))
}

export { SMALL_SLICE_RATIO }
