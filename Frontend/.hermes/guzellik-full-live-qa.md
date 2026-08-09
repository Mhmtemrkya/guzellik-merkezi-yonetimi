# Güzellik Merkezi — Full Live QA Ledger

Owner: KAYA
Mode: live `browser-use` via Cloudflare tunnel + cloud browser.
Frontend WSL cwd: `/home/kaya/projects/guzellik-frontend`
Frontend Windows cwd: `C:\Users\KAYA\Desktop\Güzellik Merkezi Yönetimi\Frontend`
Backend cwd: `/home/kaya/projects/guzellik-backend`
Visible app tunnel during this run: `https://updates-motherboard-ours-easy.trycloudflare.com`

## Rule

All panels, pages, and visible features must be exercised end-to-end in live browser-use. Found errors must be fixed and retested before final completion.

## Seed credentials

- Kurum Yöneticisi: `admin@armonessa.test` / `Guzellik123!`
- Personel: `personel@armonessa.test` / `Guzellik123!`
- Platform Admin: `platform@armonessa.test` / `Guzellik123!`

## Panels and routes to test

### Public / Auth
- [ ] `/` landing: nav anchors, Demo/Giriş links, scroll sections, CTA links, console/resource errors.
- [ ] `/login`: role selection, invalid validation, admin login, personel login, platform login, institution/branch scope loading.

### Platform Admin
- [ ] `/platform` overview.
- [ ] `/platform/kurumlar`: tenant list/search/create/edit/delete QA-created tenant only, success state after reload.
- [ ] `/platform/uyarilar`: health warning state/actions/placeholders.
- [ ] `/platform/finans`: MRR/subscription state/actions/placeholders.
- [ ] `/platform/fatura`: billing state/actions/placeholders.
- [ ] `/platform/sistem`: system settings state/actions/placeholders.
- [ ] sidebar/logout/guard behavior.

### Kurum Yöneticisi / Admin
- [x] `/panel/musteriler`: edit modal PUT success persists after list reload.
- [x] `/panel/ekip`: edit modal PUT success persists after list reload.
- [x] `/panel/paketler`: service edit modal PUT success persists after list reload.
- [ ] `/panel`: dashboard cards, branch switcher, appointment list, quick links.
- [ ] `/panel/onaylar`: backend-pending/empty state and visible actions.
- [ ] `/panel/loglar`: backend-pending/empty state and visible actions.
- [ ] `/panel/musteriler`: create, search, select, edit, delete QA-created customer only, Excel buttons if implemented.
- [ ] `/panel/paketler`: create, select/unselect package preview, edit, delete QA-created service only.
- [ ] `/panel/stok`: backend-pending/PDF state.
- [ ] `/panel/randevular`: create/edit/status/filter/date behavior if exposed.
- [ ] `/panel/kasa`: backend-pending state.
- [ ] `/panel/on-muhasebe`: backend-pending/PDF state.
- [ ] `/panel/raporlar`: backend-pending/report state.
- [ ] `/panel/bildirimler`: state/actions.
- [ ] `/panel/ayarlar`: settings state/actions.
- [ ] sidebar/logout/route guard.

### Personel
- [ ] `/ekip`: dashboard.
- [ ] `/ekip/randevular`: list/filter/status actions if exposed.
- [ ] `/ekip/musteriler`: list/search/select details.
- [ ] `/ekip/seanslar`: backend-pending state.
- [ ] `/ekip/paketler`: backend-pending/package state.
- [ ] `/ekip/stok`: backend-pending/stock state.
- [ ] `/ekip/kasa`: backend-pending/cash state.
- [ ] `/ekip/raporlar`: performance/report state.
- [ ] `/ekip/loglar`: history state.
- [ ] `/ekip/bildirimler`: notifications state.
- [ ] `/ekip/profil`: profile state/actions.
- [ ] sidebar/logout/route guard.

## Issues found

None open yet in this ledger. Add each with: page, feature, steps, expected, actual, fix file, retest result.

## Current live state

Last known page: `/panel/paketler`, service edit modal success visible.
Next planned area: Platform Admin full panel QA, then remaining Admin pages, then Personel and public/auth.
