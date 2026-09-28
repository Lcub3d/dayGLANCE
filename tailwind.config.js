/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // dayGLANCE wordmark (Lora, self-hosted). Georgia/serif fallback
        // renders immediately while the woff2 loads (font-display: swap).
        brand: ['Lora', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      colors: {
        // Keep the light palette; dark mode supplies Todoist's neutral grays.
        gray: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
          .map(shade => [shade, `rgb(var(--ui-gray-${shade}) / <alpha-value>)`])),
        // dayGLANCE brand orange (the "GLANCE" in the wordmark).
        brand: '#fe8b00',
        // UI accent only. Task/project palettes keep their semantic colours.
        accent: {
          50: '#fdf2f0', 100: '#fbe3df', 200: '#f4c4bb', 300: '#e9a092',
          400: 'rgb(var(--ui-accent-rgb) / <alpha-value>)',
          500: 'rgb(var(--ui-accent-rgb) / <alpha-value>)',
          600: 'rgb(var(--ui-accent-rgb) / <alpha-value>)',
          700: '#b4483a', 800: '#90392f', 900: '#612e28', 950: '#3b211e',
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
