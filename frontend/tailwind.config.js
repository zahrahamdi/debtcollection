/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#e6eeff',
          100: '#ccdaff',
          200: '#99b5ff',
          300: '#6690ff',
          400: '#336bff',
          500: '#0040FF',
          600: '#0040FF',
          700: '#0033cc',
          800: '#002699',
          900: '#001a66',
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
