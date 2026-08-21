# Test Stratejisi (TR)

İlk kayıt: 2026-03-30
Güncel durum düzeltmesi: 2026-08-20

## Güncel Katmanlar

- Unit ve component suite'leri konfigürasyon, HTML/CSS sanitization, senkronizasyon, controller lifecycle, Rooster host davranışı, table selection/menu davranışı, telemetri sınırları ve sınırlı public hataları kapsar.
- Integration suite'leri production controller/editör modüllerini `FakeWorkItemHost` sınırına karşı çalıştırır; editable, unsupported-WIT, salt-okunur, alan bağımsızlığı, save/refresh/reset/unload/reload, echo ve hata toparlamasını kapsar.
- Release suite'leri regresyon kanıtı, release version, package kaynağı, ham ZIP, effective manifest, payload byte ve sabitlenmiş gerçek `tfx` sözleşmelerini dondurur.
- Yerel tarayıcı harness'i sentetik lifecycle ve görsel kanıt sağlar. Gerçek Azure DevOps doğrulamasının yerine geçmez.

Güncel değişken sayılar ve ölçülmüş release sonuçları `docs/releases/0.1.21-pre-gate.md`; kabul durumu `docs/acceptance-matrix.md` içindedir.

## Kalite Kapıları

```bash
npm run typecheck
npm test -- --reporter=verbose
npm run build
npm run check:build-outputs -- production
npm run build:harness
npm run check:build-outputs -- harness
npm run audit:prod
npm run package:vsix
```

- Yeni davranış deterministik bir otomatik test gerektirir.
- Bug fix mümkün olduğunda problemi üreten bir failure ile başlar.
- Production ve harness çıktıları ayrı exact sözleşmelerini geçmelidir.
- Packaging, salt-okunur release sözleşmesini ve ham/effective VSIX verifier'ı geçmelidir.
- Gerçek Azure kanıtı ayrıca yetkilendirilen external kapı olarak kalır.
