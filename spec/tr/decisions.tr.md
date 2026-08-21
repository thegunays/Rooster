# Kararlar (TR)

Tarih: 2026-03-30
Bakış: Harness Engineering + sürekli handover hazırlığı

## ADR-001: Modüler Spec Seti
Karar: İki büyük doküman yerine rol bazlı operasyonel dosyalar kullanılacak (session summary, open tasks, decisions, testing, agents, worklog) ve EN/TR tutulacak.
Gerekçe: Daha hızlı onboarding, daha kolay oturum devamı, daha düşük bağlam kaybı.
Durum: Kabul edildi.

## ADR-002: Host/Bridge/Sync Ayrımını Koru
Karar: Mimarideki ayrımı koru (`RoosterDescriptionControl`, `WorkItemBridge`, `SyncEngine`, `Sanitizer`, `RoosterHost`).
Gerekçe: Test edilebilir sınırlar ve daha güvenli değişiklik etkisi.
Durum: Kabul edildi.

## ADR-003: Güvenlik Öncelikli HTML Hattı
Karar: Hem inbound render hem outbound persist aşamasında sanitization uygula.
Gerekçe: Güvensiz HTML’e karşı katmanlı savunma.
Durum: Kabul edildi.

## ADR-004: Debounce + Sıralı Yazım
Karar: Debounce, yazım sıralaması ve echo suppression yaklaşımı korunacak.
Gerekçe: Host üzerinde yazım fırtınasını ve self-trigger döngülerini önlemek.
Durum: Kabul edildi.

## ADR-005: Tablo Menüsü Editor API Üzerinden
Karar: Tablo komutları doğrudan DOM manipülasyonu yerine Rooster API üzerinden çalıştırılacak.
Gerekçe: Editor model bütünlüğü ve sync güvenilirliği.
Durum: Kabul edildi.
