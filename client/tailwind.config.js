/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'dark-bg': '#0f0f1a',
        'dark-card': '#1a1a2e',
        'dark-sidebar': '#13132a',
        'dark-border': '#2a2a4a',
        'accent-purple': '#7c3aed',
        'accent-blue': '#2563eb',
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
