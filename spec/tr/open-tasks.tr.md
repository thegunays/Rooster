# Açık İşler (TR)

İlk kayıt: 2026-03-30
Güncel durum düzeltmesi: 2026-08-20

## Yüksek Öncelik

- Açık kullanıcı onayından sonra `docs/regression/azure-devops-regression.md` içindeki iki gerçek Azure DevOps senaryosunu private ve production olmayan bir organizasyonda çalıştır; gerekli ham alan, görsel, yazma logu ve konsol kanıtlarını sakla.

## Orta Öncelik

- Telemetriyi yalnızca console çıktısının ötesine taşıyan, opt-in ve gizlilik güvenli alanlara sahip bir sink tasarla.
- Work Item türü bazında deployment ve contribution konfigürasyon örnekleri ekle.
- Autosync hata durumunu gerçek host içinde doğrula ve hâlâ bekleyen AC-10 yerel tarayıcı kanıtını tamamla.
- Güncel sabit `570` yüksekliğin ötesinde responsive veya konfigüre edilebilir kontrol boyutlandırmasını değerlendir.

## Düşük Öncelik

- `window.prompt` tabanlı link eklemeyi inline dialog UX ile değiştirmeyi değerlendir.

## Tamamlanan Güncel Kapsam

- Controller load, field-change, save, refresh, reset, unload, reload, hata, çakışma, echo ve salt-okunur lifecycle sözleşmeleri deterministik component/integration testleriyle kapsanır.
- Table-menu durumu, dispatch, klavye davranışı, birleşik/bölünmüş seçim uç sözleşmeleri ve canlı yerel klavye yolu kapsanır.
- Salt-okunur render ve yerel görsel regresyon kayıtları tamamlandı; bunlar Azure-host kanıtı değil, yerel kanıttır.
- Güncel lifecycle harness ve yerel release-integrity/package kapısı uygulandı.

## Done Kriteri Rehberi

Her iş en az şu çıktıları içermeli:

1. Gözlemlenebilir davranış sözleşmesi
2. Test kapsama etkisi
3. Geri dönüş (rollback) planı
4. Worklog kaydı
