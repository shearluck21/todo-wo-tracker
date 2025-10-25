/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#0f0f0f",
        surface: { DEFAULT: "#ffffff", soft: "#f5f5f8" },
        priority: {
          high: "#b91c1c",
          medium: "#b45309",
          low: "#525252",
        },
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        pill: "9999px",
      },
      boxShadow: {
        xs: "0 0 1px rgba(0,0,0,0.04)",
        sm: "0 1px 2px rgba(0,0,0,0.06)",
        md: "0 4px 12px rgba(0,0,0,0.08)",
        lg: "0 10px 30px rgba(0,0,0,0.10)",
      },
    },
  },
  plugins: [],
};