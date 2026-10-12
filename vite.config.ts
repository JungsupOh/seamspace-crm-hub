import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
// 빌드 정보. Vercel 이 빌드할 때 넣어 주는 값을 화면에서 읽을 수 있게 심는다.
// 프리뷰 주소와 운영 주소를 눈으로 구분하지 못해 옛 배포를 보고 있는 일이 잦아서 넣었다.
// 빌드 시각은 KST 로 찍는다. Vercel 빌더가 UTC 라 toISOString() 을 그대로 쓰면
// 9시간 전으로 보여서 "최신인지 확인한다" 는 목적을 못 한다.
const buildAtKST = new Date(Date.now() + 9 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 16)
  .replace("T", " ");

const BUILD_INFO = {
  sha: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "local",
  env: process.env.VERCEL_ENV || "local",   // production | preview | development | local
  at: `${buildAtKST} KST`,
};

export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_INFO__: JSON.stringify(BUILD_INFO),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs"],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
}));
