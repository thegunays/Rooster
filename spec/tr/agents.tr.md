# Agent Çalışma Kuralları (TR)

Tarih: 2026-03-30

## Amaç
Süregelen geliştirme oturumlarında güvenli ve verimli agent iş birliği kurallarını tanımlamak.

## Kurallar
1. İlgisiz yerel değişiklikleri asla geri alma.
2. Küçük, geri alınabilir ve gerekçesi net değişiklikler yap.
3. Her anlamlı değişiklik setinden sonra `worklog` güncelle.
4. Büyük refactor öncesi `decisions` dosyasına karar kaydı ekle.
5. Ne test edildi, nasıl test edildi, ne test edilmedi açıkça yaz.
6. Mimari sınırları koru (control vs bridge vs sync vs sanitizer).
7. İçerik operasyonlarında editor model API’sini bypass eden doğrudan DOM kestirmelerinden kaçın.

## Oturum Devir Protokolü
- Başlangıçta `session-summary` + `open-tasks` oku.
- Varsayımları tek paragrafta netleştir.
- Her seferinde tek bir dikey dilim (vertical slice) uygula.
- Oturumu `worklog` ve `testing` güncellemeleriyle kapat.
