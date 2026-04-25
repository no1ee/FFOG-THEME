/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d5d9e0",
          300: "#a9b0bd",
          400: "#7a8294",
          500: "#525a6c",
          600: "#3a4252",
          700: "#262d3b",
          800: "#171c27",
          900: "#0c0f17",
        },
        accent: {
          500: "#7c5cff",
          600: "#6645f0",
        },
      },
    },
  },
  plugins: [],
};
