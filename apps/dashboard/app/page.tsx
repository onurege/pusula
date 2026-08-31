import { redirect } from "next/navigation";
import { getTenantConfig } from "@/lib/tenant";

/**
 * Kök `/` — V3 artık ana uygulama (V1/V2 kaldırıldı). Tenant `defaultLanding`
 * ayarlıysa oraya, değilse V3 özet ekranına yönlendirilir.
 */
export default function HomePage() {
  const { ui } = getTenantConfig();
  redirect(ui?.defaultLanding && ui.defaultLanding !== "/" ? ui.defaultLanding : "/v3");
}
