import { TONE_CLASSES } from '../../utils/constants'

// نشانگر رنگی (badge) برای وضعیت‌ها
export default function Badge({ tone = 'gray', children }) {
  return (
    <span
      className={[
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
        TONE_CLASSES[tone] ?? TONE_CLASSES.gray,
      ].join(' ')}
    >
      {children}
    </span>
  )
}
