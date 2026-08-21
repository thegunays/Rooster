# Local UI Harness Rehberi (TR)

İlk dokümantasyon: 2026-04-01
Güncel durum düzeltmesi: 2026-08-20

## Amaç

Production konfigürasyon, sanitizer, senkronizasyon, editör, salt-okunur görünüm ve controller modüllerini Azure DevOps runtime'ı olmadan `FakeWorkItemHost` sınırına karşı çalıştırmak.

## Dosyalar ve Sorumlulukları

- `test.html`, `#app` alanını bağlar ve `dist/test-harness.js` dosyasını yükler.
- `src/test-harness.ts`; konfigürasyon kontrollerini, lifecycle aksiyonlarını, kontrol önizlemesini, ham alan değerlerini, SHA-256 alan tanılarını ve fake-host okuma/yazma logunu sunar.
- `test/support/FakeWorkItemHost.ts`, sentetik Work Item sınırıdır.
- `webpack.config.js`, yalnızca harness için development girişini üretir. Production çıktı sözleşmesi bu girişi dışlar.

## Nasıl Çalıştırılır

1. Harness çıktısını derle ve doğrula:

   ```bash
   npm run build:harness
   npm run check:build-outputs -- harness
   ```

2. Repository kökünden yalnızca loopback'e bağlı statik sunucuyu başlat:

   ```bash
   python3 -m http.server 4173 --bind 127.0.0.1
   ```

3. `http://127.0.0.1:4173/test.html` adresini aç ve kontrol bittikten sonra sunucuyu durdur.

## Güncel Harness Davranışı

- `FieldName`, Work Item türü, salt-okunur durum, dar önizleme ve write-echo zamanlamasını ayarla.
- Load, Load BKU, Field change, Save, Refresh, Reset, Unload ve Reload aksiyonlarını production controller lifecycle'ı üzerinden çalıştır.
- Custom alan ile `System.Description` alanını ham değer, SHA-256, okuma ve yazma tanıları üzerinden birbirinden bağımsız incele.
- Düzenlenebilir durumda gerçek editör toolbar/table menüsünü; salt-okunur durumda production salt-okunur görünümü çalıştır.

Ayrıntılı kayıtlı yerel senaryolar ve ekran görüntüleri `docs/regression/local-harness.md` içindedir.

## Sınırlamalar

Bu, sentetik yerel kanıttır. Azure DevOps SDK runtime'ını, gerçek contribution yüklemesini, organizasyon izinlerini, extension kurulumunu veya gerçek Work Item kalıcılığını çalıştırmaz. İki Azure-host senaryosu `docs/regression/azure-devops-regression.md` altında `pending external approval and execution` durumunda kalır.
