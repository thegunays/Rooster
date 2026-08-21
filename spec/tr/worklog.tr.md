# Çalışma Günlüğü (TR)

Tarih Referansı: 2026-03-30
Format: kronolojik

## 2026-03-30
- Repo topolojisi incelendi; runtime/build/test yüzeyleri çıkarıldı.
- `SPEC.md` ve `HANDOVER.md` okunup uygulanabilir mimari bağlama dönüştürüldü.
- Temel modüller incelendi (`control`, `bridge`, `config`, `telemetry`, `static`).
- `npm test` ile baz test durumu doğrulandı: tüm testler geçti (4 dosya / 13 test).
- EN/TR modüler spec doküman seti oluşturuldu:
  - session-summary
  - open-tasks
  - decisions
  - testing
  - agents
  - worklog
- Oturum devamlılığını ve handover ergonomisini artırmak için monolitik doküman yapısı değiştirildi.

## 2026-04-03
- Azure DevOps native WI formundaki template renderı ile extension editörü arasındaki Description görünüm farkı incelendi.
- Kök neden doğrulandı: sanitizer, template içindeki `<style>` bloklarını attığı için class bazlı tablo/font stilleri extension tarafında kayboluyordu.
- Sanitizer güvenli stylesheet desteğiyle güncellendi; tehlikeli CSS kalıpları (`@import`, `url(...)`, `expression(...)`, `javascript:` ve benzerleri) engellenmeye devam edecek şekilde düzenlendi.
- Test kapsamı genişletildi:
  - güvenli template stylesheet + inline style korunumu
  - tehlikeli stylesheet içeriğinin elenmesi
- Değişiklik sonrası test suite doğrulandı.
- Editor toolbar buton stilleri daha soft ve modern bir görünüme güncellendi (`static/control.css`):
  - toolbar arka planı hafif gradient ile yenilendi
  - butonlarda radius/padding/typography dengesi iyileştirildi
  - `hover`, `active`, `focus-visible` durumları için yumuşak geçiş, gölge ve erişilebilir odak halkası eklendi
