/**** Tailwind Config ****/ 
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './public/index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'sans-serif']
      }
    }
  },
  plugins: []
};
