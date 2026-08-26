/// <reference types="vite/client" />

// vite.config.ts 의 define 으로 주입된다
declare const __BUILD_INFO__: {
  sha: string;
  env: "production" | "preview" | "development" | "local";
  at: string;
};
