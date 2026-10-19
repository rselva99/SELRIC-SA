/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7f4',
          100: '#d9ede3',
          200: '#b5dbc9',
          300: '#84c3a7',
          400: '#55a683',
          500: '#368a67',
          600: '#276e52',
          700: '#215943',
          800: '#1d4737',
          900: '#193b2e',
          950: '#0d211a',
        },
        surface: {
          0: '#ffffff',
          50: '#f6f5f1',
          100: '#efede7',
          200: '#e9ecef',
          300: '#dee2e6',
          400: '#ced4da',
          500: '#adb5bd',
          600: '#868e96',
          700: '#495057',
          800: '#343a40',
          900: '#212529',
        },
        accent: {
          amber: '#f59f00',
          red: '#e03131',
          blue: '#1971c2',
          teal: '#0c8599',
        },
        // Program accents (see src/programs/index.js). Batavia Ganadería:
        // ranch green for cattle, clay for pigs — the prototype's own palette.
        ranch: {
          50: '#e2f2e8',
          100: '#c6e6d2',
          200: '#a6d6ba',
          500: '#1e7a4c',
          600: '#1a6a42',
          700: '#155a38',
          900: '#0e3d26',
        },
        clay: {
          50: '#f8e6dd',
          100: '#f0cdbc',
          200: '#e6b7a0',
          500: '#b4522a',
          600: '#9e4624',
          700: '#8c3d1d',
        },
      },
      fontFamily: {
        display: ['"DM Serif Display"', 'Georgia', 'serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        'modal': '0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)',
      }
    },
  },
  plugins: [],
}
