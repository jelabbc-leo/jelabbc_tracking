/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/views/**/*.ejs',
    './src/public/js/**/*.js'
  ],
  safelist: [
    // Clases dinamicas usadas en badges de estado (dashboard, viajes, etc.)
    {
      pattern: /bg-(green|amber|indigo|red|teal|gray|blue|purple)-(50|100|200|300|500|600|700)/,
    },
    {
      pattern: /text-(green|amber|indigo|red|teal|gray|blue|purple)-(500|600|700)/,
    },
    {
      pattern: /border-(green|amber|indigo|red|teal|gray|blue)-(200|300|500)/,
    },
    'animate-pulse',
    'animate-spin',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
