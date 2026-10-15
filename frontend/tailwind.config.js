/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          200: '#c2d3ff',
          300: '#93afff',
          400: '#6183ff',
          500: '#3d5aff',
          600: '#2b3ef7',
          700: '#2130e3',
          800: '#1e28b8',
          900: '#1e2691',
          950: '#141660',
        },
        surface: {
          DEFAULT: '#ffffff',
          50:  '#f8faff',
          100: '#f1f5fe',
          200: '#e8effe',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.05)',
        'card-hover': '0 4px 12px 0 rgba(61,90,255,0.12), 0 2px 4px -1px rgba(0,0,0,0.06)',
        'glow': '0 0 20px rgba(61,90,255,0.25)',
      }
    },
  },
  plugins: [],
}
