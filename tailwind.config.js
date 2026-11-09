/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0b0a14", 900: "#12101f", 800: "#1a1730", 700: "#252142", 600: "#34305a" },
        blue: { space: "#3b82f6" },
        glow: { pink: "#ff4d8d", amber: "#ffc857", mint: "#4de0b0", sky: "#59b8ff" },
      },
      fontFamily: {
        display: ["ui-rounded", "'SF Pro Rounded'", "'Nunito'", "system-ui", "sans-serif"],
      },
      keyframes: {
        pop: { "0%": { transform: "scale(0.4)", opacity: "0" }, "70%": { transform: "scale(1.15)" }, "100%": { transform: "scale(1)", opacity: "1" } },
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-4px)" } },
        shake: { "0%,100%": { transform: "rotate(0)" }, "25%": { transform: "rotate(-14deg)" }, "75%": { transform: "rotate(14deg)" } },
      },
      animation: {
        pop: "pop 280ms ease-out both",
        floaty: "floaty 2.4s ease-in-out infinite",
        shake: "shake 160ms linear infinite",
      },
    },
  },
  plugins: [],
};
