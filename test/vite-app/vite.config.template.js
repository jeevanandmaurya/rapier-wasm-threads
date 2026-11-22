import rapierThreads from "__PKG__/vite";
export default {
  root: import.meta.dirname,
  plugins: [rapierThreads()],
  worker: { format: "es", plugins: () => [rapierThreads()] },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
};
