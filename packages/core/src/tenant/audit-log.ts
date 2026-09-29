/**
 * Config değişiklik audit-trail'i — Insider konfigüratörünün her admin
 * yazımını (kim/ne zaman/hangi alan/eski→yeni) append-only olarak kaydeder
 * (Faz A Dalga 2, Security H3).
 *
 * DB salt-okunur olduğu için (asla DML/DDL) bu bir dosyaya yazılır — MSSQL'e
 * değil. `mapping-store.ts` ile AYNI kök çözümünü (`repoRoot()`) ve AYNI
 * "web-root dışı `data/`, mod 0600" deseni kullanır; parolayı ASLA düz metin
 * (hatta şifreli hâliyle bile) TUTMAZ — `newValue`/`oldValue` alanlarına
 * geçirmeden önce çağıran taraf (config-service) hassas alanları maskelemiş
 * olmalı (bkz. `db-connection-config.ts` `maskDbCredentials`).
 *
 * Append-only + process-içi kuyruk: `mapping-store.ts`'in write-serialize
 * deseninin AYNISI — iki eşzamanlı admin yazımı birbirinin audit satırını
 * yarıda kesip torn-write üretmez (B2).
 */
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./mapping-store";

export type ConfigAuditAction =
  | "save"
  | "reset"
  | "test-connection"
  // Faz A Dalga 1 — kodsuz tenant onboarding (`tenant-config-service.ts`):
  // "save" bilerek kullanılmadı, çünkü tenant-tanımı ilk kez mi yazılıyor
  // (yeni müşteri) yoksa var olan bir tanım mı güncelleniyor ayrımı
  // audit-trail'de görünür olmalı (create ≠ update; diğer boyutların "save"i
  // her zaman bir güncellemedir, tenant kimliği için ilk yazım özel bir olay).
  | "create-tenant"
  | "update-tenant";

export type ConfigAuditEntry = {
  ts: string;
  tenantId: string;
  /** Değişikliği yapan admin kullanıcı adı (session'dan — asla client body'sinden). */
  actor: string;
  action: ConfigAuditAction;
  /** Hangi alan değişti — ör. "dimensions.customerBreakdown", "dbCredentials". */
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
};

function auditFilePath(): string {
  return path.join(repoRoot(), "data", "config-audit.log");
}

function appendLine(entry: ConfigAuditEntry): void {
  const file = auditFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  // appendFileSync ilk oluşturmada umask'e tabi olabilir — garanti et.
  fs.chmodSync(file, 0o600);
}

// mapping-store.ts'teki writeQueue ile AYNI desen — bilinçli olarak ayrı bir
// kuyruk (audit ayrı dosyaya yazıyor, config store'un yazım sırasını
// bloklamamalı; sıralama YALNIZ audit dosyasının kendi içinde önemli).
let auditWriteQueue: Promise<unknown> = Promise.resolve();

/**
 * Bir config değişikliğini append-only audit log'a yazar. Yazım BAŞARISIZ
 * olursa (disk dolu vb.) reddedilen bir promise döner — çağıran (config
 * servisi) bunu LOGLAR ama asıl config yazımını audit hatası yüzünden geri
 * almaz (audit, config'in ÖNCESİNDE değil SONRASINDA yazılır — sıralama
 * config-service'te).
 */
export function recordConfigAudit(entry: Omit<ConfigAuditEntry, "ts">): Promise<void> {
  const write = () => appendLine({ ...entry, ts: new Date().toISOString() });
  const task = auditWriteQueue.then(write, write);
  auditWriteQueue = task.catch(() => undefined);
  return task;
}

/**
 * Audit log'u okur — en yeni `limit` kayıt, en yeniden en eskiye. Dosya
 * yoksa/bozuksa boş dizi (audit görünürlüğü best-effort; okuma hatası config
 * akışını asla kesmemeli). `tenantId` verilirse yalnız o tenant'ın kayıtları.
 */
export function readAuditLog(tenantId?: string, limit = 200): ConfigAuditEntry[] {
  const file = auditFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries: ConfigAuditEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ConfigAuditEntry;
      if (!tenantId || parsed.tenantId === tenantId) entries.push(parsed);
    } catch {
      /* bozuk satır — yok say, dosyanın geri kalanını okumaya devam et */
    }
  }
  entries.reverse();
  return entries.slice(0, Math.max(0, limit));
}
