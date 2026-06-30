/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'system-ui', 'sans-serif'],
      },
      colors: {
        // رنگ برند دیجی‌پی (نیلی/بنفش)
        brand: {
          50: '#eef0ff',
          100: '#e0e3ff',
          200: '#c7ccff',
          300: '#a5aaff',
          400: '#8480f8',
          500: '#6a5cef',
          600: '#5942e0',
          700: '#4a35c4',
          800: '#3d2e9e',
          900: '#352a8f',
        },
      },
      boxShadow: {
        panel: '0 1px 3px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.04)',
        drawer: '-8px 0 24px rgba(16, 24, 40, 0.12)',
      },
    },
  },
  plugins: [],
}
