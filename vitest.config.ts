import { defineConfig } from "vitest/config";

/**
 * Kök vitest config — monorepo genelinde `*.test.ts` dosyalarını tarar.
 * İlk tenant/identifier testleriyle birlikte eklendi (bkz.
 * packages/core/src/tenant/__tests__).
 */
export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
  },
});
