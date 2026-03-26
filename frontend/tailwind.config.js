/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sand: '#F4F3EE',
        coral: {
          DEFAULT: '#C15F3C',
          50: '#FAF0EB',
          100: '#F4D9CE',
          200: '#E9B39C',
          300: '#DE8D6A',
          400: '#D37048',
          500: '#C15F3C',
          600: '#A04D31',
          700: '#7F3C26',
        },
        taupe: {
          DEFAULT: '#B1ADA1',
          50: '#F5F4F2',
          100: '#E8E6E2',
          200: '#D4D0C8',
          300: '#C0BBAF',
          400: '#B1ADA1',
          500: '#958F82',
          600: '#7A7264',
        },
      },
    },
  },
  plugins: [],
};
