/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#078b51',
          dark: '#087548',
          light: '#e7f7ee',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f2f7f4',
        },
        app: '#f8fbf9',
        ink: {
          DEFAULT: '#172d27',
          secondary: '#71817a',
        },
        line: '#dce9e1',
        success: '#15965a',
        warning: '#e6a23c',
        danger: '#dc5555',
        info: '#4388d6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(23, 45, 39, 0.06), 0 1px 2px rgba(23, 45, 39, 0.04)',
        pop: '0 12px 32px rgba(23, 45, 39, 0.18)',
      },
      borderRadius: {
        card: '10px',
        ctrl: '7px',
      },
      width: {
        sidebar: '220px',
      },
      height: {
        header: '58px',
      },
    },
  },
  plugins: [],
}
